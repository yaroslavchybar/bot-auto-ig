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
    date: dayKey(),
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
    // Unresolved deliveries must be reviewed in Leads before resuming the account.
    if (args.clearIssue) {
      for (const state of ['reserved', 'sending', 'uncertain'] as const) {
        const lead = await ctx.db.query('leads').withIndex('by_sender_delivery', q =>
          q.eq('senderId', args.profileId).eq('delivery.state', state)).first();
        if (lead) throw new Error('Review uncertain deliveries in Leads first');
      }
    }
    await ctx.db.patch(state._id, {
      ...(args.paused !== undefined ? { paused: args.paused } : {}),
      ...(args.clearIssue ? { issue: undefined } : {}),
      updatedAt: Date.now(),
    });
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
  },
  handler: async (ctx, args) => {
    const result = await eligibility(ctx, args.automationId, args.profileId);
    if (!result) return false;
    if (args.checkpoint) return true;
    const warmup = await ctx.db
      .query("warmupStates")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .unique();
    return (
      (result.state?.nextRunAt ?? 0) <= Date.now() &&
      (warmup?.nextRunAt ?? 0) <= Date.now() &&
      (!warmup ||
        warmup.date !== dayKey() ||
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

/** Atomically reserve a recipient and consume today's account allowance. */
export const reserve = internalMutation({
  args: {
    automationId: v.id("automations"),
    profileId: v.id("profiles"),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("leads")
      .withIndex("by_request", (q) => q.eq("delivery.requestId", args.requestId))
      .unique();
    if (old) {
      if (old.delivery!.state !== 'reserved' || old.dmSent) return null;
      if (
        old.senderId !== args.profileId ||
        old.delivery!.automationId !== args.automationId
      )
        throw new Error("Request ID already used");
      return {
            requestId: old.delivery!.requestId,
            username: old.username,
            message: old.delivery!.message,
          };
    }
    const e = await eligibility(ctx, args.automationId, args.profileId);
    if (
      !e ||
      !e.profile.outreachReady ||
      !e.policy.outreachEnabled ||
      !e.policy.leadListId
    )
      return null;
    const state = await ensureProgress(ctx, args.profileId);
    for (const deliveryState of ['reserved', 'sending', 'uncertain'] as const) {
      const pending = await ctx.db.query('leads').withIndex('by_sender_delivery', q =>
        q.eq('senderId', args.profileId).eq('delivery.state', deliveryState)).first();
      if (!pending) continue;
      await ctx.db.patch(state._id, { issue: 'Interrupted delivery: review the recipient in Leads before resuming' });
      await ctx.db.patch(pending._id, {
        status: 'uncertain', delivery: { ...pending.delivery!, state: 'uncertain' }, updatedAt: Date.now(),
      });
      return null;
    }
    const used = state.date === e.date ? state.used : 0;
    const activeBeforeToday =
      state.activeDays - (state.lastActivityDate === e.date ? 1 : 0);
    const outreachBeforeToday =
      state.outreachDays - (state.lastOutreachDate === e.date ? 1 : 0);
    const allowance = Math.min(
      e.policy.maxDms,
      state.date === e.date
        ? state.allowance
        : dmAllowance(e.policy, activeBeforeToday, outreachBeforeToday),
    );
    if (used >= allowance) return null;
    const lead = (
      await ctx.db
        .query("leads")
        .withIndex("by_status", (q) => q.eq("status", "ready"))
        .collect()
    ).find((l) => !l.dmSent && !l.senderId && l.listIds.includes(e.policy.leadListId!));
    if (!lead) return null;
    const now = Date.now();
    const message = e.policy.message.replaceAll("{{username}}", lead.username);
    await ctx.db.patch(lead._id, {
      status: 'reserved', senderId: args.profileId, dmSent: false,
      delivery: { requestId: args.requestId, automationId: args.automationId, date: e.date, message, state: 'reserved' },
      updatedAt: now,
    });
    await ctx.db.patch(state._id, {
      date: e.date,
      used: used + 1,
      allowance,
      updatedAt: now,
    });
    return { requestId: args.requestId, username: lead.username, message };
  },
});

// Requests identify a particular reservation, so stale callbacks cannot change a newer send.
export const beginSend = internalMutation({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    const lead = await ctx.db.query('leads').withIndex('by_request', q => q.eq('delivery.requestId', requestId)).unique();
    const delivery = lead?.delivery;
    if (!lead || !delivery || delivery.state !== 'reserved' || lead.dmSent || !lead.senderId) return false;
    const e = await eligibility(ctx, delivery.automationId, lead.senderId);
    if (!e || !e.profile.outreachReady || !e.policy.outreachEnabled || e.date !== delivery.date || lead.status !== 'reserved') {
      await ctx.db.patch(lead._id, {
        delivery: { ...delivery, state: 'cancelled' }, updatedAt: Date.now(),
        ...(lead.status === 'reserved' ? { status: 'ready' as const, senderId: undefined } : {}),
      });
      return false;
    }
    await ctx.db.patch(lead._id, { delivery: { ...delivery, state: 'sending' }, updatedAt: Date.now() });
    return true;
  },
});

export const finishSend = internalMutation({
  args: { requestId: v.string(), sent: v.boolean() },
  handler: async (ctx, { requestId, sent }) => {
    const lead = await ctx.db.query('leads').withIndex('by_request', q => q.eq('delivery.requestId', requestId)).unique();
    const delivery = lead?.delivery;
    if (!lead || !delivery || !['reserved', 'sending'].includes(delivery.state) || !lead.senderId) return;
    if (delivery.state === 'reserved' && sent) throw new Error('Send was not authorized');
    await ctx.db.patch(lead._id, {
      delivery: { ...delivery, state: sent ? 'sent' : 'uncertain' },
      dmSent: sent,
      status: sent ? 'contacted' : 'uncertain', updatedAt: Date.now(),
    });
    const state = await progress(ctx, lead.senderId);
    if (state) await ctx.db.patch(state._id, sent ? {
      outreachDays: state.outreachDays + (state.lastOutreachDate !== delivery.date ? 1 : 0),
      lastOutreachDate: delivery.date,
    } : { issue: 'Delivery uncertain: review the recipient in Leads before resuming' });
  },
});

const followDelay = 7 * 24 * 60 * 60_000;

/** Persist intent before clicking Follow so interrupted actions can be checked later. */
export const beginFollow = internalMutation({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    const lead = await ctx.db.query('leads').withIndex('by_request', q => q.eq('delivery.requestId', requestId)).unique();
    if (!lead?.delivery || !lead.senderId || lead.status !== 'reserved' || lead.delivery.state !== 'reserved' || lead.followed || lead.followPending) return null;
    const e = await eligibility(ctx, lead.delivery.automationId, lead.senderId);
    if (!e || !e.profile.outreachReady || !e.policy.outreachEnabled || e.date !== lead.delivery.date) return null;
    await ctx.db.patch(lead._id, { followedBy: lead.senderId, followPending: true, updatedAt: Date.now() });
    return lead._id;
  },
});

export const followTasks = internalQuery({
  args: { automationId: v.id('automations'), profileId: v.id('profiles') },
  handler: async (ctx, args) => {
    if (!await eligibility(ctx, args.automationId, args.profileId)) return [];
    const pending = await ctx.db.query('leads').withIndex('by_follow_pending', q => q.eq('followedBy', args.profileId).eq('followPending', true)).take(5);
    const due = await ctx.db.query('leads').withIndex('by_follow_due', q => q.eq('followedBy', args.profileId).eq('followed', true).gt('followDate', undefined).lte('followDate', Date.now() - followDelay)).take(5);
    return [...pending, ...due].map(lead => ({ leadId: lead._id, username: lead.username, recover: lead.followPending === true }));
  },
});

export const recordFollow = internalMutation({
  args: { automationId: v.id('automations'), profileId: v.id('profiles'), leadId: v.id('leads'), followed: v.boolean() },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    // Recording an observed result must still work if the automation was disabled during the click.
    if (!lead || lead.followedBy !== args.profileId) throw new Error('Follow belongs to another profile');
    if (!lead.followPending && args.followed === lead.followed) return;
    if (args.followed && !lead.followPending) throw new Error('Follow was not authorized');
    if (!args.followed && !lead.followPending && (lead.followDate ?? Infinity) > Date.now() - followDelay) throw new Error('Follow is not due for removal');
    await ctx.db.patch(lead._id, {
      followed: args.followed, followPending: false,
      ...(args.followed ? { followDate: Date.now() } : {}), updatedAt: Date.now(),
    });
  },
});
