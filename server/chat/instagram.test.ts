import { InstagramChat, InstagramError } from './instagram.js'

test('mobile errors keep HTTP status for invalid JSON and preserve structured error details', async () => {
  let response = new Response(null, { status: 503 })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => response,
  })
  const previousUrl = process.env.RUNTIME_URL
  process.env.RUNTIME_URL = `http://127.0.0.1:${server.port}`
  try {
    for (const [body, status] of [
      ['<html>Bad gateway</html>', 502],
      ['{"error":', 429],
      ['', 503],
      ['null', 500],
    ] as const) {
      response = new Response(body, { status })
      try {
        await InstagramChat.hasSession('profile')
        throw new Error('Expected an InstagramError')
      } catch (error) {
        expect(error).toBeInstanceOf(InstagramError)
        expect(error).toMatchObject({
          message: 'Instagram request failed',
          name: 'InstagramError',
          status,
          retryAfterMs: 0,
        })
      }
    }

    response = Response.json(
      {
        error: {
          message: 'Wait before retrying',
          name: 'IgRateLimitError',
          status: 429,
          retryAfterMs: 60_000,
        },
      },
      { status: 400 },
    )
    await expect(InstagramChat.hasSession('profile')).rejects.toMatchObject({
      message: 'Wait before retrying',
      name: 'IgRateLimitError',
      status: 429,
      retryAfterMs: 60_000,
    })

    response = Response.json({ connected: true })
    expect(await InstagramChat.hasSession('profile')).toBe(true)
    response = new Response('invalid success JSON')
    await expect(InstagramChat.hasSession('profile')).rejects.toBeInstanceOf(SyntaxError)
  } finally {
    if (previousUrl === undefined) delete process.env.RUNTIME_URL
    else process.env.RUNTIME_URL = previousUrl
    server.stop(true)
  }
})
