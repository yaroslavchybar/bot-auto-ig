import requests
from python.core.resilience.http_client import ResilientHttpClient

from python.convex.config import (
    PROJECT_URL,
    API_KEY,
)

# Shared client instance for circuit breaker persistence
_http_client = ResilientHttpClient()

class SupabaseError(Exception):
    """Raised when Supabase API call fails."""


def fetch_usernames(
    limit: int = 200,
) -> list[str]:
    """
    Fetch usernames from Convex HTTP API.

    Args:
        table: Supabase table name.
        username_column: Column that stores the Instagram username.
        limit: Max rows to fetch.
    """
    if not PROJECT_URL or not API_KEY:
        raise SupabaseError("Convex config missing. Set CONVEX_URL and CONVEX_API_KEY in environment.")

    url = f"{PROJECT_URL}/api/instagram-accounts/usernames"
    params = {"limit": limit}
    headers = {"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"}

    try:
        resp = _http_client.get(url, params=params, headers=headers, timeout=20)
        if resp.status_code >= 400:
            raise SupabaseError(f"HTTP {resp.status_code}: {resp.text}")

        data = resp.json()
        if isinstance(data, list):
            return [str(v).strip().lstrip("@") for v in data if str(v).strip()]
        return []
    except Exception as e:
        raise SupabaseError(f"Failed to fetch usernames: {e}")

