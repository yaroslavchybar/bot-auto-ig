// Shared types for scraping API

export type EligibleProfile = {
  id: string
  name: string
  sessionId: string
  proxy: string
  dailyLimit: number | null
  dailyUsed: number
}

export type ResumeTarget = {
  targetUsername: string
  cursor: string | null
  scrapedTotal: number
  done: boolean
}

export type ResumeState = {
  version: 1
  kind: 'followers' | 'following'
  limit: number
  perTarget: ResumeTarget[]
  done: boolean
  updatedAt: number
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'HttpError'
  }
}
