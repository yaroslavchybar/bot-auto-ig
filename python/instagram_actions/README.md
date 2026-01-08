# Instagram Actions

> **For AI Agents**: This folder contains all Instagram automation features. Choose the subfolder for the feature you want to modify.

## Subfolders

| Folder | Purpose |
|--------|---------|
| `browsing/` | Feed and Reels scrolling automation |
| `engagement/` | Follow, unfollow, approve follow requests |
| `stories/` | Story watching automation |
| `messaging/` | Direct message automation |
| `login/` | Login flow handling |

## Feature Map

### Browsing
- `browsing/feed-scrolling/` → Scroll through Instagram feed, like posts
- `browsing/reels-scrolling/` → Watch reels, like, follow from reels

### Engagement
- `engagement/follow-users/` → Follow users by username
- `engagement/unfollow-users/` → Unfollow users
- `engagement/approve-follow-requests/` → Approve pending follow requests

### Stories
- `stories/` → Watch stories from followed accounts

### Messaging
- `messaging/` → Send direct messages using templates

## When to Modify

- **Changing how likes work?** → `browsing/feed-scrolling/` or `browsing/reels-scrolling/`
- **Changing follow behavior?** → `engagement/follow-users/`
- **Adding new DM templates?** → `messaging/`
