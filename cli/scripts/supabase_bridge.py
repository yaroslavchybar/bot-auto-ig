import json
import os
import sys
import io
from pathlib import Path
from typing import Any, Dict, List, Optional

# Force UTF-8 encoding for stdin/stdout on Windows to avoid issues with non-ASCII characters
if sys.platform == "win32":
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def _project_root() -> str:
    return str(Path(__file__).resolve().parents[2])


class BridgeError(Exception):
    pass


def _load_env():
    env_path = Path(_project_root()) / ".env"
    if not env_path.exists():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            k = k.strip()
            if not k:
                continue
            if k not in os.environ:
                os.environ[k] = v.strip()
    except Exception:
        return


_load_env()
sys.path.insert(0, _project_root())

from supabase import config as sb_config
from supabase.profiles_client import SupabaseProfilesClient
from supabase.instagram_settings_client import InstagramSettingsClient
from supabase.message_templates_client import MessageTemplatesClient

import requests


def _ensure_config():
    if not sb_config.PROJECT_URL or not sb_config.SECRET_KEY:
        raise BridgeError("Supabase config missing. Set SUPABASE_URL and SUPABASE_SECRET_KEY in environment.")


def _lists_url() -> str:
    return f"{sb_config.PROJECT_URL}/rest/v1/lists"


def _profiles_url() -> str:
    return f"{sb_config.PROJECT_URL}/rest/v1/profiles"


def _headers() -> Dict[str, str]:
    return {
        "apikey": sb_config.SECRET_KEY,
        "Authorization": f"Bearer {sb_config.SECRET_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _request(method: str, url: str, *, params: Optional[Dict[str, Any]] = None, data: Any = None):
    try:
        if method.upper() == "GET":
            resp = requests.get(url, headers=_headers(), params=params, timeout=30)
        elif method.upper() == "POST":
            resp = requests.post(url, headers=_headers(), json=data, timeout=30)
        elif method.upper() == "PATCH":
            resp = requests.patch(url, headers=_headers(), json=data, timeout=30)
        elif method.upper() == "DELETE":
            resp = requests.delete(url, headers=_headers(), timeout=30)
        else:
            raise BridgeError(f"Unsupported HTTP method: {method}")

        if resp.status_code >= 400:
            raise BridgeError(f"HTTP {resp.status_code}: {resp.text}")

        return resp.json() if resp.content else None
    except requests.RequestException as exc:
        raise BridgeError(f"Request failed: {exc}")


def _quoted_in(values: List[str]) -> str:
    safe = [str(v).replace('"', "") for v in values if v]
    quoted = ",".join([f'"{v}"' for v in safe])
    return f"in.({quoted})"


def handle(op: str, args: Dict[str, Any]) -> Any:
    _ensure_config()

    if op == "profiles.list":
        return SupabaseProfilesClient().get_all_profiles()

    if op == "profiles.create":
        profile = args.get("profile") or {}
        return SupabaseProfilesClient().create_profile(profile)

    if op == "profiles.update_by_name":
        old_name = str(args.get("old_name") or "").strip()
        profile = args.get("profile") or {}
        if not old_name:
            raise BridgeError("old_name is required")
        client = SupabaseProfilesClient()
        existing = client.get_profile_by_name(old_name)
        if not existing:
            raise BridgeError("Profile not found")
        return client.update_profile(existing["profile_id"], profile)

    if op == "profiles.delete_by_name":
        name = str(args.get("name") or "").strip()
        if not name:
            raise BridgeError("name is required")
        client = SupabaseProfilesClient()
        existing = client.get_profile_by_name(name)
        if not existing:
            return True
        return client.delete_profile(existing["profile_id"])

    if op == "profiles.sync_status":
        name = str(args.get("name") or "").strip()
        status = str(args.get("status") or "").strip()
        using = bool(args.get("using") or False)
        if not name or not status:
            raise BridgeError("name and status are required")
        SupabaseProfilesClient().sync_profile_status(name, status, using)
        return True

    if op == "profiles.list_assigned":
        list_id = str(args.get("list_id") or "").strip()
        if not list_id:
            raise BridgeError("list_id is required")
        return _request(
            "GET",
            _profiles_url(),
            params={"select": "profile_id,name", "list_id": f"eq.{list_id}", "login": "is.true", "order": "created_at.asc"},
        ) or []

    if op == "profiles.list_unassigned":
        return _request(
            "GET",
            _profiles_url(),
            params={"select": "profile_id,name", "list_id": "is.null", "login": "is.true", "order": "created_at.asc"},
        ) or []

    if op == "profiles.bulk_set_list_id":
        profile_ids = args.get("profile_ids") or []
        list_id = args.get("list_id", "__MISSING__")
        if not isinstance(profile_ids, list) or len(profile_ids) == 0:
            return True
        if list_id == "__MISSING__":
            raise BridgeError("list_id is required (use null to unassign)")
        endpoint = f"{_profiles_url()}?profile_id={_quoted_in([str(v) for v in profile_ids])}"
        _request("PATCH", endpoint, data={"list_id": list_id})
        return True

    if op == "profiles.clear_busy_for_lists":
        list_ids = args.get("list_ids") or []
        if not isinstance(list_ids, list) or len(list_ids) == 0:
            return True
        list_ids = [str(x).strip() for x in list_ids if str(x).strip()]
        if not list_ids:
            return True

        rows = _request(
            "GET",
            _profiles_url(),
            params={
                "select": "profile_id,name,status,Using",
                "list_id": _quoted_in(list_ids),
                "order": "created_at.asc",
            },
        ) or []
        if not isinstance(rows, list) or not rows:
            return True

        for r in rows:
            try:
                pid = str(r.get("profile_id") or "").strip()
                if not pid:
                    continue
                status = str(r.get("status") or "").lower()
                using = bool(r.get("Using"))
                if status == "running" or using:
                    _request("PATCH", f"{_profiles_url()}?profile_id=eq.{pid}", data={"status": "idle", "Using": False})
            except Exception:
                continue

        return True

    if op == "lists.list":
        return _request(
            "GET",
            _lists_url(),
            params={"select": "id,name", "order": "created_at.asc"},
        ) or []

    if op == "lists.create":
        name = str(args.get("name") or "").strip()
        if not name:
            raise BridgeError("name is required")
        res = _request("POST", _lists_url(), data={"name": name}) or []
        return res[0] if isinstance(res, list) and res else res

    if op == "lists.update":
        list_id = str(args.get("id") or "").strip()
        name = str(args.get("name") or "").strip()
        if not list_id or not name:
            raise BridgeError("id and name are required")
        res = _request("PATCH", f"{_lists_url()}?id=eq.{list_id}", data={"name": name}) or []
        return res[0] if isinstance(res, list) and res else res

    if op == "lists.delete":
        list_id = str(args.get("id") or "").strip()
        if not list_id:
            raise BridgeError("id is required")
        _request("DELETE", f"{_lists_url()}?id=eq.{list_id}")
        return True

    if op == "instagram_settings.get":
        scope = str(args.get("scope") or "global")
        return InstagramSettingsClient().get_settings(scope) or None

    if op == "instagram_settings.upsert":
        scope = str(args.get("scope") or "global")
        data = args.get("data") or {}
        if not isinstance(data, dict):
            raise BridgeError("data must be an object")
        return InstagramSettingsClient().upsert_settings(data, scope) or None

    if op == "message_templates.get":
        kind = str(args.get("kind") or "").strip()
        if not kind:
            raise BridgeError("kind is required")
        return MessageTemplatesClient().get_texts(kind)

    if op == "message_templates.upsert":
        kind = str(args.get("kind") or "").strip()
        texts = args.get("texts") or []
        if not kind:
            raise BridgeError("kind is required")
        if not isinstance(texts, list):
            raise BridgeError("texts must be a list")
        cleaned = [str(t) for t in texts if str(t).strip()]
        return MessageTemplatesClient().upsert_texts(kind, cleaned) or None

    raise BridgeError(f"Unknown op: {op}")


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        out = {"ok": False, "error": "No input"}
        sys.stdout.write(json.dumps(out))
        return

    try:
        req = json.loads(raw)
        op = str(req.get("op") or "")
        args = req.get("args") or {}
        if not op:
            raise BridgeError("op is required")
        if not isinstance(args, dict):
            raise BridgeError("args must be an object")
        data = handle(op, args)
        out = {"ok": True, "data": data}
        sys.stdout.write(json.dumps(out))
    except Exception as exc:
        out = {"ok": False, "error": str(exc)}
        sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()

