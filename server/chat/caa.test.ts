import { describe, expect, test } from 'bun:test';
import { IgApiClient } from 'instagram-private-api';
import { applyCaaLoginResponse, extractCaaAac, extractTwoStepContext } from './caa.js';

describe('CAA login response', () => {
  test('uses the populated account access context', () => {
    const data = [
      { data: { key: 'CAA_ACCOUNT_ACCESS_CONTEXT:aac', initial_lispy: '(fhy "")' } },
      { data: { key: 'CAA_ACCOUNT_ACCESS_CONTEXT:aac', initial_lispy: '(fhy "server-aac")' } },
    ];
    expect(extractCaaAac({ layout: { bloks_payload: { data } } })).toBe('server-aac');
  });

  test('loads embedded authorization and session cookies', () => {
    const ig = new IgApiClient();
    ig.state.generateDevice('example');
    const embedded = {
      login_response: JSON.stringify({ logged_in_user: { pk: 123, username: 'example' } }),
      headers: JSON.stringify({ 'IG-Set-Authorization': 'Bearer IGT:2:encoded' }),
      cookies: 'Set-Cookie: csrftoken=token-1; Domain=.instagram.com; Path=/; Secure\r\n' +
        'Set-Cookie: ds_user_id=123; Domain=.instagram.com; Path=/; Secure\r\n' +
        'Set-Cookie: sessionid=123%3Aabc; Domain=.instagram.com; Path=/; Secure',
    };
    const result = { layout: { bloks_payload: {
      action: `BK.action(${JSON.stringify('ignored')}, ${JSON.stringify(JSON.stringify(embedded))})`,
    } } };

    expect(applyCaaLoginResponse(ig, result)).toBe(true);
    expect(ig.state.authorization).toBe('Bearer IGT:2:encoded');
    expect(ig.state.extractCookieValue('sessionid')).toBe('123%3Aabc');
    expect(ig.state.extractCookieValue('ds_user_id')).toBe('123');
  });

  test('reads legacy two-factor context from the Bloks action', () => {
    const result = { layout: { bloks_payload: { action:
      '"com.bloks.www.two_step_verification.entrypoint" ' +
      '(dkc "server_params") (dkc (f4i (dkc "two_step_verification_context" "flow_source") ' +
      '(dkc "context-1" "two_factor_login")))',
    } } };
    expect(extractTwoStepContext(result)).toBe('context-1');
  });

  test('matches a later context key past numeric and nested values', () => {
    const result = { layout: { bloks_payload: { action:
      '"com.bloks.www.two_step_verification.entrypoint" ' +
      '(dkc "server_params") (dkc (f4i ' +
      '(dkc "attempt_count" "flow_source" "two_step_verification_context") ' +
      '(dkc 1 (f4i "login" "manual") "context-2")))',
    } } };
    expect(extractTwoStepContext(result)).toBe('context-2');
  });

  test('does not use another field when the context value is not a string', () => {
    const result = { layout: { bloks_payload: { action:
      '"com.bloks.www.two_step_verification.entrypoint" ' +
      '(dkc "server_params") (dkc (f4i ' +
      '(dkc "two_step_verification_context" "flow_source") ' +
      '(dkc 42 "manual")))',
    } } };
    expect(extractTwoStepContext(result)).toBe('');
  });
});
