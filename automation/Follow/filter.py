from typing import Callable, Optional


def get_following_count(page, log: Callable[[str], None]) -> Optional[int]:
    """
    Try to extract the "following" count from an Instagram profile page.
    Uses multiple selectors and aria labels to improve resilience.
    """
    try:
        return page.evaluate(
            """
            () => {
                const candidates = Array.from(
                    document.querySelectorAll(
                        'a[href$="/following/"], a[href$="/following"], a[href*="/following"]'
                    )
                );

                const extractNumber = (el) => {
                    if (!el) return null;
                    const texts = [];
                    texts.push(el.innerText || "");
                    texts.push(el.textContent || "");
                    texts.push(el.getAttribute("aria-label") || "");
                    const span = el.querySelector("span");
                    if (span) {
                        texts.push(span.innerText || "");
                        texts.push(span.textContent || "");
                    }
                    const combined = texts.join(" ").trim();
                    if (!combined) return null;
                    const match = combined.match(/[\\d.,\\s]+/);
                    if (!match) return null;
                    const normalized = match[0].replace(/[^\\d]/g, "");
                    if (!normalized) return null;
                    const asInt = parseInt(normalized, 10);
                    return Number.isNaN(asInt) ? null : asInt;
                };

                for (const el of candidates) {
                    const num = extractNumber(el);
                    if (num !== null) return num;
                }
                return null;
            }
            """
        )
    except Exception as err:
        log(f"ℹ️ Не удалось получить число подписок: {err}")
        return None


def should_skip_by_following(
    page,
    username: str,
    limit: Optional[int],
    log: Callable[[str], None],
) -> bool:
    """Return True if following count exceeds limit (when limit > 0)."""
    if limit is None:
        return False
    try:
        limit_val = int(limit)
    except Exception:
        log(f"ℹ️ Некорректный лимит подписок: {limit}, пропускаю фильтр.")
        return False

    if limit_val <= 0:
        return False

    count = get_following_count(page, log)
    if count is None:
        log("ℹ️ Не удалось определить число подписок, продолжаю без фильтра.")
        return False

    log(f"ℹ️ @{username}: подписок {count}, лимит {limit_val}.")
    if count > limit_val:
        log(f"⏭️ Пропускаю @{username}: слишком много подписок ({count} > {limit_val}).")
        return True
    return False


