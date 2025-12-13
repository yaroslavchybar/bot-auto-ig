"""
Instagram automation functions using Playwright/Camoufox
"""
import time
import random
import os
from typing import Optional, List


def random_delay(min_seconds: float = 1.0, max_seconds: float = 3.0):
    """Add a random delay to appear human-like"""
    time.sleep(random.uniform(min_seconds, max_seconds))


def onboard_account(page) -> bool:
    """
    Onboarding placeholder for Instagram.
    """
    try:
        print("[*] Starting onboarding process...")
        if "instagram.com" not in page.url:
            page.goto("https://www.instagram.com/", timeout=30000)
        
        # Handle "Save Login Info"
        try:
             save_info = page.wait_for_selector('button:has-text("Save Info"), button:has-text("Not Now")', timeout=5000)
             if save_info: 
                 save_info.click()
                 random_delay(1, 2)
        except:
            pass
            
         # Handle "Turn on Notifications"
        try:
             notif = page.wait_for_selector('button:has-text("Turn On"), button:has-text("Not Now")', timeout=5000)
             if notif: 
                 notif.click() # or Not Now
                 random_delay(1, 2)
        except:
            pass
            
        print("[✓] Onboarding steps handled")
        return True
        
    except Exception as e:
        print(f"[!] Error during onboarding: {e}")
        return False


def random_delay(min_seconds: float = 1.0, max_seconds: float = 3.0):
    """Add a random delay to appear human-like"""
    time.sleep(random.uniform(min_seconds, max_seconds))
