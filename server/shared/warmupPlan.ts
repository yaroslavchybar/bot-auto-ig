export type WarmupActivityCounts = { likes: number; profiles: number; reels: number; stories: number; follows?: number; saves?: number; comments?: number }
export const emptyWarmupActivity = (): Required<WarmupActivityCounts> => ({ likes: 0, profiles: 0, reels: 0, stories: 0, follows: 0, saves: 0, comments: 0 })

/** Draw daily action ceilings. Stories and Reels use session time and only record view counts. */
export function warmupActivityPlan(day: number, random = Math.random): Required<WarmupActivityCounts> {
  const pick = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
  if (day > 7) return { likes: pick(2, 6), follows: 0, profiles: pick(1, 4), reels: 0,
    stories: 0, saves: random() < 0.2 ? 1 : 0, comments: random() < 0.3 ? 1 : 0 }
  const likes = day <= 1 ? 0 : day === 2 ? pick(2, 4) : day <= 4 ? pick(3, 5) : pick(4, 6)
  const followRanges = [[0, 0], [0, 0], [0, 0], [2, 4], [4, 6], [5, 7], [6, 8], [8, 10]]
  const [min, max] = followRanges[day] ?? [0, 0]
  return { likes, follows: pick(min, max), profiles: pick(2, 5), reels: 0,
    stories: 0, saves: 0, comments: 0 }
}

/** Shared by every browsing chunk and reel detour in one reservation. */
export class WarmupActivityBudget {
  // Local evidence of viewing/scrolling, used to separate follow actions.
  browsed = 0
  readonly used: Required<WarmupActivityCounts>
  readonly plan: Required<WarmupActivityCounts>
  private readonly initial: Required<WarmupActivityCounts>
  constructor(plan: WarmupActivityCounts, used: WarmupActivityCounts = emptyWarmupActivity()) {
    this.plan = { ...emptyWarmupActivity(), ...plan }
    this.used = { ...emptyWarmupActivity(), ...used }
    this.initial = { ...this.used }
  }
  remaining(kind: keyof WarmupActivityCounts) { return Math.max(0, this.plan[kind] - this.used[kind]) }
  // Count attempts before input, so failed or uncertain actions do not cause extra retries.
  take(kind: keyof WarmupActivityCounts): boolean {
    if (!this.remaining(kind)) return false
    this.used[kind]++
    return true
  }
  delta(): WarmupActivityCounts {
    return Object.fromEntries(Object.keys(this.used).map(key => {
      const kind = key as keyof WarmupActivityCounts
      return [kind, this.used[kind] - this.initial[kind]]
    })) as WarmupActivityCounts
  }
}
