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
