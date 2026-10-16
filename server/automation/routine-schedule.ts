import type { SessionActivity } from './sessions.js';
import type { ActionLogger, StopCheck } from './actions/shared.js';

type Target = { target: number; remaining: number; sent: number };
type Controls = {
  target: () => Promise<Target>;
  send: () => Promise<'sent' | 'followed' | 'blocked' | 'unavailable'>;
  stopped: StopCheck;
  now: () => number;
  random: (min: number, max: number) => number;
  sleep: (ms: number) => Promise<void>;
  log: ActionLogger;
};

type BrowseControls = Pick<Controls, 'now' | 'stopped' | 'random' | 'sleep' | 'log'>;
const pauseBeforeBrowsing = async (deadline: number, reason: string, controls: BrowseControls) => {
  if (reason === 'stalled') controls.log({ event: 'automation.routine.browsing_retry', reason, remainingSeconds: Math.max(0, deadline - controls.now()) / 1000 });
  await controls.sleep(Math.min(controls.random(1000, 3000), Math.max(0, deadline - controls.now())));
};

/** All browsing-only paths share retries, surface limits, and one reservation deadline. */
export async function browseUntilEnd(
  session: Pick<Parameters<SessionActivity>[0], 'deadline' | 'browse'>, controls: BrowseControls,
): ReturnType<SessionActivity> {
  while (!controls.stopped() && controls.now() < session.deadline) {
    const reason = await session.browse((session.deadline - controls.now()) / 60_000);
    if (reason === 'skipped' || reason === 'stopped' || controls.stopped()) return reason;
    await pauseBeforeBrowsing(session.deadline, reason, controls);
  }
  return controls.stopped() ? 'stopped' : 'finished';
}

/** Allocate follow/DM work across active time, mixing feed visits with small batches. */
export async function scheduleRoutine(
  session: Parameters<SessionActivity>[0], controls: Controls,
): ReturnType<SessionActivity> {
  const { now, stopped, random, log } = controls;
  const initial = await controls.target();
  const sessionMs = Math.max(0, session.deadline - now());
  const firstBatchSize = Math.floor(random(3, 6));
  // Spread larger targets across sessions without shrinking the first batch to one account.
  const quota = Math.min(initial.remaining, Math.max(firstBatchSize, Math.ceil(initial.remaining * sessionMs /
    Math.max(sessionMs, session.remainingMinutes * 60_000))));
  let sent = 0;
  let nextSendAt = 0;
  let available = true;
  let retryBrowsing = false;
  const browse = async (ms: number) => {
    if (ms <= 0 || stopped()) return 'stopped' as const;
    return session.browse(ms / 60_000);
  };
  while (!stopped() && now() < session.deadline) {
    const remainingMs = session.deadline - now();
    const browsingOnly = !available || sent >= quota || remainingMs < 20_000;
    if (browsingOnly) return browseUntilEnd(session, controls);
    // Keep the initial browse flexible, then browse for 3–5 minutes between batches.
    const spareMs = remainingMs - (quota - sent) * 90_000;
    const browsingMs = sent > 0 ? Math.min(remainingMs, random(180_000, 300_000))
      : Math.min(remainingMs - 20_000,
        Math.max(retryBrowsing ? 60_000 : 10_000, Math.min(random(30_000, 90_000), spareMs)));
    const reason = await browse(browsingMs);
    if (reason === 'skipped' || reason === 'stopped' || stopped()) return reason;
    if (reason === 'stalled') {
      retryBrowsing = true;
      await pauseBeforeBrowsing(session.deadline, reason, controls);
      continue;
    }
    retryBrowsing = false;
    // Finish the browsing transition before opening the first recipient profile.
    nextSendAt = Math.max(nextSendAt, now() + random(10_000, 20_000));
    if (session.visitDuringPause && session.deadline - now() >= 20_000 && random(0, 1) < 0.2)
      await session.visitDuringPause(random(0, 1) < 0.5 ? 'profile' : 'dms', Math.min(nextSendAt, session.deadline));
    const batch = Math.min(quota - sent, sent === 0 ? firstBatchSize : Math.floor(random(3, 6)));
    log({ event: 'automation.routine.outreach_batch', message: `Outreach batch: up to ${batch}; session target ${sent}/${quota}` });
    let completed = 0;
    while (completed < batch && !stopped()) {
      while (!stopped() && now() < Math.min(nextSendAt, session.deadline)) {
        if (session.waitForOutreach) {
          if (!await session.waitForOutreach(Math.min(nextSendAt, session.deadline))) break;
        }
        else await controls.sleep(Math.min(1000, nextSendAt - now(), session.deadline - now()));
      }
      if (stopped() || session.deadline - now() < 20_000) break;
      const current = await controls.target();
      if (current.remaining <= 0) { available = false; break; }
      const result = await controls.send();
      if (result === 'unavailable') { available = false; break; }
      if (result === 'sent' || result === 'followed') { sent++; completed++; }
      nextSendAt = now() + Math.floor(random(10, 31)) * 1000;
    }
  }
  return stopped() ? 'stopped' : 'finished';
}
