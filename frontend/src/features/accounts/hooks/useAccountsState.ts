import { useCallback, useState } from 'react'
import { useDataUploader } from './useDataUploader'
import { useCsvHandlers } from './useCsvHandlers'
import { useScrapingTasks } from './useScrapingTasks'

export type AccountsMode = 'csv' | 'scraping'

export interface ProcessingSummary {
  stats: {
    totalProcessed: number
    removed: number
    remaining: number
  }
  uploaded: Record<string, number>
  duplicates: Record<string, number>
}

export const USERNAME_ALIASES = [
  'user_name',
  'userName',
  'username',
  'login',
  'User Name',
]
export const FULLNAME_ALIASES = ['full_name', 'fullName', 'name']

export function findAlias(fields: string[], aliases: string[]) {
  return aliases.find((alias) => fields.includes(alias)) ?? null
}

export function formatDate(value?: number) {
  if (typeof value !== 'number') return '-'
  return new Date(value).toLocaleString()
}

export function sumRecordValues(value: Record<string, number>) {
  return Object.values(value).reduce((sum, count) => sum + count, 0)
}

export function buildPreviewFields(
  fields: string[],
  sampleRow: Record<string, string>,
  detectedUsernameField: string | null,
  detectedFullNameField: string | null,
) {
  const ordered = [
    detectedUsernameField,
    detectedFullNameField,
    ...fields,
    ...Object.keys(sampleRow),
  ].filter(Boolean) as string[]

  const unique: string[] = []
  for (const field of ordered) {
    if (!unique.includes(field)) unique.push(field)
  }

  return unique.slice(0, 6)
}

export function useAccountsState() {
  const uploader = useDataUploader()
  const { state, uploadFile, processFile, reset } = uploader

  const [activeMode, setActiveMode] = useState<AccountsMode>('csv')

  const csv = useCsvHandlers({ state, uploadFile, processFile, reset })
  const { handleCsvReset } = csv

  const scraping = useScrapingTasks({
    listScrapingTasks: uploader.listScrapingTasks,
    getScrapingTaskFields: uploader.getScrapingTaskFields,
    processScrapingTask: uploader.processScrapingTask,
  })
  const { handleScrapingReset } = scraping

  const handleResetActiveMode = useCallback(() => {
    if (activeMode === 'csv') {
      handleCsvReset()
      return
    }
    handleScrapingReset()
  }, [activeMode, handleCsvReset, handleScrapingReset])

  return {
    state,
    fileInputRef: csv.fileInputRef,
    activeMode,
    setActiveMode,
    dragActive: csv.dragActive,
    ...scraping,
    ...csv,
    handleResetActiveMode,
  }
}

export type AccountsState = ReturnType<typeof useAccountsState>
