from typing import Optional, Dict, Any, List
from urllib.parse import quote

from python.internal_systems.error_handling.http_client import ResilientHttpClient
from python.database_sync.config import PROJECT_URL, SECRET_KEY


class MessageTemplatesError(Exception):
    pass


class MessageTemplatesClient:
    def __init__(self):
        if not PROJECT_URL:
            raise MessageTemplatesError(
                "Convex config missing. Set CONVEX_URL in environment."
            )
        self.base_url = f"{PROJECT_URL}/api/message-templates"
        self.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if SECRET_KEY:
            self.headers["Authorization"] = f"Bearer {SECRET_KEY}"
        self.http_client = ResilientHttpClient()
        self.timeout = 20

    def _request(
        self,
        method: str,
        url: str,
        *,
        data: Optional[Dict] = None,
        params: Optional[Dict] = None,
    ):
        try:
            if method.upper() == "GET":
                resp = self.http_client.get(
                    url, headers=self.headers, params=params, timeout=self.timeout
                )
            elif method.upper() == "POST":
                resp = self.http_client.post(
                    url, headers=self.headers, json=data, timeout=self.timeout
                )
            else:
                raise MessageTemplatesError("Unsupported HTTP method")
            if resp.status_code >= 400:
                raise MessageTemplatesError(f"HTTP {resp.status_code}: {resp.text}")
            return resp.json() if resp.content else None
        except Exception as exc:
            raise MessageTemplatesError(f"Request failed: {exc}")

    def get_texts(self, kind: str) -> List[str]:
        url = f"{self.base_url}?kind={quote(kind)}"
        data = self._request("GET", url)
        if isinstance(data, list):
            return [str(t) for t in data if str(t).strip()]
        return []

    def upsert_texts(self, kind: str, texts: List[str]) -> Optional[Dict[str, Any]]:
        payload = {"kind": kind, "texts": texts}
        data = self._request("POST", self.base_url, data=payload)
        return data if isinstance(data, dict) else None

