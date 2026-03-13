/**
 * Activity Registry
 *
 * This is the main entry point for all workflow activities.
 * Import from here to get access to all activities and helpers.
 *
 * FOLDER STRUCTURE:
 * - types.ts         → Type definitions
 * - browsing/        → Feed and reels activities
 * - engagement/      → Follow/unfollow activities
 * - messaging/       → DM activities
 * - stories/         → Story watching activities
 * - control/         → Flow control (delay, loop, etc.)
 *
 * TO ADD A NEW ACTIVITY:
 * 1. Create a new file in the appropriate category folder
 * 2. Export it from that folder's index.ts
 * 3. It will be automatically included in the registry
 */

// Re-export all types
export * from './types'
export type {
  ActivityCategory,
  InputType,
  ActivityInput,
  ActivityInputOption,
  ActivityOutput,
  ActivityDefinition,
} from './types'

// Import all activity groups
import { browsingActivities } from './browsing'
import { engagementActivities } from './engagement'
import { sendDm } from './messaging/send-dm'
import { storiesActivities } from './stories'
import { controlActivities } from './control'

import type { ActivityCategory, ActivityDefinition } from './types'

export type ActivityCategoryFilter = ActivityCategory | 'all'

const ACTIVITY_METADATA: Record<
  string,
  Pick<ActivityDefinition, 'keywords' | 'pickerGroup' | 'quickAdd'>
> = {
  start_browser: {
    quickAdd: true,
    pickerGroup: 'setup',
    keywords: ['browser', 'launch', 'open browser'],
  },
  select_list: {
    quickAdd: true,
    pickerGroup: 'setup',
    keywords: ['profiles', 'list', 'source list', 'audience'],
  },
  send_dm: {
    quickAdd: true,
    pickerGroup: 'messaging',
    keywords: ['message', 'dm', 'direct message', 'chat'],
  },
  delay: {
    quickAdd: true,
    pickerGroup: 'control',
    keywords: ['wait', 'sleep', 'pause'],
  },
  condition: {
    quickAdd: true,
    pickerGroup: 'control',
    keywords: ['if', 'branch', 'true false'],
  },
  loop: {
    quickAdd: true,
    pickerGroup: 'control',
    keywords: ['repeat', 'iterate'],
  },
  browse_feed: {
    quickAdd: true,
    pickerGroup: 'browsing',
    keywords: ['feed', 'scroll'],
  },
  scrape_relationships: {
    keywords: ['scrape', 'followers', 'following', 'relationship'],
    pickerGroup: 'browsing',
    quickAdd: false,
  },
  browse_reels: {
    keywords: ['reels', 'video'],
    pickerGroup: 'browsing',
    quickAdd: false,
  },
  random_branch: {
    keywords: ['split', 'weighted', 'path'],
    pickerGroup: 'control',
    quickAdd: false,
  },
  close_browser: {
    keywords: ['stop browser', 'close'],
    pickerGroup: 'setup',
    quickAdd: false,
  },
  approve_requests: {
    keywords: ['follow requests', 'approve'],
    pickerGroup: 'engagement',
    quickAdd: false,
  },
  follow_user: {
    keywords: ['follow', 'engagement'],
    pickerGroup: 'engagement',
    quickAdd: false,
  },
  unfollow_user: {
    keywords: ['unfollow', 'engagement'],
    pickerGroup: 'engagement',
    quickAdd: false,
  },
  watch_stories: {
    keywords: ['stories', 'watch'],
    pickerGroup: 'stories',
    quickAdd: false,
  },
}

// ============================================================================
// REGISTRY - All activities combined
// ============================================================================

const BASE_ACTIVITY_REGISTRY: ActivityDefinition[] = [
  ...browsingActivities,
  ...engagementActivities,
  sendDm,
  ...storiesActivities,
  ...controlActivities,
]

export const ACTIVITY_REGISTRY: ActivityDefinition[] = BASE_ACTIVITY_REGISTRY.map(
  (activity) => ({
    ...activity,
    ...ACTIVITY_METADATA[activity.id],
  }),
)

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Find an activity by its ID
 */
export function getActivityById(id: string): ActivityDefinition | undefined {
  return ACTIVITY_REGISTRY.find((a) => a.id === id)
}

/**
 * Get all activities in a category
 */
export function getActivitiesByCategory(
  category: ActivityCategory,
): ActivityDefinition[] {
  return ACTIVITY_REGISTRY.filter((a) => a.category === category)
}

/**
 * Get list of all categories
 */
export function getAllCategories(): ActivityCategory[] {
  return ['browsing', 'engagement', 'messaging', 'stories', 'control']
}

/**
 * Get display label for a category
 */
export function getCategoryLabel(category: ActivityCategory): string {
  const labels: Record<ActivityCategory, string> = {
    browsing: 'Browsing',
    engagement: 'Engagement',
    messaging: 'Messaging',
    stories: 'Stories',
    control: 'Control Flow',
  }
  return labels[category]
}

/**
 * Get icon name for a category
 */
export function getCategoryIcon(category: ActivityCategory): string {
  const icons: Record<ActivityCategory, string> = {
    browsing: 'Scroll',
    engagement: 'Users',
    messaging: 'MessageCircle',
    stories: 'CircleDot',
    control: 'Settings2',
  }
  return icons[category]
}

export function getQuickPickActivities(limit = 6): ActivityDefinition[] {
  return ACTIVITY_REGISTRY.filter((activity) => activity.quickAdd).slice(0, limit)
}

export function searchActivities(
  query: string,
  category: ActivityCategoryFilter = 'all',
): ActivityDefinition[] {
  const normalizedQuery = query.trim().toLowerCase()

  return ACTIVITY_REGISTRY.filter((activity) => {
    if (category !== 'all' && activity.category !== category) {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    const searchable = [
      activity.name,
      activity.description,
      activity.category,
      ...(activity.keywords ?? []),
    ]
      .join(' ')
      .toLowerCase()

    return searchable.includes(normalizedQuery)
  }).sort((left, right) => {
    if (left.quickAdd !== right.quickAdd) {
      return left.quickAdd ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })
}

/**
 * Generate default config values for an activity
 */
export function getDefaultConfig(activityId: string): Record<string, unknown> {
  const activity = getActivityById(activityId)
  if (!activity) return {}

  const config: Record<string, unknown> = {}
  for (const input of activity.inputs) {
    if (input.default !== undefined) {
      config[input.name] = input.default
    }
  }
  return config
}

export function normalizeActivityConfig(
  activityId: string,
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const defaults = getDefaultConfig(activityId)
  const rawConfig =
    config && typeof config === 'object' ? { ...config } : {}

  if (activityId === 'start_browser') {
    if (
      rawConfig.profileReopenCooldownEnabled === undefined &&
      rawConfig.profileReopenCooldownMinutes === undefined &&
      rawConfig.profileReopenCooldown !== undefined
    ) {
      rawConfig.profileReopenCooldownEnabled = true
      rawConfig.profileReopenCooldownMinutes = rawConfig.profileReopenCooldown
    }

    if (
      rawConfig.messagingCooldownEnabled === undefined &&
      rawConfig.messagingCooldownHours === undefined &&
      rawConfig.messagingCooldown !== undefined
    ) {
      rawConfig.messagingCooldownEnabled = true
      rawConfig.messagingCooldownHours = rawConfig.messagingCooldown
    }

    delete rawConfig.profileReopenCooldown
    delete rawConfig.messagingCooldown
  }

  return {
    ...defaults,
    ...rawConfig,
  }
}

/**
 * Validate config values against activity definition
 * Returns array of error messages (empty = valid)
 */
export function validateConfig(
  activityId: string,
  config: Record<string, unknown>,
): string[] {
  const activity = getActivityById(activityId)
  if (!activity) return ['Unknown activity']

  const errors: string[] = []
  for (const input of activity.inputs) {
    const value = config[input.name]

    // Check required
    if (
      input.required &&
      (value === undefined || value === null || value === '')
    ) {
      errors.push(`${input.label} is required`)
      continue
    }

    // Validate number ranges
    if (value !== undefined && value !== null) {
      if (input.type === 'number') {
        const num = Number(value)
        if (isNaN(num)) {
          errors.push(`${input.label} must be a number`)
        } else {
          if (input.min !== undefined && num < input.min) {
            errors.push(`${input.label} must be at least ${input.min}`)
          }
          if (input.max !== undefined && num > input.max) {
            errors.push(`${input.label} must be at most ${input.max}`)
          }
        }
      }
    }
  }
  return errors
}


