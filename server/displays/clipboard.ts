import { Router } from 'express'
import { execFile } from 'node:child_process'
import { activeDisplays, automationWorkers, type ActiveDisplaySession } from '../shared/store.js'
import { asyncHandler } from '../shared/asyncHandler.js'
import { AppError, ExternalServiceError, NotFoundError, ValidationError } from '../shared/errors.js'

// Server-side clipboard for a remote display (option 2).
// Reads/writes the X CLIPBOARD selection on the session's DISPLAY via xclip,
// so paste works even when the VNC clipboard channel is flaky.
// Text only. The browser still gates local access behind a user click
// (navigator.clipboard needs a gesture), so the UI stays an explicit button.

const MAX_CHARS = 100_000
const TIMEOUT_MS = 5_000

function resolveDisplay(vncPortRaw: unknown): ActiveDisplaySession {
  const vncPort = Number(vncPortRaw)
  if (!Number.isSafeInteger(vncPort) || vncPort <= 0 || vncPort > 65535)
    throw new ValidationError('Invalid display port')
  for (const session of activeDisplays.values()) {
    if (session.vncPort === vncPort) return session
  }
  throw new NotFoundError('Display session not found')
}

// Writes are denied while an agent owns the session. An automation worker entry
// means the agent is driving the browser (or is being stopped) — replacing
// the clipboard then would corrupt its next paste. Manual sessions have no
// worker entry, so they are always writable. Never trust the frontend's
// control state for this; it is only a UI hint.
function assertNoAgentControls(session: ActiveDisplaySession): void {
  if (automationWorkers.has(session.automationId)) {
    throw new AppError(
      'Agent still controls this session — stop the agent before pasting',
      409,
      'AGENT_ACTIVE',
    )
  }
}

function xclipErrorMessage(stderr: string): string {
  return String(stderr || '').trim().split('\n')[0] || 'clipboard command failed'
}

function runXclip(displayNum: number, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'xclip',
      args,
      {
        env: { ...process.env, DISPLAY: `:${displayNum}` },
        timeout: TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = xclipErrorMessage(String(stderr))
          // Empty selection is not an error for reads — report blank text.
          if (args.includes('-o') && /not available|bad target|no selection/i.test(detail)) {
            resolve('')
            return
          }
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new ExternalServiceError('Clipboard unavailable on this host'))
            return
          }
          reject(new ExternalServiceError(`Clipboard failed: ${detail}`))
          return
        }
        resolve(String(stdout ?? ''))
      },
    )
    if (input !== undefined) {
      child.stdin?.write(input, (writeError) => {
        if (writeError) reject(new ExternalServiceError('Clipboard failed: could not write'))
        child.stdin?.end()
      })
    }
  })
}

const router = Router()

// Read the remote CLIPBOARD selection as text ('' when empty).
// Reads don't disturb the agent, so they stay open while it runs.
router.get(
  '/:vncPort/clipboard',
  asyncHandler(async (req, res) => {
    const session = resolveDisplay(req.params.vncPort)
    const text = await runXclip(session.displayNum, ['-selection', 'clipboard', '-o'])
    res.json({ text })
  }),
)

// Replace the remote CLIPBOARD selection. The user then pastes with Ctrl+V.
router.post(
  '/:vncPort/clipboard',
  asyncHandler(async (req, res) => {
    const session = resolveDisplay(req.params.vncPort)
    assertNoAgentControls(session)
    const text = (req.body as { text?: unknown } | undefined)?.text
    if (typeof text !== 'string' || !text) throw new ValidationError('text is required')
    if (text.length > MAX_CHARS) throw new ValidationError('Text too large (max 100k chars)')
    await runXclip(session.displayNum, ['-selection', 'clipboard', '-i'], text)
    res.json({ success: true })
  }),
)

export default router
