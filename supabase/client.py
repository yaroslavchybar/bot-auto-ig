import requests

from supabase.config import (
    PROJECT_URL,
    API_KEY,
    DEFAULT_TABLE,
    DEFAULT_USERNAME_COLUMN,
)


class SupabaseError(Exception):
    """Raised when Supabase API call fails."""


def fetch_usernames(
    table: str = DEFAULT_TABLE,
    username_column: str = DEFAULT_USERNAME_COLUMN,
    limit: int = 200,
) -> list[str]:
    """
    Fetch usernames from a Supabase table using the publishable (client-safe) key.

    Args:
        table: Supabase table name.
        username_column: Column that stores the Instagram username.
        limit: Max rows to fetch.
    """
    if not PROJECT_URL or not API_KEY:
        raise SupabaseError(
            "Supabase config missing. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in environment."
        )

    url = f"{PROJECT_URL}/rest/v1/{table}"
    params = {
        "select": username_column,
        "order": "id.asc",
        "limit": limit,
    }
    headers = {
        "apikey": API_KEY,
        "Authorization": f"Bearer {API_KEY}",
        "Accept": "application/json",
    }

    resp = requests.get(url, params=params, headers=headers, timeout=20)
    if resp.status_code >= 400:
        raise SupabaseError(f"HTTP {resp.status_code}: {resp.text}")

    data = resp.json()
    usernames = []
    for row in data:
        value = row.get(username_column)
        if value:
            usernames.append(str(value).strip().lstrip("@"))
    return usernames

