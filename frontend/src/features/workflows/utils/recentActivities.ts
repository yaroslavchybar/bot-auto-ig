const RECENT_ACTIVITY_STORAGE_KEY = 'workflow-editor-recent-activities'
const MAX_RECENT_ACTIVITY_IDS = 8

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function getRecentActivityIds(): string[] {
  if (!canUseLocalStorage()) {
    return []
  }

  try {
    const stored = window.localStorage.getItem(RECENT_ACTIVITY_STORAGE_KEY)
    if (!stored) {
      return []
    }

    const parsed = JSON.parse(stored)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

export function rememberRecentActivity(activityId: string) {
  if (!canUseLocalStorage()) {
    return
  }

  const recentIds = getRecentActivityIds().filter((id) => id !== activityId)
  recentIds.unshift(activityId)

  try {
    window.localStorage.setItem(
      RECENT_ACTIVITY_STORAGE_KEY,
      JSON.stringify(recentIds.slice(0, MAX_RECENT_ACTIVITY_IDS)),
    )
  } catch {
    return
  }
}
