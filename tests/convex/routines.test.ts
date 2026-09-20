import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { defaultRoutine, dayKey } from "../../convex/routinePolicy";
import { normalizeUsername } from "../../convex/leadImport";
import { parseLeadImport } from "../../frontend/src/features/leads/import";
import { createConvexTest, seedList, seedProfile } from "./helpers";

afterEach(() => vi.useRealTimers());

test('only automation-created follows become due after seven full days, with stable dates', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
  const { t, args, loggedIn, leadListId } = await setup();
  await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, { ...args, requestId: 'follow' }))!;
  const leadId = (await t.mutation(internal.routines.beginFollow, { requestId: claim.requestId }))!;
  expect(await t.mutation(internal.routines.beginFollow, { requestId: claim.requestId })).toBeNull();
  expect(await t.query(internal.routines.followTasks, args)).toEqual([{ leadId, username: claim.username, recover: true }]);
  await t.mutation(internal.routines.recordFollow, { ...args, leadId, followed: true });
  const followDate = Date.now();
  vi.setSystemTime(followDate + 1000);
  await t.mutation(internal.routines.recordFollow, { ...args, leadId, followed: true });
  await t.mutation(api.leads.importLeads, { listId: leadListId, usernames: [claim.username], source: 'again' });
  expect((await t.query(api.leads.list, {})).find(l => l._id === leadId)).toMatchObject({ followed: true, followDate, followPending: false });
  const another = (await seedProfile(t, { name: 'Other sender' }))!;
  await expect(t.mutation(internal.routines.recordFollow, { ...args, profileId: another._id, leadId, followed: false })).rejects.toThrow('another profile');
  vi.setSystemTime(followDate + 7 * 86400000 - 1);
  expect(await t.query(internal.routines.followTasks, args)).toEqual([]);
  await expect(t.mutation(internal.routines.recordFollow, { ...args, leadId, followed: false })).rejects.toThrow('not due');
  vi.setSystemTime(followDate + 7 * 86400000);
  expect(await t.query(internal.routines.followTasks, args)).toEqual([{ leadId, username: claim.username, recover: false }]);
  await t.mutation(internal.routines.recordFollow, { ...args, leadId, followed: false });
  expect(await t.query(internal.routines.followTasks, args)).toEqual([]);
  expect((await t.query(api.leads.list, {})).find(l => l._id === leadId)).toMatchObject({ followed: false, followDate });
});

test('an interrupted follow can be cleared without claiming an existing relationship', async () => {
  const { t, args, loggedIn, leads } = await setup();
  await loggedIn();
  await expect(t.mutation(internal.routines.recordFollow, { ...args, leadId: leads[0]!._id, followed: true })).rejects.toThrow('another profile');
  const claim = (await t.mutation(internal.routines.reserve, { ...args, requestId: 'pending-follow' }))!;
  const leadId = (await t.mutation(internal.routines.beginFollow, { requestId: claim.requestId }))!;
  await t.mutation(internal.routines.recordFollow, { ...args, leadId, followed: false });
  expect(await t.query(internal.routines.followTasks, args)).toEqual([]);
  expect((await t.query(api.leads.list, {})).find(l => l._id === leadId)?.followDate).toBeUndefined();
});

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
      requestId: claim.requestId,
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
      requestId: claim.requestId,
    }),
  ).toBe(true);
  expect(
    await t.mutation(internal.routines.beginSend, {
      requestId: claim.requestId,
    }),
  ).toBe(false);
  await t.mutation(internal.routines.finishSend, {
    requestId: claim.requestId,
    sent: true,
  });
  await t.mutation(internal.routines.finishSend, {
    requestId: claim.requestId,
    sent: true,
  });
  const second = (await t.mutation(internal.routines.reserve, {
    ...args,
    requestId: "two",
  }))!;
  expect(second.username).not.toBe(claim.username);
  await t.mutation(internal.routines.beginSend, {
    requestId: second.requestId,
  });
  await t.mutation(internal.routines.finishSend, {
    requestId: second.requestId,
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
  await t.mutation(internal.routines.beginSend, { requestId: claim.requestId });
  await t.mutation(internal.routines.finishSend, {
    requestId: claim.requestId,
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
  expect(lead).toMatchObject({ dmSent: false, delivery: { state: 'uncertain' } });
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

test('DM confirmation stays on the lead through reimports and do-not-contact changes', async () => {
  const { t, args, loggedIn, leadListId, profile } = await setup();
  await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, { ...args, requestId: 'confirmed' }))!;
  await t.mutation(internal.routines.beginSend, { requestId: claim.requestId });
  await t.mutation(internal.routines.finishSend, { requestId: claim.requestId, sent: true });
  const sent = (await t.query(api.leads.list, {})).find(l => l.username === claim.username)!;
  expect(sent).toMatchObject({ dmSent: true, senderId: profile._id, delivery: { state: 'sent' } });
  await t.mutation(api.leads.setStatus, { ids: [sent._id], status: 'do_not_contact' });
  await t.mutation(api.leads.importLeads, { listId: leadListId, usernames: [sent.username], source: 'again' });
  await t.mutation(internal.routines.finishSend, { requestId: claim.requestId, sent: false });
  const updated = (await t.query(api.leads.list, {})).find(l => l._id === sent._id)!;
  expect(updated).toMatchObject({ dmSent: true, status: 'do_not_contact' });
});

test('callbacks from a cancelled reservation cannot confirm a newer reservation', async () => {
  const { t, args, loggedIn, profile } = await setup();
  await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, { ...args, requestId: 'old' }))!;
  await t.mutation(api.profiles.mutations.setIgState, { profileId: profile._id, outreachReady: false });
  expect(await t.mutation(internal.routines.beginSend, { requestId: claim.requestId })).toBe(false);
  expect(await t.mutation(internal.routines.reserve, { ...args, requestId: claim.requestId })).toBeNull();
  await loggedIn();
  const replacement = (await t.mutation(internal.routines.reserve, { ...args, requestId: 'new' }))!;
  expect(replacement.username).toBe(claim.username);
  await t.mutation(internal.routines.finishSend, { requestId: claim.requestId, sent: true });
  expect(await t.mutation(internal.routines.beginSend, { requestId: claim.requestId })).toBe(false);
  const lead = (await t.query(api.leads.list, {})).find(l => l.username === claim.username)!;
  expect(lead).toMatchObject({ dmSent: false, delivery: { requestId: 'new', state: 'reserved' } });
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
  await t.mutation(internal.routines.beginSend, { requestId: claim.requestId });
  await t.mutation(internal.routines.finishSend, {
    requestId: claim.requestId,
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
