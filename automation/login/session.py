import time
import traceback
from automation.browser import create_browser_context
from automation.actions import random_delay
from utils.totp import generate_totp_code

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
            
            # Check if already logged in (e.g. check for Search svg or Home link)
            try:
                # Common selector for logged in state (Home button or similar)
                # Or just check if login inputs are absent
                if page.locator("input[name='username']").count() == 0:
                     # Maybe already logged in or different page
                     if page.locator("svg[aria-label='Home']").count() > 0 or \
                        page.locator("svg[aria-label='Search']").count() > 0:
                         log("✅ Already logged in!")
                         mark_login_success()
                         return login_succeeded
            except:
                pass

            log("Attempting to fill credentials...")
            
            try:
                # Wait for username input
                page.wait_for_selector("input[name='username']", state="visible", timeout=20000)
                
                # Human-like typing
                log(f"Filling username: {username}")
                page.click("input[name='username']")
                random_delay(0.5, 1.0)
                page.keyboard.type(username, delay=100)
                random_delay(0.5, 1.5)
                
                log("Filling password...")
                page.click("input[name='password']")
                random_delay(0.5, 1.0)
                page.keyboard.type(password, delay=100)
                random_delay(0.5, 1.5)
                
                log("Submitting login form...")
                page.click("button[type='submit']")
                
                # Wait for navigation or result
                log("Waiting for login result...")
                time.sleep(5)
                
                # Check for errors
                if page.locator("p[id='slfErrorAlert']").count() > 0:
                    error_text = page.locator("p[id='slfErrorAlert']").text_content()
                    log(f"❌ Login failed: {error_text}")
                    return
                
                # Check for "Save Login Info" or "Turn on Notifications" or Home
                # Often Instagram asks to save info
                try:
                    # Wait for Home or "Save Info"
                    # We can look for "Save Info" button usually has text "Save Info" or "Not Now"
                    # But better to wait for URL change or Home icon
                    
                    page.wait_for_selector("svg[aria-label='Home']", timeout=20000)
                    log("✅ Login successful! (Home icon found)")
                    mark_login_success()
                except:
                    # Maybe stuck on "Save Info" or 2FA
                    if "two_factor" in page.url:
                        log("⚠️ 2FA required!")
                        
                        if two_factor_secret:
                            try:
                                log("Generating 2FA code...")
                                code = generate_totp_code(two_factor_secret)
                                log(f"Entering 2FA code: {code}")
                                
                                page.wait_for_selector("input[name='verificationCode']", timeout=10000)
                                page.fill("input[name='verificationCode']", code)
                                random_delay(0.5, 1.0)
                                
                                log("Submitting 2FA code...")
                                page.click("button[type='button']") # Often the confirm button is just type='button' or confirm text
                                # Based on screenshot, button has text "Confirm"
                                # page.get_by_text("Confirm").click() is safer if available, but let's try generic first or look for class
                                # The screenshot shows <button ...>Confirm</button>
                                
                                # Wait for result
                                time.sleep(5)
                                
                                if "two_factor" not in page.url:
                                    log("✅ 2FA passed!")
                                    # Might see "Save Info" or "Trust this device" now
                                    # Screenshot shows "Trust this device" is checked by default
                                else:
                                     # Maybe click confirm again or check for error
                                     # Try more specific selector if generic button fail
                                     if page.locator("button:has-text('Confirm')").count() > 0:
                                         page.locator("button:has-text('Confirm')").click()
                                         time.sleep(5)
                                         
                            except Exception as e:
                                log(f"❌ Error entering 2FA: {e}")
                        else:
                            log("⚠️ No 2FA secret provided. Please enter code manually if browser is open.")
                            # We might need to wait longer here if user is watching
                            time.sleep(30) 
                        
                        # Check success after 2FA
                        try:
                            page.wait_for_selector("svg[aria-label='Home']", timeout=20000)
                            log("✅ Login successful! (Home icon found)")
                            mark_login_success()
                        except:
                            log("⚠️ Login verification timed out after 2FA.")
                            
                    else:
                        log("⚠️ Login verification timed out. Please check screenshot or manual intervention.")
                    
            except Exception as e:
                log(f"❌ Error interacting with login form: {e}")
                
            # Keep open for a bit to ensure cookies are saved
            log("Keeping session open for 10s to ensure persistence...")
            time.sleep(10)
            
            return login_succeeded
    except Exception as e:
        log(f"❌ Critical error: {e}")
        traceback.print_exc()
        return False
