import time
import random
import math
import logging

from typing import Callable

logger = logging.getLogger(__name__)

def human_scroll(page, total_delta: int | None = None, should_stop: Callable[[], bool] | None = None):
    """
    Simplified human-like scroll using mouse wheel events only.
    """
    try:
        # Move mouse to a plausible location first
        x = random.randint(200, 600)
        y = random.randint(200, 500)
        page.mouse.move(x, y)
        time.sleep(random.uniform(0.05, 0.15))

        if should_stop and should_stop():
            return

        total = total_delta or random.randint(300, 600)
        steps = random.randint(3, 6)
        remaining = total

        for i in range(steps):
            if should_stop and should_stop():
                return
            if remaining <= 0:
                break
            step = max(40, int(remaining / (steps - i) + random.randint(-30, 30)))
            step = min(step, remaining)
            page.mouse.wheel(0, step)
            remaining -= step
            time.sleep(random.uniform(0.05, 0.18))

        # Occasional tiny correction scroll
        if random.random() < 0.2:
            correction = random.randint(-40, 40)
            if correction:
                page.mouse.wheel(0, correction)
                time.sleep(random.uniform(0.05, 0.12))

    except Exception as e:
        logger.error(f"Error in human_scroll: {e}")
        # Fallback to a simple smooth scroll via JS
        try:
            page.evaluate(
                f"window.scrollBy({{top: {total_delta or 400}, behavior: 'smooth'}})"
            )
            time.sleep(0.5)
        except Exception:
            pass


def human_mouse_move(page):
    """
    Perform realistic mouse movement to simulate human attention/browsing.
    """
    try:
        start_x = random.randint(200, 600)
        start_y = random.randint(200, 500)
        end_x = random.randint(100, 700)
        end_y = random.randint(150, 600)

        distance = math.sqrt((end_x - start_x) ** 2 + (end_y - start_y) ** 2)
        steps = max(5, int(distance / 30))

        page.mouse.move(end_x, end_y, steps=steps)

        if random.random() < 0.4:
            time.sleep(random.uniform(0.1, 0.3))
            jitter_x = end_x + random.randint(-20, 20)
            jitter_y = end_y + random.randint(-15, 15)
            page.mouse.move(jitter_x, jitter_y, steps=2)

    except Exception:
        pass

