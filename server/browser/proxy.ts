import { Server } from 'proxy-chain'
import type { parseProxy } from './config.js'

/** Bridge SOCKS5 authentication, which Playwright cannot pass to the browser. */
export async function prepareBrowserProxy(proxy: ReturnType<typeof parseProxy>) {
  if (!proxy?.server.startsWith('socks5://') || !(proxy.username || proxy.password))
    return { proxy, close: async () => {} }

  const upstream = new URL(proxy.server)
  upstream.username = proxy.username || ''
  upstream.password = proxy.password || ''
  const relay = new Server({
    host: '127.0.0.1',
    port: 0,
    prepareRequestFunction: () => ({ upstreamProxyUrl: upstream.href }),
  })
  await relay.listen()
  let closing: Promise<void> | undefined
  return {
    proxy: { server: `http://127.0.0.1:${relay.port}` },
    close: () => (closing ??= relay.close(true)),
  }
}
