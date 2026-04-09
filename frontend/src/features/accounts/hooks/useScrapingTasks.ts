import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ScrapingTaskFieldsResponse, ScrapingTaskRow } from '../types'
import type { ProcessingSummary } from './useAccountsState'
import {
  findAlias,
  buildPreviewFields,
  formatDate,
  USERNAME_ALIASES,
  FULLNAME_ALIASES,
} from './useAccountsState'

const DEFAULT_ACCOUNTS_ENV = 'dev' as const
const DEFAULT_PROCESS_ENVIRONMENTS = ['dev']

export interface BulkScrapingImportResult {
  stats: ProcessingSummary['stats']
  uploaded: Record<string, number>
  duplicates: Record<string, number>
  scrapingInserted: Record<string, number>
  scrapingDuplicates: Record<string, number>
  processedArtifacts: number
  skippedArtifacts: string[]
  failedArtifacts: Array<{ name: string; reason: string }>
}

interface ScrapingTasksInput {
  listScrapingTasks: (
    env: 'dev' | 'prod',
    kind?: string,
  ) => Promise<ScrapingTaskRow[]>
  getScrapingTaskFields: (
    taskId: string,
    env: 'dev' | 'prod',
  ) => Promise<ScrapingTaskFieldsResponse>
  processScrapingTask: (
    taskId: string,
    req: {
      env: 'dev' | 'prod'
      keepFields: string[]
      uploadToConvex: boolean
      environments: string[]
      accountStatus?: string
    },
  ) => Promise<{
    stats: ProcessingSummary['stats']
    uploaded: Record<string, number>
    duplicates: Record<string, number>
    scrapingInserted: Record<string, number>
    scrapingDuplicates: Record<string, number>
  }>
}

function useScrapingTasksList(
  listScrapingTasks: ScrapingTasksInput['listScrapingTasks'],
  tasksKind: 'followers' | 'following' | '',
) {
  const [scrapingTasks, setScrapingTasks] = useState<ScrapingTaskRow[]>([])
  const [scrapingLoading, setScrapingLoading] = useState(false)
  const [scrapingError, setScrapingError] = useState<string | null>(null)

  const refreshScrapingTasks = useCallback(async () => {
    setScrapingLoading(true)
    setScrapingError(null)
    try {
      const tasks = await listScrapingTasks(
        DEFAULT_ACCOUNTS_ENV,
        tasksKind || undefined,
      )
      setScrapingTasks(tasks)
      return tasks
    } catch (error) {
      setScrapingTasks([])
      setScrapingError(error instanceof Error ? error.message : String(error))
      return []
    } finally {
      setScrapingLoading(false)
    }
  }, [listScrapingTasks, tasksKind])

  useEffect(() => {
    void refreshScrapingTasks()
  }, [refreshScrapingTasks])

  return { scrapingTasks, scrapingLoading, scrapingError, refreshScrapingTasks }
}

function useTaskSelection(
  getScrapingTaskFields: ScrapingTasksInput['getScrapingTaskFields'],
  scrapingTasks: ScrapingTaskRow[],
) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedTaskPreview, setSelectedTaskPreview] =
    useState<ScrapingTaskFieldsResponse | null>(null)
  const [selectedTaskLoading, setSelectedTaskLoading] = useState(false)
  const [selectedTaskError, setSelectedTaskError] = useState<string | null>(
    null,
  )

  useEffect(() => {
    if (!selectedTaskId) return
    const stillExists = scrapingTasks.some(
      (task) => String(task._id || '') === selectedTaskId,
    )
    if (!stillExists) {
      setSelectedTaskId(null)
      setSelectedTaskPreview(null)
      setSelectedTaskError(null)
    }
  }, [scrapingTasks, selectedTaskId])

  const selectedTask = useMemo(
    () =>
      scrapingTasks.find(
        (task) => String(task._id || '') === selectedTaskId,
      ) ?? null,
    [scrapingTasks, selectedTaskId],
  )

  const loadSelectedTaskPreview = useCallback(
    async (taskId: string) => {
      if (!taskId) return
      setSelectedTaskError(null)
      setSelectedTaskLoading(true)
      try {
        const preview = await getScrapingTaskFields(
          taskId,
          DEFAULT_ACCOUNTS_ENV,
        )
        setSelectedTaskPreview(preview)
      } catch (error) {
        setSelectedTaskPreview(null)
        setSelectedTaskError(
          error instanceof Error ? error.message : String(error),
        )
      } finally {
        setSelectedTaskLoading(false)
      }
    },
    [getScrapingTaskFields],
  )

  const clearSelection = useCallback(() => {
    setSelectedTaskId(null)
    setSelectedTaskPreview(null)
    setSelectedTaskError(null)
  }, [])

  return {
    selectedTaskId,
    setSelectedTaskId,
    selectedTask,
    selectedTaskPreview,
    selectedTaskLoading,
    selectedTaskError,
    setSelectedTaskError,
    loadSelectedTaskPreview,
    clearSelection,
  }
}

function deriveTaskPreviewFields(
  preview: ScrapingTaskFieldsResponse | null,
) {
  const detectedUsernameField = preview
    ? findAlias(preview.fields, USERNAME_ALIASES)
    : null
  const detectedFullNameField = preview
    ? findAlias(preview.fields, FULLNAME_ALIASES)
    : null
  const previewFields = preview
    ? buildPreviewFields(
        preview.fields,
        preview.sampleRow,
        detectedUsernameField,
        detectedFullNameField,
      )
    : []
  const missingUsername = preview !== null && !detectedUsernameField

  return {
    selectedTaskDetectedUsernameField: detectedUsernameField,
    selectedTaskDetectedFullNameField: detectedFullNameField,
    selectedTaskPreviewFields: previewFields,
    selectedTaskMissingUsername: missingUsername,
  }
}

function useScrapingHandlerActions(
  selection: ReturnType<typeof useTaskSelection>,
  refreshScrapingTasks: () => Promise<ScrapingTaskRow[]>,
  setScrapingResult: React.Dispatch<React.SetStateAction<ProcessingSummary | null>>,
) {
  const handleScrapingReset = useCallback(() => {
    selection.clearSelection()
    setScrapingResult(null)
  }, [selection, setScrapingResult])

  const handleRefreshScrapingTasks = useCallback(async () => {
    const tasks = await refreshScrapingTasks()
    if (!selection.selectedTaskId) return
    const stillExists = tasks.some(
      (task) => String(task._id || '') === selection.selectedTaskId,
    )
    if (!stillExists) { selection.clearSelection(); return }
    await selection.loadSelectedTaskPreview(selection.selectedTaskId)
  }, [selection, refreshScrapingTasks])

  const handleSelectTask = useCallback(
    async (taskId: string) => {
      if (!taskId || selection.selectedTaskLoading) return
      selection.setSelectedTaskId(taskId)
      selection.setSelectedTaskError(null)
      setScrapingResult(null)
      await selection.loadSelectedTaskPreview(taskId)
    },
    [selection, setScrapingResult],
  )

  return { handleScrapingReset, handleRefreshScrapingTasks, handleSelectTask }
}

function useScrapingHandlers(
  selection: ReturnType<typeof useTaskSelection>,
  refreshScrapingTasks: () => Promise<ScrapingTaskRow[]>,
  processScrapingTask: ScrapingTasksInput['processScrapingTask'],
  selectedTaskMissingUsername: boolean,
) {
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(null)
  const [scrapingResult, setScrapingResult] = useState<ProcessingSummary | null>(null)

  const actions = useScrapingHandlerActions(selection, refreshScrapingTasks, setScrapingResult)

  const handleProcessTask = useCallback(async () => {
    const { selectedTaskId, selectedTaskPreview } = selection
    if (!selectedTaskId || !selectedTaskPreview || selectedTaskMissingUsername) return
    setProcessingTaskId(selectedTaskId)
    selection.setSelectedTaskError(null)
    try {
      const result = await processScrapingTask(selectedTaskId, {
        env: DEFAULT_ACCOUNTS_ENV,
        keepFields: selectedTaskPreview.fields,
        uploadToConvex: true,
        environments: DEFAULT_PROCESS_ENVIRONMENTS,
        accountStatus: 'available',
      })
      setScrapingResult({
        stats: result.stats,
        uploaded: result.uploaded,
        duplicates: result.duplicates,
        scrapingInserted: result.scrapingInserted,
        scrapingDuplicates: result.scrapingDuplicates,
      })
      await refreshScrapingTasks()
    } catch (error) {
      selection.setSelectedTaskError(error instanceof Error ? error.message : String(error))
    } finally {
      setProcessingTaskId(null)
    }
  }, [processScrapingTask, refreshScrapingTasks, selection, selectedTaskMissingUsername])

  return {
    processingTaskId, scrapingResult,
    handleScrapingReset: actions.handleScrapingReset,
    handleRefreshScrapingTasks: actions.handleRefreshScrapingTasks,
    handleSelectTask: actions.handleSelectTask,
    handleProcessTask,
  }
}

function useFilteredTasks(
  scrapingTasks: ScrapingTaskRow[],
  searchQuery: string,
) {
  return useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return scrapingTasks
    return scrapingTasks.filter((task) => {
      const fields = [
        task.name,
        task.kind,
        task.targetUsername,
        task.status,
        formatDate(task.createdAt),
      ]
      return fields.some((f) =>
        String(f ?? '')
          .toLowerCase()
          .includes(query),
      )
    })
  }, [scrapingTasks, searchQuery])
}

function mergeNumberRecord(
  target: Record<string, number>,
  source: Record<string, number>,
) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value
  }
}

function getTaskLabel(task: ScrapingTaskRow | undefined, taskId: string) {
  return task?.name || task?.targetUsername || `Artifact ${taskId}`
}

export function useScrapingTasks(input: ScrapingTasksInput) {
  const { listScrapingTasks, getScrapingTaskFields, processScrapingTask } =
    input

  const [taskSearchQuery, setTaskSearchQuery] = useState('')
  const [tasksKind, setTasksKind] = useState<'followers' | 'following' | ''>('')

  const { scrapingTasks, scrapingLoading, scrapingError, refreshScrapingTasks } =
    useScrapingTasksList(listScrapingTasks, tasksKind)

  const selection = useTaskSelection(getScrapingTaskFields, scrapingTasks)
  const {
    selectedTaskId,
    selectedTask,
    selectedTaskPreview,
    selectedTaskLoading,
    selectedTaskError,
  } = selection
  const derived = deriveTaskPreviewFields(selectedTaskPreview)

  const {
    processingTaskId,
    scrapingResult,
    handleScrapingReset: resetHandlers,
    handleRefreshScrapingTasks,
    handleSelectTask,
    handleProcessTask,
  } = useScrapingHandlers(
    selection,
    refreshScrapingTasks,
    processScrapingTask,
    derived.selectedTaskMissingUsername,
  )

  const filteredScrapingTasks = useFilteredTasks(scrapingTasks, taskSearchQuery)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [bulkProcessingLabel, setBulkProcessingLabel] = useState<string | null>(
    null,
  )
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 })
  const [bulkResult, setBulkResult] =
    useState<BulkScrapingImportResult | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedTaskIds((previous) =>
      previous.filter((taskId) =>
        scrapingTasks.some((task) => String(task._id || '') === taskId),
      ),
    )
  }, [scrapingTasks])

  const selectedTaskIdSet = useMemo(
    () => new Set(selectedTaskIds),
    [selectedTaskIds],
  )
  const visibleTaskIds = useMemo(
    () => filteredScrapingTasks.map((task) => String(task._id || '')),
    [filteredScrapingTasks],
  )
  const allVisibleSelected =
    visibleTaskIds.length > 0 &&
    visibleTaskIds.every((taskId) => selectedTaskIdSet.has(taskId))
  const someVisibleSelected =
    visibleTaskIds.some((taskId) => selectedTaskIdSet.has(taskId)) &&
    !allVisibleSelected

  const handleToggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds((previous) => {
      if (previous.includes(taskId)) {
        return previous.filter((id) => id !== taskId)
      }
      return [...previous, taskId]
    })
  }, [])

  const handleToggleAllVisibleSelection = useCallback(
    (checked: boolean) => {
      setSelectedTaskIds((previous) => {
        const next = new Set(previous)
        for (const taskId of visibleTaskIds) {
          if (checked) {
            next.add(taskId)
          } else {
            next.delete(taskId)
          }
        }
        return Array.from(next)
      })
    },
    [visibleTaskIds],
  )

  const clearSelectedTasks = useCallback(() => {
    setSelectedTaskIds([])
  }, [])

  const clearBulkResult = useCallback(() => {
    setBulkResult(null)
    setBulkError(null)
  }, [])

  const handleProcessSelectedTasks = useCallback(async () => {
    if (selectedTaskIds.length === 0 || bulkProcessing) return

    const taskMap = new Map(
      scrapingTasks.map((task) => [String(task._id || ''), task]),
    )
    const summary: ProcessingSummary = {
      stats: { totalProcessed: 0, removed: 0, remaining: 0 },
      uploaded: {},
      duplicates: {},
      scrapingInserted: {},
      scrapingDuplicates: {},
    }
    const skippedArtifacts: string[] = []
    const failedArtifacts: Array<{ name: string; reason: string }> = []
    let processedArtifacts = 0

    setBulkProcessing(true)
    setBulkError(null)
    setBulkResult(null)
    setBulkProgress({ current: 0, total: selectedTaskIds.length })

    try {
      for (const [index, taskId] of selectedTaskIds.entries()) {
        const task = taskMap.get(taskId)
        const taskLabel = getTaskLabel(task, taskId)
        setBulkProcessingLabel(taskLabel)
        setBulkProgress({ current: index + 1, total: selectedTaskIds.length })

        try {
          const preview = await getScrapingTaskFields(
            taskId,
            DEFAULT_ACCOUNTS_ENV,
          )
          const detectedUsernameField = findAlias(
            preview.fields,
            USERNAME_ALIASES,
          )

          if (!detectedUsernameField) {
            skippedArtifacts.push(taskLabel)
            continue
          }

          const result = await processScrapingTask(taskId, {
            env: DEFAULT_ACCOUNTS_ENV,
            keepFields: preview.fields,
            uploadToConvex: true,
            environments: DEFAULT_PROCESS_ENVIRONMENTS,
            accountStatus: 'available',
          })

          processedArtifacts += 1
          summary.stats.totalProcessed += result.stats.totalProcessed
          summary.stats.removed += result.stats.removed
          summary.stats.remaining += result.stats.remaining
          mergeNumberRecord(summary.uploaded, result.uploaded)
          mergeNumberRecord(summary.duplicates, result.duplicates)
          mergeNumberRecord(
            summary.scrapingInserted ?? {},
            result.scrapingInserted,
          )
          mergeNumberRecord(
            summary.scrapingDuplicates ?? {},
            result.scrapingDuplicates,
          )
        } catch (error) {
          failedArtifacts.push({
            name: taskLabel,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }

      await refreshScrapingTasks()
      setSelectedTaskIds([])
      setBulkResult({
        stats: summary.stats,
        uploaded: summary.uploaded,
        duplicates: summary.duplicates,
        scrapingInserted: summary.scrapingInserted ?? {},
        scrapingDuplicates: summary.scrapingDuplicates ?? {},
        processedArtifacts,
        skippedArtifacts,
        failedArtifacts,
      })
    } catch (error) {
      setBulkError(
        error instanceof Error
          ? error.message
          : 'Bulk artifact import failed',
      )
    } finally {
      setBulkProcessing(false)
      setBulkProcessingLabel(null)
      setBulkProgress({ current: 0, total: 0 })
    }
  }, [
    bulkProcessing,
    getScrapingTaskFields,
    processScrapingTask,
    refreshScrapingTasks,
    scrapingTasks,
    selectedTaskIds,
  ])

  const isScrapingBusy =
    scrapingLoading || selectedTaskLoading || Boolean(processingTaskId) || bulkProcessing
  const scrapingDirty =
    Boolean(selectedTaskId) ||
    selectedTaskIds.length > 0 ||
    Boolean(scrapingResult) ||
    Boolean(bulkResult) ||
    Boolean(bulkError) ||
    taskSearchQuery.trim().length > 0 ||
    tasksKind !== ''

  const handleScrapingReset = useCallback(() => {
    setTaskSearchQuery('')
    setTasksKind('')
    setSelectedTaskIds([])
    setBulkError(null)
    setBulkResult(null)
    resetHandlers()
  }, [resetHandlers])

  return {
    taskSearchQuery,
    setTaskSearchQuery,
    tasksKind,
    setTasksKind,
    filteredScrapingTasks,
    scrapingLoading,
    scrapingError,
    selectedTaskId,
    selectedTask,
    selectedTaskPreview,
    selectedTaskLoading,
    selectedTaskError,
    selectedTaskIds,
    allVisibleSelected,
    someVisibleSelected,
    processingTaskId,
    scrapingResult,
    bulkProcessing,
    bulkProcessingLabel,
    bulkProgress,
    bulkResult,
    bulkError,
    ...derived,
    isScrapingBusy,
    scrapingDirty,
    handleScrapingReset,
    handleRefreshScrapingTasks,
    handleSelectTask,
    handleToggleTaskSelection,
    handleToggleAllVisibleSelection,
    clearSelectedTasks,
    clearBulkResult,
    handleProcessTask,
    handleProcessSelectedTasks,
  }
}
