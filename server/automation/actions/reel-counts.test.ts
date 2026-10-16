import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { reelEngagementCount } from './reel-counts.js'

for (const [likes, comments, expectedLikes, expectedComments] of [
  ['8,454', '197', 8454, 197], ['1.2K', '50', 1200, 50], ['1,000', '51', 1000, 51],
  ['3K', '0', 3000, 0], ['3,001', '51', 3001, 51],
  ['1M', '2.5K', 1e6, 2500], ['Like', 'Comment', null, null], ['', '', null, null],
] as const) test(`Reel badges read ${likes} likes and ${comments} comments`, async () => {
  const window = new Window({ width: 1280, height: 800 })
  try {
    window.document.body.innerHTML = '<div id="post"><video></video><p>Caption: 999999</p><div>' +
      '<div><span><div><div role="button"><span><svg aria-label="Like"><title>Like</title></svg></span></div></div></span>' +
      `<div role="button"><span>${likes}</span></div></div>` +
      `<div><div role="button"><div><svg aria-label="Comment"><title>Comment</title></svg><div><span>${comments}</span></div></div></div></div>` +
      '<div><svg aria-label="Repost"></svg><span>99999</span></div></div></div>' +
      '<div><svg aria-label="Comment"></svg><span>999999</span></div>'
    for (const node of window.document.querySelectorAll('*'))
      node.getBoundingClientRect = () => ({ left: 900, right: 930, top: 200, bottom: 230, width: 30, height: 30 }) as DOMRect
    const post = window.document.querySelector('#post')! as unknown as Element
    assert.equal(reelEngagementCount(post, 'likes'), expectedLikes)
    assert.equal(reelEngagementCount(post, 'comments'), expectedComments)
    window.document.querySelector('[aria-label="Like"]')!.setAttribute('aria-label', 'Unlike')
    assert.equal(reelEngagementCount(post, 'likes'), expectedLikes)
    for (const label of window.document.querySelectorAll('#post span')) label.style.visibility = 'hidden'
    assert.equal(reelEngagementCount(post, 'likes'), null)
    assert.equal(reelEngagementCount(post, 'comments'), null)
  } finally { await window.happyDOM.close() }
})
