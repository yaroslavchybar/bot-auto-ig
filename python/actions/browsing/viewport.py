import random


def _get_viewport_size(page) -> tuple[int, int]:
    try:
        viewport = getattr(page, 'viewport_size', None)
        if viewport and viewport.get('width') and viewport.get('height'):
            return int(viewport['width']), int(viewport['height'])
    except Exception:
        pass
    try:
        viewport_h = page.evaluate('() => window.innerHeight') or 0
        viewport_w = page.evaluate('() => window.innerWidth') or 0
        return int(viewport_w), int(viewport_h)
    except Exception:
        return 0, 0


def _pick_point(viewport_w: int, viewport_h: int) -> tuple[int, int]:
    if viewport_w > 0 and viewport_h > 0:
        x = random.randint(int(viewport_w * 0.18), int(viewport_w * 0.82))
        y = random.randint(int(viewport_h * 0.20), int(viewport_h * 0.80))
        return x, y
    return random.randint(200, 600), random.randint(200, 500)
