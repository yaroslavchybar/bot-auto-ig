import requests
from datetime import datetime, timezone
from datetime import timedelta
from typing import List, Dict, Optional
import logging
from .config import PROJECT_URL, SECRET_KEY
from python.internal_systems.error_handling.http_client import ResilientHttpClient

logger = logging.getLogger(__name__)

class ProfilesError(Exception):
    """Raised when profiles API call fails."""

class ProfilesClient:
    """Client for managing profiles via Convex API"""

    def __init__(self):
        if not PROJECT_URL:
            raise ProfilesError(
                "Convex config missing. Set CONVEX_URL in environment."
            )

        self.base_url = f"{PROJECT_URL}/api/profiles"
        self.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if SECRET_KEY:
            self.headers["Authorization"] = f"Bearer {SECRET_KEY}"
        self.http_client = ResilientHttpClient()
        self.timeout = (10, 60)

    def _make_request(self, method: str, endpoint: str = "", data: Optional[Dict] = None, params: Optional[Dict] = None):
        """Make HTTP request to Convex API"""
        url = f"{self.base_url}{endpoint}"

        try:
            if method.upper() == "GET":
                resp = self.http_client.get(url, headers=self.headers, params=params, timeout=self.timeout)
            elif method.upper() == "POST":
                resp = self.http_client.post(url, headers=self.headers, json=data, timeout=self.timeout)
            elif method.upper() == "PATCH":
                resp = self.http_client.patch(url, headers=self.headers, json=data, timeout=self.timeout)
            elif method.upper() == "DELETE":
                resp = self.http_client.delete(url, headers=self.headers, timeout=self.timeout)
            else:
                raise ProfilesError(f"Unsupported HTTP method: {method}")

            if resp.status_code >= 400:
                raise ProfilesError(f"HTTP {resp.status_code}: {resp.text}")

            return resp.json() if resp.content else None

        except Exception as e:
            raise ProfilesError(f"Request failed: {e}")

    def get_all_profiles(self) -> List[Dict]:
        """Fetch all profiles from database"""
        return self._make_request("GET") or []

    def get_available_profiles(
        self, list_ids: List[str], max_sessions: int, cooldown_minutes: int
    ) -> List[Dict]:
        if not list_ids:
            return []
        clean_ids = [str(lid).strip().replace('"', "") for lid in list_ids if str(lid).strip()]
        if not clean_ids:
            return []
        payload = {
            "list_ids": clean_ids,
            "max_sessions": int(max_sessions),
            "cooldown_minutes": int(cooldown_minutes),
        }
        return self._make_request("POST", "/available", data=payload) or []

    def get_profile_by_name(self, name: str) -> Optional[Dict]:
        """Fetch a single profile by name."""
        try:
            resp = self._make_request("GET", "/by-name", params={"name": name})
            return resp if isinstance(resp, dict) else None
        except Exception:
            return None

    def create_profile(self, profile_data: Dict) -> Dict:
        """Create new profile in database"""
        db_data = dict(profile_data or {})
        result = self._make_request("POST", data=db_data)
        return result if isinstance(result, dict) else None

    def update_profile(self, profile_id: str, profile_data: Dict) -> Dict:
        """Update existing profile in database"""
        db_data = dict(profile_data or {})
        db_data["profile_id"] = profile_id
        result = self._make_request("POST", "/update-by-id", data=db_data)
        return result if isinstance(result, dict) else None

    def update_profile_by_name(self, old_name: str, profile_data: Dict) -> Dict:
        db_data = dict(profile_data or {})
        db_data["old_name"] = old_name
        if "name" not in db_data:
            db_data["name"] = old_name
        result = self._make_request("POST", "/update-by-name", data=db_data)
        return result if isinstance(result, dict) else None

    def set_profile_session_id(self, name: str, session_id: str) -> bool:
        clean_name = str(name or "").strip()
        clean_session = str(session_id or "").strip()
        if not clean_name or not clean_session:
            return False
        try:
            # Use sessionId (camelCase) to match Convex HTTP endpoint expectations
            self.update_profile_by_name(clean_name, {"name": clean_name, "sessionId": clean_session})
            return True
        except ProfilesError:
            return False

    def delete_profile(self, profile_id: str) -> bool:
        """Delete profile from database"""
        try:
            self._make_request("POST", "/delete-by-id", data={"profile_id": profile_id})
            return True
        except ProfilesError:
            return False

    def sync_profile_status(self, name: str, status: str, using: bool = False):
        """Update profile status and using flag"""
        self._make_request("POST", "/sync-status", data={"name": name, "status": status, "using": using})

    def set_profile_login_true(self, name: str):
        """Set login field to True for a profile."""
        self._make_request("POST", "/set-login-true", data={"name": name})


# Backwards compatibility aliases
SupabaseProfilesClient = ProfilesClient
SupabaseProfilesError = ProfilesError
