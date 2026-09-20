import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { defaultRoutine, dayKey } from "../../convex/routinePolicy";
import { normalizeUsername } from "../../convex/leadImport";
import { parseLeadImport } from "../../frontend/src/features/leads/import";
import { createConvexTest, seedList, seedProfile } from "./helpers";

afterEach(() => vi.useRealTimers());

async function setup() {
  const t = createConvexTest();
  const list = (await seedList(t))!,
    profile = (await seedProfile(t))!;
  await t.mutation(api.profiles.mutations.bulkAddToList, {
    profileIds: [profile._id],
    listId: list._id,
  });
  const leadListId = await t.mutation(api.leads.createList, {
    name: "Recipients",
  });
  const automation = (await t.mutation(api.automations.mutations.create, {
    name: "Daily",
    nodes: [],
    edges: [],
    listIds: [list._id],
    routine: {
      ...defaultRoutine,
      outreachStartDay: 1,
      initialDms: 2,
      maxDms: 3,
      outreachEnabled: true,
      leadListId,
      message: "Hello {{username}}",
    },
  }))!;
  await t.mutation(api.automations.mutations.setActive, {
    id: automation._id,
    isActive: true,
  });
  const args = { automationId: automation._id, profileId: profile._id };
  await t.mutation(api.leads.importLeads, {
    listId: leadListId,
    usernames: ["alice", "bob", "carol", "dave"],
    source: "test",
  });
  const leads = await t.query(api.leads.list, {});
  await t.mutation(api.leads.setStatus, {
    ids: leads.map((l) => l._id),
    status: "ready",
  });
  const loggedIn = () =>
    t.mutation(api.profiles.mutations.setIgState, {
      profileId: profile._id,
      igLoggedIn: true,
      outreachReady: true,
    });
  return { t, list, profile, automation, args, leads, loggedIn, leadListId };
}

test("logged-in and outreach-ready toggles gate work independently; membership changes stop work", async () => {
  const { t, args, profile, list } = await setup();
  expect(await t.query(internal.routines.ready, args)).toBe(false);
  await t.mutation(api.profiles.mutations.setIgState, {
    profileId: profile._id,
    igLoggedIn: true,
  });
  expect(await t.query(internal.routines.ready, args)).toBe(true);
  expect(
    await t.mutation(internal.routines.reserve, {
      ...args,
      requestId: "not-ready",
    }),
  ).toBeNull();
  await t.mutation(api.profiles.mutations.setIgState, {
    profileId: profile._id,
    outreachReady: true,
  });
  const claim = (await t.mutation(internal.routines.reserve, {
    ...args,
    requestId: "ready",
  }))!;
  await t.mutation(api.profiles.mutations.bulkRemoveFromList, {
    profileIds: [profile._id],
    listId: list._id,
  });
  expect(
    await t.query(internal.routines.ready, { ...args, checkpoint: true }),
  ).toBe(false);
  expect(
    await t.mutation(internal.routines.beginSend, {
      attemptId: claim.attemptId,
    }),
  ).toBe(false);
});

test("reservations are idempotent, enforce account limits, and cannot double-send", async () => {
  const { t, args, loggedIn } = await setup();
  await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, {
    ...args,
    requestId: "one",
  }))!;
  expect(
    await t.mutation(internal.routines.reserve, { ...args, requestId: "one" }),
  ).toEqual(claim);
  expect(
    await t.mutation(internal.routines.beginSend, {
      attemptId: claim.attemptId,
    }),
  ).toBe(true);
  expect(
    await t.mutation(internal.routines.beginSend, {
      attemptId: claim.attemptId,
    }),
  ).toBe(false);
  await t.mutation(internal.routines.finishSend, {
    attemptId: claim.attemptId,
    sent: true,
  });
  await t.mutation(internal.routines.finishSend, {
    attemptId: claim.attemptId,
    sent: true,
  });
  const second = (await t.mutation(internal.routines.reserve, {
    ...args,
    requestId: "two",
  }))!;
  expect(second.username).not.toBe(claim.username);
  await t.mutation(internal.routines.beginSend, {
    attemptId: second.attemptId,
  });
  await t.mutation(internal.routines.finishSend, {
    attemptId: second.attemptId,
    sent: true,
  });
  expect(
    await t.mutation(internal.routines.reserve, {
      ...args,
      requestId: "three",
    }),
  ).toBeNull();
  const state = (
    await t.query(api.routines.accounts, { automationId: args.automationId })
  )[0];
  expect(state.used).toBe(2);
  expect(state.allowance).toBe(2);
});

test("uncertain sends stop an account until the lead is reviewed and cannot be requeued", async () => {
  const { t, args, loggedIn, profile } = await setup();
  await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, {
    ...args,
    requestId: "one",
  }))!;
  await t.mutation(internal.routines.beginSend, { attemptId: claim.attemptId });
  await t.mutation(internal.routines.finishSend, {
    attemptId: claim.attemptId,
    sent: false,
  });
  expect(await t.query(internal.routines.ready, args)).toBe(false);
  await expect(
    t.mutation(api.routines.setAccount, {
      profileId: profile._id,
      clearIssue: true,
    }),
  ).rejects.toThrow("Review");
  const lead = (await t.query(api.leads.list, {})).find(
    (l) => l.username === claim.username,
  )!;
  await expect(
    t.mutation(api.leads.setStatus, { ids: [lead._id], status: "ready" }),
  ).rejects.toThrow("cannot be queued");
  await t.mutation(api.leads.setStatus, {
    ids: [lead._id],
    status: "contacted",
  });
  await t.mutation(api.routines.setAccount, {
    profileId: profile._id,
    clearIssue: true,
  });
  expect(await t.query(internal.routines.ready, args)).toBe(true);
});

test("overlapping enabled automations are rejected on activation and on list changes", async () => {
  const { t, list, profile } = await setup();
  const secondList = (await seedList(t, "Second"))!;
  const second = (await t.mutation(api.automations.mutations.create, {
    name: "Second",
    nodes: [],
    edges: [],
    listIds: [list._id],
    routine: defaultRoutine,
  }))!;
  await expect(
    t.mutation(api.automations.mutations.setActive, {
      id: second._id,
      isActive: true,
    }),
  ).rejects.toThrow("multiple enabled");
  await t.mutation(api.automations.mutations.update, {
    id: second._id,
    listIds: [secondList._id],
  });
  await t.mutation(api.automations.mutations.setActive, {
    id: second._id,
    isActive: true,
  });
  await expect(
    t.mutation(api.profiles.mutations.bulkAddToList, {
      profileIds: [profile._id],
      listId: secondList._id,
    }),
  ).rejects.toThrow("multiple enabled");
});

test("completed daily browsing advances once; removing and readding profiles preserves progress", async () => {
  const { t, args, profile, list, loggedIn } = await setup();
  await loggedIn();
  await t.run((ctx) =>
    ctx.db.insert("warmupStates", {
      profileId: profile._id,
      day: 1,
      date: dayKey(),
      runsToday: 1,
      todayMinutes: 30,
      minutesUsedToday: 5,
      updatedAt: Date.now(),
    }),
  );
  await t.mutation(internal.routines.recordSession, {
    ...args,
    activityCompleted: true,
  });
  expect(
    (
      await t.query(api.routines.accounts, { automationId: args.automationId })
    )[0].activeDays,
  ).toBe(0);
  await t.run(async (ctx) => {
    const w = (await ctx.db.query("warmupStates").collect())[0];
    await ctx.db.patch(w._id, { minutesUsedToday: 30 });
  });
  await t.mutation(internal.routines.recordSession, {
    ...args,
    activityCompleted: true,
  });
  await t.mutation(internal.routines.recordSession, {
    ...args,
    activityCompleted: true,
  });
  await t.mutation(api.profiles.mutations.bulkRemoveFromList, {
    profileIds: [profile._id],
    listId: list._id,
  });
  await t.mutation(api.profiles.mutations.bulkAddToList, {
    profileIds: [profile._id],
    listId: list._id,
  });
  expect(
    (
      await t.query(api.routines.accounts, { automationId: args.automationId })
    )[0].activeDays,
  ).toBe(1);
  expect(await t.query(internal.routines.ready, args)).toBe(false);
});

test("daily reset increases only after actual outreach days; skipped days add no allowance", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
  const { t, args, loggedIn } = await setup();
  await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, {
    ...args,
    requestId: "first",
  }))!;
  await t.mutation(internal.routines.beginSend, { attemptId: claim.attemptId });
  await t.mutation(internal.routines.finishSend, {
    attemptId: claim.attemptId,
    sent: true,
  });
  vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
  const next = await t.mutation(internal.routines.reserve, {
    ...args,
    requestId: "next",
  });
  expect(next).not.toBeNull();
  const row = (
    await t.query(api.routines.accounts, { automationId: args.automationId })
  )[0];
  expect(row.used).toBe(1);
  expect(row.allowance).toBe(3);
});

test("CSV import normalizes globally and never resets existing contact status", async () => {
  const { t, leadListId, leads } = await setup();
  expect(
    parseLeadImport(
      'username,bio\n"@Alice","hello, world"\nhttps://instagram.com/bob/,test',
    ),
  ).toEqual(["@Alice", "https://instagram.com/bob/"]);
  expect(normalizeUsername("https://instagram.com/p/abc/")).toBeNull();
  await t.mutation(api.leads.setStatus, {
    ids: [leads[0]._id],
    status: "do_not_contact",
  });
  const result = await t.mutation(api.leads.importLeads, {
    listId: leadListId,
    usernames: [`@${leads[0].username.toUpperCase()}`, "bad username"],
    source: "again",
  });
  expect(result).toEqual({ added: 0, duplicates: 1, invalid: 1 });
  expect(
    (await t.query(api.leads.list, {})).find((l) => l._id === leads[0]._id)
      ?.status,
  ).toBe("do_not_contact");
});
