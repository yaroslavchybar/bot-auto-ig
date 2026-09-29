import type { SocketTopic } from './contracts.js'

export type SocketSubscription = { topic: SocketTopic }

export function parseSubscription(params: URLSearchParams): SocketSubscription {
  return { topic: params.get('topic') === 'displays' ? 'displays' : 'all' }
}

export function matchesSubscription(data: object, subscription?: SocketSubscription): boolean {
  if (!subscription || subscription.topic === 'all') return true
  const event = data as { type?: string }
  return ['display_allocated', 'display_released', 'profile_completed', 'automation_status'].includes(event.type ?? '')
}
