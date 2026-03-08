export function buildVncWebSocketUrl(vncPort: number) {
  if (typeof window === 'undefined') {
    return `ws://localhost:${vncPort}/websockify`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.hostname}:${vncPort}/websockify`
}
