import { v } from "convex/values";

export const routineValidator = v.object({
  outreachStartDay: v.number(),
  initialDms: v.number(),
  // Accept saved routines from before random growth; this value is no longer used.
  dailyIncrease: v.optional(v.number()),
  maxDms: v.number(),
  outreachEnabled: v.boolean(),
  leadListId: v.optional(v.id("leadLists")),
  message: v.string(),
  outreachRoutes: v.optional(v.array(v.object({
    leadListId: v.id('leadLists'),
    profileIds: v.array(v.id('profiles')),
    allProfiles: v.optional(v.boolean()),
    message: v.string(),
  }))),
  activity: v.record(v.string(), v.union(v.number(), v.boolean())),
  headless: v.boolean(),
  unfollowMinDays: v.optional(v.number()),
  unfollowMaxDays: v.optional(v.number()),
  warmupMinPosts: v.optional(v.number()),
  warmupMaxPosts: v.optional(v.number()),
});

export type RoutinePolicy = typeof routineValidator.type;
export type OutreachRoute = NonNullable<RoutinePolicy['outreachRoutes']>[number];

// Existing single-list settings open as one assignment and are saved in the new format.
export function outreachRoutes(policy: RoutinePolicy): OutreachRoute[] {
  return policy.outreachRoutes ?? (policy.leadListId
    ? [{ leadListId: policy.leadListId, profileIds: [], allProfiles: true, message: policy.message }]
    : []);
}

export function profileOutreachRoutes(policy: RoutinePolicy, profileId: string): OutreachRoute[] {
  return outreachRoutes(policy).filter(route => route.allProfiles || route.profileIds.includes(profileId as OutreachRoute['profileIds'][number]));
}
export const defaultRoutine: RoutinePolicy = {
  outreachStartDay: 7,
  initialDms: 3,
  maxDms: 30,
  outreachEnabled: false,
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
  for (const [name, range, limit] of [
    ['Unfollow days', unfollowRange(p), 365],
    ['Warm-up posts', warmupPostRange(p), 100],
  ] as const) {
    const [min, max] = range;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > limit)
      throw new Error(`${name} must be 1–${limit}, with min no greater than max`);
  }
  for (const [key, value] of Object.entries(p.activity)) {
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || value < 0 || value > 1440)
    )
      throw new Error(`Invalid activity setting: ${key}`);
  }
  const minMinutes = Number(p.activity.warmup_min_minutes ?? 30),
    maxMinutes = Number(p.activity.warmup_max_minutes ?? 60);
  if (minMinutes < 1 || maxMinutes < minMinutes || maxMinutes > 100)
    throw new Error("Daily browsing budget must be between 1 and 100 minutes");
  const sessionMin = Number(p.activity.session_min_minutes ?? 5),
    sessionMax = Number(p.activity.session_max_minutes ?? 10);
  if (sessionMin < 1 || sessionMax < sessionMin || sessionMax > 60)
    throw new Error("Sessions must be 1–60 minutes, with min no greater than max");
  const restMin = Number(p.activity.rest_min_minutes ?? 60),
    restMax = Number(p.activity.rest_max_minutes ?? 120);
  if (restMin < 1 || restMax < restMin)
    throw new Error("Rest between sessions must be positive, with min no greater than max");
  for (const [name, value, min, max] of [
    ["Outreach start day", p.outreachStartDay, 1, 365],
    ["Initial DMs", p.initialDms, 1, 35],
    ["Maximum DMs", p.maxDms, 1, 35],
  ] as const) {
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${name} must be ${min}–${max}`);
  }
  if (p.initialDms > p.maxDms)
    throw new Error("Initial DMs exceed the maximum");
  if (p.message.length > 1000)
    throw new Error("Message must be at most 1,000 characters");
  const routes = outreachRoutes(p);
  if (routes.length > 20) throw new Error('Use at most 20 scraped-list assignments');
  if (new Set(routes.map(route => route.leadListId)).size !== routes.length)
    throw new Error('Use one assignment per scraped list');
  for (const route of routes) {
    if (route.profileIds.length > 1000 || new Set(route.profileIds).size !== route.profileIds.length)
      throw new Error('Invalid profile selection');
    if (route.message.length > 1000) throw new Error('Message must be at most 1,000 characters');
    if (p.outreachEnabled && ((!route.allProfiles && !route.profileIds.length) || !route.message.trim()))
      throw new Error('Select profiles and write a message for each scraped list');
  }
  if (p.outreachEnabled && !routes.length) throw new Error('Add a scraped-list assignment');
}

export const dayKey = (now = Date.now()) =>
  new Date(now).toISOString().slice(0, 10);

export function dmAllowance(
  p: RoutinePolicy,
  activeDays: number,
  accumulatedIncrease: number,
) {
  return p.outreachEnabled && activeDays + 1 >= p.outreachStartDay
    ? Math.min(p.maxDms, p.initialDms + accumulatedIncrease)
    : 0;
}

/** Source lists in Start are the single source of truth for graph membership. */
export function routineLists(automation: {
  nodes: unknown;
  listIds?: string[];
}): string[] {
  const nodes = Array.isArray(automation.nodes) ? automation.nodes : [];
  const start = nodes.find((n) => n.type === "start");
  return [
    ...new Set<string>(
      automation.listIds?.length
        ? automation.listIds
        : (start?.data?.config?.sourceLists ?? []),
    ),
  ];
}
