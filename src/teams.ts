// Ready-made teams: consoles with a role each, already wired so work flows from one to the next.
// Every member runs the user's default agent; the role travels with each hand-off it receives.
export type TeamTemplate = {
  id: string
  name: string
  description: string
  members: { name: string; role: string; lead?: boolean }[]
  wires: [number, number][] // member index -> member index
}

const PLANNER = 'Turns the request into a short, numbered plan. Does not write code.'
const BUILDER = 'Implements what it receives, step by step, and runs the tests before finishing.'
const REVIEWER = 'Reviews the work it receives: finds bugs and risks, fixes the small ones, lists the rest.'

export const TEAMS: TeamTemplate[] = [
  {
    id: 'lead',
    name: 'A lead and its helpers',
    description: 'Give one agent the job. When it splits into parts, it brings in helpers on the board and combines their work.',
    members: [{ name: 'Lead', role: 'Splits the job, brings in helpers for the parts, checks and combines their work.', lead: true }],
    wires: [],
  },
  {
    id: 'build-review',
    name: 'Build, then review',
    description: 'One agent does the work, a second checks it when it is done.',
    members: [
      { name: 'Builder', role: BUILDER },
      { name: 'Reviewer', role: REVIEWER },
    ],
    wires: [[0, 1]],
  },
  {
    id: 'plan-build-review',
    name: 'Plan, build, review',
    description: 'A planner breaks the job down, a builder does it, a reviewer checks it.',
    members: [
      { name: 'Planner', role: PLANNER },
      { name: 'Builder', role: BUILDER },
      { name: 'Reviewer', role: REVIEWER },
    ],
    wires: [
      [0, 1],
      [1, 2],
    ],
  },
  {
    id: 'research-write',
    name: 'Research, then write',
    description: 'One agent digs through the code and docs, another writes it up.',
    members: [
      { name: 'Researcher', role: 'Investigates the question in the code and docs and reports facts with file references.' },
      { name: 'Writer', role: 'Turns the findings it receives into clear, well-organised documentation.' },
    ],
    wires: [[0, 1]],
  },
  {
    id: 'fix-test',
    name: 'Fix, then test',
    description: 'One agent fixes the bug, another writes and runs tests for the fix.',
    members: [
      { name: 'Fixer', role: 'Finds the root cause of the bug it is given and fixes it.' },
      { name: 'Tester', role: 'Writes and runs tests for the change it receives and reports any failure.' },
    ],
    wires: [[0, 1]],
  },
]
