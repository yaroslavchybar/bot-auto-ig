import { convexTest } from 'convex-test'

import { api } from '../../../convex/_generated/api'
import schema from '../../../convex/schema'

export function createHarness() {
  const modules = {
    ...import.meta.glob('../../../convex/*.ts'),
    ...import.meta.glob('../../../convex/_generated/**/*.{js,ts,d.ts}'),
  }
  return convexTest(schema, modules)
}

export async function insertDoc(t: any, table: string, doc: Record<string, unknown>) {
  return await t.run(async (ctx: any) => await ctx.db.insert(table as any, doc as any))
}

export async function getDoc(t: any, id: any) {
  return await t.run(async (ctx: any) => await ctx.db.get(id))
}

export async function listDocs(t: any, table: string) {
  return await t.run(async (ctx: any) => await ctx.db.query(table as any).collect())
}

export async function createList(t: any, name: string = 'List') {
  return await t.mutation(api.lists.create, { name })
}

export async function createProfile(
  t: any,
  overrides: Record<string, unknown> = {}
) {
  return await t.mutation(api.profiles.create, {
    name: 'profile-1',
    testIp: false,
    ...overrides,
  })
}

export async function createWorkflow(
  t: any,
  overrides: Record<string, unknown> = {}
) {
  return await t.mutation(api.workflows.create, {
    name: 'Workflow',
    nodes: [],
    edges: [],
    ...overrides,
  })
}

export async function createScrapingTask(
  t: any,
  overrides: Record<string, unknown> = {}
) {
  return await t.mutation(api.scrapingTasks.create, {
    name: 'task-1',
    targetUsername: 'target-user',
    ...overrides,
  })
}
