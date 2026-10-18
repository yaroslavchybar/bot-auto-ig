import { connectionStatus } from './accountConnection'
import { patchProfile } from './workerMetadata'
import { setProfilePaused } from './profilePause'
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
import { dailyOutreachQuota, dayKey, routineModels, profileOutreachRoutes } from "./routinePolicy";
import { requireServerBridgeAuth } from "./serverBridgeAuth";
import { leadAvailable, setLeadAvailability } from './leadMemberships';
import { isRetryableRoutineIssue, isRoutineLoginIssue, ROUTINE_RETRY_MS, routineRetryState,
} from './routineErrors';

const progress = (ctx: QueryCtx, profileId: Id<"profiles">) =>
  ctx.db
    .query("accountProgress")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();

function kyivDateKey(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp);
  const get = (kind: string) => parts.find((part) => part.type === kind)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export async function assertAssignments(
  ctx: QueryCtx,
  candidate?: Doc<"automations">) {
  const automations = (await ctx.db.query("automations").collect()).filter(
    (a) => a._id !== candidate?._id,
  );
  if (candidate) automations.push(candidate);
  const active = automations.filter((a) => a.isActive !== false);
  for (const profile of await ctx.db.query("profiles").collect()) {
    const matches = active.filter((a) =>
      routineModels(a).some((id) =>
        profile.modelIds?.includes(id as Id<"models">)),
    );
    if (matches.length > 1)
      throw new Error(
        `${profile.name} belongs to multiple enabled automations: ${matches.map((a) => a.name).join(", ")}`,
      );
  }
}

export async function ensureProgress(ctx: MutationCtx, profileId: Id<"profiles">) {
  const existing = await progress(ctx, profileId);
  if (existing) return existing;
  // Late worker results must not recreate state after profile cleanup.
  if (!await ctx.db.get(profileId)) throw new Error('Profile not found');
  const id = await ctx.db.insert("accountProgress", {
    profileId,
    paused: false,
    activeDays: 0,
    outreachUsedToday: 0,
    outreachAllowanceToday: 0,
    nextRunAt: 0,
    updatedAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

export async function eligibility(
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
    p.paused ||
    p.status === "deleting" ||
    p.pendingRenameFrom
  )
    return null;
  const account = p.igAccountId ? await ctx.db.get(p.igAccountId) : null;
  const igAccount = account ? { ...account, status: connectionStatus(account, p) } : null;
  const warmup = await ctx.db.query('warmupStates').withIndex('by_profile', (q) => q.eq('profileId', profileId)).unique();
  // A newly assigned credential still needs its first verified browser login.
  if (p.igAccountId && (igAccount?.status !== 'connected' ||
    (account?.status === 'assigned' && !account.browserLoggedInAt)))
    return null;
  if (!routineModels(a).some((id) => p.modelIds?.includes(id as Id<"models">)))
    return null;
  const matches = (await ctx.db.query("automations").collect()).filter(
    (other) =>
      other.isActive !== false &&
      routineModels(other).some((id) => p.modelIds?.includes(id as Id<"models">)),
  );
  if (matches.length !== 1 || !p.igLoggedIn || state?.paused || state?.issue)
    return null;
  return {
    automation: a,
    policy: a.routine,
    routes: profileOutreachRoutes(a.routine, profileId),
    state,
    profile: p,
    igAccount,
    warmup,
    maintenance: (warmup?.day ?? 0) >= 8,
    followsBlocked: warmup?.followBlockedDate === dayKey(),
  };
}

type OutreachContext = NonNullable<Awaited<ReturnType<typeof eligibility>>>;

/** Shared gates; notifications/DMs intentionally ignore the daily follow block. */
export function canOutreach(e: OutreachContext | null): e is OutreachContext {
  return !!e && e.maintenance && e.policy.outreachEnabled && !!e.profile.outreachReady && e.routes.length > 0;
}
export function canFollow(e: OutreachContext | null): e is OutreachContext {
  return canOutreach(e) && !e.followsBlocked;
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
    if (args.paused !== undefined) await setProfilePaused(ctx, args.profileId, args.paused)
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

async function accountSummary(ctx: QueryCtx, p: Doc<'profiles'>, a: Doc<'automations'> | null) {
  const savedState = await progress(ctx, p._id);
  const state = savedState ? { ...savedState, ...routineRetryState(savedState) } : null;
  const igAccount = p.igAccountId ? await ctx.db.get(p.igAccountId) : null;
  const date = dayKey();
  const warmup = await ctx.db.query('warmupStates').withIndex('by_profile', q => q.eq('profileId', p._id)).unique();
  return {
    profileId: p._id, name: p.name,
    paused: p.paused === true || (state?.paused ?? false), issue: state?.issue,
    stage: !p.igLoggedIn ? 'Not logged in'
      : igAccount?.browserLoggedInAt && kyivDateKey(Date.now()) <= kyivDateKey(igAccount.browserLoggedInAt)
        ? 'Browser logged in' : !p.outreachReady || (warmup?.day ?? 0) < 8 ? 'Warm-up' : 'Outreach',
    activeDays: state?.activeDays ?? 0,
    used: state?.outreachQuotaDate === date ? state.outreachUsedToday : 0,
    sent: state?.dmCountDate === date ? (state.sentToday ?? 0) : 0,
    followed: state?.outreachQuotaDate === date ? (state.followedToday ?? 0) : 0,
    budgetExhausted: warmup?.date === date && (warmup.minutesUsedToday ?? 0) >= warmup.todayMinutes,
    allowance: a?.routine && a.routine.outreachEnabled && profileOutreachRoutes(a.routine, p._id).length && p.outreachReady && (warmup?.day ?? 0) >= 8 && warmup?.followBlockedDate !== date && (!p.igAccountId || p.igLoggedIn)
      ? dailyOutreachQuota(a.routine, state, date).allowance
      : 0,
    nextRunAt: state?.nextRunAt,
  };
}

/** Profile manager details exclude cookies and encrypted account credentials. */
export const profileDetails = query({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, { profileId }) => {
    const profile = await ctx.db.get(profileId);
    if (!profile) return null;
    const assigned = (await ctx.db.query('automations').collect()).filter(a =>
      a.routine && routineModels(a).some(id => profile.modelIds?.includes(id as Id<'models'>)));
    const automation = assigned.find(a => a.isActive !== false) ?? assigned[0] ?? null;
    const setup = (await ctx.db.query('modelSetupStates').withIndex('by_profile', q => q.eq('profileId', profileId)).collect())
      .find(row => profile.modelIds?.includes(row.modelId)) ?? null;
    const modelId = profile.modelIds?.[0];
    const model = modelId ? await ctx.db.get(modelId) : null;
    return {
      ...await accountSummary(ctx, profile, automation),
      browserStatus: profile.inUse ? 'Active' : profile.status ?? 'idle',
      igLoggedIn: profile.igLoggedIn === true,
      changing: profile.status === 'deleting' || Boolean(profile.pendingRenameFrom),
      model: model ? { name: model.name } : null,
      automation: automation ? { name: automation.name, enabled: automation.isActive !== false, status: automation.status } : null,
      setup: setup ? {
        usernameDone: setup.usernameDone, fullNameDone: setup.fullNameDone, avatarDone: setup.avatarDone,
        postsDone: setup.postSourceIds.length, postTarget: setup.postTarget,
        pending: setup.pending, error: setup.error,
      } : null,
    };
  },
});

export const accounts = query({
  args: { automationId: v.id("automations") },
  handler: async (ctx, { automationId }) => {
    const a = await ctx.db.get(automationId);
    if (!a) return [];
    const profiles = (await ctx.db.query("profiles").collect()).filter((p) =>
      routineModels(a).some((id) => p.modelIds?.includes(id as Id<"models">)),
    );
    return Promise.all(profiles.map(p => accountSummary(ctx, p, a)));
  },
});

/** Remaining target includes in-flight claims so concurrent workers cannot oversend. */
export const target = internalQuery({
  args: { automationId: v.id('automations'), profileId: v.id('profiles') },
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!canFollow(e)) return { target: 0, remaining: 0, sent: 0 };
    const today = dayKey();
    const { allowance, used, followed } = dailyOutreachQuota(e.policy, e.state, today);
    return { target: allowance, remaining: Math.max(0, allowance - used), sent: followed };
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
    if (result.igAccount?.browserLoggedInAt &&
      kyivDateKey(now) <= kyivDateKey(result.igAccount.browserLoggedInAt)) return false;
    if (args.checkpoint) return true;
    const date = dayKey(now);
    const warmup = result.warmup;
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
        : (warmup?.nextRunAt ?? now + 60 * 60_000),
      ),
      updatedAt: now,
    });
    if (isRoutineLoginIssue(args.issue)) {
      await patchProfile(ctx, args.profileId, { igLoggedIn: false });
    }
  },
})

/** Lease a candidate for browser screening; assignment and quota wait for approval. */
export const reserve = internalMutation({
  args: { automationId: v.id('automations'), profileId: v.id('profiles') },
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!canFollow(e)) return null;
    const routes = e.routes;
    if (!routes.length) return null;
    const date = dayKey();
    const state = await ensureProgress(ctx, args.profileId);
    const { used, allowance } = dailyOutreachQuota(e.policy, state, date);
    if (used >= allowance) return null;
    let lead: Doc<'leads'> | undefined;
    let selected: (typeof routes)[number] | undefined;
    const start = (routes.findIndex((route) => route.leadListId === state.lastLeadListId) + 1) % routes.length;
    for (let offset = 0; offset < routes.length && !lead; offset++) {
      const route = routes[(start + offset) % routes.length];
      if (!(await ctx.db.get(route.leadListId))) continue;
      for (const category of [undefined, ...(e.policy.allowedCategories ?? ['male'])]) {
        const memberships = await ctx.db.query('leadMemberships')
          .withIndex('by_list_category', q => q.eq('listId', route.leadListId).eq('available', true).eq('classification', category))
          .take(100);
        for (const membership of memberships) {
          const candidate = await ctx.db.get(membership.leadId);
          if (!candidate || !leadAvailable(candidate)) {
            await ctx.db.patch(membership._id, { available: false })
            continue
          }
          if ((candidate.screeningUntil ?? 0) > Date.now()) continue
          if (
            candidate.screenedAt !== undefined &&
            candidate.classification &&
            // A category this policy excludes, or a male lead that failed the
            // English text check, is never screened again by the same policy.
            (!(e.policy.allowedCategories ?? ['male']).includes(candidate.classification) ||
              (candidate.classification === 'male' && candidate.englishTextCheckPassed !== true))
          )
            continue
          lead = candidate
          selected = route
          break
        }
        if (lead) break;
      }
    }
    if (!lead || !selected) return null
    const screeningToken = `${Date.now()}:${Math.random().toString(36).slice(2)}`
    await ctx.db.patch(lead._id, {
      screeningToken,
      screeningProfileId: args.profileId,
      screeningAutomationId: args.automationId,
      screeningListId: selected.leadListId,
      screeningUntil: Date.now() + 2 * 60_000,
    });
    await ctx.db.patch(state._id, { lastLeadListId: selected.leadListId });
    return { leadId: lead._id, username: lead.username,
      fullName: lead.fullName,
      isPrivate: lead.isPrivate,
      message: selected.message,
      date,
      screeningToken,
    };
  },
});

export const beginFollow = internalMutation({
  args: { automationId: v.id('automations'), profileId: v.id('profiles'), leadId: v.id('leads'), date: v.string(), now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    const e = await eligibility(ctx, args.automationId, args.profileId);
    const now = args.now ?? Date.now();
    const today = dayKey(now);
    const allowed = !!(lead && lead.senderId === args.profileId &&
      lead.screenedAt !== undefined &&
      lead.classification &&
      e &&
      (e.policy.allowedCategories ?? ['male']).includes(lead.classification) &&
      !lead.followed && lead.followStartedAt === undefined && !lead.dmSent && !lead.dmBlocked && lead.dmStartedAt === undefined &&
      canFollow(e) && today === args.date &&
      (!lead.outreachListId || ((await ctx.db.get(lead.outreachListId)) && lead.outreachAutomationId === args.automationId && profileOutreachRoutes(e.policy, args.profileId).some(
            (route) => route.leadListId === lead.outreachListId,
          ))));
    if (!allowed || !lead || !e) return false;
    // Screening already reserves the initial day's slot. A later-day follow
    // must reserve today's slot in the same transaction as its follow intent.
    if (dayKey(lead.screenedAt!) !== today) {
      const state = await ensureProgress(ctx, args.profileId);
      const { used, allowance, followed } = dailyOutreachQuota(e.policy, state, today);
      if (used >= allowance) return false;
      await ctx.db.patch(state._id, { outreachQuotaDate: today, outreachUsedToday: used + 1, outreachAllowanceToday: allowance,
        followedToday: followed, updatedAt: now });
    }
    // Persist cleanup intent before the browser click, including a lost confirmation/restart.
    await ctx.db.patch(lead._id, { followStartedAt: now, unfollowAt: now + (lead.unfollowDays ?? 7) * 86_400_000,
    });
    return true;
  },
});

const outreachArgs = { automationId: v.id('automations'), profileId: v.id('profiles') };

export function pendingDm(lead: Doc<'leads'>, profileId: Id<'profiles'>, now: number) {
  if (lead.senderId !== profileId || lead.dmSent || lead.dmBlocked || lead.dmStartedAt !== undefined) return false;
  return lead.followed && lead.followDate !== undefined && dayKey(lead.followDate) < dayKey(now) &&
    (lead.unfollowAt ?? lead.followDate + followDelay) > now;
}

function hasPostEngagement(lead: Doc<'leads'>) {
  return lead.postEngagement !== undefined && lead.followDate !== undefined && lead.postEngagement.at >= lead.followDate;
}

function hasNotificationEvidence(lead: Doc<'leads'>) {
  return hasPostEngagement(lead) || (lead.followBackAt !== undefined && lead.followDate !== undefined && lead.followBackAt >= lead.followDate);
}

/** Scan notifications once daily while followed leads are awaiting engagement. */
export const notifications = internalQuery({
  args: outreachArgs,
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId);
    const date = dayKey(), now = Date.now();
    if (!canOutreach(e) || e.state?.lastNotificationsDate === date) return null;
    const routes = e.routes;
    for await (const lead of ctx.db.query('leads').withIndex('by_follow_due', q =>
      q.eq('senderId', args.profileId).eq('followed', true).gt('followDate', undefined).lt('followDate', Date.parse(date)))) {
      if (pendingDm(lead, args.profileId, now) && lead.outreachAutomationId === args.automationId &&
        lead.classification && (e.policy.allowedCategories ?? ['male']).includes(lead.classification) &&
        routes.some(route => route.leadListId === lead.outreachListId)) {
        return { date, since: Math.max(lead.followDate!, (e.state?.lastNotificationsAt ?? 0) - 86_400_000) };
      }
    }
    return null;
  },
});

/** Queue followed leads with a follow-back, a like on our post, or a comment on our post. */
export const recordNotifications = internalMutation({
  args: { ...outreachArgs, date: v.string(), events: v.array(v.object({ username: v.string(),
    kind: v.union(v.literal('follow'), v.literal('like'), v.literal('comment')) })) },
  handler: async (ctx, args) => {
    if (args.events.length > 1000) throw new Error('Too many notification rows');
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!canOutreach(e) || args.date !== dayKey()) return false;
    const routes = e.routes, now = Date.now();
    let requestLikerScan = false;
    for (const event of args.events) {
      const username = event.username.trim().toLowerCase();
      const leads = await ctx.db.query('leads').withIndex('by_username', q => q.eq('username', username)).collect();
      for (const lead of leads) {
        if (pendingDm(lead, args.profileId, now) && lead.outreachAutomationId === args.automationId &&
          lead.classification && (e.policy.allowedCategories ?? ['male']).includes(lead.classification) &&
          routes.some(route => route.leadListId === lead.outreachListId) &&
          lead.outreachListId && await ctx.db.get(lead.outreachListId)) {
          if (event.kind === 'like') requestLikerScan = true;
          await ctx.db.patch(lead._id, { dmEligible: true, ...(event.kind === 'follow'
            ? { followBackAt: now } : { postEngagement: { kind: event.kind, at: now } }) });
        }
      }
    }
    const state = await ensureProgress(ctx, args.profileId);
    await ctx.db.patch(state._id, { lastNotificationsDate: args.date, lastNotificationsAt: now });
    return requestLikerScan;
  },
});

export const dmTasks = internalQuery({
  args: outreachArgs,
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!canOutreach(e)) return [];
    const routes = e.routes;
    const tasks = [];
    for await (const lead of ctx.db.query('leads').withIndex('by_dm_pending', (q) =>
      q.eq('senderId', args.profileId).eq('dmEligible', true).eq('dmStartedAt', undefined),
      )) {
      const route = routes.find((route) => route.leadListId === lead.outreachListId);
      if (
        lead.classification &&
        (e.policy.allowedCategories ?? ['male']).includes(lead.classification) &&
        pendingDm(lead, args.profileId, Date.now()) && hasNotificationEvidence(lead) &&
        route && lead.outreachAutomationId === args.automationId &&
        (await ctx.db.get(route.leadListId))
      ) {
        tasks.push({ leadId: lead._id, username: lead.username,
          fullName: lead.fullName, message: route.message, date: dayKey(),
          ...(hasPostEngagement(lead) ? { engagement: lead.postEngagement!.kind } : {}),
        });
        if (tasks.length === 50) return tasks; // More than can fit in a single browser session.
      }
    }
    return tasks;
  },
});

/** Atomically authorize one Send after qualifying notification evidence. */
export const beginSend = internalMutation({
  args: { ...outreachArgs, leadId: v.id('leads'), date: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const lead = await ctx.db.get(args.leadId);
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!lead || !canOutreach(e) || !lead.classification ||
      !(e.policy.allowedCategories ?? ['male']).includes(lead.classification) ||
      !lead.dmEligible || !hasNotificationEvidence(lead) || !pendingDm(lead, args.profileId, now) ||
      dayKey(now) !== args.date ||
      lead.outreachAutomationId !== args.automationId || !lead.outreachListId ||
      !(await ctx.db.get(lead.outreachListId)) ||
      !profileOutreachRoutes(e.policy, args.profileId).some(
        (route) => route.leadListId === lead.outreachListId,
      )) return false;
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
  args: { profileId: v.id('profiles'), leadId: v.id('leads'), date: v.string(), sent: v.boolean(), blocked: v.optional(v.boolean()),
  },
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
        dmCountDate: args.date,
        sentToday: (state.dmCountDate === args.date ? (state.sentToday ?? 0) : 0) + 1,
      });
    } else if (args.blocked) {
      // A confirmed blocked message is never retried.
      await ctx.db.patch(lead._id, { dmBlocked: true });
    } else {
      await ctx.db.patch(state._id, {
        issue: 'Delivery could not be confirmed. Check Instagram before clearing this issue; the claimed lead will not be retried.',
      });
    }
  },
});

const followDelay = 7 * 24 * 60 * 60_000;

function outreachDayProgress(state: Doc<'accountProgress'>, date: string) {
  const firstToday = (state.lastOutreachDate ?? state.lastFollowDate) !== date;
  return {
    outreachIncrease: (state.outreachIncrease ?? 0) + (firstToday ? 1 + Math.floor(Math.random() * 4) : 0),
    lastOutreachDate: date,
  };
}
export const followTasks = internalQuery({
  args: { automationId: v.id('automations'), profileId: v.id('profiles'), now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!e || (e.profile.igAccountId && e.igAccount?.status !== 'connected')) return [];
    const now = args.now ?? Date.now();
    const due = await ctx.db.query('leads').withIndex('by_unfollow_due', (q) => q.eq('senderId', args.profileId).eq('followed', true).gt('unfollowAt', undefined).lte('unfollowAt', now),
      ).take(5);
    // Existing follows without a saved deadline retain their original seven-day delay.
    if (due.length < 5) due.push(...(await ctx.db.query('leads')
      .withIndex('by_follow_due', (q) => q.eq('senderId', args.profileId).eq('followed', true).gt('followDate', undefined).lte('followDate', now - followDelay),
          )
      .filter((q) => q.eq(q.field('unfollowAt'), undefined)).take(5 - due.length)),
      )
    if (due.length < 5) due.push(...(await ctx.db.query('leads')
      .withIndex('by_unfollow_due', (q) => q.eq('senderId', args.profileId).eq('followed', false).gt('unfollowAt', undefined).lte('unfollowAt', now),
          )
      .filter((q) => q.neq(q.field('followStartedAt'), undefined)).take(5 - due.length)),
      )
    return due.map((lead) => ({ leadId: lead._id, username: lead.username }));
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
      dmEligible: false,
    } : { dmEligible: false, followStartedAt: undefined }),
    });
    if (args.followed) {
      await setLeadAvailability(ctx, lead._id, false);
      const state = await ensureProgress(ctx, args.profileId);
      const date = dayKey(now);
      await recordActivity(ctx, date, { follows: 1 });
      await ctx.db.patch(state._id, {
        ...outreachDayProgress(state, date),
        lastFollowDate: date,
        ...(state.outreachQuotaDate === date ? { followedToday: (state.followedToday ?? 0) + 1 } : {}),
      });
    }
  },
})
