import { openBrowserSession } from './cloak.js'
import { requestStop, releaseStdin } from './lifecycle.js'
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
  watchStdinForStop()
  const profileName = String(arg('--name') || '').trim()
  if (!profileName) throw new Error('--name is required')
  const workflowId = arg('--workflow-id') || 'manual'
  const session = await openBrowserSession(profileName, {
    headless: process.argv.includes('--headless'),
    display: process.env.DISPLAY,
  })

  if (session.display)
    process.stdout.write(
      `__EVENT__${JSON.stringify({
        type: 'display_allocated',
        workflowId: workflowId,
        profileName,
        displayNum: session.display.displayNum,
        vncPort: session.display.vncPort,
      })}__EVENT__\n`,
    )
  process.stdout.write('Browser is running...\n')

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
  releaseStdin()
}

main().catch((error) => {
  releaseStdin()
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
