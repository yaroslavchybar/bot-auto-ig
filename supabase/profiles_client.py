import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from datetime import datetime, timezone
from typing import List, Dict, Optional
from .config import PROJECT_URL, SECRET_KEY

class SupabaseProfilesError(Exception):
    """Raised when Supabase profiles API call fails."""

class SupabaseProfilesClient:
    """Client for managing profiles in Supabase"""

    def __init__(self):
        if not PROJECT_URL or not SECRET_KEY:
            raise SupabaseProfilesError(
                "Supabase config missing. Set SUPABASE_URL and SUPABASE_SECRET_KEY in environment."
            )

        self.base_url = f"{PROJECT_URL}/rest/v1/profiles"
        self.headers = {
            "apikey": SECRET_KEY,
            "Authorization": f"Bearer {SECRET_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        self.session = requests.Session()
        retries = Retry(
            total=3,
            backoff_factor=1.5,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST", "PATCH", "DELETE"],
        )
        adapter = HTTPAdapter(max_retries=retries)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)
        self.timeout = (10, 60)

    def _make_request(self, method: str, endpoint: str = "", data: Optional[Dict] = None, params: Optional[Dict] = None):
        """Make HTTP request to Supabase"""
        url = f"{self.base_url}{endpoint}"

        try:
            if method.upper() == "GET":
                resp = self.session.get(url, headers=self.headers, params=params, timeout=self.timeout)
            elif method.upper() == "POST":
                resp = self.session.post(url, headers=self.headers, json=data, timeout=self.timeout)
            elif method.upper() == "PATCH":
                resp = self.session.patch(url, headers=self.headers, json=data, timeout=self.timeout)
            elif method.upper() == "DELETE":
                resp = self.session.delete(url, headers=self.headers, timeout=self.timeout)
            else:
                raise SupabaseProfilesError(f"Unsupported HTTP method: {method}")

            if resp.status_code >= 400:
                raise SupabaseProfilesError(f"HTTP {resp.status_code}: {resp.text}")

            return resp.json() if resp.content else None

        except requests.RequestException as e:
            raise SupabaseProfilesError(f"Request failed: {e}")

    def get_all_profiles(self) -> List[Dict]:
        """Fetch all profiles from database"""
        return self._make_request("GET") or []

    def get_profile_by_name(self, name: str) -> Optional[Dict]:
        """Fetch a single profile by name."""
        try:
            # Using existing _make_request method
            profiles = self._make_request("GET", params={"name": f"eq.{name}"})
            if profiles:
                return profiles[0]
            return None
        except Exception:
            return None

    def increment_sessions_today(self, profile_name: str):
        """Increment sessions_today count for a profile."""
        try:
            profile = self.get_profile_by_name(profile_name)
            if profile:
                profile_id = profile.get("profile_id")
                new_count = int(profile.get("sessions_today") or 0) + 1
                self._make_request(
                    "PATCH", 
                    f"?profile_id=eq.{profile_id}", 
                    data={"sessions_today": new_count}
                )
        except Exception as e:
            print(f"Error incrementing sessions for {profile_name}: {e}")

    def create_profile(self, profile_data: Dict) -> Dict:
        """Create new profile in database"""
        # Map JSON fields to DB fields
        db_data = {
            "name": profile_data["name"],
            "proxy": profile_data.get("proxy"),
            "type": profile_data.get("type", "Camoufox (рекомендуется)"),
            "test_ip": profile_data.get("test_ip", False),
            "user_agent": profile_data.get("user_agent"),
            "ua_os": profile_data.get("ua_os"),
            "ua_browser": profile_data.get("ua_browser"),
            "mode": "proxy" if profile_data.get("proxy") else "direct",
            "status": "idle",  # Default status
            "Using": False    # Default not using
        }

        result = self._make_request("POST", data=db_data)
        return result[0] if result else None

    def update_profile(self, profile_id: str, profile_data: Dict) -> Dict:
        """Update existing profile in database"""
        # Map JSON fields to DB fields
        db_data = {
            "name": profile_data["name"],
            "proxy": profile_data.get("proxy"),
            "type": profile_data.get("type", "Camoufox (рекомендуется)"),
            "test_ip": profile_data.get("test_ip", False),
            "user_agent": profile_data.get("user_agent"),
            "ua_os": profile_data.get("ua_os"),
            "ua_browser": profile_data.get("ua_browser"),
            "mode": "proxy" if profile_data.get("proxy") else "direct"
        }

        result = self._make_request("PATCH", f"?profile_id=eq.{profile_id}", data=db_data)
        return result[0] if result else None

    def delete_profile(self, profile_id: str) -> bool:
        """Delete profile from database"""
        try:
            self._make_request("DELETE", f"?profile_id=eq.{profile_id}")
            return True
        except SupabaseProfilesError:
            return False

    def sync_profile_status(self, name: str, status: str, using: bool = False):
        """Update profile status and using flag"""
        profile = self.get_profile_by_name(name)
        if profile:
            data = {"status": status, "Using": using}
            try:
                if str(status).lower() == "running":
                    data["last_opened_at"] = datetime.now(timezone.utc).isoformat()
            except Exception:
                pass
            self._make_request("PATCH",
                               f"?profile_id=eq.{profile['profile_id']}",
                               data=data)
