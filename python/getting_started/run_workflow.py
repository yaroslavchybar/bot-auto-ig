import json
import os
import random
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import logging
from typing import Any, Dict, List, Optional, Tuple
from threading import Lock


def _project_root() -> str:
    here = os.path.abspath(os.path.dirname(__file__))
    return os.path.abspath(os.path.join(here, "..", ".."))


sys.path.insert(0, _project_root())

from python.internal_systems.data_models.models import ThreadsAccount
from python.instagram_actions.browsing import scroll_feed, scroll_reels
from python.instagram_actions.stories import watch_stories
from python.instagram_actions.engagement.follow_users.session import follow_usernames
from python.instagram_actions.engagement.follow_users.common import normalize_range
from python.instagram_actions.engagement.unfollow_users.session import unfollow_usernames
from python.instagram_actions.engagement.approve_follow_requests.session import approve_follow_requests
from python.instagram_actions.messaging.session import send_messages
from python.database_sync.config import PROJECT_URL, SECRET_KEY
from python.database_sync.accounts_client import InstagramAccountsClient
from python.database_sync.profiles_client import ProfilesClient
from python.database_sync.messages_client import MessageTemplatesClient
from python.internal_systems.shared_utilities.worker_utils import (
    apply_count_limit,
    create_browser_context,
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

_logger = logging.getLogger("workflow_runner")
_logger.handlers.clear()
_logger.addHandler(_log_stream_handler)
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
    sys.stdout.flush()


def emit_event(event_type: str, **data: Any) -> None:
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
    if not PROJECT_URL:
        return []
    clean_ids = [str(lid).strip().replace('"', "") for lid in list_ids if str(lid).strip()]
    if not clean_ids:
        return []

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if SECRET_KEY:
        headers["Authorization"] = f"Bearer {SECRET_KEY}"
    try:
        import requests

        r = requests.post(
            f"{PROJECT_URL}/api/profiles/by-list-ids",
            json={"listIds": clean_ids},
            headers=headers,
            timeout=30,
        )
        data = r.json() if r.status_code < 400 else []
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _find_start_node(nodes: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for n in nodes:
        if n.get("type") == "start":
            return n
    for n in nodes:
        if str(n.get("id")) == "start_node":
            return n
    return None


def _build_edge_index(edges: List[Dict[str, Any]]) -> Dict[Tuple[str, str], List[str]]:
    out: Dict[Tuple[str, str], List[str]] = {}
    for e in edges:
        src = str(e.get("source") or "")
        tgt = str(e.get("target") or "")
        if not src or not tgt:
            continue
        handle = str(e.get("sourceHandle") or "")
        key = (src, handle)
        out.setdefault(key, []).append(tgt)
    return out


def _next_node(edge_index: Dict[Tuple[str, str], List[str]], node_id: str, handle: str) -> Optional[str]:
    candidates = edge_index.get((node_id, handle))
    if candidates:
        return candidates[0]
    if handle:
        candidates2 = edge_index.get((node_id, ""))
        if candidates2:
            return candidates2[0]
    return None


def _choose_weighted(handles: List[str], weights_str: str) -> str:
    weights = []
    try:
        parts = [p.strip() for p in str(weights_str or "").split(",") if p.strip()]
        weights = [max(0.0, float(p)) for p in parts]
    except Exception:
        weights = []
    if len(weights) < len(handles):
        weights = weights + [1.0] * (len(handles) - len(weights))
    weights = weights[: len(handles)]
    total = sum(weights)
    if total <= 0:
        return random.choice(handles)
    r = random.random() * total
    acc = 0.0
    for h, w in zip(handles, weights):
        acc += w
        if r <= acc:
            return h
    return handles[-1]


class WorkflowRunner:
    def __init__(self, workflow_id: str, nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]], accounts: List[ThreadsAccount], options: Dict[str, Any]):
        self.workflow_id = workflow_id
        self.nodes = nodes
        self.edges = edges
        self.node_index = {str(n.get("id")): n for n in nodes if n.get("id")}
        self.edge_index = _build_edge_index(edges)
        self.accounts = accounts
        self.running = True
        self.headless = bool(options.get("headless"))
        self.accounts_client = InstagramAccountsClient()
        self.profiles_client = ProfilesClient()
        self._profile_cache: Dict[str, Dict[str, Any]] = {}
        self._profile_cache_lock = Lock()
        configured = _parse_int(options.get("parallel_profiles"), 1)
        account_count = len(accounts) if accounts else 1
        self._max_workers = max(1, min(account_count, configured))
        self._executor = ThreadPoolExecutor(max_workers=self._max_workers)

    def stop(self) -> None:
        self.running = False
        try:
            self._executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            try:
                self._executor.shutdown(wait=False)
            except Exception:
                pass
        except Exception:
            pass

    def _get_cached_profile(self, name: str) -> Optional[Dict[str, Any]]:
        with self._profile_cache_lock:
            return self._profile_cache.get(name)

    def _set_cached_profile(self, name: str, data: Dict[str, Any]) -> None:
        with self._profile_cache_lock:
            self._profile_cache[name] = data

    def run(self) -> int:
        emit_event("session_started", total_accounts=len(self.accounts), workflow_id=self.workflow_id)
        if not self.accounts:
            log("Нет профилей для запуска.")
            emit_event("session_ended", status="failed", workflow_id=self.workflow_id)
            return 2

        try:
            futures = []
            for account in self.accounts:
                if not self.running:
                    break
                futures.append(self._executor.submit(self.process_account, account))

            for fut in as_completed(futures):
                if not self.running:
                    break
                try:
                    fut.result()
                except Exception as e:
                    log(f"Ошибка профиля: {e}")
        finally:
            try:
                self._executor.shutdown(wait=True)
            except Exception:
                pass

        emit_event("session_ended", status="completed" if self.running else "cancelled", workflow_id=self.workflow_id)
        return 0

    def process_account(self, account: ThreadsAccount) -> bool:
        profile_name = account.username
        proxy_str = account.proxy or "None"

        profile_data: Optional[Dict[str, Any]] = self._get_cached_profile(profile_name)
        try:
            if not profile_data:
                profile_data = self.profiles_client.get_profile_by_name(profile_name)
                if profile_data:
                    self._set_cached_profile(profile_name, profile_data)
        except Exception:
            profile_data = profile_data

        user_agent = None
        try:
            if profile_data:
                user_agent = profile_data.get("user_agent")
        except Exception:
            user_agent = None

        emit_event("profile_started", profile=profile_name, workflow_id=self.workflow_id)

        try:
            try:
                self.profiles_client.sync_profile_status(profile_name, "running", True)
            except Exception:
                pass

            with create_browser_context(profile_name, proxy_str, user_agent, headless=self.headless) as (_context, page):
                start_node = _find_start_node(self.nodes)
                if not start_node:
                    log("Не найден start node")
                    return False
                start_id = str(start_node.get("id"))
                current = _next_node(self.edge_index, start_id, "")
                loop_state: Dict[str, int] = {}
                visited_steps = 0

                activity_nodes = [n for n in self.nodes if n.get("type") == "activity"]
                total_steps = max(1, len(activity_nodes))
                completed_steps = 0

                while self.running and current:
                    visited_steps += 1
                    if visited_steps > 500:
                        log("Превышен лимит шагов workflow")
                        break

                    node = self.node_index.get(current)
                    if not node:
                        break

                    node_type = node.get("type")
                    if node_type == "start":
                        current = _next_node(self.edge_index, str(node.get("id")), "")
                        continue

                    data = node.get("data") if isinstance(node.get("data"), dict) else {}
                    activity_id = str(data.get("activityId") or "")
                    label = str(data.get("label") or activity_id or node.get("id") or "")
                    config = data.get("config") if isinstance(data.get("config"), dict) else {}

                    progress = int(round(100.0 * min(1.0, float(completed_steps) / float(total_steps))))
                    emit_event(
                        "task_started",
                        profile=profile_name,
                        task=label,
                        workflow_id=self.workflow_id,
                        node_id=str(node.get("id")),
                        progress=progress,
                    )

                    handle = self._execute_activity(str(node.get("id")), activity_id, config, page, account, profile_data, loop_state)

                    if node_type == "activity":
                        completed_steps += 1

                    next_id = _next_node(self.edge_index, str(node.get("id")), str(handle or ""))
                    current = next_id
                    if self.running and current:
                        time.sleep(random.randint(1, 3))

            if self.running:
                emit_event("profile_completed", profile=profile_name, status="success", workflow_id=self.workflow_id)
            try:
                self.profiles_client.sync_profile_status(profile_name, "idle", False)
            except Exception:
                pass
            return True
        except Exception as e:
            if not self.running:
                emit_event("profile_completed", profile=profile_name, status="cancelled", workflow_id=self.workflow_id)
                try:
                    self.profiles_client.sync_profile_status(profile_name, "idle", False)
                except Exception:
                    pass
                return False

            msg = str(e)
            if "Target page, context or browser has been closed" in msg:
                emit_event("profile_completed", profile=profile_name, status="cancelled", workflow_id=self.workflow_id)
                try:
                    self.profiles_client.sync_profile_status(profile_name, "idle", False)
                except Exception:
                    pass
                log(f"Остановлено @{profile_name}")
                return False

            log(f"Ошибка @{profile_name}: {e}")
            try:
                self.profiles_client.sync_profile_status(profile_name, "idle", False)
            except Exception:
                pass
            return False

    def _execute_activity(
        self,
        node_id: str,
        activity_id: str,
        cfg: Dict[str, Any],
        page,
        account: ThreadsAccount,
        profile_data: Optional[Dict[str, Any]],
        loop_state: Dict[str, int],
    ) -> str:
        try:
            if activity_id == "browse_feed":
                min_t = _parse_int(cfg.get("feed_min_time_minutes"), 1)
                max_t = _parse_int(cfg.get("feed_max_time_minutes"), 3)
                min_t, max_t = normalize_range((min_t, max_t), (1, 3))
                duration = random.randint(min_t, max_t)
                config = {
                    "like_chance": _parse_int(cfg.get("like_chance"), 10),
                    "comment_chance": 0,
                    "follow_chance": _parse_int(cfg.get("follow_chance"), 0),
                    "carousel_watch_chance": _parse_int(cfg.get("carousel_watch_chance"), 0),
                    "carousel_max_slides": _parse_int(cfg.get("carousel_max_slides"), 3),
                    "watch_stories": False,
                    "stories_max": 0,
                }
                scroll_feed(page, duration, config, should_stop=lambda: not self.running)
                return "success"

            if activity_id == "browse_reels":
                min_t = _parse_int(cfg.get("reels_min_time_minutes"), 1)
                max_t = _parse_int(cfg.get("reels_max_time_minutes"), 3)
                min_t, max_t = normalize_range((min_t, max_t), (1, 3))
                duration = random.randint(min_t, max_t)
                config = {
                    "like_chance": _parse_int(cfg.get("reels_like_chance"), 10),
                    "comment_chance": 0,
                    "follow_chance": _parse_int(cfg.get("reels_follow_chance"), 0),
                    "reels_skip_chance": _parse_int(cfg.get("reels_skip_chance"), 30),
                    "reels_skip_min_time": _parse_float(cfg.get("reels_skip_min_time"), 0.8),
                    "reels_skip_max_time": _parse_float(cfg.get("reels_skip_max_time"), 2.0),
                    "reels_normal_min_time": _parse_float(cfg.get("reels_normal_min_time"), 5.0),
                    "reels_normal_max_time": _parse_float(cfg.get("reels_normal_max_time"), 20.0),
                    "watch_stories": False,
                    "stories_max": 0,
                }
                scroll_reels(page, duration, config, should_stop=lambda: not self.running)
                return "success"

            if activity_id == "watch_stories":
                max_stories = _parse_int(cfg.get("stories_max"), 3)
                watch_stories(page, max_stories=max_stories, log=log)
                return "success"

            if activity_id == "follow_user":
                profile_id = profile_data.get("profile_id") if profile_data else None
                if not profile_id:
                    profiles = self.accounts_client.get_profiles_with_assigned_accounts()
                    fallback = next((p for p in profiles if p.get("name") == account.username), None)
                    profile_id = fallback.get("profile_id") if fallback else None
                if not profile_id:
                    return "failure"
                accounts = self.accounts_client.get_accounts_for_profile(profile_id)
                usernames = [acc.get("user_name") for acc in accounts if acc.get("user_name")]
                account_map = {acc["user_name"]: acc["id"] for acc in accounts if acc.get("id") and acc.get("user_name")}
                if not usernames:
                    return "failure"
                follow_min = _parse_int(cfg.get("follow_min_count"), 5)
                follow_max = _parse_int(cfg.get("follow_max_count"), 15)
                follow_min, follow_max = normalize_range((follow_min, follow_max), (5, 15))
                usernames = apply_count_limit(usernames, (follow_min, follow_max))
                highlights_min = _parse_int(cfg.get("highlights_min"), 0)
                highlights_max = _parse_int(cfg.get("highlights_max"), 2)
                highlights_min, highlights_max = normalize_range((highlights_min, highlights_max), (0, 2))
                interactions_config = {
                    "highlights_range": (highlights_min, highlights_max),
                    "likes_percentage": _parse_int(cfg.get("likes_percentage"), 0),
                    "scroll_percentage": _parse_int(cfg.get("scroll_percentage"), 0),
                    "following_limit": _parse_int(cfg.get("following_limit"), 3000),
                }
                follow_usernames(
                    profile_name=account.username,
                    proxy_string=account.proxy or "",
                    usernames=usernames,
                    account_map=account_map,
                    interactions_config=interactions_config,
                    log=log,
                    should_stop=lambda: not self.running,
                    page=page,
                )
                return "success"

            if activity_id == "unfollow_user":
                unfollow_min_delay = _parse_int(cfg.get("min_delay"), 10)
                unfollow_max_delay = _parse_int(cfg.get("max_delay"), 30)
                unfollow_min_delay, unfollow_max_delay = normalize_range((unfollow_min_delay, unfollow_max_delay), (10, 30))
                unfollow_min_count = _parse_int(cfg.get("unfollow_min_count"), 5)
                unfollow_max_count = _parse_int(cfg.get("unfollow_max_count"), 15)
                unfollow_min_count, unfollow_max_count = normalize_range((unfollow_min_count, unfollow_max_count), (5, 15))
                unfollow_usernames(
                    profile_name=account.username,
                    proxy_string=account.proxy or "",
                    min_delay=unfollow_min_delay,
                    max_delay=unfollow_max_delay,
                    count_range=(unfollow_min_count, unfollow_max_count),
                    log=log,
                    should_stop=lambda: not self.running,
                    page=page,
                )
                return "success"

            if activity_id == "approve_requests":
                approve_follow_requests(
                    profile_name=account.username,
                    proxy_string=account.proxy or "",
                    log=log,
                    should_stop=lambda: not self.running,
                    page=page,
                )
                return "success"

            if activity_id == "send_dm":
                template_kind = str(cfg.get("template_kind") or "message").strip() or "message"
                try:
                    message_texts = MessageTemplatesClient().get_texts(template_kind) or []
                except Exception:
                    message_texts = []
                if not message_texts:
                    message_texts = ["Hi!"]

                profile_id = profile_data.get("profile_id") if profile_data else None
                if not profile_id:
                    profiles = self.accounts_client.get_profiles_with_assigned_accounts()
                    fallback = next((p for p in profiles if p.get("name") == account.username), None)
                    profile_id = fallback.get("profile_id") if fallback else None
                if not profile_id:
                    return "failure"
                targets = self.accounts_client.get_accounts_to_message(profile_id)
                if not targets:
                    return "failure"
                send_messages(
                    profile_name=account.username,
                    proxy_string=account.proxy or "",
                    targets=targets,
                    message_texts=message_texts,
                    cooldown_enabled=True,
                    cooldown_hours=2,
                    log=log,
                    should_stop=lambda: not self.running,
                    page=page,
                )
                return "success"

            if activity_id == "delay":
                min_s = _parse_int(cfg.get("minSeconds"), 30)
                max_s = _parse_int(cfg.get("maxSeconds"), 120)
                min_s = max(1, min_s)
                max_s = max(min_s, max_s)
                time.sleep(random.randint(min_s, max_s))
                return "next"

            if activity_id == "condition":
                check = str(cfg.get("check") or "random").strip().lower()
                value = str(cfg.get("value") or "").strip()
                if check == "random":
                    pct = _parse_int(value, 50)
                    pct = max(0, min(100, pct))
                    return "true" if random.randint(1, 100) <= pct else "false"
                return "true"

            if activity_id == "loop":
                iterations = _parse_int(cfg.get("iterations"), 3)
                iterations = max(1, min(100, iterations))
                key = str(node_id or "loop")
                current_iter = loop_state.get(key, 0) + 1
                loop_state[key] = current_iter
                if current_iter < iterations:
                    return "loop"
                loop_state[key] = 0
                return "done"

            if activity_id == "random_branch":
                handles = ["path_a", "path_b", "path_c"]
                selected = _choose_weighted(handles, str(cfg.get("weights") or ""))
                return selected

            return "success"
        except Exception as e:
            log(f"Ошибка activity {activity_id}: {e}")
            return "failure"


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

    if not isinstance(payload, dict):
        log("payload должен быть объектом")
        return 2

    workflow_id = str(payload.get("workflowId") or payload.get("workflow_id") or "").strip()
    workflow = payload.get("workflow") if isinstance(payload.get("workflow"), dict) else None
    if not workflow_id or not workflow:
        log("workflowId и workflow обязательны")
        return 2

    nodes = workflow.get("nodes") if isinstance(workflow.get("nodes"), list) else []
    edges = workflow.get("edges") if isinstance(workflow.get("edges"), list) else []
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}

    start_node = _find_start_node(nodes)
    start_data = start_node.get("data") if start_node and isinstance(start_node.get("data"), dict) else {}
    list_ids = start_data.get("sourceLists") or []
    if not isinstance(list_ids, list):
        list_ids = []
    list_ids = [str(x) for x in list_ids if str(x).strip()]
    if not list_ids:
        log("Выберите список профилей!")
        emit_event("session_ended", status="failed", workflow_id=workflow_id)
        return 2

    profiles = _fetch_profiles_for_lists(list_ids)
    if not profiles:
        log("В выбранном списке нет профилей!")
        emit_event("session_ended", status="failed", workflow_id=workflow_id)
        return 2

    accounts: List[ThreadsAccount] = []
    for p in profiles:
        name = p.get("name")
        if not name:
            continue
        accounts.append(ThreadsAccount(username=name, password="", proxy=p.get("proxy")))

    if not accounts:
        log("В выбранном списке нет валидных профилей!")
        emit_event("session_ended", status="failed", workflow_id=workflow_id)
        return 2

    headless = bool(start_data.get("headlessMode"))
    options = {**options, "headless": headless}
    runner = WorkflowRunner(workflow_id, nodes, edges, accounts, options)

    def _handle_signal(_sig, _frame):
        runner.stop()

    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_signal)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _handle_signal)

    return runner.run()


if __name__ == "__main__":
    raise SystemExit(main())
