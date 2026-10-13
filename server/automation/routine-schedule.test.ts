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
  const session = (minutes: number, remainingMinutes: number): Parameters<typeof scheduleRoutine>[0] => ({
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

test('every successful follow ends its batch and requires browsing before another action', async () => {
  const s = setup(4, 5);
  const send = s.controls.send;
  await scheduleRoutine(s.session(15, 15), { ...s.controls, send: async () => { await send(); return 'followed'; } });
  assert.equal(s.sent(), 4);
  for (let i = 0; i < s.events.length - 1; i++)
    if (s.events[i] === 'send') assert.equal(s.events[i + 1], 'browse');
});

test('disabled or exhausted browsing does not permit an outreach batch', async () => {
  const s = setup(4, 5);
  const session = { ...s.session(15, 15), browse: async () => 'skipped' as const };
  assert.equal(await scheduleRoutine(session, s.controls), 'skipped');
  assert.equal(s.sent(), 0);
});

test('an incomplete browsing chunk retries with more time before outreach', async () => {
  const s = setup(4, 5);
  const session = s.session(5, 5);
  const durations: number[] = [];
  const browse = session.browse;
  session.browse = async minutes => {
    durations.push(minutes * 60_000);
    const result = await browse(minutes);
    return durations.length === 1 ? 'stalled' : result;
  };
  assert.equal(await scheduleRoutine(session, s.controls), 'finished');
  assert.equal(durations[0], 10_000);
  assert.ok(durations[1]! >= 60_000, 'retry must allow navigation and a complete reel view');
  assert.deepEqual(s.events.slice(0, 3), ['browse', 'browse', 'send']);
  assert.ok(s.sent() > 0);
  assert.equal(s.controls.now(), session.deadline);
});

test('repeated immediate stalls use a bounded pause and never permit outreach', async () => {
  const s = setup(4);
  const session = { ...s.session(1, 1), browse: async () => 'stalled' as const };
  assert.equal(await scheduleRoutine(session, s.controls), 'finished');
  assert.equal(s.sent(), 0);
  assert.equal(s.controls.now(), session.deadline);
});

test('browsing-only sessions retry stalls but respect a real stop', async () => {
  const s = setup(0);
  const session = s.session(5, 5);
  const browse = session.browse;
  let tries = 0;
  session.browse = async minutes => ++tries === 1 ? 'stalled' : browse(minutes);
  assert.equal(await scheduleRoutine(session, s.controls), 'finished');
  assert.equal(tries, 2);
  assert.equal(s.controls.now(), session.deadline);
  assert.equal(s.sent(), 0);
  const stopped = { ...s.session(5, 5), browse: async () => 'stopped' as const };
  const before = s.controls.now();
  assert.equal(await scheduleRoutine(stopped, s.controls), 'stopped');
  assert.equal(s.controls.now(), before);
});

test('a browser-only warmup spends its session browsing when outreach is unavailable', async () => {
  const s = setup(0);
  const session = s.session(10, 10);
  await scheduleRoutine(session, s.controls);
  assert.deepEqual(s.events, ['browse']);
  assert.equal(s.controls.now(), session.deadline);
});

test('browsing-only sessions continue after a short successful Explore phase', async () => {
  const s = setup(0);
  const session = s.session(5, 5);
  const browse = session.browse;
  let tries = 0;
  session.browse = async minutes => browse(++tries === 1 ? 0.5 : minutes);
  assert.equal(await scheduleRoutine(session, s.controls), 'finished');
  assert.equal(tries, 2);
  assert.equal(s.controls.now(), session.deadline);
  assert.equal(s.sent(), 0);
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
