import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily("reset sessions today", { hourUTC: 0, minuteUTC: 0 }, internal.profiles.resetSessionsToday);
crons.daily("reset daily scraping", { hourUTC: 0, minuteUTC: 1 }, internal.profiles.resetDailyScrapingUsed);
crons.daily("auto unsubscribe", { hourUTC: 3, minuteUTC: 0 }, internal.instagramAccounts.autoUnsubscribe);
crons.daily("assign accounts", { hourUTC: 3, minuteUTC: 15 }, internal.instagramAccounts.assignAvailableAccountsDaily);

export default crons;

