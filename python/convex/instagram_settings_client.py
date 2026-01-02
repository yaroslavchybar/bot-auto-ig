import datetime
from typing import Optional, Dict, Any

import requests

from python.convex.config import PROJECT_URL, SECRET_KEY


class InstagramSettingsError(Exception):
    """Raised when Supabase instagram_settings API call fails."""


class InstagramSettingsClient:
    """Client for managing instagram_settings table storing settings as JSONB."""

    def __init__(self):
        if not PROJECT_URL or not SECRET_KEY:
            raise InstagramSettingsError(
                "Convex config missing. Set CONVEX_URL and CONVEX_API_KEY in environment."
            )

        self.base_url = f"{PROJECT_URL}/api/instagram-settings"
        self.headers = {
            "Authorization": f"Bearer {SECRET_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
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
        data = self._request("GET", self.base_url, params={"scope": scope})
        return data if isinstance(data, dict) else None

    def upsert_settings(self, data: Dict[str, Any], scope: str = "global") -> Optional[Dict]:
        """
        Insert or update settings for given scope.
        Upserts using Convex mutation via HTTP.
        """
        payload = {"scope": scope, "data": data}
        result = self._request("POST", self.base_url, data=payload)
        return result if isinstance(result, dict) else None

