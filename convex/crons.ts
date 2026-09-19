import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Assign each profile its warm-up day, today's run count reset, and today's
// minutes shortly after UTC midnight. Takes effect on next deploy.
crons.daily(
	"warmup daily rollover",
	{ hourUTC: 0, minuteUTC: 5 },
	internal.warmup.mutations.rolloverDayInternal,
	{},
);

export default crons;
