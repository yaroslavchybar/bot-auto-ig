import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { runRoutineSession } from "./routine.js";

function setup() {
  const calls: string[] = [];
  let sent = false,
    deliveryFailed = false;
  const deps: NonNullable<Parameters<typeof runRoutineSession>[5]> = {
    ready: async () => true,
    warmup: async () => {
      calls.push("browse");
      return { minutes: 5, reason: "finished" };
    },
    reserve: async () =>
      calls.includes("reserve")
        ? null
        : (calls.push("reserve"),
          { attemptId: "attempt", username: "alice", message: "Hello alice" }),
    begin: async () => {
      calls.push("authorize");
      return true;
    },
    finish: async (_, value) => {
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
    waitFor: async () => {
      calls.push("confirm");
    },
  };
  const page = {
    url: () => "https://www.instagram.com/",
    goto: async () => {},
    waitForURL: async () => {},
    getByRole: () => locator,
    getByText: () => locator,
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
  s.locator.waitFor = async () => {
    throw new Error("timeout");
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
