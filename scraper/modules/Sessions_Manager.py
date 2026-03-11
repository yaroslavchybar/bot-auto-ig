import os
import pickle
import random
import logging
import pyfiglet
import requests
from time import sleep
from colorama import init, Fore
from fake_useragent import UserAgent

from modules.diagnostics import body_preview, json_keys, mask_session_id, response_preview, safe_json_loads
from modules.instagram_shared import run_with_temporary_service
from modules.proxy_utils import normalize_proxy

init()
logger = logging.getLogger(__name__)

class Colors:
    RED = Fore.RED
    GREEN = Fore.LIGHTGREEN_EX
    YELLOW = Fore.YELLOW
    CYAN = Fore.CYAN
    WHITE = Fore.WHITE
    RESET = Fore.RESET

class UI:
    PLUS = f"{Colors.GREEN}[+]{Colors.RESET}"
    WARNING = f"{Colors.YELLOW}[!]{Colors.RESET}"
    ERROR = f"{Colors.RED}[!]{Colors.RESET}"
    INFO = f"{Colors.CYAN}[i]{Colors.RESET}"

colors = [Colors.GREEN, Colors.RED, Colors.WHITE, Colors.CYAN, Colors.YELLOW]

def clear_screen():
    """Cross-platform screen clearing"""
    os.system('cls' if os.name == 'nt' else 'clear')

def show_banner():
    """Display the application banner"""
    f = pyfiglet.Figlet(font='slant')
    banner = f.renderText('Manager')
    print(f'{random.choice(colors)}{banner}{Colors.RESET}')
    print(f'{Colors.RED}Session  Manager | Version: 1.0 | Author: Kev {Colors.RESET}\n')

def load_sessions(filename='session_file.txt'):
    """Load sessions from file"""
    sessions = []
    try:
        with open(filename, 'rb') as f:
            while True:
                try:
                    sessions.append(pickle.load(f))
                except EOFError:
                    break
    except FileNotFoundError:
        pass
    return sessions

def save_sessions(sessions, filename='session_file.txt'):
    """Save sessions to file"""
    with open(filename, 'wb') as f:
        for session in sessions:
            pickle.dump(session, f)

def get_userid(to_scrape_username, session_id=None):
    """Get user ID from Instagram API"""
    #print(f'\n{Colors.GREEN}Getting userid {Colors.RESET}\n')
    session_summary = mask_session_id(session_id)
    logger.info(
        "sessions.get_userid start probe_username=%s session=%s",
        to_scrape_username,
        session_summary,
    )
    headers = {
            "authority": "www.instagram.com",
            "method": "GET",
            "path": f"/api/v1/users/web_profile_info/?username={to_scrape_username}",
            "scheme": "https",
            "accept": "*/*",
            "accept-encoding": "gzip, deflate, br",
            "accept-language": "en-US,en;q=0.6",
            "priority": "u=1, i",
            "referer": f"https://www.instagram.com/{to_scrape_username}/",
            "user-agent": UserAgent().random,
            'x-ig-app-id': '936619743392459', 
            "x-ig-www-claim": "0",
            "x-requested-with": "XMLHttpRequest"
        }
    url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={to_scrape_username}"
    
    # Add session cookie if provided
    cookies = {'sessionid': session_id} if session_id else None
    
    try:
        response = requests.get(url, headers=headers, cookies=cookies)
        payload = safe_json_loads(response.text)
        user = payload.get('data', {}).get('user') if isinstance(payload, dict) else None
        user_id = user.get('id') if isinstance(user, dict) else None
        if user_id:
            logger.info(
                "sessions.get_userid success probe_username=%s session=%s status=%s content_type=%s user_id=%s",
                to_scrape_username,
                session_summary,
                response.status_code,
                response.headers.get('content-type', ''),
                user_id,
            )
            return user_id

        logger.warning(
            "sessions.get_userid unresolved probe_username=%s session=%s status=%s content_type=%s payload_keys=%s body_preview=%r",
            to_scrape_username,
            session_summary,
            response.status_code,
            response.headers.get('content-type', ''),
            json_keys(payload),
            body_preview(response_preview(response)),
        )
        return None
    except Exception as e:
        logger.exception(
            "sessions.get_userid exception probe_username=%s session=%s error=%s",
            to_scrape_username,
            session_summary,
            e,
        )
        print(f"{UI.WARNING} Error getting user ID: {e}")
        return None

def verify_session(username, session_id, proxy=None):
    """Verify if a session ID is valid"""
    result = run_with_temporary_service(
        lambda service: service.verify_session(
            username=username,
            session_id=session_id,
            proxy=normalize_proxy(proxy),
        )
    )
    if result.outcome == 'success':
        if result.diagnostics.get('verificationDegraded'):
            return False, 'Failed to get test user ID'
        return True, 'Session is valid!'
    return False, result.error_message or 'Session verification failed'

def add_sessions():
    """Add new sessions"""
    newly_added = []
    while True:
        try:
            clear_screen()
            show_banner()
            print(f"{UI.INFO} Adding new session (leave username empty to stop){Colors.RESET}")
            
            username = input(f"\n{UI.PLUS} Enter username: ").strip()
            if not username:
                break
                
            session_id = input(f"{UI.PLUS} Enter session ID: ").strip()
            if not session_id:
                print(f"{UI.ERROR} Session ID cannot be empty{Colors.RESET}")
                sleep(2)
                continue
                
            print(f"\n{UI.INFO} Verifying session...{Colors.RESET}")
            is_valid, message = verify_session(username, session_id)
            
            if is_valid:
                print(f"{UI.PLUS} {message}{Colors.RESET}")
                newly_added.append((username, session_id))
            else:
                print(f"{UI.ERROR} Session verification failed: {message}{Colors.RESET}")
                if "proxy" in message.lower():
                    print(f"{UI.WARNING} Consider using a residential proxy{Colors.RESET}")
            
            if input(f'\n{UI.INFO} Add more sessions? [y/n]: ').lower() != 'y':
                break
                
        except Exception as e:
            print(f'{UI.ERROR} Error: {str(e)}{Colors.RESET}')
            sleep(2)
    
    if newly_added:
        existing = load_sessions()
        all_sessions = existing + newly_added
        save_sessions(all_sessions)
        print(f'\n{UI.PLUS} Saved {len(newly_added)} new sessions in session_file.txt{Colors.RESET}')
    else:
        print(f'\n{UI.WARNING} No new sessions were added{Colors.RESET}')
    
    sleep(2)

def filter_invalid_sessions():
    """Filter out invalid sessions"""
    sessions = load_sessions()
    if not sessions:
        print(f'{UI.ERROR} No sessions found!{Colors.RESET}')
        sleep(2)
        return
    
    valid_sessions = []
    invalid_sessions = []
    
    for username, session_id in sessions:
        try:
            print(f'\n{UI.INFO} Checking session for {username}...{Colors.RESET}')
            is_valid, message = verify_session(username, session_id)
            
            if is_valid:
                print(f'{UI.PLUS} Valid session for {username}{Colors.RESET}')
                valid_sessions.append((username, session_id))
            else:
                print(f'{UI.ERROR} Invalid session for {username}: {message}{Colors.RESET}')
                invalid_sessions.append((username, session_id))
                
        except Exception as e:
            print(f'{UI.ERROR} Error checking {username}: {str(e)}{Colors.RESET}')
            valid_sessions.append((username, session_id))  # Keep session if unsure
    
    if invalid_sessions:
        save_sessions(valid_sessions)
        print(f'\n{UI.PLUS} Removed {len(invalid_sessions)} invalid sessions{Colors.RESET}')
    else:
        print(f'\n{UI.INFO} No invalid sessions found{Colors.RESET}')
    
    input(f'\n{UI.INFO} Press enter to continue...{Colors.RESET}')

def list_sessions():
    """List all sessions"""
    sessions = load_sessions()
    if not sessions:
        print(f'{UI.ERROR} No sessions found{Colors.RESET}')
    else:
        print(f'\n{Colors.CYAN}{"Username":<20} | {"Session ID":<32}{Colors.RESET}')
        print('-' * 60)
        for username, session_id in sessions:
            print(f'{username:<20} | {session_id:<32}')
        print(f'\n{UI.INFO} Total sessions: {len(sessions)}{Colors.RESET}')
    
    input(f'\n{UI.INFO} Press enter to continue...{Colors.RESET}')

def delete_session():
    """Delete a session"""
    sessions = load_sessions()
    if not sessions:
        print(f'{UI.ERROR} No sessions found{Colors.RESET}')
        sleep(2)
        return
    
    print(f'\n{UI.INFO} Select session to delete:{Colors.RESET}')
    for i, (username, _) in enumerate(sessions):
        print(f'{Colors.CYAN}[{i}] {username}{Colors.RESET}')
    
    try:
        choice = int(input(f'\n{UI.INFO} Enter choice: {Colors.RED}'))
        if 0 <= choice < len(sessions):
            username, session_id = sessions[choice]
            del sessions[choice]
            save_sessions(sessions)
            print(f'\n{UI.PLUS} Session deleted: {username}{Colors.RESET}')
        else:
            print(f'{UI.ERROR} Invalid selection{Colors.RESET}')
    except ValueError:
        print(f'{UI.ERROR} Please enter a number{Colors.RESET}')
    
    input(f'\n{UI.INFO} Press enter to continue...{Colors.RESET}')

def main():
    """Main application loop"""
    while True:
        clear_screen()
        show_banner()
        
        print(f'{Colors.CYAN}[1] Add new sessions')
        print(f'[2] Filter invalid sessions')
        print(f'[3] List all sessions')
        print(f'[4] Delete a session')
        print(f'[5] Exit{Colors.RESET}')
        
        try:
            choice = input(f'\n{UI.INFO} Enter your choice: {Colors.RED}').strip()
            
            if choice == '1':
                add_sessions()
            elif choice == '2':
                filter_invalid_sessions()
            elif choice == '3':
                list_sessions()
            elif choice == '4':
                delete_session()
            elif choice == '5':
                print(f'\n{UI.PLUS} Exiting...{Colors.RESET}')
                break
            else:
                print(f'{UI.ERROR} Invalid choice{Colors.RESET}')
                sleep(1)
        except KeyboardInterrupt:
            print(f'\n{Colors.RED}Goodbye!{Colors.RESET}')
            break

