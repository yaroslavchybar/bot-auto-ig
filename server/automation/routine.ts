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
  routineBeginFollow, routineNotifications, routineRecordNotifications, routineDmTasks, routineDismissDm,
  type DbAutomationRow,
  warmupPauseFollows,
  routineFinishScreening,
} from "../shared/convexClient.js";
import { runBrowsingSession } from "./sessions.js";
import { browseUntilEnd, scheduleRoutine } from './routine-schedule.js';
import { followButton, isFollowing, messageButton, messageComposer, messageWasBlocked, unfollow, unsendMessage,
} from './follow.js';
import { renderOutreachMessage } from '../shared/outreachMessage.js';
import { readFollowNotifications, ownUsername, followsUs } from './follow-back.js';
import type { ActionLogger, StopCheck } from "./actions/shared.js";
import { sleep, random } from "./actions/shared.js";
import { assertInstagramReady, checkNotifications } from './actions/instagram-state.js';
import { performProfileFollow } from './actions/follow-safety.js';
import { clickAction } from './actions/action-locator.js'
import { screenLead } from './actions/lead-screening.js'
import { BrowseSession, SessionEnded } from './actions/session.js'
import { openProfileThroughSearch } from './actions/explore.js'
import { errors } from 'playwright-core'
import { isTransientDomIssue } from '../shared/domErrors.js'
import { isTemporaryUiError } from './actions/ui-errors.js'
import { logOperation } from '../shared/logger.js'
import { DecisionRefusedError } from './actions/openrouter-decision.js'
import { beginSessionDecision } from './actions/session-decision.js'
import { browseLeadPosts } from './actions/lead-posts.js'

const dependencies = {
  ready: routineReady,
  target: routineTarget,
  now: Date.now,
  reserve: routineReserve,
  begin: routineBeginSend,
  finish: routineFinishSend,
  record: routineRecordSession,
  session: runBrowsingSession,
  followTasks: routineFollowTasks,
  recordFollow: routineRecordFollow,
  beginFollow: routineBeginFollow,
  notifications: routineNotifications,
  recordNotifications: routineRecordNotifications,
  dmTasks: routineDmTasks,
  dismissDm: routineDismissDm,
  readNotifications: readFollowNotifications,
  checkNotifications,
  ownUsername,
  followsUs,
  sleep,
  random,
  instagram: assertInstagramReady,
  follow: performProfileFollow,
  pauseFollows: warmupPauseFollows,
  screenLead,
  finishScreening: routineFinishScreening,
  searchProfile: openProfileThroughSearch,
  browseLeadPosts,
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
    if (liveAccess && !forceRemote) {
      await deps.instagram(page);
      return;
    }
    checking = true;
    try {
      allowed = await deps.ready(automation._id, profileId, true);
    } catch {
      allowed = false;
    } finally {
      checking = false;
    }
    if (allowed) await deps.instagram(page);
  };
  let deadline = Infinity;
  const timeout = (ms: number) => Math.max(1, Math.min(ms, deadline - deps.now()));
  const shouldStop = () => deps.now() >= deadline || stopped() || !allowed || Boolean(liveAccess && !liveAccess());
  const followIfNeeded = async (leadId: string, date: string, markAttempted: () => void) => {
    // Wait for the profile relationship controls before deciding whether to follow.
    // Existing follows and requests are never claimed as automation-created follows.
    if (await isFollowing(page)) return false;
    const follow = followButton(page);
    await check();
    if (shouldStop()) throw new Error('Session stopped before following');
    if (!(await deps.beginFollow(automation._id, profileId, leadId, date)))
      throw new Error('Follow was not authorized');
    if (shouldStop()) throw new Error('Session stopped before following');
    return deps.follow(page, async () => { await check(); return !shouldStop(); },
      () => { markAttempted(); return clickAction(follow, timeout(10_000)); },
      () => deps.recordFollow(profileId, leadId, true).then(() => {}), async (reason) => {
        log({ event: 'automation.follow_paused', reason });
        await deps.pauseFollows(profileId, date, reason);
      }, timeout(15_000),
    );
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
        await page.goto(`https://www.instagram.com/${task.username}/`, { waitUntil: 'domcontentloaded', timeout: timeout(30_000),
        });
        const removed = await unfollow(page, async () => { await check(); return !shouldStop(); });
        if (!removed) return;
        await deps.recordFollow(profileId, task.leadId, false);
        log({ event: 'automation.routine.unfollowed', message: `Unfollowed @${task.username} after the scheduled delay`,
        });
      }
    };
    const result = await deps.session(
      profileId,
      automation._id,
      { ...automation.routine!.activity,
        warmup_topics: automation.routine!.interests?.map(interest => interest.description) ?? automation.routine!.activity.warmup_topics },
      page,
      log,
      () => stopped() || !allowed || Boolean(liveAccess && !liveAccess()),
      undefined,
      async (session) => {
        deadline = session.deadline;
        if (session.day !== undefined && session.day < 8) return browseUntilEnd(session, {
          now: deps.now, random: deps.random, sleep: deps.sleep, log,
          stopped: () => stopped() || !allowed || Boolean(liveAccess && !liveAccess()),
        });
        try {
          await cleanup();
        } catch (error) {
          if (shouldStop()) return 'stopped';
          throw error;
        }
        if (shouldStop()) return 'stopped';
        const followTarget = await deps.target(automation._id, profileId);
        const dms = await deps.dmTasks(automation._id, profileId);
        const username = dms.length ? await deps.ownUsername(page) : '';
        let followsRemaining = followTarget.remaining;
        let preferDm = true;
        // Both activities share session time, but only new follows consume the daily quota.
        return scheduleRoutine(session, {
          target: async () => ({ target: followsRemaining + dms.length, remaining: followsRemaining + dms.length, sent: 0,
          }),
          now: deps.now, random: deps.random, sleep: deps.sleep,
          stopped: () => stopped() || !allowed || Boolean(liveAccess && !liveAccess()), log,
          send: async () => {
            await check(true);
            if (/\/accounts\/login|\/challenge|\/checkpoint/.test(page.url()))
              throw new Error('Instagram login or challenge needs attention');
            if (shouldStop()) return 'unavailable';
            const isDm = dms.length > 0 && (preferDm || followsRemaining <= 0);
            preferDm = !preferDm;
            const attempt = isDm ? dms.shift()! : await deps.reserve(automation._id, profileId);
            if (!isDm && !attempt) followsRemaining = 0
            if (!attempt) {
              return dms.length ? 'blocked' : 'unavailable';
            }
            return logOperation('automation.recipient_session', {
              profileId, automationId: automation._id, leadId: attempt.leadId,
              targetUsername: attempt.username, kind: isDm ? 'dm' : 'follow',
            }, async (scope): Promise<'sent' | 'followed' | 'blocked' | 'unavailable'> => {
              const timed = async <T>(stage: string, action: () => Promise<T>): Promise<T> => {
                scope.add({ stage });
                const started = deps.now();
                try { return await action(); }
                finally { scope.add({ [`${stage}Ms`]: Math.max(0, deps.now() - started) }); }
              };
              // Navigation and composer preparation happen before permission to press Send.
              let sendAttempted = false;
              let followAttempted = false, screeningFinished = false;
              const token = 'screeningToken' in attempt ? attempt.screeningToken : undefined;
              try {
                const useSearch = !isDm && 'isPrivate' in attempt && attempt.isPrivate === false && deps.random(0, 1) < 0.3;
                let searched = false;
                if (useSearch) {
                  try {
                    searched = await timed('search', () => deps.searchProfile(page, attempt.username,
                      new BrowseSession(Math.min(deadline, Date.now() + 30_000), shouldStop)));
                  } catch (error) {
                    if (shouldStop()) return 'unavailable';
                    await deps.instagram(page);
                    if (!(error instanceof SessionEnded) && !(error instanceof errors.TimeoutError) && !isTransientDomIssue(error)) throw error;
                  }
                }
                if (shouldStop()) return 'unavailable';
                if (!searched) await timed('navigation', () => page.goto(`https://www.instagram.com/${attempt.username}/`, {
                  waitUntil: 'domcontentloaded', timeout: timeout(30_000),
                }));
                await check();
                if (shouldStop()) return 'unavailable';
                scope.add({ route: searched ? 'search' : 'direct' });
                if (!isDm) log({ event: 'automation.routine.profile_navigation', targetUsername: attempt.username,
                  route: searched ? 'search' : 'direct', outcome: searched ? 'opened' : useSearch ? 'fallback' : 'opened' });
                if (!isDm) {
                  if (typeof token !== 'string' || !token) return 'blocked'
                  let decision
                  const reportScreening = beginSessionDecision(page, { kind: 'profile', status: 'checking', username: attempt.username })
                  try {
                    decision = await timed('screening', () => deps.screenLead(
                      page,
                      attempt.username,
                      new BrowseSession(deadline, shouldStop),
                    ))
                  } catch (error) {
                    reportScreening({ kind: 'profile', status: 'unavailable', username: attempt.username })
                    log({
                      event: 'automation.lead_screening_failed',
                      leadId: attempt.leadId,
                      error,
                      outcome: 'skipped',
                    })
                    const refused = error instanceof DecisionRefusedError
                    await deps.finishScreening(
                      automation._id,
                      profileId,
                      attempt.leadId,
                      token,
                      attempt.date,
                      undefined,
                      refused ? 'refused' : undefined,
                    )
                    screeningFinished = true
                    scope.add({ result: refused ? 'screening_refused' : 'screening_failed' })
                    return shouldStop() ? 'unavailable' : 'blocked'
                  }
                  reportScreening({ kind: 'profile', status: 'complete', username: attempt.username,
                    category: decision.category, confidence: decision.confidence })
                  const accepted = await timed('screeningSave', () => deps.finishScreening(
                    automation._id,
                    profileId,
                    attempt.leadId,
                    token,
                    attempt.date,
                    decision,
                  ))
                  screeningFinished = true
                  scope.add({ category: decision.category, confidence: decision.confidence, model: decision.model, accepted });
                  log({
                    event: 'automation.lead_screened',
                    leadId: attempt.leadId,
                    model: decision.model,
                    category: decision.category,
                    confidence: decision.confidence,
                    accepted,
                  })
                  if (!accepted || shouldStop()) return shouldStop() ? 'unavailable' : 'blocked'
                  followsRemaining = Math.max(0, followsRemaining - 1)
                  const browsePosts = async () => {
                    try {
                      await timed('leadPosts', () => deps.browseLeadPosts(page, attempt.username,
                        new BrowseSession(deadline, shouldStop), log))
                    } catch (error) {
                      if (shouldStop()) return
                      await check()
                      if (!(error instanceof SessionEnded) && !isTemporaryUiError(error)) throw error
                      log({ event: 'automation.lead_posts.skipped', targetUsername: attempt.username, error })
                      // Restore the exact recipient if a viewer failed to close or navigation changed.
                      await page.goto(`https://www.instagram.com/${attempt.username}/`, {
                        waitUntil: 'domcontentloaded', timeout: timeout(15_000),
                      })
                    }
                    await check()
                  }
                  const browseFirst = deps.random(0, 1) < 0.5
                  if (browseFirst) await browsePosts()
                  if (shouldStop()) return 'unavailable'
                  const followed = await timed('follow', () => followIfNeeded(attempt.leadId, attempt.date, () => { followAttempted = true; }));
                  scope.add({ followed });
                  log({ event: 'automation.routine.follow_result', targetUsername: attempt.username, followed });
                  if (!browseFirst && followed && !shouldStop()) await browsePosts()
                  return followed ? 'followed' : 'blocked';
                }
                if (!(await isFollowing(page)) || !(await deps.followsUs(page, username))) {
                  await deps.dismissDm(profileId, attempt.leadId);
                  return 'blocked';
                }
                await check();
                if (shouldStop()) return 'unavailable';
                let message: string;
                try {
                  message = renderOutreachMessage(attempt.message, attempt, () => deps.random(0, 1));
                } catch (error) {
                  log({ event: 'automation.routine.invalid_message', leadId: attempt.leadId, targetUsername: attempt.username, error, outcome: 'blocked',
                  });
                  await deps.dismissDm(profileId, attempt.leadId);
                  return 'blocked';
                }
                await clickAction(messageButton(page), 15_000);
                // Current Instagram keeps the profile URL and opens the composer in
                // an overlay, so the composer is the navigation-complete signal.
                const composer = await messageComposer(page);
                await composer.fill(message, { timeout: 15_000 });
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
                    .getByText(message, { exact: true })
                    .last()
                    .waitFor({ state: "visible", timeout: 15_000 });
                  if (await messageWasBlocked(page)) {
                    await unsendMessage(page, message);
                    blocked = true;
                  } else {
                    sent = true;
                  }
                } finally {
                  await deps.finish(profileId, attempt.leadId, attempt.date, sent, blocked);
                }
                log({ event: 'automation.dm_result', targetUsername: attempt.username, sent, blocked, message: blocked
                  ? `Message blocked for @${attempt.username}; unsent`
                  : `Message sent to @${attempt.username}`,
                });
                scope.add({ sent, blocked });
                return sent ? 'sent' : 'blocked';
              } catch (error) {
                if (!sendAttempted) {
                  if (shouldStop()) return 'unavailable';
                  if (!followAttempted && isTemporaryUiError(error)) {
                    await check(true);
                    if (shouldStop()) return 'unavailable';
                    if (!isDm && typeof token === 'string' && token && !screeningFinished)
                      await deps.finishScreening(automation._id, profileId, attempt.leadId, token, attempt.date);
                    log({ event: 'automation.routine.recipient_skipped', targetUsername: attempt.username, error });
                    return 'blocked';
                  }
                  throw error;
                }
                throw new Error(
                  `Delivery needs review: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            });
          },
        });
      },
      async (session, day) => {
        deadline = session.end;
        if (shouldStop()) return;
        const scan = day >= 8 ? await deps.notifications(automation._id, profileId) : null;
        if (shouldStop()) return;
        if (!scan) {
          await deps.checkNotifications(page, log, session);
          return;
        }
        // The due follow-back scan replaces the brief startup visit; it owns opening and closing the panel.
        let names: string[] | null = null;
        try {
          names = await deps.readNotifications(page, shouldStop, scan.since, session);
        } catch (error) {
          if (shouldStop()) return;
          if (!isTemporaryUiError(error)) throw error;
          await check();
          log({ event: 'automation.routine.follow_notifications_skipped', error });
        }
        if (names && !shouldStop()) {
          await deps.recordNotifications(automation._id, profileId, scan.date, names);
          log({ event: 'automation.routine.follow_notifications', followerCount: names.length });
        }
      },
    );
    hadActivity = result.minutes > 0;
    activityCompleted = hadActivity && result.reason === 'finished';
    const target = await deps.target(automation._id, profileId).catch(() => null);
    if (target && target.target > 0) log({ event: 'automation.daily_follow_target', followedCount: target.sent, targetCount: target.target,
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = stopped() && message === 'Browser worker stopped';
    if (!cancelled) issue = message;
    log({ event: 'automation.routine_result', error, outcome: cancelled ? 'cancelled' : 'error' });
  } finally {
    await deps.record(automation._id, profileId, activityCompleted, issue);
  }
  return hadActivity && !issue;
}
