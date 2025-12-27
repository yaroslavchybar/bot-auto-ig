import os
import shutil
import traceback
import time
import random
import datetime
from contextlib import contextmanager
from typing import Optional
from camoufox import Camoufox
from camoufox.exceptions import InvalidProxy
from automation import actions
from automation.scrolling import scroll_feed, scroll_reels

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
        
        # Check for user:pass@host:port format (Standard)
        if "@" in proxy_string:
            # Reconstruct full URL for standard parsing
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
        
    except Exception as e:
        print(f"[!] Error parsing proxy '{proxy_string}': {e}")
        return None

def ensure_profile_path(profile_name: str, base_dir: Optional[str] = None) -> str:
    if base_dir is None:
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    profiles_dir = os.path.join(base_dir, "profiles")
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
):
    profile_path = ensure_profile_path(profile_name, base_dir=base_dir)
    if _should_clean_today(profile_path):
        _clean_cache2(profile_path)
    proxy_config = build_proxy_config(proxy_string)

    # Prepare common launch arguments
    launch_kwargs = dict(
        headless=headless,
        user_data_dir=profile_path,
        persistent_context=True,
        proxy=proxy_config,
        block_images=block_images,
        os=os or "windows",
        window=(1280, 800),
        humanize=True,
        user_agent=user_agent,
    )

    cm = None
    context = None
    
    try:
        # Attempt 1: Try with geoip=True if proxy is configured
        try:
            cm = Camoufox(geoip=bool(proxy_config), **launch_kwargs)
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
        try:
            if page.url == "about:blank":
                page.goto("https://www.instagram.com", timeout=15000)
        except Exception:
            pass
            
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

def run_browser(profile_name, proxy_string, action="manual", duration=5, 
              match_likes=0, match_comments=0, match_follows=0, 
              carousel_watch_chance=0, carousel_max_slides=3,
              watch_stories=True, stories_max=3,
              feed_duration=0, reels_duration=0, show_cursor=False,
              reels_match_likes=None, reels_match_follows=None,
              user_agent=None, headless=False, os=None):
    print(f"[*] Starting Profile: {profile_name}")
    print(f"[*] Action: {action}")
    
    if proxy_string and proxy_string.lower() not in ["none", ""]:
        print(f"[*] Using Proxy: {proxy_string}")
    
    if user_agent:
        print(f"[*] Using User Agent: {user_agent}")
    print(f"[*] Headless mode: {'ON' if headless else 'OFF'}")

    try:
        print("[*] Initializing Camoufox browser...")

        with create_browser_context(
            profile_name=profile_name,
            proxy_string=proxy_string,
            user_agent=user_agent,
            headless=headless,
            block_images=False,
            os=os,
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
                    scroll_feed(page, duration, feed_config)
                    print("[*] Scrolling session finished.")
                    
                elif action == "reels":
                    print(f"[*] Starting REELS session for {duration} minutes...")
                    scroll_reels(page, duration, reels_config)
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
                            scroll_feed(page, task_duration, feed_config)
                            print("[✓] Feed part complete.")
                        elif task_type == 'reels':
                            print(f"[*] [{idx}/{len(tasks)}] Running Reels scroll for {task_duration} mins...")
                            scroll_reels(page, task_duration, reels_config)
                            print("[✓] Reels part complete.")
                        
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
                print("[✓] Browser closed.")
                return

    except KeyboardInterrupt:
        print("[*] Stopped.")
    except Exception as e:
        print(f"[!] Error occurred: {e}")
        print(f"[!] Error type: {type(e).__name__}")
        print("[!] Full traceback:")
        traceback.print_exc()
        time.sleep(10)
