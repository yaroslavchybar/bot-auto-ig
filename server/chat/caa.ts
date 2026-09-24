import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { connect, type IncomingHttpHeaders } from 'node:http2';
import { gunzipSync, inflateSync } from 'node:zlib';
import type { IgApiClient } from 'instagram-private-api';
import { freshAuthenticatorCode } from './totp.js';
import { proxyConnection } from './proxy.js';

type Json = Record<string, unknown>;
type ChatState = IgApiClient['state'] & { chatUsdid?: { id: string; privateKey: string } };
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const version = '448.0.0.0.20';
const versionCode = '1065560286';
const bloksVersion = '0bc46a03e177bfc9bc8d611918815acf248fa9c77754d807d6a5951dc9ce9432';
const appId = '567067343352427';
const registrationDocId = '124930351917786857261002920888';
const offlineGroup = 'caa_iteration_v3_perf_ig_4';
const profileEntry = 'com.bloks.www.ap.two_step_verification.entrypoint_async';

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function encodeForm(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function loginPayload(value: unknown): Json | null {
  if (typeof value === 'string') {
    try { return loginPayload(JSON.parse(value)); } catch { /* scan Bloks expression below */ }
    for (let index = 0; index < value.length; index++) {
      if (value[index] !== '"') continue;
      let end = index + 1;
      let escaped = false;
      for (; end < value.length; end++) {
        if (escaped) { escaped = false; continue; }
        if (value[end] === '\\') { escaped = true; continue; }
        if (value[end] === '"') break;
      }
      if (end === value.length) break;
      try {
        const decoded = JSON.parse(value.slice(index, end + 1));
        if (typeof decoded === 'string' && decoded.includes('login_response')) {
          const nested = loginPayload(decoded);
          if (nested) return nested;
        }
      } catch { /* other Bloks tokens */ }
      index = end;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) { const found = loginPayload(entry); if (found) return found; }
    return null;
  }
  const data = object(value);
  if ('login_response' in data) return data;
  for (const entry of Object.values(data)) { const found = loginPayload(entry); if (found) return found; }
  return null;
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) for (const entry of value) collectStrings(entry, output);
  else if (value && typeof value === 'object') for (const entry of Object.values(value)) collectStrings(entry, output);
}

function expressionAt(value: string, start: number): string {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    const char = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return value.slice(start, index + 1);
  }
  return '';
}

function bloksListElements(expression: string): string[] {
  if (!expression.startsWith('(dkc') || !expression.endsWith(')')) return [];
  const elements: string[] = [];
  const end = expression.length - 1;
  let index = 4;
  while (index < end) {
    while (index < end && /\s/.test(expression[index])) index++;
    if (index === end) break;
    const start = index;
    if (expression[index] === '(') {
      const nested = expressionAt(expression, index);
      if (!nested || index + nested.length > end) return [];
      index += nested.length;
    } else if (expression[index] === '"') {
      let escaped = false;
      index++;
      for (; index < end; index++) {
        if (escaped) escaped = false;
        else if (expression[index] === '\\') escaped = true;
        else if (expression[index] === '"') break;
      }
      if (index === end) return [];
      index++;
    } else {
      while (index < end && !/[\s)]/.test(expression[index])) index++;
      if (index === start) return [];
    }
    elements.push(expression.slice(start, index));
  }
  return elements;
}

function bloksString(element: string): string {
  try {
    const value: unknown = JSON.parse(element);
    return typeof value === 'string' ? value : '';
  } catch { return ''; }
}

export function extractTwoStepContext(result: Json): string {
  const direct = (value: unknown): string => {
    const data = object(value);
    if (string(data.two_step_verification_context)) return string(data.two_step_verification_context);
    for (const child of Object.values(data)) {
      if (typeof child === 'object') { const found = direct(child); if (found) return found; }
      if (typeof child === 'string' && child.startsWith('{')) {
        try { const found = direct(JSON.parse(child)); if (found) return found; } catch { /* Bloks text */ }
      }
    }
    return '';
  };
  const value = direct(result);
  if (value) return value;
  const action = string(object(object(result.layout).bloks_payload).action);
  const marker = '"two_step_verification_context"';
  const position = action.indexOf(marker);
  if (position < 0 || !action.includes('two_step_verification.entrypoint')) return '';
  const keysStart = action.lastIndexOf('(dkc', position);
  if (keysStart < 0) return '';
  const keys = expressionAt(action, keysStart);
  const keyIndex = bloksListElements(keys).findIndex(element => bloksString(element) === 'two_step_verification_context');
  if (keyIndex < 0) return '';
  const keysEnd = keysStart + keys.length;
  const valuesStart = action.indexOf('(dkc', keysEnd);
  if (valuesStart < 0) return '';
  return bloksString(bloksListElements(expressionAt(action, valuesStart))[keyIndex] || '');
}

function parseJson(body: Buffer): Json {
  const decoded = body.toString('utf8').replace(/^for \(;;\);/, '');
  try { return object(JSON.parse(decoded)); }
  catch { throw new Error('Instagram returned an invalid CAA response'); }
}

class MobileTransport {
  private usdidHeader = '';

  constructor(private readonly ig: IgApiClient) {
    const identity = (ig.state as ChatState).chatUsdid;
    if (identity) {
      const expiration = Math.floor(Date.now() / 1000) + 3600;
      const signed = `${identity.id}.${expiration}`;
      this.usdidHeader = `${signed}.${base64url(createSign('SHA256').update(signed).sign(identity.privateKey))}`;
    }
  }

  setUsdidHeader(header: string): void { this.usdidHeader = header; }

  async request(host: 'i.instagram.com' | 'b.i.instagram.com', method: 'GET' | 'POST',
    path: string, fields?: Record<string, string>, extraHeaders: Record<string, string> = {}): Promise<Json> {
    const url = `https://${host}${path}`;
    const body = fields ? encodeForm(fields) : '';
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.ig.request.getDefaultHeaders())) {
      if (typeof value === 'string' && !['host', 'connection', 'authorization'].includes(key.toLowerCase())) {
        headers[key.toLowerCase()] = value;
      }
    }
    headers['x-bloks-version-id'] = bloksVersion;
    headers['x-ig-family-device-id'] = this.ig.state.phoneId;
    headers['x-ig-app-id'] = appId;
    headers['x-fb-http-engine'] = 'Tigon/MNS/TCP';
    headers['x-tigon-is-retry'] = 'False';
    headers['x-zero-balance'] = 'INIT';
    headers['x-zero-state'] = 'unknown';
    headers['cookie'] = this.ig.state.cookieJar.getCookieString(url);
    if (this.ig.state.authorization) headers['authorization'] = this.ig.state.authorization;
    if (this.usdidHeader) headers['x-meta-usdid'] = this.usdidHeader;
    if (fields) {
      headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers['content-length'] = String(Buffer.byteLength(body));
    }
    for (const [key, value] of Object.entries(extraHeaders)) headers[key.toLowerCase()] = value;
    for (const [key, value] of Object.entries(headers)) if (!value) delete headers[key];

    const proxy = this.ig.state.proxyUrl;
    const tunnel = proxy ? await proxyConnection(host, proxy) : undefined;
    const client = connect(`https://${host}`, tunnel ? { createConnection: () => tunnel } : undefined);
    try {
      const response = await new Promise<{ headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let responseHeaders: IncomingHttpHeaders = {};
        const stream = client.request({ ':method': method, ':scheme': 'https', ':authority': host, ':path': path, ...headers });
        stream.setTimeout(20_000, () => {
          stream.close();
          reject(new Error('Instagram mobile request timed out'));
        });
        stream.on('response', headers => { responseHeaders = headers; });
        stream.on('data', chunk => {
          const part = Buffer.from(chunk);
          chunks.push(part);
          size += part.length;
          if (size > 3_000_000) {
            stream.close();
            reject(new Error('Instagram mobile response exceeded size limit'));
          }
        });
        stream.on('end', () => resolve({ headers: responseHeaders, body: Buffer.concat(chunks) }));
        stream.on('error', reject);
        client.on('error', reject);
        stream.end(body);
      });
      const cookies = response.headers['set-cookie'];
      for (const cookie of typeof cookies === 'string' ? [cookies] : cookies || []) {
        this.ig.state.cookieJar.setCookie(cookie, url);
      }
      const authorization = response.headers['ig-set-authorization'];
      if (typeof authorization === 'string') this.ig.state.authorization = authorization;
      const keyId = response.headers['ig-set-password-encryption-key-id'];
      const publicKey = response.headers['ig-set-password-encryption-pub-key'];
      if (typeof keyId === 'string') this.ig.state.passwordEncryptionKeyId = keyId;
      if (typeof publicKey === 'string') this.ig.state.passwordEncryptionPubKey = publicKey;
      // Instagram returns the encryption key in headers even when this GET is 405.
      if (path === '/api/v1/qe/sync/' && typeof publicKey === 'string' && typeof keyId === 'string') return {};
      const encoding = response.headers['content-encoding'];
      const bytes = encoding === 'gzip' ? gunzipSync(response.body) :
        encoding === 'deflate' ? inflateSync(response.body) : response.body;
      const data = parseJson(bytes);
      const status = Number(response.headers[':status'] || 0);
      if (status < 200 || status >= 300 || data.status === 'fail' || data.errors) {
        const rawKind = string(data.error_type);
        const kind = /^[a-z_]{1,40}$/i.test(rawKind) ? rawKind : 'rejected';
        throw new Error(`Instagram mobile ${path.split('/').filter(Boolean).pop()} HTTP ${status}: ${kind}`);
      }
      return data;
    } finally { client.close(); }
  }
}

export async function mobileRequest(ig: IgApiClient, method: 'GET' | 'POST', path: string,
  fields?: Record<string, string>, query?: Record<string, string>): Promise<Json> {
  const suffix = query ? `?${new URLSearchParams(query)}` : '';
  return new MobileTransport(ig).request('i.instagram.com', method, `/api/v1/${path}${suffix}`, fields);
}

function networkInfo(): Json {
  return {
    active_subscriptions_info: null,
    default_subscription_info: {
      network_type: null, is_data_roaming: 1, is_esim: null, is_gsm_roaming: 0,
      is_sim_sms_capable: null, is_mobile_data_enabled: 1, sim_carrier_id: 1,
      sim_carrier_id_name: null, sim_state: 5, sim_operator: '310260',
      sim_operator_name: 'T-Mobile', signal_strength: null,
      group_id_level_1: null, network_operator: '310260',
    },
    is_airplane_mode: 0, is_active_network_cellular: 0, is_device_sms_capable: 1,
    sim_count: 1, is_wifi: 1,
  };
}

export function extractCaaAac(result: Json): string {
  const layout = object(result.layout);
  const payload = object(layout.bloks_payload);
  for (const node of Array.isArray(payload.data) ? payload.data : []) {
    const data = object(object(node).data);
    if (data.key !== 'CAA_ACCOUNT_ACCESS_CONTEXT:aac') continue;
    if (string(data.initial)) return string(data.initial);
    const lispy = string(data.initial_lispy);
    const start = lispy.indexOf('"');
    if (start >= 0) {
      let end = start + 1;
      let escaped = false;
      for (; end < lispy.length; end++) {
        if (escaped) { escaped = false; continue; }
        if (lispy[end] === '\\') { escaped = true; continue; }
        if (lispy[end] === '"') break;
      }
      try {
        const value = JSON.parse(lispy.slice(start, end + 1));
        if (typeof value === 'string' && value) return value;
      }
      catch { /* no valid AAC string */ }
    }
  }
  return '';
}

async function bloks(transport: MobileTransport, ig: IgApiClient, action: string,
  params: Json, headers: Record<string, string> = {}): Promise<Json> {
  return transport.request('b.i.instagram.com', 'POST', `/api/v1/bloks/async_action/${action}/`, {
    params: JSON.stringify(params), _uuid: ig.state.uuid,
    bk_client_context: JSON.stringify({ bloks_version: bloksVersion, styles_id: 'instagram' }),
    bloks_versioning_id: bloksVersion,
  }, { 'x-fb-friendly-name': `IgApi: bloks/async_action/${action}/`, ...headers });
}

async function bloksApp(transport: MobileTransport, ig: IgApiClient, app: string, params: Json): Promise<Json> {
  return transport.request('b.i.instagram.com', 'POST', `/api/v1/bloks/apps/${app}/`, {
    params: JSON.stringify(params), _uuid: ig.state.uuid,
    bk_client_context: JSON.stringify({ bloks_version: bloksVersion, styles_id: 'instagram' }),
    bloks_versioning_id: bloksVersion,
  }, { 'x-fb-friendly-name': `IgApi: bloks/apps/${app}/` });
}

async function finishBloksChallenge(transport: MobileTransport, ig: IgApiClient,
  context: string, authenticatorKey: string): Promise<Json> {
  const common = { device_id: ig.state.deviceId, two_step_verification_context: context,
    flow_source: 'two_factor_login' };
  await bloksApp(transport, ig, 'com.bloks.www.two_step_verification.entrypoint', {
    client_input_params: { device_id: ig.state.deviceId, is_whatsapp_installed: 0,
      machine_id: ig.state.extractCookie('mid')?.value || '' },
    server_params: { ...common, should_fallback_to_sms: 0, family_device_id: ig.state.phoneId },
  });
  await bloksApp(transport, ig, 'com.bloks.www.two_step_verification.method_picker', {
    client_input_params: { is_whatsapp_installed: 0 },
    server_params: { ...common, should_fallback_to_sms: 0 },
  });
  await bloks(transport, ig, 'com.bloks.www.two_step_verification.method_picker.navigation.async', {
    client_input_params: { selected_method: 'totp', cloud_trust_token: null, network_bssid: null },
    server_params: { ...common, should_fallback_to_sms: 0, spectra_reg_login_data: null },
  });
  const code = await freshAuthenticatorCode(authenticatorKey);
  return bloks(transport, ig, 'com.bloks.www.two_step_verification.verify_code.async', {
    client_input_params: {
      auth_secure_device_id: '', block_store_machine_id: '', code,
      should_trust_device: 1, family_device_id: ig.state.phoneId,
      device_id: ig.state.deviceId, cloud_trust_token: null, network_bssid: null,
      machine_id: ig.state.extractCookie('mid')?.value || '',
    },
    server_params: { ...common, should_fallback_to_sms: 0,
      spectra_reg_login_data: null, challenge: 'totp' },
  });
}

export async function completeCaaTwoFactor(ig: IgApiClient, context: string, authenticatorKey: string): Promise<void> {
  const transport = new MobileTransport(ig);
  const result = await finishBloksChallenge(transport, ig, context, authenticatorKey);
  if (!applyCaaLoginResponse(ig, result)) throw new Error('Instagram CAA rejected the verification code');
}

async function registerUsdid(transport: MobileTransport, ig: IgApiClient): Promise<void> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const usdid = randomUUID();
  const kid = base64url(randomBytes(32));
  const sign = (value: string): string => base64url(createSign('SHA256').update(value).sign(privateKey));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    sub: usdid, iat: now, aud: appId, exp: now + 3600,
    pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), alg: 'ES256',
  }));
  const protectedHeader = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256', kid, aid: appId, ver: '1' }));
  const token = base64url(JSON.stringify({ payload, signatures: [{ protected: protectedHeader, signature: sign(`${protectedHeader}.${payload}`) }] }));
  const variables = { input: {
    usdid_token: { sensitive_string_value: token },
    fdid: { sensitive_string_value: ig.state.phoneId },
  } };
  const result = await transport.request('b.i.instagram.com', 'POST', '/graphql_www', {
    method: 'post', pretty: 'false', format: 'json', server_timestamps: 'true', locale: 'user',
    fb_api_req_friendly_name: 'IGUSDIDRegistrationMutation', enable_canonical_naming: 'true',
    enable_canonical_variable_overrides: 'true', enable_canonical_naming_ambiguous_type_prefixing: 'true',
    variables: JSON.stringify(variables), purpose: 'fetch', client_doc_id: registrationDocId,
  }, {
    'x-fb-friendly-name': 'IGUSDIDRegistrationMutation', 'x-client-doc-id': registrationDocId,
    'x-root-field-name': 'usdid_registration', 'x-graphql-client-library': 'pando',
  });
  const registered = Object.entries(object(result.data)).some(([key, value]) =>
    key.includes('usdid_registration') && Boolean(object(value).success));
  if (!registered) throw new Error('Instagram rejected CAA device registration');
  (ig.state as ChatState).chatUsdid = {
    id: usdid, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
  transport.setUsdidHeader(`${usdid}.${now + 3600}.${sign(`${usdid}.${now + 3600}`)}`);
}

export function applyCaaLoginResponse(ig: IgApiClient, result: Json): boolean {
  const embedded = loginPayload(result);
  if (!embedded) return false;
  let login: Json;
  let headers: Json;
  try {
    login = object(JSON.parse(string(embedded.login_response)));
    headers = object(JSON.parse(string(embedded.headers) || '{}'));
  } catch { return false; }
  const auth = string(headers['IG-Set-Authorization'] || headers['ig-set-authorization']);
  if (auth) ig.state.authorization = auth;
  const rawCookies = string(embedded.cookies);
  for (const part of rawCookies.split(/\r?\n|, (?=[^=;, ]+=)/)) {
    if (part.trim()) {
      try { ig.state.cookieJar.setCookie(part.replace(/^Set-Cookie:\s*/i, ''), 'https://i.instagram.com/'); }
      catch { /* another cookie may still provide the session */ }
    }
  }
  const rawUserId = object(login.logged_in_user).pk_id || object(login.logged_in_user).pk;
  const userId = rawUserId == null ? '' : String(rawUserId);
  if (userId) ig.state.cookieJar.setCookie(`ds_user_id=${userId}; Domain=.instagram.com; Path=/`, 'https://i.instagram.com/');
  return Boolean(auth || ig.state.extractCookie('sessionid'));
}

/** Minimal current CAA login for the experimental Chat API. */
export async function loginWithCaa(ig: IgApiClient, username: string, password: string): Promise<string | null> {
  const transport = new MobileTransport(ig);
  await transport.request('i.instagram.com', 'GET', '/api/v1/qe/sync/');
  if (!ig.state.passwordEncryptionPubKey) throw new Error('Instagram did not provide a password encryption key');
  await registerUsdid(transport, ig);
  const waterfallId = randomUUID();
  const homepage = await bloks(transport, ig,
    'com.bloks.www.bloks.caa.login.process_client_data_and_redirect', {
      is_from_logged_out: false, logged_out_user: '', qpl_join_id: null,
      family_device_id: ig.state.phoneId, device_id: ig.state.deviceId,
      offline_experiment_group: offlineGroup, waterfall_id: waterfallId,
      logout_source: '', show_internal_settings: false, last_auto_login_time: 0,
      disable_auto_login: false, qe_device_id: ig.state.uuid,
      use_auto_login_interstitial: true, disable_recursive_auto_login_interstitial: true,
      auto_login_interstitial_experiment_group_name: '', is_from_logged_in_switcher: false,
      switcher_logged_in_uid: '', account_list: [], blocked_uid: [],
      INTERNAL_INFRA_THEME: 'THREE_NEUTRAL_GRAY',
      layered_homepage_experiment_group: 'Deploy: Not in Experiment',
      launched_url: '', sim_phone_numbers: [], is_from_registration_reminder: false,
    });
  const aac = extractCaaAac(homepage);
  if (!aac) throw new Error('Instagram CAA did not issue account access context');
  const attestation = await transport.request('b.i.instagram.com', 'POST',
    '/api/v1/attestation/create_android_keystore/',
    { app_scoped_device_id: ig.state.uuid, key_hash: '' },
    { 'x-fb-friendly-name': 'IgApi: attestation/create_android_keystore/' });
  const nonce = string(attestation.challenge_nonce);
  if (!nonce) throw new Error('Instagram CAA did not issue attestation nonce');
  const latency = Date.now();
  await bloks(transport, ig, 'com.bloks.www.caa.login.oauth.token.fetch.async', {
    client_input_params: {
      username_input: username, si_device_param_network_info: networkInfo(), aac,
      lois_settings: { lois_token: '' }, cloud_trust_token: null,
      zero_balance_state: '', network_bssid: null,
    },
    server_params: {
      is_from_logged_out: 0, layered_homepage_experiment_group: 'Deploy: Not in Experiment',
      device_id: ig.state.deviceId, login_surface: 'login_home', waterfall_id: waterfallId,
      INTERNAL__latency_qpl_instance_id: latency, is_platform_login: 0,
      login_entry_point: 'logged_out', INTERNAL__latency_qpl_marker_id: 36707139,
      family_device_id: ig.state.phoneId, offline_experiment_group: offlineGroup,
      access_flow_version: 'pre_mt_behavior', is_from_logged_in_switcher: 0,
      qe_device_id: ig.state.uuid,
    },
  });
  const encrypted = ig.account.encryptPassword(password);
  const textInputId = `${randomUUID().replaceAll('-', '').slice(0, 4)}ig`;
  const params = {
    client_input_params: {
      blocked_uids: [], aac, sim_phones: [], aymh_accounts: [], network_bssid: null,
      secure_family_device_id: '', has_granted_read_contacts_permissions: 0,
      auth_secure_device_id: '', has_whatsapp_installed: 0,
      si_device_param_network_info: networkInfo(),
      password: `#PWD_INSTAGRAM:4:${encrypted.time}:${encrypted.encrypted}`,
      sso_token_map_json_string: '', block_store_machine_id: '', ig_vetted_device_nonces: null,
      cloud_trust_token: null, event_flow: 'login_manual',
      password_contains_non_ascii: String(!/^[\x00-\x7f]*$/.test(password)).toLowerCase(),
      client_known_key_hash: '', sso_accounts_auth_data: [], encrypted_msisdn: '',
      has_granted_read_phone_permissions: 0, app_manager_id: '',
      should_show_nested_nta_from_aymh: 0, device_id: ig.state.deviceId,
      zero_balance_state: '', login_attempt_count: 1,
      machine_id: ig.state.extractCookie('mid')?.value || '',
      flash_call_permission_status: {
        READ_PHONE_STATE: 'DENIED', READ_CALL_LOG: 'DENIED', ANSWER_PHONE_CALLS: 'DENIED',
      },
      accounts_list: [], gms_incoming_call_retriever_eligibility: 'eligible',
      family_device_id: ig.state.phoneId, fb_ig_device_id: [], device_emails: [], try_num: 1,
      lois_settings: { lois_token: '' }, event_step: 'home_page', headers_infra_flow_id: '',
      openid_tokens: {}, contact_point: username,
    },
    server_params: {
      should_trigger_override_login_2fa_action: 0, is_from_logged_out: 0,
      should_trigger_override_login_success_action: 0, login_credential_type: 'none',
      server_login_source: 'login', waterfall_id: waterfallId,
      two_step_login_type: 'one_step_login', login_source: 'Login', is_platform_login: 0,
      login_entry_point: 'logged_out', INTERNAL__latency_qpl_marker_id: 36707139,
      is_from_aymh: 0, offline_experiment_group: offlineGroup, is_from_landing_page: 0,
      left_nav_button_action: 'NONE', password_text_input_id: `${textInputId}:82`,
      is_from_empty_password: 0, is_from_msplit_fallback: 0, ar_event_source: 'login_home_page',
      qe_device_id: ig.state.uuid, username_text_input_id: `${textInputId}:81`,
      layered_homepage_experiment_group: 'Deploy: Not in Experiment', device_id: ig.state.deviceId,
      login_surface: 'login_home', INTERNAL__latency_qpl_instance_id: Date.now(),
      reg_flow_source: 'login_home_native_integration_point', is_caa_perf_enabled: 1,
      credential_type: 'password', is_from_password_entry_page: 0, caller: 'gslr',
      family_device_id: ig.state.phoneId, is_from_assistive_id: 0,
      access_flow_version: 'pre_mt_behavior', is_from_logged_in_switcher: 0,
    },
  };
  const result = await bloks(transport, ig,
    'com.bloks.www.bloks.caa.login.async.send_login_request', params,
    { 'x-ig-attest-params': JSON.stringify({ attestation: [{
      version: 2, type: 'keystore', errors: [-1013], challenge_nonce: nonce,
      signed_nonce: '', key_hash: '',
    }] }) });
  if (applyCaaLoginResponse(ig, result)) return null;
  const strings: string[] = [];
  collectStrings(result, strings);
  if (strings.some(value => value.includes(profileEntry))) {
    throw new Error('Instagram requested email verification; this test supports authenticator codes only');
  }
  const context = extractTwoStepContext(result);
  if (context) return context;
  throw new Error('Instagram CAA login did not return a session or supported two-factor context');
}

export function useCurrentAppVersion(ig: IgApiClient): void {
  ig.state.constants = { ...ig.state.constants,
    APP_VERSION: version, APP_VERSION_CODE: versionCode, BLOKS_VERSION_ID: bloksVersion,
  } as unknown as typeof ig.state.constants;
}

export function useCurrentAppProfile(ig: IgApiClient, deviceString: string): void {
  useCurrentAppVersion(ig);
  ig.state.deviceString = deviceString;
}
