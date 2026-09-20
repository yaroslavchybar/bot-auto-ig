import { automationsList } from "../shared/convexClient.js";
import {
  automationMutex,
  automationWorkers,
  runAutomation,
  stopAutomations,
} from "./service.js";
import logger from "../shared/logger.js";

/** Enabled routines resume after restarts and keep watching list membership. */
export function startRoutineScheduler() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    const release = await automationMutex.acquire();
    try {
      const rows = await automationsList();
      for (const row of rows) {
        if (!row.routine) continue;
        if (!row.isActive) {
          if (automationWorkers.has(row._id)) await stopAutomations(row._id);
          continue;
        }
        if (automationWorkers.has(row._id)) continue;
        const max = Math.max(
          1,
          Number(process.env.AUTOMATION_MAX_CONCURRENCY) || 3,
        );
        if (automationWorkers.size >= max) continue;
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
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, 15_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
