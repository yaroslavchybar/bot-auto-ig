import { convexTest } from 'convex-test'
import { vi } from 'vite-plus/test'
import type { UserIdentity } from 'convex/server'

import { defaultRoutine } from '../../convex/routinePolicy'
import { api, internal } from '../../convex/_generated/api'
import schema from '../../convex/schema'

export const modules = import.meta.glob([
  '../../convex/**/*.ts',
  '../../convex/_generated/*.js',
  '!../../convex/tests/**',
])

const TEST_IDENTITY: Partial<UserIdentity> = {
  subject: 'user_test_123',
  tokenIdentifier: 'https://clerk.test|user_test_123',
  issuer: 'https://clerk.test',
  email: 'auth-test@example.com',
}

export function createConvexTest() {
  const t = convexTest(schema, modules)
  return t.withIdentity(TEST_IDENTITY)
}

export function createUnauthenticatedConvexTest() {
  const t = convexTest(schema, modules)
  return t
}

// Frozen wall clocks can lag Convex's monotonically increasing commit clock.
// Advance past the latest snapshot before asserting exact transaction deadlines.
export async function advanceTestClock(t: ReturnType<typeof createConvexTest>) {
  const snapshotTime = await t.query(async () => Date.now())
  vi.setSystemTime(snapshotTime + 1)
  return Date.now()
}

export async function insertDoc(
  t: ReturnType<typeof createConvexTest>,
  table:
    | 'models'
    | 'profiles'
    | 'proxies'
    | 'automations'
    | 'warmupStates',
  value: Record<string, unknown>
) {
  const id = await t.run(async (ctx) => ctx.db.insert(table as never, value as never))
  return await t.run(async (ctx) => ctx.db.get(id))
}

export async function seedModel(t: ReturnType<typeof createConvexTest>, name = 'List A') {
  return await t.mutation(api.models.create, { name })
}

export async function seedProfile(
  t: ReturnType<typeof createConvexTest>,
  overrides: Record<string, unknown> = {}
) {
  return await t.mutation(internal.profiles.mutations.createInternal, {
    name: (overrides.name as string | undefined) ?? 'Profile A',
    proxy: overrides.proxy as string | undefined,
    proxyType: overrides.proxyType as string | undefined,
    fingerprintOs: overrides.fingerprintOs as string | undefined,
    cookiesJson: overrides.cookiesJson as string | undefined,
  })
}

export async function seedAutomation(
  t: ReturnType<typeof createConvexTest>,
  overrides: Record<string, unknown> = {}
) {
  return await insertDoc(t, 'automations', {
    name: 'Automation A',
    description: 'test automation',
    routine: defaultRoutine,
    modelIds: [(await seedModel(t, `Model ${Date.now()}-${Math.random()}`))!._id],
    status: 'idle',
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  })
}
