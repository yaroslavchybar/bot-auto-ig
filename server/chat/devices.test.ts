import { describe, expect, test } from 'bun:test';
import { IgApiClient } from 'instagram-private-api';
import { useCurrentAppProfile } from './caa.js';
import { CHAT_DEVICE_STRINGS, chatDeviceForProfile } from './devices.js';

describe('Chat devices', () => {
  test('offers 13 distinct models from several Android makers', () => {
    expect(CHAT_DEVICE_STRINGS).toHaveLength(13);
    expect(new Set(CHAT_DEVICE_STRINGS).size).toBe(13);
    expect(CHAT_DEVICE_STRINGS.some(device => device.includes('Google/google'))).toBe(true);
    expect(CHAT_DEVICE_STRINGS.some(device => device.includes('samsung/samsung'))).toBe(true);
    expect(CHAT_DEVICE_STRINGS.some(device => device.includes('Xiaomi/xiaomi'))).toBe(true);
  });

  test('keeps a profile fingerprint stable through session serialization', async () => {
    const profileId = 'profile-123';
    const ig = new IgApiClient();
    ig.state.generateDevice(`example:${profileId}`);
    useCurrentAppProfile(ig, chatDeviceForProfile(profileId));
    const restored = new IgApiClient();
    await restored.state.deserialize(JSON.stringify(await ig.state.serialize()));

    expect(chatDeviceForProfile(profileId)).toBe(ig.state.deviceString);
    expect(restored.state.deviceString).toBe(ig.state.deviceString);
    expect(restored.state.deviceId).toBe(ig.state.deviceId);
    expect(restored.state.uuid).toBe(ig.state.uuid);
    expect(new Set(Array.from({ length: 100 }, (_, index) =>
      chatDeviceForProfile(`profile-${index}`))).size).toBeGreaterThan(1);
  });
});
