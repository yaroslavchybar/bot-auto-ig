import { randomBytes, randomInt } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { gunzipSync, inflateSync } from 'node:zlib';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { IgApiClient } from 'instagram-private-api';
import { parse as parseLossless } from 'lossless-json';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ValidationError } from '../shared/errors.js';
import { createReadStream } from 'node:fs'
import type { StagedAttachment } from './uploads.js'

export type AttachmentKind = 'photo' | 'video' | 'voice';
export type VideoMetadata = { width: number; height: number; duration: number };
export type UploadedAttachment = { mediaId: string; uploadId?: string; video?: VideoMetadata };

const host = 'rupload.facebook.com';
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
type MediaRequest = typeof messengerRequest;
export type AttachmentBody = StagedAttachment
const byteLength = (body: AttachmentBody) => body.size
const sliceBody = (body: AttachmentBody, offset: number): AttachmentBody => ({ ...body, offset })

async function prefix(body: AttachmentBody): Promise<Buffer> {
  const file = await fs.open(body.path, 'r')
  try { const bytes = Buffer.alloc(12); const { bytesRead } = await file.read(bytes, 0, 12, 0); return bytes.subarray(0, bytesRead) }
  finally { await file.close() }
}

function uploadHeaders(ig: IgApiClient, extra: Record<string, string>): Record<string, string> {
  const userId = ig.state.extractUserId();
  const authorization = ig.state.authorization;
  if (!authorization || !userId) throw new Error('Instagram Chat session has no upload authorization');
  return {
    authorization,
    'ig-intended-user-id': userId,
    'ig-u-ds-user-id': userId,
    'accept-encoding': 'gzip',
    'accept-language': 'en-US',
    'user-agent': ig.request.getDefaultHeaders()['User-Agent'],
    'x-fb-client-ip': 'True',
    'x-fb-friendly-name': 'undefined:media-upload',
    'x-fb-http-engine': 'Tigon/MNS/TCP',
    'x-fb-request-analytics-tags': '{"network_tags":{"product":"567067343352427","surface":"undefined","request_category":"media_upload","purpose":"none","retry_attempt":"0"}}',
    'x-fb-rmd': 'state=URL_ELIGIBLE',
    'x-fb-server-cluster': 'True',
    'x-tigon-is-retry': 'False',
    'x-ig-salt-ids': '51052545',
    ...extra,
  };
}

async function messengerRequest(ig: IgApiClient, method: 'GET' | 'POST', endpoint: string,
  headers: Record<string, string>, body?: AttachmentBody): Promise<Record<string, unknown>> {
  const proxy = ig.state.proxyUrl;
  const agent = proxy ? proxy.startsWith('socks5://')
    ? new SocksProxyAgent(proxy.replace(/^socks5:\/\//, 'socks5h://'))
    : new HttpsProxyAgent(proxy) : undefined;
  const timeout = !body ? 30_000 : endpoint.startsWith('/messenger_video/') ? 300_000 : 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await new Promise((resolve, reject) => {
      const request = httpsRequest(`https://${host}${endpoint}`, { method, headers, agent,
        signal: controller.signal }, response => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', chunk => {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > 1_000_000) {
            response.destroy(new Error('Instagram media upload response is too large'));
          } else chunks.push(bytes);
        });
        response.on('end', () => {
          try {
            if (response.statusCode !== 200) {
              throw new Error(`Instagram media upload HTTP ${response.statusCode ?? 0}`);
            }
            const raw = Buffer.concat(chunks);
            const encoding = response.headers['content-encoding'];
            const decoded = encoding === 'gzip' ? gunzipSync(raw) :
              encoding === 'deflate' ? inflateSync(raw) : raw;
            resolve(object(parseLossless(decoded.toString('utf8'))));
          } catch (error) { reject(error); }
        });
        response.on('error', reject);
      });
      request.on('error', error => reject(controller.signal.aborted
        ? new Error('Instagram media upload timed out') : error));
      if (!body) request.end();
      else {
        const remaining = body.size - (body.offset ?? 0)
        request.setHeader('Content-Length', remaining)
        if (!remaining) request.end()
        else {
          const stream = createReadStream(body.path, { start: body.offset ?? 0, highWaterMark: 64 * 1024 })
          stream.on('error', error => request.destroy(error))
          request.once('close', () => stream.destroy())
          stream.pipe(request)
        }
      }
    });
  } finally { clearTimeout(timer); }
}

function mediaId(data: Record<string, unknown>): string {
  const value = String(data.media_id ?? '');
  if (!/^\d+$/.test(value)) throw new Error('Instagram media upload returned no media ID');
  return value;
}

async function resumableUpload(ig: IgApiClient, endpoint: string, bytes: AttachmentBody,
  headers: Record<string, string>, entity: string, contentType: string,
  request: MediaRequest): Promise<string> {
  const initial = await request(ig, 'GET', endpoint, headers);
  const offset = Number(initial.offset ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > byteLength(bytes)) {
    throw new Error('Instagram media upload returned an invalid offset');
  }
  return mediaId(await request(ig, 'POST', endpoint, {
    ...headers, 'content-type': 'application/octet-stream', offset: String(offset),
    'x-entity-length': String(byteLength(bytes)), 'x-entity-name': entity, 'x-entity-type': contentType,
  }, sliceBody(bytes, offset)));
}

/** Uploads attachment bytes through the selected Instagram profile's proxy. */
export async function uploadChatAttachment(ig: IgApiClient, kind: AttachmentKind,
  bytes: AttachmentBody, video?: VideoMetadata, request: MediaRequest = messengerRequest): Promise<UploadedAttachment> {
  const size = byteLength(bytes)
  const header = await prefix(bytes)
  if (kind === 'photo') {
    if (size > 10_000_000 || header[0] !== 0xff || header[1] !== 0xd8) {
      throw new ValidationError('Choose a JPEG photo under 10 MB');
    }
    const entity = `fb_uploader_${Date.now()}`;
    const headers = uploadHeaders(ig, { image_type: 'FILE_ATTACHMENT',
      'content-type': 'application/octet-stream', offset: '0',
      'x-entity-length': String(size), 'x-entity-name': entity, 'x-entity-type': 'image/jpeg' });
    return { mediaId: mediaId(await request(ig, 'POST', `/messenger_image/${entity}`, headers, bytes)) };
  }
  if (kind === 'voice') {
    if (size > 10_000_000) throw new ValidationError('Voice message is too large');
    const audio = bytes
    if (!audio.voiceConverted) throw new ValidationError('Voice message was not converted')
    const uploadId = String(Date.now());
    const entity = `${uploadId}_0_${randomInt(-2147483648, 2147483648)}`;
    const headers = uploadHeaders(ig, { audio_type: 'FILE_ATTACHMENT' });
    return { mediaId: await resumableUpload(ig, `/messenger_audio/${entity}`, audio,
      headers, entity, 'audio/mp4', request), uploadId };
  }
  if (!video || size > 25_000_000 || header.toString('ascii', 4, 8) !== 'ftyp') {
    throw new ValidationError('Choose an H.264 MP4 video under 25 MB');
  }
  const hex = randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const entity = `${hex}-0-${size}-${timestamp}-${timestamp}`;
  const uploadId = String(randomInt(10 ** 11, 10 ** 12));
  const waterfallId = `${uploadId}_${hex.slice(0, 12).toUpperCase()}_Mixed_0`;
  const headers = uploadHeaders(ig, { video_type: 'FILE_ATTACHMENT',
    'segment-start-offset': '0', 'segment-type': '3', 'ephemeral_media_view_mode': '2',
    ig_raven_metadata: '{}', x_fb_video_waterfall_id: waterfallId });
  return { mediaId: await resumableUpload(ig, `/messenger_video/${entity}`, bytes,
    headers, entity, 'video/mp4', request), uploadId, video };
}
