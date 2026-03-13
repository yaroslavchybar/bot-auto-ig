from typing import TypedDict, Tuple


class FollowInteractionsConfig(TypedDict, total=False):
    highlights_range: Tuple[int, int]
    likes_percentage: int
    scroll_percentage: int
