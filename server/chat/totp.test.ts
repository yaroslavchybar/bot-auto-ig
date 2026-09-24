import { expect, test } from 'bun:test';
import { authenticatorCode, parseChatCredentials } from './totp.js';

test('generates the RFC 6238 SHA1 authenticator code', () => {
  expect(authenticatorCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
});

test('parses one line even when the password contains a colon', () => {
  expect(parseChatCredentials('example:pass:word:GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'))
    .toEqual({ username: 'example', password: 'pass:word',
      authenticatorKey: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' });
  expect(parseChatCredentials('example:pass:123456')).toBeNull();
});
