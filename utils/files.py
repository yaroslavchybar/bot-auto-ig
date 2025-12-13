import os

def load_accounts(file_path):
    """Load accounts from file (format: credentials or other formats)"""
    accounts = []
    if not os.path.exists(file_path):
        return accounts
        
    try:
        from core.models import ThreadsAccount
        
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            
        for line in lines:
            line = line.strip()
            if not line:
                continue
                
            # Try to parse different formats
            # 1. username:password
            # 2. username:password:email:emailpass (ignore extra)
            parts = line.split(':')
            if len(parts) >= 2:
                username = parts[0]
                password = parts[1]
                accounts.append(ThreadsAccount(username=username, password=password))
                
        return accounts
    except Exception as e:
        print(f"Error loading accounts: {e}")
        return []

def load_proxies(file_path):
    """Load proxies from file"""
    proxies = []
    if not os.path.exists(file_path):
        return proxies
        
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            
        for line in lines:
            line = line.strip()
            if line:
                proxies.append(line)
        return proxies
    except Exception as e:
        print(f"Error loading proxies: {e}")
        return []

def assign_proxies_to_accounts(accounts, proxies):
    """Round-robin assignment of proxies to accounts"""
    if not proxies:
        return
        
    for i, account in enumerate(accounts):
        account.proxy = proxies[i % len(proxies)]
