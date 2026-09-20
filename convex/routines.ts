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
      const attempts = await ctx.db
        .query("outreachAttempts")
        .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
        .collect();
      for (const attempt of attempts.filter((a) =>
        ["reserved", "sending", "uncertain"].includes(a.status),
      )) {
        const lead = await ctx.db.get(attempt.leadId);
        if (lead && ["reserved", "uncertain"].includes(lead.status))
          throw new Error("Review uncertain deliveries in Leads first");
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
      .query("outreachAttempts")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (old) {
      if (
        old.profileId !== args.profileId ||
        old.automationId !== args.automationId
      )
        throw new Error("Request ID already used");
      return old.status === "reserved"
        ? {
            attemptId: old._id,
            username: (await ctx.db.get(old.leadId))!.username,
            message: old.message,
          }
        : null;
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
    const pending = (
      await ctx.db
        .query("outreachAttempts")
        .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
        .collect()
    ).find((a) => a.status === "reserved" || a.status === "sending");
    if (pending) {
      await ctx.db.patch(state._id, {
        issue:
          "Interrupted delivery: review the recipient in Leads before resuming",
      });
      await ctx.db.patch(pending._id, {
        status: "uncertain",
        updatedAt: Date.now(),
      });
      const lead = await ctx.db.get(pending.leadId);
      if (lead?.status === "reserved")
        await ctx.db.patch(lead._id, { status: "uncertain" });
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
    ).find((l) => !l.senderId && l.listIds.includes(e.policy.leadListId!));
    if (!lead) return null;
    const now = Date.now();
    const message = e.policy.message.replaceAll("{{username}}", lead.username);
    const attemptId = await ctx.db.insert("outreachAttempts", {
      ...args,
      leadId: lead._id,
      date: e.date,
      message,
      status: "reserved",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(lead._id, {
      status: "reserved",
      senderId: args.profileId,
      updatedAt: now,
    });
    await ctx.db.patch(state._id, {
      date: e.date,
      used: used + 1,
      allowance,
      updatedAt: now,
    });
    return { attemptId, username: lead.username, message };
  },
});

export const beginSend = internalMutation({
  args: { attemptId: v.id("outreachAttempts") },
  handler: async (ctx, { attemptId }) => {
    const a = await ctx.db.get(attemptId);
    if (!a || a.status !== "reserved") return false;
    const e = await eligibility(ctx, a.automationId, a.profileId);
    const lead = await ctx.db.get(a.leadId);
    if (
      !e ||
      !e.profile.outreachReady ||
      !e.policy.outreachEnabled ||
      e.date !== a.date ||
      lead?.status !== "reserved"
    ) {
      await ctx.db.patch(a._id, { status: "cancelled", updatedAt: Date.now() });
      if (lead?.status === "reserved")
        await ctx.db.patch(lead._id, { status: "ready", senderId: undefined });
      return false;
    }
    await ctx.db.patch(a._id, { status: "sending", updatedAt: Date.now() });
    return true;
  },
});

export const finishSend = internalMutation({
  args: { attemptId: v.id("outreachAttempts"), sent: v.boolean() },
  handler: async (ctx, { attemptId, sent }) => {
    const a = await ctx.db.get(attemptId);
    if (!a || !["reserved", "sending"].includes(a.status)) return;
    if (a.status === "reserved" && sent)
      throw new Error("Send was not authorized");
    await ctx.db.patch(a._id, {
      status: sent ? "sent" : "uncertain",
      updatedAt: Date.now(),
    });
    const lead = await ctx.db.get(a.leadId);
    if (lead && lead.status === "reserved")
      await ctx.db.patch(lead._id, {
        status: sent ? "contacted" : "uncertain",
        updatedAt: Date.now(),
      });
    const state = await progress(ctx, a.profileId);
    if (state)
      await ctx.db.patch(
        state._id,
        sent
          ? {
              outreachDays:
                state.outreachDays +
                (state.lastOutreachDate !== a.date ? 1 : 0),
              lastOutreachDate: a.date,
            }
          : {
              issue:
                "Delivery uncertain: review the recipient in Leads before resuming",
            },
      );
  },
});
