import { ConvexError } from 'convex/values'
export type ErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION'
export class DomainError extends ConvexError<{ code: ErrorCode; message: string }> {
  constructor(code: ErrorCode, message: string) { super({ code, message }) }
}
