import type { ActivityDefinition } from '../types'

/**
 * Browse Feed Activity
 *
 * Scrolls through the Instagram home feed.
 * Settings mirror: FeedSettingsDialog
 */
export const browseFeed: ActivityDefinition = {
  id: 'browse_feed',
  name: 'Feed Scroll',
  description: 'Scroll through home feed',
  category: 'browsing',
  icon: 'Scroll',
  color: '#3b82f6',

  inputs: [
    // Duration (Min Time / Max Time)
    {
      name: 'feed_min_time_minutes',
      type: 'number',
      label: 'Min Time (min)',
      default: 1,
      min: 1,
      group: 'Duration',
    },
    {
      name: 'feed_max_time_minutes',
      type: 'number',
      label: 'Max Time (min)',
      default: 3,
      min: 1,
      group: 'Duration',
    },

    // Like Chance
    {
      name: 'like_chance',
      type: 'range',
      label: 'Like Chance (%)',
      default: 10,
      min: 0,
      max: 100,
      unit: '%',
    },

    // Follow Chance
    {
      name: 'follow_chance',
      type: 'range',
      label: 'Follow Chance (%)',
      default: 0,
      min: 0,
      max: 100,
      unit: '%',
    },

    // Carousel Watch Chance
    {
      name: 'carousel_watch_chance',
      type: 'range',
      label: 'Carousel Watch Chance (%)',
      default: 0,
      min: 0,
      max: 100,
      unit: '%',
    },

    // Carousel Max Slides
    {
      name: 'carousel_max_slides',
      type: 'number',
      label: 'Carousel Max Slides',
      default: 3,
      min: 1,
      max: 10,
      group: 'Carousel',
    },
    {
      name: 'watch_stories',
      type: 'boolean',
      label: 'Watch Stories Before Feed',
      default: false,
      helpText: 'Open the stories tray before feed scrolling starts.',
      group: 'Stories',
    },
    {
      name: 'stories_max',
      type: 'number',
      label: 'Max Stories',
      default: 3,
      min: 1,
      max: 50,
      group: 'Stories',
    },
    {
      name: 'stories_min_view_seconds',
      type: 'number',
      label: 'Min View',
      default: 2,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Story View Timing',
    },
    {
      name: 'stories_max_view_seconds',
      type: 'number',
      label: 'Max View',
      default: 5,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Story View Timing',
    },
    {
      name: 'skip_post_chance',
      type: 'range',
      label: 'Skip Post Chance (%)',
      default: 30,
      min: 0,
      max: 100,
      unit: '%',
      group: 'Skipping',
    },
    {
      name: 'skip_post_max',
      type: 'number',
      label: 'Max Posts to Skip',
      default: 2,
      min: 1,
      max: 10,
      group: 'Skipping',
    },
    {
      name: 'post_view_min_seconds',
      type: 'number',
      label: 'Min View',
      default: 2,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Post View Timing',
    },
    {
      name: 'post_view_max_seconds',
      type: 'number',
      label: 'Max View',
      default: 5,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Post View Timing',
    },
  ],

  outputs: ['success', 'failure'],
  pythonHandler: 'instagram_actions.browsing.feed_scrolling',
}


