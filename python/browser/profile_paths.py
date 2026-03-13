import datetime
import os
import shutil
from typing import Optional


def ensure_profile_path(profile_name: str, base_dir: Optional[str] = None) -> str:
    if base_dir is None:
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    profiles_dir = os.path.join(base_dir, 'data', 'profiles')
    profile_path = _resolve_profile_path(profiles_dir, profile_name)
    if not os.path.exists(profile_path):
        _maybe_migrate_legacy_profile(base_dir, profiles_dir, profile_name, profile_path)
    os.makedirs(profile_path, exist_ok=True)
    return profile_path


def _resolve_profile_path(profiles_dir: str, profile_name: str) -> str:
    if not profile_name:
        raise ValueError('Profile name must not be empty.')

    invalid_separators = {os.sep, os.altsep, '/', '\\'}
    if profile_name in {'.', '..'} or any(sep and sep in profile_name for sep in invalid_separators):
        raise ValueError(f"Invalid profile name '{profile_name}'.")

    profiles_root = os.path.abspath(profiles_dir)
    profile_path = os.path.abspath(os.path.join(profiles_root, profile_name))
    try:
        if os.path.commonpath([profiles_root, profile_path]) != profiles_root:
            raise ValueError(f"Invalid profile name '{profile_name}'.")
    except ValueError as exc:
        raise ValueError(f"Invalid profile name '{profile_name}'.") from exc
    return profile_path


def _maybe_migrate_legacy_profile(
    base_dir: str,
    profiles_dir: str,
    profile_name: str,
    profile_path: str,
) -> None:
    legacy_path = os.path.join(base_dir, 'cli', 'profiles', profile_name)
    if not os.path.exists(legacy_path):
        return
    os.makedirs(profiles_dir, exist_ok=True)
    try:
        shutil.move(legacy_path, profile_path)
    except Exception as exc:
        print(f"[!] Failed to migrate profile '{profile_name}': {exc}")


def _read_text(path: str) -> Optional[str]:
    try:
        with open(path, 'r', encoding='utf-8') as file_obj:
            return file_obj.read()
    except Exception:
        return None


def _write_text(path: str, value: str) -> None:
    try:
        with open(path, 'w', encoding='utf-8') as file_obj:
            file_obj.write(value)
    except Exception:
        return


def _should_clean_today(profile_path: str) -> bool:
    marker = os.path.join(profile_path, '.cache2_last_cleaned')
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    last = (_read_text(marker) or '').strip()
    return last != today


def _mark_cleaned_today(profile_path: str) -> None:
    marker = os.path.join(profile_path, '.cache2_last_cleaned')
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    _write_text(marker, today)


def _clean_cache2(profile_path: str) -> None:
    cache2 = os.path.join(profile_path, 'cache2')
    if not os.path.exists(cache2):
        _mark_cleaned_today(profile_path)
        return
    cleaned = True
    try:
        shutil.rmtree(cache2)
    except Exception:
        cleaned = _clean_cache_entries(cache2)
    if cleaned:
        _mark_cleaned_today(profile_path)


def _clean_cache_entries(cache2: str) -> bool:
    try:
        entries = os.path.join(cache2, 'entries')
        if os.path.exists(entries):
            shutil.rmtree(entries)
        return True
    except Exception:
        return False
