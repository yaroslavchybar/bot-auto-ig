import { EventEmitter } from 'node:events';
import type { ClientRequest } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { IgNetworkError, type IgApiClient } from 'instagram-private-api';
import { normalizeProxy } from '../shared/proxy.js';
import type { ProfileRecord } from '../shared/contracts.js';

export function chatProxy(profile: ProfileRecord): string | undefined {
  return normalizeProxy(profile.proxy, profile.proxyType).proxy || undefined;
}

/** Only fixed messages leave the transport; dependency errors can contain credentials. */
export function mobileProxyError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : '';
  const reason = /authentication|auth failed|407/i.test(detail) ? 'proxy authentication failed' :
    /timed? ?out|timeout|aborted/i.test(detail) ? 'connection timed out' :
    /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detail) ? 'proxy hostname could not be resolved' :
    /ECONNREFUSED/i.test(detail) ? 'proxy refused the connection' :
    /certificate|cert_|TLS|SSL/i.test(detail) ? 'TLS connection failed' :
    /HTTP\/2/i.test(detail) ? 'HTTP/2 negotiation failed' : 'proxy connection failed';
  return new Error(`Instagram Chat could not connect through the profile proxy: ${reason}`);
}

/** The SDK's built-in proxy option only speaks HTTP. Supply our agent for every SDK request. */
export function configureMobileProxyTransport(ig: IgApiClient): void {
  const send = ig.request.send.bind(ig.request);
  ig.request.send = async (options, onlyCheckHttpStatus) => {
    const proxy = ig.state.proxyUrl;
    const agent = proxy ? proxy.startsWith('socks5://')
      ? new SocksProxyAgent(proxy.replace(/^socks5:\/\//, 'socks5h://'), { timeout: 20_000 })
      : new HttpsProxyAgent(proxy) : undefined;
    try {
      return await send({ ...options, proxy: null, agent, timeout: 120_000 }, onlyCheckHttpStatus);
    } catch (error) {
      if (proxy && error instanceof IgNetworkError) throw mobileProxyError(error);
      throw error;
    } finally { agent?.destroy(); }
  };
}

/** Establishes a TLS tunnel with HTTP/2 through the profile's HTTP(S) or SOCKS proxy. */
export async function proxyConnection(host: string, proxy: string): Promise<TLSSocket> {
  const request = Object.assign(new EventEmitter(), { destroy() {} }) as unknown as ClientRequest;
  const connectAbort = new AbortController();
  const agent = proxy.startsWith('socks5://')
    ? new SocksProxyAgent(proxy.replace(/^socks5:\/\//, 'socks5h://'), { timeout: 20_000 })
    : new HttpsProxyAgent(proxy, { signal: connectAbort.signal });
  let proxyStatus = 0;
  request.on('proxyConnect', (response: { statusCode: number }) => { proxyStatus = response.statusCode; });
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
      throw new Error(proxyStatus === 407 ? 'Proxy authentication failed' : 'Proxy did not establish a TLS tunnel');
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
  } catch (error) {
    tunnel?.destroy();
    throw mobileProxyError(error);
  }
}
