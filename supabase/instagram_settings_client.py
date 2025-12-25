import datetime
from typing import Optional, Dict, Any

import requests

from supabase.config import PROJECT_URL, SECRET_KEY


class InstagramSettingsError(Exception):
    """Raised when Supabase instagram_settings API call fails."""


class InstagramSettingsClient:
    """Client for managing instagram_settings table storing settings as JSONB."""

    def __init__(self):
        if not PROJECT_URL or not SECRET_KEY:
            raise InstagramSettingsError(
                "Supabase config missing. Set SUPABASE_URL and SUPABASE_SECRET_KEY in environment."
            )

        self.base_url = f"{PROJECT_URL}/rest/v1/instagram_settings"
        self.headers = {
            "apikey": SECRET_KEY,
            "Authorization": f"Bearer {SECRET_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
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
                resp = requests.get(url, headers=self.headers, params=params, timeout=self.timeout)
            elif method.upper() == "POST":
                resp = requests.post(url, headers=self.headers, json=data, timeout=self.timeout)
            elif method.upper() == "PATCH":
                resp = requests.patch(url, headers=self.headers, json=data, timeout=self.timeout)
            else:
                raise InstagramSettingsError(f"Unsupported HTTP method: {method}")

            if resp.status_code >= 400:
                raise InstagramSettingsError(f"HTTP {resp.status_code}: {resp.text}")

            return resp.json() if resp.content else None
        except requests.RequestException as exc:
            raise InstagramSettingsError(f"Request failed: {exc}")

    def get_settings(self, scope: str = "global") -> Optional[Dict[str, Any]]:
        """
        Fetch settings JSON for given scope (default: 'global').
        Returns the 'data' field (dict) or None if not found.
        """
        params = {
            "select": "data",
            "scope": f"eq.{scope}",
            "limit": 1,
        }
        rows = self._request("GET", self.base_url, params=params) or []
        if not rows:
            return None
        return rows[0].get("data") or None

    def upsert_settings(self, data: Dict[str, Any], scope: str = "global") -> Optional[Dict]:
        """
        Insert or update settings for given scope.
        If a row exists, PATCH it; otherwise, POST a new row.
        """
        # Check existing
        existing = self._request(
            "GET",
            self.base_url,
            params={"select": "id", "scope": f"eq.{scope}", "limit": 1},
        ) or []
        payload = {
            "data": data,
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        if existing:
            return (self._request("PATCH", f"{self.base_url}?scope=eq.{scope}", data=payload) or [None])[0]
        else:
            payload["scope"] = scope
            return (self._request("POST", self.base_url, data=payload) or [None])[0]

