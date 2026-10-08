import { logOperation, addLogContext } from '../shared/logger.js'
import { openBrowserSession } from './cloak.js'
import { requestStop, releaseStdin, shouldStop } from './lifecycle.js'
import { captureConsole } from '../logs/console.js'
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

/**
 * Cooperative stop: the server writes `stop` to stdin (signals don't reach
 * detached children on Windows). The lifecycle abort below runs the same
 * clean shutdown as SIGTERM/SIGBREAK and frees the license seat.
 */
function watchStdinForStop(): void {
  try {
    process.stdin.setEncoding('utf8')
  } catch { return }
  let pending = ''
  process.stdin.on('data', (chunk) => {
    pending += String(chunk)
    let index: number
    while ((index = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, index).trim()
      pending = pending.slice(index + 1)
      if (line === 'stop') requestStop()
    }
  })
  process.stdin.on('error', () => undefined)
}

async function main(): Promise<void> {
  captureConsole()
  return logOperation('browser.session', { profileName: arg('--name'), automationId: arg('--automation-id') || 'manual' }, async () => {
    watchStdinForStop()
    const profileName = String(arg('--name') || '').trim()
    if (!profileName) throw new Error('--name is required')
    const session = await openBrowserSession(profileName, {
      headless: process.argv.includes('--headless'),
      display: process.env.DISPLAY,
      inspect: true,
    })

    addLogContext({ profileId: session.profile.id, headless: process.argv.includes('--headless'),
      displayNum: session.display?.displayNum, vncPort: session.display?.vncPort })

    const watchPage = (page: typeof session.page) => {
      page.once('close', () => {
        if (session.context.pages().length === 0)
          void session.close().catch(() => undefined)
      })
    }
    session.context.on('page', watchPage)
    session.context.pages().forEach(watchPage)
    if (session.context.pages().length === 0) void session.close().catch(() => undefined)
    await session.closed
    if (shouldStop()) addLogContext({ outcome: 'cancelled' })
    releaseStdin()

  })
}

main().catch(() => {
  releaseStdin()
  // The session scope already emitted its failure.
  process.exitCode = 1
})
