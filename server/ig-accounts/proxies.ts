import https from 'node:https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { normalizeProxy } from '../shared/proxy.js'
import { igAccountRequest } from '../shared/convexClient.js'

export type ExitLocation = { ip: string; country: string }
const countryCache = new Map<string, { location: ExitLocation; expires: number }>()

/** Resolve the actual exit through a proxy, not the gateway server's location. */
export async function proxyExit(proxy: string): Promise<ExitLocation> {
  const normalized = normalizeProxy(proxy).proxy
  if (!normalized) throw new Error('Proxy is required')
  return new Promise((resolve, reject) => {
    const agent = normalized.startsWith('socks5://')
      ? new SocksProxyAgent(normalized.replace(/^socks5:\/\//, 'socks5h://'))
      : new HttpsProxyAgent(normalized)
    const request = https.get('https://ipwho.is/', { agent, timeout: 20_000 }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (body.length > 20_000) request.destroy(new Error('Geolocation response too large'))
      })
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('Geolocation lookup failed')
          const value = JSON.parse(body) as { success?: boolean; ip?: string; country_code?: string }
          if (!value.success || !value.ip || !/^[A-Z]{2}$/.test(value.country_code ?? ''))
            throw new Error('Proxy exit country could not be determined')
          resolve({ ip: value.ip, country: value.country_code!.toLowerCase() })
        } catch (error) { reject(error) }
      })
    })
    request.on('timeout', () => request.destroy(new Error('Geolocation lookup timed out')))
    request.on('error', reject)
  })
}

export async function savedProxyExit(proxy: string): Promise<ExitLocation> {
  const cached = countryCache.get(proxy)
  if (cached && cached.expires > Date.now()) return cached.location
  const location = await proxyExit(proxy)
  countryCache.set(proxy, { location, expires: Date.now() + 6 * 60 * 60_000 })
  return location
}

export type LoginProxy = { _id: string; name: string; proxy: string; proxyType: string;
  country?: string; loginCooldownUntil?: number }

/** Login proxies are saved manually and never assigned as permanent profile proxies. */
export function listLoginProxies(): Promise<LoginProxy[]> {
  return igAccountRequest<LoginProxy[]>('loginProxies')
}
