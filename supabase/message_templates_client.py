import requests
from typing import Optional, Dict, Any, List
from supabase.config import PROJECT_URL, SECRET_KEY


class MessageTemplatesError(Exception):
    pass


class MessageTemplatesClient:
    def __init__(self):
        if not PROJECT_URL or not SECRET_KEY:
            raise MessageTemplatesError("Supabase config missing")
        self.base_url = f"{PROJECT_URL}/rest/v1/message_templates"
        self.headers = {
            "apikey": SECRET_KEY,
            "Authorization": f"Bearer {SECRET_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        self.timeout = 20

    def _request(self, method: str, url: str, *, data: Optional[Dict] = None, params: Optional[Dict] = None):
        try:
            if method.upper() == "GET":
                resp = requests.get(url, headers=self.headers, params=params, timeout=self.timeout)
            elif method.upper() == "POST":
                resp = requests.post(url, headers=self.headers, json=data, timeout=self.timeout)
            elif method.upper() == "PATCH":
                resp = requests.patch(url, headers=self.headers, json=data, timeout=self.timeout)
            else:
                raise MessageTemplatesError("Unsupported HTTP method")
            if resp.status_code >= 400:
                raise MessageTemplatesError(f"HTTP {resp.status_code}: {resp.text}")
            return resp.json() if resp.content else None
        except requests.RequestException as exc:
            raise MessageTemplatesError(f"Request failed: {exc}")

    def get_texts(self, kind: str) -> List[str]:
        rows = self._request("GET", self.base_url, params={"select": "texts", "kind": f"eq.{kind}", "limit": 1}) or []
        if not rows:
            return []
        texts = rows[0].get("texts")
        if isinstance(texts, list):
            return [str(t) for t in texts if str(t).strip()]
        return []

    def upsert_texts(self, kind: str, texts: List[str]) -> Optional[Dict[str, Any]]:
        existing = self._request("GET", self.base_url, params={"select": "id", "kind": f"eq.{kind}", "limit": 1}) or []
        payload = {"texts": texts}
        if existing:
            result = self._request("PATCH", f"{self.base_url}?kind=eq.{kind}", data=payload) or []
            return result[0] if result else None
        result = self._request("POST", self.base_url, data={"kind": kind, **payload}) or []
        return result[0] if result else None

