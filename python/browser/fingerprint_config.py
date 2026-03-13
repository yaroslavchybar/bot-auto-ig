import json
import os
from typing import Optional


def _fingerprint_cache_path(profile_path: str, _seed: str, _os_name: str) -> str:
    return os.path.join(profile_path, '.fingerprint_cache.json')


def _load_cached_fingerprint(cache_path: str, seed: str, os_name: str) -> Optional[dict]:
    try:
        if not os.path.exists(cache_path):
            return None
        with open(cache_path, 'r', encoding='utf-8') as file_obj:
            data = json.load(file_obj)
        if data.get('seed') != seed or data.get('os') != os_name:
            return None
        fingerprint = data.get('fingerprint')
        return fingerprint if isinstance(fingerprint, dict) else None
    except Exception:
        return None


def _save_fingerprint_cache(cache_path: str, seed: str, os_name: str, fp_dict: dict) -> None:
    try:
        with open(cache_path, 'w', encoding='utf-8') as file_obj:
            json.dump({'seed': seed, 'os': os_name, 'fingerprint': fp_dict}, file_obj, ensure_ascii=False, indent=2)
    except Exception as exc:
        print(f'[!] Failed to save fingerprint cache: {exc}')


def _apply_cached_properties(fingerprint_obj, cached: dict) -> None:
    if 'screen' in cached and hasattr(fingerprint_obj, 'screen') and fingerprint_obj.screen:
        _apply_object_fields(
            fingerprint_obj.screen,
            cached['screen'],
            ('width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth', 'devicePixelRatio'),
        )
    if 'navigator' in cached and hasattr(fingerprint_obj, 'navigator') and fingerprint_obj.navigator:
        _apply_object_fields(
            fingerprint_obj.navigator,
            cached['navigator'],
            ('userAgent', 'platform', 'language', 'languages', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints'),
        )
    if 'videoCard' in cached and hasattr(fingerprint_obj, 'videoCard') and fingerprint_obj.videoCard:
        _apply_object_fields(fingerprint_obj.videoCard, cached['videoCard'], ('vendor', 'renderer'))


def _apply_object_fields(target, values: dict, keys: tuple[str, ...]) -> None:
    for key in keys:
        if key not in values:
            continue
        try:
            setattr(target, key, values[key])
        except Exception:
            pass


def load_or_generate_fingerprint_config(profile_path: str, fingerprint_seed: Optional[str], target_os: str) -> Optional[dict]:
    if not fingerprint_seed:
        return None
    try:
        cache_path = _fingerprint_cache_path(profile_path, fingerprint_seed, target_os)
        cached_config = _load_cached_fingerprint(cache_path, fingerprint_seed, target_os)
        if cached_config is not None:
            print(f'[*] Loaded cached fingerprint config for {target_os} (seed: {fingerprint_seed[:8]}...)')
            return cached_config
        generated = _generate_fingerprint_config(target_os)
        _save_fingerprint_cache(cache_path, fingerprint_seed, target_os, generated)
        print(f'[*] Generated and cached new fingerprint config for {target_os} (seed: {fingerprint_seed[:8]}...)')
        return generated
    except Exception as exc:
        print(f'[!] Failed to generate/load fingerprint config: {exc}')
        import traceback as _tb

        _tb.print_exc()
        return None


def _generate_fingerprint_config(target_os: str) -> dict:
    from browserforge.fingerprints import Screen
    from camoufox.fingerprints import from_browserforge, generate_fingerprint

    screen = Screen(min_width=1366, max_width=1366, min_height=768, max_height=768)
    fingerprint = generate_fingerprint(screen=screen, os=target_os)
    config = from_browserforge(fingerprint)
    return _apply_vnc_overrides(config)


def _apply_vnc_overrides(config: dict) -> dict:
    config['screen.width'] = 1366
    config['screen.height'] = 768
    config['screen.availWidth'] = 1366
    config['screen.availHeight'] = 768
    config['window.outerWidth'] = 1366
    config['window.outerHeight'] = 768
    config['window.screenX'] = 0
    config['window.screenY'] = 0
    return config
