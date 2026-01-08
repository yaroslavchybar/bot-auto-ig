/**
 * Standardized API error responses.
 * All API errors should use this format for consistency.
 */

export interface ApiErrorResponse {
    success: false
    error: {
        code: string
        message: string
    }
}

export interface ApiSuccessResponse<T = unknown> {
    success: true
    data: T
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse

/**
 * Create a standardized error response.
 */
export function errorResponse(code: string, message: string): ApiErrorResponse {
    return {
        success: false,
        error: { code, message }
    }
}

/**
 * Create a standardized success response.
 */
export function successResponse<T>(data: T): ApiSuccessResponse<T> {
    return {
        success: true,
        data
    }
}

/**
 * Common error codes for consistency.
 */
export const ErrorCodes = {
    // Validation
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_INPUT: 'INVALID_INPUT',
    MISSING_FIELD: 'MISSING_FIELD',

    // Resource
    NOT_FOUND: 'NOT_FOUND',
    ALREADY_EXISTS: 'ALREADY_EXISTS',

    // State
    CONFLICT: 'CONFLICT',
    AUTOMATION_RUNNING: 'AUTOMATION_RUNNING',
    AUTOMATION_NOT_RUNNING: 'AUTOMATION_NOT_RUNNING',

    // Auth
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',

    // Rate limiting
    RATE_LIMITED: 'RATE_LIMITED',

    // Server
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]
