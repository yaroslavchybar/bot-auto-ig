import { expect, test } from 'bun:test';
import { authenticatorCode } from './totp.js';

test('generates the RFC 6238 SHA1 authenticator code', () => {
  expect(authenticatorCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
});
