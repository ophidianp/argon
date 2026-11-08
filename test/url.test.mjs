import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toUrl } from '../shared/url.js'

test('the address field turns what was typed into a page address', () => {
  assert.equal(toUrl('  '), '')
  assert.equal(toUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(toUrl(':5173'), 'http://localhost:5173')
  assert.equal(toUrl('localhost:3000/login'), 'http://localhost:3000/login')
  assert.equal(toUrl('127.0.0.1:8000'), 'http://127.0.0.1:8000')
  assert.equal(toUrl('github.com/ricca200xx'), 'https://github.com/ricca200xx')
  assert.equal(toUrl('react hooks'), 'https://duckduckgo.com/?q=react%20hooks')
  assert.equal(toUrl('package.json'), 'https://package.json', 'a bare file-like name still reads as a host')
})
