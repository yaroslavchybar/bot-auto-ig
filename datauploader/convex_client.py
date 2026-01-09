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


def insert_account(account: dict[str, Any], env: str = "dev") -> dict:
    """Insert a single account using Convex HTTP API mutation.
    
    Args:
        account: Dict with keys: userName, status, message, createdAt
        env: "dev" for development, "prod" for production
        
    Returns:
        API response dict
    """
    url = f"{get_convex_url(env)}/api/mutation"
    body = {
        "path": "instagramAccounts:insert",
        "args": account,
        "format": "json"
    }
    headers = {"Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=body)
    response.raise_for_status()
    return response.json()


def insert_accounts_batch(accounts: list[dict[str, Any]], env: str = "dev") -> dict:
    """Insert multiple accounts using Convex HTTP API mutation.
    
    Args:
        accounts: List of dicts with keys: userName, status, message, createdAt
        env: "dev" for development, "prod" for production
        
    Returns:
        API response dict with inserted and skipped counts
    """
    url = f"{get_convex_url(env)}/api/mutation"
    body = {
        "path": "instagramAccounts:insertBatch",
        "args": {"accounts": accounts},
        "format": "json"
    }
    headers = {"Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=body)
    response.raise_for_status()
    result = response.json()
    
    # Convex HTTP API returns { status: "success", value: {...} } or { status: "error", ... }
    if result.get("status") == "success" and "value" in result:
        value = result["value"]
        return {
            "status": "success",
            "inserted": value.get("inserted", 0),
            "skipped": value.get("skipped", 0),
        }
    elif result.get("status") == "error":
        return {
            "status": "error",
            "errorMessage": result.get("errorMessage", "Unknown error"),
        }
    else:
        # Try parsing the result directly (in case format changed)
        return {
            "status": "success",
            "inserted": result.get("inserted", 0),
            "skipped": result.get("skipped", 0),
        }


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
