import { openCamoufoxSession } from './camoufox.js'
import { profilesSetLoginTrue } from '../shared/convexClient.js'
import crypto from 'node:crypto'

type LoginInput = {
  username: string
  password: string
  two_factor_secret?: string | null
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function log(message: string): void {
  process.stdout.write(`${message}\n`)
}

function generateTotp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized = secret.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '')
  let bits = ''
  for (const character of normalized) {
    const value = alphabet.indexOf(character)
    if (value < 0) throw new Error('Invalid 2FA secret')
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8))
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)
  }
  const counter = Math.floor(Date.now() / 1000 / 30)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = crypto.createHmac('sha1', bytes).update(message).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]
  return String(code % 1_000_000).padStart(6, '0')
}

async function readStdin(): Promise<LoginInput> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as LoginInput
  if (!value.username || !value.password)
    throw new Error('username and password are required')
  return value
}

async function main(): Promise<void> {
  const profileName = String(arg('--profile') || '').trim()
  const headless = process.argv.includes('--headless')
  if (!profileName) throw new Error('--profile is required')
  const credentials = await readStdin()
  log('Starting login session')

  const session = await openCamoufoxSession(profileName, { headless })
  try {
    const { page, context } = session
    // An old session cookie must not make a failed credential check look successful.
    await context.clearCookies()
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    const username = page
      .locator("input[name='username'], input[name='email']")
      .first()
    const password = page
      .locator("input[name='password'], input[name='pass']")
      .first()
    await username.waitFor({ state: 'visible', timeout: 20_000 })
    await username.fill(credentials.username)
    await password.fill(credentials.password)
    await page
      .locator("button[type='submit'], div[role='button']:has-text('Log in')")
      .first()
      .click()
    log('Waiting for login result...')

    const deadline = Date.now() + 60_000
    let authenticated = false
    let submittedTwoFactor = false
    while (Date.now() < deadline) {
      authenticated = (
        await context.cookies('https://www.instagram.com/')
      ).some((cookie) => cookie.name === 'sessionid' && cookie.value)
      if (authenticated) break
      const field = page
        .locator(
          "input[name='verificationCode'], input[autocomplete='one-time-code']",
        )
        .first()
      if (!submittedTwoFactor && (await field.isVisible())) {
        if (!credentials.two_factor_secret)
          throw new Error('Login requires a 2FA secret')
        await field.fill(generateTotp(credentials.two_factor_secret))
        await field.press('Enter')
        submittedTwoFactor = true
        log('Submitted 2FA code')
      }
      await page.waitForTimeout(500)
    }
    if (!authenticated)
      throw new Error('Login was not confirmed by an Instagram session cookie')
    await profilesSetLoginTrue(profileName)
    log('__LOGIN_SUCCESS__')
  } finally {
    await session.close()
  }
}

main().catch((error) => {
  log(`Login failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
