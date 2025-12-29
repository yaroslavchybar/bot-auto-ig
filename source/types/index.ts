export type ActionName =
    | 'Feed Scroll'
    | 'Reels Scroll'
    | 'Watch Stories'
    | 'Follow'
    | 'Unfollow'
    | 'Approve Requests'
    | 'Send Messages';

export type ListRow = { id: string; name: string };

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export type LogEntry = {
    ts: number;
    message: string;
    source?: string;
    level?: LogLevel;
};

export type InstagramSettings = {
    automation_enabled: boolean;
    use_private_profiles: boolean;
    action_order: ActionName[];
    like_chance: number;
    carousel_watch_chance: number;
    follow_chance: number;
    reels_like_chance: number;
    reels_follow_chance: number;
    reels_skip_chance: number;
    reels_skip_min_time: number;
    reels_skip_max_time: number;
    reels_normal_min_time: number;
    reels_normal_max_time: number;
    carousel_max_slides: number;
    stories_max: number;
    feed_min_time_minutes: number;
    feed_max_time_minutes: number;
    reels_min_time_minutes: number;
    reels_max_time_minutes: number;
    max_sessions: number;
    parallel_profiles: number;
    enable_feed: boolean;
    enable_reels: boolean;
    enable_follow: boolean;
    watch_stories: boolean;
    headless: boolean;
    profile_reopen_cooldown_enabled: boolean;
    profile_reopen_cooldown_minutes: number;
    messaging_cooldown_enabled: boolean;
    messaging_cooldown_hours: number;
    highlights_min: number;
    highlights_max: number;
    likes_percentage: number;
    scroll_percentage: number;
    following_limit: number;
    follow_min_count: number;
    follow_max_count: number;
    min_delay: number;
    max_delay: number;
    unfollow_min_count: number;
    unfollow_max_count: number;
    do_unfollow: boolean;
    do_approve: boolean;
    do_message: boolean;
    source_list_ids: string[];
};

export const ACTIONS: ActionName[] = [
    'Feed Scroll',
    'Reels Scroll',
    'Watch Stories',
    'Follow',
    'Unfollow',
    'Approve Requests',
    'Send Messages',
];

export const DEFAULT_SETTINGS: InstagramSettings = {
    automation_enabled: false,
    use_private_profiles: true,
    action_order: [...ACTIONS],
    like_chance: 10,
    carousel_watch_chance: 0,
    follow_chance: 50,
    reels_like_chance: 10,
    reels_follow_chance: 50,
    reels_skip_chance: 30,
    reels_skip_min_time: 0.8,
    reels_skip_max_time: 2.0,
    reels_normal_min_time: 5.0,
    reels_normal_max_time: 20.0,
    carousel_max_slides: 3,
    stories_max: 3,
    feed_min_time_minutes: 1,
    feed_max_time_minutes: 3,
    reels_min_time_minutes: 1,
    reels_max_time_minutes: 3,
    max_sessions: 5,
    parallel_profiles: 1,
    enable_feed: true,
    enable_reels: false,
    enable_follow: false,
    watch_stories: true,
    headless: false,
    profile_reopen_cooldown_enabled: true,
    profile_reopen_cooldown_minutes: 30,
    messaging_cooldown_enabled: true,
    messaging_cooldown_hours: 2,
    highlights_min: 2,
    highlights_max: 4,
    likes_percentage: 0,
    scroll_percentage: 0,
    following_limit: 3000,
    follow_min_count: 5,
    follow_max_count: 15,
    min_delay: 10,
    max_delay: 30,
    unfollow_min_count: 5,
    unfollow_max_count: 15,
    do_unfollow: false,
    do_approve: false,
    do_message: false,
    source_list_ids: [],
};
