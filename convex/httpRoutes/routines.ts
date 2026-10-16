import type { HttpRouter } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { jsonResponse, parseBody, withErrorHandling } from "./shared";

export function registerRoutineRoutes(http: HttpRouter) {
  http.route({
    path: '/api/routines/screening',
    method: 'POST',
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request)
      return jsonResponse(
        await ctx.runMutation(internal.leadScreening.finish, {
          automationId: b.automationId,
          profileId: b.profileId,
          leadId: b.leadId,
          screeningToken: b.screeningToken,
          date: b.date,
          category: b.category,
          confidence: b.confidence,
          model: b.model,
          followCheckPassed: b.followCheckPassed,
          failureReason: b.failureReason,
        }),
      )
    }),
  })

  for (const [path, endpoint] of [
    ['/api/routines/dm-tasks', internal.routines.dmTasks],
  ] as const) http.route({ path, method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    return jsonResponse(await ctx.runQuery(endpoint, {
      automationId: b.automationId as Id<'automations'>, profileId: b.profileId as Id<'profiles'>,
    }));
  }) });
  http.route({ path: '/api/routines/record-dm-check', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    return jsonResponse(await ctx.runMutation(internal.routines.recordDmCheck, {
      automationId: b.automationId as Id<'automations'>, profileId: b.profileId as Id<'profiles'>,
      leadId: b.leadId as Id<'leads'>, date: String(b.date), canMessage: b.canMessage === true,
    }));
  }) });
  http.route({ path: '/api/routines/dismiss-dm', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    await ctx.runMutation(internal.routines.dismissDm, { profileId: b.profileId as Id<'profiles'>, leadId: b.leadId as Id<'leads'> });
    return jsonResponse({ ok: true });
  }) });
  http.route({ path: '/api/routines/begin-follow', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    return jsonResponse(await ctx.runMutation(internal.routines.beginFollow, {
      automationId: b.automationId as Id<'automations'>, profileId: b.profileId as Id<'profiles'>,
      leadId: b.leadId as Id<'leads'>, date: String(b.date),
    }));
  }) });
  http.route({ path: '/api/routines/target', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    return jsonResponse(await ctx.runQuery(internal.routines.target, {
      automationId: b.automationId as Id<'automations'>, profileId: b.profileId as Id<'profiles'>,
    }));
  }) });
  http.route({ path: '/api/routines/follow-tasks', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    return jsonResponse(await ctx.runQuery(internal.routines.followTasks, {
      automationId: b.automationId as Id<'automations'>,
      profileId: b.profileId as Id<'profiles'>,
      now: Date.now(),
    }));
  }) });
  http.route({ path: '/api/routines/record-follow', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    await ctx.runMutation(internal.routines.recordFollow, { profileId: b.profileId as Id<'profiles'>, leadId: b.leadId as Id<'leads'>, followed: b.followed === true });
    return jsonResponse({ ok: true });
  }) });
  http.route({
    path: "/api/routines/ready",
    method: "POST",
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request);
      return jsonResponse(
        await ctx.runQuery(internal.routines.ready, {
          automationId: b.automationId as Id<"automations">,
          profileId: b.profileId as Id<"profiles">,
          checkpoint: b.checkpoint === true,
          now: Date.now(),
        }),
      );
    }),
  });
  http.route({
    path: "/api/routines/session",
    method: "POST",
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request);
      await ctx.runMutation(internal.routines.recordSession, {
        automationId: b.automationId as Id<"automations">,
        profileId: b.profileId as Id<"profiles">,
        activityCompleted: b.activityCompleted === true,
        issue: b.issue,
      });
      return jsonResponse({ ok: true });
    }),
  });
  http.route({
    path: "/api/routines/reserve",
    method: "POST",
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request);
      return jsonResponse(
        await ctx.runMutation(internal.routines.reserve, {
          automationId: b.automationId as Id<"automations">,
          profileId: b.profileId as Id<"profiles">,
        }),
      );
    }),
  });
  http.route({
    path: "/api/routines/begin-send",
    method: "POST",
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request);
      return jsonResponse(
        await ctx.runMutation(internal.routines.beginSend, {
          automationId: b.automationId as Id<"automations">,
          profileId: b.profileId as Id<"profiles">,
          leadId: b.leadId as Id<"leads">,
          date: String(b.date),
          now: Date.now(),
        }),
      );
    }),
  });
  http.route({
    path: "/api/routines/finish-send",
    method: "POST",
    handler: withErrorHandling(async (ctx, request) => {
      const b = await parseBody(request);
      await ctx.runMutation(internal.routines.finishSend, {
        profileId: b.profileId as Id<"profiles">,
        leadId: b.leadId as Id<"leads">,
        date: String(b.date),
        sent: b.sent === true,
        blocked: b.blocked === true,
      });
      return jsonResponse({ ok: true });
    }),
  });
}
