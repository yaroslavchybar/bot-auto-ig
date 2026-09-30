export function buildVncWebSocketUrl(vncPort: number) {
  if (typeof window === 'undefined') {
    return `ws://localhost:3003/vnc/${vncPort}/websockify`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const isLocalDevHost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'

  if (isLocalDevHost) {
    return `${protocol}://localhost:3003/vnc/${vncPort}/websockify`
  }

  return `${protocol}://${window.location.host}/vnc/${vncPort}/websockify`
}


