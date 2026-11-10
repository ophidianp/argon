import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { meta, slashCommands } from '../server/slash.mjs'
import { CLAUDE_COMMANDS, matchCommands } from '../shared/slash.js'

test('frontmatter: name and description, folded text, first line as a fallback', () => {
  assert.deepEqual(meta('---\nname: deploy\ndescription: "Ship it"\n---\nbody'), { name: 'deploy', description: 'Ship it' })
  assert.equal(meta('---\ndescription: >\n  Two\n  lines\n---\n').description, 'Two lines')
  assert.equal(meta('# Review the diff\n\nmore').description, 'Review the diff')
  assert.equal(meta('---\nuser-invocable: false\n---\nx')['user-invocable'], 'false')
})

test('matching: names that start with it first, aliases count', () => {
  assert.deepEqual(matchCommands(CLAUDE_COMMANDS, 'mo').map((c) => c.name).slice(0, 2), ['model', 'memory'])
  assert.equal(matchCommands(CLAUDE_COMMANDS, 'cost')[0].name, 'usage')
  assert.equal(matchCommands(CLAUDE_COMMANDS, '').length, CLAUDE_COMMANDS.length)
})

test('a Claude console lists project and user commands and skills, never their contents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'argon-slash-'))
  const proj = path.join(root, 'proj'), conf = path.join(root, 'conf')
  fs.mkdirSync(path.join(proj, '.claude', 'commands', 'ops'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.claude', 'commands', 'ops', 'deploy.md'), '---\ndescription: Deploy the app\n---\nSECRET BODY')
  fs.mkdirSync(path.join(conf, 'skills', 'tidy'), { recursive: true })
  fs.writeFileSync(path.join(conf, 'skills', 'tidy', 'SKILL.md'), '---\nname: tidy\ndescription: Tidy up\n---\nSECRET BODY')
  fs.mkdirSync(path.join(conf, 'skills', 'hidden'), { recursive: true })
  fs.writeFileSync(path.join(conf, 'skills', 'hidden', 'SKILL.md'), '---\nuser-invocable: false\n---\n')
  const list = slashCommands({ agentId: 'claude', cwd: proj, configDir: conf })
  assert.deepEqual(list.find((c) => c.name === 'deploy'), { name: 'deploy', description: 'Deploy the app', source: 'project' })
  assert.deepEqual(list.find((c) => c.name === 'tidy'), { name: 'tidy', description: 'Tidy up', source: 'user' })
  assert.ok(!list.some((c) => c.name === 'hidden'))
  assert.ok(!JSON.stringify(list).includes('SECRET'))
  assert.equal(list[0].name, 'model') // built-ins first
  assert.deepEqual(slashCommands({ agentId: 'codex', cwd: proj, configDir: null }), [])
  fs.rmSync(root, { recursive: true, force: true })
})
