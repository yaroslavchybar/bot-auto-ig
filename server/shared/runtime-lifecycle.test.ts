import { expect, test } from 'bun:test'
import { nativeFixture } from './native-fixture.testing.js'

test('parallel native fixtures own distinct OS-assigned listener ports', async () => {
  const fixtures = await Promise.allSettled([nativeFixture(), nativeFixture()])
  try {
    const instances = fixtures.map((result) => {
      if (result.status === 'rejected') throw result.reason
      return result.value
    })
    const urls = instances.flatMap(({ url, publicUrl, gatewayUrl }) => [url, publicUrl, gatewayUrl])
    expect(new Set(urls).size).toBe(6)
    for (const instance of instances)
      expect((await fetch(instance.publicUrl + '/api/displays')).status).toBe(200)
  } finally {
    await Promise.all(
      fixtures.map((result) => (result.status === 'fulfilled' ? result.value.stop() : undefined)),
    )
  }
})

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
