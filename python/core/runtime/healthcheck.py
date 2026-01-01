import socket
import shutil
import requests
import logging

logger = logging.getLogger(__name__)

def check_internet() -> bool:
    try:
        # Try connecting to a reliable DNS server
        socket.create_connection(("8.8.8.8", 53), timeout=3)
        return True
    except OSError:
        logger.error("Internet check failed")
        return False

def check_proxy(proxy_config: dict) -> bool:
    try:
        # Simple check to see if proxy works
        # Using a reliable "what is my ip" service or google
        # We need to make sure requests respects the proxy format
        # proxy_config expected to be compatible with requests, e.g. {'http': '...', 'https': '...'}
        
        # If proxy_config comes from playwright format (server, username, password), we need to convert it?
        # The plan assumes proxy_config is passed ready-to-use or we adapt.
        # Let's assume the caller handles conversion or it's a simple http/https dict.
        
        resp = requests.get("https://ifconfig.me", proxies=proxy_config, timeout=10)
        return resp.status_code == 200
    except Exception as e:
        logger.error(f"Proxy check failed: {e}")
        return False

def check_disk_space(min_gb: int = 1) -> bool:
    try:
        # Check current drive
        _, _, free = shutil.disk_usage(".")
        free_gb = free // (2**30)
        if free_gb < min_gb:
            logger.warning(f"Low disk space: {free_gb}GB available (min {min_gb}GB)")
            return False
        return True
    except Exception as e:
        logger.error(f"Disk space check failed: {e}")
        return False

def run_all_checks(proxy_config: dict = None) -> dict:
    results = {
        "internet": check_internet(),
        "disk_space": check_disk_space(),
        "proxy": None
    }
    
    if proxy_config:
        results["proxy"] = check_proxy(proxy_config)
        
    return results
