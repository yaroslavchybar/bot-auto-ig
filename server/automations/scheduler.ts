import {
  automationMutex,
  automationWorkers,
  runAutomation,
  stopAutomations,
} from "./service.js";
import { closeConvexRealtime, watchActiveRoutines } from "../shared/convexRealtime.js";
import logger from "../shared/logger.js";

type SchedulerRoutine = {
  _id: string;
  hasRoutine?: boolean;
  isActive?: boolean;
};

/** Enabled routines resume after restarts and react to state changes. */
export function startRoutineScheduler() {
  let busy = false;
  let queued = false;
  let stopped = false;
  let rows: SchedulerRoutine[] = [];
  const maxConcurrency = () => Math.max(
    1,
    Number(process.env.AUTOMATION_MAX_CONCURRENCY) || 3,
  );
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRetry = () => {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void tick();
    }, 1000);
    retryTimer.unref?.();
  };
  const tick = async () => {
    if (stopped || busy) {
      queued = true;
      return;
    }
    busy = true;
    const release = await automationMutex.acquire();
    try {
      for (const row of rows) {
        if (!row.hasRoutine) continue;
        if (!row.isActive) {
          if (automationWorkers.has(row._id)) await stopAutomations(row._id);
          continue;
        }
        if (automationWorkers.has(row._id)) continue;
        const max = maxConcurrency();
        if (automationWorkers.size >= max) {
          scheduleRetry();
          continue;
        }
        try {
          await runAutomation({ automationId: row._id });
        } catch (err) {
          logger.error({ event: 'automations.scheduler.start_routine', error: err, automationId: row._id, message: "Could not start routine", outcome: 'error' });
        }
      }
    } catch (err) {
      logger.error({ event: 'automations.scheduler.routine_scheduler_refresh', error: err, message: "Routine scheduler could not refresh", outcome: 'error' });
    } finally {
      release();
      busy = false;
      if (!stopped && rows.some(row => row.isActive && !automationWorkers.has(row._id)) && automationWorkers.size >= maxConcurrency())
        scheduleRetry();
      if (queued && !stopped) {
        queued = false;
        void tick();
      }
    }
  };

  const subscription = watchActiveRoutines(
    nextRows => {
      rows = nextRows as SchedulerRoutine[];
      void tick();
    },
    err => logger.error({ event: 'automations.scheduler.routine_scheduler_subscription_failed', error: err, message: "Routine scheduler subscription failed", outcome: 'error' }),
  );
  void subscription.initial.catch(err =>
    logger.error({ event: 'automations.scheduler.routine_scheduler_load', error: err, message: "Routine scheduler could not load", outcome: 'error' }),
  );

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    subscription.unsubscribe();
    void closeConvexRealtime();
  };
}
