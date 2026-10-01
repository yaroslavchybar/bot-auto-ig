import type { Page } from "playwright-core";
import {
  routineReady,
  routineTarget,
  routineReserve,
  routineBeginSend,
  routineFinishSend,
  routineRecordSession,
  routineFollowTasks,
  routineRecordFollow,
  type DbAutomationRow,
} from "../shared/convexClient.js";
import { runWarmup } from "./warmup.js";
import { scheduleRoutine } from './routine-schedule.js';
import { followButton, followingButton, isFollowing, messageButton, messageComposer, messageWasBlocked, unfollow, unsendMessage } from './follow.js';
import type { ActionLogger, StopCheck } from "./actions/shared.js";
import { sleep, random } from "./actions/shared.js";

const dependencies = {
  ready: routineReady,
  target: routineTarget,
  now: Date.now,
  reserve: routineReserve,
  begin: routineBeginSend,
  finish: routineFinishSend,
  record: routineRecordSession,
  warmup: runWarmup,
  followTasks: routineFollowTasks,
  recordFollow: routineRecordFollow,
  sleep,
  random,
};

/** Check membership at action boundaries; live subscriptions stop active work. */
export async function runRoutineSession(
  automation: DbAutomationRow,
  profileId: string,
  page: Page,
  log: ActionLogger,
  stopped: StopCheck,
  deps = dependencies,
  liveAccess?: () => boolean,
) {
  let allowed = true,
    checking = false,
    activityCompleted = false,
    hadActivity = false;
  const check = async (forceRemote = false) => {
    if (checking) return;
    if (liveAccess && !liveAccess()) {
      allowed = false;
      return;
    }
    if (liveAccess && !forceRemote) return;
    checking = true;
    try {
      allowed = await deps.ready(automation._id, profileId, true);
    } catch {
      allowed = false;
    } finally {
      checking = false;
    }
  };
  let deadline = Infinity;
  const timeout = (ms: number) => Math.max(1, Math.min(ms, deadline - deps.now()));
  const shouldStop = () => deps.now() >= deadline || stopped() || !allowed || Boolean(liveAccess && !liveAccess());
  const followIfNeeded = async (leadId: string, date: string) => {
    // Wait for the profile relationship controls before deciding whether to follow.
    // Existing follows and requests are never claimed as automation-created follows.
    if (await isFollowing(page)) return false;
    const follow = followButton(page);
    await check();
    if (shouldStop()) throw new Error('Session stopped before following');
    if (!await deps.begin(automation._id, profileId, leadId, date))
      throw new Error('Follow was not authorized');
    if (shouldStop()) throw new Error('Session stopped before following');
    await follow.click({ timeout: 10_000 });
    await followingButton(page).waitFor({ state: 'visible', timeout: 15_000 });
    await deps.recordFollow(profileId, leadId, true);
    return true;
  };
  let issue: string | undefined;
  try {
    await check(true);
    if (shouldStop()) return;
    if (/\/accounts\/login|\/challenge|\/checkpoint/.test(page.url()))
      throw new Error("Instagram login or challenge needs attention");
    const cleanup = async () => {
      for (const task of await deps.followTasks(automation._id, profileId)) {
        await check();
        if (shouldStop()) return;
        await page.goto(`https://www.instagram.com/${task.username}/`, { waitUntil: 'domcontentloaded', timeout: timeout(30_000) });
        const removed = await unfollow(page, async () => { await check(); return !shouldStop(); });
        if (!removed) return;
        await deps.recordFollow(profileId, task.leadId, false);
        log({ event: 'automation.routine.unfollowed', message: `Unfollowed @${task.username} after the scheduled delay` });
      }
    };
    const warmup = await deps.warmup(
      profileId,
      automation._id,
      automation.routine!.activity,
      page,
      log,
      () => stopped() || !allowed || Boolean(liveAccess && !liveAccess()),
      undefined,
      async session => {
        deadline = session.deadline;
        try {
          await cleanup();
        } catch (error) {
          if (shouldStop()) return 'stopped';
          throw error;
        }
        return scheduleRoutine(session, {
          target: () => deps.target(automation._id, profileId),
          now: deps.now, random: deps.random, sleep: deps.sleep,
          stopped: () => stopped() || !allowed || Boolean(liveAccess && !liveAccess()), log,
          send: async () => {
            await check(true);
            if (/\/accounts\/login|\/challenge|\/checkpoint/.test(page.url()))
              throw new Error('Instagram login or challenge needs attention');
            if (shouldStop()) return 'unavailable';
            const attempt = await deps.reserve(
              automation._id,
              profileId,
            );
            if (!attempt) {
              log({ event: 'automation.routine.eligible_recipient_available_for_the', message: 'No eligible recipient available for the remaining DM target' });
              return 'unavailable';
            }
            // Navigation and composer preparation happen before permission to press Send.
            let sendAttempted = false;
            try {
              await page.goto(`https://www.instagram.com/${attempt.username}/`, {
                waitUntil: "domcontentloaded",
                timeout: 30_000,
              });
              await followIfNeeded(attempt.leadId, attempt.date);
              await messageButton(page).click({ timeout: 15_000 });
              // Current Instagram keeps the profile URL and opens the composer in
              // an overlay, so the composer is the navigation-complete signal.
              const composer = messageComposer(page);
              await composer.waitFor({ state: 'visible', timeout: 15_000 });
              await composer.fill(attempt.message, { timeout: 15_000 });
              await check(true);
              if (shouldStop()) return 'unavailable';
              if (!(await deps.begin(automation._id, profileId, attempt.leadId, attempt.date))) return 'unavailable';
              if (shouldStop()) return 'unavailable';
              let sent = false;
              let blocked = false;
              try {
                sendAttempted = true;
                await composer.press("Enter", { timeout: 10_000 });
                // A cleared composer alone is insufficient: require the outgoing message in the thread.
                await page
                  .getByText(attempt.message, { exact: true })
                  .last()
                  .waitFor({ state: "visible", timeout: 15_000 });
                if (await messageWasBlocked(page)) {
                  await unsendMessage(page, attempt.message);
                  blocked = true;
                } else {
                  sent = true;
                }
              } finally {
                await deps.finish(profileId, attempt.leadId, attempt.date, sent, blocked);
              }
              log({ event: 'automation.dm_result', targetUsername: attempt.username, sent, blocked, message: blocked
                ? `Message blocked for @${attempt.username}; followed and unsent`
                : `Message sent to @${attempt.username}` });
              return sent ? 'sent' : 'blocked';
            } catch (error) {
              if (!sendAttempted) {
                if (shouldStop()) return 'unavailable';
                throw error;
              }
              throw new Error(
                `Delivery needs review: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          },
        });
      },
    );
    hadActivity = warmup.minutes > 0;
    activityCompleted = hadActivity && warmup.reason === 'finished';
    const target = await deps.target(automation._id, profileId).catch(() => null);
    if (target && target.target > 0) log({ event: 'automation.daily_dm_target', sentCount: target.sent, targetCount: target.target });
  } catch (error) {
    issue = error instanceof Error ? error.message : String(error);
    log({ event: 'automation.routine_result', error, outcome: 'error' });
  } finally {
    await deps.record(automation._id, profileId, activityCompleted, issue);
  }
  return hadActivity && !issue;
}
