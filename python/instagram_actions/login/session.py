import time
import traceback
from python.browser_control.browser_setup import create_browser_context
from python.instagram_actions.actions import random_delay
from python.internal_systems.data_models.totp import generate_totp_code
from python.internal_systems.shared_utilities.selectors import LOGIN_BUTTON, HOME_BUTTON, SEARCH_BUTTON


# Primary selectors (classic Instagram form)
PRIMARY_SELECTORS = {
    'username': "input[name='username']",
    'password': "input[name='password']",
    'submit': "button[type='submit']",
}

# Alternative selectors (Meta-style login form)
ALT_SELECTORS = {
    'username': "input[name='email']",
    'password': "input[name='pass']",
    'submit': "div[role='button']:has-text('Log in')",
}


def _find_login_inputs(page, log):
    """Try to find login inputs using primary or alternative selectors."""
    # Try primary selectors first
    if page.locator(PRIMARY_SELECTORS['username']).count() > 0:
        log("Found classic Instagram login form")
        return PRIMARY_SELECTORS
    
    # Try alternative selectors
    if page.locator(ALT_SELECTORS['username']).count() > 0:
        log("Found Meta-style login form (alternative)")
        return ALT_SELECTORS
    
    # Last resort: try any visible input with common attributes
    log("Searching for any login-like inputs...")
    return None


def _click_login_button(page, selectors, log):
    """Click the appropriate login button."""
    # Try Semantic Selector first
    try:
        login_btn = LOGIN_BUTTON.find(page)
        if login_btn:
             login_btn.click()
             return
    except Exception as e:
        log(f"Semantic login button failed: {e}")

    if selectors == PRIMARY_SELECTORS:
        try:
            page.click(selectors['submit'])
        except:
             page.keyboard.press("Enter")
    else:
        # For Meta-style form, the button might be a div with role="button"
        try:
            # Find the correct "Log in" button (not "Log in with Facebook")
            # The main login button is typically aria-disabled when form is empty
            # and becomes enabled when credentials are filled
            
            # First try: get button with exact "Log in" text (not "Log in with Facebook")
            login_btn = page.get_by_role("button", name="Log in", exact=True)
            if login_btn.count() == 1:
                login_btn.click()
            elif login_btn.count() > 1:
                # Multiple matches, try to find the one that's NOT the Facebook button
                # The Facebook button usually contains an SVG icon
                for i in range(login_btn.count()):
                    btn = login_btn.nth(i)
                    inner_text = btn.inner_text()
                    # Skip if it contains "Facebook"
                    if "Facebook" not in inner_text:
                        btn.click()
                        break
            else:
                # Fallback: press Enter (form should submit)
                log("No exact 'Log in' button found, pressing Enter...")
                page.keyboard.press("Enter")
        except Exception as e:
            log(f"Warning: fallback login button click: {e}")
            # Ultimate fallback: press Enter
            page.keyboard.press("Enter")


def login_session(
    profile_name: str,
    proxy_string: str,
    username: str,
    password: str,
    log: callable,
    two_factor_secret: str = None,
    user_agent: str = None,
    headless: bool = False
):
    log(f"Starting login session for {username} (Profile: {profile_name})")
    login_succeeded = False
    
    try:
        with create_browser_context(
            profile_name=profile_name,
            proxy_string=proxy_string,
            user_agent=user_agent,
            headless=headless,
            block_images=False
        ) as (context, page):
            
            def mark_login_success():
                nonlocal login_succeeded
                login_succeeded = True
                log("__LOGIN_SUCCESS__")

            log("Navigating to Instagram...")
            try:
                if "instagram.com" not in page.url:
                    page.goto("https://www.instagram.com/accounts/login/", timeout=60000)
            except Exception as e:
                log(f"Navigation error (retrying): {e}")
                page.goto("https://www.instagram.com/accounts/login/", timeout=60000)

            # Wait for either login form or already logged in indicators
            log("Waiting for page load...")
            time.sleep(3)
            
            # Check if already logged in
            try:
                username_exists = (
                    page.locator(PRIMARY_SELECTORS['username']).count() > 0 or
                    page.locator(ALT_SELECTORS['username']).count() > 0
                )
                if not username_exists:
                    if HOME_BUTTON.find(page) or SEARCH_BUTTON.find(page):
                        log("Already logged in!")
                        mark_login_success()
                        return login_succeeded
            except:
                pass

            log("Attempting to fill credentials...")
            
            try:
                # Determine which selectors to use
                selectors = _find_login_inputs(page, log)
                
                if selectors is None:
                    # Wait a bit more and retry
                    time.sleep(3)
                    selectors = _find_login_inputs(page, log)
                    
                if selectors is None:
                    log("Could not find login form inputs!")
                    return False
                
                # Wait for username input
                page.wait_for_selector(selectors['username'], state="visible", timeout=20000)
                
                # Human-like typing
                log(f"Filling username: {username}")
                page.click(selectors['username'])
                random_delay(0.5, 1.0)
                page.keyboard.type(username, delay=100)
                random_delay(0.5, 1.5)
                
                log("Filling password...")
                page.click(selectors['password'])
                random_delay(0.5, 1.0)
                page.keyboard.type(password, delay=100)
                random_delay(0.5, 1.5)
                
                log("Submitting login form...")
                _click_login_button(page, selectors, log)
                
                # Wait for navigation or result
                log("Waiting for login result...")
                time.sleep(5)
                
                # Check for errors
                if page.locator("p[id='slfErrorAlert']").count() > 0:
                    error_text = page.locator("p[id='slfErrorAlert']").text_content()
                    log(f"Login failed: {error_text}")
                    return False
                
                # Check for success or 2FA
                try:
                    # Try finding home button
                    if HOME_BUTTON.find(page):
                         log("Login successful! (Home icon found)")
                         mark_login_success()
                    else:
                        page.wait_for_selector("svg[aria-label='Home']", timeout=20000)
                        log("Login successful! (Home icon found)")
                        mark_login_success()
                except:
                    # Maybe stuck on "Save Info" or 2FA
                    if "two_factor" in page.url or page.locator("input[name='verificationCode']").count() > 0:
                        log("2FA required!")
                        
                        if two_factor_secret:
                            try:
                                log("Generating 2FA code...")
                                code = generate_totp_code(two_factor_secret)
                                log(f"Entering 2FA code: {code}")
                                
                                # Try multiple selector patterns for 2FA input
                                twofa_input = page.locator("input[name='verificationCode']")
                                if twofa_input.count() == 0:
                                    twofa_input = page.locator("input[aria-label='Security Code']")
                                
                                twofa_input.wait_for(state="visible", timeout=10000)
                                twofa_input.fill(code)
                                random_delay(0.5, 1.0)
                                
                                log("Submitting 2FA code...")
                                # Try multiple button patterns
                                confirm_btn = page.locator("button:has-text('Confirm')")
                                if confirm_btn.count() > 0:
                                    confirm_btn.click()
                                else:
                                    # Try generic button[type='button'] near the input
                                    page.keyboard.press("Enter")
                                
                                # Wait for result
                                time.sleep(5)
                                
                                if "two_factor" not in page.url:
                                    log("2FA passed!")
                                else:
                                    # Retry confirm click
                                    if page.locator("button:has-text('Confirm')").count() > 0:
                                        page.locator("button:has-text('Confirm')").click()
                                        time.sleep(5)
                                        
                            except Exception as e:
                                log(f"Error entering 2FA: {e}")
                        else:
                            log("No 2FA secret provided. Please enter code manually if browser is open.")
                            time.sleep(30) 
                        
                        # Check success after 2FA
                        try:
                            page.wait_for_selector("svg[aria-label='Home']", timeout=20000)
                            log("Login successful! (Home icon found)")
                            mark_login_success()
                        except:
                            log("Login verification timed out after 2FA.")
                            
                    else:
                        log("Login verification timed out. Please check screenshot or manual intervention.")
                    
            except Exception as e:
                log(f"Error interacting with login form: {e}")
                traceback.print_exc()
                
            # Keep open for a bit to ensure cookies are saved
            log("Keeping session open for 10s to ensure persistence...")
            time.sleep(10)
            
            return login_succeeded
    except Exception as e:
        log(f"Critical error: {e}")
        traceback.print_exc()
        return False

