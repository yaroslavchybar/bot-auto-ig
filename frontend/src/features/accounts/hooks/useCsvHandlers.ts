import { useCallback, useRef, useState } from 'react'
import type { UploadState } from '../types'
import {
  findAlias,
  buildPreviewFields,
  USERNAME_ALIASES,
  FULLNAME_ALIASES,
} from './useAccountsState'

const DEFAULT_PROCESS_ENVIRONMENTS = ['dev']

interface CsvHandlersInput {
  state: UploadState
  uploadFile: (file: File) => Promise<unknown>
  processFile: (
    jobId: string,
    keepFields: string[],
    uploadToConvex: boolean,
    environments: string[],
  ) => Promise<unknown>
  reset: () => void
}

function deriveCsvFields(state: UploadState) {
  const csvDetectedUsernameField =
    state.step === 'selecting'
      ? findAlias(state.fields, USERNAME_ALIASES)
      : null
  const csvDetectedFullNameField =
    state.step === 'selecting'
      ? findAlias(state.fields, FULLNAME_ALIASES)
      : null
  const csvPreviewFields =
    state.step === 'selecting'
      ? buildPreviewFields(
          state.fields,
          state.sampleRow,
          csvDetectedUsernameField,
          csvDetectedFullNameField,
        )
      : []
  const csvMissingUsername =
    state.step === 'selecting' && !csvDetectedUsernameField

  return {
    csvDetectedUsernameField,
    csvDetectedFullNameField,
    csvPreviewFields,
    csvMissingUsername,
  }
}

function useDragHandlers(uploadFile: (file: File) => Promise<unknown>) {
  const [dragActive, setDragActive] = useState(false)

  const handleUploadFile = useCallback(
    async (file: File) => {
      setDragActive(false)
      await uploadFile(file)
    },
    [uploadFile],
  )

  const handleDrag = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'dragenter' || event.type === 'dragover') {
      setDragActive(true)
    } else if (event.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setDragActive(false)
      const file = event.dataTransfer.files?.[0]
      if (file?.name.toLowerCase().endsWith('.csv')) {
        void handleUploadFile(file)
      }
    },
    [handleUploadFile],
  )

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) {
        void handleUploadFile(file)
      }
    },
    [handleUploadFile],
  )

  return { dragActive, setDragActive, handleDrag, handleDrop, handleFileSelect }
}

export function useCsvHandlers({
  state,
  uploadFile,
  processFile,
  reset,
}: CsvHandlersInput) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { dragActive, setDragActive, handleDrag, handleDrop, handleFileSelect } =
    useDragHandlers(uploadFile)
  const {
    csvDetectedUsernameField,
    csvDetectedFullNameField,
    csvPreviewFields,
    csvMissingUsername,
  } = deriveCsvFields(state)

  const isCsvBusy = state.step === 'uploading' || state.step === 'processing'
  const csvDirty = state.step !== 'idle'

  const handleCsvReset = useCallback(() => {
    reset()
    setDragActive(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [reset, setDragActive])

  const handleProcessCsv = useCallback(() => {
    if (state.step !== 'selecting' || csvMissingUsername) return
    void processFile(
      state.jobId,
      state.fields,
      true,
      DEFAULT_PROCESS_ENVIRONMENTS,
    )
  }, [csvMissingUsername, processFile, state])

  return {
    fileInputRef,
    dragActive,
    csvDetectedUsernameField,
    csvDetectedFullNameField,
    csvPreviewFields,
    csvMissingUsername,
    isCsvBusy,
    csvDirty,
    handleCsvReset,
    handleDrag,
    handleDrop,
    handleFileSelect,
    handleProcessCsv,
  }
}
