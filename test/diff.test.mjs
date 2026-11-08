import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDiff } from '../shared/diff.js'

const sample = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -3,4 +3,5 @@ export function main() {',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
  ' return a',
  '+++ not a header once inside a hunk',
  'diff --git a/logo.png b/logo.png',
  'Binary files a/logo.png and b/logo.png differ',
  'diff --git a/old.md b/new.md',
  'similarity index 90%',
  'rename from old.md',
  'rename to new.md',
].join('\n')

test('a diff becomes files with numbered lines', () => {
  const [app, logo, moved] = parseDiff(sample)
  assert.equal(app.path, 'src/app.ts')
  assert.equal(app.add, 3)
  assert.equal(app.del, 1)
  assert.deepEqual(
    app.hunks[0].lines.map((l) => [l.kind, l.old, l.new]),
    [
      ['ctx', 3, 3],
      ['del', 4, null],
      ['add', null, 4],
      ['add', null, 5],
      ['ctx', 5, 6],
      ['add', null, 7],
    ],
  )
  assert.equal(logo.binary, true)
  assert.equal(moved.path, 'new.md')
  assert.equal(moved.from, 'old.md')
})

test('a bare hunk (a brand new file) still parses', () => {
  const [f] = parseDiff('@@ -0,0 +1,2 @@\n+hello\n+world')
  assert.equal(f.add, 2)
  assert.deepEqual(f.hunks[0].lines.map((l) => l.new), [1, 2])
})
