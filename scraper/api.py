import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

from modules import Get_Followers, Get_Following, Sessions_Manager
from modules.diagnostics import mask_session_id, summarize_proxy


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s [%(name)s] %(message)s',
)
logger = logging.getLogger(__name__)


app = FastAPI(title="Instagram Scraper API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def convert_proxy_format(proxy: Optional[str]) -> Optional[str]:
    """
    Convert proxy from host:port:user:pass format to user:pass@host:port format.
    Also handles already-converted proxies and simple host:port format.
    """
    if not proxy:
        return None
    
    proxy = proxy.strip()
    if not proxy:
        return None
    
    # Extract scheme if present
    scheme = "http"
    if proxy.startswith("http://"):
        scheme = "http"
        proxy = proxy[7:]
    elif proxy.startswith("https://"):
        scheme = "https"
        proxy = proxy[8:]
    elif proxy.startswith("socks5://"):
        scheme = "socks5"
        proxy = proxy[9:]
    
    # If already in user:pass@host:port format, return as-is
    if "@" in proxy:
        return f"{scheme}://{proxy}"
    
    parts = proxy.split(":")
    
    if len(parts) == 2:
        # host:port format (no auth)
        return f"{scheme}://{proxy}"
    elif len(parts) == 4:
        # host:port:user:pass format -> convert to user:pass@host:port
        host, port, user, password = parts
        return f"{scheme}://{user}:{password}@{host}:{port}"
    elif len(parts) >= 4:
        # Handle case where password might contain colons
        host = parts[0]
        port = parts[1]
        user = parts[2]
        password = ":".join(parts[3:])
        return f"{scheme}://{user}:{password}@{host}:{port}"
    else:
        # Unknown format, return as-is with scheme
        return f"{scheme}://{proxy}"


class FollowersScrapeRequest(BaseModel):
    auth_username: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    target_username: str = Field(min_length=1)
    cursor: Optional[str] = None
    chunk_limit: int = Field(default=200, ge=1, le=5000)
    max_pages: int = Field(default=10, ge=1, le=100)
    proxy: Optional[str] = None


class FollowingScrapeRequest(BaseModel):
    auth_username: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    target_username: str = Field(min_length=1)
    cursor: Optional[str] = None
    chunk_limit: int = Field(default=200, ge=1, le=5000)
    max_pages: int = Field(default=10, ge=1, le=100)
    proxy: Optional[str] = None


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/scrape/followers")
async def scrape_followers(req: FollowersScrapeRequest):
    auth_username = req.auth_username.strip()
    session_id = req.session_id.strip()
    target_username = req.target_username.strip()
    cursor = req.cursor.strip() if isinstance(req.cursor, str) and req.cursor.strip() else None
    proxy = convert_proxy_format(req.proxy)

    logger.info(
        "followers scrape request auth_username=%s target_username=%s chunk_limit=%s max_pages=%s cursor_present=%s proxy=%s session=%s",
        auth_username,
        target_username,
        int(req.chunk_limit),
        int(req.max_pages),
        bool(cursor),
        summarize_proxy(proxy),
        mask_session_id(session_id),
    )

    ok, message = Sessions_Manager.verify_session(auth_username, session_id)
    if not ok:
        logger.warning(
            "followers session verification failed auth_username=%s target_username=%s message=%s session=%s",
            auth_username,
            target_username,
            message,
            mask_session_id(session_id),
        )
        if message != "Failed to get test user ID":
            raise HTTPException(status_code=401, detail=message)
        logger.warning(
            "followers scrape continuing despite unresolved verification probe auth_username=%s target_username=%s",
            auth_username,
            target_username,
        )

    user_id, followers_count = Get_Followers.get_userid(target_username, proxy=proxy)
    if not user_id:
        logger.error(
            "followers target resolution failed auth_username=%s target_username=%s proxy=%s",
            auth_username,
            target_username,
            summarize_proxy(proxy),
        )
        raise HTTPException(status_code=404, detail="Failed to resolve target user id")

    logger.info(
        "followers target resolved auth_username=%s target_username=%s user_id=%s total_followers=%s",
        auth_username,
        target_username,
        user_id,
        followers_count,
    )

    users, next_cursor, has_more = Get_Followers.get_data_chunk(
        user_id=user_id,
        username=target_username,
        session_id=session_id,
        cursor=cursor,
        chunk_limit=int(req.chunk_limit),
        max_pages=int(req.max_pages),
        proxy=proxy,
    )

    logger.info(
        "followers scrape response auth_username=%s target_username=%s scraped=%s has_more=%s next_cursor_present=%s",
        auth_username,
        target_username,
        len(users or []),
        bool(has_more),
        bool(next_cursor),
    )

    return {
        "targetUsername": target_username,
        "scraped": len(users or []),
        "chunkLimit": int(req.chunk_limit),
        "cursor": cursor,
        "nextCursor": next_cursor,
        "hasMore": bool(has_more),
        "total": int(followers_count or 0) if followers_count is not None else None,
        "users": users or [],
    }


@app.post("/scrape/following")
async def scrape_following(req: FollowingScrapeRequest):
    auth_username = req.auth_username.strip()
    session_id = req.session_id.strip()
    target_username = req.target_username.strip()
    cursor = req.cursor.strip() if isinstance(req.cursor, str) and req.cursor.strip() else None
    proxy = convert_proxy_format(req.proxy)

    logger.info(
        "following scrape request auth_username=%s target_username=%s chunk_limit=%s max_pages=%s cursor_present=%s proxy=%s session=%s",
        auth_username,
        target_username,
        int(req.chunk_limit),
        int(req.max_pages),
        bool(cursor),
        summarize_proxy(proxy),
        mask_session_id(session_id),
    )

    ok, message = Sessions_Manager.verify_session(auth_username, session_id)
    if not ok:
        logger.warning(
            "following session verification failed auth_username=%s target_username=%s message=%s session=%s",
            auth_username,
            target_username,
            message,
            mask_session_id(session_id),
        )
        if message != "Failed to get test user ID":
            raise HTTPException(status_code=401, detail=message)
        logger.warning(
            "following scrape continuing despite unresolved verification probe auth_username=%s target_username=%s",
            auth_username,
            target_username,
        )

    user_id, following_count = Get_Following.get_userid(target_username, proxy=proxy)
    if not user_id:
        logger.error(
            "following target resolution failed auth_username=%s target_username=%s proxy=%s",
            auth_username,
            target_username,
            summarize_proxy(proxy),
        )
        raise HTTPException(status_code=404, detail="Failed to resolve target user id")

    logger.info(
        "following target resolved auth_username=%s target_username=%s user_id=%s total_following=%s",
        auth_username,
        target_username,
        user_id,
        following_count,
    )

    users, next_cursor, has_more = Get_Following.get_data_chunk(
        user_id=user_id,
        username=target_username,
        session_id=session_id,
        cursor=cursor,
        chunk_limit=int(req.chunk_limit),
        max_pages=int(req.max_pages),
        proxy=proxy,
    )

    logger.info(
        "following scrape response auth_username=%s target_username=%s scraped=%s has_more=%s next_cursor_present=%s",
        auth_username,
        target_username,
        len(users or []),
        bool(has_more),
        bool(next_cursor),
    )

    return {
        "targetUsername": target_username,
        "scraped": len(users or []),
        "chunkLimit": int(req.chunk_limit),
        "cursor": cursor,
        "nextCursor": next_cursor,
        "hasMore": bool(has_more),
        "total": int(following_count or 0) if following_count is not None else None,
        "users": users or [],
    }
