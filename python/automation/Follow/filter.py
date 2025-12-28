from typing import Callable, Optional


def get_following_count(page, log: Callable[[str], None]) -> Optional[int]:
    """
    Try to extract the "following" count from an Instagram profile page.
    Uses multiple selectors and aria labels to improve resilience.
    """
    try:
        try:
            page.wait_for_selector('a[href*="/following"]', timeout=4000)
        except Exception:
            pass
        return page.evaluate(
            """
            () => {
                const parseCount = (str) => {
                    if (!str) return null;
                    str = str.toLowerCase().replace(/,/g, '').replace(/\\s/g, '');
                    let multiplier = 1;
                    if (str.includes('k')) {
                        multiplier = 1000;
                        str = str.replace('k', '');
                    } else if (str.includes('m')) {
                        multiplier = 1000000;
                        str = str.replace('m', '');
                    }
                    const val = parseFloat(str);
                    return isNaN(val) ? null : Math.round(val * multiplier);
                };

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
                    const match = combined.match(/([\\d.,]+\\s*[kmb]?)/i);
                    if (!match) return null;
                    return parseCount(match[1]);
                };

                for (const el of candidates) {
                    const num = extractNumber(el);
                    if (num !== null) return num;
                }

                const all = Array.from(document.querySelectorAll('a, span, div, li'));
                for (const el of all) {
                    const t = (el.innerText || el.textContent || '').toLowerCase().trim();
                    if (!t) continue;
                    const m = t.match(/([\\d.,kmb]+)[\\s\\n]+(following|подписки|подписок)/i);
                    if (m) {
                        const num = parseCount(m[1]);
                        if (num !== null) return num;
                    }
                }
                return null;
            }
            """
        )
    except Exception as err:
        log(f"ℹ️ Не удалось получить число подписок: {err}")
        return None


def get_posts_count(page, log: Callable[[str], None]) -> Optional[int]:
    """
    Try to extract the "posts" count from an Instagram profile page.
    """
    try:
        return page.evaluate(
            """
            () => {
                const parseCount = (str) => {
                    if (!str) return null;
                    str = str.toLowerCase().replace(/,/g, '').replace(/\\s/g, '');
                    let multiplier = 1;
                    if (str.includes('k')) {
                        multiplier = 1000;
                        str = str.replace('k', '');
                    } else if (str.includes('m')) {
                        multiplier = 1000000;
                        str = str.replace('m', '');
                    }
                    const val = parseFloat(str);
                    return isNaN(val) ? null : Math.round(val * multiplier);
                };

                // Strategy 1: Specific structure seen in modern React layout
                // Look for elements containing "posts" or "публикаций" with a number prefix
                const keywords = ["posts", "post", "публикаций", "публикации", "публикация"];
                const candidates = Array.from(document.querySelectorAll('span, div, li, a'));
                
                for (const el of candidates) {
                    // Get direct text or innerText
                    const text = (el.innerText || el.textContent || "").toLowerCase().trim();
                    if (!text) continue;
                    
                    // Check if it ends with one of the keywords
                    const hasKeyword = keywords.some(k => text.includes(k));
                    if (!hasKeyword) continue;

                    // Strict regex: Number followed by keyword (e.g. "19 posts", "1,234 posts", "10k posts")
                    // Allow optional newline or space
                    const match = text.match(/([\\d.,kmb]+)[\\s\\n]+(posts|post|публикаций|публикации|публикация)/i);
                    if (match) {
                        const num = parseCount(match[1]);
                        if (num !== null) return num;
                    }
                }
                
                // Strategy 2: Legacy <ul><li> list (often 3 items: posts, followers, following)
                const uls = document.querySelectorAll("ul");
                for (const ul of uls) {
                    // Instagram stats are often a list of 3 items
                    if (ul.children.length === 3) {
                         const firstLi = ul.children[0];
                         // Sometimes the text is "19 posts" with newline
                         const text = firstLi.innerText.toLowerCase();
                         if (text.includes('post') || text.includes('публикац')) {
                             const match = text.match(/([\\d.,kmb]+)/);
                             if (match) {
                                 const num = parseCount(match[1]);
                                 if (num !== null) return num;
                             }
                         }
                    }
                }

                return null;
            }
            """
        )
    except Exception as err:
        log(f"ℹ️ Не удалось получить число постов: {err}")
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

    try:
        page.wait_for_selector('a[href*="/following"]', timeout=4000)
    except Exception:
        pass
    count = get_following_count(page, log)
    if count is None:
        log("ℹ️ Не удалось определить число подписок, продолжаю без фильтра.")
        return False

    log(f"ℹ️ @{username}: подписок {count}, лимит {limit_val}.")
    if count > limit_val:
        log(f"⏭️ Пропускаю @{username}: слишком много подписок ({count} > {limit_val}).")
        return True
    return False


