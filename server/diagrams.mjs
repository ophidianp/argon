// Diagrams studio: a read-only CLI run describes the repo as JSON; the board receives it laid out,
// ready to draw. One drawing per repo at a time.
import crypto from 'node:crypto'
import { commandFor, runCli } from './stream.mjs'
import { DIAGRAM_PROMPT, layoutDiagram, parseDiagram } from '../shared/diagram.js'

export function createDiagrams({ broadcast, launch, command = commandFor, timeoutMs = 10 * 60_000 }) {
  const jobs = new Map() // repo path -> its drawing
  const view = (j) => ({ id: j.id, cwd: j.cwd, agent: j.agent, startedAt: j.startedAt, step: j.step, status: j.status, error: j.error, diagram: j.diagram })
  const list = () => [...jobs.values()].map(view)
  const emit = () => broadcast({ type: 'diagrams', diagrams: list() })

  function start(cwd, agent = 'claude', focus = '') {
    const ask = focus.trim() ? `${DIAGRAM_PROMPT} Focus on: ${focus.trim().slice(0, 500)}.` : DIAGRAM_PROMPT
    const line = command(agent, ask)
    if (!line) throw new Error(`${agent} cannot draw diagrams yet`)
    if (jobs.get(cwd)?.status === 'running') throw new Error('a diagram is already being drawn for this repo')
    const job = { id: crypto.randomUUID(), cwd, agent, startedAt: Date.now(), step: 0, status: 'running', error: null, diagram: null }
    jobs.set(cwd, job)
    job.run = runCli({
      command: line,
      claude: agent === 'claude',
      cwd,
      launch,
      timeoutMs,
      onStep: (step) => step === 1 && job.step < 1 && ((job.step = 1), emit()),
      onEnd: ({ text, error, stopped }) => {
        delete job.run
        if (stopped) return
        try {
          if (error) throw new Error(error)
          job.diagram = layoutDiagram(parseDiagram(text))
          job.status = 'done'
        } catch (e) {
          job.status = 'failed'
          job.error = e.message
        }
        emit()
      },
    })
    emit()
    return view(job)
  }

  // Stop a drawing, or forget one the board has drawn.
  function clear(cwd) {
    const job = jobs.get(cwd)
    if (!job) return
    job.run?.stop()
    jobs.delete(cwd)
    emit()
  }

  return { list, start, clear }
}
