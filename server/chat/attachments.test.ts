import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IgApiClient } from 'instagram-private-api';
import { uploadChatAttachment } from './attachments.js';

const ig = { state: { extractUserId: () => 'viewer', authorization: 'Bearer test', proxyUrl: '' },
  request: { getDefaultHeaders: () => ({ 'User-Agent': 'Instagram test' }) } } as unknown as IgApiClient;

test('Photo upload sends JPEG bytes as a messenger image', async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const calls: { method: string; endpoint: string; headers: Record<string, string>; body?: Buffer }[] = [];
  const result = await uploadChatAttachment(ig, 'photo', bytes, undefined,
    async (_ig, method, endpoint, headers, body) => {
      calls.push({ method, endpoint, headers, body });
      return { media_id: '12345' };
    });
  expect(result).toEqual({ mediaId: '12345' });
  expect(calls).toHaveLength(1);
  expect(calls[0].endpoint.startsWith('/messenger_image/fb_uploader_')).toBe(true);
  expect(calls[0].headers['x-entity-type']).toBe('image/jpeg');
  expect(calls[0].headers.authorization).toBe('Bearer test');
  expect(calls[0].body).toEqual(bytes);
});

test('Video upload resumes from Instagram offset and uses the returned media ID', async () => {
  const bytes = Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 1, 2, 3, 4]);
  const calls: { method: string; endpoint: string; headers: Record<string, string>; body?: Buffer }[] = [];
  const video = { width: 720, height: 1280, duration: 4 };
  const result = await uploadChatAttachment(ig, 'video', bytes, video,
    async (_ig, method, endpoint, headers, body) => {
      calls.push({ method, endpoint, headers, body });
      return method === 'GET' ? { offset: 2 } : { media_id: 67890 };
    });
  expect(result).toMatchObject({ mediaId: '67890', video });
  expect(calls.map(call => call.method)).toEqual(['GET', 'POST']);
  expect(calls[0].endpoint.startsWith('/messenger_video/')).toBe(true);
  expect(calls[1].endpoint).toBe(calls[0].endpoint);
  expect(calls[1].headers.offset).toBe('2');
  expect(calls[1].headers['x-entity-type']).toBe('video/mp4');
  expect(calls[1].body).toEqual(bytes.subarray(2));
});

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) {
  test('Voice upload converts an attached MP3 to M4A before sending', async () => {
    const mp3 = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'anullsrc=channel_layout=mono:sample_rate=44100', '-t', '0.1', '-f', 'mp3', 'pipe:1']);
    expect(mp3.status).toBe(0);
    const calls: { method: string; endpoint: string; headers: Record<string, string>; body?: Buffer }[] = [];
    const result = await uploadChatAttachment(ig, 'voice', mp3.stdout, undefined,
      async (_ig, method, endpoint, headers, body) => {
        calls.push({ method, endpoint, headers, body });
        return method === 'GET' ? { offset: 0 } : { media_id: '999' };
      });
    expect(result).toMatchObject({ mediaId: '999' });
    expect(calls.map(call => call.method)).toEqual(['GET', 'POST']);
    expect(calls[0].endpoint.startsWith('/messenger_audio/')).toBe(true);
    expect(calls[1].headers['x-entity-type']).toBe('audio/mp4');
    expect(calls[1].body?.toString('ascii', 4, 8)).toBe('ftyp');
  });

  test('Voice upload converts M4A with its moov atom after the audio data', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'ig-chat-voice-test-'));
    const input = path.join(directory, 'recording.m4a');
    try {
      const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', input]);
      expect(generated.status).toBe(0);
      const bytes = await fs.readFile(input);
      expect(bytes.indexOf('moov')).toBeGreaterThan(bytes.indexOf('mdat'));
      const calls: { method: string; body?: Buffer }[] = [];
      const result = await uploadChatAttachment(ig, 'voice', bytes, undefined,
        async (_ig, method, _endpoint, _headers, body) => {
          calls.push({ method, body });
          return method === 'GET' ? { offset: 0 } : { media_id: '123' };
        });
      expect(result.mediaId).toBe('123');
      expect(calls.map(call => call.method)).toEqual(['GET', 'POST']);
      expect(calls[1].body?.toString('ascii', 4, 8)).toBe('ftyp');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
}
