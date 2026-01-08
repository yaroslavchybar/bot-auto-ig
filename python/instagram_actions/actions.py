"""
Instagram automation functions using Playwright/Camoufox
"""
import time
import random


def random_delay(min_seconds: float = 1.0, max_seconds: float = 3.0):
    """Add a random delay to appear human-like"""
    time.sleep(random.uniform(min_seconds, max_seconds))
