import time
import logging
from threading import Lock
from typing import Optional

from python.core.errors.config import config


logger = logging.getLogger(__name__)

_proxy_health = {}
_proxy_health_lock = Lock()


def mark_proxy_failure(proxy_string: str):
    if not proxy_string:
        return
    should_log = False
    with _proxy_health_lock:
        if proxy_string not in _proxy_health:
            _proxy_health[proxy_string] = {'failures': 0, 'tainted_until': 0}
        _proxy_health[proxy_string]['failures'] += 1
        if _proxy_health[proxy_string]['failures'] >= config.PROXY_FAILURE_THRESHOLD:
            _proxy_health[proxy_string]['tainted_until'] = time.time() + config.PROXY_TAINT_DURATION
            _proxy_health[proxy_string]['failures'] = 0
            should_log = True
    if should_log:
        logger.warning(
            'Proxy %s tainted for %ss due to failures',
            proxy_string,
            config.PROXY_TAINT_DURATION,
        )


def mark_proxy_success(proxy_string: str) -> None:
    if not proxy_string:
        return
    with _proxy_health_lock:
        if proxy_string not in _proxy_health:
            return
        _proxy_health[proxy_string]['failures'] = 0
        _proxy_health[proxy_string]['tainted_until'] = 0


def is_proxy_healthy(proxy_string: str) -> bool:
    if not proxy_string:
        return True
    with _proxy_health_lock:
        state = _proxy_health.get(proxy_string)
        if state is None:
            return True
        tainted_until = state['tainted_until']
    return time.time() > tainted_until


class ProxyCircuitBreaker:
    def __init__(self):
        self.consecutive_failures = 0
        self.global_pause_until = 0
        self._lock = Lock()

    def record_failure(self):
        should_log = False
        with self._lock:
            self.consecutive_failures += 1
            if self.consecutive_failures >= config.CIRCUIT_THRESHOLD:
                self.global_pause_until = time.time() + config.CIRCUIT_RECOVERY_TIMEOUT
                self.consecutive_failures = 0
                should_log = True
        if should_log:
            logger.error(
                'Circuit Breaker Triggered! Pausing all operations for %ss.',
                config.CIRCUIT_RECOVERY_TIMEOUT,
            )

    def record_success(self):
        with self._lock:
            self.consecutive_failures = 0

    def is_open(self) -> bool:
        with self._lock:
            pause_until = self.global_pause_until
        return time.time() < pause_until


proxy_circuit = ProxyCircuitBreaker()


def parse_proxy_string(proxy_string):
    try:
        if not proxy_string:
            return None
        proxy_string = proxy_string.strip()
        scheme = 'http'
        if '://' in proxy_string:
            scheme, remainder = proxy_string.split('://', 1)
            proxy_string = remainder
        if '@' in proxy_string:
            return _parse_proxy_url_with_auth(scheme, proxy_string)
        return _parse_proxy_colon_format(scheme, proxy_string)
    except (ValueError, AttributeError) as exc:
        logger.warning("Error parsing proxy '%s': %s", proxy_string, exc)
        return None


def _parse_proxy_url_with_auth(scheme: str, proxy_string: str):
    from urllib.parse import urlsplit

    parsed = urlsplit(f'{scheme}://{proxy_string}')
    if not parsed.hostname:
        raise ValueError('Proxy URL with credentials is missing a hostname')

    server = f'{scheme}://{parsed.hostname}'
    if parsed.port is not None:
        server = f'{server}:{parsed.port}'

    cfg = {'server': server}
    if parsed.username is not None:
        cfg['username'] = parsed.username
    if parsed.password is not None:
        cfg['password'] = parsed.password
    return cfg


def _parse_proxy_colon_format(scheme: str, proxy_string: str):
    host, port, user, password = _split_proxy_colon_parts(proxy_string)
    if port and user is not None and password is not None:
        return {
            'server': _build_proxy_server(scheme, host, port),
            'username': user,
            'password': password,
        }
    if port:
        return {'server': _build_proxy_server(scheme, host, port)}
    return {'server': _build_proxy_server(scheme, proxy_string)}


def _split_proxy_colon_parts(proxy_string: str):
    if proxy_string.startswith('['):
        closing = proxy_string.find(']')
        if closing == -1:
            return proxy_string, None, None, None
        host = proxy_string[: closing + 1]
        if len(proxy_string) <= closing + 1 or proxy_string[closing + 1] != ':':
            return proxy_string, None, None, None
        remainder_parts = proxy_string[closing + 2 :].split(':')
        if len(remainder_parts) == 1:
            return host, remainder_parts[0], None, None
        if len(remainder_parts) == 3:
            return host, remainder_parts[0], remainder_parts[1], remainder_parts[2]
        return proxy_string, None, None, None
    parts = proxy_string.split(':')
    if len(parts) == 4:
        return parts[0], parts[1], parts[2], parts[3]
    if len(parts) == 2:
        return parts[0], parts[1], None, None
    if len(parts) > 2 and parts[-1].isdigit():
        return ':'.join(parts[:-1]), parts[-1], None, None
    return proxy_string, None, None, None


def _build_proxy_server(scheme: str, host: str, port: Optional[str] = None) -> str:
    clean_host = str(host or '').strip()
    if ':' in clean_host and not clean_host.startswith('['):
        clean_host = f'[{clean_host}]'
    server = f'{scheme}://{clean_host}'
    if port:
        server = f'{server}:{port}'
    return server


def build_proxy_config(proxy_string: Optional[str]):
    if proxy_string and proxy_string.lower() not in ('none', ''):
        return parse_proxy_string(proxy_string)
    return None
