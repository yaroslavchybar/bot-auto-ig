import type { Frame, Page } from 'playwright-core'
import type { SessionDecision } from '../../shared/sessionDecision.js'

type Reporter = (decision: SessionDecision | null) => void
const reporters = new WeakMap<Page, { report: Reporter; revision: number }>()

export function publishSessionDecision(page: Page, decision: SessionDecision | null): void {
  const state = reporters.get(page)
  if (state) { state.revision++; state.report(decision) }
}

/** Late AI replies cannot overwrite a newer item, navigation, or browser lease. */
export function beginSessionDecision(page: Page, decision: SessionDecision): Reporter {
  publishSessionDecision(page, decision)
  const state = reporters.get(page), revision = state?.revision
  return result => {
    if (state && reporters.get(page) === state && state.revision === revision)
      publishSessionDecision(page, result)
  }
}

/** Scope live decisions to one browser lease and clear them on main-frame navigation. */
export function attachSessionDecisions(page: Page, report: Reporter): () => void {
  reporters.set(page, { report, revision: 0 })
  const navigated = (frame: Frame) => {
    if (frame === page.mainFrame()) publishSessionDecision(page, null)
  }
  page.on('framenavigated', navigated)
  return () => {
    page.off('framenavigated', navigated)
    reporters.delete(page)
  }
}
