def click_center(page, element) -> bool:
    try:
        box = element.bounding_box()
        if not box:
            return False
        x = box["x"] + box["width"] / 2
        y = box["y"] + box["height"] / 2
        page.mouse.click(x, y)
        return True
    except Exception:
        try:
            element.click()
            return True
        except Exception:
            return False


def extract_label(el) -> str:
    try:
        label = el.get_attribute("aria-label")
        if label:
            return label.lower()

        ancestor = el.query_selector('xpath=ancestor-or-self::*[@aria-label][1]')
        if ancestor and ancestor != el:
            label = ancestor.get_attribute("aria-label")
            if label:
                return label.lower()
    except Exception:
        pass
    return ""


def looks_new_story(el) -> bool:
    label = extract_label(el)
    if not label:
        return False
    if "not seen" in label:
        return True
    if "new" in label and "story" in label:
        return True
    if "seen" in label:
        return False
    return False

