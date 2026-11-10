// Pictures in a Claude transcript: the simple view lists them by key and fetches each one on its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readConversation, transcriptImage } from '../server/transcript.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
const image = (media = 'image/png') => ({ type: 'image', source: { type: 'base64', media_type: media, data: PNG } })
const jsonl = [
  { type: 'user', uuid: 'aaaa-1111', message: { content: [image(), { type: 'text', text: '[Image #1] what is wrong here?' }] } },
  { type: 'user', uuid: 'bbbb-2222', message: { content: [image('image/webp')] } },
  { type: 'user', uuid: 'cccc-3333', message: { content: [image('text/html')] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'The sheet overflows.' }] } },
]
  .map((e) => JSON.stringify(e))
  .join('\n')

test('a prompt with a picture keeps its words and lists the picture; a picture alone still shows', () => {
  const items = readConversation(jsonl)
  assert.deepEqual(items[0], { kind: 'user', text: 'what is wrong here?', images: ['aaaa-1111:0'] })
  assert.deepEqual(items[1], { kind: 'user', text: '', images: ['bbbb-2222:0'] })
  assert.equal(items.at(-1).kind, 'agent')
})

test('a picture is fetched by its key, and only real image types come back', () => {
  const img = transcriptImage(jsonl, 'aaaa-1111:0')
  assert.equal(img.type, 'image/png')
  assert.deepEqual(img.data, Buffer.from(PNG, 'base64'))
  assert.equal(transcriptImage(jsonl, 'bbbb-2222:0').type, 'image/webp')
  assert.equal(transcriptImage(jsonl, 'cccc-3333:0'), null, 'not an image type')
  assert.equal(transcriptImage(jsonl, 'aaaa-1111:1'), null, 'that block is text')
  assert.equal(transcriptImage(jsonl, '../etc:0'), null, 'a malformed key')
})
