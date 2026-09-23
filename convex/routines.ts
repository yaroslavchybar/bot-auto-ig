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
import { dmAllowance, dayKey, routineLists } from "./routinePolicy";
import { requireServerBridgeAuth } from "./serverBridgeAuth";
import { leadAvailable, setLeadAvailability } from './leadMemberships';

const progress = (ctx: QueryCtx, profileId: Id<"profiles">) =>
  ctx.db
    .query("accountProgress")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();

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
    state = await progress(ctx, profileId);
  if (
    !a?.routine ||
    !a.isActive ||
    !p ||
    p.status === "deleting" ||
    p.renameFrom
  )
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
        const state = await progress(ctx, p._id);
        const date = dayKey();
        return {
          profileId: p._id,
          name: p.name,
          paused: state?.paused ?? false,
          issue: state?.issue,
          stage: !p.igLoggedIn
            ? "Not logged in"
            : !p.outreachReady ||
                (state?.activeDays ?? 0) + 1 <
                  (a.routine?.outreachStartDay ?? 7)
              ? "Warm-up"
              : "Outreach",
          activeDays: state?.activeDays ?? 0,
          used: state?.date === date ? state.used : 0,
          allowance:
            a.routine && p.outreachReady
              ? state?.date === date
                ? state.allowance
                : dmAllowance(
                    a.routine,
                    state?.activeDays ?? 0,
                    state?.outreachDays ?? 0,
                  )
              : 0,
          nextRunAt: state?.nextRunAt,
        };
      }),
    );
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
    if (args.checkpoint) return true;
    const now = args.now ?? Date.now();
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
    await ctx.db.patch(state._id, {
      activeDays:
        state.activeDays +
        (dailyCompleted && state.lastActivityDate !== date ? 1 : 0),
      ...(dailyCompleted ? { lastActivityDate: date } : {}),
      ...(args.issue ? { issue: args.issue } : {}),
      nextRunAt: warmup?.nextRunAt ?? Date.now() + 60 * 60_000,
      updatedAt: Date.now(),
    });
    if (args.issue && /login|challenge|checkpoint/i.test(args.issue))
      await ctx.db.patch(args.profileId, { igLoggedIn: false });
  },
});

/** Claim once before opening Instagram. A claimed lead is never automatically retried. */
export const reserve = internalMutation({
  args: { automationId: v.id('automations'), profileId: v.id('profiles') },
  handler: async (ctx, args) => {
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (!e || !e.profile.outreachReady || !e.policy.outreachEnabled || !e.policy.leadListId) return null;
    if (!await ctx.db.get(e.policy.leadListId)) return null;
    const date = dayKey();
    const state = await ensureProgress(ctx, args.profileId);
    const used = state.date === date ? state.used : 0;
    const activeBeforeToday = state.activeDays - (state.lastActivityDate === date ? 1 : 0);
    const outreachBeforeToday = state.outreachDays - (state.lastOutreachDate === date ? 1 : 0);
    const allowance = Math.min(e.policy.maxDms, state.date === date ? state.allowance : dmAllowance(e.policy, activeBeforeToday, outreachBeforeToday));
    if (used >= allowance) return null;
    let lead: Doc<'leads'> | undefined;
    for await (const membership of ctx.db.query('leadMemberships')
      .withIndex('by_list_available', q => q.eq('listId', e.policy.leadListId!).eq('available', true))) {
      const candidate = await ctx.db.get(membership.leadId);
      if (candidate && leadAvailable(candidate)) { lead = candidate; break; }
      await ctx.db.patch(membership._id, { available: false });
    }
    if (!lead) return null;
    await ctx.db.patch(lead._id, { senderId: args.profileId });
    await setLeadAvailability(ctx, lead._id, false);
    await ctx.db.patch(state._id, { date, used: used + 1, allowance, updatedAt: Date.now() });
    return { leadId: lead._id, username: lead.username, message: e.policy.message.replaceAll('{{username}}', lead.username), date };
  },
});

export const beginSend = internalQuery({
  args: { automationId: v.id('automations'), profileId: v.id('profiles'), leadId: v.id('leads'), date: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    const e = await eligibility(ctx, args.automationId, args.profileId);
    const today = dayKey(args.now ?? Date.now());
    return !!(lead && lead.senderId === args.profileId && !lead.dmSent && e && e.profile.outreachReady && e.policy.outreachEnabled && today === args.date);
  },
});

export const finishSend = internalMutation({
  args: { profileId: v.id('profiles'), leadId: v.id('leads'), date: v.string(), sent: v.boolean(), blocked: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.senderId !== args.profileId) throw new Error('Lead belongs to another sender');
    if (lead.dmSent) return;
    if (args.sent) {
      await ctx.db.patch(lead._id, { dmSent: true });
      await setLeadAvailability(ctx, lead._id, false);
    }
    const state = await progress(ctx, args.profileId);
    if (!state) return;
    if (args.sent) {
      await ctx.db.patch(state._id, {
        outreachDays: state.outreachDays + (state.lastOutreachDate !== args.date ? 1 : 0),
        lastOutreachDate: args.date,
      });
    } else if (!args.blocked) {
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
    if (!await eligibility(ctx, args.automationId, args.profileId)) return [];
    const due = await ctx.db.query('leads').withIndex('by_follow_due', q => q.eq('senderId', args.profileId).eq('followed', true).gt('followDate', undefined).lte('followDate', (args.now ?? Date.now()) - followDelay)).take(5);
    return due.map(lead => ({ leadId: lead._id, username: lead.username }));
  },
});

export const recordFollow = internalMutation({
  args: { profileId: v.id('profiles'), leadId: v.id('leads'), followed: v.boolean() },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.senderId !== args.profileId) throw new Error('Follow belongs to another profile');
    if (args.followed === lead.followed) return;
    if (!args.followed && (lead.followDate ?? Infinity) > Date.now() - followDelay) throw new Error('Follow is not due for removal');
    await ctx.db.patch(lead._id, { followed: args.followed, ...(args.followed ? { followDate: Date.now() } : {}) });
    if (args.followed) await setLeadAvailability(ctx, lead._id, false);
  },
});
