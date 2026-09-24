import { createHmac } from 'node:crypto';

export type ChatCredentials = { username: string; password: string; authenticatorKey: string };

/** One pasted line: username:password:base32 authenticator key. */
export function parseChatCredentials(line: unknown): ChatCredentials | null {
  if (typeof line !== 'string' || line.length > 1200) return null;
  const first = line.indexOf(':');
  const last = line.lastIndexOf(':');
  if (first < 1 || last <= first) return null;
  const username = line.slice(0, first).trim();
  const password = line.slice(first + 1, last);
  const authenticatorKey = line.slice(last + 1).replace(/[\s-]/g, '').toUpperCase();
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(username) || !password || password.length > 1024 ||
      !/^[A-Z2-7]{16,128}$/.test(authenticatorKey)) return null;
  return { username, password, authenticatorKey };
}

function decodeBase32(value: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const char of value) {
    const digit = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    if (digit < 0) throw new Error('Invalid authenticator key');
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits && buffer) throw new Error('Invalid authenticator key');
  return Buffer.from(bytes);
}

export function authenticatorCode(key: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac('sha1', decodeBase32(key)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

export async function freshAuthenticatorCode(key: string): Promise<string> {
  const remaining = 30_000 - Date.now() % 30_000;
  if (remaining < 8_000) await new Promise(resolve => setTimeout(resolve, remaining + 100));
  return authenticatorCode(key);
}
