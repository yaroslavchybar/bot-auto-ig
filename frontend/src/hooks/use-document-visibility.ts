import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(onChange: () => void) {
  if (listeners.size === 0) document.addEventListener('visibilitychange', notify)
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) document.removeEventListener('visibilitychange', notify)
  }
}

function readVisibility() {
  return document.visibilityState !== 'hidden'
}

export function useDocumentVisibility() {
  return useSyncExternalStore(subscribe, readVisibility, () => true)
}
