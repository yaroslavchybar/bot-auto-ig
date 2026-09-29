import logger, { ingestLogEntry } from '../shared/logger.js'
import { isBenignBrowserStderr, parseLogLine } from './parser.js'

/** Capture library console output at executable startup. Pino writes directly to stdout. */
export function captureConsole(): () => void {
  const original = { log: console.log, info: console.info, warn: console.warn, debug: console.debug, error: console.error }
  for (const method of Object.keys(original) as Array<keyof typeof original>) {
    console[method] = (...args: unknown[]) => {
      if (!args.length) return
      const first = args[0]
      const message = typeof first === 'string' ? first : first instanceof Error ? first.message : undefined
      const entry = typeof first === 'string' ? parseLogLine(first)?.logEntry : undefined
      if (entry) { ingestLogEntry(entry); return }
      const level = method === 'error' && !isBenignBrowserStderr(message || '') ? 'error' : 'info'
      logger[level]({ event: 'runtime.console', consoleMethod: method, message,
        error: args.find(value => value instanceof Error),
        arguments: args.filter(value => value !== first && !(value instanceof Error)),
        ...(message === undefined && !(first instanceof Error) ? { value: first } : {}),
      })
    }
  }
  return () => { Object.assign(console, original) }
}
