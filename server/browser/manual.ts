import { openCamoufoxSession } from './camoufox.js'
import { shouldStop } from './lifecycle.js'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const profileName = String(arg('--name') || '').trim()
  if (!profileName) throw new Error('--name is required')
  const workflowId = arg('--workflow-id') || 'manual'
  const session = await openCamoufoxSession(profileName, {
    headless: process.argv.includes('--headless'),
    display: process.env.DISPLAY,
  })

  if (session.display)
    process.stdout.write(
      `__EVENT__${JSON.stringify({
        type: 'display_allocated',
        workflow_id: workflowId,
        profile: profileName,
        display_num: session.display.displayNum,
        vnc_port: session.display.vncPort,
      })}__EVENT__\n`,
    )
  process.stdout.write('Browser is running...\n')

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (shouldStop() || session.context.pages().length === 0) {
        clearInterval(timer)
        resolve()
      }
    }, 500)
  })
  await session.close()
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
