import type { SocketTopic } from './contracts.js'

export type SocketSubscription = { topic: SocketTopic }

export function parseSubscription(params: URLSearchParams): SocketSubscription {
  const topic = params.get('topic')
  return { topic: topic === 'displays' || topic === 'chat' ? topic : 'all' }
}

export function matchesSubscription(data: object, subscription?: SocketSubscription): boolean {
  if (!subscription || subscription.topic === 'all') return true
  const event = data as { type?: string }
  if (subscription.topic === 'chat') return event.type === 'chat_changed'
  return [
    'display_allocated',
    'display_released',
    'profile_completed',
    'automation_status',
  ].includes(event.type ?? '')
}
