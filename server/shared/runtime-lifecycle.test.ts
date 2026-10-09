import { expect, test } from 'bun:test'
import { nativeFixture } from './native-fixture.testing.js'

test('native helper exits when its owner closes stdin without a stop command', async () => {
  const fixture = await nativeFixture()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const exited = new Promise<number | null>((resolve) => fixture.proc.once('exit', resolve))
    fixture.proc.stdin.end()
    const code = await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Helper outlived its owner')), 3000)
      }),
    ])
    expect(code).toBe(0)
  } finally {
    clearTimeout(timeout)
    await fixture.stop()
  }
})
