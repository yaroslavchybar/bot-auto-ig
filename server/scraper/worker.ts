import { profilesGetById, scraperRequest } from '../shared/convexClient.js';
import logger, { logOperation, addLogContext } from '../shared/logger.js';
import { IgResponseError } from 'instagram-private-api';
import { InstagramChat } from '../chat/instagram.js';
import { InstagramHttp, InstagramRateLimitedError, retryAfterMs, type InstagramPost } from './instagram.js';
import { classifyAccount, openRouterClient } from './classify.js';
import { describePicture, validPictureUrl } from './picture.js';
import { recentPosts } from './apify.js';
import { watchScraperWork, type ScraperWork } from '../shared/convexRealtime.js';
import { reactiveWork } from '../shared/reactiveWork.js';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type Job = { _id: string; username: string; profileId: string; runId: string;
  sinceDate: number; postLimit: number; posts?: InstagramPost[]; postIndex?: number };
type PendingLead = { _id: string; username: string; fullName?: string; profilePicUrl?: string; profilePicDescription?: string };

async function enrichPending(): Promise<void> {
  return logOperation('scraper.enrichment', {}, async () => {
    const client = openRouterClient();
    const pending = await scraperRequest<PendingLead[]>('pending');
    addLogContext({ pendingCount: pending.length, batchSize: Math.min(pending.length, 10) });
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
        logger.error({ event: 'scraper.worker.enrich_scraped_lead', error: error, username: lead.username, message: 'Could not enrich scraped lead', outcome: 'error' });
        await scraperRequest('enrichment-error', { leadId: lead._id });
      }
    }

  })
}

async function runJob(job: Job): Promise<void> {
  // The key is required before any Instagram requests produce unclassified rows.
  openRouterClient();
  const profile = await profilesGetById(job.profileId);
  if (!profile) throw new Error('Scraper profile was deleted');
  const instagram = new InstagramHttp(profile);
  let posts = job.posts;
  if (!posts) {
    let postsFromApify = false;
    try {
      const chat = await InstagramChat.load(profile);
      posts = await chat.recentProfilePosts(job.username, job.sinceDate, job.postLimit, async () => {
        await scraperRequest('checkpoint', { jobId: job._id, runId: job.runId });
      });
    } catch (error) {
      if (error instanceof IgResponseError && error.response.statusCode === 429)
        throw new InstagramRateLimitedError('profile posts', retryAfterMs(error.response.headers['retry-after']));
      // SDK response errors include request headers and session cookies.
      logger.info({ event: 'scraper.posts_fallback', errorType: error instanceof Error ? error.name : 'UnknownError', provider: 'apify' });
      postsFromApify = true;
      posts = await recentPosts(job.username, job.sinceDate, job.postLimit);
    }
    addLogContext({ postsProvider: postsFromApify ? 'apify' : 'mobile' });
    await scraperRequest('checkpoint', { jobId: job._id, runId: job.runId, posts, postsFromApify });
  }
  addLogContext({ profileName: profile.name, postCount: posts.length, resumedAtPost: job.postIndex ?? 0 });
  const seen = new Set<string>();
  let added = 0;
  let processed = 0;
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
      added += result.added; processed += result.processed;
      addLogContext({ leadsAdded: added, likersProcessed: processed });
      if (result.limitExhausted) {
        const truncated = result.processed < chunk.length || offset + chunk.length < fresh.length;
        if (truncated) throw new DailyLimitReached();
        await scraperRequest('checkpoint', { jobId: job._id, runId: job.runId, postIndex: index + 1 });
        if (index < posts.length - 1) throw new DailyLimitReached();
        return;
      }
    }
    const state = await scraperRequest<{ limitExhausted: boolean }>('checkpoint', {
      jobId: job._id, runId: job.runId, postIndex: index + 1 });
    if (state.limitExhausted && index < posts.length - 1) throw new DailyLimitReached();
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
        await logOperation('scraper.job', { jobId: job._id, profileId: job.profileId, targetUsername: job.username, runId: job.runId }, async () => {
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
                logger.error({ event: 'scraper.worker.record_profile_cooldown', error: cooldownError, jobId: job._id, message: 'Could not record profile cooldown', outcome: 'error' });
              }
            }
            const paused = error instanceof DailyLimitReached || rateLimited;
            const message = error instanceof DailyLimitReached ? 'Daily account limit reached; resumes when capacity is available'
              : error instanceof Error ? error.message : String(error);
            addLogContext({ outcome: paused ? 'paused' : 'error', error, reason: rateLimited ? 'rate_limited' : paused ? 'daily_limit' : 'job_failed',
              retryAfterMs: rateLimited ? error.retryAfterMs : undefined });
            await scraperRequest('finish', {
              jobId: job._id, runId: job.runId, status: paused ? 'paused' : 'failed', error: message,
            });
          }
        });
      }
    } catch (error) {
      logger.error({ event: 'scraper.worker.scraper_worker_tick_failed', error: error, message: 'Scraper worker tick failed', outcome: 'error' });
    } finally { jobBusy = false; }
  };
  const enrichmentTick = async () => {
    if (enrichmentBusy || stopped || !process.env.OPENROUTER_API_KEY) return;
    enrichmentBusy = true;
    try { await enrichPending(); }
    catch (error) { logger.error({ event: 'scraper.worker.scraper_enrichment_tick_failed', error: error, message: 'Scraper enrichment tick failed', outcome: 'error' }); }
    finally { enrichmentBusy = false; }
  };
  const jobs = reactiveWork<ScraperWork>({
    dueAt: state => state.jobAt, run: jobTick,
    onError: err => logger.error({ event: 'scraper.worker.scraper_job_failed', error: err, message: 'Scraper job failed', outcome: 'error' }),
  });
  const enrichment = reactiveWork<ScraperWork>({
    dueAt: state => process.env.OPENROUTER_API_KEY && state.enrichmentKey ? 0 : null,
    run: enrichmentTick, onError: err => logger.error({ event: 'scraper.worker.scraper_enrichment_failed', error: err, message: 'Scraper enrichment failed', outcome: 'error' }),
  });
  const subscription = watchScraperWork(state => { jobs.update(state); enrichment.update(state); },
    err => {
      const idle = { jobAt: null, jobKey: null, enrichmentKey: null };
      jobs.update(idle); enrichment.update(idle);
      logger.error({ event: 'scraper.worker.scraper_subscription_failed', error: err, message: 'Scraper subscription failed', outcome: 'error' });
    });
  void subscription.initial.catch(() => undefined);
  return () => { stopped = true; jobs.stop(); enrichment.stop(); subscription.unsubscribe(); };
}
