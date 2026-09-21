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
          logger.warn(
            { err, automationId: row._id },
            "Could not start routine",
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, "Routine scheduler could not refresh");
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
    err => logger.warn({ err }, "Routine scheduler subscription failed"),
  );
  void subscription.initial.catch(err =>
    logger.warn({ err }, "Routine scheduler could not load"),
  );

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    subscription.unsubscribe();
    void closeConvexRealtime();
  };
}
