import { useState, useCallback } from 'react'
import type { UploadResponse, ProcessRequest, ProcessResponse, UploadState } from './types'

// In production, use relative path that nginx proxies. In dev, use localhost.
const API_BASE = import.meta.env.VITE_DATAUPLOADER_URL || (import.meta.env.DEV ? 'http://localhost:3002' : '/api/datauploader')

export function useDataUploader() {
    const [state, setState] = useState<UploadState>({ step: 'idle' })

    const uploadFile = useCallback(async (file: File) => {
        setState({ step: 'uploading' })

        try {
            const formData = new FormData()
            formData.append('file', file)

            const response = await fetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: formData,
            })

            if (!response.ok) {
                const error = await response.json().catch(() => ({ detail: 'Upload failed' }))
                throw new Error(error.detail || 'Upload failed')
            }

            const data: UploadResponse = await response.json()

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

    const processFile = useCallback(async (
        jobId: string,
        keepFields: string[],
        uploadToConvex: boolean,
        environments: string[]
    ) => {
        setState({ step: 'processing', jobId })

        try {
            const request: ProcessRequest = {
                keepFields,
                uploadToConvex,
                environments,
            }

            const response = await fetch(`${API_BASE}/upload/${jobId}/process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            })

            if (!response.ok) {
                const error = await response.json().catch(() => ({ detail: 'Processing failed' }))
                throw new Error(error.detail || 'Processing failed')
            }

            const data: ProcessResponse = await response.json()

            setState({
                step: 'completed',
                jobId,
                stats: data.stats,
                uploaded: data.uploaded,
                duplicates: data.duplicates,
            })

            return data
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Processing failed'
            setState({ step: 'error', message })
            throw error
        }
    }, [])

    const reset = useCallback(() => {
        setState({ step: 'idle' })
    }, [])

    return {
        state,
        uploadFile,
        processFile,
        reset,
    }
}
