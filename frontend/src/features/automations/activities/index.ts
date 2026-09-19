/**
 * Activity Registry
 *
 * This is the main entry point for all automation activities.
 * Import from here to get access to all activities and helpers.
 *
 * FOLDER STRUCTURE:
 * - types.ts         → Type definitions
 * - browsing/        → Feed activities
 * - engagement/      → Engagement activities (empty until activities register)
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
import { storiesActivities } from './stories'
import { controlActivities } from './control'

import type { ActivityCategory, ActivityDefinition } from './types'

export type ActivityCategoryFilter = ActivityCategory | 'all'

// ============================================================================
// REGISTRY - All activities combined
// ============================================================================

export const ACTIVITY_REGISTRY: ActivityDefinition[] = [
  ...browsingActivities,
  ...engagementActivities,
  ...storiesActivities,
  ...controlActivities,
]


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
 * Get list of all categories
 */
export function getAllCategories(): ActivityCategory[] {
  return ['browsing', 'stories', 'control']
}

/**
 * Get display label for a category
 */
export function getCategoryLabel(category: ActivityCategory): string {
  const labels: Record<string, string> = {
    browsing: 'Browsing',
    stories: 'Stories',
    control: 'Control Flow',
  }
  return (labels[category] ?? category) as string
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

  return {
    ...defaults,
    ...rawConfig,
  }
}

/**
 * Activities allowed at most once per automation.
 * The editor, duplicate, and import paths all enforce this.
 */
export const SINGLETON_ACTIVITY_IDS: ReadonlySet<string> = new Set([
  'browse_feed',
])
