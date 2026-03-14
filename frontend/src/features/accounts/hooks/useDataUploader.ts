import { useState, useCallback } from 'react'
import { env as appEnv } from '@/lib/env'
import type {
  ImportScrapingTaskRequest,
  ImportScrapingTaskResponse,
  ListScrapingTasksResponse,
  ProcessRequest,
  ProcessResponse,
  ProcessScrapingTaskRequest,
  ProcessScrapingTaskResponse,
  ScrapingTaskRow,
  ScrapingTaskFieldsResponse,
  UploadResponse,
  UploadState,
} from '../types'

async function handleErrorResponse(
  response: Response,
  fallbackMessage: string,
) {
  const error = await response
    .json()
    .catch(() => ({ detail: fallbackMessage }))
  throw new Error(error.detail || fallbackMessage)
}

async function fetchScrapingTasks(
  environment: 'dev' | 'prod',
  kind?: string,
) {
  const params = new URLSearchParams()
  params.set('env', environment)
  if (kind) params.set('kind', kind)
  const response = await fetch(
    `${appEnv.dataUploaderUrl}/scraping-tasks?${params.toString()}`,
    { method: 'GET' },
  )
  if (!response.ok) {
    await handleErrorResponse(
      response,
      'Failed to load workflow scrape artifacts',
    )
  }
  const data: ListScrapingTasksResponse = await response.json()
  return Array.isArray(data.tasks) ? (data.tasks as ScrapingTaskRow[]) : []
}

async function fetchImportScrapingTask(
  taskId: string,
  req: ImportScrapingTaskRequest,
) {
  const response = await fetch(
    `${appEnv.dataUploaderUrl}/scraping-tasks/${encodeURIComponent(taskId)}/import`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
  )
  if (!response.ok) {
    await handleErrorResponse(response, 'Import failed')
  }
  const data: ImportScrapingTaskResponse = await response.json()
  return data
}

async function fetchScrapingTaskFields(
  taskId: string,
  environment: 'dev' | 'prod',
) {
  const params = new URLSearchParams()
  params.set('env', environment)
  const response = await fetch(
    `${appEnv.dataUploaderUrl}/scraping-tasks/${encodeURIComponent(taskId)}/fields?${params.toString()}`,
    { method: 'GET' },
  )
  if (!response.ok) {
    await handleErrorResponse(response, 'Failed to load task fields')
  }
  const data: ScrapingTaskFieldsResponse = await response.json()
  return data
}

async function fetchProcessScrapingTask(
  taskId: string,
  req: ProcessScrapingTaskRequest,
) {
  const response = await fetch(
    `${appEnv.dataUploaderUrl}/scraping-tasks/${encodeURIComponent(taskId)}/process`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
  )
  if (!response.ok) {
    await handleErrorResponse(response, 'Processing failed')
  }
  const data: ProcessScrapingTaskResponse = await response.json()
  return data
}

async function fetchUploadFile(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${appEnv.dataUploaderUrl}/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    await handleErrorResponse(response, 'Upload failed')
  }

  const data: UploadResponse = await response.json()
  return data
}

async function fetchProcessFile(
  jobId: string,
  keepFields: string[],
  uploadToConvex: boolean,
  environments: string[],
) {
  const request: ProcessRequest = { keepFields, uploadToConvex, environments }

  const response = await fetch(
    `${appEnv.dataUploaderUrl}/upload/${jobId}/process`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
  )

  if (!response.ok) {
    await handleErrorResponse(response, 'Processing failed')
  }

  const data: ProcessResponse = await response.json()
  return data
}

function useScrapingApis() {
  const listScrapingTasks = useCallback(
    async (environment: 'dev' | 'prod', kind?: string) =>
      fetchScrapingTasks(environment, kind),
    [],
  )
  const importScrapingTask = useCallback(
    async (taskId: string, req: ImportScrapingTaskRequest) =>
      fetchImportScrapingTask(taskId, req),
    [],
  )
  const getScrapingTaskFields = useCallback(
    async (taskId: string, environment: 'dev' | 'prod') =>
      fetchScrapingTaskFields(taskId, environment),
    [],
  )
  const processScrapingTask = useCallback(
    async (taskId: string, req: ProcessScrapingTaskRequest) =>
      fetchProcessScrapingTask(taskId, req),
    [],
  )

  return {
    listScrapingTasks,
    importScrapingTask,
    getScrapingTaskFields,
    processScrapingTask,
  }
}

function useUploadFlow() {
  const [state, setState] = useState<UploadState>({ step: 'idle' })

  const uploadFile = useCallback(async (file: File) => {
    setState({ step: 'uploading' })
    try {
      const data = await fetchUploadFile(file)
      setState({
        step: 'selecting',
        jobId: data.jobId,
        fileName: data.fileName,
        fields: data.fields,
        sampleRow: data.sampleRow,
        rowCount: data.rowCount,
      })
      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      setState({ step: 'error', message })
      throw error
    }
  }, [])

  const processFile = useCallback(
    async (
      jobId: string,
      keepFields: string[],
      uploadToConvex: boolean,
      environments: string[],
    ) => {
      setState({ step: 'processing', jobId })
      try {
        const data = await fetchProcessFile(
          jobId,
          keepFields,
          uploadToConvex,
          environments,
        )
        setState({
          step: 'completed',
          jobId,
          stats: data.stats,
          uploaded: data.uploaded,
          duplicates: data.duplicates,
        })
        return data
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Processing failed'
        setState({ step: 'error', message })
        throw error
      }
    },
    [],
  )

  const reset = useCallback(() => {
    setState({ step: 'idle' })
  }, [])

  return { state, uploadFile, processFile, reset }
}

export function useDataUploader() {
  const { state, uploadFile, processFile, reset } = useUploadFlow()
  const scrapingApis = useScrapingApis()

  return { state, uploadFile, processFile, reset, ...scrapingApis }
}
