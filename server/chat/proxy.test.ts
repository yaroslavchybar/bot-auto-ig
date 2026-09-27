import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { IgApiClient, IgNetworkError } from 'instagram-private-api';
import { configureMobileProxyTransport, mobileProxyError, proxyConnection } from './proxy.js';

type SocksObservations = { destinations: string[]; requests: string[]; credentials: string[][] };

function handleSocksSocket(socket: Socket, rejectAuth: boolean, observed: SocksObservations) {
  let data = Buffer.alloc(0);
  let stage: 'greeting' | 'auth' | 'connect' | 'request' | 'done' = 'greeting';
  socket.on('error', () => {});
  socket.on('data', chunk => {
    data = Buffer.concat([data, chunk]);
    while (stage !== 'done') {
      if (stage === 'greeting') {
        if (data.length < 2 || data.length < 2 + data[1]) return;
        if (data[0] !== 5) { stage = 'done'; socket.destroy(); return; }
        data = data.subarray(2 + data[1]);
        stage = 'auth';
        socket.write(Buffer.from([5, 2]));
      } else if (stage === 'auth') {
        if (data.length < 2) return;
        const userLength = data[1];
        if (data.length < 3 + userLength) return;
        const length = 3 + userLength + data[2 + userLength];
        if (data.length < length) return;
        observed.credentials.push([data.subarray(2, 2 + userLength).toString(), data.subarray(3 + userLength, length).toString()]);
        data = data.subarray(length);
        stage = rejectAuth ? 'done' : 'connect';
        socket.write(Buffer.from([1, rejectAuth ? 1 : 0]));
        if (rejectAuth) { socket.end(); return; }
      } else if (stage === 'connect') {
        if (data.length < 4) return;
        // Domain address type proves DNS is delegated to the SOCKS server.
        if (data[3] !== 3) { stage = 'done'; socket.destroy(); return; }
        if (data.length < 5 || data.length < 7 + data[4]) return;
        observed.destinations.push(data.subarray(5, 5 + data[4]).toString());
        data = data.subarray(7 + data[4]);
        stage = 'request';
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
      } else {
        const end = data.indexOf('\r\n\r\n');
        if (end < 0) return;
        const headers = data.subarray(0, end).toString();
        const length = Number(headers.match(/content-length: (\d+)/i)?.[1] ?? 0);
        if (data.length < end + 4 + length) return;
        observed.requests.push(data.subarray(0, end + 4 + length).toString());
        stage = 'done';
        const body = '{"status":"ok"}';
        socket.end(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
      }
    }
  });
}

async function socksServer(rejectAuth = false) {
  const observed: SocksObservations = { destinations: [], requests: [], credentials: [] };
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    handleSocksSocket(socket, rejectAuth, observed);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test proxy address');
  return {
    url: `socks5://test%40user:test%3Apassword@127.0.0.1:${address.port}`,
    ...observed,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

test('SOCKS fixture accepts fragmented and combined protocol messages without losing trailing bytes', () => {
  const request = 'POST /test HTTP/1.1\r\nContent-Length: 4\r\n\r\nbody';
  const wire = Buffer.concat([
    Buffer.from([5, 2, 0, 2]),
    Buffer.from([1, 4]), Buffer.from('user'), Buffer.from([4]), Buffer.from('pass'),
    Buffer.from([5, 1, 0, 3, 7]), Buffer.from('example'), Buffer.from([0, 80]),
    Buffer.from(request),
  ]);
  // Every possible split covers partial length fields, payloads, and trailing next messages.
  const splits = Array.from({ length: wire.length + 1 }, (_, index) => [wire.subarray(0, index), wire.subarray(index)]);
  splits.push(Array.from(wire, byte => Buffer.from([byte])));
  for (const chunks of splits) {
    const observed: SocksObservations = { destinations: [], requests: [], credentials: [] };
    const replies: Buffer[] = [];
    let ended = 0;
    const socket = Object.assign(new EventEmitter(), {
      write: (bytes: Buffer) => { replies.push(bytes); },
      end: () => { ended++; },
      destroy: () => { throw new Error('Unexpected rejected handshake'); },
    });
    handleSocksSocket(socket as unknown as Socket, false, observed);
    for (const chunk of chunks) socket.emit('data', chunk);
    expect(observed).toEqual({ credentials: [['user', 'pass']], destinations: ['example'], requests: [request] });
    expect(Buffer.concat(replies)).toEqual(Buffer.from([5, 2, 1, 0, 5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
    expect(ended).toBe(1);
  }
});

test('SDK GET, form, and upload requests use authenticated SOCKS with remote DNS and the current proxy', async () => {
  const first = await socksServer();
  const second = await socksServer();
  try {
    const ig = new IgApiClient();
    ig.state.generateDevice('proxy-test');
    configureMobileProxyTransport(ig);
    ig.state.proxyUrl = first.url;
    await ig.request.send({ baseUrl: 'http://mobile.invalid', url: '/read' });
    await ig.request.send({ baseUrl: 'http://mobile.invalid', url: '/edit', method: 'POST', form: { name: 'Test' } });
    ig.state.proxyUrl = second.url;
    await ig.request.send({ baseUrl: 'http://upload.invalid', url: '/photo', method: 'POST', body: Buffer.from('image bytes') });
    expect(first.destinations).toEqual(['mobile.invalid', 'mobile.invalid']);
    expect(second.destinations).toEqual(['upload.invalid']);
    expect(first.credentials).toEqual([['test@user', 'test:password'], ['test@user', 'test:password']]);
    expect(first.requests[1]).toContain('name=Test');
    expect(second.requests[0]).toContain('image bytes');
  } finally { await first.close(); await second.close(); }
});

test('SDK profile requests and mobile login tunnels report SOCKS authentication rejection safely', async () => {
  const proxy = await socksServer(true);
  try {
    const ig = new IgApiClient();
    ig.state.generateDevice('proxy-test');
    configureMobileProxyTransport(ig);
    ig.state.proxyUrl = proxy.url;
    await expect(ig.account.currentUser()).rejects.toThrow('proxy authentication failed');
    await expect(proxyConnection('i.instagram.com', proxy.url)).rejects.toThrow('proxy authentication failed');
    expect(proxy.credentials).toHaveLength(2);
    expect(proxy.destinations).toHaveLength(0);
  } finally { await proxy.close(); }
});

test('proxy diagnostics classify failures without exposing dependency error contents', () => {
  for (const [detail, expected] of [
    ['ETIMEDOUT secret', 'connection timed out'],
    ['getaddrinfo ENOTFOUND secret', 'hostname could not be resolved'],
    ['ECONNREFUSED secret', 'refused the connection'],
    ['certificate expired secret', 'TLS connection failed'],
    ['HTTP/2 secret', 'HTTP/2 negotiation failed'],
    ['unexpected secret', 'proxy connection failed'],
  ]) {
    const message = mobileProxyError(new Error(detail)).message;
    expect(message).toContain(expected);
    expect(message).not.toContain('secret');
  }
});

test('SDK network errors are sanitized only for proxied requests, regardless of error name', async () => {
  for (const proxy of ['', 'http://user:secret@localhost:8080', 'socks5://user:secret@localhost:1080']) {
    const ig = new IgApiClient();
    const failure = new IgNetworkError(Object.assign(new Error(), {
      name: 'IgNetworkError', message: 'ECONNREFUSED socks5://user:secret@localhost:1080',
    }));
    ig.request.send = async () => { throw failure; };
    configureMobileProxyTransport(ig);
    ig.state.proxyUrl = proxy;
    const error = await ig.request.send({ url: '/test' }).catch(error => error);
    if (proxy) {
      expect(error.message).toBe('Instagram Chat could not connect through the profile proxy: proxy refused the connection');
      expect(error).not.toBe(failure);
      expect(error.message).not.toContain('secret');
    } else expect(error).toBe(failure);
  }
});

test('SDK switches from HTTP CONNECT to SOCKS without reusing the old protocol', async () => {
  const connects: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('data', data => {
      connects.push(data.toString());
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.once('data', () => {
        const body = '{"status":"ok"}';
        socket.end(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
      });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test proxy address');
  const socks = await socksServer();
  try {
    const ig = new IgApiClient();
    ig.state.generateDevice('proxy-switch-test');
    configureMobileProxyTransport(ig);
    ig.state.proxyUrl = `http://user:password@127.0.0.1:${address.port}`;
    await ig.request.send({ baseUrl: 'http://mobile.invalid', url: '/read' });
    expect(connects[0]).toContain('CONNECT mobile.invalid:80 HTTP/1.1');
    expect(connects[0]).toContain(`Proxy-Authorization: Basic ${Buffer.from('user:password').toString('base64')}`);
    ig.state.proxyUrl = socks.url;
    await ig.request.send({ baseUrl: 'http://mobile.invalid', url: '/read' });
    expect(connects).toHaveLength(1);
    expect(socks.destinations).toEqual(['mobile.invalid']);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await socks.close();
  }
});
