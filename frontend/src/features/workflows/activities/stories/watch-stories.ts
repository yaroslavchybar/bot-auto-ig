import type { ActivityDefinition } from '../types'

/**
 * Watch Stories Activity
 *
 * Views stories from the feed.
 * Settings mirror: StoriesSettingsDialog
 */
export const watchStories: ActivityDefinition = {
  id: 'watch_stories',
  name: 'Watch Stories',
  description: 'View stories from feed',
  category: 'stories',
  icon: 'CircleDot',
  color: '#f97316',

  inputs: [
    {
      name: 'stories_max',
      type: 'number',
      label: 'Max Stories to Watch',
      default: 3,
      min: 1,
      max: 50,
      helpText: 'Maximum number of stories to watch per profile',
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
      group: 'View Timing',
    },
    {
      name: 'stories_max_view_seconds',
      type: 'number',
      label: 'Max View',
      default: 5,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'View Timing',
    },
  ],

  outputs: ['success', 'failure'],
  pythonHandler: 'instagram_actions.stories.watch',
}


