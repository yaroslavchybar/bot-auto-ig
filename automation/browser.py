import os
import traceback
import time
import random
from camoufox import Camoufox
from automation import actions
from automation.scrolling import scroll_feed, scroll_reels

def parse_proxy_string(proxy_string):
    """
    Parse proxy string into Playwright proxy format.
    String formats:
    - ip:port:user:pass
    - user:pass@ip:port
    - http://user:pass@ip:port
    - socks5://user:pass@ip:port
    
    Returns:
        dict: Playwright proxy config or None
    """
    try:
        config = {}
        
        # Helper to check if string contains protocol
        if "://" not in proxy_string:
            # Assume http if no protocol but try to detect format
            # Format: ip:port:user:pass
            parts = proxy_string.split(':')
            if len(parts) == 4:
                config = {
                    "server": f"http://{parts[0]}:{parts[1]}",
                    "username": parts[2],
                    "password": parts[3]
                }
                return config
            elif len(parts) == 2:
                config = {
                    "server": f"http://{parts[0]}:{parts[1]}"
                }
                return config
        
        # Standard URL format
        config = {"server": proxy_string}
        return config
        
    except Exception as e:
        print(f"[!] Error parsing proxy '{proxy_string}': {e}")
        return None

def run_browser(profile_name, proxy_string, action="manual", duration=5, 
              match_likes=0, match_comments=0, match_follows=0, 
              carousel_watch_chance=0, carousel_max_slides=3,
              watch_stories=True, stories_max=3,
              feed_duration=0, reels_duration=0, show_cursor=False,
              reels_match_likes=None, reels_match_follows=None):
    base_dir = os.getcwd()
    profile_path = os.path.join(base_dir, "profiles", profile_name)
    os.makedirs(profile_path, exist_ok=True)

    print(f"[*] Starting Profile: {profile_name}")
    print(f"[*] Action: {action}")
    
    proxy_config = None
    if proxy_string and proxy_string.lower() not in ["none", ""]:
        print(f"[*] Using Proxy: {proxy_string}")
        proxy_config = parse_proxy_string(proxy_string)

    try:
        # Configuration for Camoufox browser
        use_geoip = False
        
        print("[*] Initializing Camoufox browser...")
        
        # Humanize config could be more detailed if needed, but passing showcursor separately if supported
        # NOTE: showcursor argument is not supported in this version of Camoufox constructor
        
        with Camoufox(
            headless=False,
            user_data_dir=profile_path,
            persistent_context=True,
            proxy=proxy_config,
            geoip=use_geoip,
            block_images=False,
            os="windows",
            window=(1280, 800),
            humanize=True,
            # showcursor=show_cursor,  # Removed to fix TypeError
        ) as context:
            
            print("[*] Camoufox initialized successfully")
            
            if len(context.pages) > 0:
                page = context.pages[0]
            else:
                page = context.new_page()

            print(f"[*] Browser is running...")

            try:
                # Safe navigation
                if page.url == "about:blank":
                    page.goto("https://www.instagram.com", timeout=10000)
            except Exception as nav_error:
                print(f"[!] Navigation warning: {nav_error}")

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

                elif action == "onboard":
                    print("[*] Starting onboarding task...")
                    actions.onboard_account(page)
                    print("[*] Onboarding task finished.")
                    
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
