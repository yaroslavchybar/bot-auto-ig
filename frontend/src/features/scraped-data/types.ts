import type { Id } from '../../../../convex/_generated/dataModel'

export type ScrapeJobStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

export type ScrapeJobConfig = {
  maxToScrape: number
  maxAttempts: number
  retryBackoffSeconds: string
  openDelaySeconds: number
  fields: {
    fullName: boolean
    isVerified: boolean
    isPrivate: boolean
  }
  skip: {
    private: boolean
    verified: boolean
    noFullName: boolean
  }
}

export type ScrapeJobStats = {
  scraped?: number
  deduped?: number
  chunksCompleted?: number
  targetsCompleted?: number
}

export type ScrapeJob = {
  _id: Id<'scrapeJobs'>
  name: string
  targets: string[]
  listIds: Id<'lists'>[]
  status: ScrapeJobStatus
  config: ScrapeJobConfig
  stats: ScrapeJobStats
  error?: string
  startedAt?: number
  completedAt?: number
  createdAt?: number
  updatedAt?: number
}

export type ScrapedAccount = {
  _id: string
  userName: string
  fullName?: string | null
  status?: string | null
  isVerified?: boolean | null
  isPrivate?: boolean | null
  sourceJobId?: string | null
  createdAt?: number
}

export type ScrapeJobForm = {
  name: string
  targets: string
  listIds: string[]
  maxToScrape: number
  maxAttempts: number
  retryBackoffSeconds: string
  openDelaySeconds: number
  fields: {
    fullName: boolean
    isVerified: boolean
    isPrivate: boolean
  }
  skip: {
    private: boolean
    verified: boolean
    noFullName: boolean
  }
}

export const DEFAULT_JOB_FORM: ScrapeJobForm = {
  name: '',
  targets: '',
  listIds: [],
  maxToScrape: 0,
  maxAttempts: 4,
  retryBackoffSeconds: '30,120,600,1800',
  openDelaySeconds: 2,
  fields: { fullName: true, isVerified: true, isPrivate: true },
  skip: { private: false, verified: false, noFullName: false },
}

export function jobToForm(job: ScrapeJob): ScrapeJobForm {
  return {
    name: job.name,
    targets: job.targets.join('\n'),
    listIds: job.listIds.map(String),
    maxToScrape: job.config.maxToScrape,
    maxAttempts: job.config.maxAttempts,
    retryBackoffSeconds: job.config.retryBackoffSeconds,
    openDelaySeconds: job.config.openDelaySeconds,
    fields: { ...DEFAULT_JOB_FORM.fields, ...job.config.fields },
    skip: { ...DEFAULT_JOB_FORM.skip, ...job.config.skip },
  }
}
