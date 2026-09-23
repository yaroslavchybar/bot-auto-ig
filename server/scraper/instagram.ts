import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { parse as parseLossless } from 'lossless-json';
import { normalizeProxy } from '../shared/proxy.js';
import type { ProfileRecord } from '../shared/contracts.js';

type Json = Record<string, any>;
export type InstagramPost = { id: string; code: string };
export type InstagramLiker = { igId: string; username: string; fullName?: string; profilePicUrl?: string };

export class InstagramRateLimitedError extends Error {
  constructor(stage: string, readonly retryAfterMs?: number) {
    super(`Instagram ${stage} HTTP 429; account or proxy rate limited. Retry later.`);
  }
}

function retryAfterMs(value: string | string[] | undefined): number | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

const asObject = (value: unknown): Json => value && typeof value === 'object' ? value as Json : {};
const asString = (value: unknown): string => value == null ? '' : String(value);

export class InstagramHttp {
  private readonly agent: https.Agent | undefined;
  private readonly headers: Record<string, string>;

  constructor(profile: ProfileRecord) {
    if (!profile.sessionId) throw new Error(`Profile ${profile.name} has no Instagram sessionid. Open it and log in first.`);
    const { proxy } = normalizeProxy(profile.proxy, profile.proxyType);
    this.agent = proxy ? (proxy.startsWith('socks5:') ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy)) : undefined;
    const cookies = new Map<string, string>([['sessionid', profile.sessionId]]);
    try {
      const jar = JSON.parse(profile.cookiesJson ?? '[]');
      if (Array.isArray(jar)) for (const item of jar) {
        if (['csrftoken', 'ds_user_id'].includes(item?.name) && typeof item.value === 'string')
          cookies.set(item.name, item.value);
      }
    } catch { /* sessionid is enough */ }
    const safe = (value: string) => value.replace(/[\r\n;]/g, '');
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9',
      'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://www.instagram.com/',
      Cookie: [...cookies].map(([name, value]) => `${name}=${safe(value)}`).join('; ') + ';',
      ...(cookies.has('csrftoken') ? { 'X-CSRFToken': safe(cookies.get('csrftoken')!) } : {}),
    };
  }

  private async get(path: string, referer: string, stage: string): Promise<Json> {
    const url = new URL(path, 'https://www.instagram.com');
    if (url.hostname !== 'www.instagram.com') throw new Error('Unexpected Instagram URL');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await new Promise<string>((resolve, reject) => {
          const request = https.request(url, {
            method: 'GET', agent: this.agent,
            headers: { ...this.headers, Referer: referer },
            timeout: 15_000,
          }, response => {
            const status = response.statusCode ?? 0;
            if (status === 302 || status === 401 || status === 403) {
              response.resume(); reject(new Error(`Instagram session rejected (HTTP ${status})`)); return;
            }
            if (status < 200 || status >= 300) {
              response.resume();
              reject(status === 429
                ? new InstagramRateLimitedError(stage, retryAfterMs(response.headers['retry-after']))
                : new Error(`Instagram ${stage} HTTP ${status}`));
              return;
            }
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
              body += chunk;
              if (body.length > 10_000_000) request.destroy(new Error('Instagram response too large'));
            });
            response.on('end', () => resolve(body));
            response.on('error', reject);
          });
          request.on('timeout', () => request.destroy(new Error('Instagram request timed out')));
          request.on('error', reject);
          request.end();
        });
        const data = asObject(parseLossless(raw));
        if (data.status && data.status !== 'ok') throw new Error(`Instagram API status ${asString(data.status)}`);
        return data;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === 2 || /session rejected|HTTP 4\d\d/.test(message)) throw error;
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1500));
      }
    }
    throw new Error('Instagram request failed');
  }

  /** One request returns up to 100 likers for a post. */
  async likers(post: InstagramPost): Promise<InstagramLiker[]> {
    const params = new URLSearchParams({ count: '100' });
    const data = await this.get(`/api/v1/media/${post.id}/likers/?${params}`,
      `https://www.instagram.com/p/${post.code}/`, 'post likers');
    if (!Array.isArray(data.users)) throw new Error('Instagram returned an incomplete likers response');
    return data.users.slice(0, 100).flatMap((raw: unknown) => {
      const user = asObject(raw);
      if (user.is_private !== false) return [];
      const liker = { igId: asString(user.pk ?? user.id), username: asString(user.username),
        fullName: asString(user.full_name), profilePicUrl: asString(user.profile_pic_url) };
      return /^\d+$/.test(liker.igId) && liker.username ? [liker] : [];
    });
  }
}
