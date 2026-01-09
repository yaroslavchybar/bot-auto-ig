"""Upload filtered CSV data to Convex database."""

import csv
from pathlib import Path
from typing import TypedDict

from clean_data import detect_csv_separator
from convex_client import get_convex_url, prepare_account, insert_accounts_batch

BATCH_SIZE = 500

# Column aliases for finding the username field
USERNAME_ALIASES = ["user_name", "userName", "username", "login", "User Name"]


class UploadResult(TypedDict):
    inserted: int
    skipped: int


def _get_username(row: dict) -> str | None:
    """Extract username from row using various possible column names."""
    for alias in USERNAME_ALIASES:
        if alias in row:
            val = row[alias]
            if val and str(val).strip():
                return str(val).strip()
    return None


def _read_usernames(path: Path) -> list[str]:
    """Read usernames from CSV file."""
    sep = detect_csv_separator(str(path))
    with path.open("r", encoding="utf-8") as f:
        rdr = csv.DictReader(f, delimiter=sep)
        usernames: list[str] = []
        for row in rdr:
            username = _get_username(row)
            if username:
                usernames.append(username)
        return usernames


def upload_to_convex(csv_path: Path, envs: list[str] | None = None) -> dict[str, UploadResult]:
    """Upload usernames from CSV to Convex instagramAccounts table.

    Each account is created with:
      - userName: from CSV
      - status: "available"
      - message: False
      - createdAt: current timestamp

    Args:
        csv_path: Path to the CSV file
        envs: List of environments to upload to ("dev", "prod", or both)
              If None, defaults to ["dev"]

    Returns:
        Dict mapping environment name to UploadResult with inserted and skipped counts
    """
    if envs is None:
        envs = ["dev"]

    usernames = _read_usernames(Path(csv_path))
    if not usernames:
        return {}

    results: dict[str, UploadResult] = {}
    for env in envs:
        try:
            # Validate URL is set for this env
            get_convex_url(env)
        except RuntimeError as e:
            print(f"Skipping {env}: {e}")
            continue

        total_inserted = 0
        total_skipped = 0
        for i in range(0, len(usernames), BATCH_SIZE):
            batch_usernames = usernames[i : i + BATCH_SIZE]
            accounts = [prepare_account(u, "available") for u in batch_usernames]
            try:
                result = insert_accounts_batch(accounts, env)
                if result.get("status") == "success":
                    # The Convex mutation returns { inserted, skipped }
                    total_inserted += result.get("inserted", 0)
                    total_skipped += result.get("skipped", 0)
                else:
                    print(f"[{env}] Batch upload error: {result.get('errorMessage', 'Unknown error')}")
            except Exception as e:
                print(f"[{env}] Batch upload failed: {e}")

        results[env] = {"inserted": total_inserted, "skipped": total_skipped}

    return results
