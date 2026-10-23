import type { Locator } from 'playwright-core'
import { AsyncLocalStorage } from 'node:async_hooks'
import { errors } from 'playwright-core'
import { logDiagnostic } from '../../shared/logger.js'
import { BrowseSession, SessionEnded } from './session.js'

export type UiDiagnosticContext = {
  action?: string
  stage?: string
  session?: BrowseSession
  stopped?: () => boolean
  /** Absence is a normal result for this specific lookup, e.g. no unseen stories. */
  expectedTimeout?: boolean
  /** Preserve the semantic target when the input wrapper pins it with a temporary marker. */
  target?: Locator
  /** Only pass a small, known settings/control region; never a feed or message container. */
  controls?: Locator
}

const contexts = new AsyncLocalStorage<UiDiagnosticContext>()
export const currentUiDiagnosticContext = () => contexts.getStore()
export const withUiDiagnosticContext = <T>(context: UiDiagnosticContext, run: () => T): T =>
  contexts.run({ ...contexts.getStore(), ...context }, run)

const reported = new WeakSet<Error>()
const controlRoles = new Set(['button', 'switch', 'checkbox', 'radio', 'menuitem', 'tab', 'combobox'])

/** Keep only control roles/names, excluding snapshot text, URLs, input values and other page content. */
export function diagnosticControls(snapshot: unknown): { role: string; name: string }[] {
  const result: { role: string; name: string }[] = []
  const queue: unknown[] = Array.isArray(snapshot) ? snapshot.slice(0, 100) : []
  for (let visited = 0; queue.length && visited < 100 && result.length < 12; visited++) {
    const node = queue.shift()
    if (!node || typeof node !== 'object') continue
    const { role, name, children } = node as Record<string, unknown>
    if (typeof role === 'string' && controlRoles.has(role) && typeof name === 'string')
      result.push({ role, name: name.slice(0, 100) })
    if (Array.isArray(children)) queue.push(...children.slice(0, 100 - queue.length))
  }
  return result
}

/** Best-effort diagnostics must never replace the action error or add an unbounded browser wait. */
export async function reportUiFailure(target: Locator, error: unknown, context: UiDiagnosticContext & {
  phase: 'selection' | 'input' | 'verification' | 'navigation'; startedAt: number; timeoutMs?: number
}): Promise<void> {
  if (!(error instanceof Error) || error instanceof SessionEnded || reported.has(error)) return
  if (context.session?.stopped() || context.stopped?.()) { reported.add(error); return }
  if (context.expectedTimeout && error instanceof errors.TimeoutError) return
  const ambiguous = error.message.includes('strict mode violation')
  reported.add(error)
  try {
    const source = context.target ?? target
    const fields: Record<string, unknown> = {
      action: context.action || context.phase, stage: context.stage || context.phase,
      phase: context.phase, timeoutMs: context.timeoutMs, durationMs: Math.max(0, Date.now() - context.startedAt),
      failureKind: ambiguous ? 'ambiguous_target' : error instanceof errors.TimeoutError ? `${context.phase}_timeout` : 'interaction_failed',
      expectedSelector: source.toString().slice(0, 1000),
    }
    try { fields.pagePath = new URL(source.page().url()).pathname } catch { /* Page may already be gone. */ }
    if (context.controls) {
      const timeout = Math.max(1, Math.floor(Math.min(500, (context.session?.end ?? Infinity) - Date.now())))
      try {
        const snapshot = await context.controls.ariaSnapshotJSON({ depth: 5, timeout, signal: AbortSignal.timeout(timeout) })
        fields.controls = diagnosticControls(snapshot)
      } catch { fields.controlsUnavailable = true }
    }
    // Playwright call logs can echo typed text or file arguments. The selector is recorded separately.
    const message = error.message.split(/\r?\n/, 1)[0]
    const frames = error.stack?.split(/\r?\n/).filter(line => /^\s+at\s/.test(line)).slice(0, 8)
    logDiagnostic({ ...fields, event: 'automation.ui_failure', error: {
      type: error.name, message, ...(frames?.length ? { stack: frames.join('\n') } : {}),
    } })
  } catch { /* Preserve the original failure even if diagnostics cannot be collected. */ }
}
