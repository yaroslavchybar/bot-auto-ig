import json
import os
import random
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import logging
from logging.handlers import MemoryHandler
from typing import Any, Dict, List, Optional, Tuple
from threading import Lock

import requests


def _project_root() -> str:
    here = os.path.abspath(os.path.dirname(__file__))
    return os.path.abspath(os.path.join(here, ".."))


sys.path.insert(0, _project_root())

from python.core.models import ScrollingConfig, ThreadsAccount
from python.automation.scrolling import scroll_feed, scroll_reels
from python.automation.stories import watch_stories
from python.automation.Follow.session import follow_usernames
from python.automation.Follow.common import normalize_range
from python.automation.unfollow.session import unfollow_usernames
from python.automation.approvefollow.session import approve_follow_requests
from python.automation.messaging.session import send_messages
from python.supabase.config import PROJECT_URL, SECRET_KEY
from python.supabase.instagram_accounts_client import InstagramAccountsClient
from python.supabase.profiles_client import SupabaseProfilesClient
from python.supabase.message_templates_client import MessageTemplatesClient
from python.core.worker_utils import (
    apply_count_limit,
    build_action_order,
    create_browser_context,
    create_status_callback,
    get_action_enabled_map,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _configure_stdio() -> None:
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    try:
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


_configure_stdio()

_log_stream_handler = logging.StreamHandler(sys.stdout)
_log_stream_handler.setFormatter(logging.Formatter("%(message)s"))
_log_memory_handler = MemoryHandler(
    capacity=10, flushLevel=logging.ERROR, target=_log_stream_handler
)

_logger = logging.getLogger("instagram_automation")
_logger.handlers.clear()
_logger.addHandler(_log_memory_handler)
_logger.setLevel(logging.INFO)
_logger.propagate = False


def log(message: str) -> None:
    msg = f"[{_now_iso()}] {message}"
    level = logging.INFO
    try:
        normalized = str(message).lstrip().lower()
        if normalized.startswith(("ошибка", "error", "exception")):
            level = logging.ERROR
    except Exception:
        level = logging.INFO
    _logger.log(level, msg)


def emit_event(event_type: str, **data: Any) -> None:
    """Emit structured JSON event for CLI consumption."""
    event = {"type": event_type, "ts": _now_iso(), **data}
    sys.stdout.write(f"__EVENT__{json.dumps(event)}__EVENT__\n")
    sys.stdout.flush()


def _parse_int(value: Any, default: int) -> int:
    try:
        return int(str(value).strip().split()[0])
    except Exception:
        return default


def _parse_float(value: Any, default: float) -> float:
    try:
        return float(str(value).strip().split()[0])
    except Exception:
        return default


def _fetch_profiles_for_lists(list_ids: List[str]) -> List[Dict[str, Any]]:
    if not PROJECT_URL or not SECRET_KEY:
        return []
    if not list_ids:
        return []
    result: List[Dict[str, Any]] = []
    try:
        clean_ids = [str(lid).strip().replace('"', "") for lid in list_ids if str(lid).strip()]
        if not clean_ids:
            return []
        quoted = ",".join([f'"{lid}"' for lid in clean_ids])
        r = requests.get(
            f"{PROJECT_URL}/rest/v1/profiles",
            params={
                "select": "profile_id,name,proxy,user_agent,list_id,created_at",
                "list_id": f"in.({quoted})",
                "order": "created_at.asc",
            },
            headers={
                "apikey": SECRET_KEY,
                "Authorization": f"Bearer {SECRET_KEY}",
                "Accept": "application/json",
            },
            timeout=30,
        )
        data = r.json() if r.status_code < 400 else []
        if isinstance(data, list):
            result.extend(data)
    except Exception:
        return []

    seen = set()
    unique: List[Dict[str, Any]] = []
    for p in result:
        pid = p.get("profile_id")
        if pid and pid not in seen:
            seen.add(pid)
            unique.append(p)
    return unique


class InstagramAutomationRunner:
    def __init__(self, config: ScrollingConfig, accounts: List[ThreadsAccount]):
        self.config = config
        self.accounts = accounts
        self.running = True
        self.accounts_client = InstagramAccountsClient()
        self.profiles_client = SupabaseProfilesClient()
        self._profile_cache: Dict[str, Dict[str, Any]] = {}
        self._profile_cache_lock = Lock()
        configured = int(getattr(self.config, "parallel_profiles", 1) or 1)
        account_count = len(accounts) if accounts else 1
        self._max_workers = max(1, min(account_count, configured))
        self._executor = ThreadPoolExecutor(max_workers=self._max_workers)

    def _get_cached_profile(self, profile_name: str) -> Optional[Dict[str, Any]]:
        with self._profile_cache_lock:
            return self._profile_cache.get(profile_name)

    def _set_cached_profile(self, profile_name: str, profile_data: Dict[str, Any]) -> None:
        with self._profile_cache_lock:
            self._profile_cache[profile_name] = profile_data

    def stop(self) -> None:
        self.running = False
        log("Остановка автоматизации...")
        try:
            self._executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            try:
                self._executor.shutdown(wait=False)
            except Exception:
                pass
        except Exception:
            pass

    def run(self) -> int:
        emit_event("session_started", total_accounts=len(self.accounts))
        if not self.accounts:
            log("Нет профилей для запуска.")
            return 2
        try:
            while self.running:
                work_done_in_cycle = False

                futures = []
                for account in self.accounts:
                    if not self.running:
                        break
                    futures.append(self._executor.submit(self.process_account, account))

                for fut in as_completed(futures):
                    if not self.running:
                        break
                    try:
                        if fut.result():
                            work_done_in_cycle = True
                    except Exception as e:
                        log(f"Ошибка профиля: {e}")

                if not self.running:
                    break

                if work_done_in_cycle:
                    for _ in range(5):
                        if not self.running:
                            break
                        time.sleep(1)
                else:
                    log("Все профили достигли лимита или пропущены. Жду 60 сек...")
                    for _ in range(60):
                        if not self.running:
                            break
                        time.sleep(1)
        finally:
            try:
                self._executor.shutdown(wait=True)
            except Exception:
                pass

        log("Автоматизация остановлена.")
        emit_event("session_ended", status="completed")
        return 0

    def process_account(self, account: ThreadsAccount) -> bool:
        profile_name = account.username
        proxy_str = account.proxy or "None"

        profile_data: Optional[Dict[str, Any]] = self._get_cached_profile(profile_name)
        eligible_message_targets: Optional[List[Dict[str, Any]]] = None
        try:
            if not profile_data:
                profile_data = self.profiles_client.get_profile_by_name(profile_name)
                if profile_data:
                    self._set_cached_profile(profile_name, profile_data)
            if profile_data:
                sessions = int(profile_data.get("sessions_today") or 0)
                if sessions >= self.config.max_sessions_per_day:
                    log(
                        f"Пропуск @{profile_name}: достигнут лимит сессий "
                        f"({sessions}/{self.config.max_sessions_per_day})"
                    )
                    return False

                profile_id = profile_data.get("profile_id")
                if profile_id and self.accounts_client.is_profile_busy(profile_id):
                    log(f"Пропуск @{profile_name}: профиль занят.")
                    return False

                last_opened_str = profile_data.get("last_opened_at")
                if (
                    last_opened_str
                    and getattr(self.config, "profile_reopen_cooldown_enabled", True)
                    and int(getattr(self.config, "profile_reopen_cooldown_minutes", 30) or 0) > 0
                ):
                    s = str(last_opened_str).replace("Z", "+00:00")
                    last_dt = datetime.fromisoformat(s)
                    if not last_dt.tzinfo:
                        last_dt = last_dt.replace(tzinfo=timezone.utc)
                    now = datetime.now(timezone.utc)
                    cooldown_min = int(getattr(self.config, "profile_reopen_cooldown_minutes", 30) or 0)
                    if now - last_dt < timedelta(minutes=cooldown_min):
                        log(f"Пропуск @{profile_name}: недавно открыт (<{cooldown_min} мин).")
                        return False
        except Exception as e:
            log(f"Ошибка проверки сессий для @{profile_name}: {e}")
            return False

        try:
            enabled_map = get_action_enabled_map(self.config)
            only_messages = enabled_map.get("Send Messages", False) and sum(1 for v in enabled_map.values() if v) == 1
            if only_messages:
                pid = profile_data.get("profile_id") if profile_data else None
                if not pid:
                    log(f"@{profile_name}: профиль не найден в БД, пропуск запуска браузера.")
                    return False
                targets = self.accounts_client.get_accounts_to_message(pid)
                if not targets:
                    log(f"@{profile_name}: нет целей для сообщений (message=true), не открываю браузер.")
                    return False
                now = datetime.now(timezone.utc)
                eligible = []
                for t in targets:
                    ts = t.get("last_message_sent_at")
                    if not ts:
                        eligible.append(t)
                        continue
                    try:
                        s = str(ts).replace("Z", "+00:00")
                        dt = datetime.fromisoformat(s)
                        if not dt.tzinfo:
                            dt = dt.replace(tzinfo=timezone.utc)
                        cooldown_enabled = bool(getattr(self.config, "messaging_cooldown_enabled", True))
                        cooldown_hours = int(getattr(self.config, "messaging_cooldown_hours", 2) or 0)
                        if not cooldown_enabled or cooldown_hours <= 0:
                            eligible.append(t)
                        elif now - dt >= timedelta(hours=cooldown_hours):
                            eligible.append(t)
                    except Exception:
                        eligible.append(t)
                if not eligible:
                    log(f"@{profile_name}: все цели недавно получили сообщение, не открываю браузер.")
                    return False
                eligible_message_targets = eligible
        except Exception:
            pass

        user_agent = None
        try:
            if profile_data:
                user_agent = profile_data.get("user_agent")
        except Exception:
            user_agent = None

        log(f"Запуск браузера для @{profile_name}...")
        emit_event("profile_started", profile=profile_name)
        try:
            try:
                self.profiles_client.sync_profile_status(profile_name, "running", True)
            except Exception:
                pass
            try:
                if profile_data is not None:
                    profile_data["last_opened_at"] = datetime.now(timezone.utc).isoformat()
            except Exception:
                pass

            with create_browser_context(profile_name, proxy_str, user_agent, headless=self.config.headless) as (_context, page):
                actions_map = {
                    "Feed Scroll": lambda: self._run_scrolling(page, mode="feed"),
                    "Reels Scroll": lambda: self._run_scrolling(page, mode="reels"),
                    "Watch Stories": lambda: self._run_stories(page),
                    "Follow": lambda: self._run_follow(page, account, profile_data),
                    "Unfollow": lambda: self._run_unfollow_only(page, account, profile_data),
                    "Approve Requests": lambda: self._run_approve_only(page, account),
                    "Send Messages": lambda: self._run_message_only(page, account, profile_data, eligible_message_targets),
                }

                order = build_action_order(self.config)
                enabled_map = get_action_enabled_map(self.config)

                for action_name in order:
                    if not self.running:
                        break
                    if action_name in actions_map and enabled_map.get(action_name, False):
                        emit_event("task_started", profile=profile_name, task=action_name)
                        actions_map[action_name]()
                        if self.running:
                            time.sleep(random.randint(3, 7))

                if self.running:
                    log(f"Все задачи завершены для @{profile_name}")
                    emit_event("profile_completed", profile=profile_name, status="success")
                    try:
                        self.profiles_client.increment_sessions_today(profile_name)
                    except Exception as e:
                        log(f"Не удалось обновить счетчик сессий: {e}")
                    try:
                        if profile_data is not None:
                            profile_data["sessions_today"] = int(profile_data.get("sessions_today") or 0) + 1
                    except Exception:
                        pass

                try:
                    self.profiles_client.sync_profile_status(profile_name, "idle", False)
                except Exception:
                    pass

                return True
        except Exception as e:
            log(f"Ошибка @{profile_name}: {e}")
            try:
                self.profiles_client.sync_profile_status(profile_name, "idle", False)
            except Exception:
                pass
            return False

    def _run_scrolling(self, page, mode: str) -> None:
        try:
            duration = 0
            if mode == "feed" and self.config.enable_feed:
                duration = random.randint(self.config.feed_min_time_minutes, self.config.feed_max_time_minutes)
            elif mode == "reels" and self.config.enable_reels:
                duration = random.randint(self.config.reels_min_time_minutes, self.config.reels_max_time_minutes)
            if duration <= 0:
                return

            config = {
                "like_chance": self.config.like_chance if mode == "feed" else self.config.reels_like_chance,
                "comment_chance": self.config.comment_chance,
                "follow_chance": self.config.follow_chance if mode == "feed" else self.config.reels_follow_chance,
                "reels_skip_chance": self.config.reels_skip_chance,
                "reels_skip_min_time": self.config.reels_skip_min_time,
                "reels_skip_max_time": self.config.reels_skip_max_time,
                "reels_normal_min_time": self.config.reels_normal_min_time,
                "reels_normal_max_time": self.config.reels_normal_max_time,
                "carousel_watch_chance": self.config.carousel_watch_chance,
                "carousel_max_slides": self.config.carousel_max_slides,
                "watch_stories": self.config.watch_stories,
                "stories_max": self.config.stories_max,
            }

            if mode == "feed":
                log(f"Feed: {duration} мин")
                scroll_feed(page, duration, config, should_stop=lambda: not self.running)
            else:
                log(f"Reels: {duration} мин")
                scroll_reels(page, duration, config, should_stop=lambda: not self.running)
        except Exception as e:
            log(f"Ошибка скроллинга: {e}")

    def _run_stories(self, page) -> None:
        try:
            max_stories = self.config.stories_max if isinstance(self.config.stories_max, int) else 3
            log(f"Stories (max {max_stories})")
            watch_stories(page, max_stories=max_stories, log=log)
        except Exception as e:
            log(f"Ошибка Stories: {e}")

    def _run_follow(self, page, account: ThreadsAccount, profile_data: Optional[Dict[str, Any]] = None) -> None:
        try:
            log("Follow...")
            profile_id = profile_data.get("profile_id") if profile_data else None
            if not profile_id:
                profiles = self.accounts_client.get_profiles_with_assigned_accounts()
                fallback = next((p for p in profiles if p.get("name") == account.username), None)
                profile_id = fallback.get("profile_id") if fallback else None
            if not profile_id:
                log("Не найден профиль в БД.")
                return
            accounts = self.accounts_client.get_accounts_for_profile(profile_id)
            usernames = [acc.get("user_name") for acc in accounts if acc.get("user_name")]
            account_map = {acc["user_name"]: acc["id"] for acc in accounts if acc.get("id") and acc.get("user_name")}
            if not usernames:
                log("Нет целей для подписки.")
                return

            usernames = apply_count_limit(usernames, self.config.follow_count_range)
            if self.config.follow_count_range:
                log(f"Лимит Follow за сессию: {len(usernames)}")

            interactions_config = {
                "highlights_range": self.config.highlights_range,
                "likes_percentage": self.config.likes_percentage,
                "scroll_percentage": self.config.scroll_percentage,
            }

            on_follow_success = create_status_callback(
                self.accounts_client,
                account_map,
                log,
                "subscribed",
                success_message="Статус @{username} -> 'subscribed'.",
            )
            on_follow_skip = create_status_callback(
                self.accounts_client,
                account_map,
                log,
                "skipped",
                clear_assigned=True,
                success_message="Пропуск @{username}: 'skipped', снято назначение.",
            )

            follow_usernames(
                profile_name=account.username,
                proxy_string=account.proxy or "",
                usernames=usernames,
                log=log,
                should_stop=lambda: not self.running,
                page=page,
                interactions_config=interactions_config,
                following_limit=self.config.following_limit,
                on_success=on_follow_success,
                on_skip=on_follow_skip,
            )
        except Exception as e:
            log(f"Ошибка Follow: {e}")

    def _run_unfollow_only(self, page, account: ThreadsAccount, profile_data: Optional[Dict[str, Any]] = None) -> None:
        try:
            log("Unfollow...")
            delay_range = self.config.unfollow_delay_range or (10, 30)
            profile_id = profile_data.get("profile_id") if profile_data else None
            if not profile_id:
                profiles = self.accounts_client.get_profiles_with_assigned_accounts(status="unsubscribed")
                fallback = next((p for p in profiles if p.get("name") == account.username), None)
                profile_id = fallback.get("profile_id") if fallback else None
            if not profile_id:
                log("Нет данных профиля для отписки.")
                return
            accounts = self.accounts_client.get_accounts_for_profile(profile_id, status="unsubscribed")
            if not accounts:
                log("Нет назначенных аккаунтов для отписки.")
                return
            usernames = [acc.get("user_name") for acc in accounts if acc.get("user_name")]
            account_map = {acc["user_name"]: acc["id"] for acc in accounts if acc.get("id") and acc.get("user_name")}

            usernames = apply_count_limit(usernames, self.config.unfollow_count_range)
            if self.config.unfollow_count_range:
                log(f"Лимит Unfollow за сессию: {len(usernames)}")

            on_unfollow_success = create_status_callback(self.accounts_client, account_map, log, "done", clear_assigned=True)
            unfollow_usernames(
                profile_name=account.username,
                proxy_string=account.proxy or "",
                usernames=usernames,
                log=log,
                should_stop=lambda: not self.running,
                delay_range=delay_range,
                on_success=on_unfollow_success,
                page=page,
            )
        except Exception as e:
            log(f"Ошибка Unfollow: {e}")

    def _run_approve_only(self, page, account: ThreadsAccount) -> None:
        try:
            log("Approve Requests...")
            approve_follow_requests(
                profile_name=account.username,
                proxy_string=account.proxy or "",
                log=log,
                should_stop=lambda: not self.running,
                page=page,
            )
        except Exception as e:
            log(f"Ошибка Approve: {e}")

    def _run_message_only(
        self,
        page,
        account: ThreadsAccount,
        profile_data: Optional[Dict[str, Any]] = None,
        cached_targets: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        try:
            log("Messaging...")
            profile_id = profile_data.get("profile_id") if profile_data else None
            if not profile_id:
                profiles = self.accounts_client.get_profiles_with_assigned_accounts()
                fallback = next((p for p in profiles if p.get("name") == account.username), None)
                profile_id = fallback.get("profile_id") if fallback else None
            if not profile_id:
                log("Не найден профиль для сообщений.")
                return

            if cached_targets is not None:
                eligible = cached_targets
            else:
                targets = self.accounts_client.get_accounts_to_message(profile_id)
                if not targets:
                    log("Нет целей для сообщений.")
                    return
            now = datetime.now(timezone.utc)
            if cached_targets is None:
                eligible = []
                for t in targets:
                    ts = t.get("last_message_sent_at")
                    if not ts:
                        eligible.append(t)
                        continue
                    try:
                        s = str(ts).replace("Z", "+00:00")
                        dt = datetime.fromisoformat(s)
                        if not dt.tzinfo:
                            dt = dt.replace(tzinfo=timezone.utc)
                        cooldown_enabled = bool(getattr(self.config, "messaging_cooldown_enabled", True))
                        cooldown_hours = int(getattr(self.config, "messaging_cooldown_hours", 2) or 0)
                        if not cooldown_enabled or cooldown_hours <= 0:
                            eligible.append(t)
                        elif now - dt >= timedelta(hours=cooldown_hours):
                            eligible.append(t)
                    except Exception:
                        eligible.append(t)
            if not eligible:
                log("Нет целей для сообщений из-за кулдауна.")
                return
            message_texts = self.config.message_texts or ["Hi!"]
            send_messages(
                profile_name=account.username,
                proxy_string=account.proxy or "",
                targets=eligible,
                message_texts=message_texts,
                cooldown_enabled=bool(getattr(self.config, "messaging_cooldown_enabled", True)),
                cooldown_hours=int(getattr(self.config, "messaging_cooldown_hours", 2) or 0),
                log=log,
                should_stop=lambda: not self.running,
                page=page,
            )
        except Exception as e:
            log(f"Ошибка Messaging: {e}")


def _build_config(settings: Dict[str, Any], message_texts: List[str]) -> ScrollingConfig:
    like_chance = _parse_int(settings.get("like_chance"), 10)
    carousel_watch_chance = _parse_int(settings.get("carousel_watch_chance"), 0)
    follow_chance = _parse_int(settings.get("follow_chance"), 50)
    reels_like_chance = _parse_int(settings.get("reels_like_chance"), 10)
    reels_follow_chance = _parse_int(settings.get("reels_follow_chance"), 50)
    reels_skip_chance = _parse_int(settings.get("reels_skip_chance"), 30)

    reels_skip_min_time = _parse_float(settings.get("reels_skip_min_time"), 0.8)
    reels_skip_max_time = _parse_float(settings.get("reels_skip_max_time"), 2.0)
    reels_normal_min_time = _parse_float(settings.get("reels_normal_min_time"), 5.0)
    reels_normal_max_time = _parse_float(settings.get("reels_normal_max_time"), 20.0)

    feed_min_time = _parse_int(settings.get("feed_min_time_minutes", settings.get("min_time_minutes")), 1)
    feed_max_time = _parse_int(settings.get("feed_max_time_minutes", settings.get("max_time_minutes")), 3)
    reels_min_time = _parse_int(settings.get("reels_min_time_minutes"), 1)
    reels_max_time = _parse_int(settings.get("reels_max_time_minutes"), 3)

    max_sessions = _parse_int(settings.get("max_sessions"), 5)
    parallel_profiles = _parse_int(settings.get("parallel_profiles"), 1)

    carousel_max_slides = _parse_int(settings.get("carousel_max_slides"), 3)
    stories_max = _parse_int(settings.get("stories_max"), 3)

    highlights_min = _parse_int(settings.get("highlights_min"), 2)
    highlights_max = _parse_int(settings.get("highlights_max"), 4)
    likes_percentage = _parse_int(settings.get("likes_percentage"), 0)
    scroll_percentage = _parse_int(settings.get("scroll_percentage"), 0)
    following_limit = _parse_int(settings.get("following_limit"), 3000)

    follow_min_count = _parse_int(settings.get("follow_min_count"), 5)
    follow_max_count = _parse_int(settings.get("follow_max_count"), 15)
    unfollow_min_delay = _parse_int(settings.get("min_delay"), 10)
    unfollow_max_delay = _parse_int(settings.get("max_delay"), 30)
    unfollow_min_count = _parse_int(settings.get("unfollow_min_count"), 5)
    unfollow_max_count = _parse_int(settings.get("unfollow_max_count"), 15)

    feed_min_time, feed_max_time = normalize_range((feed_min_time, feed_max_time), (1, 3))
    reels_min_time, reels_max_time = normalize_range((reels_min_time, reels_max_time), (1, 3))
    highlights_min, highlights_max = normalize_range((highlights_min, highlights_max), (2, 4))
    follow_min_count, follow_max_count = normalize_range((follow_min_count, follow_max_count), (5, 15))
    unfollow_min_delay, unfollow_max_delay = normalize_range((unfollow_min_delay, unfollow_max_delay), (10, 30))
    unfollow_min_count, unfollow_max_count = normalize_range((unfollow_min_count, unfollow_max_count), (5, 15))

    action_order = settings.get("action_order")
    if not isinstance(action_order, list):
        action_order = []

    profile_reopen_cooldown_enabled = bool(settings.get("profile_reopen_cooldown_enabled", True))
    profile_reopen_cooldown_minutes = _parse_int(settings.get("profile_reopen_cooldown_minutes"), 30)
    messaging_cooldown_enabled = bool(settings.get("messaging_cooldown_enabled", True))
    messaging_cooldown_hours = _parse_int(settings.get("messaging_cooldown_hours"), 2)

    return ScrollingConfig(
        use_private_profiles=True,
        use_threads_profiles=False,
        action_order=[str(a) for a in action_order if str(a).strip()],
        like_chance=like_chance,
        comment_chance=0,
        follow_chance=follow_chance,
        reels_like_chance=reels_like_chance,
        reels_follow_chance=reels_follow_chance,
        reels_skip_chance=reels_skip_chance,
        reels_skip_min_time=reels_skip_min_time,
        reels_skip_max_time=reels_skip_max_time,
        reels_normal_min_time=reels_normal_min_time,
        reels_normal_max_time=reels_normal_max_time,
        min_time_minutes=feed_min_time,
        max_time_minutes=feed_max_time,
        feed_min_time_minutes=feed_min_time,
        feed_max_time_minutes=feed_max_time,
        reels_min_time_minutes=reels_min_time,
        reels_max_time_minutes=reels_max_time,
        max_sessions_per_day=max_sessions,
        parallel_profiles=parallel_profiles,
        enable_feed=bool(settings.get("enable_feed")),
        enable_reels=bool(settings.get("enable_reels")),
        enable_follow=bool(settings.get("enable_follow")),
        enable_unfollow=bool(settings.get("do_unfollow")),
        enable_approve=bool(settings.get("do_approve")),
        enable_message=bool(settings.get("do_message")),
        carousel_watch_chance=carousel_watch_chance,
        carousel_max_slides=carousel_max_slides,
        watch_stories=bool(settings.get("watch_stories")),
        stories_max=stories_max,
        highlights_range=(highlights_min, highlights_max),
        likes_percentage=likes_percentage,
        scroll_percentage=scroll_percentage,
        following_limit=following_limit,
        follow_count_range=(follow_min_count, follow_max_count),
        unfollow_delay_range=(unfollow_min_delay, unfollow_max_delay),
        message_texts=message_texts,
        headless=bool(settings.get("headless")),
        profile_reopen_cooldown_enabled=profile_reopen_cooldown_enabled,
        profile_reopen_cooldown_minutes=profile_reopen_cooldown_minutes,
        messaging_cooldown_enabled=messaging_cooldown_enabled,
        messaging_cooldown_hours=messaging_cooldown_hours,
    )


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        log("Не получены входные данные.")
        return 2
    try:
        payload = json.loads(raw)
    except Exception as e:
        log(f"Некорректный JSON: {e}")
        return 2

    settings = payload.get("settings") if isinstance(payload, dict) else None
    if not isinstance(settings, dict):
        log("settings должен быть объектом.")
        return 2

    selected_list_ids = settings.get("source_list_ids") or payload.get("source_list_ids") or []
    if not isinstance(selected_list_ids, list):
        selected_list_ids = []
    selected_list_ids = [str(x) for x in selected_list_ids if str(x).strip()]

    enable_any = any(
        [
            bool(settings.get("enable_feed")),
            bool(settings.get("enable_reels")),
            bool(settings.get("watch_stories")),
            bool(settings.get("enable_follow")),
            bool(settings.get("do_unfollow")),
            bool(settings.get("do_approve")),
            bool(settings.get("do_message")),
        ]
    )
    if not enable_any:
        log("Выберите хотя бы один тип активности!")
        return 2

    if not selected_list_ids:
        log("Выберите список профилей!")
        return 2

    profiles = _fetch_profiles_for_lists(selected_list_ids)
    if not profiles:
        log("В выбранном списке нет профилей!")
        return 2

    target_accounts: List[ThreadsAccount] = []
    for p in profiles:
        name = p.get("name")
        if not name:
            continue
        target_accounts.append(ThreadsAccount(username=name, password="", proxy=p.get("proxy")))

    if not target_accounts:
        log("В выбранном списке нет валидных профилей!")
        return 2

    message_texts: List[str] = []
    if bool(settings.get("do_message")):
        try:
            message_texts = MessageTemplatesClient().get_texts("message") or []
        except Exception:
            message_texts = []

    config = _build_config(settings, message_texts)
    if bool(settings.get("do_unfollow")):
        config.unfollow_count_range = normalize_range(
            (
                _parse_int(settings.get("unfollow_min_count"), 5),
                _parse_int(settings.get("unfollow_max_count"), 15),
            ),
            (5, 15),
        )

    tasks = []
    if config.enable_feed:
        tasks.append("Feed")
    if config.enable_reels:
        tasks.append("Reels")
    if config.watch_stories:
        tasks.append("Stories")
    if config.enable_follow:
        tasks.append("Follow")
    if config.enable_unfollow:
        tasks.append("Unfollow")
    if config.enable_approve:
        tasks.append("Approve")
    if config.enable_message:
        tasks.append("Message")

    log(f"Запуск полного цикла ({', '.join(tasks)}) для {len(target_accounts)} профилей...")

    runner = InstagramAutomationRunner(config, target_accounts)

    def _handle_signal(_sig, _frame):
        runner.stop()

    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_signal)

    return runner.run()


if __name__ == "__main__":
    raise SystemExit(main())
