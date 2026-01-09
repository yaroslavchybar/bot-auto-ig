/** Response from uploading a CSV file */
export interface UploadResponse {
    jobId: string
    fileName: string
    fields: string[]
    sampleRow: Record<string, string>
    rowCount: number
}

/** Request to process an uploaded CSV */
export interface ProcessRequest {
    keepFields: string[]
    uploadToConvex: boolean
    environments: string[]
}

/** Statistics from filtering */
export interface FilterStats {
    totalProcessed: number
    removed: number
    remaining: number
}

/** Response from processing a CSV */
export interface ProcessResponse {
    status: 'completed' | 'failed'
    stats: FilterStats
    uploaded: Record<string, number>
    duplicates: Record<string, number>
}

/** Job status response */
export interface JobStatus {
    status: 'uploaded' | 'processing' | 'completed' | 'failed'
    stats?: FilterStats
    uploaded?: Record<string, number>
    duplicates?: Record<string, number>
    error?: string
}

/** State for the upload process */
export type UploadState =
    | { step: 'idle' }
    | { step: 'uploading' }
    | { step: 'selecting'; jobId: string; fileName: string; fields: string[]; sampleRow: Record<string, string>; rowCount: number }
    | { step: 'processing'; jobId: string }
    | { step: 'completed'; jobId: string; stats: FilterStats; uploaded: Record<string, number>; duplicates: Record<string, number> }
    | { step: 'error'; message: string }
