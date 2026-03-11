import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

import httpx
from fake_useragent import UserAgent

from modules.diagnostics import (
    body_preview,
    json_keys,
    mask_session_id,
    response_preview,
    safe_json_loads,
    summarize_proxy,
)
from modules.http_client import AsyncHttpClientPool


logger = logging.getLogger(__name__)

Outcome = Literal['success', 'retryable_error', 'fatal_error', 'auth_failed', 'rate_limited']
ScrapeKind = Literal['followers', 'following']

PROBE_USERNAMES = (
    'instagram',
    'kimkardashian',
    'selena_gomez',
    'justinbieber',
    'arianagrande',
    'dwaynejohnson',
    'ladygaga',
    'beyonce',
    'shakira',
)

COUNT_FIELD_BY_KIND = {
    'followers': 'edge_followed_by',
    'following': 'edge_follow',
}


@dataclass
class VerificationResult:
    outcome: Outcome
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    diagnostics: dict[str, Any] = field(default_factory=dict)
    probe_user_id: Optional[str] = None


@dataclass
class TargetResolution:
    outcome: Outcome
    user_id: Optional[str] = None
    total: Optional[int] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    diagnostics: dict[str, Any] = field(default_factory=dict)


@dataclass
class ScrapeChunkResult:
    outcome: Outcome
    target_username: str
    scraped: int
    chunk_limit: int
    cursor: Optional[str]
    next_cursor: Optional[str]
    has_more: bool
    total: Optional[int]
    users: list[dict[str, Any]]
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_api_dict(self) -> dict[str, Any]:
        return {
            'outcome': self.outcome,
            'targetUsername': self.target_username,
            'scraped': self.scraped,
            'chunkLimit': self.chunk_limit,
            'cursor': self.cursor,
            'nextCursor': self.next_cursor,
            'hasMore': self.has_more,
            'total': self.total,
            'users': self.users,
            'errorCode': self.error_code,
            'errorMessage': self.error_message,
            'diagnostics': self.diagnostics,
        }


@dataclass
class ResponseSnapshot:
    status_code: Optional[int]
    content_type: str
    payload: Any = None
    text_preview: str = ''


def build_user_agent() -> str:
    try:
        return UserAgent().random
    except Exception:
        return (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/135.0.0.0 Safari/537.36'
        )


def build_profile_headers(username: str) -> dict[str, str]:
    return {
        'authority': 'www.instagram.com',
        'method': 'GET',
        'path': f'/api/v1/users/web_profile_info/?username={username}',
        'scheme': 'https',
        'accept': '*/*',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.6',
        'priority': 'u=1, i',
        'referer': f'https://www.instagram.com/{username}/',
        'user-agent': build_user_agent(),
        'x-ig-app-id': '936619743392459',
        'x-ig-www-claim': '0',
        'x-requested-with': 'XMLHttpRequest',
    }


def build_friendship_headers(username: str, kind: ScrapeKind) -> dict[str, str]:
    return {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.8',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': f'https://www.instagram.com/{username}/{kind}/',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-model': '""',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'sec-gpc': '1',
        'user-agent': build_user_agent(),
        'x-ig-app-id': '936619743392459',
        'x-requested-with': 'XMLHttpRequest',
    }


def classify_transport_error(error: Exception) -> tuple[Outcome, str, str]:
    if isinstance(error, httpx.ProxyError):
        return 'retryable_error', 'proxy_error', 'Proxy request failed'
    if isinstance(error, httpx.TimeoutException):
        return 'retryable_error', 'timeout', 'Instagram request timed out'
    if isinstance(error, httpx.TransportError):
        return 'retryable_error', 'transport_error', 'Instagram transport request failed'
    return 'fatal_error', 'request_error', str(error)


def classify_status(status_code: Optional[int], *, context: str) -> tuple[Outcome, str, str]:
    if status_code == 429:
        return 'rate_limited', 'rate_limited', 'Instagram rate limited the request'
    if status_code == 401:
        return 'auth_failed', 'invalid_session', 'Session is invalid or expired'
    if status_code == 403:
        if context == 'session_verification':
            return 'auth_failed', 'access_forbidden', 'Access forbidden for this session or proxy'
        return 'retryable_error', 'access_forbidden', 'Instagram blocked the request'
    if status_code == 404:
        if context == 'target_resolution':
            return 'fatal_error', 'target_not_found', 'Failed to resolve target user id'
        return 'fatal_error', 'resource_not_found', 'Instagram resource was not found'
    if status_code in {502, 503, 504}:
        return 'retryable_error', f'upstream_{status_code}', f'Instagram upstream returned {status_code}'
    if status_code and status_code >= 500:
        return 'retryable_error', f'upstream_{status_code}', f'Instagram upstream returned {status_code}'
    if status_code and status_code >= 400:
        return 'fatal_error', f'http_{status_code}', f'Instagram returned {status_code}'
    return 'fatal_error', 'unknown_status', 'Instagram returned an unexpected response'


class InstagramScraperService:
    def __init__(self, client_pool: Optional[AsyncHttpClientPool] = None) -> None:
        self._client_pool = client_pool or AsyncHttpClientPool()

    async def aclose(self) -> None:
        await self._client_pool.aclose()

    async def verify_session(
        self,
        username: str,
        session_id: str,
        proxy: Optional[str] = None,
    ) -> VerificationResult:
        session_summary = mask_session_id(session_id)
        probe_failures: list[dict[str, Any]] = []
        probe_usernames = [username.strip(), *PROBE_USERNAMES]

        logger.info(
            'verify_session start username=%s session=%s proxy=%s',
            username,
            session_summary,
            summarize_proxy(proxy),
        )

        probe_user_id: Optional[str] = None
        for probe_username in probe_usernames:
            if not probe_username:
                continue
            resolution = await self.resolve_target_user(
                probe_username,
                kind='following',
                proxy=proxy,
                session_id=session_id,
            )
            if resolution.user_id:
                probe_user_id = resolution.user_id
                logger.info(
                    'verify_session probe resolved username=%s probe_username=%s session=%s user_id=%s',
                    username,
                    probe_username,
                    session_summary,
                    probe_user_id,
                )
                break
            probe_failures.append(
                {
                    'probeUsername': probe_username,
                    'outcome': resolution.outcome,
                    'errorCode': resolution.error_code,
                    'errorMessage': resolution.error_message,
                }
            )

        if not probe_user_id:
            logger.warning(
                'verify_session probe unresolved username=%s session=%s proxy=%s',
                username,
                session_summary,
                summarize_proxy(proxy),
            )
            return VerificationResult(
                outcome='success',
                diagnostics={
                    'verificationDegraded': True,
                    'probeFailures': probe_failures,
                    'proxy': summarize_proxy(proxy),
                },
            )

        url = f'https://www.instagram.com/api/v1/friendships/{probe_user_id}/following/'
        params = {'count': '1'}
        try:
            response = await self._request(
                'GET',
                url,
                proxy=proxy,
                cookies={'sessionid': session_id},
                headers=build_friendship_headers(username, 'following'),
                params=params,
            )
        except Exception as error:
            outcome, error_code, error_message = classify_transport_error(error)
            logger.exception(
                'verify_session exception username=%s session=%s proxy=%s error=%s',
                username,
                session_summary,
                summarize_proxy(proxy),
                error,
            )
            return VerificationResult(
                outcome=outcome,
                error_code=error_code,
                error_message=error_message,
                diagnostics={
                    'proxy': summarize_proxy(proxy),
                    'probeUserId': probe_user_id,
                    'probeFailures': probe_failures,
                },
            )

        snapshot = build_snapshot(response)
        logger.info(
            'verify_session friendships response username=%s session=%s status=%s content_type=%s proxy=%s body_preview=%r',
            username,
            session_summary,
            snapshot.status_code,
            snapshot.content_type,
            summarize_proxy(proxy),
            snapshot.text_preview,
        )

        if response.status_code == 200:
            return VerificationResult(
                outcome='success',
                diagnostics={
                    'proxy': summarize_proxy(proxy),
                    'probeUserId': probe_user_id,
                    'probeFailures': probe_failures,
                    'verificationDegraded': False,
                },
            )

        outcome, error_code, error_message = classify_status(
            response.status_code,
            context='session_verification',
        )
        return VerificationResult(
            outcome=outcome,
            error_code=error_code,
            error_message=error_message,
            diagnostics={
                'proxy': summarize_proxy(proxy),
                'probeUserId': probe_user_id,
                'probeFailures': probe_failures,
                'statusCode': snapshot.status_code,
                'contentType': snapshot.content_type,
                'bodyPreview': snapshot.text_preview,
            },
        )

    async def resolve_target_user(
        self,
        target_username: str,
        *,
        kind: ScrapeKind,
        proxy: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> TargetResolution:
        url = f'https://www.instagram.com/api/v1/users/web_profile_info/?username={target_username}'
        try:
            response = await self._request(
                'GET',
                url,
                proxy=proxy,
                headers=build_profile_headers(target_username),
                cookies={'sessionid': session_id} if session_id else None,
            )
        except Exception as error:
            outcome, error_code, error_message = classify_transport_error(error)
            logger.exception(
                '%s.get_userid exception target_username=%s proxy=%s error=%s',
                kind,
                target_username,
                summarize_proxy(proxy),
                error,
            )
            return TargetResolution(
                outcome=outcome,
                error_code=error_code,
                error_message=error_message,
                diagnostics={'proxy': summarize_proxy(proxy)},
            )

        snapshot = build_snapshot(response)
        payload = snapshot.payload
        user = payload.get('data', {}).get('user') if isinstance(payload, dict) else None
        user_id = user.get('id') if isinstance(user, dict) else None
        count_field = COUNT_FIELD_BY_KIND[kind]
        total = None
        if isinstance(user, dict):
            count_value = user.get(count_field, {})
            if isinstance(count_value, dict):
                total = count_value.get('count')

        if response.status_code == 200 and user_id:
            logger.info(
                '%s.get_userid success target_username=%s user_id=%s status=%s proxy=%s total=%s',
                kind,
                target_username,
                user_id,
                response.status_code,
                summarize_proxy(proxy),
                total,
            )
            return TargetResolution(
                outcome='success',
                user_id=user_id,
                total=int(total) if total is not None else None,
                diagnostics={
                    'statusCode': snapshot.status_code,
                    'contentType': snapshot.content_type,
                    'proxy': summarize_proxy(proxy),
                },
            )

        if response.status_code == 200:
            return TargetResolution(
                outcome='fatal_error',
                error_code='target_not_found',
                error_message='Failed to resolve target user id',
                diagnostics={
                    'statusCode': snapshot.status_code,
                    'contentType': snapshot.content_type,
                    'payloadKeys': json_keys(payload),
                    'bodyPreview': snapshot.text_preview,
                    'proxy': summarize_proxy(proxy),
                },
            )

        outcome, error_code, error_message = classify_status(
            response.status_code,
            context='target_resolution',
        )
        return TargetResolution(
            outcome=outcome,
            error_code=error_code,
            error_message=error_message,
            diagnostics={
                'statusCode': snapshot.status_code,
                'contentType': snapshot.content_type,
                'payloadKeys': json_keys(payload),
                'bodyPreview': snapshot.text_preview,
                'proxy': summarize_proxy(proxy),
            },
        )

    async def scrape_chunk(
        self,
        *,
        kind: ScrapeKind,
        auth_username: str,
        session_id: str,
        target_username: str,
        cursor: Optional[str] = None,
        chunk_limit: int = 200,
        max_pages: int = 10,
        proxy: Optional[str] = None,
    ) -> ScrapeChunkResult:
        verification = await self.verify_session(auth_username, session_id, proxy=proxy)
        if verification.outcome != 'success':
            return ScrapeChunkResult(
                outcome=verification.outcome,
                target_username=target_username,
                scraped=0,
                chunk_limit=chunk_limit,
                cursor=cursor,
                next_cursor=None,
                has_more=False,
                total=None,
                users=[],
                error_code=verification.error_code,
                error_message=verification.error_message,
                diagnostics={'sessionVerification': verification.diagnostics},
            )

        resolution = await self.resolve_target_user(target_username, kind=kind, proxy=proxy)
        if resolution.outcome != 'success' or not resolution.user_id:
            return ScrapeChunkResult(
                outcome=resolution.outcome,
                target_username=target_username,
                scraped=0,
                chunk_limit=chunk_limit,
                cursor=cursor,
                next_cursor=None,
                has_more=False,
                total=resolution.total,
                users=[],
                error_code=resolution.error_code,
                error_message=resolution.error_message,
                diagnostics={
                    'sessionVerification': verification.diagnostics,
                    'targetResolution': resolution.diagnostics,
                },
            )

        users: list[dict[str, Any]] = []
        pages = 0
        request_count = 0
        current_cursor = cursor
        next_cursor: Optional[str] = None
        has_more = False
        page_diagnostics: list[dict[str, Any]] = []
        path = 'followers' if kind == 'followers' else 'following'

        while len(users) < int(chunk_limit) and pages < int(max_pages):
            remaining = max(1, int(chunk_limit) - len(users))
            params = {
                'count': str(min(50, remaining)),
                'search_surface': 'follow_list_page',
            }
            if current_cursor:
                params['max_id'] = current_cursor

            url = f'https://www.instagram.com/api/v1/friendships/{resolution.user_id}/{path}/'
            try:
                response = await self._request(
                    'GET',
                    url,
                    proxy=proxy,
                    cookies={'sessionid': session_id},
                    headers=build_friendship_headers(target_username, path),
                    params=params,
                )
                request_count += 1
            except Exception as error:
                outcome, error_code, error_message = classify_transport_error(error)
                logger.exception(
                    '%s.get_data_chunk exception target_username=%s proxy=%s error=%s',
                    kind,
                    target_username,
                    summarize_proxy(proxy),
                    error,
                )
                return ScrapeChunkResult(
                    outcome=outcome,
                    target_username=target_username,
                    scraped=len(users),
                    chunk_limit=chunk_limit,
                    cursor=cursor,
                    next_cursor=next_cursor,
                    has_more=has_more,
                    total=resolution.total,
                    users=users[: int(chunk_limit)],
                    error_code=error_code,
                    error_message=error_message,
                    diagnostics={
                        'sessionVerification': verification.diagnostics,
                        'targetResolution': resolution.diagnostics,
                        'pageDiagnostics': page_diagnostics,
                        'proxy': summarize_proxy(proxy),
                        'requestCount': request_count,
                    },
                )

            snapshot = build_snapshot(response)
            payload = snapshot.payload
            if response.status_code != 200:
                outcome, error_code, error_message = classify_status(
                    response.status_code,
                    context='pagination',
                )
                return ScrapeChunkResult(
                    outcome=outcome,
                    target_username=target_username,
                    scraped=len(users),
                    chunk_limit=chunk_limit,
                    cursor=cursor,
                    next_cursor=next_cursor,
                    has_more=has_more,
                    total=resolution.total,
                    users=users[: int(chunk_limit)],
                    error_code=error_code,
                    error_message=error_message,
                    diagnostics={
                        'sessionVerification': verification.diagnostics,
                        'targetResolution': resolution.diagnostics,
                        'pageDiagnostics': page_diagnostics,
                        'proxy': summarize_proxy(proxy),
                        'requestCount': request_count,
                        'statusCode': snapshot.status_code,
                        'contentType': snapshot.content_type,
                        'bodyPreview': snapshot.text_preview,
                    },
                )

            if not isinstance(payload, dict):
                return ScrapeChunkResult(
                    outcome='retryable_error',
                    target_username=target_username,
                    scraped=len(users),
                    chunk_limit=chunk_limit,
                    cursor=cursor,
                    next_cursor=next_cursor,
                    has_more=has_more,
                    total=resolution.total,
                    users=users[: int(chunk_limit)],
                    error_code='invalid_json',
                    error_message='Instagram returned invalid JSON',
                    diagnostics={
                        'sessionVerification': verification.diagnostics,
                        'targetResolution': resolution.diagnostics,
                        'pageDiagnostics': page_diagnostics,
                        'proxy': summarize_proxy(proxy),
                        'requestCount': request_count,
                        'statusCode': snapshot.status_code,
                        'contentType': snapshot.content_type,
                        'bodyPreview': snapshot.text_preview,
                    },
                )

            batch = payload.get('users', [])
            if isinstance(batch, list) and batch:
                users.extend(batch)

            pages += 1
            next_max_id = payload.get('next_max_id')
            has_more = bool(next_max_id and payload.get('big_list'))
            next_cursor = next_max_id if has_more else None
            page_diagnostics.append(
                {
                    'page': pages,
                    'statusCode': snapshot.status_code,
                    'users': len(batch) if isinstance(batch, list) else 0,
                    'hasMore': has_more,
                    'nextCursorPresent': bool(next_cursor),
                }
            )

            if not has_more:
                break

            current_cursor = next_cursor

        return ScrapeChunkResult(
            outcome='success',
            target_username=target_username,
            scraped=len(users[: int(chunk_limit)]),
            chunk_limit=chunk_limit,
            cursor=cursor,
            next_cursor=next_cursor,
            has_more=has_more,
            total=resolution.total,
            users=users[: int(chunk_limit)],
            diagnostics={
                'sessionVerification': verification.diagnostics,
                'targetResolution': resolution.diagnostics,
                'pageDiagnostics': page_diagnostics,
                'proxy': summarize_proxy(proxy),
                'requestCount': request_count,
            },
        )

    async def _request(self, method: str, url: str, *, proxy: Optional[str] = None, **kwargs) -> httpx.Response:
        return await self._client_pool.request(method, url, proxy=proxy, **kwargs)


def build_snapshot(response: httpx.Response) -> ResponseSnapshot:
    payload = safe_json_loads(response.text)
    return ResponseSnapshot(
        status_code=response.status_code,
        content_type=response.headers.get('content-type', ''),
        payload=payload,
        text_preview=body_preview(response_preview(response)),
    )


def run_sync(coro):
    return asyncio.run(coro)


def run_with_temporary_service(callback):
    async def runner():
        service = InstagramScraperService()
        try:
            return await callback(service)
        finally:
            await service.aclose()

    return asyncio.run(runner())
