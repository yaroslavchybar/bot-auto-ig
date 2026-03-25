/**
 * Custom error classes for structured Express error handling.
 *
 * AppError is the base class; throw typed subclasses from route handlers
 * and let the global error middleware translate them into consistent
 * JSON responses: { success: false, error: { code, message } }.
 */

export class AppError extends Error {
  public readonly statusCode: number
  public readonly code: string

  constructor(message: string, statusCode: number, code: string) {
    super(message)
    this.name = this.constructor.name
    this.statusCode = statusCode
    this.code = code
    // Ensure the prototype chain is set correctly for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND')
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input') {
    super(message, 400, 'VALIDATION_ERROR')
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT')
  }
}

export class ExternalServiceError extends AppError {
  constructor(message = 'External service unavailable') {
    super(message, 503, 'EXTERNAL_SERVICE_ERROR')
  }
}

// ---------------------------------------------------------------------------
// Standardized API error/success response helpers
// (merged from helpers/errors.ts)
// ---------------------------------------------------------------------------

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
