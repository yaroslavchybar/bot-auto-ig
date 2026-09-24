import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { runRoutineSession } from "./routine.js";

function setup() {
  const calls: string[] = [];
  let now = 0;
  let sent = false,
    deliveryFailed = false;
  const deps: NonNullable<Parameters<typeof runRoutineSession>[5]> = {
    now: () => now,
    target: async () => ({ target: 1, remaining: sent ? 0 : 1, sent: sent ? 1 : 0 }),
    sleep: async ms => { now += ms; },
    random: (min) => min,
    followTasks: async () => [],
    recordFollow: async () => undefined,
    ready: async () => true,
    warmup: async (_p, _a, _c, _page, _log, stopped, _deps, activity) => {
      await activity!({ deadline: now + 600_000, remainingMinutes: 10, browse: async minutes => {
        calls.push('browse'); now += minutes * 60_000; return 'finished';
      } });
      return { minutes: 10, reason: stopped() ? 'stopped' : 'finished' };
    },
    reserve: async () =>
      calls.includes("reserve")
        ? null
        : (calls.push("reserve"),
          { leadId: "lead", date: "2026-09-21", username: "alice", message: "Hello alice" }),
    begin: async () => {
      calls.push("authorize");
      return true;
    },
    finish: async (_, __, ___, value) => {
      calls.push(value ? "sent" : "uncertain");
      sent = value;
      return undefined;
    },
    record: async (_, __, completed, issue) => {
      calls.push(completed ? "record-completed" : "record-incomplete");
      deliveryFailed = !!issue;
      return undefined;
    },
  };
  const locator = {
    count: async () => 1,
    first() {
      return this;
    },
    or() {
      return this;
    },
    getByRole() {
      return this;
    },
    hover: async () => {},
    isVisible: async () => false,
    click: async () => {
      calls.push("message-button");
    },
    fill: async (_value: string, _options?: { timeout?: number }) => {
      calls.push("compose");
    },
    press: async (_key: string, _options?: { timeout?: number }) => {
      calls.push("send");
    },
    last() {
      return this;
    },
    nth() {
      return this;
    },
    waitFor: async (_options?: { state?: string; timeout?: number }) => {
      calls.push("confirm");
    },
  };
  const page = {
    locator: () => ({
      first: () => locator,
      getByRole: () => ({ ...locator, waitFor: async () => {}, isVisible: async () => true }),
    }),
    url: () => "https://www.instagram.com/",
    goto: async () => {},
    waitForURL: async () => {},
    getByRole: () => locator,
    getByText: (text: string | RegExp, options?: { exact?: boolean }) => {
      if (options?.exact && String(text).startsWith("This account can't receive"))
        return { ...locator, waitFor: async () => { throw new Error('missing'); } };
      return locator;
    },
  } as unknown as Page;
  const run = () =>
    runRoutineSession(
      {
        _id: "automation",
        name: "Daily",
        nodes: [],
        edges: [],
        routine: { headless: true, activity: {} },
      },
      "profile",
      page,
      () => {},
      () => false,
      deps,
    );
  return {
    calls,
    deps,
    locator,
    page,
    run,
    result: () => ({ sent, deliveryFailed }),
  };
}

test("a routine browses, reserves and authorizes before sending, then confirms delivery", async () => {
  const s = setup();
  await s.run();
  assert.deepEqual(s.calls, [
    "browse",
    "reserve",
    "message-button",
    "confirm",
    "compose",
    "authorize",
    "send",
    "confirm",
    "sent",
    "browse",
    "record-completed",
  ]);
  assert.deepEqual(s.result(), { sent: true, deliveryFailed: false });
});
test("removed membership prevents browsing and outreach", async () => {
  const s = setup();
  s.deps.ready = async () => false;
  await s.run();
  assert.deepEqual(s.calls, ["record-incomplete"]);
});

test("DM attempts wait a random 30–90 seconds before claiming the next lead", async () => {
  for (const seconds of [30, 90]) {
    const s = setup();
    s.deps.target = async () => ({ target: 2, remaining: 2, sent: 0 });
    s.deps.random = (min) => min === 1 ? 2 : min === 30 ? seconds : min;
    const sleep = s.deps.sleep;
    s.deps.sleep = async ms => { assert.equal(ms, 1000); s.calls.push('wait'); await sleep(ms); };
    let claims = 0;
    s.deps.reserve = async () => {
      s.calls.push('claim');
      return { leadId: `lead-${++claims}`, date: '2026-09-21', username: 'alice', message: 'Hello alice' };
    };
    await s.run();
    assert.equal(s.calls.filter(c => c === 'wait').length, seconds);
    assert.equal(s.calls.filter(c => c === 'send').length, 2);
    const firstSent = s.calls.indexOf('sent');
    assert.deepEqual(s.calls.slice(firstSent + 1, firstSent + 1 + seconds), Array(seconds).fill('wait'));
    assert.equal(s.calls[firstSent + 1 + seconds], 'claim');
  }
});

test("stopping during a DM pause prevents another claim", async () => {
  const s = setup();
  s.deps.target = async () => ({ target: 3, remaining: 3, sent: 0 });
  s.deps.random = min => min === 1 ? 3 : 30;
  let stopped = false;
  let waits = 0;
  let claims = 0;
  s.deps.reserve = async () => {
    claims++;
    s.calls.push('reserve');
    return { leadId: `lead-${claims}`, date: '2026-09-21', username: 'alice', message: 'Hello alice' };
  };
  s.deps.sleep = async () => { waits++; stopped = true; };
  await runRoutineSession(
    { _id: 'automation', name: 'Daily', nodes: [], edges: [], routine: { headless: true, activity: {} } },
    'profile', s.page, () => {}, () => stopped, s.deps,
  );
  assert.equal(waits, 1);
  assert.equal(claims, 1);
  assert.equal(s.calls.filter(c => c === 'send').length, 1);
  assert.equal(s.result().deliveryFailed, false);
});
test("a refused send authorization never presses Send", async () => {
  const s = setup();
  s.deps.begin = async () => false;
  await s.run();
  assert.equal(s.calls.includes("send"), false);
});

test("a failed final target log does not flag a completed session", async () => {
  const s = setup();
  s.deps.target = async () => {
    if (s.calls.includes('sent')) throw new Error('temporary query failure');
    return { target: 1, remaining: 1, sent: 0 };
  };
  await s.run();
  assert.equal(s.result().sent, true);
  assert.equal(s.result().deliveryFailed, false);
  assert.equal(s.calls.at(-1), 'record-completed');
});

test("a deadline reached during navigation skips the send without a review issue", async () => {
  const s = setup();
  s.page.goto = (async (_url, options) => {
    assert.equal(options?.timeout, 30_000);
    await s.deps.sleep(600_000);
    throw new Error('navigation timeout');
  }) as Page['goto'];
  await s.run();
  assert.equal(s.calls.includes('authorize'), false);
  assert.equal(s.calls.includes('send'), false);
  assert.equal(s.calls.includes('uncertain'), false);
  assert.equal(s.result().deliveryFailed, false);
});

test("a deadline reached during follow cleanup ends the session without an issue", async () => {
  const s = setup();
  s.deps.followTasks = async () => [{ leadId: 'lead', username: 'alice' }];
  s.page.goto = (async () => {
    await s.deps.sleep(600_000);
    throw new Error('navigation timeout');
  }) as Page['goto'];
  await s.run();
  assert.equal(s.calls.includes('reserve'), false);
  assert.equal(s.result().deliveryFailed, false);
});

test("a deadline reached after composing skips the send without a review issue", async () => {
  const s = setup();
  s.locator.fill = async () => { s.calls.push('compose'); await s.deps.sleep(600_000); };
  await s.run();
  assert.equal(s.calls.includes('authorize'), false);
  assert.equal(s.calls.includes('send'), false);
  assert.equal(s.calls.includes('uncertain'), false);
  assert.equal(s.result().deliveryFailed, false);
});

test("a deadline reached during authorization never presses Send or flags delivery", async () => {
  const s = setup();
  s.deps.begin = async () => {
    s.calls.push('authorize');
    await s.deps.sleep(600_000);
    return true;
  };
  await s.run();
  assert.equal(s.calls.includes('authorize'), true);
  assert.equal(s.calls.includes('send'), false);
  assert.equal(s.calls.includes('uncertain'), false);
  assert.equal(s.result().deliveryFailed, false);
});

test("a send started near the deadline keeps fixed press and confirmation timeouts", async () => {
  const s = setup();
  let waits = 0;
  s.locator.press = async (_, options) => {
    assert.equal(options?.timeout, 10_000);
    s.calls.push('send');
    await s.deps.sleep(600_000);
  };
  s.locator.waitFor = async options => {
    waits++;
    if (waits === 2) assert.equal(options?.timeout, 15_000);
    s.calls.push('confirm');
  };
  await s.run();
  assert.equal(waits, 2);
  assert.equal(s.result().sent, true);
  assert.equal(s.result().deliveryFailed, false);
});
test("a delivery timeout is recorded uncertain and never retried", async () => {
  const s = setup();
  let waits = 0;
  s.locator.waitFor = async () => {
    waits++;
    if (waits > 1) throw new Error("timeout");
  };
  await s.run();
  assert.equal(s.calls.filter((c) => c === "send").length, 1);
  assert.equal(s.calls.includes("sent"), false);
  assert.equal(s.result().deliveryFailed, true);
});
test("exhausted feed budget does not create DM-only sessions", async () => {
  const s = setup();
  s.deps.warmup = async () => ({ minutes: 0, reason: "skipped" });
  await s.run();
  assert.deepEqual(s.calls, ["record-incomplete"]);
});
test("login challenges stop before browsing and are reported", async () => {
  const s = setup();
  s.page.url = () => "https://www.instagram.com/challenge/";
  await s.run();
  assert.deepEqual(s.calls, ["record-incomplete"]);
  assert.equal(s.result().deliveryFailed, true);
});

test('missing Message follows once and records the relationship before sending', async () => {
  const s = setup();
  const events: string[] = [];
  let following = false;
  s.page.locator = (() => ({
    first: () => ({ ...s.locator, count: async () => 0 }),
    getByRole: (_: string, options: { name: string | RegExp }) => {
    if (options.name === 'Message') return {
      waitFor: async () => { if (!following) throw new Error('missing'); },
      click: async () => { assert.equal(following, true); events.push('message'); },
    };
    if (String(options.name).includes('Following')) return { waitFor: async () => { assert.equal(following, true); } };
    return { isVisible: async () => true, click: async () => { following = true; events.push('follow'); } };
    },
  })) as unknown as Page['locator'];
  s.deps.begin = async () => true;
  s.deps.recordFollow = async (profileId, leadId, followed) => {
    assert.equal(profileId, 'profile'); assert.equal(leadId, 'lead'); assert.equal(followed, true);
    events.push('record-follow');
  };
  await s.run();
  assert.deepEqual(events, ['follow', 'record-follow', 'message']);
  assert.equal(s.result().sent, true);
});

test('blocked message follows and unsends without marking delivery successful', async () => {
  const s = setup();
  const events: string[] = [];
  s.page.getByText = ((text: string | RegExp, options?: { exact?: boolean }) => {
    if (options?.exact && String(text).startsWith("This account can't receive"))
      return s.locator;
    return s.locator;
  }) as unknown as Page['getByText'];
  s.deps.recordFollow = async (_, __, followed) => {
    assert.equal(followed, true);
    events.push('follow');
  };
  s.deps.finish = async (_, __, ___, sent, blocked) => {
    assert.equal(sent, false);
    assert.equal(blocked, true);
    events.push('blocked');
  };
  await s.run();
  assert.deepEqual(events, ['follow', 'blocked']);
  assert.deepEqual(s.result(), { sent: false, deliveryFailed: false });
});

test('existing Message does not authorize or record a follow', async () => {
  const s = setup();
  s.deps.recordFollow = async () => { throw new Error('unexpected record'); };
  await s.run();
  assert.equal(s.result().sent, true);
});

test('an exhausted daily budget also prevents follow cleanup', async () => {
  const s = setup();
  let following = true;
  const events: string[] = [];
  const follow = { waitFor: async () => { assert.equal(following, false); } };
  const relationship = {
    or: () => ({ waitFor: async () => {} }),
    isVisible: async () => following,
    click: async () => { events.push('open-following'); },
  };
  s.page.locator = (() => ({ getByRole: (_: string, options: { name: RegExp }) => String(options.name).includes('Following') ? relationship : follow })) as unknown as Page['locator'];
  s.page.getByRole = (() => ({ waitFor: async () => {}, click: async () => { following = false; events.push('unfollow'); } })) as unknown as Page['getByRole'];
  s.deps.followTasks = async () => [{ leadId: 'lead', username: 'alice' }];
  s.deps.recordFollow = async (_, __, followed) => { assert.equal(followed, false); events.push('record'); };
  s.deps.warmup = async () => { events.push('browse'); return { minutes: 0, reason: 'skipped' }; };
  await s.run();
  assert.deepEqual(events, ['browse']);
});
