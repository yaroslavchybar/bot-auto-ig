"""Convex client for uploading Instagram accounts."""

import os
import time
from typing import Any

import requests


def get_convex_url(env: str = "dev") -> str:
    """Get the Convex deployment URL from environment variables.
    
    Args:
        env: "dev" for development, "prod" for production
        
    Returns:
        The Convex URL for the specified environment
    """
    if env == "prod":
        url = os.getenv("CONVEX_URL_PROD")
        if not url:
            raise RuntimeError("Missing CONVEX_URL_PROD in environment")
    else:
        url = os.getenv("CONVEX_URL_DEV")
        if not url:
            # Fall back to CONVEX_URL for backward compatibility
            url = os.getenv("CONVEX_URL")
        if not url:
            raise RuntimeError("Missing CONVEX_URL_DEV or CONVEX_URL in environment")
    return url


def convex_query(path: str, args: dict[str, Any] | None = None, env: str = "dev") -> Any:
    url = f"{get_convex_url(env)}/api/query"
    body = {"path": path, "args": args or {}, "format": "json"}
    headers = {"Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=body)
    response.raise_for_status()
    result = response.json()
    if result.get("status") == "success" and "value" in result:
        return result["value"]
    if result.get("status") == "error":
        raise RuntimeError(result.get("errorMessage", "Unknown error"))
    return result


def convex_mutation(path: str, args: dict[str, Any] | None = None, env: str = "dev") -> Any:
    url = f"{get_convex_url(env)}/api/mutation"
    body = {"path": path, "args": args or {}, "format": "json"}
    headers = {"Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=body)
    response.raise_for_status()
    result = response.json()
    if result.get("status") == "success" and "value" in result:
        return result["value"]
    if result.get("status") == "error":
        raise RuntimeError(result.get("errorMessage", "Unknown error"))
    return result


def insert_account(account: dict[str, Any], env: str = "dev") -> dict:
    """Insert a single account using Convex HTTP API mutation.
    
    Args:
        account: Dict with keys: userName, status, message, createdAt
        env: "dev" for development, "prod" for production
        
    Returns:
        API response dict
    """
    return convex_mutation("instagramAccounts:insert", account, env=env)


def insert_accounts_batch(accounts: list[dict[str, Any]], env: str = "dev") -> dict:
    """Insert multiple accounts using Convex HTTP API mutation.
    
    Args:
        accounts: List of dicts with keys: userName, status, message, createdAt
        env: "dev" for development, "prod" for production
        
    Returns:
        API response dict with inserted and skipped counts
    """
    try:
        value = convex_mutation("instagramAccounts:insertBatch", {"accounts": accounts}, env=env)
        return {"status": "success", "inserted": value.get("inserted", 0), "skipped": value.get("skipped", 0)}
    except Exception as e:
        return {"status": "error", "errorMessage": str(e)}


def prepare_account(username: str, status: str = "available") -> dict[str, Any]:
    """Prepare an account dict with all required fields.
    
    Args:
        username: Instagram username
        status: Account status (default: "available")
        
    Returns:
        Dict with userName, status, message (False), and createdAt (now)
    """
    return {
        "userName": username,
        "status": status,
        "message": False,
        "createdAt": time.time() * 1000,  # JavaScript timestamp (milliseconds)
    }
