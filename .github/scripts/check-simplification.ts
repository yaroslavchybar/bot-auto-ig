/** Read-only preflight, before publishing the new Convex functions. Remove after migration. */
export const preflightQuery = `
const tables = ['profiles', 'automations', 'accountProgress', 'profileModelAssignments'];
const rows = {};
for (const table of tables) {
  rows[table] = await ctx.db.query(table).take(1001);
  if (rows[table].length > 1000) throw new Error('Simplification migration exceeds 1,000 ' + table + ' rows');
}
const legacy = rows.profileModelAssignments.length || rows.profiles.some(p => p.modelIds !== undefined) ||
  rows.accountProgress.some(p => p.paused !== undefined || p.lastLeadListId !== undefined) ||
  rows.automations.some(a => a.nodes !== undefined || a.edges !== undefined || a.nodeStates !== undefined ||
    a.currentNodeId !== undefined || a.routine?.outreachRoutes !== undefined ||
    a.routine?.message !== undefined || a.routine?.leadListId !== undefined ||
    a.routine?.outreachStartDay !== undefined || a.routine?.dailyIncrease !== undefined);
const historyMissing = !(await ctx.db.query('analyticsHistory').take(1)).length;
const pending = !!legacy || (historyMissing && (await ctx.db.query('analyticsDays').take(1)).length > 0);
if (pending && (rows.profiles.some(p => p.inUse || ['running','starting','deleting'].includes(p.status) || p.pendingRenameFrom) ||
  rows.automations.some(a => a.isActive || ['running','pending'].includes(a.status))))
  throw new Error('Disable automations and stop profiles before deploying this migration');
if (pending) {
  for (const automation of rows.automations) {
    if (!automation.routine) throw new Error('Retire graph automations before deploying this migration');
    if ((automation.routine.outreachRoutes?.length ?? 0) > 1)
      throw new Error('Correct multiple outreach assignments before deploying this migration');
  }
  for (const profile of rows.profiles) {
    const ids = new Set([...(profile.modelIds ?? []), ...(profile.modelId ? [profile.modelId] : [])]);
    const indexed = new Set(rows.profileModelAssignments.filter(m => m.profileId === profile._id).map(m => m.modelId));
    if (ids.size > 1 || indexed.size > 1 || [...indexed].some(id => !ids.has(id)))
      throw new Error('Correct conflicting profile memberships before deploying this migration');
  }
  if (historyMissing) {
    const sources = await ctx.db.query('scrapeSources').take(1001);
    if (sources.length > 1000 || sources.some(source => source.enabled || source.running))
      throw new Error('Pause scraping and wait for requests to finish before migrating uninitialized analytics');
  }
}
return { ready: true, migrationPending: pending };
`

if (import.meta.main) {
  const child = Bun.spawn(['bunx', 'convex', 'run', '--prod', '--inline-query', preflightQuery], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exitCode = await child.exited
}
