import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

// Warm-up budgets roll over when a profile next runs.
const crons = cronJobs()
// Temporary cleanup; remove this job and its module after deployment completes.
crons.interval('browser scraping migration', { minutes: 1 }, internal.browserScrapingMigration.run)
export default crons
