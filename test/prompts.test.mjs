// Screens captured from a real Claude Code (paths shortened), plus what must never count as a question.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRefusal, parseAsk } from '../shared/prompts.js'
import { describeTool, statusLine } from '../shared/plain.js'

const RULE = '─'.repeat(100)
const DASH = '╌'.repeat(100)
const PERMISSION = `❯ Use the Bash tool to run exactly this command: touch probe.txt

⏺ Creating empty file probe.txt
  ⎿  $ touch probe.txt

${RULE}
 Bash command

 Tip: auto mode handles these prompts for you — choose "switch to auto mode"
 below

 Create empty file probe.txt
${DASH}
 touch probe.txt
${DASH}
 │ Claude requested permissions to edit
 │ /Users/you/project/probe.txt which is a
 │ sensitive file.

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to /Users/you/project
      from this project
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No

 Esc to cancel · Tab to amend
`
const READY = `❯ Use the Bash tool

⏺ Done. Here is what I would do next:
  1. Fix the test
  2. Update the docs

✻ Crunched for 4s · done 12:49

${RULE}
❯
${RULE}
  capture-demo2 │ ░░░░░░░░░░ 🟢 07%
  ⏵⏵ auto mode on (shift+tab to cycle)
`
const TRUST = `╭${'─'.repeat(60)}╮
│ Do you trust the files in this folder?                     │
│                                                            │
│ /Users/you/project                                         │
│                                                            │
│ ❯ 1. Yes, proceed                                          │
│   2. No, exit                                              │
╰${'─'.repeat(60)}╯
`

test('reads a real permission question, wrapped options included', () => {
  const ask = parseAsk(PERMISSION)
  assert.deepEqual(ask.options.map((o) => o.label), ['Yes', 'Yes, and always allow access to /Users/you/project from this project', 'Yes, and switch to auto mode', 'No'])
  assert.equal(ask.options[2].hint, 'auto mode handles these prompts for you')
  assert.equal(ask.selected, 0)
  assert.match(ask.question, /touch probe\.txt/) // the actual command is shown, not a summary
  assert.match(ask.question, /Do you want to proceed\?$/)
  assert.doesNotMatch(ask.question, /Tip:|╌|below/)
})

test('the command stays in the question, with or without blank lines around the tip', () => {
  for (const gap of ['\n', '']) {
    const ask = parseAsk(`${RULE}
 Bash command
 Tip: auto mode handles these prompts for you — choose "switch to auto mode"
 below${gap}
 touch probe.txt
 Do you want to proceed?
 ❯ 1. Yes
   2. No
`)
    assert.match(ask.question, /touch probe\.txt/)
    assert.doesNotMatch(ask.question, /Tip:|below/)
  }
  // A short tip takes nothing with it, however short the next line is.
  assert.match(parseAsk(' Tip: use auto mode\n rm -rf x\n ❯ 1. Yes\n   2. No\n').question, /rm -rf x/)
})

test('moving the pointer keeps the id; a different question changes it', () => {
  const moved = PERMISSION.replace(' ❯ 1. Yes', '   1. Yes').replace('   2. Yes, and always', ' ❯ 2. Yes, and always')
  assert.equal(parseAsk(moved).selected, 1)
  assert.equal(parseAsk(moved).id, parseAsk(PERMISSION).id)
  assert.notEqual(parseAsk(PERMISSION.replaceAll('touch probe.txt', 'rm -rf build')).id, parseAsk(PERMISSION).id)
})

test('reads a boxed menu', () => {
  const ask = parseAsk(TRUST)
  assert.deepEqual(ask.options.map((o) => o.label), ['Yes, proceed', 'No, exit'])
  assert.match(ask.question, /trust the files/)
  assert.doesNotMatch(ask.question, /╭/)
})

test('reads a menu with no numbers: the real trust screen, where the pointer starts on No', () => {
  const ask = parseAsk(` Accessing workspace:

 /Users/you/project

 Quick safety check: Is this a project you created or one you trust?
 If not, take a moment to review what's in this folder first.

 Claude Code'll be able to read, edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel
`)
  assert.deepEqual(ask.options.map((o) => o.label), ['No, exit', 'Yes, I trust this folder'])
  assert.equal(ask.selected, 0)
  assert.match(ask.question, /Quick safety check/)
})

test('without the keys hint a pointed list is not a menu', () => {
  assert.equal(parseAsk(' ❯ Try "fix lint errors"\n   something else\n'), null)
  assert.equal(parseAsk(` ❯ One\n   Two\n\n${RULE}\n a status line\n a second one\n a third\n a fourth\n Enter to confirm\n x\n y\n z\n`), null)
  assert.equal(parseAsk('   One\n   Two\n\n Enter to confirm\n'), null) // nothing is pointed at
  assert.equal(parseAsk(' ❯ Only one\n\n Enter to confirm\n'), null)
})

test('an ordinary screen is not a question', () => {
  assert.equal(parseAsk(READY), null) // a numbered list in a reply, input box below
  assert.equal(parseAsk(''), null)
  assert.equal(parseAsk('❯ 1. only one option\n'), null)
  assert.equal(parseAsk('  1. Yes\n  2. No\n'), null) // no pointer: nothing is being chosen
  assert.equal(parseAsk('❯ 1. Yes\n❯ 2. No\n'), null)
  assert.equal(parseAsk('❯ 2. Yes\n  3. No\n'), null) // does not start at 1
})

test('a refusal is told apart from a yes', () => {
  assert.ok(isRefusal('No'))
  assert.ok(isRefusal('No, exit'))
  assert.ok(!isRefusal('Yes'))
  assert.ok(!isRefusal('Not now, but yes'))
})

test('tools read as plain sentences', () => {
  assert.equal(describeTool('Read', { file_path: '/a/b/auth.ts' }).doing, 'Reading auth.ts')
  assert.equal(describeTool('Edit', { file_path: '/a/auth.ts' }).done, 'Edited auth.ts')
  assert.equal(describeTool('Bash', { command: 'npm test\nnpm run build' }).doing, 'Running npm test')
  assert.ok(describeTool('Bash', { command: 'x'.repeat(200) }).doing.length < 75)
  assert.equal(describeTool('WebFetch', { url: 'https://example.com/a' }).doing, 'Reading example.com')
  assert.equal(describeTool('WebFetch', { url: 'nonsense' }).doing, 'Reading a web page')
  assert.equal(describeTool('mcp__x__y').doing, 'Using mcp__x__y')
  assert.equal(statusLine('working', 'Reading a.ts'), 'Reading a.ts')
  assert.equal(statusLine('working'), 'Thinking…')
  assert.equal(statusLine('idle'), 'Ready for your instructions')
})
