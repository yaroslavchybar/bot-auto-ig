from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass
from threading import Lock
from typing import Any, Dict, List, Optional

try:
    import fcntl  # type: ignore
except Exception:  # pragma: no cover
    fcntl = None


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return int(value.strip())
    except Exception:
        return default


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _terminate_pid(pid: int, timeout_s: float = 2.5) -> None:
    if pid <= 0:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if not _pid_alive(pid):
            return
        time.sleep(0.1)

    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        return


def _wait_for_port(port: int, timeout_s: float = 12.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            try:
                if sock.connect_ex(("127.0.0.1", int(port))) == 0:
                    return True
            except OSError:
                pass
        time.sleep(0.2)
    return False


@dataclass
class SessionInfo:
    key: str
    workflow_id: str
    profile_name: str
    slot: int
    display_num: int
    vnc_port: int
    rfb_port: int
    owner_pid: int
    xvfb_pid: int = 0
    fluxbox_pid: int = 0
    x11vnc_pid: int = 0
    novnc_pid: int = 0
    status: str = "active"
    started_at: float = 0.0

    @property
    def display(self) -> str:
        return f":{self.display_num}"

    def to_public_dict(self) -> Dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "profile_name": self.profile_name,
            "display_num": self.display_num,
            "display": self.display,
            "vnc_port": self.vnc_port,
        }

    def to_registry_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "workflow_id": self.workflow_id,
            "profile_name": self.profile_name,
            "slot": self.slot,
            "display_num": self.display_num,
            "vnc_port": self.vnc_port,
            "rfb_port": self.rfb_port,
            "owner_pid": self.owner_pid,
            "xvfb_pid": self.xvfb_pid,
            "fluxbox_pid": self.fluxbox_pid,
            "x11vnc_pid": self.x11vnc_pid,
            "novnc_pid": self.novnc_pid,
            "status": self.status,
            "started_at": self.started_at,
        }

    @classmethod
    def from_registry_dict(cls, payload: Dict[str, Any]) -> "SessionInfo":
        return cls(
            key=str(payload.get("key") or ""),
            workflow_id=str(payload.get("workflow_id") or ""),
            profile_name=str(payload.get("profile_name") or ""),
            slot=int(payload.get("slot") or 0),
            display_num=int(payload.get("display_num") or 0),
            vnc_port=int(payload.get("vnc_port") or 0),
            rfb_port=int(payload.get("rfb_port") or 0),
            owner_pid=int(payload.get("owner_pid") or 0),
            xvfb_pid=int(payload.get("xvfb_pid") or 0),
            fluxbox_pid=int(payload.get("fluxbox_pid") or 0),
            x11vnc_pid=int(payload.get("x11vnc_pid") or 0),
            novnc_pid=int(payload.get("novnc_pid") or 0),
            status=str(payload.get("status") or "active"),
            started_at=float(payload.get("started_at") or 0.0),
        )


class DisplayManager:
    def __init__(self) -> None:
        self.owner_pid = os.getpid()
        self.display_start = _env_int("XVFB_DISPLAY_START", 100)
        self.display_end = _env_int("XVFB_DISPLAY_END", 129)
        self.vnc_start = _env_int("VNC_PORT_START", 6081)
        self.vnc_end = _env_int("VNC_PORT_END", 6130)
        self.rfb_start = _env_int("RFB_PORT_START", 5901)
        self.enabled = self._compute_enabled()
        self._lock = Lock()
        self._runtime_sessions: Dict[str, Dict[str, Any]] = {}

    @property
    def lock_path(self) -> str:
        state_dir = os.environ.get("DISPLAY_STATE_DIR", tempfile.gettempdir())
        os.makedirs(state_dir, exist_ok=True)
        return os.path.join(state_dir, "anti_display_manager.lock")

    @property
    def state_path(self) -> str:
        state_dir = os.environ.get("DISPLAY_STATE_DIR", tempfile.gettempdir())
        os.makedirs(state_dir, exist_ok=True)
        return os.path.join(state_dir, "anti_display_manager.json")

    def _compute_enabled(self) -> bool:
        explicit = os.environ.get("DISPLAY_MANAGER_ENABLED")
        if explicit is not None and explicit.strip() in {"0", "false", "False"}:
            return False
        if os.name != "posix":
            return False
        if self.display_end < self.display_start or self.vnc_end < self.vnc_start:
            return False
        return True

    @contextmanager
    def _global_lock(self):
        with open(self.lock_path, "a+", encoding="utf-8") as fh:
            if fcntl is not None:
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(fh.fileno(), fcntl.LOCK_UN)

    def _load_registry(self) -> List[SessionInfo]:
        try:
            with open(self.state_path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
            sessions = payload.get("sessions") if isinstance(payload, dict) else []
            if not isinstance(sessions, list):
                return []
            return [SessionInfo.from_registry_dict(x) for x in sessions if isinstance(x, dict)]
        except Exception:
            return []

    def _save_registry(self, sessions: List[SessionInfo]) -> None:
        payload = {"sessions": [s.to_registry_dict() for s in sessions]}
        tmp_path = f"{self.state_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        os.replace(tmp_path, self.state_path)

    def _prune_stale_locked(self, sessions: List[SessionInfo]) -> List[SessionInfo]:
        alive: List[SessionInfo] = []
        for session in sessions:
            if _pid_alive(session.owner_pid):
                alive.append(session)
                continue

            for pid in (session.novnc_pid, session.x11vnc_pid, session.fluxbox_pid, session.xvfb_pid):
                _terminate_pid(pid)
        return alive

    def _build_key(self, workflow_id: str, profile_name: str) -> str:
        return f"{workflow_id}:{profile_name}"

    def _spawn(self, cmd: List[str]) -> subprocess.Popen[Any]:
        return subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _novnc_command(self, rfb_port: int, vnc_port: int) -> List[str]:
        novnc_proxy = "/usr/share/novnc/utils/novnc_proxy"
        if os.path.exists(novnc_proxy):
            return [novnc_proxy, "--vnc", f"localhost:{rfb_port}", "--listen", str(vnc_port)]
        return ["websockify", str(vnc_port), f"localhost:{rfb_port}", "--web=/usr/share/novnc"]

    def _first_free_slot(self, sessions: List[SessionInfo]) -> Optional[int]:
        used = {s.slot for s in sessions}
        max_slots = min(
            self.display_end - self.display_start + 1,
            self.vnc_end - self.vnc_start + 1,
        )
        for slot in range(max_slots):
            if slot not in used:
                return slot
        return None

    def allocate(self, workflow_id: str, profile_name: str) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return None

        workflow_id = str(workflow_id or "").strip()
        profile_name = str(profile_name or "").strip()
        if not workflow_id or not profile_name:
            raise ValueError("workflow_id and profile_name are required")

        key = self._build_key(workflow_id, profile_name)
        with self._lock:
            existing = self._runtime_sessions.get(key)
            if existing:
                return existing["session"].to_public_dict()

            with self._global_lock():
                sessions = self._prune_stale_locked(self._load_registry())
                slot = self._first_free_slot(sessions)
                if slot is None:
                    self._save_registry(sessions)
                    raise RuntimeError("No available virtual display slots")

                session = SessionInfo(
                    key=key,
                    workflow_id=workflow_id,
                    profile_name=profile_name,
                    slot=slot,
                    display_num=self.display_start + slot,
                    vnc_port=self.vnc_start + slot,
                    rfb_port=self.rfb_start + slot,
                    owner_pid=self.owner_pid,
                    status="starting",
                    started_at=time.time(),
                )
                sessions = [s for s in sessions if s.key != key]
                sessions.append(session)
                self._save_registry(sessions)

            procs: Dict[str, subprocess.Popen[Any]] = {}
            try:
                display = f":{session.display_num}"
                procs["xvfb"] = self._spawn(["Xvfb", display, "-screen", "0", "1366x768x16"])
                procs["fluxbox"] = self._spawn(["fluxbox", "-display", display])
                procs["x11vnc"] = self._spawn(
                    ["x11vnc", "-display", display, "-forever", "-nopw", "-shared", "-rfbport", str(session.rfb_port)]
                )
                if not _wait_for_port(session.rfb_port, timeout_s=12.0):
                    raise RuntimeError(f"x11vnc did not open port {session.rfb_port}")

                procs["novnc"] = self._spawn(self._novnc_command(session.rfb_port, session.vnc_port))
                if not _wait_for_port(session.vnc_port, timeout_s=12.0):
                    raise RuntimeError(f"noVNC did not open port {session.vnc_port}")

                session.xvfb_pid = int(procs["xvfb"].pid or 0)
                session.fluxbox_pid = int(procs["fluxbox"].pid or 0)
                session.x11vnc_pid = int(procs["x11vnc"].pid or 0)
                session.novnc_pid = int(procs["novnc"].pid or 0)
                session.status = "active"
                session.started_at = time.time()

                with self._global_lock():
                    sessions = self._prune_stale_locked(self._load_registry())
                    sessions = [s for s in sessions if s.key != key]
                    sessions.append(session)
                    self._save_registry(sessions)

                self._runtime_sessions[key] = {"session": session, "procs": procs}
                return session.to_public_dict()
            except Exception:
                self._stop_runtime_processes(procs)
                with self._global_lock():
                    sessions = self._prune_stale_locked(self._load_registry())
                    sessions = [s for s in sessions if s.key != key]
                    self._save_registry(sessions)
                raise

    def _stop_runtime_processes(self, procs: Dict[str, subprocess.Popen[Any]]) -> None:
        for name in ("novnc", "x11vnc", "fluxbox", "xvfb"):
            proc = procs.get(name)
            if not proc:
                continue
            try:
                proc.terminate()
            except Exception:
                pass

        deadline = time.time() + 3.0
        for name in ("novnc", "x11vnc", "fluxbox", "xvfb"):
            proc = procs.get(name)
            if not proc:
                continue
            while time.time() < deadline:
                if proc.poll() is not None:
                    break
                time.sleep(0.1)
            if proc.poll() is None:
                try:
                    proc.kill()
                except Exception:
                    pass

    def release(self, workflow_id: str, profile_name: str) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return None

        key = self._build_key(str(workflow_id or "").strip(), str(profile_name or "").strip())
        if not key.strip(":"):
            return None

        with self._lock:
            runtime = self._runtime_sessions.pop(key, None)
            session: Optional[SessionInfo] = None
            if runtime:
                session = runtime["session"]
                self._stop_runtime_processes(runtime["procs"])
            else:
                with self._global_lock():
                    sessions = self._prune_stale_locked(self._load_registry())
                    for s in sessions:
                        if s.key == key:
                            session = s
                            break

                if session:
                    for pid in (session.novnc_pid, session.x11vnc_pid, session.fluxbox_pid, session.xvfb_pid):
                        _terminate_pid(pid)

            with self._global_lock():
                sessions = self._prune_stale_locked(self._load_registry())
                sessions = [s for s in sessions if s.key != key]
                self._save_registry(sessions)

            return session.to_public_dict() if session else None

    def cleanup_all(self) -> None:
        with self._lock:
            keys = list(self._runtime_sessions.keys())
        for key in keys:
            workflow_id, _, profile_name = key.partition(":")
            self.release(workflow_id, profile_name)

        self.cleanup_owner_sessions(self.owner_pid, state_path=self.state_path, lock_path=self.lock_path)

    @staticmethod
    def cleanup_owner_sessions(owner_pid: Optional[int] = None, *, state_path: Optional[str] = None, lock_path: Optional[str] = None) -> None:
        pid = int(owner_pid or os.getpid())
        state_dir = os.environ.get("DISPLAY_STATE_DIR", tempfile.gettempdir())
        os.makedirs(state_dir, exist_ok=True)
        state_file = state_path or os.path.join(state_dir, "anti_display_manager.json")
        lock_file = lock_path or os.path.join(state_dir, "anti_display_manager.lock")
        to_cleanup: List[SessionInfo] = []

        with open(lock_file, "a+", encoding="utf-8") as fh:
            if fcntl is not None:
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
            try:
                try:
                    with open(state_file, "r", encoding="utf-8") as sfh:
                        payload = json.load(sfh)
                    entries = payload.get("sessions") if isinstance(payload, dict) else []
                except Exception:
                    entries = []

                if not isinstance(entries, list):
                    entries = []

                keep: List[SessionInfo] = []
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    session = SessionInfo.from_registry_dict(entry)
                    if session.owner_pid == pid:
                        to_cleanup.append(session)
                    else:
                        keep.append(session)

                tmp_path = f"{state_file}.tmp"
                with open(tmp_path, "w", encoding="utf-8") as sfh:
                    json.dump({"sessions": [s.to_registry_dict() for s in keep]}, sfh)
                os.replace(tmp_path, state_file)
            finally:
                if fcntl is not None:
                    fcntl.flock(fh.fileno(), fcntl.LOCK_UN)

        for session in to_cleanup:
            for child_pid in (session.novnc_pid, session.x11vnc_pid, session.fluxbox_pid, session.xvfb_pid):
                _terminate_pid(child_pid)
