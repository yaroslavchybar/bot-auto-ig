import { convexTest } from 'convex-test'
import type { UserIdentity } from 'convex/server'

import { api } from '../../convex/_generated/api'
import schema from '../../convex/schema'

export const modules = import.meta.glob([
  '../../convex/**/*.ts',
  '../../convex/_generated/*.js',
])

const TEST_IDENTITY: Partial<UserIdentity> = {
  subject: 'user_test_123',
  tokenIdentifier: 'https://clerk.test|user_test_123',
  issuer: 'https://clerk.test',
  email: 'auth-test@example.com',
}

export function createConvexTest() {
  return convexTest(schema, modules).withIdentity(TEST_IDENTITY)
}

export function createUnauthenticatedConvexTest() {
  return convexTest(schema, modules)
}

export async function insertDoc(
  t: ReturnType<typeof createConvexTest>,
  table:
    | 'instagramAccounts'
    | 'keywords'
    | 'lists'
    | 'messageTemplates'
    | 'profiles'
    | 'scrapingTasks'
    | 'workflows',
  value: Record<string, unknown>
) {
  const id = await t.run(async (ctx) => ctx.db.insert(table as never, value as never))
  return await t.run(async (ctx) => ctx.db.get(id))
}

export async function seedList(t: ReturnType<typeof createConvexTest>, name = 'List A') {
  return await t.mutation(api.lists.create, { name })
}

export async function seedProfile(
  t: ReturnType<typeof createConvexTest>,
  overrides: Record<string, unknown> = {}
) {
  return await t.mutation(api.profiles.create, {
    name: (overrides.name as string | undefined) ?? 'Profile A',
    proxy: overrides.proxy as string | undefined,
    proxyType: overrides.proxyType as string | undefined,
    testIp: overrides.testIp as boolean | undefined,
    fingerprintSeed: overrides.fingerprintSeed as string | undefined,
    fingerprintOs: overrides.fingerprintOs as string | undefined,
    cookiesJson: overrides.cookiesJson as string | undefined,
    sessionId: overrides.sessionId as string | undefined,
    dailyScrapingLimit: overrides.dailyScrapingLimit as number | null | undefined,
  })
}

export async function seedWorkflow(
  t: ReturnType<typeof createConvexTest>,
  overrides: Record<string, unknown> = {}
) {
  return await insertDoc(t, 'workflows', {
    name: 'Workflow A',
    description: 'test workflow',
    nodes: [],
    edges: [],
    listIds: [],
    status: 'idle',
    isActive: false,
    scheduleType: 'daily',
    scheduleConfig: { hourUTC: 9, minuteUTC: 0 },
    runsToday: 0,
    retryCount: 0,
    maxRetries: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  })
}
