import argparse
import json
import os
import sys

# Add project root to Python path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from python.browser.setup import run_browser
import signal
import atexit
import time
import random
import logging
from python.core.errors.handler import classify_exception, ErrorDecision
from python.core.process.job_object import WindowsJobObject
from python.core.process.manager import ProcessManager
from python.core.logging import setup_logging
from python.core.process.healthcheck import run_all_checks
from python.browser.setup import parse_proxy_string
from python.browser.display import DisplayManager
from python.database.profiles import ProfilesClient

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)

_cleanup_done = False
_display_mgr = None
_display_session = None
_display_profile = None
_display_workflow_id = "manual"
_profile_name = None
_profiles_client = None


def emit_event(event_type: str, **data):
    event = {"type": event_type, **data}
    try:
        sys.stdout.write(f"__EVENT__{json.dumps(event)}\n")
        sys.stdout.flush()
    except Exception:
        pass


def _sync_profile_status(status: str, using: bool):
    global _profiles_client
    if not _profile_name:
        return
    try:
        if _profiles_client is None:
            _profiles_client = ProfilesClient()
        _profiles_client.sync_profile_status(_profile_name, status, using)
    except Exception as e:
        logger.warning(f"Profile status sync failed for {_profile_name}: {e}")

def _release_display():
    global _display_session
    if not _display_mgr or not _display_session or not _display_profile:
        return
    try:
        released = _display_mgr.release(_display_workflow_id, _display_profile)
        if released:
            emit_event(
                "display_released",
                workflow_id=_display_workflow_id,
                profile=_display_profile,
                vnc_port=released.get("vnc_port"),
                display_num=released.get("display_num"),
            )
    except Exception:
        pass
    _display_session = None

def _graceful_shutdown():
    global _cleanup_done
    if _cleanup_done:
        return
    _cleanup_done = True
    _sync_profile_status("idle", False)
    _release_display()
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
    parser.add_argument("--fingerprint-seed", type=str, default=None, help="Seed for consistent fingerprint generation")
    parser.add_argument("--fingerprint-os", type=str, default=None, help="OS for fingerprint generation: windows, macos, linux")
    parser.add_argument("--workflow-id", type=str, default="manual", help="Workflow identifier for display session tracking")
    
    args = parser.parse_args()
    _profile_name = args.name

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

    # Pre-flight cleanup:
    # In manual mode we allow multiple concurrent profile sessions, so we must not
    # kill other running Camoufox/Firefox processes started by sibling launchers.
    pm = ProcessManager()
    if args.action != "manual":
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

    _display_profile = args.name
    _display_workflow_id = str(args.workflow_id or "manual")
    display_value = None
    try:
        _display_mgr = DisplayManager()
        _display_session = _display_mgr.allocate(_display_workflow_id, args.name)
        if _display_session:
            display_value = _display_session.get("display")
            emit_event(
                "display_allocated",
                workflow_id=_display_workflow_id,
                profile=args.name,
                vnc_port=_display_session.get("vnc_port"),
                display_num=_display_session.get("display_num"),
            )
    except Exception as e:
        logger.error(f"Display allocation failed for {args.name}: {e}")

    _sync_profile_status("running", True)

    max_retries = 3
    retry_count = 0

    try:
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
                    os=args.os,
                    fingerprint_seed=getattr(args, "fingerprint_seed", None),
                    fingerprint_os=getattr(args, "fingerprint_os", None),
                    display=display_value,
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
    finally:
        _sync_profile_status("idle", False)
        _release_display()
