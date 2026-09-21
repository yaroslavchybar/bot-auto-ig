import type { HttpRouter } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { jsonResponse, parseBody, withErrorHandling } from "./shared";

export function registerRoutineRoutes(http: HttpRouter) {
  http.route({ path: '/api/routines/follow-tasks', method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const b = await parseBody(request);
    return jsonResponse(await ctx.runQuery(internal.routines.followTasks, { automationId: b.automationId as Id<'automations'>, profileId: b.profileId as Id<'profiles'> }));
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
        await ctx.runQuery(internal.routines.beginSend, {
          automationId: b.automationId as Id<"automations">,
          profileId: b.profileId as Id<"profiles">,
          leadId: b.leadId as Id<"leads">,
          date: String(b.date),
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
