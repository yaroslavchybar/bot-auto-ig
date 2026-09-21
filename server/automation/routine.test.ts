import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { runRoutineSession } from "./routine.js";

function setup() {
  const calls: string[] = [];
  let sent = false,
    deliveryFailed = false;
  const deps: NonNullable<Parameters<typeof runRoutineSession>[5]> = {
    followTasks: async () => [],
    recordFollow: async () => undefined,
    ready: async () => true,
    warmup: async () => {
      calls.push("browse");
      return { minutes: 5, reason: "finished" };
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
    fill: async () => {
      calls.push("compose");
    },
    press: async () => {
      calls.push("send");
    },
    last() {
      return this;
    },
    nth() {
      return this;
    },
    waitFor: async () => {
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
test("a refused send authorization never presses Send", async () => {
  const s = setup();
  s.deps.begin = async () => false;
  await s.run();
  assert.equal(s.calls.includes("send"), false);
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

test('due unfollows run before browsing even with no remaining browsing budget', async () => {
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
  assert.deepEqual(events, ['open-following', 'unfollow', 'record', 'browse']);
});
