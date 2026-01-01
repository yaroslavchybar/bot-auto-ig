def detect_incoming_messages(page) -> bool:
    try:
        total_messages = page.locator('[role="row"]').count()
        our_messages = page.locator('h6:has-text("You sent")').count()

        if total_messages > 0 and our_messages < total_messages:
            return True

        all_sender_elements = page.locator("h6").all_text_contents()
        for sender in all_sender_elements:
            if sender and "You sent" not in sender:
                return True

        return False
    except Exception as e:
        print(f"Error detecting incoming messages: {e}")
        return False

