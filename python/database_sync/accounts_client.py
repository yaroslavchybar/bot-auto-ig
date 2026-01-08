import time
import datetime
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote

import requests

from python.database_sync.config import PROJECT_URL, SECRET_KEY
from python.internal_systems.error_handling.http_client import ResilientHttpClient


class InstagramAccountsError(Exception):
    """Raised when instagram_accounts API call fails."""


class InstagramAccountsClient:
    """Client for managing instagram_accounts and related profile checks."""

    def __init__(self):
        if not PROJECT_URL:
            raise InstagramAccountsError(
                "Convex config missing. Set CONVEX_URL in environment."
            )

        self.accounts_url = f"{PROJECT_URL}/api/instagram-accounts"
        self.profiles_url = f"{PROJECT_URL}/api/profiles"
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
            elif method.upper() == "PATCH":
                resp = self.http_client.patch(
                    url, headers=self.headers, json=data, timeout=self.timeout
                )
            elif method.upper() == "DELETE":
                resp = self.http_client.delete(url, headers=self.headers, timeout=self.timeout)
            else:
                raise InstagramAccountsError(f"Unsupported HTTP method: {method}")

            if resp.status_code >= 400:
                raise InstagramAccountsError(f"HTTP {resp.status_code}: {resp.text}")

            return resp.json() if resp.content else None
        except Exception as exc:
            raise InstagramAccountsError(f"Request failed: {exc}")

    # ----- Accounts helpers -------------------------------------------------
    def get_accounts_for_profile(
        self, profile_id: str, status: str = "assigned"
    ) -> List[Dict]:
        """Fetch accounts assigned to a profile with given status."""
        params = {
            "profileId": profile_id,
            "status": status,
        }
        return self._request("GET", f"{self.accounts_url}/for-profile", params=params) or []

    def get_accounts_to_message(self, profile_id: str) -> List[Dict]:
        """Fetch accounts assigned to profile that need a message (message=true) and link_sent='not send' or 'needed to send'."""
        params = {
            "profileId": profile_id,
        }
        return self._request("GET", f"{self.accounts_url}/to-message", params=params) or []

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
            "POST",
            f"{self.accounts_url}/update-status",
            data={
                **{"id": account_id, "status": payload.get("status")},
                **({} if "assigned_to" not in payload else {"assigned_to": payload["assigned_to"]}),
            },
        )
        return result if isinstance(result, dict) else None

    def get_last_message_sent_at(self, account_id: str) -> Optional[str]:
        """
        Return ISO string of last_message_sent_at for given account id, or None.
        """
        params = {"id": account_id}
        value = self._request("GET", f"{self.accounts_url}/last-message-sent-at", params=params)
        return value if isinstance(value, str) else None

    def set_last_message_sent_now(self, account_id: str) -> Optional[Dict]:
        """
        Update last_message_sent_at to now() for the given account id.
        """
        result = self._request(
            "POST",
            f"{self.accounts_url}/set-last-message-sent-now",
            data={"id": account_id},
        )
        return result if isinstance(result, dict) else None

    def update_account_message(self, user_name: str, message: bool = True):
        """
        Update the message field for an account by username.
        """
        normalized = (user_name or "").strip()
        if normalized.startswith("@"):
            normalized = normalized[1:]
        normalized = normalized.strip("/")
        if not normalized:
            return None

        result = self._request(
            "POST",
            f"{self.accounts_url}/update-message",
            data={"user_name": normalized, "message": message},
        )
        return result if isinstance(result, dict) else None

    def update_account_link_sent(self, user_name: str, link_sent_status: str):
        """
        Update the link_sent field for an account by username.
        """
        result = self._request(
            "POST",
            f"{self.accounts_url}/update-link-sent",
            data={"user_name": user_name, "link_sent": link_sent_status},
        )
        return result if isinstance(result, dict) else None

    def get_profiles_with_assigned_accounts(self, status: Optional[str] = "assigned") -> List[Dict]:
        """
        Return list of profiles (full records) that have accounts assigned with given status.
        If status is None, return profiles with any assigned accounts.
        """
        params = {}
        if status is not None:
            params["status"] = status
        return self._request("GET", f"{self.accounts_url}/profiles-with-assigned", params=params) or []

    # ----- Profile helpers --------------------------------------------------
    def _fetch_profiles_by_ids(self, profile_ids: List[str]) -> List[Dict]:
        profiles = []
        for pid in profile_ids or []:
            try:
                prof = self._request("GET", f"{self.profiles_url}/by-id", params={"profileId": pid})
                if isinstance(prof, dict) and prof.get("profile_id"):
                    profiles.append(prof)
            except Exception:
                continue
        return profiles

    def get_profile(self, profile_id: str) -> Optional[Dict]:
        profile = self._request("GET", f"{self.profiles_url}/by-id", params={"profileId": profile_id})
        return profile if isinstance(profile, dict) else None

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
