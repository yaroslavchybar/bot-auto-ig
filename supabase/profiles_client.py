import requests
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

    def _make_request(self, method: str, endpoint: str = "", data: Optional[Dict] = None, params: Optional[Dict] = None):
        """Make HTTP request to Supabase"""
        url = f"{self.base_url}{endpoint}"

        try:
            if method.upper() == "GET":
                resp = requests.get(url, headers=self.headers, params=params, timeout=20)
            elif method.upper() == "POST":
                resp = requests.post(url, headers=self.headers, json=data, timeout=20)
            elif method.upper() == "PATCH":
                resp = requests.patch(url, headers=self.headers, json=data, timeout=20)
            elif method.upper() == "DELETE":
                resp = requests.delete(url, headers=self.headers, timeout=20)
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
        """Get profile by name"""
        profiles = self._make_request("GET", params={"name": f"eq.{name}"})
        return profiles[0] if profiles else None

    def create_profile(self, profile_data: Dict) -> Dict:
        """Create new profile in database"""
        # Map JSON fields to DB fields
        db_data = {
            "name": profile_data["name"],
            "proxy": profile_data.get("proxy"),
            "type": profile_data.get("type", "Camoufox (рекомендуется)"),
            "test_ip": profile_data.get("test_ip", False),
            "user_agent": profile_data.get("user_agent"),
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
            self._make_request("PATCH",
                             f"?profile_id=eq.{profile['profile_id']}",
                             data={"status": status, "Using": using})
