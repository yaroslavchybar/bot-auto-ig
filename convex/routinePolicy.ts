import { v } from "convex/values";

export const routineValidator = v.object({
  outreachStartDay: v.number(),
  initialDms: v.number(),
  dailyIncrease: v.number(),
  maxDms: v.number(),
  outreachEnabled: v.boolean(),
  leadListId: v.optional(v.id("leadLists")),
  message: v.string(),
  activity: v.record(v.string(), v.union(v.number(), v.boolean())),
  headless: v.boolean(),
});

export type RoutinePolicy = typeof routineValidator.type;
export const defaultRoutine: RoutinePolicy = {
  outreachStartDay: 7,
  initialDms: 3,
  dailyIncrease: 2,
  maxDms: 30,
  outreachEnabled: false,
  message: "",
  activity: {},
  headless: false,
};

export function validateRoutine(p: RoutinePolicy) {
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
    ["Daily increase", p.dailyIncrease, 0, 35],
    ["Maximum DMs", p.maxDms, 1, 35],
  ] as const) {
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${name} must be ${min}–${max}`);
  }
  if (p.initialDms > p.maxDms)
    throw new Error("Initial DMs exceed the maximum");
  if (p.message.length > 1000)
    throw new Error("Message must be at most 1,000 characters");
  if (p.outreachEnabled && (!p.leadListId || !p.message.trim()))
    throw new Error("Select a lead list and write a message");
}

export const dayKey = (now = Date.now()) =>
  new Date(now).toISOString().slice(0, 10);

export function dmAllowance(
  p: RoutinePolicy,
  activeDays: number,
  outreachDays: number,
) {
  return p.outreachEnabled && activeDays + 1 >= p.outreachStartDay
    ? Math.min(p.maxDms, p.initialDms + outreachDays * p.dailyIncrease)
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
