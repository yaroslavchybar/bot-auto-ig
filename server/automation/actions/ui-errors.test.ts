import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errors } from 'playwright-core'
import { isTemporaryUiError } from './ui-errors.js'

test('ordinary Playwright DOM and navigation failures are temporary', () => {
  for (const error of [
    new errors.TimeoutError('locator.click: Timeout 2000ms exceeded'),
    new Error('elementHandle.click: Element is not attached to the DOM'),
    new Error('locator.click: <div id="overlay"> intercepts pointer events'),
    new Error('Execution context was destroyed, most likely because of a navigation'),
    new Error('Action target is detached or missing'),
  ]) assert.equal(isTemporaryUiError(error), true, error.message)
})

test('browser, account and selector failures are not temporary', () => {
  for (const message of [
    'Target page, context or browser has been closed',
    'Browser disconnected',
    'Instagram limit needs attention',
    'Unknown engine while parsing selector',
    'strict mode violation: locator resolved to 2 elements',
  ]) assert.equal(isTemporaryUiError(new Error(message)), false, message)
})
