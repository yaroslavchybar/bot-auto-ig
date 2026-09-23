import { profilesGetById, scraperRequest } from '../shared/convexClient.js';
import logger from '../shared/logger.js';
import { InstagramHttp, InstagramRateLimitedError, type InstagramPost } from './instagram.js';
import { classifyAccount, openRouterClient } from './classify.js';
import { describePicture, validPictureUrl } from './picture.js';
import { recentPosts } from './apify.js';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type Job = { _id: string; username: string; profileId: string; runId: string;
  sinceDate: number; postLimit: number; posts?: InstagramPost[]; postIndex?: number };
type PendingLead = { _id: string; username: string; fullName?: string; profilePicUrl?: string; profilePicDescription?: string };

async function enrichPending(): Promise<void> {
  const client = openRouterClient();
  const pending = await scraperRequest<PendingLead[]>('pending');
  for (const lead of pending.slice(0, 10)) {
    try {
      let description = lead.profilePicDescription;
      const url = validPictureUrl(lead.profilePicUrl || '');
      if (!description && url) {
        description = await describePicture(url);
        await scraperRequest('picture-description', { leadId: lead._id, description });
      }
      const classification = await classifyAccount(client, {
        username: lead.username, fullName: lead.fullName || '', pictureDescription: description,
      });
      await scraperRequest('enrich', {
        leadId: lead._id, profilePicDescription: description, classification,
      });
    } catch (error) {
      logger.warn({ err: error, username: lead.username }, 'Could not enrich scraped lead');
      await scraperRequest('enrichment-error', { leadId: lead._id });
    }
  }
}

async function runJob(job: Job): Promise<void> {
  // The key is required before any Instagram requests produce unclassified rows.
  openRouterClient();
  const profile = await profilesGetById(job.profileId);
  if (!profile) throw new Error('Scraper profile was deleted');
  const instagram = new InstagramHttp(profile);
  let posts = job.posts;
  if (!posts) {
    posts = await recentPosts(job.username, job.sinceDate, job.postLimit);
    await scraperRequest('checkpoint', { jobId: job._id, runId: job.runId, posts });
  }
  const seen = new Set<string>();
  for (let index = job.postIndex ?? 0; index < posts.length; index++) {
    const post = posts[index]!;
    const likers = await instagram.likers(post);
    const fresh = likers.filter(liker => {
      if (seen.has(liker.igId)) return false;
      seen.add(liker.igId);
      return true;
    });
    for (let offset = 0; offset < fresh.length; offset += 25) {
      const chunk = fresh.slice(offset, offset + 25);
      const result = await scraperRequest<{ added: number; processed: number; limitExhausted: boolean }>('batch', {
        jobId: job._id, runId: job.runId, likers: chunk,
      });
      if (result.limitExhausted) {
        const truncated = result.processed < chunk.length || offset + chunk.length < fresh.length;
        if (truncated) throw new DailyLimitReached();
        await scraperRequest('checkpoint', { jobId: job._id, runId: job.runId, postIndex: index + 1 });
        if (index < posts.length - 1) throw new DailyLimitReached();
        return;
      }
    }
    await scraperRequest('checkpoint', { jobId: job._id, runId: job.runId, postIndex: index + 1 });
    if (index < posts.length - 1) await delay(10_000 + Math.floor(Math.random() * 10_000));
  }
}

class DailyLimitReached extends Error {}

/** Scraping and enrichment resume independently after process restarts. */
export function startScraperWorker(): () => void {
  let stopped = false;
  let jobBusy = false;
  let enrichmentBusy = false;
  const jobTick = async () => {
    if (jobBusy || stopped) return;
    jobBusy = true;
    try {
      const job = await scraperRequest<Job | null>('claim');
      if (job) {
        try {
          await runJob(job);
          await scraperRequest('finish', { jobId: job._id, runId: job.runId, status: 'completed' });
        } catch (error) {
          const rateLimited = error instanceof InstagramRateLimitedError;
          if (rateLimited) {
            try {
              await scraperRequest('cooldown', {
                profileId: job.profileId, retryAfterMs: error.retryAfterMs,
              });
            } catch (cooldownError) {
              logger.warn({ err: cooldownError, jobId: job._id }, 'Could not record profile cooldown');
            }
          }
          const paused = error instanceof DailyLimitReached || rateLimited;
          const message = error instanceof DailyLimitReached ? 'Daily account limit reached; resumes when capacity is available'
            : error instanceof Error ? error.message : String(error);
          logger.warn({ err: error, jobId: job._id }, 'Scrape job ended');
          await scraperRequest('finish', {
            jobId: job._id, runId: job.runId, status: paused ? 'paused' : 'failed', error: message,
          });
        }
      }
    } catch (error) {
      logger.warn({ err: error }, 'Scraper worker tick failed');
    } finally { jobBusy = false; }
  };
  const enrichmentTick = async () => {
    if (enrichmentBusy || stopped || !process.env.OPENROUTER_API_KEY) return;
    enrichmentBusy = true;
    try { await enrichPending(); }
    catch (error) { logger.warn({ err: error }, 'Scraper enrichment tick failed'); }
    finally { enrichmentBusy = false; }
  };
  void jobTick();
  void enrichmentTick();
  const timer = setInterval(() => { void jobTick(); void enrichmentTick(); }, 10_000);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
