import asyncio
from typing import Optional

import httpx


DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=15.0)
DEFAULT_LIMITS = httpx.Limits(max_connections=20, max_keepalive_connections=10)


class AsyncHttpClientPool:
    def __init__(
        self,
        *,
        timeout: httpx.Timeout | None = None,
        limits: httpx.Limits | None = None,
    ) -> None:
        self._timeout = timeout or DEFAULT_TIMEOUT
        self._limits = limits or DEFAULT_LIMITS
        self._clients: dict[str, httpx.AsyncClient] = {}
        self._lock = asyncio.Lock()

    async def get_client(self, proxy: Optional[str] = None) -> httpx.AsyncClient:
        key = proxy or '__direct__'
        async with self._lock:
            client = self._clients.get(key)
            if client is None:
                client = httpx.AsyncClient(
                    follow_redirects=True,
                    timeout=self._timeout,
                    limits=self._limits,
                    proxy=proxy,
                )
                self._clients[key] = client
            return client

    async def request(self, method: str, url: str, *, proxy: Optional[str] = None, **kwargs) -> httpx.Response:
        client = await self.get_client(proxy)
        return await client.request(method, url, **kwargs)

    async def aclose(self) -> None:
        async with self._lock:
            clients = list(self._clients.values())
            self._clients.clear()
        for client in clients:
            await client.aclose()
