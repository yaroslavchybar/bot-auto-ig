import { afterEach, expect, test, vi } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import { defaultRoutine, dayKey } from '../../convex/routinePolicy';
import { createConvexTest, seedList, seedProfile } from './helpers';
afterEach(() => vi.useRealTimers());

const readLeads = (t: ReturnType<typeof createConvexTest>) =>
  t.run(ctx => ctx.db.query('leads').collect());

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
  // These fixtures represent accounts already classified by the scraper.
  await t.run(async ctx => {
    for (const username of ['alice', 'bob', 'carol', 'dave']) {
      const createdAt = Date.now();
      const leadId = await ctx.db.insert('leads', {
        username, classification: 'male', enrichmentStatus: 'ready',
        dmSent: false, followed: false, createdAt,
      });
      await ctx.db.insert('leadMemberships', { leadId, listId: leadListId, available: true, leadCreatedAt: createdAt });
    }
  });
  const leads = await readLeads(t);
  const loggedIn = () =>
    t.mutation(api.profiles.mutations.setIgState, {
      profileId: profile._id,
      igLoggedIn: true,
      outreachReady: true,
    });
  return { t, list, profile, automation, args, leads, loggedIn, leadListId };
}


test('classified male leads are claimed exactly once', async () => {
  const { t, args, loggedIn, leadListId } = await setup();
  expect(await t.mutation(internal.routines.reserve, args)).toBeNull();
  await loggedIn();
  const claims = await Promise.all([t.mutation(internal.routines.reserve, args), t.mutation(internal.routines.reserve, args)]);
  expect(claims[0]).not.toBeNull(); expect(claims[1]).not.toBeNull();
  expect(claims[0]!.leadId).not.toBe(claims[1]!.leadId);
  expect(await t.mutation(internal.routines.reserve, args)).toBeNull();
  const lead = (await readLeads(t)).find(l => l._id === claims[0]!.leadId)!;
  expect(lead).toMatchObject({ senderId: args.profileId, dmSent: false, followed: false });
  const membership = await t.run(ctx => ctx.db.query('leadMemberships')
    .withIndex('by_lead_list', q => q.eq('leadId', lead._id).eq('listId', leadListId)).first());
  expect(membership?.available).toBe(false);
  for (const removed of ['source', 'status', 'delivery', 'followPending', 'updatedAt']) expect(lead).not.toHaveProperty(removed);
});

test('interrupted claims remain skipped after restart and issue clearing', async () => {
  const { t, args, loggedIn, profile } = await setup(); await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, args))!;
  await t.mutation(internal.routines.finishSend, { profileId: profile._id, leadId: claim.leadId, date: claim.date, sent: false });
  expect(await t.query(internal.routines.ready, args)).toBe(false);
  await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {});
  await t.mutation(api.routines.setAccount, { profileId: profile._id, clearIssue: true });
  const next = (await t.mutation(internal.routines.reserve, args))!;
  expect(next.leadId).not.toBe(claim.leadId);
  expect((await readLeads(t)).find(l => l._id === claim.leadId)).toMatchObject({ dmSent: false, senderId: profile._id });
});

test('sender, membership and date checks gate interaction; confirmed sends are idempotent', async () => {
  const { t, args, loggedIn, profile, list } = await setup(); await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, args))!;
  const check = { ...args, leadId: claim.leadId, date: claim.date };
  expect(await t.query(internal.routines.beginSend, check)).toBe(true);
  expect(await t.query(internal.routines.beginSend, { ...check, date: '2000-01-01' })).toBe(false);
  await t.mutation(api.profiles.mutations.bulkRemoveFromList, { profileIds: [profile._id], listId: list._id });
  expect(await t.query(internal.routines.beginSend, check)).toBe(false);
  const other = (await seedProfile(t, { name: 'Other sender' }))!;
  await expect(t.mutation(internal.routines.finishSend, { profileId: other._id, leadId: claim.leadId, date: claim.date, sent: true })).rejects.toThrow('another sender');
  const result = { profileId: profile._id, leadId: claim.leadId, date: claim.date, sent: true };
  await t.mutation(internal.routines.finishSend, result);
  await t.mutation(internal.routines.finishSend, result);
  await t.mutation(internal.routines.finishSend, { ...result, sent: false });
  expect((await readLeads(t)).find(l => l._id === claim.leadId)?.dmSent).toBe(true);
  expect(await t.run(async ctx => (await ctx.db.query('accountProgress').collect())[0].outreachDays)).toBe(1);
});

test('follows become due after seven days and unfollowing never requeues the lead', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
  const { t, args, loggedIn, profile } = await setup(); await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, args))!;
  const follow = { profileId: profile._id, leadId: claim.leadId, followed: true };
  await t.mutation(internal.routines.recordFollow, follow);
  const followDate = Date.now();
  vi.setSystemTime(followDate + 7 * 86400000 - 1);
  await t.mutation(internal.routines.recordFollow, follow);
  expect(await t.query(internal.routines.followTasks, args)).toEqual([]);
  await expect(t.mutation(internal.routines.recordFollow, { ...follow, followed: false })).rejects.toThrow('not due');
  vi.setSystemTime(followDate + 7 * 86400000);
  expect(await t.query(internal.routines.followTasks, args)).toEqual([{ leadId: claim.leadId, username: claim.username }]);
  await t.mutation(internal.routines.recordFollow, { ...follow, followed: false });
  expect(await t.query(internal.routines.followTasks, args)).toEqual([]);
  expect((await readLeads(t)).find(l => l._id === claim.leadId)).toMatchObject({ followed: false, followDate, senderId: profile._id });
  expect((await t.mutation(internal.routines.reserve, args))?.leadId).not.toBe(claim.leadId);
});

test('a followed lead can finish its same-session DM and stays claimed after unfollow', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
  const { t, args, loggedIn, profile } = await setup(); await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, args))!;
  const check = { ...args, leadId: claim.leadId, date: claim.date };

  await t.mutation(internal.routines.recordFollow, {
    profileId: profile._id, leadId: claim.leadId, followed: true,
  });
  expect(await t.query(internal.routines.beginSend, check)).toBe(true);
  await t.mutation(internal.routines.finishSend, {
    profileId: profile._id, leadId: claim.leadId, date: claim.date, sent: true,
  });

  vi.setSystemTime(Date.now() + 7 * 86400000);
  await t.mutation(internal.routines.recordFollow, {
    profileId: profile._id, leadId: claim.leadId, followed: false,
  });
  const lead = (await readLeads(t)).find(l => l._id === claim.leadId)!;
  expect(lead).toMatchObject({ senderId: profile._id, dmSent: true, followed: false });
  expect((await t.mutation(internal.routines.reserve, args))?.leadId).not.toBe(claim.leadId);
});

test('a blocked DM stays unsent without stopping the sender account', async () => {
  const { t, args, loggedIn, profile } = await setup(); await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, args))!;
  await t.mutation(internal.routines.finishSend, {
    profileId: profile._id,
    leadId: claim.leadId,
    date: claim.date,
    sent: false,
    blocked: true,
  });
  const lead = (await readLeads(t)).find(l => l._id === claim.leadId)!;
  expect(lead).toMatchObject({ senderId: profile._id, dmSent: false, followed: false });
  expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0]?.issue).toBeUndefined();
});

test('DM and follow flags independently exclude unassigned leads', async () => {
  const { t, args, loggedIn, leads } = await setup(); await loggedIn();
  await t.run(async ctx => { await ctx.db.patch(leads[0]._id, { dmSent: true }); await ctx.db.patch(leads[1]._id, { followed: true }); });
  const claim = (await t.mutation(internal.routines.reserve, args))!;
  expect([leads[0]._id, leads[1]._id]).not.toContain(claim.leadId);
});

test('daily allowance grows only after confirmed outreach days', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
  const { t, args, loggedIn } = await setup(); await loggedIn();
  const claim = (await t.mutation(internal.routines.reserve, args))!;
  await t.mutation(internal.routines.finishSend, { profileId: args.profileId, leadId: claim.leadId, date: claim.date, sent: true });
  vi.setSystemTime(new Date('2026-09-26T10:00:00Z'));
  await t.mutation(internal.routines.reserve, args);
  expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0]).toMatchObject({ used: 1, allowance: 3 });
});
test("overlapping enabled automations are rejected on activation; adding to another list moves the profile", async () => {
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
  // Single-list invariant: this moves the profile, it never copies.
  await t.mutation(api.profiles.mutations.bulkAddToList, {
    profileIds: [profile._id],
    listId: secondList._id,
  });
  const moved = await t.run(async (ctx) => ctx.db.get(profile._id));
  expect(moved?.listIds?.map(String)).toEqual([String(secondList._id)]);
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
