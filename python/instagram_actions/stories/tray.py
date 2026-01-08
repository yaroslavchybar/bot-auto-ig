import logging

from .utils import looks_new_story


logger = logging.getLogger(__name__)


def find_story_bubble(page, log=None):
    log = log or logger.info
    selectors = [
        'li._acaz [aria-label*="story" i]',
        '[aria-label*="story" i]',
        '[aria-label*="not seen" i]',
        'div[role="button"][aria-label]',
    ]

    candidates = []
    for sel in selectors:
        try:
            for el in page.query_selector_all(sel):
                try:
                    box = el.bounding_box()
                    if not box:
                        continue
                    if box["y"] < 280:
                        candidates.append((box["y"], box["x"], looks_new_story(el), el))
                except Exception:
                    continue
        except Exception:
            continue

    if not candidates:
        return None

    unseen = [c for c in candidates if c[2]]
    if not unseen:
        log("Stories: no unseen bubbles found, skipping")
        return None

    unseen.sort(key=lambda t: (t[0], t[1]))
    return unseen[0][3]

