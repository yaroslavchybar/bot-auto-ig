import { sleep, type StopCheck } from './shared.js'

export class SessionEnded extends Error {}

/** One clock for every wait and action in a browsing session. */
export class BrowseSession {
  constructor(readonly end = Infinity, private readonly shouldStop: StopCheck = () => false) {}

  stopped(): boolean { return this.shouldStop() || Date.now() >= this.end }
  check(): void { if (this.stopped()) throw new SessionEnded('Browsing session ended') }
  timeout(max: number): number {
    this.check()
    return Math.max(1, Math.min(max, this.end - Date.now()))
  }
  wait = async (ms: number): Promise<void> => {
    const until = Math.min(this.end, Date.now() + ms)
    this.check()
    while (Date.now() < until) {
      this.check()
      await sleep(Math.min(200, until - Date.now()))
    }
    this.check()
  }
}
