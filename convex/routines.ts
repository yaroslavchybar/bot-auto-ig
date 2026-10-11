import { patchProfile } from './workerMetadata'
import { LeadStatsChanges } from './leadStats'
import { recordActivity } from './analyticsActivity'
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { followAllowance, dayKey, routineLists, randomInRange, unfollowRange, profileOutreachRoutes } from "./routinePolicy";
import { requireServerBridgeAuth } from "./serverBridgeAuth";
import { leadAvailable, setLeadAvailability } from './leadMemberships';
import { setChatCounterEnabled } from './chatCache';
import { isRetryableRoutineIssue, isRoutineLoginIssue, ROUTINE_RETRY_MS, routineRetryState } from './routineErrors';

const progress = (ctx: QueryCtx, profileId: Id<"profiles">) =>
  ctx.db
    .query("accountProgress")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();

function kyivDateKey(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp);
  const get = (kind: string) => parts.find(part => part.type === kind)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export async function assertAssignments(
  ctx: QueryCtx,
  candidate?: Doc<"automations">,
) {
  const automations = (await ctx.db.query("automations").collect()).filter(
    (a) => a._id !== candidate?._id,
  );
  if (candidate) automations.push(candidate);
  const active = automations.filter((a) => a.isActive !== false);
  for (const profile of await ctx.db.query("profiles").collect()) {
    const matches = active.filter((a) =>
      routineLists(a).some((id) =>
        profile.listIds?.includes(id as Id<"lists">),
      ),
    );
    if (matches.length > 1)
      throw new Error(
        `${profile.name} belongs to multiple enabled automations: ${matches.map((a) => a.name).join(", ")}`,
      );
  }
}

async function ensureProgress(ctx: MutationCtx, profileId: Id<"profiles">) {
  const existing = await progress(ctx, profileId);
  if (existing) return existing;
  const id = await ctx.db.insert("accountProgress", {
    profileId,
    paused: false,
    activeDays: 0,
    outreachDays: 0,
    date: "",
    used: 0,
    allowance: 0,
    nextRunAt: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

async function eligibility(
  ctx: QueryCtx,
  automationId: Id<"automations">,
  profileId: Id<"profiles">,
) {
  const a = await ctx.db.get(automationId),
    p = await ctx.db.get(profileId),
    savedState = await progress(ctx, profileId);
  const state = savedState ? { ...savedState, ...routineRetryState(savedState) } : null;
  if (
    !a?.routine ||
    !a.isActive ||
    !p ||
    p.status === "deleting" ||
    p.renameFrom
  )
    return null;
  const igAccount = p.igAccountId ? await ctx.db.get(p.igAccountId) : null;
  if (p.igAccountId && igAccount?.status !== 'connected' &&
    !(igAccount?.status === 'assigned' && igAccount.browserLoggedInAt))
    return null;
  if (!routineLists(a).some((id) => p.listIds?.includes(id as Id<"lists">)))
    return null;
  const matches = (await ctx.db.query("automations").collect()).filter(
    (other) =>
      other.isActive !== false &&
      routineLists(other).some((id) => p.listIds?.includes(id as Id<"lists">)),
  );
  if (matches.length !== 1 || !p.igLoggedIn || state?.paused || state?.issue)
    return null;
  return {
    automation: a,
    policy: a.routine,
    state,
    profile: p,
    igAccount,
  };
}

export const setAccount = mutation({
  args: {
    profileId: v.id("profiles"),
    paused: v.optional(v.boolean()),
    clearIssue: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.profileId)))
      throw new Error("Profile not found");
    const state = await ensureProgress(ctx, args.profileId);
    await ctx.db.patch(state._id, {
      ...(args.paused !== undefined ? { paused: args.paused } : {}),
      ...(args.clearIssue ? { issue: undefined } : {}),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Time-independent access state for a live worker subscription.
 * Time-based budget checks remain in `ready`, immediately before actions.
 */
export const access = query({
  args: {
    bridgeToken: v.string(),
    automationId: v.id("automations"),
    profileId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    requireServerBridgeAuth(args.bridgeToken);
    return Boolean(await eligibility(ctx, args.automationId, args.profileId));
  },
});

export const accounts = query({
  args: { automationId: v.id("automations") },
  handler: async (ctx, { automationId }) => {
    const a = await ctx.db.get(automationId);
    if (!a) return [];
    const profiles = (await ctx.db.query("profiles").collect()).filter((p) =>
      routineLists(a).some((id) => p.listIds?.includes(id as Id<"lists">)),
    );
    return Promise.all(
      profiles.map(async (p) => {
        const savedState = await progress(ctx, p._id);
        const state = savedState ? { ...savedState, ...routineRetryState(savedState) } : null;
        const igAccount = p.igAccountId ? await ctx.db.get(p.igAccountId) : null;
        const date = dayKey();
        const activeBeforeToday = (state?.activeDays ?? 0) - (state?.lastActivityDate === date ? 1 : 0);
        const warmup = await ctx.db.query('warmupStates').withIndex('by_profile', q => q.eq('profileId', p._id)).unique();
        return {
          profileId: p._id,
          name: p.name,
          paused: state?.paused ?? false,
          issue: state?.issue,
          stage: !p.igLoggedIn
            ? "Not logged in"
            : p.igAccountId && igAccount?.status !== 'connected'
            ? igAccount?.browserLoggedInAt
              ? kyivDateKey(Date.now()) <= kyivDateKey(igAccount.browserLoggedInAt)
                ? "Browser logged in" : "Warm-up"
              : "Connecting"
            : !p.outreachReady ||
                activeBeforeToday + 1 <
                  (a.routine?.outreachStartDay ?? 7)
              ? "Warm-up"
              : "Outreach",
          activeDays: state?.activeDays ?? 0,
          used: state?.followQuotaDate === date ? state.used : 0,
          sent: state?.dmDate === date ? state.sentToday ?? 0 : 0,
          followed: state?.followQuotaDate === date ? state.followedToday ?? 0 : 0,
          budgetExhausted: warmup?.date === date && (warmup.minutesUsedToday ?? 0) >= warmup.todayMinutes,
          allowance:
            a.routine && a.routine.outreachEnabled && profileOutreachRoutes(a.routine, p._id).length && p.outreachReady && (!p.igAccountId || igAccount?.status === 'connected')
              ? state?.followQuotaDate === date
                ? state.allowance
                : followAllowance(
                    a.routine,
                    activeBeforeToday,
                    state?.followIncrease ?? 0,
                  )
              : 0,
          nextRunAt: state?.nextRunAt,
        };
      }),
    );
  },
});

/** Remaining target includes in-flight claims so concurrent workers cannot oversend. */
export const target = internalQuery({
  args: { automationId: v.id('automations'), profileId: v.id('profiles') },
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!e || (e.profile.igAccountId && e.igAccount?.status !== 'connected') ||
      !e.profile.outreachReady || !e.policy.outreachEnabled || !profileOutreachRoutes(e.policy, args.profileId).length) return { target: 0, remaining: 0, sent: 0 };
    const today = dayKey();
    const s = e.state;
    const allowance = Math.min(e.policy.maxDms, s?.followQuotaDate === today ? s.allowance
      : followAllowance(e.policy, (s?.activeDays ?? 0) - (s?.lastActivityDate === today ? 1 : 0), s?.followIncrease ?? 0));
    return { target: allowance, remaining: Math.max(0, allowance - (s?.followQuotaDate === today ? s.used : 0)),
      sent: s?.followQuotaDate === today ? s.followedToday ?? 0 : 0 };
  },
});

export const ready = internalQuery({
  args: {
    automationId: v.id("automations"),
    profileId: v.id("profiles"),
    checkpoint: v.optional(v.boolean()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await eligibility(ctx, args.automationId, args.profileId);
    if (!result) return false;
    const now = args.now ?? Date.now();
    if (result.igAccount?.status === 'assigned' && result.igAccount.browserLoggedInAt &&
      kyivDateKey(now) <= kyivDateKey(result.igAccount.browserLoggedInAt)) return false;
    if (args.checkpoint) return true;
    const date = dayKey(now);
    const warmup = await ctx.db
      .query("warmupStates")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .unique();
    return (
      (result.state?.nextRunAt ?? 0) <= now &&
      (warmup?.nextRunAt ?? 0) <= now &&
      (!warmup ||
        warmup.date !== date ||
        (!warmup.activeRun &&
          (warmup.minutesUsedToday ?? 0) < warmup.todayMinutes))
    );
  },
});

export const recordSession = internalMutation({
  args: {
    automationId: v.id("automations"),
    profileId: v.id("profiles"),
    activityCompleted: v.boolean(),
    issue: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.automationId);
    if (!a?.routine || !(await ctx.db.get(args.profileId))) return;
    const state = await ensureProgress(ctx, args.profileId);
    const warmup = await ctx.db
      .query("warmupStates")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .unique();
    const date = warmup?.date ?? dayKey();
    const dailyCompleted =
      args.activityCompleted &&
      !!warmup &&
      (warmup.minutesUsedToday ?? 0) >= warmup.todayMinutes;
    const now = Date.now();
    const retryable = isRetryableRoutineIssue(args.issue);
    // A later session result must not erase an uncertain delivery recorded by finishSend.
    const issue = state.issue && !isRetryableRoutineIssue(state.issue)
      ? state.issue : retryable ? undefined : args.issue;
    await ctx.db.patch(state._id, {
      activeDays:
        state.activeDays +
        (dailyCompleted && state.lastActivityDate !== date ? 1 : 0),
      ...(dailyCompleted ? { lastActivityDate: date } : {}),
      issue,
      nextRunAt: Math.ceil(retryable
        ? Math.max(state.nextRunAt, warmup?.nextRunAt ?? 0, now + ROUTINE_RETRY_MS)
        : warmup?.nextRunAt ?? now + 60 * 60_000),
      updatedAt: now,
    });
    if (isRoutineLoginIssue(args.issue)) {
      await patchProfile(ctx, args.profileId, { igLoggedIn: false });
      await setChatCounterEnabled(ctx, args.profileId, false);
    }
  },
});

/** Claim a new follow once; claimed leads are never returned to another sender. */
export const reserve = internalMutation({
  args: { automationId: v.id('automations'), profileId: v.id('profiles') },
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!e || (e.profile.igAccountId && e.igAccount?.status !== 'connected') ||
      !e.profile.outreachReady || !e.policy.outreachEnabled) return null;
    const routes = profileOutreachRoutes(e.policy, args.profileId);
    if (!routes.length) return null;
    const date = dayKey();
    const state = await ensureProgress(ctx, args.profileId);
    const used = state.followQuotaDate === date ? state.used : 0;
    const activeBeforeToday = state.activeDays - (state.lastActivityDate === date ? 1 : 0);
    const allowance = Math.min(e.policy.maxDms, state.followQuotaDate === date ? state.allowance : followAllowance(e.policy, activeBeforeToday, state.followIncrease ?? 0));
    if (used >= allowance) return null;
    let lead: Doc<'leads'> | undefined;
    let selected: typeof routes[number] | undefined;
    const start = (routes.findIndex(route => route.leadListId === state.lastLeadListId) + 1) % routes.length;
    for (let offset = 0; offset < routes.length && !lead; offset++) {
      const route = routes[(start + offset) % routes.length];
      if (!await ctx.db.get(route.leadListId)) continue;
      for await (const membership of ctx.db.query('leadMemberships')
        .withIndex('by_list_available', q => q.eq('listId', route.leadListId).eq('available', true))) {
        const candidate = await ctx.db.get(membership.leadId);
        if (candidate && leadAvailable(candidate)) { lead = candidate; selected = route; break; }
        await ctx.db.patch(membership._id, { available: false });
      }
    }
    if (!lead || !selected) return null;
    await ctx.db.patch(lead._id, { senderId: args.profileId, outreachListId: selected.leadListId, outreachAutomationId: args.automationId, unfollowDays: randomInRange(unfollowRange(e.policy)) });
    const stats = new LeadStatsChanges();
    stats.add(lead, { ...lead, senderId: args.profileId });
    await stats.flush(ctx);
    await setLeadAvailability(ctx, lead._id, false);
    await ctx.db.patch(state._id, { date, followQuotaDate: date, used: used + 1, allowance, lastLeadListId: selected.leadListId,
      followedToday: state.followQuotaDate === date ? state.followedToday ?? 0 : 0, updatedAt: Date.now() });
    return { leadId: lead._id, username: lead.username, message: selected.message.replaceAll('{{username}}', lead.username), date };
  },
});

export const beginFollow = internalMutation({
  args: { automationId: v.id('automations'), profileId: v.id('profiles'), leadId: v.id('leads'), date: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    const e = await eligibility(ctx, args.automationId, args.profileId);
    const today = dayKey(args.now ?? Date.now());
    const allowed = !!(lead && lead.senderId === args.profileId && !lead.followed && lead.followStartedAt === undefined && !lead.dmSent && !lead.dmBlocked &&
      e && (!e.profile.igAccountId || e.igAccount?.status === 'connected') &&
      e.profile.outreachReady && e.policy.outreachEnabled && today === args.date &&
      (!lead.outreachListId || (await ctx.db.get(lead.outreachListId) && lead.outreachAutomationId === args.automationId && profileOutreachRoutes(e.policy, args.profileId).some(route => route.leadListId === lead.outreachListId))));
    if (!allowed || !lead) return false;
    // Persist cleanup intent before the browser click, including a lost confirmation/restart.
    const now = Date.now();
    await ctx.db.patch(lead._id, { followStartedAt: now, unfollowAt: now + (lead.unfollowDays ?? 7) * 86_400_000 });
    return true;
  },
});

const outreachArgs = { automationId: v.id('automations'), profileId: v.id('profiles') };

function pendingDm(lead: Doc<'leads'>, profileId: Id<'profiles'>, now: number) {
  return lead.senderId === profileId && lead.followed && !lead.dmSent && !lead.dmBlocked &&
    lead.dmStartedAt === undefined && lead.followDate !== undefined && dayKey(lead.followDate) < dayKey(now) &&
    (lead.unfollowAt ?? lead.followDate + followDelay) > now;
}

/** Only scan once per day, and only while an outreach follow is awaiting a reply. */
export const notifications = internalQuery({
  args: outreachArgs,
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId);
    const date = dayKey();
    if (!e || !e.policy.outreachEnabled || !e.profile.outreachReady ||
      (e.profile.igAccountId && e.igAccount?.status !== 'connected') ||
      !profileOutreachRoutes(e.policy, args.profileId).length || e.state?.lastNotificationsDate === date)
      return null;
    const pending = await ctx.db.query('leads').withIndex('by_unfollow_due', q =>
      q.eq('senderId', args.profileId).eq('followed', true).gt('unfollowAt', Date.now()))
      .filter(q => q.and(q.lt(q.field('followDate'), Date.parse(date)), q.eq(q.field('dmSent'), false),
        q.neq(q.field('dmBlocked'), true), q.eq(q.field('dmStartedAt'), undefined))).first();
    return pending ? { date, since: Math.max(e.state?.outreachStartedAt ?? 0,
      e.state?.lastNotificationsAt ? e.state.lastNotificationsAt - 86_400_000 : 0) } : null;
  },
});

/** Batch notification evidence rather than making a Convex call for each row. */
export const recordNotifications = internalMutation({
  args: { ...outreachArgs, date: v.string(), usernames: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (args.usernames.length > 1000) throw new Error('Too many notification rows');
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!e || !e.policy.outreachEnabled || args.date !== dayKey()) return;
    const routes = profileOutreachRoutes(e.policy, args.profileId);
    const now = Date.now();
    for (const username of new Set(args.usernames.map(name => name.toLowerCase()))) {
      const leads = await ctx.db.query('leads').withIndex('by_username', q => q.eq('username', username)).collect();
      for (const lead of leads) {
        if (pendingDm(lead, args.profileId, now) && lead.outreachAutomationId === args.automationId &&
          routes.some(route => route.leadListId === lead.outreachListId) && !lead.dmEligible)
          await ctx.db.patch(lead._id, { dmEligible: true });
      }
    }
    const state = await ensureProgress(ctx, args.profileId);
    if (state.lastNotificationsDate !== args.date)
      await ctx.db.patch(state._id, { lastNotificationsDate: args.date, lastNotificationsAt: now });
  },
});

export const dmTasks = internalQuery({
  args: outreachArgs,
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!e || !e.policy.outreachEnabled || !e.profile.outreachReady ||
      (e.profile.igAccountId && e.igAccount?.status !== 'connected')) return [];
    const routes = profileOutreachRoutes(e.policy, args.profileId);
    const tasks = [];
    for await (const lead of ctx.db.query('leads').withIndex('by_dm_pending', q =>
      q.eq('senderId', args.profileId).eq('dmEligible', true).eq('dmStartedAt', undefined).gt('unfollowAt', Date.now()))) {
      const route = routes.find(route => route.leadListId === lead.outreachListId);
      if (pendingDm(lead, args.profileId, Date.now()) && route && lead.outreachAutomationId === args.automationId && await ctx.db.get(route.leadListId)) {
        tasks.push({ leadId: lead._id, username: lead.username,
          fullName: lead.fullName, message: route.message, date: dayKey() });
        if (tasks.length === 50) break; // More than can fit in a single browser session.
      }
    }
    return tasks;
  },
});

/** Atomically authorize the first and only press of Send, after live follower verification. */
export const beginSend = internalMutation({
  args: { ...outreachArgs, leadId: v.id('leads'), date: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const lead = await ctx.db.get(args.leadId);
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!lead || !e || !lead.dmEligible || !pendingDm(lead, args.profileId, now) ||
      dayKey(now) !== args.date || !e.policy.outreachEnabled || !e.profile.outreachReady ||
      (e.profile.igAccountId && e.igAccount?.status !== 'connected') ||
      lead.outreachAutomationId !== args.automationId || !lead.outreachListId ||
      !await ctx.db.get(lead.outreachListId) ||
      !profileOutreachRoutes(e.policy, args.profileId).some(route => route.leadListId === lead.outreachListId)) return false;
    await ctx.db.patch(lead._id, { dmStartedAt: now, dmStartedDate: args.date, dmEligible: false });
    return true;
  },
});

export const dismissDm = internalMutation({
  args: { profileId: v.id('profiles'), leadId: v.id('leads') },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (lead?.senderId === args.profileId && lead.dmEligible && lead.dmStartedAt === undefined)
      await ctx.db.patch(lead._id, { dmEligible: false });
  },
});

export const finishSend = internalMutation({
  args: { profileId: v.id('profiles'), leadId: v.id('leads'), date: v.string(), sent: v.boolean(), blocked: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.senderId !== args.profileId) throw new Error('Lead belongs to another sender');
    if (lead.dmSent || lead.dmBlocked) return;
    if (lead.dmStartedAt === undefined || lead.dmStartedDate !== args.date) throw new Error('DM was not authorized');
    if (args.sent) {
      await ctx.db.patch(lead._id, { dmSent: true });
      await setLeadAvailability(ctx, lead._id, false);
      await recordActivity(ctx, args.date, { dms: 1 });
    }
    const state = await progress(ctx, args.profileId);
    if (!state) return;
    if (args.sent) {
      await ctx.db.patch(state._id, {
        dmDate: args.date,
        sentToday: (state.dmDate === args.date ? state.sentToday ?? 0 : 0) + 1,
      });
    } else if (args.blocked) {
      // A confirmed blocked/unsent message is never retried.
      await ctx.db.patch(lead._id, { dmBlocked: true });
    } else {
      await ctx.db.patch(state._id, {
        issue: 'Delivery could not be confirmed. Check Instagram before clearing this issue; the claimed lead will not be retried.',
      });
    }
  },
});

const followDelay = 7 * 24 * 60 * 60_000;
export const followTasks = internalQuery({
  args: { automationId: v.id('automations'), profileId: v.id('profiles'), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!e || (e.profile.igAccountId && e.igAccount?.status !== 'connected')) return [];
    const now = args.now ?? Date.now();
    const due = await ctx.db.query('leads').withIndex('by_unfollow_due', q => q.eq('senderId', args.profileId).eq('followed', true).gt('unfollowAt', undefined).lte('unfollowAt', now)).take(5);
    // Existing follows without a saved deadline retain their original seven-day delay.
    if (due.length < 5) due.push(...await ctx.db.query('leads')
      .withIndex('by_follow_due', q => q.eq('senderId', args.profileId).eq('followed', true).gt('followDate', undefined).lte('followDate', now - followDelay))
      .filter(q => q.eq(q.field('unfollowAt'), undefined)).take(5 - due.length));
    if (due.length < 5) due.push(...await ctx.db.query('leads')
      .withIndex('by_unfollow_due', q => q.eq('senderId', args.profileId).eq('followed', false).gt('unfollowAt', undefined).lte('unfollowAt', now))
      .filter(q => q.neq(q.field('followStartedAt'), undefined)).take(5 - due.length));
    return due.map(lead => ({ leadId: lead._id, username: lead.username }));
  },
});

export const recordFollow = internalMutation({
  args: { profileId: v.id('profiles'), leadId: v.id('leads'), followed: v.boolean() },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.senderId !== args.profileId) throw new Error('Follow belongs to another profile');
    if (args.followed === lead.followed && (args.followed || lead.followStartedAt === undefined)) return;
    const now = Date.now();
    if (!args.followed && (lead.unfollowAt ?? (lead.followDate ?? Infinity) + followDelay) > now) throw new Error('Follow is not due for removal');
    await ctx.db.patch(lead._id, { followed: args.followed, ...(args.followed ? {
      followDate: lead.followStartedAt ?? now, unfollowAt: lead.unfollowAt ?? now + (lead.unfollowDays ?? 7) * 86_400_000,
    } : { dmEligible: false, followStartedAt: undefined }) });
    if (args.followed) {
      await setLeadAvailability(ctx, lead._id, false);
      const state = await ensureProgress(ctx, args.profileId);
      const date = dayKey(now);
      const firstFollowToday = state.lastFollowDate !== date;
      await recordActivity(ctx, date, { follows: 1 });
      await ctx.db.patch(state._id, {
        outreachDays: state.outreachDays + (firstFollowToday ? 1 : 0),
        followIncrease: (state.followIncrease ?? 0) + (firstFollowToday ? 1 + Math.floor(Math.random() * 4) : 0),
        lastFollowDate: date,
        outreachStartedAt: state.outreachStartedAt ?? lead.followStartedAt ?? now,
        ...(state.followQuotaDate === date ? { followedToday: (state.followedToday ?? 0) + 1 } : {}),
      });
    }
  },
});
