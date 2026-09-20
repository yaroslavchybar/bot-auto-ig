import { randomUUID } from "node:crypto";
import type { Page } from "playwright-core";
import {
  routineReady,
  routineReserve,
  routineBeginSend,
  routineFinishSend,
  routineRecordSession,
  type DbAutomationRow,
} from "../shared/convexClient.js";
import { runWarmup } from "./warmup.js";
import type { ActionLogger, StopCheck } from "./actions/shared.js";

const dependencies = {
  ready: routineReady,
  reserve: routineReserve,
  begin: routineBeginSend,
  finish: routineFinishSend,
  record: routineRecordSession,
  warmup: runWarmup,
};

/** Check membership throughout long browsing sessions; a failed check stops activity. */
export async function runRoutineSession(
  automation: DbAutomationRow,
  profileId: string,
  page: Page,
  log: ActionLogger,
  stopped: StopCheck,
  deps = dependencies,
) {
  let allowed = true,
    checking = false,
    activityCompleted = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      allowed = await deps.ready(automation._id, profileId, true);
    } catch {
      allowed = false;
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => {
    void check();
  }, 5_000);
  const shouldStop = () => stopped() || !allowed;
  let issue: string | undefined;
  try {
    await check();
    if (shouldStop()) return;
    if (/\/accounts\/login|\/challenge|\/checkpoint/.test(page.url()))
      throw new Error("Instagram login or challenge needs attention");
    const warmup = await deps.warmup(
      profileId,
      automation._id,
      automation.routine!.activity,
      page,
      log,
      shouldStop,
    );
    activityCompleted = warmup.minutes > 0 && warmup.reason === "finished";
    await check();
    if (/\/accounts\/login|\/challenge|\/checkpoint/.test(page.url()))
      throw new Error("Instagram login or challenge needs attention");
    if (shouldStop() || !activityCompleted) return;
    const messages = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < messages; i++) {
      await check();
      if (shouldStop()) return;
      const attempt = await deps.reserve(
        automation._id,
        profileId,
        randomUUID(),
      );
      if (!attempt) return;
      // Navigation and composer preparation happen before permission to press Send.
      try {
        await page.goto(`https://www.instagram.com/${attempt.username}/`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page
          .getByRole("button", { name: "Message", exact: true })
          .click({ timeout: 15_000 });
        await page.waitForURL(/\/direct\//, { timeout: 15_000 });
        const composer = page.getByRole("textbox", { name: /message/i });
        await composer.fill(attempt.message, { timeout: 15_000 });
        await check();
        if (shouldStop()) {
          await deps.finish(attempt.attemptId, false);
          return;
        }
        if (!(await deps.begin(attempt.attemptId))) return;
        let sent = false;
        try {
          await composer.press("Enter", { timeout: 10_000 });
          // A cleared composer alone is insufficient: require the outgoing message in the thread.
          await page
            .getByText(attempt.message, { exact: true })
            .last()
            .waitFor({ state: "visible", timeout: 15_000 });
          sent = true;
        } finally {
          await deps.finish(attempt.attemptId, sent);
        }
        log(`Message sent to @${attempt.username}`);
      } catch (error) {
        await deps.finish(attempt.attemptId, false);
        throw new Error(
          `Delivery needs review: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    issue = error instanceof Error ? error.message : String(error);
    log(issue);
  } finally {
    clearInterval(timer);
    await deps.record(automation._id, profileId, activityCompleted, issue);
  }
}
