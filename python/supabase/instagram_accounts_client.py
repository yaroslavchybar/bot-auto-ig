import time
import datetime
from typing import Any, Callable, Dict, List, Optional

import requests

from python.supabase.config import PROJECT_URL, SECRET_KEY
from python.supabase.shared_session import get_shared_session


class InstagramAccountsError(Exception):
    """Raised when Supabase instagram_accounts API call fails."""


class InstagramAccountsClient:
    """Client for managing instagram_accounts and related profile checks."""

    def __init__(self):
        if not PROJECT_URL or not SECRET_KEY:
            raise InstagramAccountsError(
                "Supabase config missing. Set SUPABASE_URL and SUPABASE_SECRET_KEY in environment."
            )

        self.accounts_url = f"{PROJECT_URL}/rest/v1/instagram_accounts"
        self.profiles_url = f"{PROJECT_URL}/rest/v1/profiles"
        self.headers = {
            "apikey": SECRET_KEY,
            "Authorization": f"Bearer {SECRET_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        self.session = get_shared_session()
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
                resp = self.session.get(
                    url, headers=self.headers, params=params, timeout=self.timeout
                )
            elif method.upper() == "POST":
                resp = self.session.post(
                    url, headers=self.headers, json=data, timeout=self.timeout
                )
            elif method.upper() == "PATCH":
                resp = self.session.patch(
                    url, headers=self.headers, json=data, timeout=self.timeout
                )
            elif method.upper() == "DELETE":
                resp = self.session.delete(url, headers=self.headers, timeout=self.timeout)
            else:
                raise InstagramAccountsError(f"Unsupported HTTP method: {method}")

            if resp.status_code >= 400:
                raise InstagramAccountsError(f"HTTP {resp.status_code}: {resp.text}")

            return resp.json() if resp.content else None
        except requests.RequestException as exc:
            raise InstagramAccountsError(f"Request failed: {exc}")

    # ----- Accounts helpers -------------------------------------------------
    def get_accounts_for_profile(
        self, profile_id: str, status: str = "assigned"
    ) -> List[Dict]:
        """Fetch accounts assigned to a profile with given status."""
        params = {
            "select": "id,user_name,assigned_to,status,link_sent,message,subscribed_at,last_message_sent_at",
            "assigned_to": f"eq.{profile_id}",
            "status": f"eq.{status}",
            "order": "created_at.asc",
        }
        return self._request("GET", self.accounts_url, params=params) or []

    def get_accounts_to_message(self, profile_id: str) -> List[Dict]:
        """Fetch accounts assigned to profile that need a message (message=true) and link_sent='not send' or 'needed to send'."""
        params = {
            "select": "id,user_name,assigned_to,status,message,link_sent,last_message_sent_at",
            "assigned_to": f"eq.{profile_id}",
            "message": "is.true",
            "link_sent": "in.(not send,needed to send)",
            "order": "created_at.asc",
        }
        return self._request("GET", self.accounts_url, params=params) or []

    def update_account_status(
        self,
        account_id: str,
        status: str = "subscribed",
        assigned_to: Any = "__NOT_SET__",
    ):
        """
        Update account status (default -> 'subscribed').
        Optionally update assigned_to (e.g., set to None to unassign).
        """
        if status == "done" and assigned_to == "__NOT_SET__":
            assigned_to = None

        payload = {"status": status}
        if (status or "").lower() in ("subscribed"):
            payload["subscribed_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        if assigned_to != "__NOT_SET__":
            payload["assigned_to"] = assigned_to

        result = self._request(
            "PATCH",
            f"{self.accounts_url}?id=eq.{account_id}",
            data=payload,
        )
        return result[0] if result else None

    def get_last_message_sent_at(self, account_id: str) -> Optional[str]:
        """
        Return ISO string of last_message_sent_at for given account id, or None.
        """
        params = {
            "select": "last_message_sent_at",
            "id": f"eq.{account_id}",
            "limit": 1,
        }
        rows = self._request("GET", self.accounts_url, params=params) or []
        if not rows:
            return None
        return rows[0].get("last_message_sent_at")

    def set_last_message_sent_now(self, account_id: str) -> Optional[Dict]:
        """
        Update last_message_sent_at to now() for the given account id.
        """
        payload = {
            "last_message_sent_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
        result = self._request(
            "PATCH",
            f"{self.accounts_url}?id=eq.{account_id}",
            data=payload,
        )
        return result[0] if result else None

    def update_account_message(self, user_name: str, message: bool = True):
        """
        Update the message field for an account by username.
        """
        payload = {"message": message}
        # Use ilike for case-insensitive match
        result = self._request(
            "PATCH",
            f"{self.accounts_url}?user_name=ilike.{user_name}",
            data=payload,
        )
        return result[0] if result else None

    def update_account_link_sent(self, user_name: str, link_sent_status: str):
        """
        Update the link_sent field for an account by username.
        """
        payload = {"link_sent": link_sent_status}
        result = self._request(
            "PATCH",
            f"{self.accounts_url}?user_name=eq.{user_name}",
            data=payload,
        )
        return result[0] if result else None

    def get_profiles_with_assigned_accounts(self, status: Optional[str] = "assigned") -> List[Dict]:
        """
        Return list of profiles (full records) that have accounts assigned with given status.
        If status is None, return profiles with any assigned accounts.
        """
        params = {
            "select": "assigned_to",
            "assigned_to": "not.is.null",
        }
        if status is not None:
            params["status"] = f"eq.{status}"

        accounts = self._request("GET", self.accounts_url, params=params) or []
        profile_ids = {acc.get("assigned_to") for acc in accounts if acc.get("assigned_to")}
        if not profile_ids:
            return []

        return self._fetch_profiles_by_ids(list(profile_ids))

    # ----- Profile helpers --------------------------------------------------
    def _fetch_profiles_by_ids(self, profile_ids: List[str]) -> List[Dict]:
        if not profile_ids:
            return []

        # Supabase expects quoted values inside the IN filter
        quoted = ",".join([f'"{pid}"' for pid in profile_ids])
        params = {
            "select": "profile_id,name,status,mode,proxy,Using,user_agent,list_id,last_opened_at",
            "profile_id": f"in.({quoted})",
        }
        return self._request("GET", self.profiles_url, params=params) or []

    def get_profile(self, profile_id: str) -> Optional[Dict]:
        params = {
            "select": "profile_id,name,status,mode,proxy,Using,user_agent,last_opened_at",
            "profile_id": f"eq.{profile_id}",
        }
        profiles = self._request("GET", self.profiles_url, params=params) or []
        return profiles[0] if profiles else None

    def is_profile_busy(self, profile_id: str) -> bool:
        """Check if profile is running or Using flag is true."""
        profile = self.get_profile(profile_id)
        if not profile:
            return False
        status = (profile.get("status") or "").lower()
        using = bool(profile.get("Using"))
        return status == "running" or using

    def wait_for_profile_idle(
        self,
        profile_id: str,
        log: Optional[Callable[[str], None]] = None,
        should_stop: Optional[Callable[[], bool]] = None,
        poll_interval: float = 5.0,
        timeout: float = 300.0,
    ) -> bool:
        """
        Poll until profile becomes idle or timeout / stop requested.
        Returns True if profile became idle, False otherwise.
        """
        log = log or (lambda _: None)
        should_stop = should_stop or (lambda: False)

        start = time.monotonic()
        while time.monotonic() - start < timeout:
            if should_stop():
                return False
            if not self.is_profile_busy(profile_id):
                return True
            log(f"Профиль занят, жду освобождения... ({int(time.monotonic() - start)}s)")
            time.sleep(poll_interval)

        log("Ожидание профиля истекло, продолжаю.")
        return False
