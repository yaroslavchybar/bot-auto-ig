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

function useScrapingHandlers(
  selection: ReturnType<typeof useTaskSelection>,
  refreshScrapingTasks: () => Promise<ScrapingTaskRow[]>,
  processScrapingTask: ScrapingTasksInput['processScrapingTask'],
  selectedTaskMissingUsername: boolean,
) {
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(
    null,
  )
  const [scrapingResult, setScrapingResult] =
    useState<ProcessingSummary | null>(null)

  const handleScrapingReset = useCallback(() => {
    selection.clearSelection()
    setScrapingResult(null)
  }, [selection])

  const handleRefreshScrapingTasks = useCallback(async () => {
    const tasks = await refreshScrapingTasks()
    if (!selection.selectedTaskId) return
    const stillExists = tasks.some(
      (task) => String(task._id || '') === selection.selectedTaskId,
    )
    if (!stillExists) {
      selection.clearSelection()
      return
    }
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
    [selection],
  )

  const handleProcessTask = useCallback(async () => {
    const { selectedTaskId, selectedTaskPreview } = selection
    if (!selectedTaskId || !selectedTaskPreview || selectedTaskMissingUsername) {
      return
    }
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
      })
      await refreshScrapingTasks()
    } catch (error) {
      selection.setSelectedTaskError(
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      setProcessingTaskId(null)
    }
  }, [
    processScrapingTask,
    refreshScrapingTasks,
    selection,
    selectedTaskMissingUsername,
  ])

  return {
    processingTaskId,
    scrapingResult,
    handleScrapingReset,
    handleRefreshScrapingTasks,
    handleSelectTask,
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

  const isScrapingBusy =
    scrapingLoading || selectedTaskLoading || Boolean(processingTaskId)
  const scrapingDirty =
    Boolean(selectedTaskId) ||
    Boolean(scrapingResult) ||
    taskSearchQuery.trim().length > 0 ||
    tasksKind !== ''

  const handleScrapingReset = useCallback(() => {
    setTaskSearchQuery('')
    setTasksKind('')
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
    processingTaskId,
    scrapingResult,
    ...derived,
    isScrapingBusy,
    scrapingDirty,
    handleScrapingReset,
    handleRefreshScrapingTasks,
    handleSelectTask,
    handleProcessTask,
  }
}
