import os
import shutil
import traceback
import time
import random
import datetime
import signal
from contextlib import contextmanager
from typing import Optional
from threading import Thread
from camoufox import Camoufox
from camoufox.exceptions import InvalidProxy
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from python.internal_systems.error_handling.exceptions import AccountBannedException, ProxyError
from python.internal_systems.error_handling.retry import jitter, retry_with_backoff
from python.instagram_actions import actions
from python.instagram_actions.browsing import scroll_feed, scroll_reels
from python.internal_systems.error_handling.config import config
from python.internal_systems.error_handling.traffic_monitor import TrafficMonitor
from python.internal_systems.logging.snapshot_debugger import save_debug_snapshot
import logging

logger = logging.getLogger(__name__)

# --- Proxy Health & Circuit Breaker ---

_proxy_health = {}  # proxy_string -> {"failures": int, "tainted_until": float}

def mark_proxy_failure(proxy_string: str):
    if not proxy_string:
        return
    if proxy_string not in _proxy_health:
        _proxy_health[proxy_string] = {"failures": 0, "tainted_until": 0}
    _proxy_health[proxy_string]["failures"] += 1
    if _proxy_health[proxy_string]["failures"] >= config.PROXY_FAILURE_THRESHOLD:
        _proxy_health[proxy_string]["tainted_until"] = time.time() + config.PROXY_TAINT_DURATION
        logger.warning(f"Proxy {proxy_string} tainted for {config.PROXY_TAINT_DURATION}s due to failures")

def is_proxy_healthy(proxy_string: str) -> bool:
    if not proxy_string or proxy_string not in _proxy_health:
        return True
    return time.time() > _proxy_health[proxy_string]["tainted_until"]

class ProxyCircuitBreaker:
    def __init__(self):
        self.consecutive_failures = 0
        self.global_pause_until = 0
    
    def record_failure(self):
        self.consecutive_failures += 1
        if self.consecutive_failures >= config.CIRCUIT_THRESHOLD:
            self.global_pause_until = time.time() + config.CIRCUIT_RECOVERY_TIMEOUT
            logger.error(f"Circuit Breaker Triggered! Pausing all operations for {config.CIRCUIT_RECOVERY_TIMEOUT}s.")
    
    def record_success(self):
        self.consecutive_failures = 0
    
    def is_open(self) -> bool:
        return time.time() < self.global_pause_until

proxy_circuit = ProxyCircuitBreaker()

@retry_with_backoff(exceptions=(PlaywrightTimeoutError,))
def safe_goto(page, url, timeout=None):
    return page.goto(url, timeout=timeout)

def _safe_get(value, default=None):
    try:
        if callable(value):
            return value()
        return value
    except Exception:
        return default

def _attach_error_snapshots(page, base_dir: str = "data/debug"):
    state = {"window_start": time.time(), "count": 0, "last_by_key": {}}

    ignored_console_substrings = [
        "content-security-policy",
        "blocked an inline script",
        "cookie",
        "rejected for invalid domain",
        "cross-origin request blocked",
        "same origin policy",
        "access-control-allow-origin",
    ]

    important_console_substrings = [
        "referenceerror",
        "typeerror",
        "syntaxerror",
        "rangeerror",
        "ebdeps is not initialized",
        "uncaught",
    ]

    def should_capture(key: str) -> bool:
        now = time.time()
        if now - state["window_start"] >= 60:
            state["window_start"] = now
            state["count"] = 0
            state["last_by_key"].clear()

        last = state["last_by_key"].get(key)
        if last is not None and now - last < 5:
            return False

        if state["count"] >= 10:
            return False

        state["count"] += 1
        state["last_by_key"][key] = now
        return True

    def capture(event_type: str, detail: str | None = None) -> None:
        detail = (detail or "").strip()
        name = f"browser_{event_type}" if not detail else f"browser_{event_type}_{detail}"
        if not should_capture(event_type):
            return
        try:
            save_debug_snapshot(page, name, base_dir=base_dir)
        except Exception:
            return

    def on_pageerror(exc):
        capture("pageerror", str(exc)[:120])

    def on_crash(_):
        capture("crash")

    def on_requestfailed(request):
        try:
            resource_type = _safe_get(getattr(request, "resource_type", None), "") or ""
            if resource_type.lower() in {"image", "media", "font", "stylesheet"}:
                return
        except Exception:
            pass
        url = _safe_get(getattr(request, "url", None), "") or ""
        capture("requestfailed", url.split("?", 1)[0][-120:])

    def on_console(msg):
        msg_type = (_safe_get(getattr(msg, "type", None), "") or "").lower()
        if msg_type != "error":
            return
        text = _safe_get(getattr(msg, "text", None), "") or ""
        lowered = text.lower()
        if any(s in lowered for s in ignored_console_substrings):
            return
        if not any(s in lowered for s in important_console_substrings):
            return
        capture("console", text[:120])

    try:
        page.on("pageerror", on_pageerror)
        page.on("crash", on_crash)
        page.on("requestfailed", on_requestfailed)
        page.on("console", on_console)
    except Exception:
        return

def parse_proxy_string(proxy_string):
    """
    Parse proxy string into Playwright proxy format.
    Supports:
    - scheme://user:pass@host:port
    - scheme://host:port:user:pass (Non-standard but common)
    - host:port:user:pass (Assumes HTTP if no scheme)
    - host:port (No auth)
    
    Returns:
        dict: Playwright proxy config or None
    """
    try:
        if not proxy_string:
            return None
            
        proxy_string = proxy_string.strip()
        scheme = "http"
        
        # Extract scheme if present
        if "://" in proxy_string:
            scheme, remainder = proxy_string.split("://", 1)
            proxy_string = remainder
        
        if "@" in proxy_string:
            try:
                from urllib.parse import urlsplit

                parsed = urlsplit(f"{scheme}://{proxy_string}")
                if parsed.hostname:
                    server = f"{scheme}://{parsed.hostname}"
                    if parsed.port is not None:
                        server = f"{server}:{parsed.port}"
                    cfg = {"server": server}
                    if parsed.username is not None:
                        cfg["username"] = parsed.username
                    if parsed.password is not None:
                        cfg["password"] = parsed.password
                    return cfg
            except Exception:
                pass

            return {"server": f"{scheme}://{proxy_string}"}
            
        # Split by colon
        parts = proxy_string.split(':')
        
        # Format: host:port:user:pass
        if len(parts) == 4:
            host = parts[0]
            port = parts[1]
            user = parts[2]
            password = parts[3]
            return {
                "server": f"{scheme}://{host}:{port}",
                "username": user,
                "password": password
            }
            
        # Format: host:port
        elif len(parts) == 2:
            return {
                "server": f"{scheme}://{parts[0]}:{parts[1]}"
            }
            
        # Fallback for other formats, assume standard URL if just passed
        return {"server": f"{scheme}://{proxy_string}"}
        
    except (ValueError, AttributeError) as e:
        print(f"[!] Error parsing proxy '{proxy_string}': {e}")
        return None

def ensure_profile_path(profile_name: str, base_dir: Optional[str] = None) -> str:
    if base_dir is None:
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    profiles_dir = os.path.join(base_dir, "data", "profiles")
    profile_path = os.path.join(profiles_dir, profile_name)

    if not os.path.exists(profile_path):
        legacy_path = os.path.join(base_dir, "cli", "profiles", profile_name)
        if os.path.exists(legacy_path):
            os.makedirs(profiles_dir, exist_ok=True)
            try:
                shutil.move(legacy_path, profile_path)
            except Exception as e:
                print(f"[!] Failed to migrate profile '{profile_name}': {e}")
                profile_path = legacy_path
    os.makedirs(profile_path, exist_ok=True)
    return profile_path

def build_proxy_config(proxy_string: Optional[str]):
    if proxy_string and proxy_string.lower() not in ("none", ""):
        return parse_proxy_string(proxy_string)
    return None

def _read_text(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return None

def _write_text(path: str, value: str) -> None:
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(value)
    except Exception:
        return

def _should_clean_today(profile_path: str) -> bool:
    marker = os.path.join(profile_path, ".cache2_last_cleaned")
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    last = (_read_text(marker) or "").strip()
    return last != today

def _mark_cleaned_today(profile_path: str) -> None:
    marker = os.path.join(profile_path, ".cache2_last_cleaned")
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    _write_text(marker, today)

def _clean_cache2(profile_path: str) -> None:
    cache2 = os.path.join(profile_path, "cache2")
    if not os.path.exists(cache2):
        _mark_cleaned_today(profile_path)
        return
    try:
        shutil.rmtree(cache2)
    except Exception:
        try:
            entries = os.path.join(cache2, "entries")
            if os.path.exists(entries):
                shutil.rmtree(entries)
        except Exception:
            return
    _mark_cleaned_today(profile_path)

@contextmanager
def create_browser_context(
    profile_name: str,
    proxy_string: Optional[str] = None,
    user_agent: Optional[str] = None,
    base_dir: Optional[str] = None,
    headless: bool = False,
    block_images: bool = False,
    os: Optional[str] = None,
    fingerprint_seed: Optional[str] = None,
    fingerprint_os: Optional[str] = None,
):
    if proxy_circuit.is_open():
        wait_time = proxy_circuit.global_pause_until - time.time()
        print(f"[!] Circuit breaker open. Waiting {wait_time:.1f}s...")
        time.sleep(wait_time)

    profile_path = ensure_profile_path(profile_name, base_dir=base_dir)
    should_clean = _should_clean_today(profile_path)
    
    # Check proxy health
    if proxy_string and not is_proxy_healthy(proxy_string):
        print(f"[!] Proxy {proxy_string} is tainted. Skipping...")
        raise ProxyError(f"Proxy {proxy_string} is currently tainted due to previous failures.")
        
    proxy_config = build_proxy_config(proxy_string)
    
    # Generate fingerprint from seed using BrowserForge
    fingerprint_obj = None
    target_os = fingerprint_os or os or "windows"
    
    if fingerprint_seed:
        try:
            from browserforge.fingerprints import FingerprintGenerator, Screen
            
            # Set random seed for consistent fingerprint generation
            random.seed(fingerprint_seed)
            
            screen = Screen(min_width=1280, max_width=1920, min_height=720, max_height=1080)
            fg = FingerprintGenerator(browser='firefox', screen=screen)
            fingerprint_obj = fg.generate(os=target_os)
            
            print(f"[*] Generated fingerprint from seed for {target_os}")
            
            # Reset random seed to not affect other randomness
            random.seed()
        except Exception as e:
            print(f"[!] Failed to generate fingerprint: {e}")
            fingerprint_obj = None

    # Prepare common launch arguments
    launch_kwargs = dict(
        headless=headless,
        user_data_dir=profile_path,
        persistent_context=True,
        proxy=proxy_config,
        block_images=block_images,
        os=target_os,
        humanize=True,
    )
    
    # If fingerprint object is generated, pass it directly to Camoufox
    if fingerprint_obj:
        launch_kwargs['fingerprint'] = fingerprint_obj
    elif user_agent:
        launch_kwargs['user_agent'] = user_agent

    cm = None
    context = None
    
    try:
        # Attempt 1: Try with geoip=True if proxy is configured
        try:
            cm = Camoufox(geoip=True, **launch_kwargs)
            context = cm.__enter__()
        except InvalidProxy:
            if proxy_config:
                print("[!] Proxy GeoIP check failed. Retrying with geoip=False...")
                # Attempt 2: Retry with geoip=False
                cm = Camoufox(geoip=False, **launch_kwargs)
                context = cm.__enter__()
            else:
                raise

        # Browser initialized successfully
        page = context.pages[0] if context.pages else context.new_page()
        
        # Attach Traffic Monitor
        monitor = TrafficMonitor()
        page.on("response", monitor.on_response)
        _attach_error_snapshots(page)
        
        try:
            if page.url == "about:blank":
                safe_goto(page, "https://www.instagram.com", timeout=jitter(15000))
                
                # Check monitor cooldown
                if monitor.should_pause():
                    wait_time = monitor.cooldown_until - time.time()
                    print(f"[!] Traffic monitor triggered cooldown. Waiting {wait_time:.1f}s...")
                    time.sleep(wait_time)
                
                # Basic ban detection
                try:
                    content = page.content().lower()
                    if "account has been disabled" in content or "account suspended" in content:
                        raise AccountBannedException("Account appears to be banned/suspended")
                except Exception:
                    pass
                    
            proxy_circuit.record_success()
                    
        except PlaywrightTimeoutError:
            print("[!] Timeout navigating to Instagram")
            mark_proxy_failure(proxy_string)
            proxy_circuit.record_failure()
        except AccountBannedException:
            raise
        except Exception as e:
            print(f"[!] Error navigating to Instagram: {e}")
            mark_proxy_failure(proxy_string)
            proxy_circuit.record_failure()
            
        yield context, page

    finally:
        # Ensure context is closed properly
        if cm:
            # We need to handle potential errors during __exit__
            try:
                # We pass None, None, None because we are not propagating an exception from here
                # unless one happened inside the yield block, which contextlib handles?
                # Actually, standard manual __exit__ usage:
                # If an exception occurred in the with block (yield), it should be passed here.
                # But since we use @contextmanager, the generator handles the exception propagation.
                # We just need to close the context.
                if context:
                    try:
                        context.close()
                    except Exception:
                        pass
                cm.__exit__(None, None, None)
            except Exception:
                pass

        if should_clean:
            try:
                Thread(target=_clean_cache2, args=(profile_path,), daemon=True).start()
            except Exception:
                pass

def run_browser(profile_name, proxy_string, action="manual", duration=5, 
              match_likes=0, match_comments=0, match_follows=0, 
              carousel_watch_chance=0, carousel_max_slides=3,
              watch_stories=True, stories_max=3,
              feed_duration=0, reels_duration=0,
              reels_match_likes=None, reels_match_follows=None,
              user_agent=None, headless=False, os=None, 
              fingerprint_seed=None, fingerprint_os=None):
    print(f"[*] Starting Profile: {profile_name}")
    print(f"[*] Action: {action}")
    
    if proxy_string and proxy_string.lower() not in ["none", ""]:
        print(f"[*] Using Proxy: {proxy_string}")
    
    if fingerprint_seed:
        print(f"[*] Using fingerprint seed: {fingerprint_seed[:8]}... (OS: {fingerprint_os or os or 'windows'})")
    elif user_agent:
        print(f"[*] Using User Agent: {user_agent}")
    print(f"[*] Headless mode: {'ON' if headless else 'OFF'}")

    def _handle_signal(_sig, _frame):
        raise SystemExit(0)

    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_signal)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _handle_signal)

    try:
        print("[*] Initializing Camoufox browser...")

        with create_browser_context(
            profile_name=profile_name,
            proxy_string=proxy_string,
            user_agent=user_agent,
            headless=headless,
            block_images=False,
            os=os,
            fingerprint_seed=fingerprint_seed,
            fingerprint_os=fingerprint_os,
        ) as (context, page):
            print("[*] Camoufox initialized successfully")

            print(f"[*] Browser is running...")

            # Execute requested action
            try:
                def pick(primary, fallback):
                    return fallback if primary is None else primary

                feed_config = {
                    'like_chance': match_likes, 
                    'comment_chance': match_comments, 
                    'follow_chance': match_follows,
                    'carousel_watch_chance': carousel_watch_chance,
                    'carousel_max_slides': carousel_max_slides,
                    'watch_stories': watch_stories,
                    'stories_max': stories_max,
                }

                reels_config = {
                    'like_chance': pick(reels_match_likes, match_likes),
                    'comment_chance': match_comments,
                    'follow_chance': pick(reels_match_follows, match_follows),
                    'carousel_watch_chance': carousel_watch_chance,
                    'carousel_max_slides': carousel_max_slides,
                    'watch_stories': watch_stories,
                    'stories_max': stories_max,
                }

                if action == "scroll":
                    print(f"[*] Starting scrolling session for {duration} minutes...")
                    print(f"[*] Config: {feed_config}")
                    scroll_feed(page, duration, feed_config, profile_name=profile_name)
                    print("[*] Scrolling session finished.")
                    
                elif action == "reels":
                    print(f"[*] Starting REELS session for {duration} minutes...")
                    scroll_reels(page, duration, reels_config, profile_name=profile_name)
                    print("[*] Reels session finished.")

                elif action == "mixed":
                    print(f"[*] Starting MIXED session (Feed: {feed_duration}m, Reels: {reels_duration}m)...")
                    
                    # Create list of tasks to perform (in random order)
                    tasks = []
                    
                    if feed_duration > 0:
                        tasks.append(('feed', feed_duration))
                    
                    if reels_duration > 0:
                        tasks.append(('reels', reels_duration))
                    
                    # Randomize the order of tasks
                    random.shuffle(tasks)
                    
                    # Execute tasks in random order
                    for idx, (task_type, task_duration) in enumerate(tasks, 1):
                        if task_type == 'feed':
                            print(f"[*] [{idx}/{len(tasks)}] Running Feed scroll for {task_duration} mins...")
                            scroll_feed(page, task_duration, feed_config, profile_name=profile_name)
                            print("Feed part complete.")
                        elif task_type == 'reels':
                            print(f"[*] [{idx}/{len(tasks)}] Running Reels scroll for {task_duration} mins...")
                            scroll_reels(page, task_duration, reels_config, profile_name=profile_name)
                            print("Reels part complete.")
                        
                        # Small pause between tasks (except after the last one)
                        if idx < len(tasks):
                            time.sleep(random.randint(5, 10))
                        
                    print("[*] Mixed session finished.")

                else: # Manual mode
                    print("[*] Manual mode active. Keep window open.")
                    # Keep Alive Loop
                    while len(context.pages) > 0:
                        time.sleep(0.5)

            except KeyboardInterrupt:
                print("[*] Stopped scrolling - closing browser...")
                try:
                    context.close()
                except:
                    pass
                print("Browser closed.")
                return

    except KeyboardInterrupt:
        print("[*] Stopped.")
    except Exception as e:
        print(f"[!] Error occurred: {e}")
        print(f"[!] Error type: {type(e).__name__}")
        print("[!] Full traceback:")
        traceback.print_exc()
        time.sleep(10)
