import type { ActivityDefinition } from '../types'

/**
 * Warm Up Activity
 *
 * Runs Explore warm-up before the shared browsing session.
 */
export const browseFeed: ActivityDefinition = {
  id: 'browse_feed',
  quickAdd: true,
  pickerGroup: 'browsing',
  keywords: ['warm', 'warm up', 'feed', 'scroll'],
  name: 'Warm Up',
  description: 'Warm up through Explore, then browse and engage with content matching your interests',
  category: 'browsing',
  icon: 'Scroll',
  color: '#3b82f6',

  inputs: [
    { name: 'browse_home_feed', type: 'boolean', label: 'Home feed', default: true, group: 'Browsing' },
    { name: 'scroll_reels', type: 'boolean', label: 'Reels scroll', default: true, group: 'Browsing' },
    { name: 'warmup_topics', type: 'string', label: 'Interests', default: '',
      placeholder: 'People sharing gym workouts and strength training tips', group: 'Browsing',
      helpText: 'Describe your interests in plain English. Luna generates search phrases. Blank uses normal browsing.' },
    // Warm-up plan: minutes assigned at random from this range each day
    {
      name: 'warmup_min_minutes',
      type: 'number',
      label: 'Min Minutes',
      default: 10,
      min: 1,
      max: 100,
      group: 'Daily Budget',
      helpText: 'Lower bound of the daily assigned time.',
    },
    {
      name: 'warmup_max_minutes',
      type: 'number',
      label: 'Max Minutes',
      default: 20,
      min: 1,
      max: 100,
      group: 'Daily Budget',
      helpText: 'Upper bound of the daily assigned time.',
    },

    {
      name: 'session_min_minutes', type: 'number', label: 'Min Minutes',
      default: 5, min: 1, max: 60, group: 'Session Duration',
      helpText: 'Each session is capped by the remaining daily budget.',
    },
    {
      name: 'session_max_minutes', type: 'number', label: 'Max Minutes',
      default: 10, min: 1, max: 60, group: 'Session Duration',
    },
    {
      name: 'rest_min_minutes', type: 'number', label: 'Min Minutes',
      default: 60, min: 1, max: 1440, group: 'Rest Between Sessions',
    },
    {
      name: 'rest_max_minutes', type: 'number', label: 'Max Minutes',
      default: 120, min: 1, max: 1440, group: 'Rest Between Sessions',
      helpText: 'This profile rests between sessions while the automation runs other eligible profiles.',
    },

    {
      name: 'watch_stories',
      type: 'boolean',
      label: 'Watch Stories Before Feed',
      default: true,
      helpText: 'Watch unseen Stories for 1–3 minutes before content browsing.',
      group: 'Stories',
    },
  ],

  outputs: ['success', 'failure'],
}


