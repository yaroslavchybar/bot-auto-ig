import { EventEmitter } from 'node:events';
import type { ClientRequest } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { normalizeProxy } from '../shared/proxy.js';
import type { ProfileRecord } from '../shared/contracts.js';

export function chatProxy(profile: ProfileRecord): string | undefined {
  return normalizeProxy(profile.proxy, profile.proxyType).proxy || undefined;
}

/** Establishes a TLS tunnel with HTTP/2 through the profile's HTTP(S) or SOCKS proxy. */
export async function proxyConnection(host: string, proxy: string): Promise<TLSSocket> {
  const request = Object.assign(new EventEmitter(), { destroy() {} }) as unknown as ClientRequest;
  const connectAbort = new AbortController();
  const agent = proxy.startsWith('socks5://')
    ? new SocksProxyAgent(proxy.replace(/^socks5:\/\//, 'socks5h://'), { timeout: 20_000 })
    : new HttpsProxyAgent(proxy, { signal: connectAbort.signal });
  let tunnel: TLSSocket | undefined;
  try {
    const connectTimer = setTimeout(() => connectAbort.abort(), 20_000);
    let socket;
    try {
      socket = await agent.connect(request, {
        host, port: 443, secureEndpoint: true, servername: host, ALPNProtocols: ['h2'],
      });
    } finally { clearTimeout(connectTimer); }
    if (!('encrypted' in socket) || !socket.encrypted) {
      socket.destroy();
      throw new Error('Proxy did not establish a TLS tunnel');
    }
    const tlsSocket = socket as TLSSocket;
    tunnel = tlsSocket;
    request.emit('socket', tlsSocket);
    tlsSocket.setTimeout(20_000, () => tlsSocket.destroy(new Error('Proxy connection timed out')));
    if (tlsSocket.alpnProtocol == null) {
      await new Promise<void>((resolve, reject) => {
        const secure = () => { tlsSocket.off('error', failed); resolve(); };
        const failed = (error: Error) => { tlsSocket.off('secureConnect', secure); reject(error); };
        tlsSocket.once('secureConnect', secure);
        tlsSocket.once('error', failed);
      });
    }
    if (tlsSocket.alpnProtocol !== 'h2') throw new Error('Proxy tunnel does not support HTTP/2');
    return tlsSocket;
  } catch {
    tunnel?.destroy();
    throw new Error('Instagram Chat could not connect through the profile proxy');
  }
}
