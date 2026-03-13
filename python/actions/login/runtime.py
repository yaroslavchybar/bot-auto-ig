import time
import traceback
from typing import Callable

from python.actions.common import random_delay
from python.browser.cookies import normalize_profile_cookies
from python.browser.setup import create_browser_context, sync_profile_session_state
from python.core.selectors import HOME_BUTTON, LOGIN_BUTTON, SEARCH_BUTTON
from python.core.totp import generate_totp_code

PRIMARY_SELECTORS = {
    'username': "input[name='username']",
    'password': "input[name='password']",
    'submit': "button[type='submit']",
}

ALT_SELECTORS = {
    'username': "input[name='email']",
    'password': "input[name='pass']",
    'submit': "div[role='button']:has-text('Log in')",
}


def _find_login_inputs(page, log):
    if page.locator(PRIMARY_SELECTORS['username']).count() > 0:
        log('Found classic Instagram login form')
        return PRIMARY_SELECTORS
    if page.locator(ALT_SELECTORS['username']).count() > 0:
        log('Found Meta-style login form (alternative)')
        return ALT_SELECTORS
    log('Searching for any login-like inputs...')
    return None


def _click_login_button(page, selectors, log):
    try:
        login_btn = LOGIN_BUTTON.find(page)
        if login_btn:
            login_btn.click()
            return
    except Exception as exc:
        log(f'Semantic login button failed: {exc}')
    if selectors == PRIMARY_SELECTORS:
        try:
            page.click(selectors['submit'])
        except Exception:
            page.keyboard.press('Enter')
        return
    _click_alt_login_button(page, log)


def _click_alt_login_button(page, log) -> None:
    try:
        login_btn = page.get_by_role('button', name='Log in', exact=True)
        if login_btn.count() == 1:
            login_btn.click()
            return
        if login_btn.count() > 1:
            for index in range(login_btn.count()):
                button = login_btn.nth(index)
                if 'Facebook' not in button.inner_text():
                    button.click()
                    return
        log("No exact 'Log in' button found, pressing Enter...")
    except Exception as exc:
        log(f'Warning: fallback login button click: {exc}')
    page.keyboard.press('Enter')


def _has_authenticated_instagram_session(context) -> bool:
    try:
        cookies = normalize_profile_cookies(context.cookies(), drop_invalid=True)
    except Exception:
        return False
    names = {
        str(cookie.get('name') or ''): str(cookie.get('value') or '').strip()
        for cookie in cookies or []
        if 'instagram.com' in str(cookie.get('domain') or '')
    }
    return bool(names.get('sessionid')) and bool(names.get('ds_user_id'))


def login_session(
    profile_name: str,
    proxy_string: str | None,
    username: str,
    password: str,
    log: Callable[[str], None],
    two_factor_secret: str | None = None,
    user_agent: str | None = None,
    headless: bool = False,
    fingerprint_seed: str | None = None,
    fingerprint_os: str | None = None,
):
    log('Starting login session')
    state = {'success': False}
    try:
        with create_browser_context(
            profile_name=profile_name,
            proxy_string=proxy_string,
            user_agent=user_agent,
            headless=headless,
            block_images=False,
            fingerprint_seed=fingerprint_seed,
            fingerprint_os=fingerprint_os,
        ) as (context, page):
            _open_login_page(page, log)
            if _already_logged_in(page, context, profile_name, log, state):
                return state['success']
            if not _submit_credentials(page, username, password, log):
                return False
            _handle_login_result(page, context, profile_name, log, two_factor_secret, state)
            _finalize_login_session(context, profile_name, log, state)
            return state['success']
    except Exception as exc:
        log(f'Critical error: {exc}')
        traceback.print_exc()
        return False


def _open_login_page(page, log) -> None:
    log('Navigating to Instagram...')
    try:
        if 'instagram.com' not in page.url:
            page.goto('https://www.instagram.com/accounts/login/', timeout=60000)
    except Exception as exc:
        log(f'Navigation error (retrying): {exc}')
        page.goto('https://www.instagram.com/accounts/login/', timeout=60000)
    log('Waiting for page load...')
    time.sleep(3)


def _already_logged_in(page, context, profile_name: str, log, state: dict) -> bool:
    try:
        username_exists = (
            page.locator(PRIMARY_SELECTORS['username']).count() > 0
            or page.locator(ALT_SELECTORS['username']).count() > 0
        )
        if username_exists:
            return False
        if not (HOME_BUTTON.find(page) or SEARCH_BUTTON.find(page)):
            return False
        log('Already logged in!')
        _mark_login_success(state, context, profile_name, log)
        return True
    except Exception:
        return False


def _submit_credentials(page, username: str, password: str, log) -> bool:
    log('Attempting to fill credentials...')
    selectors = _resolve_login_selectors(page, log)
    if selectors is None:
        log('Could not find login form inputs!')
        return False
    page.wait_for_selector(selectors['username'], state='visible', timeout=20000)
    _type_credential(page, selectors['username'], username, log, reveal_value=False, label='Filling username')
    _type_credential(page, selectors['password'], password, log, reveal_value=False, label='Filling password...')
    log('Submitting login form...')
    _click_login_button(page, selectors, log)
    log('Waiting for login result...')
    time.sleep(5)
    return True


def _resolve_login_selectors(page, log):
    selectors = _find_login_inputs(page, log)
    if selectors is not None:
        return selectors
    time.sleep(3)
    return _find_login_inputs(page, log)


def _type_credential(page, selector: str, value: str, log, *, reveal_value: bool, label: str) -> None:
    log(f'{label}: {value}' if reveal_value else label)
    page.click(selector)
    random_delay(0.5, 1.0)
    page.fill(selector, '')
    random_delay(0.1, 0.3)
    page.keyboard.type(value, delay=100)
    random_delay(0.5, 1.5)


def _handle_login_result(page, context, profile_name: str, log, two_factor_secret: str | None, state: dict) -> None:
    error_text = _login_error_text(page)
    if error_text:
        log(f'Login failed: {error_text}')
        return
    if _mark_home_success(page, context, profile_name, log, state):
        return
    if _two_factor_required(page):
        _handle_two_factor(page, context, profile_name, log, two_factor_secret, state)
        return
    log('Login verification timed out. Please check screenshot or manual intervention.')


def _login_error_text(page):
    if page.locator("p[id='slfErrorAlert']").count() <= 0:
        return None
    return page.locator("p[id='slfErrorAlert']").text_content()


def _mark_home_success(page, context, profile_name: str, log, state: dict) -> bool:
    try:
        if HOME_BUTTON.find(page):
            log('Login successful! (Home icon found)')
            _mark_login_success(state, context, profile_name, log)
            return True
        page.wait_for_selector("svg[aria-label='Home']", timeout=20000)
        log('Login successful! (Home icon found)')
        _mark_login_success(state, context, profile_name, log)
        return True
    except Exception:
        return False


def _two_factor_required(page) -> bool:
    return 'two_factor' in page.url or page.locator("input[name='verificationCode']").count() > 0


def _handle_two_factor(page, context, profile_name: str, log, two_factor_secret: str | None, state: dict) -> None:
    log('2FA required!')
    if two_factor_secret:
        _submit_two_factor_code(page, log, two_factor_secret)
    else:
        log('No 2FA secret provided. Please enter code manually if browser is open.')
        time.sleep(30)
    if _mark_home_success(page, context, profile_name, log, state):
        return
    log('Login verification timed out after 2FA.')


def _submit_two_factor_code(page, log, two_factor_secret: str) -> None:
    try:
        log('Generating 2FA code...')
        code = generate_totp_code(two_factor_secret)
        log('Entering 2FA code...')
        twofa_input = _two_factor_input(page)
        twofa_input.wait_for(state='visible', timeout=10000)
        twofa_input.fill(code)
        random_delay(0.5, 1.0)
        log('Submitting 2FA code...')
        _click_two_factor_confirm(page)
        time.sleep(5)
        if 'two_factor' in page.url:
            _click_two_factor_confirm(page)
            time.sleep(5)
        elif 'two_factor' not in page.url:
            log('2FA passed!')
    except Exception as exc:
        log(f'Error entering 2FA: {exc}')


def _two_factor_input(page):
    twofa_input = page.locator("input[name='verificationCode']")
    if twofa_input.count() > 0:
        return twofa_input
    return page.locator("input[aria-label='Security Code']")


def _click_two_factor_confirm(page) -> None:
    confirm_btn = page.locator("button:has-text('Confirm')")
    if confirm_btn.count() > 0:
        confirm_btn.click()
        return
    page.keyboard.press('Enter')


def _finalize_login_session(context, profile_name: str, log, state: dict) -> None:
    log('Keeping session open for 10s to ensure persistence...')
    time.sleep(10)
    if state['success'] or not _has_authenticated_instagram_session(context):
        return
    log('Login confirmed via authenticated Instagram cookies')
    _mark_login_success(state, context, profile_name, log)


def _mark_login_success(state: dict, context, profile_name: str, log) -> None:
    state['success'] = True
    log('__LOGIN_SUCCESS__')
    sync_profile_session_state(context, profile_name, log)
