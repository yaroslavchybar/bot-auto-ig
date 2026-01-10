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

export interface ScrapingTaskRow {
    _id: string
    name: string
    kind: string
    mode?: string
    targetUsername?: string
    limit?: number
    status?: string
    storageId?: string
    imported?: boolean
    createdAt?: number
    updatedAt?: number
    lastScraped?: number
}

export interface ListScrapingTasksResponse {
    tasks: ScrapingTaskRow[]
}

export interface ImportScrapingTaskRequest {
    env: 'dev' | 'prod'
    accountStatus?: string
}

export interface ImportScrapingTaskResponse {
    taskId: string
    env: string
    usernamesExtracted: number
    inserted: number
    skipped: number
}

export interface ScrapingTaskFieldsResponse {
    taskId: string
    env: string
    fields: string[]
    sampleRow: Record<string, string>
    rowCount: number
}

export interface ProcessScrapingTaskRequest {
    env: 'dev' | 'prod'
    keepFields: string[]
    uploadToConvex: boolean
    environments: string[]
    accountStatus?: string
}

export interface ProcessScrapingTaskResponse {
    status: 'completed' | 'failed'
    taskId: string
    env: string
    usernamesExtracted: number
    stats: FilterStats
    uploaded: Record<string, number>
    duplicates: Record<string, number>
}

/** State for the upload process */
export type UploadState =
    | { step: 'idle' }
    | { step: 'uploading' }
    | { step: 'selecting'; jobId: string; fileName: string; fields: string[]; sampleRow: Record<string, string>; rowCount: number }
    | { step: 'processing'; jobId: string }
    | { step: 'completed'; jobId: string; stats: FilterStats; uploaded: Record<string, number>; duplicates: Record<string, number> }
    | { step: 'error'; message: string }
