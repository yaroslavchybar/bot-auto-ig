import {
  convexMutation,
  parseCliArgs,
  readJson,
  resolveOutputPath,
  writeJson,
} from './scraper-auto-only-shared.js'

type SnapshotPayload = {
  ts_utc: string
  issue: number
  kind: string
  profiles: Array<{
    _id: string
    name?: string
    automation?: boolean | null
    hadAutomation: boolean
  }>
  tasks: Array<Record<string, unknown> & { _id: string }>
}

function requireSnapshotPath(args: Record<string, string | boolean>): string {
  if (typeof args.snapshot !== 'string' || !args.snapshot.trim()) {
    throw new Error('Rollback requires --snapshot <path>')
  }
  return args.snapshot
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2))
  const snapshotPath = requireSnapshotPath(args)
  const outputPath = resolveOutputPath(
    typeof args.output === 'string' ? args.output : undefined,
    'scraper-auto-only-rollback',
  )
  const snapshot = await readJson<SnapshotPayload>(snapshotPath)

  if (snapshot.kind !== 'scraper-auto-only-pre-apply-snapshot') {
    throw new Error('Snapshot kind is not scraper-auto-only-pre-apply-snapshot')
  }

  const profileResults: Array<{ profileId: string; restored: boolean }> = []
  for (const profile of snapshot.profiles || []) {
    const result = await convexMutation<{ restored: boolean }>('migrations:scraperAutoOnlyRollbackProfile', {
      profileId: profile._id,
      hadAutomation: Boolean(profile.hadAutomation),
      automation: typeof profile.automation === 'boolean' ? profile.automation : null,
    })
    profileResults.push({ profileId: profile._id, restored: result.restored })
  }

  const taskResults: Array<{ taskId: string; restored: boolean }> = []
  for (const task of snapshot.tasks || []) {
    const result = await convexMutation<{ restored: boolean }>('migrations:scraperAutoOnlyRollbackTask', {
      taskId: task._id,
      snapshot: task,
    })
    taskResults.push({ taskId: task._id, restored: result.restored })
  }

  const evidence = {
    ts_utc: new Date().toISOString(),
    issue: 9,
    mode: 'rollback',
    snapshot_path: snapshotPath,
    output_path: outputPath,
    profiles_requested: snapshot.profiles.length,
    tasks_requested: snapshot.tasks.length,
    profiles_restored: profileResults.filter((result) => result.restored).length,
    tasks_restored: taskResults.filter((result) => result.restored).length,
    sample_ids: {
      profiles: profileResults.slice(0, 3).map((result) => result.profileId),
      tasks: taskResults.slice(0, 3).map((result) => result.taskId),
    },
  }

  await writeJson(outputPath, evidence)
  console.log(JSON.stringify(evidence, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
