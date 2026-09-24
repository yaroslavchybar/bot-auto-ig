import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleRoutine } from './routine-schedule.js';

function setup(target = 30, batch = 5) {
  let now = 0, sent = 0;
  const events: string[] = [];
  const sendTimes: number[] = [];
  const controls = {
    target: async () => ({ target, remaining: target - sent, sent }),
    send: async () => { sendTimes.push(now); now += 10_000; sent++; events.push('send'); return 'sent' as const; },
    now: () => now, stopped: () => false,
    random: (min: number, max: number) => min === 1 ? batch : max - 1,
    sleep: async (ms: number) => { now += ms; }, log: () => {},
  };
  const session = (minutes: number, remainingMinutes: number) => ({
    deadline: now + minutes * 60_000, remainingMinutes,
    browse: async (minutes: number) => { now += minutes * 60_000; events.push('browse'); return 'finished' as const; },
  });
  return { controls, session, events, sendTimes, sent: () => sent };
}

for (const batch of [1, 5]) test(`completes 30 DMs in a 30-minute budget with batches of ${batch}`, async () => {
  const s = setup(30, batch);
  for (let remaining = 30; remaining > 0; remaining -= 5) {
    const session = s.session(5, remaining);
    await scheduleRoutine(session, s.controls);
    assert.ok(s.controls.now() <= session.deadline);
  }
  assert.equal(s.sent(), 30);
  assert.equal(s.controls.now(), 30 * 60_000);
  assert.ok(s.events.includes('browse'));
  for (let i = 1; i < s.sendTimes.length; i++) assert.ok(s.sendTimes[i] - s.sendTimes[i - 1] >= 30_000);
});

test('a session alternates browsing with multiple DM batches', async () => {
  const s = setup(6, 2);
  await scheduleRoutine(s.session(15, 15), s.controls);
  assert.equal(s.sent(), 6);
  assert.deepEqual(s.events.slice(0, 9), ['browse', 'send', 'send', 'browse', 'send', 'send', 'browse', 'send', 'send']);
});

test('blocked recipients are replaced without increasing the delivered count', async () => {
  const s = setup(2, 2);
  const send = s.controls.send;
  let blocked = true;
  await scheduleRoutine(s.session(10, 10), { ...s.controls, send: async () => {
    if (blocked) { blocked = false; return 'blocked'; }
    return send();
  } });
  assert.equal(s.sent(), 2);
});

test('missing leads stop outreach without consuming extra active time', async () => {
  const s = setup();
  let claims = 0;
  await scheduleRoutine(s.session(5, 5), { ...s.controls, send: async () => { claims++; return 'unavailable'; } });
  assert.equal(claims, 1);
  assert.equal(s.sent(), 0);
  assert.equal(s.controls.now(), 5 * 60_000);
});

test('an impossible target never extends the session deadline', async () => {
  const s = setup(35);
  await scheduleRoutine(s.session(1, 1), s.controls);
  assert.ok(s.sent() < 35);
  assert.equal(s.controls.now(), 60_000);
});
