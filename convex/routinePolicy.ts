import { validateBrowsingRanges } from '../server/shared/browsingSettings'
import { v } from "convex/values";
import { validateOutreachMessage } from '../server/shared/outreachMessage';
import { validateInterests } from '../server/shared/interests';
import { validateAiSettings } from '../server/shared/aiSettings';

const aiStepValidator = v.object({ model: v.string(), prompt: v.string() });
// Every field is optional: saved overrides merge over the built-in screening defaults.
const screeningValidator = v.object({
  model: v.optional(v.string()),
  followModel: v.optional(v.string()),
  state: v.optional(v.string()),
  instructions: v.optional(v.string()),
  criteria: v.optional(v.object({
    male: v.optional(v.string()),
    female: v.optional(v.string()),
    business: v.optional(v.string()),
  })),
  nonEnglishText: v.optional(v.string()),
});

export const routineValidator = v.object({
  allowedCategories: v.optional(
    v.array(v.union(v.literal('male'), v.literal('female'), v.literal('business'))),
  ),
  // Accept older stored routines; the editor omits these ignored settings on save.
  outreachStartDay: v.optional(v.number()),
  dailyIncrease: v.optional(v.number()),
  // Stored names are retained; these settings now limit new follows, not DMs.
  initialDms: v.number(),
  maxDms: v.number(),
  outreachEnabled: v.boolean(),
  followingEnabled: v.optional(v.boolean()),
  notificationDmsEnabled: v.optional(v.boolean()),
  leadListId: v.optional(v.id("leadLists")),
  message: v.string(),
  outreachRoutes: v.optional(v.array(v.object({
    leadListId: v.id('leadLists'),
    profileIds: v.array(v.id('profiles')),
    allProfiles: v.optional(v.boolean()),
    message: v.string(),
  }),
    ),
  ),
  activity: v.record(v.string(), v.union(v.number(), v.boolean(), v.string())),
  interests: v.optional(v.array(v.object({ label: v.string(), description: v.string() }))),
  ai: v.optional(v.object({ interestMatch: v.optional(aiStepValidator), leadPostPerson: v.optional(aiStepValidator), profileScreening: v.optional(screeningValidator) })),
  headless: v.boolean(),
  unfollowMinDays: v.optional(v.number()),
  unfollowMaxDays: v.optional(v.number()),
  warmupMinPosts: v.optional(v.number()),
  warmupMaxPosts: v.optional(v.number()),
});

export type RoutinePolicy = typeof routineValidator.type;
export const OUTREACH_MIN_POSTS = 3;
export type OutreachRoute = NonNullable<RoutinePolicy['outreachRoutes']>[number];

// Existing single-list settings open as one assignment and are saved in the new format.
export function outreachRoutes(policy: RoutinePolicy): OutreachRoute[] {
  return (
    policy.outreachRoutes ?? (policy.leadListId
    ? [{ leadListId: policy.leadListId, profileIds: [], allProfiles: true, message: policy.message,
          },
        ]
    : [])
  )
}

export function profileOutreachRoutes(policy: RoutinePolicy, profileId: string): OutreachRoute[] {
  const routes = outreachRoutes(policy);
  // Saved multi-list routines must be corrected before outreach can resume.
  if (routes.length > 1) return [];
  return routes.filter(
    (route) => route.allProfiles || route.profileIds.includes(profileId as OutreachRoute['profileIds'][number]),
  );
}
export const defaultRoutine: RoutinePolicy = {
  initialDms: 3,
  maxDms: 30,
  outreachEnabled: false,
  followingEnabled: true,
  notificationDmsEnabled: true,
  allowedCategories: ['male'],
  message: "",
  activity: {},
  headless: false,
  unfollowMinDays: 7,
  unfollowMaxDays: 7,
  warmupMinPosts: 9,
  warmupMaxPosts: 9,
};

export const unfollowRange = (p?: RoutinePolicy) =>
  [p?.unfollowMinDays ?? 7, p?.unfollowMaxDays ?? 7] as const;
export const warmupPostRange = (p?: RoutinePolicy) =>
  [p?.warmupMinPosts ?? 9, p?.warmupMaxPosts ?? 9] as const;
export const randomInRange = ([min, max]: readonly [number, number]) =>
  min + Math.floor(Math.random() * (max - min + 1));

export function validateRoutine(p: RoutinePolicy) {
  validateAiSettings(p.ai)
  validateInterests(p.interests ?? [])
  if (
    p.allowedCategories &&
    (!p.allowedCategories.length ||
      new Set(p.allowedCategories).size !== p.allowedCategories.length)
  )
    throw new Error('Select at least one unique lead category')
  for (const [name, range, limit] of [
    ['Unfollow days', unfollowRange(p), 365],
    ['Post target', warmupPostRange(p), 100],
  ] as const) {
    const [min, max] = range;
    const minimum = name === 'Post target' ? OUTREACH_MIN_POSTS : 1;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < minimum || max < min || max > limit)
      throw new Error(`${name} must be ${minimum}–${limit}, with min no greater than max`);
  }
  for (const [key, value] of Object.entries(p.activity)) {
    if (typeof value === 'string' && (key !== 'warmup_topics' || value.length > 1000))
      throw new Error(`Invalid activity setting: ${key}`);
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || value < 0 || value > 1440)
    )
      throw new Error(`Invalid activity setting: ${key}`);
  }
  validateBrowsingRanges(p.activity);
  for (const [name, value, min, max] of [
    ["Initial follows", p.initialDms, 1, 35],
    ["Maximum follows", p.maxDms, 1, 35],
  ] as const) {
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${name} must be ${min}–${max}`);
  }
  if (p.initialDms > p.maxDms)
    throw new Error("Initial follows exceed the maximum");
  if (p.message.length > 1000)
    throw new Error("Message must be at most 1,000 characters");
  validateOutreachMessage(p.message);
  const routes = outreachRoutes(p);
  const actionsEnabled = p.outreachEnabled &&
    (p.followingEnabled !== false || p.notificationDmsEnabled !== false);
  if (routes.length > 1) throw new Error('Use one scraped list per automation');
  for (const route of routes) {
    if (route.profileIds.length > 1000 || new Set(route.profileIds).size !== route.profileIds.length)
      throw new Error('Invalid profile selection');
    if (route.message.length > 1000) throw new Error('Message must be at most 1,000 characters');
    validateOutreachMessage(route.message);
    if (actionsEnabled && !route.allProfiles && !route.profileIds.length)
      throw new Error('Select profiles for each scraped list');
    if (actionsEnabled && p.notificationDmsEnabled !== false && !route.message.trim())
      throw new Error('Write a message for each scraped list');
  }
  if (actionsEnabled && !routes.length) throw new Error('Add a scraped-list assignment');
}

export const dayKey = (now = Date.now()) =>
  new Date(now).toISOString().slice(0, 10);

export function outreachAllowance(
  p: RoutinePolicy,
  accumulatedIncrease: number) {
  return p.outreachEnabled && p.followingEnabled !== false
    ? Math.min(p.maxDms, p.initialDms + accumulatedIncrease)
    : 0;
}

/** Stable per-profile daily variation, including before the first quota write. */
function dailyFollowAllowance(policy: RoutinePolicy, increase: number, profileId: string, date: string) {
  const cap = outreachAllowance(policy, increase);
  if (cap <= 0) return 0;
  let seed = 2166136261;
  for (const character of `${profileId}:${date}`)
    seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  // Mix the high bits too so consecutive dates do not form a short repeating cycle.
  seed = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b);
  seed = Math.imul(seed ^ (seed >>> 13), 0xc2b2ae35);
  seed ^= seed >>> 16;
  return cap - (seed >>> 0) % Math.min(4, cap);
}

/** Queries and atomic reservations share one daily target; saved targets never reroll. */
export function dailyOutreachQuota(policy: RoutinePolicy, state: {
  outreachQuotaDate?: string
  outreachUsedToday: number
  outreachAllowanceToday: number
  outreachIncrease?: number
  followedToday?: number
} | null, date: string, profileId: string) {
  const today = state?.outreachQuotaDate === date
  return {
    used: today ? state.outreachUsedToday : 0,
    allowance: Math.min(policy.maxDms, today ? state.outreachAllowanceToday : dailyFollowAllowance(policy, state?.outreachIncrease ?? 0, profileId, date)),
    followed: today ? state.followedToday ?? 0 : 0,
  }
}

/** Source lists in Start are the single source of truth for graph membership. */
export function routineModels(automation: {
  nodes: unknown;
  modelIds?: string[];
}): string[] {
  const nodes = Array.isArray(automation.nodes) ? automation.nodes : [];
  const start = nodes.find((n) => n.type === "start");
  return [
    ...new Set<string>(
      automation.modelIds?.length
        ? automation.modelIds
        : (start?.data?.config?.sourceLists ?? []),
    ),
  ];
}
