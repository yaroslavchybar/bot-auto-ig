import argparse
import os
import sys

# Add project root to Python path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from python.automation.browser import run_browser
import signal
import atexit
import time
import random
import logging
from python.core.resilience.error_handler import classify_exception, ErrorDecision
from python.core.runtime.job_object import WindowsJobObject
from python.core.runtime.process_manager import ProcessManager
from python.core.observability.logging_config import setup_logging
from python.core.runtime.healthcheck import run_all_checks
from python.automation.browser import parse_proxy_string

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)

_cleanup_done = False

def _graceful_shutdown():
    global _cleanup_done
    if _cleanup_done:
        return
    _cleanup_done = True
    logger.info("Graceful shutdown initiated...")
    # Context manager in run_browser handles browser cleanup

def _signal_handler(sig, frame):
    _graceful_shutdown()
    raise SystemExit(0)

# Register handlers
signal.signal(signal.SIGINT, _signal_handler)
if hasattr(signal, 'SIGTERM'):
    signal.signal(signal.SIGTERM, _signal_handler)
if hasattr(signal, 'SIGBREAK'):  # Windows
    signal.signal(signal.SIGBREAK, _signal_handler)
atexit.register(_graceful_shutdown)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", type=str, required=True)
    parser.add_argument("--proxy", type=str, default="None")
    parser.add_argument("--action", type=str, default="manual", help="manual, scroll, reels, mixed")
    parser.add_argument("--duration", type=int, default=5, help="Duration in minutes for single action")
    parser.add_argument("--feed-duration", type=int, default=0, help="Duration for feed in mixed mode")
    parser.add_argument("--reels-duration", type=int, default=0, help="Duration for reels in mixed mode")

    
    # Add new arguments for interaction chances
    parser.add_argument("--match-likes", type=int, default=10, help="Chance to like a post (0-100)")
    parser.add_argument("--match-comments", type=int, default=5, help="Chance to comment on a post (0-100)")
    parser.add_argument("--match-follows", type=int, default=5, help="Chance to follow a user (0-100)")
    parser.add_argument("--reels-match-likes", type=int, default=None, help="Chance to like a reel (0-100)")
    parser.add_argument("--reels-match-follows", type=int, default=None, help="Chance to follow from reels (0-100)")
    parser.add_argument("--carousel-watch-chance", type=int, default=0, help="Chance to watch carousel slides (0-100)")
    parser.add_argument("--carousel-max-slides", type=int, default=3, help="Max slides to advance in a carousel")
    parser.add_argument("--watch-stories", type=int, default=1, help="Whether to watch stories at start (1/0)")
    parser.add_argument("--stories-max", type=int, default=3, help="Max number of stories to watch")

    parser.add_argument("--user-agent", type=str, default=None, help="Custom User Agent string")
    parser.add_argument("--os", type=str, default=None, help="Emulated OS: windows, macos, linux")
    
    args = parser.parse_args()

    # Pre-flight Health Checks
    proxy_cfg = None
    if args.proxy and args.proxy.lower() not in ["none", ""]:
        # Convert playwright proxy string to requests format for check
        # This is a bit tricky since parse_proxy_string returns playwright format dict
        # We need a requests-compatible dict
        # Simple heuristic:
        parsed = parse_proxy_string(args.proxy)
        if parsed and 'server' in parsed:
            # Construct URL from parsed dict
            server = parsed['server']
            if 'username' in parsed and 'password' in parsed:
                # insert auth
                scheme, rest = server.split("://", 1)
                proxy_url = f"{scheme}://{parsed['username']}:{parsed['password']}@{rest}"
            else:
                proxy_url = server
            proxy_cfg = {'http': proxy_url, 'https': proxy_url}

    checks = run_all_checks(proxy_cfg)
    failed_checks = [k for k, v in checks.items() if v is False]
    
    if failed_checks:
        logger.error(f"Health checks failed: {failed_checks}")
        # In strict production, we might exit. 
        # But for now, let's just warn if internet works but proxy fails?
        # If internet fails, definitely exit.
        if checks.get("internet") is False:
             logger.critical("No internet connection. Exiting.")
             sys.exit(1)
        if checks.get("proxy") is False:
             logger.error("Proxy check failed. Proceeding might fail.")
             # We can choose to exit or continue. Let's exit to be safe as per "Pre-flight validation" goal.
             sys.exit(1)
        if checks.get("disk_space") is False:
             logger.warning("Low disk space. Proceeding with caution.")

    logger.info(f"Health checks passed: {checks}")

    # Pre-flight cleanup
    pm = ProcessManager()
    cleaned = pm.cleanup_orphaned_processes()
    if cleaned:
        logger.info(f"Cleaned {cleaned} orphaned processes.")

    # Initialize Job Object for process cleanup
    job = None
    if os.name == 'nt':
        try:
            job = WindowsJobObject()
            job.assign_process()
            logger.info("Windows Job Object active: Child processes will terminate with parent.")
        except Exception as e:
            logger.error(f"Failed to initialize Windows Job Object: {e}")

    max_retries = 3
    retry_count = 0
    
    while True:
        try:
            run_browser(
                profile_name=args.name, 
                proxy_string=args.proxy, 
                action=args.action, 
                duration=args.duration, 
                match_likes=args.match_likes,
                match_comments=args.match_comments,
                match_follows=args.match_follows,
                carousel_watch_chance=args.carousel_watch_chance,
                carousel_max_slides=args.carousel_max_slides,
                watch_stories=bool(args.watch_stories),
                stories_max=args.stories_max,
                feed_duration=args.feed_duration,
                reels_duration=args.reels_duration,

                reels_match_likes=args.reels_match_likes,
                reels_match_follows=args.reels_match_follows,
                user_agent=args.user_agent,
                os=args.os
            )
            logger.info("Session completed successfully.")
            break
            
        except KeyboardInterrupt:
            logger.info("Interrupted by user.")
            sys.exit(0)
            
        except Exception as e:
            decision = classify_exception(e)
            logger.error(f"Error encountered: {type(e).__name__}: {e}", extra={"decision": decision.name, "exception": str(e)})
            
            if decision == ErrorDecision.ABORT:
                logger.critical("Fatal error or unknown exception. Aborting.")
                sys.exit(1)
                
            elif decision in (ErrorDecision.RETRY, ErrorDecision.RESTART_BROWSER):
                if retry_count >= max_retries:
                    logger.error(f"Max retries ({max_retries}) reached. Aborting.")
                    sys.exit(1)
                
                retry_count += 1
                delay = (2 ** retry_count) + random.uniform(0, 1)
                
                if decision == ErrorDecision.RESTART_BROWSER:
                    logger.warning(f"State stale. Restarting browser in {delay:.2f}s...")
                else:
                    logger.warning(f"Transient error. Retrying in {delay:.2f}s...")
                    
                time.sleep(delay)
                continue
                
            elif decision == ErrorDecision.BACKOFF_AND_SLOW:
                logger.warning("Rate limit detected. Backing off for 60s...")
                time.sleep(60 + random.uniform(0, 10))
                # Don't increment retry_count for rate limits, or maybe we should?
                # If we get rate limited indefinitely, we might want to stop.
                # But typically we want to wait it out.
                continue
