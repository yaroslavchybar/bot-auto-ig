import {
  analyzeCohorts,
  buildSnapshot,
  convexMutation,
  fetchProfiles,
  fetchTasks,
  getSampleLimit,
  parseCliArgs,
  resolveOutputPath,
  sampleIds,
  writeJson,
} from './scraper-auto-only-shared.js'

type ProfileCleanupResult = {
  updated: boolean
  removedAutomation: boolean
}

type TaskCleanupResult = {
  updated: boolean
  removedLegacyFields: number
  resetToIdle: boolean
  clearedRuntimeState: boolean
  unknownLastOutputShape: boolean
}

function assertMode(args: Record<string, string | boolean>): 'dry-run' | 'apply' {
  const dryRun = args['dry-run'] === true
  const apply = args.apply === true
  if (dryRun === apply) {
    throw new Error('Pass exactly one of --dry-run or --apply')
  }
  if (apply && args.confirm !== 'scraper-auto-only') {
    throw new Error('Apply requires --confirm scraper-auto-only')
  }
  return dryRun ? 'dry-run' : 'apply'
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2))
  const mode = assertMode(args)
  const sampleLimit = getSampleLimit(args)
  const outputPath = resolveOutputPath(
    typeof args.output === 'string' ? args.output : undefined,
    mode === 'dry-run' ? 'scraper-auto-only-dry-run' : 'scraper-auto-only-apply',
  )
  const snapshotPath = mode === 'apply'
    ? resolveOutputPath(
        typeof args.snapshot === 'string' ? args.snapshot : undefined,
        'scraper-auto-only-before',
      )
    : undefined

  const profilesBefore = await fetchProfiles()
  const tasksBefore = await fetchTasks()
  const analysisBefore = analyzeCohorts(profilesBefore, tasksBefore)

  const evidence: Record<string, unknown> = {
    ts_utc: new Date().toISOString(),
    issue: 9,
    mode,
    sample_limit: sampleLimit,
    snapshot_path: snapshotPath ?? null,
    counts_before: {
      profiles_with_automation_before: analysisBefore.profileCleanupIds.length,
      tasks_with_legacy_fields_before: analysisBefore.taskLegacyFieldIds.length,
      tasks_reset_to_idle_total: analysisBefore.taskResetIds.length,
      tasks_runtime_state_cleared_total: analysisBefore.taskRuntimeCleanupIds.length,
      unknown_last_output_shape_total: analysisBefore.unknownLastOutputShapeIds.length,
      eligible_profiles_after: analysisBefore.eligibleProfilesAfter.length,
    },
    sample_ids: {
      profiles: sampleIds(analysisBefore.profileCleanupIds, Math.min(sampleLimit, 3)),
      tasks: sampleIds(
        Array.from(new Set([
          ...analysisBefore.taskLegacyFieldIds,
          ...analysisBefore.taskResetIds,
          ...analysisBefore.taskRuntimeCleanupIds,
        ])),
        Math.min(sampleLimit, 3),
      ),
      unknown_last_output_shape_tasks: sampleIds(analysisBefore.unknownLastOutputShapeIds, sampleLimit),
    },
    output_path: outputPath,
  }

  if (mode === 'dry-run') {
    await writeJson(outputPath, evidence)
    console.log(JSON.stringify(evidence, null, 2))
    return
  }

  const snapshot = buildSnapshot(profilesBefore, tasksBefore, analysisBefore)
  await writeJson(snapshotPath!, snapshot)

  const profileResults: ProfileCleanupResult[] = []
  for (const profileId of analysisBefore.profileCleanupIds) {
    const result = await convexMutation<ProfileCleanupResult>('migrations:scraperAutoOnlyApplyProfileCleanup', {
      profileId,
    })
    profileResults.push(result)
  }

  const taskIds = Array.from(new Set([
    ...analysisBefore.taskLegacyFieldIds,
    ...analysisBefore.taskResetIds,
    ...analysisBefore.taskRuntimeCleanupIds,
  ]))
  const taskResults: Array<TaskCleanupResult & { taskId: string }> = []
  for (const taskId of taskIds) {
    const result = await convexMutation<TaskCleanupResult>('migrations:scraperAutoOnlyApplyTaskCleanup', {
      taskId,
    })
    taskResults.push({ taskId, ...result })
  }

  const profilesAfter = await fetchProfiles()
  const tasksAfter = await fetchTasks()
  const analysisAfter = analyzeCohorts(profilesAfter, tasksAfter)

  evidence.snapshot_path = snapshotPath
  evidence.apply_results = {
    profiles_removed_automation_total: profileResults.filter((result) => result.removedAutomation).length,
    tasks_removed_legacy_fields_total: taskResults.reduce((total, result) => total + result.removedLegacyFields, 0),
    tasks_reset_to_idle_total: taskResults.filter((result) => result.resetToIdle).length,
    tasks_runtime_state_cleared_total: taskResults.filter((result) => result.clearedRuntimeState).length,
    unknown_last_output_shape_total: taskResults.filter((result) => result.unknownLastOutputShape).length,
    unknown_last_output_shape_ids: taskResults
      .filter((result) => result.unknownLastOutputShape)
      .map((result) => result.taskId),
  }
  evidence.counts_after = {
    profiles_with_automation_after: analysisAfter.profileCleanupIds.length,
    tasks_with_legacy_fields_after: analysisAfter.taskLegacyFieldIds.length,
    tasks_still_running_or_paused_after: analysisAfter.taskResetIds.length,
    tasks_runtime_state_remaining_after: analysisAfter.taskRuntimeCleanupIds.length,
    eligible_profiles_after: analysisAfter.eligibleProfilesAfter.length,
  }

  await writeJson(outputPath, evidence)
  console.log(JSON.stringify(evidence, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
