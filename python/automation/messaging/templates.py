from typing import List

from python.supabase.message_templates_client import MessageTemplatesClient


def load_message_2_texts() -> List[str]:
    try:
        cloud = MessageTemplatesClient().get_texts("message_2")
        if cloud:
            return cloud
    except Exception:
        pass

    return ["Hi there! Thanks for reaching out!"]

