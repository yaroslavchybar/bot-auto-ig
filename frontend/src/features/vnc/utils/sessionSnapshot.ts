// A poll started before a socket event must not replace that newer state.
export function createSessionSnapshotGuard() {
  let revision = 0
  let request = 0
  return {
    begin() { return { revision, request: ++request } },
    invalidate() { revision++ },
    isCurrent(snapshot: { revision: number; request: number }) {
      return snapshot.revision === revision && snapshot.request === request
    },
  }
}

export function isSessionEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object' || !('type' in event)) return false
  return ['display_allocated', 'display_released', 'profile_completed', 'automation_status'].includes(String(event.type))
}
