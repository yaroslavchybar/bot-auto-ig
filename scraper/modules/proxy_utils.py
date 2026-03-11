from typing import Optional


def normalize_proxy(proxy: Optional[str]) -> Optional[str]:
    """Normalize proxy strings into a scheme-prefixed URL."""
    if not proxy:
        return None

    value = str(proxy).strip()
    if not value:
        return None

    scheme = 'http'
    if value.startswith('http://'):
        scheme = 'http'
        value = value[7:]
    elif value.startswith('https://'):
        scheme = 'https'
        value = value[8:]
    elif value.startswith('socks5://'):
        scheme = 'socks5'
        value = value[9:]

    if '@' in value:
        return f'{scheme}://{value}'

    parts = value.split(':')
    if len(parts) == 2:
        return f'{scheme}://{value}'
    if len(parts) == 4:
        host, port, user, password = parts
        return f'{scheme}://{user}:{password}@{host}:{port}'
    if len(parts) > 4:
        host = parts[0]
        port = parts[1]
        user = parts[2]
        password = ':'.join(parts[3:])
        return f'{scheme}://{user}:{password}@{host}:{port}'

    return f'{scheme}://{value}'
