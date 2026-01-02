import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from threading import Lock
from typing import Optional


_session: Optional[requests.Session] = None
_lock = Lock()


def get_shared_session() -> requests.Session:
    global _session
    if _session is None:
        with _lock:
            if _session is None:
                session = requests.Session()
                retries = Retry(
                    total=3,
                    backoff_factor=1.5,
                    status_forcelist=[429, 500, 502, 503, 504],
                    allowed_methods=["GET", "POST", "PATCH", "DELETE"],
                )
                adapter = HTTPAdapter(
                    max_retries=retries,
                    pool_connections=20,
                    pool_maxsize=20,
                )
                session.mount("https://", adapter)
                session.mount("http://", adapter)
                _session = session
    return _session

