import atexit
import json
import os
import random
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import logging
from typing import Any, Dict, List, Optional, Tuple
from threading import Lock
from urllib.parse import quote


def _project_root() -> str:
    here = os.path.abspath(os.path.dirname(__file__))
    return os.path.abspath(os.path.join(here, "..", ".."))


sys.path.insert(0, _project_root())

from python.internal_systems.data_models.models import ThreadsAccount
from python.instagram_actions.browsing import scroll_feed, scroll_reels
from python.instagram_actions.stories import watch_stories
from python.instagram_actions.engagement.follow_users.session import follow_usernames
from python.instagram_actions.engagement.follow_users.common import normalize_range
from python.instagram_actions.engagement.unfollow_users.session import unfollow_usernames
from python.instagram_actions.engagement.approve_follow_requests.session import approve_follow_requests
from python.instagram_actions.messaging.session import send_messages
from python.database_sync.config import PROJECT_URL, SECRET_KEY
from python.database_sync.accounts_client import InstagramAccountsClient
from python.database_sync.profiles_client import ProfilesClient
from python.database_sync.messages_client import MessageTemplatesClient
from python.browser_control.display_manager import DisplayManager
from python.internal_systems.shared_utilities.worker_utils import (
    apply_count_limit,
    create_browser_context,
)
from python.internal_systems.storage.atomic import atomic_write_json


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _configure_stdio() -> None:
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    try:
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


_configure_stdio()

_log_stream_handler = logging.StreamHandler(sys.stdout)
_log_stream_handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))

_logger = logging.getLogger("workflow_runner")
_logger.handlers.clear()
_logger.addHandler(_log_stream_handler)
_logger.setLevel(logging.INFO)
_logger.propagate = False


def log(message: str) -> None:
    level = logging.INFO
    try:
        normalized = str(message).lstrip().lower()
        if normalized.startswith(("ошибка", "error", "exception")):
            level = logging.ERROR
        elif normalized.startswith(("warning", "warn", "внимание")):
            level = logging.WARNING
    except Exception:
        level = logging.INFO
    _logger.log(level, str(message))
    sys.stdout.flush()


def emit_event(event_type: str, **data: Any) -> None:
    event = {"type": event_type, "ts": _now_iso(), **data}
    sys.stdout.write(f"__EVENT__{json.dumps(event)}__EVENT__\n")
    sys.stdout.flush()


def _parse_int(value: Any, default: int) -> int:
    try:
        return int(str(value).strip().split()[0])
    except Exception:
        return default


def _parse_float(value: Any, default: float) -> float:
    try:
        return float(str(value).strip().split()[0])
    except Exception:
        return default


def _parse_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


def _pick_first(mapping: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping and mapping.get(key) is not None:
            return mapping.get(key)
    return None


def _normalize_string_list(value: Any) -> List[str]:
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        raw_values = []
        for line in value.splitlines():
            raw_values.extend(line.split(","))
    else:
        raw_values = []

    seen: set[str] = set()
    normalized: List[str] = []
    for raw in raw_values:
        cleaned = str(raw or "").strip().replace("@", "")
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(cleaned)
    return normalized


def _parse_retry_backoff_seconds(value: Any) -> List[int]:
    defaults = [30, 120, 600, 1800]
    if isinstance(value, (int, float)):
        seconds = max(1, int(value))
        return [seconds]

    parts = _normalize_string_list(value)
    parsed: List[int] = []
    for part in parts:
        try:
            parsed.append(max(1, int(float(part))))
        except Exception:
            continue
    return parsed or defaults


def _profile_daily_scraping_limit(profile: Optional[Dict[str, Any]]) -> Optional[int]:
    if not isinstance(profile, dict):
        return None
    value = profile.get("daily_scraping_limit")
    if value is None:
        return None
    try:
        numeric = int(float(value))
    except Exception:
        return None
    return max(0, numeric)


def _profile_daily_scraping_used(profile: Optional[Dict[str, Any]]) -> int:
    if not isinstance(profile, dict):
        return 0
    value = profile.get("daily_scraping_used")
    try:
        numeric = int(float(value))
    except Exception:
        return 0
    return max(0, numeric)


def _profile_remaining_daily_scraping_capacity(
    profile: Optional[Dict[str, Any]],
) -> Optional[int]:
    limit = _profile_daily_scraping_limit(profile)
    if limit is None:
        return None
    used = _profile_daily_scraping_used(profile)
    return max(0, limit - used)


def _workflow_headers() -> Dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if SECRET_KEY:
        headers["Authorization"] = f"Bearer {SECRET_KEY}"
    return headers


def _convex_post_json(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not PROJECT_URL:
        raise RuntimeError("Convex PROJECT_URL is not configured")

    try:
        import requests

        response = requests.post(
            f"{PROJECT_URL}{path}",
            json=payload,
            headers=_workflow_headers(),
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise RuntimeError(f"Unexpected response shape for {path}")
        return data
    except Exception as exc:
        raise RuntimeError(f"Convex request failed for {path}: {exc}") from exc


def _convex_get_json(path: str) -> Any:
    if not PROJECT_URL:
        raise RuntimeError("Convex PROJECT_URL is not configured")

    try:
        import requests

        response = requests.get(
            f"{PROJECT_URL}{path}",
            headers=_workflow_headers(),
            timeout=60,
        )
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        raise RuntimeError(f"Convex request failed for {path}: {exc}") from exc


def _workflow_has_activity(nodes: List[Dict[str, Any]], activity_id: str) -> bool:
    for node in nodes:
        node_data = node.get("data") if isinstance(node.get("data"), dict) else {}
        if str(node_data.get("activityId") or "") == activity_id:
            return True
    return False


def _build_scrape_export_payload(
    workflow_id: str,
    node_id: str,
    profile_name: str,
    kind: str,
    targets: List[str],
    users: List[Any],
) -> Dict[str, Any]:
    return {
        "workflowId": workflow_id,
        "nodeId": node_id,
        "activityId": "scrape_relationships",
        "profileName": profile_name,
        "kind": kind,
        "targets": targets,
        "users": users,
        "count": len(users),
        "scrapedAt": int(time.time() * 1000),
        "storageKind": "export",
    }


def _scraped_user_key(user: Any) -> str:
    if isinstance(user, dict):
        for key in ("id", "pk", "username", "userName", "user_name", "login"):
            value = user.get(key)
            if value is None:
                continue
            cleaned = str(value).strip()
            if cleaned:
                return cleaned.lower()
        try:
            return json.dumps(user, sort_keys=True, ensure_ascii=False)
        except Exception:
            return str(user)
    if isinstance(user, str):
        return user.strip().lower()
    return str(user)


def _dedupe_scraped_users(users: List[Any]) -> List[Any]:
    seen: set[str] = set()
    out: List[Any] = []
    for user in users:
        key = _scraped_user_key(user)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(user)
    return out


def _extract_users_from_payload(payload: Any) -> List[Any]:
    if not isinstance(payload, dict):
        return []
    for key in ("users", "rawUsers", "accounts"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def _store_artifact_payload(payload: Dict[str, Any]) -> str:
    result = _convex_post_json("/api/workflow-artifacts/store-artifact", {"payload": payload})
    storage_id = str(result.get("storageId") or "").strip()
    if not storage_id:
        raise RuntimeError("Artifact storage response did not include storageId")
    return storage_id


def _resume_snapshot_path(workflow_id: str, node_id: str) -> str:
    safe_workflow = "".join(ch if ch.isalnum() else "_" for ch in str(workflow_id or "workflow"))
    safe_node = "".join(ch if ch.isalnum() else "_" for ch in str(node_id or "node"))
    return os.path.join(_project_root(), "data", "workflow_resume", f"{safe_workflow}_{safe_node}.json")


def _store_resume_snapshot(path: str, payload: Dict[str, Any]) -> str:
    atomic_write_json(path, payload)
    return path


def _delete_resume_snapshot(path: Optional[str]) -> None:
    cleaned = str(path or "").strip()
    if not cleaned:
        return
    try:
        os.unlink(cleaned)
    except FileNotFoundError:
        return
    except OSError:
        return


def _load_users_from_resume_snapshot(path: str) -> List[Any]:
    cleaned = str(path or "").strip()
    if not cleaned or not os.path.exists(cleaned):
        return []
    try:
        with open(cleaned, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except Exception as exc:
        raise RuntimeError(f"Failed to load resume snapshot for {cleaned}: {exc}") from exc
    return _extract_users_from_payload(payload)


def _load_users_from_storage(storage_id: str) -> List[Any]:
    cleaned = str(storage_id or "").strip()
    if not cleaned:
        return []

    url = _convex_get_json(f"/api/workflow-artifacts/storage-url?storageId={quote(cleaned)}")
    if not isinstance(url, str) or not url.strip():
        return []

    try:
        import requests

        response = requests.get(url, timeout=60)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f"Failed to load artifact payload for {cleaned}: {exc}") from exc

    return _extract_users_from_payload(payload)


def _fetch_profiles_for_lists(
    list_ids: List[str],
    *,
    cooldown_minutes: int = 0,
    enforce_cooldown: bool = False,
) -> List[Dict[str, Any]]:
    if not PROJECT_URL:
        return []
    clean_ids = [str(lid).strip().replace('"', "") for lid in list_ids if str(lid).strip()]
    if not clean_ids:
        return []

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if SECRET_KEY:
        headers["Authorization"] = f"Bearer {SECRET_KEY}"
    endpoint = "/api/profiles/available" if enforce_cooldown and cooldown_minutes > 0 else "/api/profiles/by-list-ids"
    payload = {"listIds": clean_ids}
    if endpoint.endswith("/available"):
        payload["cooldownMinutes"] = max(0, int(cooldown_minutes))
    try:
        import requests

        r = requests.post(
            f"{PROJECT_URL}{endpoint}",
            json=payload,
            headers=headers,
            timeout=30,
        )
        data = r.json() if r.status_code < 400 else []
        if not isinstance(data, list):
            return []

        unique: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for profile in data:
            if not isinstance(profile, dict):
                continue
            key = str(profile.get("profile_id") or profile.get("name") or "").strip()
            if not key or key in seen:
                continue
            seen.add(key)
            unique.append(profile)
        return unique
    except Exception:
        return []


def _extract_start_browser_settings(
    nodes: List[Dict[str, Any]],
    start_data: Dict[str, Any],
) -> Dict[str, Any]:
    config: Dict[str, Any] = {}
    for node in nodes:
        node_data = node.get("data") if isinstance(node.get("data"), dict) else {}
        if str(node_data.get("activityId") or "") != "start_browser":
            continue
        node_config = node_data.get("config")
        if isinstance(node_config, dict):
            config = dict(node_config)
            break

    legacy_profile_cooldown = _pick_first(config, "profileReopenCooldown", "profile_reopen_cooldown")
    legacy_messaging_cooldown = _pick_first(config, "messagingCooldown", "messaging_cooldown")

    profile_cooldown_enabled_raw = _pick_first(
        config,
        "profileReopenCooldownEnabled",
        "profile_reopen_cooldown_enabled",
    )
    if profile_cooldown_enabled_raw is None and legacy_profile_cooldown is not None:
        profile_cooldown_enabled_raw = True

    profile_cooldown_minutes_raw = _pick_first(
        config,
        "profileReopenCooldownMinutes",
        "profile_reopen_cooldown_minutes",
    )
    if profile_cooldown_minutes_raw is None:
        profile_cooldown_minutes_raw = legacy_profile_cooldown

    messaging_cooldown_enabled_raw = _pick_first(
        config,
        "messagingCooldownEnabled",
        "messaging_cooldown_enabled",
    )
    if messaging_cooldown_enabled_raw is None and legacy_messaging_cooldown is not None:
        messaging_cooldown_enabled_raw = True

    messaging_cooldown_hours_raw = _pick_first(
        config,
        "messagingCooldownHours",
        "messaging_cooldown_hours",
    )
    if messaging_cooldown_hours_raw is None:
        messaging_cooldown_hours_raw = legacy_messaging_cooldown

    headless_raw = _pick_first(config, "headlessMode", "headless", "headless_mode")
    if headless_raw is None:
        headless_raw = start_data.get("headlessMode")

    return {
        "headless": _parse_bool(headless_raw, default=_parse_bool(start_data.get("headlessMode"), False)),
        "parallel_profiles": max(
            1,
            min(
                10,
                _parse_int(
                    _pick_first(config, "parallelProfiles", "parallel_profiles"),
                    1,
                ),
            ),
        ),
        "profile_reopen_cooldown_enabled": _parse_bool(profile_cooldown_enabled_raw, False),
        "profile_reopen_cooldown_minutes": max(
            0,
            _parse_int(profile_cooldown_minutes_raw, 30),
        ),
        "messaging_cooldown_enabled": _parse_bool(messaging_cooldown_enabled_raw, False),
        "messaging_cooldown_hours": max(
            0,
            _parse_int(messaging_cooldown_hours_raw, 2),
        ),
    }


def _find_start_node(nodes: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for n in nodes:
        if n.get("type") == "start":
            return n
    for n in nodes:
        if str(n.get("id")) == "start_node":
            return n
    return None


def _build_edge_index(edges: List[Dict[str, Any]]) -> Dict[Tuple[str, str], List[str]]:
    out: Dict[Tuple[str, str], List[str]] = {}
    for e in edges:
        src = str(e.get("source") or "")
        tgt = str(e.get("target") or "")
        if not src or not tgt:
            continue
        handle = str(e.get("sourceHandle") or "")
        key = (src, handle)
        out.setdefault(key, []).append(tgt)
    return out


def _next_node(edge_index: Dict[Tuple[str, str], List[str]], node_id: str, handle: str) -> Optional[str]:
    candidates = edge_index.get((node_id, handle))
    if candidates:
        return candidates[0]
    if handle:
        candidates2 = edge_index.get((node_id, ""))
        if candidates2:
            return candidates2[0]
    return None


def _choose_weighted(handles: List[str], weights_str: str) -> str:
    weights = []
    try:
        parts = [p.strip() for p in str(weights_str or "").split(",") if p.strip()]
        weights = [max(0.0, float(p)) for p in parts]
    except Exception:
        weights = []
    if len(weights) < len(handles):
        weights = weights + [1.0] * (len(handles) - len(weights))
    weights = weights[: len(handles)]
    total = sum(weights)
    if total <= 0:
        return random.choice(handles)
    r = random.random() * total
    acc = 0.0
    for h, w in zip(handles, weights):
        acc += w
        if r <= acc:
            return h
    return handles[-1]


class WorkflowRunner:
    def __init__(self, workflow_id: str, nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]], accounts: List[ThreadsAccount], options: Dict[str, Any]):
        self.workflow_id = workflow_id
        self.nodes = nodes
        self.edges = edges
        self.node_index = {str(n.get("id")): n for n in nodes if n.get("id")}
        self.edge_index = _build_edge_index(edges)
        self.accounts = accounts
        self.running = True
        self.options = options
        self._scrape_node_ids = [
            str(node.get("id"))
            for node in nodes
            if str(
                (
                    node.get("data")
                    if isinstance(node.get("data"), dict)
                    else {}
                ).get("activityId")
                or ""
            )
            == "scrape_relationships"
        ]
        self._has_scrape_relationships = len(self._scrape_node_ids) > 0
        self.headless = _parse_bool(options.get("headless"), False)
        self.messaging_cooldown_enabled = _parse_bool(options.get("messaging_cooldown_enabled"), False)
        self.messaging_cooldown_hours = max(0, _parse_int(options.get("messaging_cooldown_hours"), 2))
        self.workflow_name = str(options.get("workflow_name") or workflow_id).strip() or workflow_id
        self.accounts_client = InstagramAccountsClient()
        self.profiles_client = ProfilesClient()
        self._profile_cache: Dict[str, Dict[str, Any]] = {}
        self._profile_cache_lock = Lock()
        configured = _parse_int(
            options.get("parallel_profiles", options.get("parallelProfiles")),
            1,
        )
        account_count = len(accounts) if accounts else 1
        configured_workers = max(1, min(account_count, configured))
        self._max_workers = 1 if self._has_scrape_relationships else configured_workers
        self._executor = ThreadPoolExecutor(max_workers=self._max_workers)
        self.display_mgr = DisplayManager()
        raw_node_states = options.get("node_states")
        self.node_states: Dict[str, Any] = dict(raw_node_states) if isinstance(raw_node_states, dict) else {}

    def stop(self) -> None:
        self.running = False
        try:
            self._executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            try:
                self._executor.shutdown(wait=False)
            except Exception:
                pass
        except Exception:
            pass

    def _get_cached_profile(self, name: str) -> Optional[Dict[str, Any]]:
        with self._profile_cache_lock:
            return self._profile_cache.get(name)

    def _set_cached_profile(self, name: str, data: Dict[str, Any]) -> None:
        with self._profile_cache_lock:
            self._profile_cache[name] = data

    def _record_daily_scraping_usage(self, profile_name: str, amount: int) -> None:
        safe_amount = max(0, int(amount)) if isinstance(amount, (int, float)) else 0
        if safe_amount <= 0:
            return
        self.profiles_client.increment_daily_scraping_used(profile_name, safe_amount)
        cached = self._get_cached_profile(profile_name)
        next_profile = dict(cached) if isinstance(cached, dict) else {"name": profile_name}
        next_profile["daily_scraping_used"] = (
            _profile_daily_scraping_used(next_profile) + safe_amount
        )
        self._set_cached_profile(profile_name, next_profile)

    def _sanitize_node_states(self) -> Dict[str, Any]:
        return json.loads(json.dumps(self.node_states))

    def _update_node_state(self, node_id: str, **patch: Any) -> Dict[str, Any]:
        existing = self.node_states.get(node_id)
        base = dict(existing) if isinstance(existing, dict) else {}
        base.update(patch)
        self.node_states[node_id] = base
        return base

    def _emit_node_state(self, event_type: str, node_id: str, profile_name: str, **extra: Any) -> None:
        emit_event(
            event_type,
            workflow_id=self.workflow_id,
            node_id=node_id,
            profile=profile_name,
            node_states=self._sanitize_node_states(),
            **extra,
        )

    def _scrape_work_complete(self) -> bool:
        if not self._scrape_node_ids:
            return False
        for node_id in self._scrape_node_ids:
            state = self.node_states.get(node_id)
            if not isinstance(state, dict):
                return False
            if state.get("done") is True:
                continue
            if str(state.get("status") or "").strip().lower() == "completed":
                continue
            return False
        return True

    def _open_relationship_view(
        self,
        page: Any,
        *,
        target_username: str,
        kind: str,
    ) -> Optional[Tuple[str, str]]:
        normalized_target = str(target_username or "").strip().strip("/").lower()
        label = "Followers" if kind == "followers" else "Following"
        css_selectors = [
            f'a[href="/{normalized_target}/{kind}/"]',
            f'a[href="/{normalized_target}/{kind}"]',
            f'a[href$="/{kind}/"]',
            f'a[href$="/{kind}"]',
            f'a[href*="/{kind}/"]',
            f'a[href*="/{kind}"]',
        ]
        locator_fallbacks = [
            ("role link", page.get_by_role("link", name=label, exact=True).first),
            ("header link", page.locator("header a", has_text=label).first),
            ("header section link", page.locator("header section a", has_text=label).first),
            ("text link", page.locator("a", has_text=label).first),
        ]

        click_error: Optional[Exception] = None
        open_error: Optional[Exception] = None

        log(
            f"scrape_relationships @{normalized_target}: opening {kind} list"
        )
        try:
            clicked_selector = page.evaluate(
                """
                ({ selectors }) => {
                  for (const selector of selectors) {
                    const el = document.querySelector(selector)
                    if (el instanceof HTMLElement) {
                      el.click()
                      return selector
                    }
                  }
                  return null
                }
                """,
                {
                    "selectors": css_selectors,
                },
            )
        except Exception as exc:
            click_error = exc
            clicked_selector = None

        if not clicked_selector:
            for description, locator in locator_fallbacks:
                try:
                    locator.click(timeout=2000)
                    clicked_selector = description
                    click_error = None
                    break
                except Exception as exc:
                    click_error = exc

        if not clicked_selector:
            if click_error is not None:
                log(
                    f"scrape_relationships @{normalized_target}: failed to resolve {kind} link "
                    f"via in-page click: {click_error}"
                )
            return (
                "relationship_link_not_found",
                f"Could not find {kind} link on @{normalized_target}",
            )

        try:
            page.wait_for_function(
                r"""
                ({ targetUsername, kind }) => {
                  const normalizedPath = String(window.location.pathname || '')
                    .toLowerCase()
                    .replace(/\/+$/, '/')
                  if (normalizedPath.includes(`/${targetUsername}/${kind}/`)) {
                    return true
                  }
                  if (normalizedPath.endsWith(`/${kind}/`) || normalizedPath.includes(`/${kind}/`)) {
                    return true
                  }
                  return Boolean(document.querySelector('div[role="dialog"]'))
                }
                """,
                arg={
                    "targetUsername": normalized_target,
                    "kind": kind,
                },
                timeout=7000,
            )
            log(f"scrape_relationships @{normalized_target}: {kind} UI opened")
            return None
        except Exception as exc:
            open_error = exc

        if open_error is not None:
            return (
                "relationship_open_failed",
                f"Failed to open {kind} list for @{normalized_target}: {open_error}",
            )
        return (
            "relationship_link_not_found",
            f"Could not find {kind} link on @{normalized_target}",
        )

    def _scrape_relationship_chunk(
        self,
        page: Any,
        *,
        target_username: str,
        kind: str,
        cursor: Optional[str],
        chunk_limit: int,
        max_pages: int,
    ) -> Dict[str, Any]:
        return page.evaluate(
            """
            async ({ targetUsername, kind, cursor, chunkLimit, maxPages }) => {
              const APP_ID = '936619743392459'
              const ASBD_ID = '129477'
              const batchSize = Math.max(1, Math.min(200, Number(chunkLimit) || 25))
              const csrfToken = document.cookie
                .split('; ')
                .find((part) => part.startsWith('csrftoken='))
                ?.split('=')
                .slice(1)
                .join('=') || ''

              const baseHeaders = {
                accept: '*/*',
                'x-ig-app-id': APP_ID,
                'x-asbd-id': ASBD_ID,
                'x-requested-with': 'XMLHttpRequest',
              }
              if (csrfToken) {
                baseHeaders['x-csrftoken'] = decodeURIComponent(csrfToken)
              }

              const classifyFailure = async (response, fallbackMessage, partialUsers = [], nextCursor = cursor || null) => {
                let text = ''
                try {
                  text = await response.text()
                } catch {
                  text = ''
                }

                let detail = text || fallbackMessage || `HTTP ${response.status}`
                try {
                  const parsed = text ? JSON.parse(text) : null
                  if (parsed && typeof parsed === 'object') {
                    detail = parsed.detail || parsed.message || parsed.error || detail
                  }
                } catch {
                }

                let outcome = 'fatal_error'
                if (response.status === 401 || response.status === 403) outcome = 'auth_failed'
                else if (response.status === 429) outcome = 'rate_limited'
                else if (response.status === 404) outcome = 'fatal_error'
                else if (response.status >= 500) outcome = 'retryable_error'

                return {
                  outcome,
                  users: partialUsers,
                  nextCursor,
                  hasMore: Boolean(nextCursor),
                  total: null,
                  statusCode: response.status,
                  errorCode: `http_${response.status}`,
                  errorMessage: String(detail || fallbackMessage || 'Request failed').slice(0, 500),
                }
              }

              try {
                const usernameFromPath = String(window.location.pathname || '')
                  .split('/')
                  .filter(Boolean)[0] || ''
                const username = String(usernameFromPath || targetUsername || '').trim()
                if (!username) {
                  return {
                    outcome: 'fatal_error',
                    users: [],
                    nextCursor: cursor || null,
                    hasMore: Boolean(cursor),
                    total: null,
                    statusCode: null,
                    errorCode: 'target_not_found',
                    errorMessage: 'Could not resolve username from current page',
                    debug: {
                      stage: 'resolve_username',
                      targetUsername,
                      cursor: cursor || null,
                    },
                  }
                }

                const profileResp = await fetch(
                  `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
                  {
                    credentials: 'include',
                    headers: baseHeaders,
                  },
                )
                if (!profileResp.ok) {
                  const failure = await classifyFailure(profileResp, 'Failed to load profile metadata')
                  return {
                    ...failure,
                    debug: {
                      stage: 'profile_info',
                      username,
                      targetUsername,
                      cursor: cursor || null,
                    },
                  }
                }

                const profileData = await profileResp.json()
                const user = profileData?.data?.user
                const userId = String(user?.id || user?.pk || '').trim()
                if (!userId) {
                  return {
                    outcome: 'fatal_error',
                    users: [],
                    nextCursor: cursor || null,
                    hasMore: Boolean(cursor),
                    total: null,
                    statusCode: 404,
                    errorCode: 'target_not_found',
                    errorMessage: 'Target profile not found',
                    debug: {
                      stage: 'profile_info_parse',
                      username,
                      targetUsername,
                      cursor: cursor || null,
                    },
                  }
                }

                const total =
                  kind === 'followers'
                    ? user?.edge_followed_by?.count ?? user?.follower_count ?? null
                    : user?.edge_follow?.count ?? user?.following_count ?? null

                let nextCursor = cursor || null
                let hasMore = true
                const users = []
                let pagesFetched = 0
                const endpoint = kind === 'followers' ? 'followers' : 'following'
                const requestHeaders = {
                  ...baseHeaders,
                  referer: `https://www.instagram.com/${username}/${endpoint}/`,
                }

                while (hasMore && pagesFetched < maxPages) {
                  const params = new URLSearchParams({ count: String(batchSize) })
                  if (nextCursor) {
                    params.set('max_id', nextCursor)
                  }

                  const response = await fetch(
                    `https://www.instagram.com/api/v1/friendships/${userId}/${endpoint}/?${params.toString()}`,
                    {
                      credentials: 'include',
                      headers: requestHeaders,
                    },
                  )

                  if (!response.ok) {
                    const failure = await classifyFailure(
                      response,
                      `Failed to load ${kind} chunk`,
                      users,
                      nextCursor,
                    )
                    return {
                      ...failure,
                      debug: {
                        stage: 'friendships_fetch',
                        username,
                        targetUsername,
                        userId,
                        endpoint,
                        pagesFetched,
                        cursor: cursor || null,
                        nextCursor: nextCursor || null,
                        batchSize,
                      },
                    }
                  }

                  const payload = await response.json()
                  const chunkUsers = Array.isArray(payload?.users)
                    ? payload.users
                    : Array.isArray(payload?.profiles)
                      ? payload.profiles
                      : []

                  users.push(...chunkUsers)
                  nextCursor =
                    typeof payload?.next_max_id === 'string' && payload.next_max_id.trim()
                      ? payload.next_max_id.trim()
                      : null
                  hasMore = Boolean(nextCursor && (payload?.big_list ?? true))
                  pagesFetched += 1

                  if (hasMore && pagesFetched < maxPages) {
                    const delay = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000
                    await new Promise((resolve) => setTimeout(resolve, delay))
                  }
                }

                return {
                  outcome: 'success',
                  users,
                  nextCursor,
                  hasMore,
                  total,
                  statusCode: 200,
                  errorCode: null,
                  errorMessage: null,
                  debug: {
                    stage: 'completed',
                    username,
                    targetUsername,
                    userId,
                    endpoint,
                    pagesFetched,
                    batchSize,
                    cursor: cursor || null,
                    nextCursor: nextCursor || null,
                    totalUsers: users.length,
                    total,
                    hasMore,
                  },
                }
              } catch (error) {
                return {
                  outcome: 'retryable_error',
                  users: [],
                  nextCursor: cursor || null,
                  hasMore: Boolean(cursor),
                  total: null,
                  statusCode: null,
                  errorCode: 'network_error',
                  errorMessage: String(error?.message || error || 'Unknown browser fetch failure').slice(0, 500),
                  debug: {
                    stage: 'exception',
                    targetUsername,
                    kind,
                    cursor: cursor || null,
                    chunkLimit,
                    maxPages,
                  },
                }
              }
            }
            """,
            {
                "targetUsername": target_username,
                "kind": kind,
                "cursor": cursor,
                "chunkLimit": chunk_limit,
                "maxPages": max_pages,
            },
        )

    def _execute_scrape_relationships(
        self,
        node_id: str,
        cfg: Dict[str, Any],
        page: Any,
        profile_name: str,
        profile_data: Optional[Dict[str, Any]] = None,
    ) -> str:
        targets = _normalize_string_list(cfg.get("targets"))
        if not targets:
            log("scrape_relationships requires at least one target username")
            return "failure"

        kind = "following" if str(cfg.get("kind") or "").strip().lower() == "following" else "followers"
        chunk_limit = max(1, min(5000, _parse_int(cfg.get("chunkLimit"), 200)))
        max_pages_per_attempt = max(1, min(100, _parse_int(cfg.get("maxPagesPerAttempt"), 3)))
        max_attempts = max(1, min(20, _parse_int(cfg.get("maxAttempts"), 4)))
        retry_backoff_seconds = _parse_retry_backoff_seconds(cfg.get("retryBackoffSeconds"))
        open_delay_seconds = max(0.0, min(60.0, _parse_float(cfg.get("openDelaySeconds"), 2.0)))

        existing_state = self.node_states.get(node_id)
        state = dict(existing_state) if isinstance(existing_state, dict) else {}
        if state.get("kind") != kind or _normalize_string_list(state.get("targets")) != targets:
            _delete_resume_snapshot(state.get("resumeSnapshotPath"))
            state = {}
        stale_index = max(0, _parse_int(state.get("currentTargetIndex"), 0))
        if (
            state.get("done")
            or str(state.get("status") or "").strip().lower() == "completed"
            or stale_index >= len(targets)
        ):
            if state:
                _delete_resume_snapshot(state.get("resumeSnapshotPath"))
                log(
                    f"scrape_relationships: clearing stale resume state for node {node_id} "
                    f"(status={state.get('status')}, done={state.get('done')}, "
                    f"currentTargetIndex={stale_index}, targets={len(targets)})"
                )
            state = {}

        artifact_storage_id = str(state.get("artifactStorageId") or "").strip()
        resume_snapshot_path = str(state.get("resumeSnapshotPath") or "").strip()
        if artifact_storage_id:
            merged_users = _load_users_from_storage(artifact_storage_id)
        elif resume_snapshot_path:
            merged_users = _load_users_from_resume_snapshot(resume_snapshot_path)
        else:
            merged_users = []
        merged_users = _dedupe_scraped_users(merged_users)

        current_target_index = max(0, _parse_int(state.get("currentTargetIndex"), 0))
        cursor = str(state.get("cursor") or "").strip() or None
        attempt = max(0, _parse_int(state.get("attempt"), 0))
        total_scraped = max(0, _parse_int(state.get("scraped"), len(merged_users)))
        chunks_completed = max(0, _parse_int(state.get("chunksCompleted"), 0))
        target_scraped = max(0, _parse_int(state.get("targetScraped"), 0))
        failed_targets = state.get("failedTargets") if isinstance(state.get("failedTargets"), list) else []
        profile_record = dict(profile_data) if isinstance(profile_data, dict) else {}
        if not profile_record:
            cached_profile = self._get_cached_profile(profile_name)
            if isinstance(cached_profile, dict):
                profile_record = dict(cached_profile)
        if profile_record:
            self._set_cached_profile(profile_name, profile_record)

        def _fail_due_to_daily_limit() -> str:
            nonlocal failed_targets, resume_snapshot_path

            limit = _profile_daily_scraping_limit(profile_record)
            used = _profile_daily_scraping_used(profile_record)
            if limit is None:
                return "failure"

            if merged_users and not artifact_storage_id and not resume_snapshot_path:
                try:
                    resume_snapshot_path = _store_resume_snapshot(
                        _resume_snapshot_path(self.workflow_id, node_id),
                        _build_scrape_export_payload(
                            self.workflow_id,
                            node_id,
                            profile_name,
                            kind,
                            targets,
                            merged_users,
                        ),
                    )
                except Exception:
                    pass

            message = (
                f"scrape_relationships: profile {profile_name} reached daily scraping "
                f"limit ({used}/{limit})"
            )
            current_target = (
                targets[current_target_index]
                if 0 <= current_target_index < len(targets)
                else None
            )
            if current_target:
                failed_targets = [
                    *failed_targets,
                    {
                        "targetUsername": current_target,
                        "errorCode": "daily_scraping_limit_reached",
                        "errorMessage": message,
                    },
                ]
            self._update_node_state(
                node_id,
                status="failed",
                kind=kind,
                targets=targets,
                currentTargetIndex=current_target_index,
                cursor=cursor,
                attempt=attempt,
                scraped=total_scraped,
                deduped=len(merged_users),
                chunksCompleted=chunks_completed,
                targetScraped=target_scraped,
                completedTargets=current_target_index,
                failedTargets=failed_targets,
                lastError=message,
                lastErrorCode="daily_scraping_limit_reached",
                artifactStorageId=artifact_storage_id or None,
                resumeSnapshotPath=resume_snapshot_path or None,
                updatedAt=int(time.time() * 1000),
            )
            log(message)
            return "failure"

        self._update_node_state(
            node_id,
            activityId="scrape_relationships",
            kind=kind,
            targets=targets,
            currentTargetIndex=current_target_index,
            cursor=cursor,
            attempt=attempt,
            scraped=total_scraped,
            deduped=len(merged_users),
            chunksCompleted=chunks_completed,
            targetScraped=target_scraped,
            completedTargets=current_target_index,
            failedTargets=failed_targets,
            artifactStorageId=artifact_storage_id or None,
            manifestStorageId=state.get("manifestStorageId"),
            resumeSnapshotPath=resume_snapshot_path or None,
            updatedAt=int(time.time() * 1000),
        )
        log(
            f"scrape_relationships: starting node {node_id} kind={kind} "
            f"targets={len(targets)} chunkLimit={chunk_limit} maxPagesPerAttempt={max_pages_per_attempt} "
            f"maxAttempts={max_attempts} resumeIndex={current_target_index} resumeCursor={'yes' if cursor else 'no'}"
        )

        if _profile_remaining_daily_scraping_capacity(profile_record) == 0:
            return _fail_due_to_daily_limit()

        active_target_username: Optional[str] = None
        relationship_view_ready = False

        while self.running and current_target_index < len(targets):
            target_username = targets[current_target_index]
            should_open_relationship = (
                not relationship_view_ready or active_target_username != target_username
            )
            if should_open_relationship:
                log(
                    f"scrape_relationships @{target_username}: target "
                    f"{current_target_index + 1}/{len(targets)} open profile start"
                )
                try:
                    page.goto(
                        f"https://www.instagram.com/{target_username}/",
                        wait_until="domcontentloaded",
                        timeout=60000,
                    )
                    if open_delay_seconds > 0:
                        page.wait_for_timeout(int(open_delay_seconds * 1000))
                    log(
                        f"scrape_relationships @{target_username}: profile opened "
                        f"(delay={open_delay_seconds:.1f}s)"
                    )
                except Exception as exc:
                    log(f"Ошибка открытия @{target_username}: {exc}")
                    return "failure"

                relationship_error = self._open_relationship_view(
                    page,
                    target_username=target_username,
                    kind=kind,
                )
                if relationship_error is None:
                    active_target_username = target_username
                    relationship_view_ready = True
            else:
                relationship_error = None

            if relationship_error is None:
                chunk_started_at = time.time()
                remaining_capacity = _profile_remaining_daily_scraping_capacity(profile_record)
                if remaining_capacity == 0:
                    return _fail_due_to_daily_limit()
                effective_chunk_limit = (
                    max(1, min(chunk_limit, remaining_capacity))
                    if remaining_capacity is not None
                    else chunk_limit
                )
                chunk = self._scrape_relationship_chunk(
                    page,
                    target_username=target_username,
                    kind=kind,
                    cursor=cursor,
                    chunk_limit=effective_chunk_limit,
                    max_pages=max_pages_per_attempt,
                )
            else:
                error_code, error_message = relationship_error
                chunk = {
                    "outcome": "fatal_error",
                    "users": [],
                    "nextCursor": cursor,
                    "hasMore": bool(cursor),
                    "total": None,
                    "statusCode": None,
                    "errorCode": error_code,
                    "errorMessage": error_message,
                }

            outcome = str(chunk.get("outcome") or "")
            error_message = str(chunk.get("errorMessage") or "").strip() or None
            error_code = str(chunk.get("errorCode") or "").strip() or None
            chunk_users = chunk.get("users") if isinstance(chunk.get("users"), list) else []
            chunk_debug = chunk.get("debug") if isinstance(chunk.get("debug"), dict) else {}
            chunk_elapsed_ms = (
                int(round((time.time() - chunk_started_at) * 1000))
                if relationship_error is None
                else 0
            )

            if outcome == "success":
                next_cursor = str(chunk.get("nextCursor") or "").strip() or None
                has_more = bool(chunk.get("hasMore")) and bool(next_cursor)
                expected_total = chunk.get("total") if isinstance(chunk.get("total"), int) else None
                next_target_scraped = target_scraped + len(chunk_users)
                if not has_more and expected_total is not None and expected_total > 0 and next_target_scraped == 0:
                    outcome = "fatal_error"
                    error_code = "unexpected_empty_result"
                    error_message = (
                        f"{kind} list for @{target_username} returned zero users "
                        f"but profile metadata reported {expected_total}"
                    )
                    log(
                        f"scrape_relationships @{target_username}: unexpected empty result "
                        f"(expectedTotal={expected_total}, nextTargetScraped={next_target_scraped})"
                    )
                else:
                    if chunk_users:
                        self._record_daily_scraping_usage(profile_name, len(chunk_users))
                        cached_profile = self._get_cached_profile(profile_name)
                        if isinstance(cached_profile, dict):
                            profile_record = dict(cached_profile)
                    merged_users = _dedupe_scraped_users(merged_users + chunk_users)
                    total_scraped += len(chunk_users)
                    chunks_completed += 1
                    cursor = next_cursor
                    target_scraped = next_target_scraped
                    reported_total = expected_total if expected_total is not None else "?"
                    if has_more:
                        log(
                            f"scrape_relationships @{target_username}: chunk saved "
                            f"rows={len(chunk_users)} total={target_scraped}/{reported_total} "
                            f"deduped={len(merged_users)} pages={chunk_debug.get('pagesFetched') or '-'} "
                            f"elapsedMs={chunk_elapsed_ms} nextCursor=yes"
                        )
                    else:
                        log(
                            f"scrape_relationships @{target_username}: final chunk "
                            f"rows={len(chunk_users)} total={next_target_scraped}/{reported_total} "
                            f"deduped={len(merged_users)} pages={chunk_debug.get('pagesFetched') or '-'} "
                            f"elapsedMs={chunk_elapsed_ms}"
                        )
                    if not has_more:
                        current_target_index += 1
                        cursor = None
                        attempt = 0
                        target_scraped = 0
                        active_target_username = None
                        relationship_view_ready = False
                        if current_target_index < len(targets):
                            resume_snapshot_path = _store_resume_snapshot(
                                _resume_snapshot_path(self.workflow_id, node_id),
                                _build_scrape_export_payload(
                                    self.workflow_id,
                                    node_id,
                                    profile_name,
                                    kind,
                                    targets,
                                    merged_users,
                                ),
                            )
                            artifact_storage_id = ""
                        else:
                            _delete_resume_snapshot(resume_snapshot_path)
                            resume_snapshot_path = ""
                        log(
                            f"scrape_relationships @{target_username}: target completed "
                            f"(chunkUsers={len(chunk_users)}, totalScraped={total_scraped}, deduped={len(merged_users)})"
                        )
                    else:
                        resume_snapshot_path = _store_resume_snapshot(
                            _resume_snapshot_path(self.workflow_id, node_id),
                            _build_scrape_export_payload(
                                self.workflow_id,
                                node_id,
                                profile_name,
                                kind,
                                targets,
                                merged_users,
                            ),
                        )
                        artifact_storage_id = ""

                    updated = self._update_node_state(
                        node_id,
                        activityId="scrape_relationships",
                        kind=kind,
                        targets=targets,
                        currentTargetIndex=current_target_index,
                        cursor=cursor,
                        attempt=attempt,
                        scraped=total_scraped,
                        deduped=len(merged_users),
                        chunksCompleted=chunks_completed,
                        targetScraped=target_scraped,
                        completedTargets=current_target_index,
                        failedTargets=failed_targets,
                        lastError=None,
                        lastErrorCode=None,
                        artifactStorageId=artifact_storage_id or None,
                        updatedAt=int(time.time() * 1000),
                        resumeSnapshotPath=resume_snapshot_path or None,
                    )
                    self._emit_node_state(
                        "task_progress",
                        node_id,
                        profile_name,
                        task=f"Scraped @{target_username}",
                        targetUsername=target_username,
                        scraped=len(chunk_users),
                        totalScraped=total_scraped,
                        deduped=len(merged_users),
                        hasMore=has_more,
                        nextCursor=cursor,
                        completedTargets=current_target_index,
                        progress=min(99, int(round(100.0 * (current_target_index / max(1, len(targets)))))),
                    )

                    if current_target_index >= len(targets):
                        artifact_storage_id = _store_artifact_payload(
                            _build_scrape_export_payload(
                                self.workflow_id,
                                node_id,
                                profile_name,
                                kind,
                                targets,
                                merged_users,
                            )
                        )
                        artifact_row = _convex_post_json(
                            "/api/workflow-artifacts/upsert",
                            {
                                "workflowId": self.workflow_id,
                                "workflowName": self.workflow_name,
                                "nodeId": node_id,
                                "nodeLabel": updated.get("label") or "Scrape Relationships",
                                "kind": kind,
                                "targets": targets,
                                "targetUsername": "\n".join(targets),
                                "status": "completed",
                                "sourceProfileName": profile_name,
                                "lastRunAt": int(time.time() * 1000),
                                "storageId": artifact_storage_id,
                                "exportStorageId": artifact_storage_id,
                                "stats": {
                                    "scraped": total_scraped,
                                    "deduped": len(merged_users),
                                    "chunksCompleted": chunks_completed,
                                    "targetsCompleted": current_target_index,
                                },
                                "metadata": {
                                    "activityId": "scrape_relationships",
                                    "failedTargets": failed_targets,
                                },
                            },
                        )
                        self._update_node_state(
                            node_id,
                            status="completed",
                            attempt=0,
                            cursor=None,
                            done=True,
                            targetScraped=0,
                            completedTargets=current_target_index,
                            artifactStorageId=artifact_storage_id,
                            manifestStorageId=None,
                            artifactId=artifact_row.get("_id"),
                            resumeSnapshotPath=None,
                            updatedAt=int(time.time() * 1000),
                        )
                        log(
                            f"scrape_relationships: node {node_id} completed "
                            f"(targets={current_target_index}, totalScraped={total_scraped}, deduped={len(merged_users)})"
                        )
                        return "success"

                    continue

            retryable = outcome in {"retryable_error", "rate_limited"}
            if retryable and attempt + 1 < max_attempts and self.running:
                attempt += 1
                relationship_view_ready = False
                delay_seconds = retry_backoff_seconds[min(attempt - 1, len(retry_backoff_seconds) - 1)]
                log(
                    f"scrape_relationships @{target_username}: scheduling retry "
                    f"{attempt}/{max_attempts} in {delay_seconds}s "
                    f"(errorCode={error_code or '-'}, message={error_message or '-'})"
                )
                self._update_node_state(
                    node_id,
                    kind=kind,
                    targets=targets,
                    currentTargetIndex=current_target_index,
                    cursor=cursor,
                    attempt=attempt,
                    scraped=total_scraped,
                    deduped=len(merged_users),
                    chunksCompleted=chunks_completed,
                    targetScraped=target_scraped,
                    completedTargets=current_target_index,
                    failedTargets=failed_targets,
                    lastError=error_message,
                    lastErrorCode=error_code,
                    updatedAt=int(time.time() * 1000),
                    resumeSnapshotPath=resume_snapshot_path or None,
                )
                self._emit_node_state(
                    "task_progress",
                    node_id,
                    profile_name,
                    task=f"Retrying @{target_username}",
                    targetUsername=target_username,
                    errorMessage=error_message,
                    errorCode=error_code,
                    retryInSeconds=delay_seconds,
                    attempt=attempt,
                )
                time.sleep(delay_seconds)
                continue

            failed_targets = [
                *failed_targets,
                {
                    "targetUsername": target_username,
                    "errorCode": error_code,
                    "errorMessage": error_message,
                },
            ]
            self._update_node_state(
                node_id,
                status="failed",
                kind=kind,
                targets=targets,
                currentTargetIndex=current_target_index,
                cursor=cursor,
                attempt=attempt + (1 if retryable else 0),
                scraped=total_scraped,
                deduped=len(merged_users),
                chunksCompleted=chunks_completed,
                targetScraped=target_scraped,
                completedTargets=current_target_index,
                failedTargets=failed_targets,
                lastError=error_message,
                lastErrorCode=error_code,
                artifactStorageId=artifact_storage_id or None,
                resumeSnapshotPath=resume_snapshot_path or None,
                updatedAt=int(time.time() * 1000),
            )
            log(
                f"Ошибка scrape_relationships @{target_username}: "
                f"{error_code or outcome or 'unknown_error'} {error_message or ''}".strip()
            )
            return "failure"

        log(
            f"scrape_relationships: node {node_id} finished with running={self.running} "
            f"currentTargetIndex={current_target_index} targets={len(targets)}"
        )
        return "failure" if not self.running else "success"

    def run(self) -> int:
        emit_event("session_started", total_accounts=len(self.accounts), workflow_id=self.workflow_id)
        if not self.accounts:
            log("Нет профилей для запуска.")
            emit_event("session_ended", status="failed", workflow_id=self.workflow_id)
            return 2

        had_failures = False
        try:
            if self._has_scrape_relationships:
                if len(self.accounts) > 1:
                    log(
                        f"scrape_relationships: queueing {len(self.accounts)} auth profiles "
                        f"with sequential execution"
                    )
                scrape_completed = False
                for index, account in enumerate(self.accounts):
                    if not self.running:
                        break
                    try:
                        if not self.process_account(account):
                            had_failures = True
                    except Exception as e:
                        had_failures = True
                        log(f"Ошибка профиля: {e}")

                    if self._scrape_work_complete():
                        scrape_completed = True
                        remaining = len(self.accounts) - index - 1
                        if remaining > 0:
                            log(
                                f"scrape_relationships: completed with @{account.username}; "
                                f"skipping {remaining} queued profile(s)"
                            )
                        break

                    remaining = len(self.accounts) - index - 1
                    if remaining > 0:
                        log(
                            f"scrape_relationships: @{account.username} finished without completing "
                            f"the scrape node; moving to next queued profile ({remaining} remaining)"
                        )

                if not scrape_completed and self.running:
                    had_failures = True
            else:
                futures = []
                for account in self.accounts:
                    if not self.running:
                        break
                    futures.append(self._executor.submit(self.process_account, account))

                for fut in as_completed(futures):
                    if not self.running:
                        break
                    try:
                        if not fut.result():
                            had_failures = True
                    except Exception as e:
                        had_failures = True
                        log(f"Ошибка профиля: {e}")
        finally:
            try:
                self._executor.shutdown(wait=True)
            except Exception:
                pass
            try:
                self.display_mgr.cleanup_all()
            except Exception:
                pass

        if not self.running:
            status = "cancelled"
            exit_code = 1
        elif had_failures:
            status = "failed"
            exit_code = 1
        else:
            status = "completed"
            exit_code = 0

        emit_event("session_ended", status=status, workflow_id=self.workflow_id)
        return exit_code

    def process_account(self, account: ThreadsAccount) -> bool:
        profile_name = account.username
        proxy_str = account.proxy or "None"

        profile_data: Optional[Dict[str, Any]] = self._get_cached_profile(profile_name)
        try:
            if not profile_data:
                profile_data = self.profiles_client.get_profile_by_name(profile_name)
                if profile_data:
                    self._set_cached_profile(profile_name, profile_data)
        except Exception:
            profile_data = profile_data

        user_agent = None
        fingerprint_seed = None
        fingerprint_os_val = None
        try:
            if profile_data:
                user_agent = profile_data.get("user_agent")
                fingerprint_seed = profile_data.get("fingerprint_seed")
                fingerprint_os_val = profile_data.get("fingerprint_os")
        except Exception:
            user_agent = None

        emit_event("profile_started", profile=profile_name, workflow_id=self.workflow_id)
        display_session: Optional[Dict[str, Any]] = None

        # Mutable browser state – start_browser creates it, close_browser destroys it
        browser_state: Dict[str, Any] = {
            "context": None,
            "page": None,
            "profile_name": profile_name,
            "proxy_str": proxy_str,
            "user_agent": user_agent,
            "fingerprint_seed": fingerprint_seed,
            "fingerprint_os_val": fingerprint_os_val,
            "display": None,
        }

        try:
            try:
                self.profiles_client.sync_profile_status(profile_name, "running", True)
            except Exception:
                pass

            try:
                display_session = self.display_mgr.allocate(self.workflow_id, profile_name)
                if display_session:
                    browser_state["display"] = display_session.get("display")
                    emit_event(
                        "display_allocated",
                        workflow_id=self.workflow_id,
                        profile=profile_name,
                        vnc_port=display_session.get("vnc_port"),
                        display_num=display_session.get("display_num"),
                    )
            except Exception as alloc_err:
                log(f"Display allocation failed for @{profile_name}: {alloc_err}")

            start_node = _find_start_node(self.nodes)
            if not start_node:
                log("Не найден start node")
                return False
            start_id = str(start_node.get("id"))
            current = _next_node(self.edge_index, start_id, "")
            loop_state: Dict[str, int] = {}
            visited_steps = 0

            activity_nodes = [n for n in self.nodes if n.get("type") == "activity"]
            total_steps = max(1, len(activity_nodes))
            completed_steps = 0

            while self.running and current:
                visited_steps += 1
                if visited_steps > 500:
                    log("Превышен лимит шагов workflow")
                    break

                node = self.node_index.get(current)
                if not node:
                    break

                node_type = node.get("type")
                if node_type == "start":
                    current = _next_node(self.edge_index, str(node.get("id")), "")
                    continue

                data = node.get("data") if isinstance(node.get("data"), dict) else {}
                activity_id = str(data.get("activityId") or "")
                label = str(data.get("label") or activity_id or node.get("id") or "")
                config = data.get("config") if isinstance(data.get("config"), dict) else {}

                progress = int(round(100.0 * min(1.0, float(completed_steps) / float(total_steps))))
                self._update_node_state(
                    str(node.get("id")),
                    activityId=activity_id,
                    label=label,
                    status="running",
                    profile=profile_name,
                    progress=progress,
                    updatedAt=int(time.time() * 1000),
                )
                emit_event(
                    "task_started",
                    profile=profile_name,
                    task=label,
                    workflow_id=self.workflow_id,
                    node_id=str(node.get("id")),
                    progress=progress,
                    node_states=self._sanitize_node_states(),
                )

                handle = self._execute_activity(str(node.get("id")), activity_id, config, browser_state, account, profile_data, loop_state)

                if node_type == "activity":
                    completed_steps += 1

                state_status = "failed" if str(handle or "") == "failure" else "completed"
                self._update_node_state(
                    str(node.get("id")),
                    status=state_status,
                    lastHandle=str(handle or ""),
                    updatedAt=int(time.time() * 1000),
                )
                self._emit_node_state(
                    "task_completed",
                    str(node.get("id")),
                    profile_name,
                    task=label,
                    progress=int(round(100.0 * min(1.0, float(completed_steps) / float(total_steps)))),
                    handle=str(handle or ""),
                )

                next_id = _next_node(self.edge_index, str(node.get("id")), str(handle or ""))
                current = next_id
                if self.running and current:
                    time.sleep(random.randint(1, 3))

            if self.running:
                emit_event("profile_completed", profile=profile_name, status="success", workflow_id=self.workflow_id)
            try:
                self.profiles_client.sync_profile_status(profile_name, "idle", False)
            except Exception:
                pass
            return True
        except Exception as e:
            if not self.running:
                emit_event("profile_completed", profile=profile_name, status="cancelled", workflow_id=self.workflow_id)
                try:
                    self.profiles_client.sync_profile_status(profile_name, "idle", False)
                except Exception:
                    pass
                return False

            msg = str(e)
            if "Target page, context or browser has been closed" in msg:
                emit_event("profile_completed", profile=profile_name, status="cancelled", workflow_id=self.workflow_id)
                try:
                    self.profiles_client.sync_profile_status(profile_name, "idle", False)
                except Exception:
                    pass
                log(f"Остановлено @{profile_name}")
                return False

            log(f"Ошибка @{profile_name}: {e}")
            try:
                self.profiles_client.sync_profile_status(profile_name, "idle", False)
            except Exception:
                pass
            return False
        finally:
            # Always clean up browser if still open
            try:
                ctx_mgr = browser_state.get("_ctx_mgr")
                if ctx_mgr:
                    ctx_mgr.__exit__(None, None, None)
            except Exception:
                pass
            try:
                released = self.display_mgr.release(self.workflow_id, profile_name)
                if released:
                    emit_event(
                        "display_released",
                        workflow_id=self.workflow_id,
                        profile=profile_name,
                        vnc_port=released.get("vnc_port"),
                        display_num=released.get("display_num"),
                    )
            except Exception:
                pass

    def _execute_activity(
        self,
        node_id: str,
        activity_id: str,
        cfg: Dict[str, Any],
        browser_state: Dict[str, Any],
        account: ThreadsAccount,
        profile_data: Optional[Dict[str, Any]],
        loop_state: Dict[str, int],
    ) -> str:
        try:
            page = browser_state.get("page")

            if activity_id == "start_browser":
                # Close existing browser if one is already open
                try:
                    old_ctx = browser_state.get("context")
                    if old_ctx:
                        old_ctx.close()
                except Exception:
                    pass
                browser_state["context"] = None
                browser_state["page"] = None

                # Create a new browser context
                headless_cfg = bool(cfg.get("headlessMode", self.headless))
                ctx_mgr = create_browser_context(
                    browser_state["profile_name"],
                    browser_state["proxy_str"],
                    browser_state.get("user_agent"),
                    headless=headless_cfg,
                    fingerprint_seed=browser_state.get("fingerprint_seed"),
                    fingerprint_os=browser_state.get("fingerprint_os_val"),
                    display=browser_state.get("display"),
                )
                # Enter the context manager manually (cleanup in close_browser or finally)
                ctx_page = ctx_mgr.__enter__()
                browser_state["_ctx_mgr"] = ctx_mgr
                browser_state["context"] = ctx_page[0]
                browser_state["page"] = ctx_page[1]
                log("Browser started.")
                return "next"

            if activity_id == "close_browser":
                # Close the browser context
                ctx_mgr = browser_state.get("_ctx_mgr")
                if ctx_mgr:
                    try:
                        ctx_mgr.__exit__(None, None, None)
                    except Exception:
                        pass
                    browser_state["context"] = None
                    browser_state["page"] = None
                    browser_state["_ctx_mgr"] = None
                    log("Browser closed.")
                return "next"

            if activity_id == "select_list":
                # List selection is resolved before workflow starts in main().
                # This node is a pass-through at runtime.
                return "next"

            # --- Non-browser activities (work even without a browser) ---

            if activity_id == "delay":
                min_s = _parse_int(cfg.get("minSeconds"), 30)
                max_s = _parse_int(cfg.get("maxSeconds"), 120)
                min_s = max(1, min_s)
                max_s = max(min_s, max_s)
                time.sleep(random.randint(min_s, max_s))
                return "next"

            if activity_id == "condition":
                check = str(cfg.get("check") or "random").strip().lower()
                value = str(cfg.get("value") or "").strip()
                if check == "random":
                    pct = _parse_int(value, 50)
                    pct = max(0, min(100, pct))
                    return "true" if random.randint(1, 100) <= pct else "false"
                return "true"

            if activity_id == "loop":
                iterations = _parse_int(cfg.get("iterations"), 3)
                iterations = max(1, min(100, iterations))
                key = str(node_id or "loop")
                current_iter = loop_state.get(key, 0) + 1
                loop_state[key] = current_iter
                if current_iter < iterations:
                    return "loop"
                loop_state[key] = 0
                return "done"

            if activity_id == "random_branch":
                handles = ["path_a", "path_b", "path_c"]
                selected = _choose_weighted(handles, str(cfg.get("weights") or ""))
                return selected

            if activity_id == "python_script":
                code_snippet = str(cfg.get("code") or "")
                if not code_snippet.strip():
                    return "success"
                
                exec_globals = {
                    "page": page,
                    "account": account,
                    "profile_data": profile_data,
                    "log": log,
                    "time": time,
                    "random": random,
                    "loop_state": loop_state,
                    "node_id": node_id,
                }
                
                try:
                    exec(code_snippet, exec_globals)
                    return "success"
                except Exception as e:
                    log(f"Ошибка python_script: {e}")
                    return "failure"

            # --- All activities below require an open browser ---
            if page is None:
                log(f"No browser open for activity {activity_id} – auto-starting browser.")
                try:
                    headless_cfg = bool(cfg.get("headlessMode", self.headless))
                    ctx_mgr = create_browser_context(
                        browser_state["profile_name"],
                        browser_state["proxy_str"],
                        browser_state.get("user_agent"),
                        headless=headless_cfg,
                        fingerprint_seed=browser_state.get("fingerprint_seed"),
                        fingerprint_os=browser_state.get("fingerprint_os_val"),
                        display=browser_state.get("display"),
                    )
                    ctx_page = ctx_mgr.__enter__()
                    browser_state["_ctx_mgr"] = ctx_mgr
                    browser_state["context"] = ctx_page[0]
                    browser_state["page"] = ctx_page[1]
                    page = browser_state["page"]
                    log("Browser auto-started.")
                except Exception as e:
                    log(f"Failed to auto-start browser: {e}")
                    return "failure"

            if activity_id == "scrape_relationships":
                return self._execute_scrape_relationships(
                    node_id,
                    cfg,
                    page,
                    browser_state["profile_name"],
                    profile_data,
                )

            if activity_id == "browse_feed":
                min_t = _parse_int(cfg.get("feed_min_time_minutes"), 1)
                max_t = _parse_int(cfg.get("feed_max_time_minutes"), 3)
                min_t, max_t = normalize_range((min_t, max_t), (1, 3))
                duration = random.randint(min_t, max_t)
                config = {
                    "like_chance": _parse_int(cfg.get("like_chance"), 10),
                    "comment_chance": 0,
                    "follow_chance": _parse_int(cfg.get("follow_chance"), 0),
                    "carousel_watch_chance": _parse_int(cfg.get("carousel_watch_chance"), 0),
                    "carousel_max_slides": _parse_int(cfg.get("carousel_max_slides"), 3),
                    "watch_stories": _parse_bool(cfg.get("watch_stories"), False),
                    "stories_max": _parse_int(cfg.get("stories_max"), 3),
                    "stories_min_view_seconds": _parse_float(cfg.get("stories_min_view_seconds"), 2.0),
                    "stories_max_view_seconds": _parse_float(cfg.get("stories_max_view_seconds"), 5.0),
                    "skip_post_chance": _parse_int(cfg.get("skip_post_chance"), 30),
                    "skip_post_max": _parse_int(cfg.get("skip_post_max"), 2),
                    "post_view_min_seconds": _parse_float(cfg.get("post_view_min_seconds"), 2.0),
                    "post_view_max_seconds": _parse_float(cfg.get("post_view_max_seconds"), 5.0),
                }
                scroll_feed(page, duration, config, should_stop=lambda: not self.running)
                return "success"

            if activity_id == "browse_reels":
                min_t = _parse_int(cfg.get("reels_min_time_minutes"), 1)
                max_t = _parse_int(cfg.get("reels_max_time_minutes"), 3)
                min_t, max_t = normalize_range((min_t, max_t), (1, 3))
                duration = random.randint(min_t, max_t)
                config = {
                    "like_chance": _parse_int(cfg.get("reels_like_chance"), 10),
                    "comment_chance": 0,
                    "follow_chance": _parse_int(cfg.get("reels_follow_chance"), 0),
                    "reels_skip_chance": _parse_int(cfg.get("reels_skip_chance"), 30),
                    "reels_skip_min_time": _parse_float(cfg.get("reels_skip_min_time"), 0.8),
                    "reels_skip_max_time": _parse_float(cfg.get("reels_skip_max_time"), 2.0),
                    "reels_normal_min_time": _parse_float(cfg.get("reels_normal_min_time"), 5.0),
                    "reels_normal_max_time": _parse_float(cfg.get("reels_normal_max_time"), 20.0),
                    "reels_advance_min_seconds": _parse_float(cfg.get("reels_advance_min_seconds"), 1.5),
                    "reels_advance_max_seconds": _parse_float(cfg.get("reels_advance_max_seconds"), 3.0),
                }
                scroll_reels(page, duration, config, should_stop=lambda: not self.running)
                return "success"

            if activity_id == "watch_stories":
                max_stories = _parse_int(cfg.get("stories_max"), 3)
                watch_stories(
                    page,
                    max_stories=max_stories,
                    min_view_s=_parse_float(cfg.get("stories_min_view_seconds"), 2.0),
                    max_view_s=_parse_float(cfg.get("stories_max_view_seconds"), 5.0),
                    log=log,
                )
                return "success"

            if activity_id == "follow_user":
                profile_id = profile_data.get("profile_id") if profile_data else None
                if not profile_id:
                    profiles = self.accounts_client.get_profiles_with_assigned_accounts()
                    fallback = next((p for p in profiles if p.get("name") == account.username), None)
                    profile_id = fallback.get("profile_id") if fallback else None
                if not profile_id:
                    return "failure"
                accounts = self.accounts_client.get_accounts_for_profile(profile_id)
                usernames = [acc.get("user_name") for acc in accounts if acc.get("user_name")]
                account_map = {acc["user_name"]: acc["id"] for acc in accounts if acc.get("id") and acc.get("user_name")}
                if not usernames:
                    return "failure"
                follow_min = _parse_int(cfg.get("follow_min_count"), 5)
                follow_max = _parse_int(cfg.get("follow_max_count"), 15)
                follow_min, follow_max = normalize_range((follow_min, follow_max), (5, 15))
                usernames = apply_count_limit(usernames, (follow_min, follow_max))
                follow_delay_min = _parse_int(cfg.get("follow_min_delay_seconds"), 10)
                follow_delay_max = _parse_int(cfg.get("follow_max_delay_seconds"), 20)
                follow_delay_min, follow_delay_max = normalize_range((follow_delay_min, follow_delay_max), (10, 20))
                highlights_min = _parse_int(cfg.get("highlights_min"), 0)
                highlights_max = _parse_int(cfg.get("highlights_max"), 2)
                highlights_min, highlights_max = normalize_range((highlights_min, highlights_max), (0, 2))
                interactions_config = {
                    "highlights_range": (highlights_min, highlights_max),
                    "likes_percentage": _parse_int(cfg.get("likes_percentage"), 0),
                    "scroll_percentage": _parse_int(cfg.get("scroll_percentage"), 0),
                    "following_limit": _parse_int(cfg.get("following_limit"), 3000),
                }
                follow_usernames(
                    profile_name=account.username,
                    proxy_string=account.proxy or "",
                    usernames=usernames,
                    account_map=account_map,
                    interactions_config=interactions_config,
                    log=log,
                    should_stop=lambda: not self.running,
                    page=page,
                    delay_range=(follow_delay_min, follow_delay_max),
                )
                return "success"

            if activity_id == "unfollow_user":
                unfollow_min_delay = _parse_int(cfg.get("min_delay"), 10)
                unfollow_max_delay = _parse_int(cfg.get("max_delay"), 30)
                unfollow_min_delay, unfollow_max_delay = normalize_range((unfollow_min_delay, unfollow_max_delay), (10, 30))

                profile_id = profile_data.get("profile_id") if profile_data else None
                if not profile_id:
                    profiles = self.accounts_client.get_profiles_with_assigned_accounts()
                    fallback = next((p for p in profiles if p.get("name") == account.username), None)
                    profile_id = fallback.get("profile_id") if fallback else None
                if not profile_id:
                    return "failure"

                accounts = self.accounts_client.get_accounts_for_profile(profile_id, status="unsubscribed")
                usernames = [acc.get("user_name") for acc in accounts if acc.get("user_name")]
                account_map = {acc["user_name"]: acc["id"] for acc in accounts if acc.get("id") and acc.get("user_name")}
                if not usernames:
                    return "failure"

                unfollow_min_count = _parse_int(cfg.get("unfollow_min_count"), 5)
                unfollow_max_count = _parse_int(cfg.get("unfollow_max_count"), 15)
                unfollow_min_count, unfollow_max_count = normalize_range((unfollow_min_count, unfollow_max_count), (5, 15))
                usernames = apply_count_limit(usernames, (unfollow_min_count, unfollow_max_count))

                def _on_unfollow_success(uname: str):
                    aid = account_map.get(uname)
                    if aid:
                        try:
                            self.accounts_client.update_account_status(aid, status="done")
                        except Exception:
                            pass

                unfollow_usernames(
                    profile_name=account.username,
                    proxy_string=account.proxy or "",
                    usernames=usernames,
                    log=log,
                    should_stop=lambda: not self.running,
                    delay_range=(unfollow_min_delay, unfollow_max_delay),
                    on_success=_on_unfollow_success,
                    page=page,
                )
                return "success"

            if activity_id == "approve_requests":
                approve_min_delay = _parse_float(cfg.get("approve_min_delay_seconds"), 1.0)
                approve_max_delay = _parse_float(cfg.get("approve_max_delay_seconds"), 2.0)
                if approve_max_delay < approve_min_delay:
                    approve_min_delay, approve_max_delay = approve_max_delay, approve_min_delay
                approve_follow_requests(
                    profile_name=account.username,
                    proxy_string=account.proxy or "",
                    log=log,
                    should_stop=lambda: not self.running,
                    page=page,
                    approve_delay_range=(approve_min_delay, approve_max_delay),
                    finish_delay_seconds=_parse_float(cfg.get("approve_finish_delay_seconds"), 3.0),
                )
                return "success"

            if activity_id == "send_dm":
                template_kind = str(cfg.get("template_kind") or "message").strip() or "message"
                try:
                    message_texts = MessageTemplatesClient().get_texts(template_kind) or []
                except Exception:
                    message_texts = []
                if not message_texts:
                    message_texts = ["Hi!"]

                profile_id = profile_data.get("profile_id") if profile_data else None
                if not profile_id:
                    profiles = self.accounts_client.get_profiles_with_assigned_accounts()
                    fallback = next((p for p in profiles if p.get("name") == account.username), None)
                    profile_id = fallback.get("profile_id") if fallback else None
                if not profile_id:
                    return "failure"
                cooldown_hours = self.messaging_cooldown_hours if self.messaging_cooldown_enabled else 0
                targets = self.accounts_client.get_accounts_to_message(profile_id, cooldown_hours=cooldown_hours)
                if not targets:
                    return "failure"
                send_messages(
                    profile_name=account.username,
                    proxy_string=account.proxy or "",
                    targets=targets,
                    message_texts=message_texts,
                    log=log,
                    should_stop=lambda: not self.running,
                    page=page,
                    behavior_config={
                        "follow_if_no_message_button": _parse_bool(cfg.get("follow_if_no_message_button"), True),
                        "navigation_delay_min_seconds": _parse_float(cfg.get("navigation_delay_min_seconds"), 2.0),
                        "navigation_delay_max_seconds": _parse_float(cfg.get("navigation_delay_max_seconds"), 3.0),
                        "composer_delay_min_seconds": _parse_float(cfg.get("composer_delay_min_seconds"), 1.0),
                        "composer_delay_max_seconds": _parse_float(cfg.get("composer_delay_max_seconds"), 2.0),
                        "typing_delay_min_ms": _parse_int(cfg.get("typing_delay_min_ms"), 100),
                        "typing_delay_max_ms": _parse_int(cfg.get("typing_delay_max_ms"), 200),
                        "between_targets_min_seconds": _parse_float(cfg.get("between_targets_min_seconds"), 3.0),
                        "between_targets_max_seconds": _parse_float(cfg.get("between_targets_max_seconds"), 5.0),
                    },
                )
                return "success"

            return "success"
        except Exception as e:
            log(f"Ошибка activity {activity_id}: {e}")
            return "failure"


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        log("Не получены входные данные.")
        return 2
    try:
        payload = json.loads(raw)
    except Exception as e:
        log(f"Некорректный JSON: {e}")
        return 2

    if not isinstance(payload, dict):
        log("payload должен быть объектом")
        return 2

    workflow_id = str(payload.get("workflowId") or payload.get("workflow_id") or "").strip()
    workflow = payload.get("workflow") if isinstance(payload.get("workflow"), dict) else None
    if not workflow_id or not workflow:
        log("workflowId и workflow обязательны")
        return 2

    nodes = workflow.get("nodes") if isinstance(workflow.get("nodes"), list) else []
    edges = workflow.get("edges") if isinstance(workflow.get("edges"), list) else []
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    has_scrape_relationships = _workflow_has_activity(nodes, "scrape_relationships")

    # --- Extract config from new modular nodes ---
    # Look for select_list node(s) to get sourceLists
    start_node = _find_start_node(nodes)
    start_data = start_node.get("data") if start_node and isinstance(start_node.get("data"), dict) else {}

    list_ids: List[str] = []

    for n in nodes:
        n_data = n.get("data") if isinstance(n.get("data"), dict) else {}
        n_activity = str(n_data.get("activityId") or "")
        n_config = n_data.get("config") if isinstance(n_data.get("config"), dict) else {}
        if n_activity == "select_list":
            src = n_config.get("sourceLists") or []
            if isinstance(src, list):
                list_ids.extend([str(x) for x in src if str(x).strip()])

    # Fallback: also check old-style start node data (backwards compat)
    if not list_ids:
        old_lists = start_data.get("sourceLists") or []
        if isinstance(old_lists, list):
            list_ids = [str(x) for x in old_lists if str(x).strip()]

    start_settings = _extract_start_browser_settings(nodes, start_data)

    if has_scrape_relationships and not _workflow_has_activity(nodes, "start_browser"):
        log("scrape_relationships requires a Start Browser node in the workflow")
        emit_event("session_ended", status="failed", workflow_id=workflow_id)
        return 2

    if not list_ids:
        log("Выберите список профилей!")
        emit_event("session_ended", status="failed", workflow_id=workflow_id)
        return 2

    profile_cooldown_enabled = _parse_bool(start_settings.get("profile_reopen_cooldown_enabled"), True)
    profile_cooldown_minutes = max(0, _parse_int(start_settings.get("profile_reopen_cooldown_minutes"), 30))
    profiles = _fetch_profiles_for_lists(
        list_ids,
        cooldown_minutes=profile_cooldown_minutes,
        enforce_cooldown=profile_cooldown_enabled,
    )
    if has_scrape_relationships:
        eligible_profiles = [
            profile
            for profile in profiles
            if _profile_remaining_daily_scraping_capacity(profile) != 0
        ]
        skipped_profiles = len(profiles) - len(eligible_profiles)
        if skipped_profiles > 0:
            log(
                f"scrape_relationships: skipped {skipped_profiles} profile(s) with exhausted "
                f"daily scraping limits"
            )
        profiles = eligible_profiles
    if not profiles:
        log("В выбранном списке нет профилей!")
        emit_event("session_ended", status="failed", workflow_id=workflow_id)
        return 2

    accounts: List[ThreadsAccount] = []
    for p in profiles:
        name = p.get("name")
        if not name:
            continue
        accounts.append(ThreadsAccount(username=name, password="", proxy=p.get("proxy")))

    if not accounts:
        log("В выбранном списке нет валидных профилей!")
        emit_event("session_ended", status="failed", workflow_id=workflow_id)
        return 2

    options = {
        **start_settings,
        **options,
        "workflow_name": workflow.get("name"),
    }
    runner = WorkflowRunner(workflow_id, nodes, edges, accounts, options)
    atexit.register(DisplayManager.cleanup_owner_sessions, os.getpid())

    def _handle_signal(_sig, _frame):
        runner.stop()

    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_signal)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _handle_signal)

    return runner.run()


if __name__ == "__main__":
    raise SystemExit(main())
