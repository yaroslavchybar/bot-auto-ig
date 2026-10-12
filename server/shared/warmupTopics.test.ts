import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { warmupTopics, matchesWarmupTopic, reelPostContext, feedPostContext, feedPostMatches, maintenancePostMatches } from './warmupTopics.js'

test('topics normalize keywords and match captions or compact hashtags', () => {
  const topics = warmupTopics(' Fitness, strength training, FITNESS, ')
  assert.deepEqual(topics, ['fitness', 'strength training'])
  assert.equal(matchesWarmupTopic('My FITNESS routine', topics), true)
  assert.equal(matchesWarmupTopic('#StrengthTraining', topics), true)
  assert.equal(matchesWarmupTopic('Cooking dinner', topics), false)
  assert.equal(matchesWarmupTopic('Anything', []), true)
})

test('maintenance engagement requires a followed author or topic evidence, including with blank keywords', () => {
  assert.equal(maintenancePostMatches({ text: 'Dinner', relationship: 'followed' }, []), true)
  assert.equal(maintenancePostMatches({ text: 'Fitness', relationship: 'not-followed' }, ['fitness']), true)
  assert.equal(maintenancePostMatches({ text: 'Dinner', relationship: 'not-followed' }, ['fitness']), false)
  assert.equal(maintenancePostMatches({ text: 'Anything', relationship: 'not-followed' }, []), false)
  assert.equal(maintenancePostMatches({ text: 'Anything', relationship: 'unknown' }, []), false)
})

test('reel topic context excludes sidebar and neighboring captions', async () => {
  const window = new Window()
  try {
    window.document.body.innerHTML = '<nav>Fitness</nav><main><div><video></video><p>Cooking</p><a href="/explore/tags/recipes/">#recipes</a></div><div><video></video><p>Fitness workout</p></div></main>'
    const video = window.document.querySelector('video')! as unknown as Element
    assert.equal(matchesWarmupTopic(reelPostContext(video).text, ['fitness']), false)
    assert.equal(matchesWarmupTopic(reelPostContext(video).text, ['recipes']), true)
  } finally { await window.happyDOM.close() }
})

test('reel author checks ignore captions, hidden Follow controls and neighboring authors', async () => {
  const window = new Window()
  try {
    window.document.body.innerHTML = `<nav><button>Follow</button></nav><main>
      <div id="followed"><div><a href="/friend/reels/">friend</a><button hidden>Follow</button></div>
        <button>Follow</button><video></video><p>Cooking dinner</p></div>
      <div id="recommended"><div><span><a href="/stranger/reels/">stranger</a></span><button>Follow</button></div>
        <video></video><p>Fitness workout</p></div>
      <div id="off-topic"><div><a href="/cook/">cook</a><button>Follow back</button></div>
        <video></video><p>Cooking dinner</p></div>
      <div id="unknown"><video></video><p>Cooking dinner</p></div>
    </main>`
    for (const control of window.document.querySelectorAll('button:not([hidden])'))
      Object.defineProperty(control, 'getBoundingClientRect', { value: () => ({ width: 50, height: 20 }) })
    const read = (id: string) => reelPostContext(window.document.querySelector(`#${id} video`)! as unknown as Element)
    assert.equal(read('followed').relationship, 'followed')
    assert.equal(feedPostMatches(read('followed'), ['fitness']), true)
    assert.equal(read('recommended').relationship, 'not-followed')
    assert.equal(feedPostMatches(read('recommended'), ['fitness']), true)
    assert.equal(read('off-topic').relationship, 'not-followed')
    assert.equal(feedPostMatches(read('off-topic'), ['fitness']), false)
    assert.equal(read('unknown').relationship, 'unknown')
    assert.equal(feedPostMatches(read('unknown'), ['fitness']), true)
  } finally { await window.happyDOM.close() }
})

test('feed filtering preserves followed authors and filters only recommendations', async () => {
  const window = new Window()
  try {
    window.document.body.innerHTML = `<nav>Fitness</nav><main>
      <article id="followed"><div><a href="/friend/">friend</a><button><svg aria-label="More options"></svg></button></div>
        <p>Cooking dinner</p><div><a href="/commenter/">commenter</a><button>Follow</button></div></article>
      <article id="recommended"><div><a href="/stranger/">stranger</a><button>Follow</button><button><svg aria-label="More options"></svg></button></div><p>Cooking dinner</p></article>
      <article id="matching"><div><a href="/trainer/">trainer</a><button>Follow</button><button><svg aria-label="More options"></svg></button></div><a href="/explore/tags/strengthtraining/">Workout</a></article>
      <article id="unknown"><p>Cooking dinner</p></article>
    </main>`
    for (const control of window.document.querySelectorAll('button'))
      Object.defineProperty(control, 'getBoundingClientRect', { value: () => ({ width: 50, height: 20 }) })
    const read = (id: string) => feedPostContext(window.document.querySelector(`#${id}`)! as unknown as Element)
    assert.equal(read('followed').relationship, 'followed', 'comment-row Follow must not override the author relationship')
    assert.equal(feedPostMatches(read('followed'), ['fitness']), true)
    assert.equal(read('recommended').relationship, 'not-followed')
    assert.equal(feedPostMatches(read('recommended'), ['fitness']), false, 'sidebar keywords and neighboring posts must not match')
    assert.equal(feedPostMatches(read('matching'), ['strength training']), true)
    assert.equal(feedPostMatches(read('recommended'), []), true)
    assert.equal(read('unknown').relationship, 'unknown')
    assert.equal(feedPostMatches(read('unknown'), ['fitness']), true, 'an unknown layout must not skip a potentially followed author')
  } finally { await window.happyDOM.close() }
})

test('feed relationship ignores hidden Follow controls and reads ad labels only from the author row', async () => {
  const window = new Window()
  try {
    window.document.body.innerHTML = '<article><header><a href="/friend/">friend</a><button hidden>Follow</button></header><p>This was a sponsored trip</p></article>'
    const article = window.document.querySelector('article')! as unknown as Element
    assert.equal(feedPostContext(article).relationship, 'followed')
    assert.equal(feedPostContext(article).sponsored, false)
    window.document.querySelector('header')!.insertAdjacentHTML('beforeend', '<span>Sponsored</span>')
    assert.equal(feedPostContext(article).sponsored, true)
  } finally { await window.happyDOM.close() }
})
