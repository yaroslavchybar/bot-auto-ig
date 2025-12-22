import argparse
from automation.browser import run_browser

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", type=str, required=True)
    parser.add_argument("--proxy", type=str, default="None")
    parser.add_argument("--action", type=str, default="manual", help="manual, scroll, reels, mixed")
    parser.add_argument("--duration", type=int, default=5, help="Duration in minutes for single action")
    parser.add_argument("--feed-duration", type=int, default=0, help="Duration for feed in mixed mode")
    parser.add_argument("--reels-duration", type=int, default=0, help="Duration for reels in mixed mode")

    
    # Add new arguments for interaction chances
    parser.add_argument("--match-likes", type=int, default=10, help="Chance to like a post (0-100)")
    parser.add_argument("--match-comments", type=int, default=5, help="Chance to comment on a post (0-100)")
    parser.add_argument("--match-follows", type=int, default=5, help="Chance to follow a user (0-100)")
    parser.add_argument("--reels-match-likes", type=int, default=None, help="Chance to like a reel (0-100)")
    parser.add_argument("--reels-match-follows", type=int, default=None, help="Chance to follow from reels (0-100)")
    parser.add_argument("--carousel-watch-chance", type=int, default=0, help="Chance to watch carousel slides (0-100)")
    parser.add_argument("--carousel-max-slides", type=int, default=3, help="Max slides to advance in a carousel")
    parser.add_argument("--watch-stories", type=int, default=1, help="Whether to watch stories at start (1/0)")
    parser.add_argument("--stories-max", type=int, default=3, help="Max number of stories to watch")
    parser.add_argument("--show-cursor", action="store_true", help="Show the human-like cursor for debugging")
    parser.add_argument("--user-agent", type=str, default=None, help="Custom User Agent string")
    
    args = parser.parse_args()

    run_browser(
        profile_name=args.name, 
        proxy_string=args.proxy, 
        action=args.action, 
        duration=args.duration, 
        match_likes=args.match_likes,
        match_comments=args.match_comments,
        match_follows=args.match_follows,
        carousel_watch_chance=args.carousel_watch_chance,
        carousel_max_slides=args.carousel_max_slides,
        watch_stories=bool(args.watch_stories),
        stories_max=args.stories_max,
        feed_duration=args.feed_duration,
        reels_duration=args.reels_duration,
        show_cursor=args.show_cursor,
        reels_match_likes=args.reels_match_likes,
        reels_match_follows=args.reels_match_follows,
        user_agent=args.user_agent
    )