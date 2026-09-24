import { createHash } from 'node:crypto';

// Android model, OS, and screen tuples used only when creating a new Chat session.
export const CHAT_DEVICE_STRINGS = [
  '33/13; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther',
  '34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba',
  '35/15; 420dpi; 1080x2424; Google/google; Pixel 9; tokay; tokay',
  '36/16; 420dpi; 1080x2424; Google/google; Pixel 10; frankel; frankel',
  '37/17; 420dpi; 1080x2424; Google/google; Pixel 11; cubs; cubs',
  '33/13; 420dpi; 1080x2340; samsung/samsung; SM-S911B; dm1q; dm1q',
  '34/14; 420dpi; 1080x2340; samsung/samsung; SM-S921B; e1s; e1s',
  '35/15; 420dpi; 1080x2340; samsung/samsung; SM-S931B; pa1q; pa1q',
  '36/16; 420dpi; 1080x2340; samsung/samsung; SM-S942B; m1q; m1q',
  '33/13; 440dpi; 1080x2400; Xiaomi/xiaomi; Xiaomi 13; fuxi; fuxi',
  '34/14; 440dpi; 1200x2670; Xiaomi/xiaomi; Xiaomi 14; shennong; shennong',
  '35/15; 440dpi; 1200x2670; Xiaomi/xiaomi; Xiaomi 15; dada; dada',
  '36/16; 440dpi; 1220x2656; Xiaomi/xiaomi; Xiaomi 17; popsicle; popsicle',
] as const;

export function chatDeviceForProfile(profileId: string): string {
  const hash = createHash('sha256').update(profileId).digest();
  return CHAT_DEVICE_STRINGS[hash.readUInt32BE(0) % CHAT_DEVICE_STRINGS.length];
}
