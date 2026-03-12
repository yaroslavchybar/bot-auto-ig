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


def get_convex_site_url(env: str = "dev") -> str:
    return get_convex_url(env).replace(".convex.cloud", ".convex.site")


def get_internal_api_key() -> str:
    token = os.getenv("INTERNAL_API_KEY", "").strip()
    if not token:
        raise RuntimeError("Missing INTERNAL_API_KEY in environment")
    return token


def convex_internal_fetch(
    endpoint: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    env: str = "dev",
) -> Any:
    url = f"{get_convex_site_url(env)}{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {get_internal_api_key()}",
    }
    response = requests.request(method, url, headers=headers, json=body)
    response.raise_for_status()
    if response.status_code == 204:
        return None
    return response.json()


def convex_query(path: str, args: dict[str, Any] | None = None, env: str = "dev") -> Any:
    args = args or {}
    if path == "workflowArtifacts:listUnimported":
        kind = args.get("kind")
        endpoint = "/api/workflow-artifacts/unimported"
        if kind:
            endpoint = f"{endpoint}?kind={kind}"
        return convex_internal_fetch(endpoint, env=env)
    if path == "workflowArtifacts:getById":
        artifact_id = args.get("id")
        return convex_internal_fetch(
            f"/api/workflow-artifacts/by-id?id={artifact_id}",
            env=env,
        )
    if path == "workflowArtifacts:getStorageUrl":
        storage_id = args.get("storageId")
        return convex_internal_fetch(
            f"/api/workflow-artifacts/storage-url?storageId={storage_id}",
            env=env,
        )
    if path == "keywords:get":
        filename = args.get("filename")
        return convex_internal_fetch(
            f"/api/keywords?filename={filename}",
            env=env,
        )
    if path == "keywords:list":
        return convex_internal_fetch("/api/keywords", env=env)

    url = f"{get_convex_url(env)}/api/query"
    body = {"path": path, "args": args, "format": "json"}
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
    args = args or {}
    if path == "workflowArtifacts:setImported":
        return convex_internal_fetch(
            "/api/workflow-artifacts/set-imported",
            method="POST",
            body=args,
            env=env,
        )
    if path == "instagramAccounts:insert":
        return convex_internal_fetch(
            "/api/instagram-accounts",
            method="POST",
            body=args,
            env=env,
        )
    if path == "instagramAccounts:insertBatch":
        return convex_internal_fetch(
            "/api/instagram-accounts/batch",
            method="POST",
            body=args,
            env=env,
        )
    if path == "keywords:upsert":
        return convex_internal_fetch(
            "/api/keywords",
            method="POST",
            body=args,
            env=env,
        )
    if path == "keywords:remove":
        return convex_internal_fetch(
            "/api/keywords/delete",
            method="POST",
            body=args,
            env=env,
        )
    url = f"{get_convex_url(env)}/api/mutation"
    body = {"path": path, "args": args, "format": "json"}
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


def prepare_account(
    username: str,
    status: str = "available",
    full_name: str | None = None,
    matched_name: str | None = None,
) -> dict[str, Any]:
    """Prepare an account dict with all required fields.
    
    Args:
        username: Instagram username
        status: Account status (default: "available")
        full_name: Original full name from the upload
        matched_name: The keyword name that passed the filter
        
    Returns:
        Dict with userName, status, message (False), createdAt, and optional fullName/matchedName
    """
    account: dict[str, Any] = {
        "userName": username,
        "status": status,
        "message": False,
        "createdAt": time.time() * 1000,  # JavaScript timestamp (milliseconds)
    }
    if full_name is not None:
        account["fullName"] = full_name
    if matched_name is not None:
        account["matchedName"] = matched_name
    return account


# ── Keywords helpers ──────────────────────────────────────────────────

def get_keywords(filename: str, env: str = "dev") -> str | None:
    """Fetch keyword content from the DB by filename.

    Returns the content string or None if not found.
    """
    try:
        return convex_query("keywords:get", {"filename": filename}, env=env)
    except Exception:
        return None


def upsert_keywords(filename: str, content: str, env: str = "dev") -> dict:
    """Insert or update a keyword entry in the DB."""
    return convex_mutation("keywords:upsert", {"filename": filename, "content": content}, env=env)


def list_keywords(env: str = "dev") -> list[dict]:
    """List all keyword entries (filename + id)."""
    try:
        result = convex_query("keywords:list", {}, env=env)
        return result if isinstance(result, list) else []
    except Exception:
        return []


def remove_keywords(filename: str, env: str = "dev") -> dict:
    """Delete a keyword entry by filename."""
    return convex_mutation("keywords:remove", {"filename": filename}, env=env)

