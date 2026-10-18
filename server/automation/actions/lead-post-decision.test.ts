import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideLeadPost } from './lead-post-decision.js'
import { TOPIC_MODEL } from './topic-intent.js'

test('lead post decisions use the supplied post screenshot and ignore avatars and comments', async () => {
  for (const score of [0, 0.69, 0.7, 1]) {
    const image = Buffer.from('lead-post-media')
    const fetcher = (async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string)
      assert.equal(body.model, TOPIC_MODEL)
      assert.equal(body.state[1].image_url.url, `data:image/jpeg;base64,${image.toString('base64')}`)
      assert.deepEqual(Object.keys(body.questions), ['visible_person'])
      assert.match(body.state[0], /Evaluate only its main photo or video frame/)
      assert.match(body.state[0], /Ignore.*author avatar, comments, comment avatars/)
      assert.match(body.questions.visible_person.instructions, /No interest, gender, age or identity classification/)
      assert.ok(options.signal instanceof AbortSignal)
      return Response.json({ answers: { visible_person: { type: 'noul', noul: score } } })
    }) as typeof fetch
    assert.deepEqual(await decideLeadPost(image, 3000, { key: 'test', fetcher }), {
      person: score >= 0.7, confidence: score,
    })
  }
})

test('invalid or unavailable lead post decisions never approve Likes', async () => {
  for (const answer of [null, {}, { type: 'choice', noul: 1 }, ...['0.9', -1, 1.1, null].map(noul => ({ type: 'noul', noul }))]) {
    await assert.rejects(decideLeadPost(Buffer.from('jpeg'), 1000, { key: 'test',
      fetcher: (async () => Response.json({ answers: { visible_person: answer } })) as typeof fetch }))
  }
  await assert.rejects(decideLeadPost(Buffer.from('jpeg'), 1000, { key: 'test',
    fetcher: (async () => new Response('', { status: 503 })) as typeof fetch }), /HTTP 503/)
})
