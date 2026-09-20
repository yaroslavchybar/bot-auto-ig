import type { SocketTopic } from './contracts.js'

export type SocketSubscription = {
  topic: SocketTopic
  automationId?: string
  profileName?: string
}

export function parseSubscription(params: URLSearchParams): SocketSubscription {
  const topic = params.get('topic')
  return {
    topic: topic === 'logs' || topic === 'displays' ? topic : 'all',
    automationId: params.get('automationId') || undefined,
    profileName: params.get('profileName')?.trim().toLowerCase() || undefined,
  }
}

export function matchesSubscription(data: object, subscription?: SocketSubscription): boolean {
  if (!subscription || subscription.topic === 'all') return true
  const event = data as { type?: string; automationId?: string; profileName?: string }
  if (subscription.topic === 'displays') {
    return ['display_allocated', 'display_released', 'profile_completed', 'automation_status'].includes(event.type ?? '')
  }
  return event.type === 'log'
    && (!subscription.automationId || event.automationId?.trim() === subscription.automationId)
    && (!subscription.profileName || event.profileName?.trim().toLowerCase() === subscription.profileName)
}
