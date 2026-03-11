import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from modules.diagnostics import mask_session_id, summarize_proxy
from modules.http_client import AsyncHttpClientPool
from modules.instagram_shared import InstagramScraperService
from modules.proxy_utils import normalize_proxy


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s [%(name)s] %(message)s',
)
logger = logging.getLogger(__name__)


class ScrapeRequest(BaseModel):
    auth_username: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    target_username: str = Field(min_length=1)
    cursor: Optional[str] = None
    chunk_limit: int = Field(default=200, ge=1, le=5000)
    max_pages: int = Field(default=10, ge=1, le=100)
    proxy: Optional[str] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    client_pool = AsyncHttpClientPool()
    app.state.scraper_service = InstagramScraperService(client_pool)
    try:
        yield
    finally:
        await app.state.scraper_service.aclose()


app = FastAPI(title='Instagram Scraper API', version='2.0.0', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


def get_service(request: Request) -> InstagramScraperService:
    return request.app.state.scraper_service


@app.get('/health')
async def health():
    return {'status': 'ok'}


async def run_scrape(kind: str, req: ScrapeRequest, request: Request):
    auth_username = req.auth_username.strip()
    session_id = req.session_id.strip()
    target_username = req.target_username.strip()
    cursor = req.cursor.strip() if isinstance(req.cursor, str) and req.cursor.strip() else None
    proxy = normalize_proxy(req.proxy)

    logger.info(
        '%s scrape request auth_username=%s target_username=%s chunk_limit=%s max_pages=%s cursor_present=%s proxy=%s session=%s',
        kind,
        auth_username,
        target_username,
        int(req.chunk_limit),
        int(req.max_pages),
        bool(cursor),
        summarize_proxy(proxy),
        mask_session_id(session_id),
    )

    service = get_service(request)
    result = await service.scrape_chunk(
        kind=kind,
        auth_username=auth_username,
        session_id=session_id,
        target_username=target_username,
        cursor=cursor,
        chunk_limit=int(req.chunk_limit),
        max_pages=int(req.max_pages),
        proxy=proxy,
    )

    logger.info(
        '%s scrape response auth_username=%s target_username=%s outcome=%s scraped=%s has_more=%s next_cursor_present=%s error_code=%s',
        kind,
        auth_username,
        target_username,
        result.outcome,
        result.scraped,
        result.has_more,
        bool(result.next_cursor),
        result.error_code,
    )
    return result.to_api_dict()


@app.post('/scrape/followers')
async def scrape_followers(req: ScrapeRequest, request: Request):
    return await run_scrape('followers', req, request)


@app.post('/scrape/following')
async def scrape_following(req: ScrapeRequest, request: Request):
    return await run_scrape('following', req, request)
