import { afterEach, expect, test, vi } from 'vite-plus/test';
import { api, internal } from '../../convex/_generated/api';
import { defaultRoutine, dayKey, validateRoutine } from '../../convex/routinePolicy';
import { ROUTINE_RETRY_MS } from '../../convex/routineErrors';
import { createConvexTest, seedList, seedProfile } from './helpers';
import type { Id, Doc } from '../../convex/_generated/dataModel';
import type { MutationCtx } from '../../convex/_generated/server';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test('routine settings accept plain-English topic descriptions up to 1,000 characters', () => {
  expect(() => validateRoutine({ ...defaultRoutine, activity: { warmup_topics: 'x'.repeat(1000) } })).not.toThrow();
  expect(() => validateRoutine({ ...defaultRoutine, activity: { warmup_topics: 'x'.repeat(1001) } })).toThrow('Invalid activity setting');
});

test('outreach waits until day eight even when an old saved setting enables day one', async () => {
  const { t, automation, args, loggedIn } = await setup();
  await loggedIn();
  await t.run(async ctx => {
    await ctx.db.patch(automation._id, { routine: { ...automation.routine!, outreachStartDay: 1 } });
    const warmup = await ctx.db.query('warmupStates').unique();
    await ctx.db.patch(warmup!._id, { day: 7 });
  });
  expect(await t.query(api.routines.accounts, { automationId: automation._id }))
    .toMatchObject([{ stage: 'Warm-up', allowance: 0 }]);
  expect(await t.query(internal.routines.target, args)).toEqual({ target: 0, remaining: 0, sent: 0 });
  expect(await reserveFollow(t, args)).toBeNull();
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([]);
  await t.run(async ctx => {
    const warmup = await ctx.db.query('warmupStates').unique();
    await ctx.db.patch(warmup!._id, { day: 8 });
  });
  expect(await t.query(api.routines.accounts, { automationId: automation._id }))
    .toMatchObject([{ activeDays: 0, stage: 'Outreach', allowance: 2 }]);
  expect(await t.query(internal.routines.target, args)).toMatchObject({ target: 2, remaining: 2 });
  expect(await reserveFollow(t, args)).not.toBeNull();
  expect(await reserveFollow(t, args)).not.toBeNull();
  expect(await reserveFollow(t, args)).toBeNull();
});

test('day-seven outreach rejects existing pending DMs and follow authorization', async () => {
  const { t, args, loggedIn } = await setup(); await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  await t.run(async ctx => {
    await ctx.db.patch(claim.leadId, { followed: true, followDate: Date.now() - 86_400_000,
      unfollowAt: Date.now() + 86_400_000, dmEligible: true });
    const warmup = await ctx.db.query('warmupStates').unique();
    await ctx.db.patch(warmup!._id, { day: 7 });
  });
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([]);
  expect(await t.query(internal.routines.notifications, args)).toBeNull();
  expect(await t.mutation(internal.routines.beginSend, { ...args, leadId: claim.leadId, date: claim.date })).toBe(false);
  expect(await t.mutation(internal.routines.beginFollow, { ...args, leadId: claim.leadId, date: claim.date })).toBe(false);
});

test('a follow warning stops new follows for the day without stopping browsing readiness', async () => {
  const { t, args, loggedIn } = await setup(); await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  await t.mutation(internal.warmup.mutations.pauseFollowsInternal,
    { profileId: args.profileId, date: dayKey(), reason: 'Follow stuck loading' });
  expect(await t.query(internal.routines.target, args)).toEqual({ target: 0, remaining: 0, sent: 0 });
  expect(await reserveFollow(t, args)).toBeNull();
  expect(await t.mutation(internal.routines.beginFollow, { ...args, leadId: claim.leadId, date: claim.date })).toBe(false);
  expect(await t.query(internal.routines.ready, args)).toBe(true);
});

test.each([0, 0.999])('daily growth is saved once and applies next day (random=%s)', async random => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
  const { t, args, loggedIn, profile, automation } = await setup();
  await loggedIn();
  await t.run(ctx => ctx.db.patch(automation._id, { routine: { ...automation.routine!, maxDms: 35 } }));
  const claim = (await reserveFollow(t, args))!;
  const rng = vi.spyOn(Math, 'random').mockReturnValue(random);
  const finish = { profileId: profile._id, leadId: claim.leadId, followed: true };
  await t.mutation(internal.routines.recordFollow, finish);
  rng.mockRestore();
  const increase = random === 0 ? 1 : 4;
  const read = () => t.run(async ctx => (await ctx.db.query('accountProgress').collect())[0]);
  expect(await read()).toMatchObject({ allowance: 2, followIncrease: increase, outreachDays: 1 });
  await t.mutation(internal.routines.recordFollow, finish);
  const second = (await reserveFollow(t, args))!;
  await t.mutation(internal.routines.recordFollow, { ...finish, leadId: second.leadId });
  expect(await read()).toMatchObject({ allowance: 2, followIncrease: increase, outreachDays: 1 });
  expect(await reserveFollow(t, args)).toBeNull();
  vi.setSystemTime(new Date('2026-09-22T10:00:00Z'));
  expect((await t.query(api.routines.accounts, { automationId: automation._id }))[0].allowance).toBe(2 + increase);
  await reserveFollow(t, args);
  expect(await read()).toMatchObject({ allowance: 2 + increase, used: 1 });
  // An unsuccessful day does not increase the limit, even across missed days.
  vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
  await t.run(ctx => ctx.db.patch(automation._id, { routine: { ...automation.routine!, maxDms: 3 } }));
  await reserveFollow(t, args);
  expect(await read()).toMatchObject({ allowance: 3, followIncrease: increase, outreachDays: 1 });
});

const readLeads = (t: ReturnType<typeof createConvexTest>) =>
  t.run(ctx => ctx.db.query('leads').collect());

test('DM tasks keep message variations intact and supply the recipient name for sending', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
  const { t, args, loggedIn, profile, automation } = await setup();
  await loggedIn();
  const message = '{Hi|Hey} [name], [username]!';
  await t.run(ctx => ctx.db.patch(automation._id, { routine: { ...automation.routine!, message } }));
  const claim = (await reserveFollow(t, args))!;
  await t.run(ctx => ctx.db.patch(claim.leadId, { fullName: 'Alice Smith' }));
  await t.mutation(internal.routines.recordFollow, { profileId: profile._id, leadId: claim.leadId, followed: true });
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
  await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), usernames: [claim.username] });
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([
    { leadId: claim.leadId, username: claim.username, fullName: 'Alice Smith', message, date: dayKey() },
  ]);
});

test('routine saves reject broken or possibly empty message variations', () => {
  for (const message of ['{Hi|Hey', '{{username}', '{Hi| }']) {
    expect(() => validateRoutine({ ...defaultRoutine, message })).toThrow(/variation|empty/);
  }
  const route = { leadListId: 'list' as Id<'leadLists'>, profileIds: [], message: '{Hey|Hi' };
  expect(() => validateRoutine({ ...defaultRoutine, outreachRoutes: [route] })).toThrow(/variation/);
});

test('outreach reservations move unique leads from ready to assigned without resetting after a follow', async () => {
  vi.useFakeTimers();
  try {
    const { t, args, loggedIn, profile } = await setup();
    await loggedIn();
    await t.mutation(api.leadStats.initialize, {});
    await t.mutation(api.analytics.initialize, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const readStats = () => t.run(async ctx => (await ctx.db.query('leadStats').unique())!.counts);
    expect(await readStats()).toMatchObject({ total: 4, male: 4, ready: 4, assigned: 0 });
    const claim = (await reserveFollow(t, args))!;
    expect(await readStats()).toMatchObject({ total: 4, male: 4, ready: 3, assigned: 1 });
    await t.mutation(internal.routines.recordFollow, { profileId: profile._id, leadId: claim.leadId, followed: true });
    await t.mutation(internal.routines.recordFollow, { profileId: profile._id, leadId: claim.leadId, followed: true });
    expect(await readStats()).toMatchObject({ ready: 3, assigned: 1 });
    vi.setSystemTime(Date.now() + 10 * 86_400_000);
    await t.mutation(internal.routines.recordFollow, { profileId: profile._id, leadId: claim.leadId, followed: false });
    expect(await readStats()).toMatchObject({ ready: 3, assigned: 1 });
    expect((await t.run(ctx => ctx.db.query('analyticsHistory').unique()))?.totals.follows).toBe(1);
  } finally { vi.useRealTimers(); }
});

test('saved multi-list routines cannot claim follows or send DMs until corrected', async () => {
  const { t, args, loggedIn, profile, automation, leadListId } = await setup();
  await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  await authorizeDm(t, args, claim);
  await t.run(ctx => ctx.db.patch(claim.leadId, { dmStartedAt: undefined, dmStartedDate: undefined, dmEligible: true }));
  const other = await t.mutation(api.leads.createList, { name: 'Other purpose' });
  await t.run(async ctx => {
    await ctx.db.patch(automation._id, { routine: { ...automation.routine!, leadListId: undefined, message: '', outreachRoutes: [
      { leadListId, profileIds: [profile._id], message: 'First {{username}}' },
      { leadListId: other, profileIds: [profile._id], message: 'Second {{username}}' },
    ] } });
  });
  expect(await reserveFollow(t, args)).toBeNull();
  expect(await t.query(internal.routines.target, args)).toEqual({ target: 0, remaining: 0, sent: 0 });
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([]);
  expect(await t.mutation(internal.routines.beginSend, { ...args, leadId: claim.leadId, date: claim.date })).toBe(false);
  await t.mutation(api.automations.mutations.setActive, { id: automation._id, isActive: false });
  await expect(t.mutation(api.automations.mutations.setActive, { id: automation._id, isActive: true })).rejects.toThrow('Use one scraped list per automation');
});

test('empty lists cannot claim leads; unassigned profiles do not reserve or report targets', async () => {
  const { t, args, loggedIn, profile, automation, leadListId } = await setup();
  await loggedIn();
  const empty = await t.mutation(api.leads.createList, { name: 'Empty' });
  const routine = { ...automation.routine!, leadListId: undefined, outreachRoutes: [
    { leadListId: empty, profileIds: [profile._id], message: 'Empty' },
  ] };
  await t.run(ctx => ctx.db.patch(automation._id, { routine }));
  expect(await reserveFollow(t, args)).toBeNull();
  routine.outreachRoutes = [{ leadListId, profileIds: [profile._id], message: 'Available' }];
  await t.run(ctx => ctx.db.patch(automation._id, { routine }));
  const claim = (await reserveFollow(t, args))!;
  expect(claim.message).toBe('Available');
  expect(await t.mutation(internal.routines.beginFollow, { ...args, leadId: claim.leadId, date: claim.date })).toBe(true);
  await t.run(ctx => ctx.db.patch(automation._id, { routine: { ...routine, outreachRoutes: routine.outreachRoutes.map(route => ({ ...route, profileIds: [] })) } }));
  expect(await t.mutation(internal.routines.beginFollow, { ...args, leadId: claim.leadId, date: claim.date })).toBe(false);
  expect(await reserveFollow(t, args)).toBeNull();
  expect(await t.query(internal.routines.target, args)).toEqual({ target: 0, remaining: 0, sent: 0 });
  expect((await t.query(api.routines.accounts, { automationId: automation._id }))[0].allowance).toBe(0);
});

test('assignment validation prevents foreign profiles and multiple scraped lists', async () => {
  const { t, automation, profile, leadListId } = await setup();
  await t.mutation(api.automations.mutations.setActive, { id: automation._id, isActive: false });
  const foreign = (await seedProfile(t, { name: 'Outside model' }))!;
  const routine = { ...automation.routine!, leadListId: undefined, outreachRoutes: [{ leadListId, profileIds: [foreign._id], message: 'Hi' }] };
  await expect(t.mutation(api.automations.mutations.update, { id: automation._id, routine })).rejects.toThrow('Assigned profiles must belong');
  const route = { leadListId, profileIds: [profile._id], message: 'Hi' };
  const other = await t.mutation(api.leads.createList, { name: 'Other purpose' });
  for (const second of [route, { ...route, leadListId: other }]) {
    const invalid = { ...routine, outreachRoutes: [route, second] };
    await expect(t.mutation(api.automations.mutations.update, { id: automation._id, routine: invalid })).rejects.toThrow('Use one scraped list per automation');
    await expect(t.mutation(api.automations.mutations.create, { name: 'Invalid', nodes: [], edges: [], listIds: automation.listIds, routine: invalid })).rejects.toThrow('Use one scraped list per automation');
  }
  await expect(t.mutation(api.automations.mutations.update, { id: automation._id, routine: { ...routine, outreachRoutes: [route] } })).resolves.toBeTruthy();
});

test('blocked DMs do not release follow slots or permit a DM retry', async () => {
  const { t, args, loggedIn, profile } = await setup(); await loggedIn();
  const first = (await reserveFollow(t, args))!;
  await authorizeDm(t, args, first);
  const blocked = { profileId: profile._id, leadId: first.leadId, date: first.date, sent: false, blocked: true };
  await t.mutation(internal.routines.finishSend, blocked);
  await t.mutation(internal.routines.finishSend, blocked);
  expect(await t.query(internal.routines.target, args)).toEqual({ target: 2, remaining: 1, sent: 1 });
  expect(await t.mutation(internal.routines.beginSend, { ...args, leadId: first.leadId, date: first.date })).toBe(false);
  for (let i = 0; i < 1; i++) {
    const claim = (await reserveFollow(t, args))!;
    expect(claim.leadId).not.toBe(first.leadId);
    await authorizeDm(t, args, claim);
    const finish = { profileId: profile._id, leadId: claim.leadId, date: claim.date, sent: true };
    await t.mutation(internal.routines.finishSend, finish);
    await t.mutation(internal.routines.finishSend, finish);
  }
  expect(await t.query(internal.routines.target, args)).toEqual({ target: 2, remaining: 0, sent: 2 });
  expect(await reserveFollow(t, args)).toBeNull();
});

test('uncertain sends remain reserved and show as an incomplete target when time is exhausted', async () => {
  const { t, args, loggedIn, profile } = await setup(); await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  await authorizeDm(t, args, claim);
  await t.mutation(internal.routines.finishSend, { profileId: profile._id, leadId: claim.leadId, date: claim.date, sent: false });
  await t.run(ctx => putWarmup(ctx, {
    profileId: profile._id, date: dayKey(), day: 8, runsToday: 1, todayMinutes: 5, minutesUsedToday: 5, updatedAt: Date.now(),
  }));
  const row = (await t.query(api.routines.accounts, { automationId: args.automationId }))[0];
  expect(row).toMatchObject({ used: 1, sent: 0, allowance: 2, budgetExhausted: true });
  expect(row.issue).toContain('could not be confirmed');
  expect(await t.query(internal.routines.ready, args)).toBe(false);
});

test('saved routines with a fixed daily increase still load and use random growth', async () => {
  const { t, args, loggedIn, profile, automation } = await setup();
  await loggedIn();
  await t.run(ctx => ctx.db.patch(automation._id, {
    routine: { ...automation.routine!, dailyIncrease: 35 },
  }));
  const claim = (await reserveFollow(t, args))!;
  await t.mutation(internal.routines.recordFollow, {
    profileId: profile._id, leadId: claim.leadId, followed: true,
  });
  const state = await t.run(async ctx => (await ctx.db.query('accountProgress').collect())[0]);
  expect(state.allowance).toBe(2);
  expect(state.followIncrease).toBeGreaterThanOrEqual(1);
  expect(state.followIncrease).toBeLessThanOrEqual(4);
});

// Create a previously followed recipient for delivery-specific regression cases.
async function authorizeDm(t: ReturnType<typeof createConvexTest>, args: { automationId: Id<'automations'>; profileId: Id<'profiles'> }, claim: { leadId: Id<'leads'>; date: string }) {
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: claim.leadId, followed: true });
  await t.run(ctx => ctx.db.patch(claim.leadId, { followDate: Date.now() - 86_400_000, dmEligible: true }));
  expect(await t.mutation(internal.routines.beginSend, { ...args, leadId: claim.leadId, date: claim.date })).toBe(true);
}

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
  await t.run(ctx => putWarmup(ctx, { profileId: profile._id, day: 8, date: dayKey(), runsToday: 1,
    todayMinutes: 30, minutesUsedToday: 0, updatedAt: Date.now() }));
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

async function putWarmup(ctx: MutationCtx, value: Omit<Doc<'warmupStates'>, '_id' | '_creationTime'>) {
  const existing = await ctx.db.query('warmupStates').withIndex('by_profile', q => q.eq('profileId', value.profileId)).unique();
  if (existing) { await ctx.db.patch(existing._id, value); return existing._id; }
  return ctx.db.insert('warmupStates', value);
}

test('model browsing starts the next Kyiv day while outreach waits for mobile login', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-26T20:30:00Z'));
  const { t, profile, args } = await setup();
  const accountId = await t.run(async (ctx) => {
    const id = await ctx.db.insert('igAccounts', {
      ciphertext: 'encrypted', usernameHash: 'account-for-routine', status: 'assigned',
      profileId: profile._id, createdAt: Date.now(),
    });
    await ctx.db.patch(profile._id, { igAccountId: id, igLoggedIn: true,
      outreachReady: true });
    return id;
  });
  expect(await t.query(internal.routines.ready, { ...args, checkpoint: true })).toBe(false);
  await t.run((ctx) => ctx.db.patch(accountId, { browserLoggedInAt: Date.now() }));
  expect(await t.query(internal.routines.ready, args)).toBe(false);
  expect(await t.query(internal.routines.ready, { ...args, checkpoint: true })).toBe(false);
  expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0]?.stage)
    .toBe('Browser logged in');

  vi.setSystemTime(new Date('2026-09-26T21:30:00Z'));
  expect(await t.query(internal.routines.ready, args)).toBe(true);
  expect(await t.query(internal.routines.ready, { ...args, checkpoint: true })).toBe(true);
  expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0])
    .toMatchObject({ stage: 'Warm-up', allowance: 0 });
  expect(await t.query(internal.routines.target, args)).toEqual({ target: 0, remaining: 0, sent: 0 });
  expect(await reserveFollow(t, args)).toBeNull();

  const session = await t.mutation(internal.warmup.mutations.beginRunInternal, {
    profileId: profile._id, automationId: String(args.automationId), runId: 'day-two',
    minMinutes: 30, maxMinutes: 60, sessionMinMinutes: 5, sessionMaxMinutes: 10,
    restMinMinutes: 60, restMaxMinutes: 120,
  });
  expect(session.minutes).toBeGreaterThanOrEqual(5);
  expect(session.minutes).toBeLessThanOrEqual(10);
  expect(session.remainingMinutes).toBeGreaterThanOrEqual(30);
  await t.run((ctx) => ctx.db.patch(accountId, { status: 'connected' }));
  expect(await t.query(internal.routines.ready, { ...args, checkpoint: true })).toBe(true);
  expect((await t.query(internal.routines.target, args)).target).toBeGreaterThan(0);
});

test('a copied model automation needs a different model before enabling', async () => {
  const { t, automation, list } = await setup();
  const copy = await t.mutation(api.automations.mutations.duplicate, { id: automation._id });
  expect(copy?.listIds).toEqual([]);
  await expect(t.mutation(api.automations.mutations.setActive, {
    id: copy!._id, isActive: true,
  })).rejects.toThrow('Select exactly one model');
  const other = (await seedList(t, 'Other model'))!;
  await expect(t.mutation(api.automations.mutations.update, {
    id: copy!._id, listIds: [list._id, other._id],
  })).rejects.toThrow('Select exactly one model');
  await t.mutation(api.automations.mutations.update, { id: copy!._id, listIds: [other._id] });
  expect((await t.mutation(api.automations.mutations.setActive, {
    id: copy!._id, isActive: true,
  }))?.isActive).toBe(true);
});


test('classified male leads are claimed exactly once', async () => {
  const { t, args, loggedIn, leadListId } = await setup();
  expect(await reserveFollow(t, args)).toBeNull();
  await loggedIn();
  const claims = await Promise.all([reserveFollow(t, args), reserveFollow(t, args)]);
  expect(claims[0]).not.toBeNull(); expect(claims[1]).not.toBeNull();
  expect(claims[0]!.leadId).not.toBe(claims[1]!.leadId);
  expect(await reserveFollow(t, args)).toBeNull();
  const lead = (await readLeads(t)).find(l => l._id === claims[0]!.leadId)!;
  expect(lead).toMatchObject({ senderId: args.profileId, dmSent: false, followed: false });
  const membership = await t.run(ctx => ctx.db.query('leadMemberships')
    .withIndex('by_lead_list', q => q.eq('leadId', lead._id).eq('listId', leadListId)).first());
  expect(membership?.available).toBe(false);
  for (const removed of ['source', 'status', 'delivery', 'followPending', 'updatedAt']) expect(lead).not.toHaveProperty(removed);
});

test('interrupted claims remain skipped after restart and issue clearing', async () => {
  const { t, args, loggedIn, profile } = await setup(); await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  await authorizeDm(t, args, claim);
  await t.mutation(internal.routines.finishSend, { profileId: profile._id, leadId: claim.leadId, date: claim.date, sent: false });
  expect(await t.query(internal.routines.ready, args)).toBe(false);
  await t.mutation(internal.automations.mutations.reconcileInterruptedInternal, {});
  await t.mutation(api.routines.setAccount, { profileId: profile._id, clearIssue: true });
  const next = (await reserveFollow(t, args))!;
  expect(next.leadId).not.toBe(claim.leadId);
  expect((await readLeads(t)).find(l => l._id === claim.leadId)).toMatchObject({ dmSent: false, senderId: profile._id });
});

test('sender, membership and date checks gate interaction; confirmed sends are idempotent', async () => {
  const { t, args, loggedIn, profile, list } = await setup(); await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  const check = { ...args, leadId: claim.leadId, date: claim.date };
  expect(await t.mutation(internal.routines.beginSend, check)).toBe(false);
  await authorizeDm(t, args, claim);
  expect(await t.mutation(internal.routines.beginSend, { ...check, date: '2000-01-01' })).toBe(false);
  await t.mutation(api.profiles.mutations.bulkRemoveFromList, { profileIds: [profile._id], listId: list._id });
  expect(await t.mutation(internal.routines.beginSend, check)).toBe(false);
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
  const claim = (await reserveFollow(t, args))!;
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
  expect((await reserveFollow(t, args))?.leadId).not.toBe(claim.leadId);
});

test.each([0, 0.999])('random unfollow deadlines are saved and enforced (random=%s)', async random => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
  const { t, args, loggedIn, profile, automation } = await setup(); await loggedIn();
  await t.run(ctx => ctx.db.patch(automation._id, { routine: {
    ...automation.routine!, unfollowMinDays: 3, unfollowMaxDays: 10,
  } }));
  const rng = vi.spyOn(Math, 'random').mockReturnValue(random);
  const claim = (await reserveFollow(t, args))!;
  rng.mockRestore();
  const days = random === 0 ? 3 : 10;
  const follow = { profileId: profile._id, leadId: claim.leadId, followed: true };
  await t.mutation(internal.routines.recordFollow, follow);
  const followDate = Date.now();
  const unfollowAt = followDate + days * 86_400_000;
  await t.run(ctx => ctx.db.patch(automation._id, { routine: {
    ...automation.routine!, unfollowMinDays: 1, unfollowMaxDays: 1,
  } }));
  vi.setSystemTime(unfollowAt - 1);
  await t.mutation(internal.routines.recordFollow, follow);
  expect((await readLeads(t)).find(l => l._id === claim.leadId))
    .toMatchObject({ followDate, unfollowDays: days, unfollowAt });
  expect(await t.query(internal.routines.followTasks, args)).toEqual([]);
  await expect(t.mutation(internal.routines.recordFollow, { ...follow, followed: false })).rejects.toThrow('not due');
  vi.setSystemTime(unfollowAt);
  expect(await t.query(internal.routines.followTasks, args)).toEqual([{ leadId: claim.leadId, username: claim.username }]);
  await t.mutation(internal.routines.recordFollow, { ...follow, followed: false });
  expect(await t.query(internal.routines.followTasks, args)).toEqual([]);
});

test('existing follows without saved deadlines still become due after seven days', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
  const { t, args, loggedIn, profile } = await setup(); await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  const followDate = Date.now();
  await t.run(ctx => ctx.db.patch(claim.leadId, { followed: true, followDate, unfollowDays: undefined }));
  const follow = { profileId: profile._id, leadId: claim.leadId, followed: false };
  vi.setSystemTime(followDate + 7 * 86_400_000 - 1);
  expect(await t.query(internal.routines.followTasks, args)).toEqual([]);
  await expect(t.mutation(internal.routines.recordFollow, follow)).rejects.toThrow('not due');
  vi.setSystemTime(followDate + 7 * 86_400_000);
  expect(await t.query(internal.routines.followTasks, args)).toHaveLength(1);
  await t.mutation(internal.routines.recordFollow, follow);
});

test.each([
  { unfollowMinDays: 0 }, { unfollowMaxDays: 366 },
  { unfollowMinDays: 8, unfollowMaxDays: 3 }, { unfollowMinDays: 1.5 },
  { warmupMinPosts: 0 }, { warmupMinPosts: 2 }, { warmupMaxPosts: 101 },
  { warmupMinPosts: 6, warmupMaxPosts: 3 }, { warmupMinPosts: Number.NaN },
])('invalid random ranges are rejected: %j', patch => {
  expect(() => validateRoutine({ ...defaultRoutine, ...patch })).toThrow(/Unfollow days|Post target/);
});

test('a followed lead cannot receive a same-day DM and stays claimed after unfollow', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
  const { t, args, loggedIn, profile } = await setup(); await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  const check = { ...args, leadId: claim.leadId, date: claim.date };

  await t.mutation(internal.routines.recordFollow, {
    profileId: profile._id, leadId: claim.leadId, followed: true,
  });
  await t.mutation(internal.routines.recordNotifications, { ...args, date: claim.date, usernames: [claim.username] });
  expect(await t.mutation(internal.routines.beginSend, check)).toBe(false);
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([]);

  vi.setSystemTime(Date.now() + 7 * 86400000);
  await t.mutation(internal.routines.recordFollow, {
    profileId: profile._id, leadId: claim.leadId, followed: false,
  });
  const lead = (await readLeads(t)).find(l => l._id === claim.leadId)!;
  expect(lead).toMatchObject({ senderId: profile._id, dmSent: false, followed: false });
  expect((await reserveFollow(t, args))?.leadId).not.toBe(claim.leadId);
});

test('a blocked DM stays unsent without stopping the sender account', async () => {
  const { t, args, loggedIn, profile } = await setup(); await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  await authorizeDm(t, args, claim);
  await t.mutation(internal.routines.finishSend, {
    profileId: profile._id,
    leadId: claim.leadId,
    date: claim.date,
    sent: false,
    blocked: true,
  });
  const lead = (await readLeads(t)).find(l => l._id === claim.leadId)!;
  expect(lead).toMatchObject({ senderId: profile._id, dmSent: false, followed: true });
  expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0]?.issue).toBeUndefined();
});

test('DM and follow flags independently exclude unassigned leads', async () => {
  const { t, args, loggedIn, leads } = await setup(); await loggedIn();
  await t.run(async ctx => { await ctx.db.patch(leads[0]._id, { dmSent: true }); await ctx.db.patch(leads[1]._id, { followed: true }); });
  const claim = (await reserveFollow(t, args))!;
  expect([leads[0]._id, leads[1]._id]).not.toContain(claim.leadId);
});

test('daily allowance grows only after confirmed outreach days', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
  const { t, args, loggedIn } = await setup(); await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: claim.leadId, followed: true });
  vi.setSystemTime(new Date('2026-09-26T10:00:00Z'));
  await reserveFollow(t, args);
  expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0]).toMatchObject({ used: 1, allowance: 3 });
});
test("one automation owns each model; moving a profile changes its automation", async () => {
  const { t, list, profile } = await setup();
  const secondList = (await seedList(t, "Second"))!;
  await expect(t.mutation(api.automations.mutations.create, {
    name: "Duplicate model", nodes: [], edges: [], listIds: [list._id], routine: defaultRoutine,
  })).rejects.toThrow('already has an automation');
  const second = (await t.mutation(api.automations.mutations.create, {
    name: "Second",
    nodes: [],
    edges: [],
    listIds: [secondList._id],
    routine: defaultRoutine,
  }))!;
  await expect(t.mutation(api.automations.mutations.update, {
    id: second._id, listIds: [list._id],
  })).rejects.toThrow('already has an automation');
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

test('moving between models preserves account progress, warm-up budgets, and follow history', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
  const { t, args, profile, list, automation, loggedIn } = await setup();
  await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  await t.mutation(internal.routines.recordFollow, { profileId: profile._id, leadId: claim.leadId, followed: true });
  const restUntil = Date.now() + 60 * 60_000;
  const ids = await t.run(async ctx => {
    const progress = (await ctx.db.query('accountProgress').withIndex('by_profile', q => q.eq('profileId', profile._id)).unique())!;
    await ctx.db.patch(progress._id, { activeDays: 18, followIncrease: 10, nextRunAt: restUntil, lastNotificationsDate: dayKey(), lastNotificationsAt: Date.now() });
    const warmup = await putWarmup(ctx, {
      profileId: profile._id, day: 18, date: dayKey(), runsToday: 2,
      todayMinutes: 30, minutesUsedToday: 12, nextRunAt: restUntil,
      recentRunIds: ['completed-run'], lastAutomationId: automation._id, updatedAt: Date.now(),
    });
    return { progress: progress._id, warmup };
  });
  const snapshot = () => t.run(async ctx => ({
    progress: await ctx.db.get(ids.progress), warmup: await ctx.db.get(ids.warmup), lead: await ctx.db.get(claim.leadId),
  }));
  const before = await snapshot();
  const destination = (await seedList(t, 'Destination model'))!;
  const next = (await t.mutation(api.automations.mutations.create, {
    name: 'Destination automation', nodes: [], edges: [], listIds: [destination._id], routine: automation.routine,
  }))!;
  await t.mutation(api.automations.mutations.setActive, { id: next._id, isActive: true });
  await t.mutation(api.profiles.mutations.bulkRemoveFromList, { profileIds: [profile._id], listId: list._id });
  expect(await snapshot()).toEqual(before);
  await t.mutation(api.profiles.mutations.bulkAddToList, { profileIds: [profile._id], listId: destination._id });
  await t.mutation(internal.igAccounts.modelSetupEnrollInternal, { profileId: profile._id, modelId: destination._id, startedAt: Date.now() });
  expect(await snapshot()).toEqual(before);
  await loggedIn();
  const nextArgs = { ...args, automationId: next._id };
  expect((await t.query(api.routines.accounts, { automationId: next._id }))[0]).toMatchObject({ activeDays: 18, followed: 1, used: 1, allowance: 2, nextRunAt: restUntil });
  expect(await t.query(internal.routines.ready, nextArgs)).toBe(false);
  expect(await t.mutation(internal.warmup.mutations.beginRunInternal, {
    profileId: profile._id, automationId: next._id, runId: 'destination-run', minMinutes: 30, maxMinutes: 30,
    sessionMinMinutes: 5, sessionMaxMinutes: 5, restMinMinutes: 60, restMaxMinutes: 60,
  })).toEqual({ date: dayKey(), minutes: 0 });
  expect(await snapshot()).toEqual(before);
});

test('session progress preserves fractional stored rest deadlines as integer milliseconds', async () => {
  const { t, args, profile } = await setup();
  const nextRunAt = Date.now() + 60_000.25;
  await t.run(ctx => putWarmup(ctx, {
    profileId: profile._id, day: 1, date: dayKey(), runsToday: 1,
    todayMinutes: 30, minutesUsedToday: 5, nextRunAt, updatedAt: Date.now(),
  }));
  await t.mutation(internal.routines.recordSession, { ...args, activityCompleted: false });
  const state = await t.run(ctx => ctx.db.query('accountProgress').withIndex('by_profile', q => q.eq('profileId', profile._id)).unique());
  expect(state?.nextRunAt).toBe(Math.ceil(nextRunAt));
});

test.each([
  'goto: Timeout 45000ms exceeded.',
  'Network timeout',
  'page.goto: net::ERR_PROXY_CONNECTION_FAILED',
  'page.goto: net::ERR_PROXY_CONNECTION_FAILED at https://www.instagram.com/accounts/login/',
  'goto: Timeout 45000ms exceeded.\nCall log:\n  - navigating to "https://www.instagram.com/accounts/login/", waiting until "domcontentloaded"',
  'page.goto: net::ERR_CONNECTION_RESET',
  'fetch failed',
  'Element "<ElementHandle>" failed visible check: element is not visible',
  'Element "<ElementHandle>" failed attached check: element not found in DOM',
  'Element "<ElementHandle>" failed pointer_events check: element is covered by <div>',
  'Element is not attached to the DOM',
  'Action target is detached or missing',
])('transient session failure retries after a cooldown: %s', async issue => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    const { t, args, profile, loggedIn } = await setup();
    await loggedIn();
    // A failed browser open must not reuse an expired rest deadline or yesterday's budget.
    await t.run(ctx => putWarmup(ctx, {
      profileId: profile._id, day: 16, date: '2026-10-08', runsToday: 3,
      todayMinutes: 25, minutesUsedToday: 25, nextRunAt: Date.now() - 60_000, updatedAt: Date.now() - 60_000,
    }));
    const retryAt = Date.now() + ROUTINE_RETRY_MS;
    await t.mutation(internal.routines.recordSession, { ...args, activityCompleted: false, issue });
    const row = (await t.query(api.routines.accounts, { automationId: args.automationId }))[0];
    expect(row.issue).toBeUndefined();
    expect(row.nextRunAt).toBe(retryAt);
    expect(await t.query(internal.routines.ready, args)).toBe(false);
    vi.setSystemTime(retryAt - 1);
    expect(await t.query(internal.routines.ready, args)).toBe(false);
    vi.setSystemTime(retryAt);
    expect(await t.query(internal.routines.ready, args)).toBe(true);
    expect((await t.run(ctx => ctx.db.get(profile._id)))?.igLoggedIn).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('retry cooldown preserves a longer rest and resets after another failure', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    const { t, args, profile, loggedIn } = await setup();
    await loggedIn();
    const restAt = Date.now() + 60 * 60_000;
    await t.run(ctx => putWarmup(ctx, {
      profileId: profile._id, day: 1, date: dayKey(), runsToday: 1,
      todayMinutes: 25, minutesUsedToday: 5, nextRunAt: restAt, updatedAt: Date.now(),
    }));
    await t.mutation(internal.routines.recordSession, { ...args, activityCompleted: false, issue: 'Network timeout' });
    expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0].nextRunAt).toBe(restAt);
    vi.setSystemTime(restAt);
    await t.mutation(internal.routines.recordSession, { ...args, activityCompleted: false, issue: 'Network timeout' });
    expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0].nextRunAt).toBe(restAt + ROUTINE_RETRY_MS);
  } finally {
    vi.useRealTimers();
  }
});

test.each(['goto: Timeout 45000ms exceeded.', 'Element "<ElementHandle>" failed visible check: element is not visible', 'Browser worker stopped'])(
  'saved navigation failures recover through HTTP readiness and runtime snapshots: %s', async issue => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    vi.stubGlobal('process', { env: { INTERNAL_API_KEY: 'bridge-secret' } });
    const { t, args, profile, list, loggedIn } = await setup();
    await loggedIn();
    await t.mutation(internal.routines.recordSession, { ...args, activityCompleted: false });
    const retryAt = Date.now() + ROUTINE_RETRY_MS;
    await t.run(async ctx => {
      const state = (await ctx.db.query('accountProgress').withIndex('by_profile', q => q.eq('profileId', profile._id)).unique())!;
      await ctx.db.patch(state._id, { issue, nextRunAt: Date.now() - 60_000 });
    });
    const snapshot = await t.query(api.automations.queries.runtimeSnapshot, {
      bridgeToken: 'bridge-secret', id: args.automationId, listIds: [String(list._id)],
    });
    expect(snapshot?.progress?.[0]).toMatchObject({ nextRunAt: retryAt });
    expect(snapshot?.progress?.[0].issue).toBeUndefined();
    expect(await t.query(internal.routines.ready, args)).toBe(false);
    vi.setSystemTime(retryAt);
    expect(await t.query(internal.routines.ready, args)).toBe(true);
    await t.mutation(internal.routines.recordSession, { ...args, activityCompleted: false });
    const saved = await t.run(ctx => ctx.db.query('accountProgress').withIndex('by_profile', q => q.eq('profileId', profile._id)).unique());
    expect(saved?.issue).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

test.each([
  'Login required',
  'Login required: Network timeout',
  'Challenge required',
  'Checkpoint required',
  'Delivery needs review: Timeout 15000ms exceeded.',
  'Unexpected application error',
  'Element "<ElementHandle>" failed enabled check: element is disabled',
  'Login required: Element "<ElementHandle>" failed visible check: element is not visible',
  'page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://www.instagram.com/',
  'page.goto: net::ERR_CERT_DATE_INVALID',
  'page.goto: net::ERR_CERT_COMMON_NAME_INVALID',
  'page.goto: net::ERR_SSL_PROTOCOL_ERROR',
])('account, delivery, and unknown issues remain blocked: %s', async issue => {
  const { t, args, loggedIn } = await setup();
  await loggedIn();
  await t.mutation(internal.routines.recordSession, { ...args, activityCompleted: false, issue });
  expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0].issue).toBe(issue);
  expect(await t.query(internal.routines.ready, { ...args, now: Date.now() + 24 * 60 * 60_000 })).toBe(false);
});

test('session results do not clear or overwrite unconfirmed deliveries', async () => {
  const { t, args, profile, loggedIn } = await setup();
  await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  await authorizeDm(t, args, claim);
  await t.mutation(internal.routines.finishSend, { profileId: profile._id, leadId: claim.leadId, date: claim.date, sent: false });
  for (const issue of ['Network timeout', undefined]) {
    await t.mutation(internal.routines.recordSession, { ...args, activityCompleted: false, issue });
    expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0].issue).toContain('Delivery could not be confirmed');
    expect(await t.query(internal.routines.ready, args)).toBe(false);
  }
});

test.each(['Login required', 'Challenge required', 'Checkpoint required', 'Network timeout'])('session issue updates chat eligibility: %s', async issue => {
  const { t, args, loggedIn, profile } = await setup();
  await loggedIn();
  await t.run(ctx => ctx.db.insert('chatCounters', {
    profileId: profile._id, token: 'session', enabled: true,
    unreadCount: 2, unreadThreadIds: ['1', '2'],
  }));
  await t.mutation(internal.routines.recordSession, { ...args, activityCompleted: false, issue });
  const needsLogin = issue !== 'Network timeout';
  expect((await t.run(ctx => ctx.db.get(profile._id)))?.igLoggedIn).toBe(!needsLogin);
  expect(await t.query(api.chatCache.unreadCount)).toBe(needsLogin ? 0 : 2);
  await loggedIn();
  expect(await t.query(api.chatCache.unreadCount)).toBe(2);
});

test("completed daily browsing advances once; removing and readding profiles preserves progress", async () => {
  const { t, args, profile, list, loggedIn } = await setup();
  await loggedIn();
  await t.run((ctx) =>
    putWarmup(ctx, {
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

test('daily follow-back discovery enables next-day DMs independently of follow quota', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
    const { t, args, profile, loggedIn } = await setup(); await loggedIn();
    await t.mutation(api.analytics.initialize, {});
    const claims = [];
    for (let i = 0; i < 2; i++) {
      const claim = (await reserveFollow(t, args))!;
      claims.push(claim);
      await t.mutation(internal.routines.recordFollow, { profileId: profile._id, leadId: claim.leadId, followed: true });
    }
    expect(await t.query(internal.routines.notifications, args)).toBeNull();
    expect(await t.query(internal.routines.dmTasks, args)).toEqual([]);
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
    expect(await t.query(internal.routines.notifications, args)).toMatchObject({ date: dayKey() });
    await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), usernames: [claims[0].username, claims[1].username, 'stranger', claims[0].username] });
    expect(await t.query(internal.routines.notifications, args)).toBeNull();
    const tasks = await t.query(internal.routines.dmTasks, args);
    expect(tasks).toHaveLength(2);
    const before = await t.query(internal.routines.target, args);
    for (const task of tasks) {
      const input = { ...args, leadId: task.leadId, date: task.date };
      expect(await t.mutation(internal.routines.beginSend, input)).toBe(true);
      expect(await t.mutation(internal.routines.beginSend, input)).toBe(false);
      const finish = { profileId: profile._id, leadId: task.leadId, date: task.date, sent: true };
      await t.mutation(internal.routines.finishSend, finish);
      await t.mutation(internal.routines.finishSend, finish);
    }
    expect(await t.query(internal.routines.target, args)).toEqual(before);
    expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0]).toMatchObject({ followed: 0, sent: 2 });
    expect((await t.run(ctx => ctx.db.query('analyticsHistory').unique()))?.totals).toMatchObject({ follows: 2, dms: 2 });
    expect((await t.query(api.analytics.overview, { date: dayKey(), period: 'today' })).totals).toMatchObject({ follows: 0, dms: 2 });
    expect((await t.query(api.analytics.overview, { date: dayKey(), period: '7days' })).totals).toMatchObject({ follows: 2, dms: 2 });
    expect(await t.query(internal.routines.dmTasks, args)).toEqual([]);
  } finally { vi.useRealTimers(); }
});

test('daily notification completion is reset next day; stale completion is ignored', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
    const { t, args, loggedIn } = await setup(); await loggedIn();
    const claim = (await reserveFollow(t, args))!;
    await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: claim.leadId, followed: true });
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
    await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), usernames: [] });
    expect(await t.query(internal.routines.notifications, args)).toBeNull();
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    await t.mutation(internal.routines.recordNotifications, { ...args, date: '2026-10-12', usernames: [claim.username] });
    expect(await t.query(internal.routines.notifications, args)).toMatchObject({ date: dayKey() });
    expect(await t.query(internal.routines.dmTasks, args)).toEqual([]);
  } finally { vi.useRealTimers(); }
});

test.each(['expired', 'unfollowed', 'paused', 'route removed', 'automation disabled'])('DM authorization rejects %s recipients', async reason => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
    const { t, args, loggedIn, automation } = await setup(); await loggedIn();
    const claim = (await reserveFollow(t, args))!;
    await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: claim.leadId, followed: true });
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
    await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), usernames: [claim.username] });
    const [task] = await t.query(internal.routines.dmTasks, args);
    expect(task).toBeDefined();
    if (reason === 'expired') await t.run(ctx => ctx.db.patch(claim.leadId, { unfollowAt: Date.now() }));
    if (reason === 'unfollowed') await t.run(ctx => ctx.db.patch(claim.leadId, { followed: false }));
    if (reason === 'paused') await t.mutation(api.routines.setAccount, { profileId: args.profileId, paused: true });
    if (reason === 'route removed') await t.run(ctx => ctx.db.patch(automation._id, { routine: { ...automation.routine!, outreachRoutes: [] } }));
    if (reason === 'automation disabled') await t.mutation(api.automations.mutations.setActive, { id: automation._id, isActive: false });
    expect(await t.mutation(internal.routines.beginSend, { ...args, leadId: task.leadId, date: task.date })).toBe(false);
    expect(await t.query(internal.routines.dmTasks, args)).toEqual([]);
  } finally { vi.useRealTimers(); }
});

test('notification events for other senders and non-followed leads do not enable DMs', async () => {
  const { t, args, loggedIn, leads } = await setup(); await loggedIn();
  const other = (await seedProfile(t, { name: 'Other' }))!;
  await t.run(async ctx => {
    await ctx.db.patch(leads[0]._id, { senderId: other._id, followed: true, followDate: Date.now() - 86_400_000, unfollowAt: Date.now() + 86_400_000 });
    await ctx.db.patch(leads[1]._id, { senderId: args.profileId, followed: false, followDate: Date.now() - 86_400_000 });
  });
  await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), usernames: leads.map(lead => lead.username) });
  expect((await readLeads(t)).some(lead => lead.dmEligible)).toBe(false);
});

test('a delivery result cannot be recorded without a one-time authorization', async () => {
  const { t, args, loggedIn } = await setup(); await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  await expect(t.mutation(internal.routines.finishSend, { profileId: args.profileId, leadId: claim.leadId, date: claim.date, sent: true })).rejects.toThrow('not authorized');
  expect((await readLeads(t)).find(lead => lead._id === claim.leadId)?.dmSent).toBe(false);
});

test('a recipient that no longer follows us waits for another daily discovery', async () => {
  const { t, args, loggedIn } = await setup(); await loggedIn();
  const claim = (await reserveFollow(t, args))!;
  await t.run(ctx => ctx.db.patch(claim.leadId, { followed: true, followDate: Date.now() - 86_400_000, unfollowAt: Date.now() + 86_400_000, dmEligible: true }));
  await t.mutation(internal.routines.dismissDm, { profileId: args.profileId, leadId: claim.leadId });
  expect(await t.query(internal.routines.dmTasks, args)).toEqual([]);
  await t.mutation(internal.routines.recordNotifications, { ...args, date: dayKey(), usernames: [claim.username] });
  expect(await t.query(internal.routines.dmTasks, args)).toHaveLength(1);
});

test('a lost follow confirmation retains cleanup intent and is never followed twice', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
    const { t, args, loggedIn } = await setup(); await loggedIn();
    const claim = (await reserveFollow(t, args))!;
    const input = { ...args, leadId: claim.leadId, date: claim.date };
    expect(await t.mutation(internal.routines.beginFollow, input)).toBe(true);
    expect(await t.mutation(internal.routines.beginFollow, input)).toBe(false);
    expect((await readLeads(t)).find(lead => lead._id === claim.leadId)?.followed).toBe(false);
    expect(await t.query(internal.routines.dmTasks, args)).toEqual([]);
    vi.setSystemTime(Date.now() + 7 * 86_400_000);
    expect(await t.query(internal.routines.followTasks, args)).toEqual([{ leadId: claim.leadId, username: claim.username }]);
    await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: claim.leadId, followed: false });
    expect(await t.query(internal.routines.followTasks, args)).toEqual([]);
  } finally { vi.useRealTimers(); }
});

test('follow confirmation is idempotent and retains the deadline saved before the click', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
    const { t, args, loggedIn } = await setup(); await loggedIn();
    const claim = (await reserveFollow(t, args))!;
    await t.mutation(internal.routines.beginFollow, { ...args, leadId: claim.leadId, date: claim.date });
    const started = Date.now();
    vi.setSystemTime(started + 5000);
    const follow = { profileId: args.profileId, leadId: claim.leadId, followed: true };
    await t.mutation(internal.routines.recordFollow, follow);
    await t.mutation(internal.routines.recordFollow, follow);
    expect((await readLeads(t)).find(lead => lead._id === claim.leadId)).toMatchObject({ followDate: started, unfollowAt: started + 7 * 86_400_000 });
    expect((await t.query(api.routines.accounts, { automationId: args.automationId }))[0]).toMatchObject({ followed: 1, sent: 0 });
  } finally { vi.useRealTimers(); }
});

test('new follow ramp starts small independently of previous DM growth and claims', async () => {
  const { t, args, loggedIn } = await setup(); await loggedIn();
  await t.mutation(internal.routines.recordSession, { ...args, activityCompleted: false });
  await t.run(async ctx => {
    const state = (await ctx.db.query('accountProgress').collect())[0];
    await ctx.db.patch(state._id, { dmIncrease: 30, date: dayKey(), used: 30, allowance: 30, lastOutreachDate: dayKey() });
  });
  expect(await t.query(internal.routines.target, args)).toEqual({ target: 2, remaining: 2, sent: 0 });
  const claim = (await reserveFollow(t, args))!;
  expect(claim).not.toBeNull();
  await t.mutation(internal.routines.recordFollow, { profileId: args.profileId, leadId: claim.leadId, followed: true });
  const state = await t.run(async ctx => (await ctx.db.query('accountProgress').collect())[0]);
  expect(state.followIncrease).toBeGreaterThanOrEqual(1);
  expect(state.followIncrease).toBeLessThanOrEqual(4);
  expect(state.allowance).toBe(2);
});

// Existing follow/DM tests include the now-required browser-screening approval step.
async function reserveFollow(
  t: ReturnType<typeof createConvexTest>,
  args: { automationId: Id<'automations'>; profileId: Id<'profiles'> },
) {
  const claim = await t.mutation(internal.routines.reserve, args)
  if (!claim) return null
  const accepted = await t.mutation(internal.leadScreening.finish, {
    ...args,
    leadId: claim.leadId,
    date: claim.date,
    screeningToken: claim.screeningToken,
    category: 'male',
    confidence: 1,
  })
  return accepted ? claim : null
}

test.each(['male', 'female', 'business'] as const)(
  'pending leads are screened before %s assignment and quota charging',
  async (category) => {
    const { t, args, automation, loggedIn, leads } = await setup()
    await loggedIn()
    await t.run(async (ctx) => {
      await ctx.db.patch(automation._id, {
        routine: { ...automation.routine!, allowedCategories: [category] },
      })
      for (const lead of leads)
        await ctx.db.patch(lead._id, { classification: undefined, enrichmentStatus: 'pending' })
    })
    const claim = (await t.mutation(internal.routines.reserve, args))!
    expect(await t.run((ctx) => ctx.db.get(claim.leadId))).not.toHaveProperty('senderId')
    expect((await t.query(internal.routines.target, args)).remaining).toBe(2)
    expect(
      await t.mutation(internal.routines.beginFollow, {
        ...args,
        leadId: claim.leadId,
        date: claim.date,
      }),
    ).toBe(false)
    const completion = {
      ...args,
      leadId: claim.leadId,
      date: claim.date,
      screeningToken: claim.screeningToken,
      category,
      confidence: 0.4,
    }
    expect(await t.mutation(internal.leadScreening.finish, completion)).toBe(true)
    expect(await t.mutation(internal.leadScreening.finish, completion)).toBe(false)
    expect(await t.run((ctx) => ctx.db.get(claim.leadId))).toMatchObject({
      senderId: args.profileId,
      classification: category,
      enrichmentStatus: 'ready',
      enrichmentModel: 'openai/gpt-6-luna-decisions',
      enrichmentConfidence: 0.4,
    })
    expect((await t.query(internal.routines.target, args)).remaining).toBe(1)
    expect(
      await t.mutation(internal.routines.beginFollow, {
        ...args,
        leadId: claim.leadId,
        date: claim.date,
      }),
    ).toBe(true)
  },
)

test('a disallowed category consumes no quota and can be screened by an automation that allows it', async () => {
  const { t, args, automation, loggedIn } = await setup()
  await loggedIn()
  const claim = (await t.mutation(internal.routines.reserve, args))!
  const completion = {
    ...args,
    leadId: claim.leadId,
    date: claim.date,
    screeningToken: claim.screeningToken,
    category: 'female' as const,
    confidence: 0.95,
  }
  expect(await t.mutation(internal.leadScreening.finish, completion)).toBe(false)
  expect((await t.query(internal.routines.target, args)).remaining).toBe(2)
  await t.run(async (ctx) => {
    for (const lead of await ctx.db.query('leads').collect())
      if (lead._id !== claim.leadId) await ctx.db.patch(lead._id, { dmSent: true })
  })
  expect(await t.mutation(internal.routines.reserve, args)).toBeNull()
  await t.run((ctx) =>
    ctx.db.patch(automation._id, {
      routine: { ...automation.routine!, allowedCategories: ['female'] },
    }),
  )
  const retry = (await t.mutation(internal.routines.reserve, args))!
  expect(retry.leadId).toBe(claim.leadId)
  expect(
    await t.mutation(internal.leadScreening.finish, {
      ...completion,
      screeningToken: retry.screeningToken,
    }),
  ).toBe(true)
})

test('expired screening leases are recoverable and stale results cannot assign a lead', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  const { t, args, loggedIn } = await setup()
  await loggedIn()
  const claim = (await t.mutation(internal.routines.reserve, args))!
  await t.run(async (ctx) => {
    for (const lead of await ctx.db.query('leads').collect())
      if (lead._id !== claim.leadId) await ctx.db.patch(lead._id, { dmSent: true })
  })
  expect(await t.mutation(internal.routines.reserve, args)).toBeNull()
  vi.setSystemTime(Date.now() + 120_001)
  const next = (await t.mutation(internal.routines.reserve, args))!
  expect(next.leadId).toBe(claim.leadId)
  expect(next.screeningToken).not.toBe(claim.screeningToken)
  expect(
    await t.mutation(internal.leadScreening.finish, {
      ...args,
      leadId: claim.leadId,
      date: claim.date,
      screeningToken: claim.screeningToken,
      category: 'male',
      confidence: 1,
    }),
  ).toBe(false)
})

test('provider failures skip without assignment or quota consumption', async () => {
  const { t, args, loggedIn } = await setup()
  await loggedIn()
  const failed = (await t.mutation(internal.routines.reserve, args))!
  expect(
    await t.mutation(internal.leadScreening.finish, {
      ...args,
      leadId: failed.leadId,
      date: failed.date,
      screeningToken: failed.screeningToken,
    }),
  ).toBe(false)
  expect(await t.run((ctx) => ctx.db.get(failed.leadId))).toMatchObject({
    enrichmentStatus: 'error',
  })
  expect((await t.query(internal.routines.target, args)).remaining).toBe(2)
  expect((await t.mutation(internal.routines.reserve, args))?.leadId).not.toBe(failed.leadId)
})

test('screening failures back off, preserve decisions, and stop automatic retries after three failures', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  const { t, args, loggedIn } = await setup()
  await loggedIn()
  let claim = (await t.mutation(internal.routines.reserve, args))!
  const leadId = claim.leadId
  const decision = { classification: 'male' as const, enrichmentModel: 'openai/gpt-6-luna-decisions', enrichedAt: 123, enrichmentConfidence: 0.95 }
  await t.run(async ctx => {
    await ctx.db.patch(leadId, decision)
    for (const membership of await ctx.db.query('leadMemberships').collect())
      if (membership.leadId !== leadId) await ctx.db.delete(membership._id)
    const listId = await ctx.db.insert('leadLists', { name: 'shared', createdAt: 0 })
    await ctx.db.insert('leadMemberships', { leadId, listId, leadCreatedAt: 0, available: true, classification: 'male' })
  })
  await t.mutation(api.leadStats.initialize, {})
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const failure = { ...args, leadId, date: claim.date, screeningToken: claim.screeningToken }
    const failedAt = Date.now()
    expect(await t.mutation(internal.leadScreening.finish, failure)).toBe(false)
    expect(await t.mutation(internal.leadScreening.finish, failure)).toBe(false)
    const lead = (await t.run(ctx => ctx.db.get(leadId)))!
    expect(lead).toMatchObject({ ...decision, enrichmentStatus: 'error', screeningFailures: attempt })
    for (const field of ['screeningToken', 'screeningProfileId', 'screeningAutomationId', 'screeningListId', 'senderId'])
      expect(lead).not.toHaveProperty(field)
    expect((await t.query(internal.routines.target, args)).remaining).toBe(2)
    const memberships = await t.run(ctx => ctx.db.query('leadMemberships').withIndex('by_lead_list', q => q.eq('leadId', leadId)).collect())
    expect(memberships.every(row => row.available === (attempt < 3))).toBe(true)
    expect(await t.mutation(internal.routines.reserve, args)).toBeNull()
    if (attempt < 3) {
      const retryAt = failedAt + 5 * 60_000 * 2 ** (attempt - 1)
      expect(lead.screeningUntil).toBe(retryAt)
      vi.setSystemTime(retryAt - 1)
      expect(await t.mutation(internal.routines.reserve, args)).toBeNull()
      vi.setSystemTime(retryAt)
      claim = (await t.mutation(internal.routines.reserve, args))!
      expect(claim.leadId).toBe(leadId)
    } else expect(lead).not.toHaveProperty('screeningUntil')
  }
  vi.setSystemTime(Date.now() + 60 * 60_000)
  expect(await t.mutation(internal.routines.reserve, args)).toBeNull()
  expect(await t.run(ctx => ctx.db.query('leadStats').unique())).toMatchObject({ counts: { ready: 3, assigned: 0, enriched: 3 } })
  expect(await t.mutation(api.scraper.retryEnrichment, {})).toBe(1)
  const retried = (await t.run(ctx => ctx.db.get(leadId)))!
  expect(retried).toMatchObject({ ...decision, enrichmentStatus: 'pending' })
  expect(retried).not.toHaveProperty('screeningFailures')
  expect(retried).not.toHaveProperty('screeningUntil')
  expect((await t.mutation(internal.routines.reserve, args))?.leadId).toBe(leadId)
})

test('a successful screening resets the failure count and replaces the saved decision', async () => {
  const { t, args, loggedIn } = await setup()
  await loggedIn()
  const claim = (await t.mutation(internal.routines.reserve, args))!
  await t.run(ctx => ctx.db.patch(claim.leadId, { screeningFailures: 2,
    enrichmentStatus: 'error', enrichmentModel: 'previous-model', enrichedAt: 123, enrichmentConfidence: 0.8 }))
  expect(await t.mutation(internal.leadScreening.finish, { ...args,
    leadId: claim.leadId, date: claim.date, screeningToken: claim.screeningToken,
    category: 'female', confidence: 0.99 })).toBe(false)
  const lead = (await t.run(ctx => ctx.db.get(claim.leadId)))!
  expect(lead).toMatchObject({ classification: 'female', enrichmentStatus: 'ready',
    enrichmentModel: 'openai/gpt-6-luna-decisions', enrichmentConfidence: 0.99 })
  expect(lead.enrichedAt).not.toBe(123)
  expect(lead).not.toHaveProperty('screeningFailures')
  expect(lead).not.toHaveProperty('screeningUntil')
  expect(lead).not.toHaveProperty('senderId')
  expect((await t.query(internal.routines.target, args)).remaining).toBe(2)
})

test('concurrent approvals cannot exceed the daily allowance', async () => {
  const { t, args, automation, loggedIn } = await setup()
  await loggedIn()
  await t.run((ctx) =>
    ctx.db.patch(automation._id, { routine: { ...automation.routine!, initialDms: 1, maxDms: 1 } }),
  )
  const claims = await Promise.all([
    t.mutation(internal.routines.reserve, args),
    t.mutation(internal.routines.reserve, args),
  ])
  expect(claims[0]?.leadId).not.toBe(claims[1]?.leadId)
  const accepted = await Promise.all(
    claims.map((claim) =>
      t.mutation(internal.leadScreening.finish, {
        ...args,
        leadId: claim!.leadId,
        date: claim!.date,
        screeningToken: claim!.screeningToken,
        category: 'male',
        confidence: 1,
      }),
    ),
  )
  expect(accepted.filter(Boolean)).toHaveLength(1)
  expect((await t.query(internal.routines.target, args)).remaining).toBe(0)
})
test.each(['pause', 'categories', 'route', 'disabled'] as const)(
  'screening approval rechecks %s before assigning',
  async (change) => {
    const { t, args, automation, loggedIn } = await setup()
    await loggedIn()
    const claim = (await t.mutation(internal.routines.reserve, args))!
    if (change === 'pause')
      await t.mutation(api.routines.setAccount, { profileId: args.profileId, paused: true })
    else
      await t.run((ctx) =>
        ctx.db.patch(
          automation._id,
          change === 'disabled'
            ? { isActive: false }
            : {
                routine: {
                  ...automation.routine!,
                  ...(change === 'categories'
                    ? { allowedCategories: ['business'] as const as ['business'] }
                    : { leadListId: undefined }),
                },
              },
        ),
      )
    expect(
      await t.mutation(internal.leadScreening.finish, {
        ...args,
        leadId: claim.leadId,
        date: claim.date,
        screeningToken: claim.screeningToken,
        category: 'male',
        confidence: 1,
      }),
    ).toBe(false)
    expect(await t.run((ctx) => ctx.db.get(claim.leadId))).not.toHaveProperty('senderId')
  },
)
