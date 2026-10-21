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
    random: (min: number, max: number) => min === 3 && max === 6 ? batch : max - 1,
    sleep: async (ms: number) => { now += ms; }, log: () => {},
  };
  const session = (minutes: number, remainingMinutes: number): Parameters<typeof scheduleRoutine>[0] => ({
    deadline: now + minutes * 60_000, remainingMinutes,
    browse: async (minutes: number) => { now += minutes * 60_000; events.push('browse'); return 'finished' as const; },
  });
  return { controls, session, events, sendTimes, sent: () => sent };
}

for (const batch of [3, 5]) test(`short sessions preserve batch gaps within a 30-minute budget (batch=${batch})`, async () => {
  const s = setup(30, batch);
  for (let remaining = 30; remaining > 0; remaining -= 5) {
    const session = s.session(5, remaining);
    await scheduleRoutine(session, s.controls);
    assert.ok(s.controls.now() <= session.deadline);
  }
  assert.equal(s.sent(), batch * 6);
  assert.equal(s.controls.now(), 30 * 60_000);
  assert.ok(s.events.includes('browse'));
  for (let i = 1; i < s.sendTimes.length; i++) assert.ok(s.sendTimes[i] - s.sendTimes[i - 1] >= 20_000);
});

for (const pause of [10, 30]) for (const browsingMs of [180_000, 300_000])
  test(`outreach pauses ${pause}s inside a batch and browses ${browsingMs / 60_000} minutes between batches`, async () => {
    const s = setup(6, 3), session = s.session(20, 20), durations: number[] = [];
    const browse = session.browse;
    session.browse = async minutes => { durations.push(minutes * 60_000); return browse(minutes); };
    await scheduleRoutine(session, { ...s.controls, random: (min, max) => {
      if (min === 10 && max === 31) return pause;
      if (min === 180_000 && max === 300_000) return browsingMs;
      return s.controls.random(min, max);
    } });
    assert.equal(s.sent(), 6);
    for (const i of [1, 2, 4, 5]) assert.equal(s.sendTimes[i] - s.sendTimes[i - 1] - 10_000, pause * 1000);
    assert.equal(durations[1], browsingMs);
    assert.equal(s.sendTimes[3] - s.sendTimes[2] - 10_000, browsingMs + 19_999,
      'the transition pause still follows browsing');
  });

test('a batch gap uses the remaining session time instead of starting another batch early', async () => {
  const s = setup(6, 3), session = s.session(4, 4), durations: number[] = [];
  const browse = session.browse;
  session.browse = async minutes => { durations.push(minutes * 60_000); return browse(minutes); };
  await scheduleRoutine(session, s.controls);
  assert.equal(s.sent(), 3);
  assert.ok(durations[1] > 0 && durations[1] < 180_000);
  assert.equal(s.controls.now(), session.deadline);
});

test('a session alternates browsing with multiple DM batches', async () => {
  const s = setup(6, 3);
  await scheduleRoutine(s.session(15, 15), s.controls);
  assert.equal(s.sent(), 6);
  assert.deepEqual(s.events.slice(0, 8), ['browse', 'send', 'send', 'send', 'browse', 'send', 'send', 'send']);
});

for (const batch of [3, 4, 5]) test(`successful follows continue within a batch of ${batch} before browsing again`, async () => {
  const s = setup(6, batch);
  const send = s.controls.send;
  await scheduleRoutine(s.session(15, 15), { ...s.controls, send: async () => { await send(); return 'followed'; } });
  assert.equal(s.sent(), 6);
  assert.deepEqual(s.events.slice(0, batch + 2), ['browse', ...Array<string>(batch).fill('send'), 'browse']);
});

for (const batch of [3, 4, 5]) test(`session allocation allows a full ${batch}-account follow batch instead of reducing it to one`, async () => {
  const s = setup(5, batch), send = s.controls.send;
  await scheduleRoutine(s.session(5, 60), { ...s.controls, send: async () => { await send(); return 'followed'; } });
  assert.equal(s.sent(), batch);
});

test('a batch stays below the remaining daily quota even when fewer than three accounts remain', async () => {
  const s = setup(2, 5), send = s.controls.send;
  await scheduleRoutine(s.session(5, 60), { ...s.controls, send: async () => { await send(); return 'followed'; } });
  assert.equal(s.sent(), 2);
});

for (const delay of [10_000, 20_000]) test(`outreach waits ${delay / 1000} seconds after browsing before opening a profile`, async () => {
  const s = setup(3, 3), session = s.session(10, 10);
  let browseEnded = 0;
  const browse = session.browse;
  session.browse = async minutes => { const result = await browse(minutes); browseEnded = s.controls.now(); return result; };
  const send = s.controls.send;
  let checked = false;
  await scheduleRoutine(session, { ...s.controls,
    random: (min, max) => min === 10_000 && max === 20_000 ? delay : s.controls.random(min, max),
    send: async () => {
      if (!checked) { assert.equal(s.controls.now() - browseEnded, delay); checked = true; }
      return send();
    },
  });
  assert.ok(checked);
});

test('a stop during the transition pause prevents opening a recipient', async () => {
  const s = setup(3), session = s.session(10, 10);
  let stopped = false;
  await scheduleRoutine(session, { ...s.controls, stopped: () => stopped,
    sleep: async ms => { await s.controls.sleep(ms); stopped = true; },
  });
  assert.equal(s.sent(), 0);
});

for (const [roll, selection, expected] of [
  [0.199, 0.49, 'profile'], [0.199, 0.5, 'dms'], [0.2, 0, undefined], [0.99, 0, undefined],
] as const) test(`a 20% pause visit chooses one sidebar page per batch (${roll}, ${selection})`, async () => {
  const s = setup(6, 3), session = s.session(20, 20), starts: number[] = [];
  let rolls = 0;
  session.visitDuringPause = async (destination, until) => {
    assert.equal(destination, expected);
    assert.ok(until > s.controls.now() && until <= session.deadline);
    assert.equal(until - s.controls.now(), 19_999);
    starts.push(s.controls.now()); s.events.push('visit-' + destination);
    await s.controls.sleep(2000);
  };
  await scheduleRoutine(session, { ...s.controls, random: (min, max) => {
    if (min === 0 && max === 1) return expected && rolls++ % 2 ? selection : roll;
    return s.controls.random(min, max);
  } });
  assert.equal(s.sent(), 6);
  assert.equal(starts.length, expected ? 2 : 0, 'no extra visits between accounts inside a batch');
  if (expected) {
    assert.equal(s.sendTimes[0] - starts[0], 19_999, 'the visit uses the existing pause');
    assert.equal(s.sendTimes[3] - starts[1], 19_999);
  }
});

test('a stop during a sidebar visit prevents the follow batch', async () => {
  const s = setup(3), session = s.session(10, 10);
  let stopped = false;
  session.visitDuringPause = async () => { stopped = true; };
  await scheduleRoutine(session, { ...s.controls, stopped: () => stopped,
    random: (min, max) => min === 0 && max === 1 ? 0 : s.controls.random(min, max),
  });
  assert.equal(s.sent(), 0);
});

test('the outreach pause delegates to content-aware waiting before opening a recipient', async () => {
  const s = setup(1), session = s.session(5, 5)
  let waits = 0
  session.waitForOutreach = async until => {
    waits++; s.events.push('wait-on-related-content')
    assert.ok(until <= session.deadline)
    await s.controls.sleep(until - s.controls.now())
    return true
  }
  await scheduleRoutine(session, s.controls)
  assert.equal(waits, 1)
  assert.deepEqual(s.events.slice(0, 3), ['browse', 'wait-on-related-content', 'send'])
})

test('an unskippable ad ends the pause early instead of idling before outreach', async () => {
  const s = setup(1), session = s.session(5, 5)
  let readyAt = 0
  session.waitForOutreach = async () => { readyAt = s.controls.now(); return false }
  await scheduleRoutine(session, s.controls)
  assert.equal(s.sendTimes[0], readyAt)
  assert.equal(s.sent(), 1)
})

test('the transition pause cannot overrun the session deadline', async () => {
  const s = setup(3), session = s.session(1, 1);
  session.browse = async () => { await s.controls.sleep(55_000); return 'finished'; };
  await scheduleRoutine(session, s.controls);
  assert.equal(s.sent(), 0);
  assert.equal(s.controls.now(), session.deadline);
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

for (const target of [0, 4]) test(`three consecutive stalls end the session early without outreach (target=${target})`, async () => {
  const s = setup(target);
  let attempts = 0;
  const session = { ...s.session(10, 10), browse: async () => { attempts++; return 'stalled' as const; } };
  assert.equal(await scheduleRoutine(session, s.controls), 'stalled');
  assert.equal(attempts, 3);
  assert.equal(s.sent(), 0);
  assert.ok(s.controls.now() < session.deadline);
});

test('a stall at the deadline is not reported as finished', async () => {
  const s = setup(0), session = s.session(1, 1);
  session.browse = async minutes => { await s.controls.sleep(minutes * 60_000); return 'stalled'; };
  assert.equal(await scheduleRoutine(session, s.controls), 'stalled');
  assert.equal(s.controls.now(), session.deadline);
});

test('a retry pause expiring the deadline preserves the stall while a real stop stays stopped', async () => {
  const s = setup(0), session = s.session(1, 1);
  session.browse = async () => { await s.controls.sleep(59_900); return 'stalled'; };
  assert.equal(await scheduleRoutine(session, s.controls), 'stalled');
  let stopped = false;
  const next = { ...s.session(1, 1), browse: async () => 'stalled' as const };
  assert.equal(await scheduleRoutine(next, { ...s.controls, stopped: () => stopped,
    sleep: async ms => { await s.controls.sleep(ms); stopped = true; },
  }), 'stopped');
});

for (const target of [0, 4]) for (const reason of ['stalled', 'finished'] as const)
  test(`a stop during a deadline-ending pause does not change retry eligibility (${target}, ${reason})`, async () => {
    const s = setup(target), session = s.session(1, 1);
    let stopped = false, attempts = 0;
    session.browse = async () => {
      attempts++;
      await s.controls.sleep(59_900);
      return reason;
    };
    const result = await scheduleRoutine(session, { ...s.controls, stopped: () => stopped,
      sleep: async ms => { await s.controls.sleep(ms); stopped = true; },
    });
    assert.equal(result, reason === 'stalled' ? 'stalled' : 'stopped');
    assert.equal(attempts, 1);
    assert.equal(s.sent(), 0);
    assert.equal(s.controls.now(), session.deadline);
  });

test('successful browsing resets the consecutive stall limit', async () => {
  const s = setup(0), session = s.session(1, 1);
  const browse = session.browse;
  let attempts = 0;
  session.browse = async minutes => {
    attempts++;
    if ([1, 2, 4, 5].includes(attempts)) return 'stalled';
    return browse(attempts === 3 ? 0.1 : minutes);
  };
  assert.equal(await scheduleRoutine(session, s.controls), 'finished');
  assert.equal(attempts, 6);
});

test('switching to browsing-only mode preserves the consecutive stalls from outreach', async () => {
  const s = setup(4), session = s.session(1, 1);
  let attempts = 0;
  session.browse = async minutes => {
    attempts++;
    if (attempts <= 2) await s.controls.sleep(minutes * 60_000);
    else assert.ok(session.deadline - s.controls.now() < 20_000, 'the next attempt uses browsing-only mode');
    return 'stalled';
  };
  assert.equal(await scheduleRoutine(session, s.controls), 'stalled');
  assert.equal(attempts, 3, 'changing modes must not grant more stall attempts');
  assert.equal(s.sent(), 0);
  assert.ok(s.controls.now() < session.deadline);
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

test('blocked recipients are replaced within the same batch without increasing the delivered count', async () => {
  const s = setup(3, 3);
  const send = s.controls.send;
  let blocked = true;
  await scheduleRoutine(s.session(10, 10), { ...s.controls, send: async () => {
    if (blocked) { blocked = false; return 'blocked'; }
    return send();
  } });
  assert.equal(s.sent(), 3);
  assert.deepEqual(s.events.slice(0, 4), ['browse', 'send', 'send', 'send']);
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
