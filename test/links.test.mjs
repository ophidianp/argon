import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approved, linkMessage, matches } from '../shared/links.js'

test('a reviewer approves only with APPROVED at the start of a line', () => {
  assert.ok(approved('Looks good.\nAPPROVED'))
  assert.ok(approved('**Approved** — ship it'))
  assert.ok(!approved('Not approved yet: fix the tests'))
  assert.ok(!approved('1. rename the file\n2. add a test'))
})

test('conditions match case-insensitively and never on an empty pattern', () => {
  assert.ok(matches('3 tests FAILED', 'failed'))
  assert.ok(!matches('all green', 'failed'))
  assert.ok(!matches('anything', '  '))
})

test('each kind of wire says what the next agent must do', () => {
  assert.match(linkMessage('brief', { fromName: 'Ada', brief: 'did X', role: 'tester' }), /Hand-off from Ada[\s\S]*did X[\s\S]*Your role: tester[\s\S]*Pick up/)
  assert.equal(linkMessage('reply', { fromName: 'Ada', reply: 'done' }), 'Ada just replied:\n\ndone')
  assert.match(linkMessage('review', { fromName: 'Ada', brief: 'did X' }), /APPROVED on its own line/)
  assert.match(linkMessage('feedback', { fromName: 'Rex', reply: 'fix Y' }), /Review from Rex:\n\nfix Y\n\nApply/)
  assert.match(linkMessage('context', { fromName: 'Ada', brief: 'did X' }), /^For context only/)
})
