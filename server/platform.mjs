// What differs between Windows and macOS/Linux: the shell that runs agents and commands, how an argument
// is quoted for it, how a process tree is stopped or paused, and how a folder is shown.
// On Windows every command line runs in Windows PowerShell (or ARGON_SHELL), passed as -EncodedCommand so no
// other layer re-quotes it. Elsewhere it runs in the user's login shell, as before.
import { execFile, execFileSync, spawn } from 'node:child_process'
import path from 'node:path'

export const WIN = process.platform === 'win32'
// Boards, memories and loops: ~/.vibeboard on a Mac, %APPDATA%\Argon\board on Windows. ARGON_DATA runs a separate board.
import os from 'node:os'
export const DATA_DIR = process.env.ARGON_DATA || process.env.VIBEBOARD_DATA || (WIN && process.env.APPDATA ? path.join(process.env.APPDATA, 'Argon', 'board') : path.join(os.homedir(), '.vibeboard'))
export const SHELL = WIN ? process.env.ARGON_SHELL || 'powershell.exe' : process.env.SHELL || '/bin/zsh'

// A Mac app gets its PATH from a login shell; on Windows the saved Machine and User PATH play that part, so
// agents installed with npm or a user installer are found however Argon was started.
if (WIN) {
  try {
    const saved = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"], { encoding: 'utf8', timeout: 8000, windowsHide: true })
    const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'Path'
    const seen = new Set()
    process.env[key] = [...String(process.env[key] || '').split(';'), ...saved.trim().split(';')]
      .map((d) => d.trim()).filter((d) => d && !seen.has(d.toLowerCase()) && seen.add(d.toLowerCase())).join(';')
  } catch {}
}

// One argument, quoted for the shell above. Windows PowerShell 5.1 hands arguments to programs with its own
// legacy rules, which drop inner double quotes unless they are written as \".
export const shq = WIN
  ? (v) => {
      v = String(v)
      return /^[\w@%+:,./\\=-]+$/.test(v) ? v : `'${v.replace(/'/g, "''").replace(/"/g, '\\"')}'`
    }
  : (v) => {
      v = String(v)
      return /^[\w@%+:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`
    }

const encoded = (script) => Buffer.from(script, 'utf16le').toString('base64')
// Box drawing, emoji and accents come through as themselves.
const UTF8 = '$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; '

// [file, args] for a command line built with shq: an agent in a console (it is the console's process; when it
// exits the console ends) or a one-off run whose output is read.
export function agentArgs(command) {
  if (!WIN) return [SHELL, ['-lic', `exec ${command}`]]
  return [SHELL, ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(`${UTF8}& ${command}; exit $LASTEXITCODE`)]]
}
export function runArgs(command) {
  if (!WIN) return [SHELL, ['-lic', command]]
  return [SHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(`${UTF8}${command}`)]]
}
// A plain terminal.
export const shellArgs = () => (WIN ? [SHELL, ['-NoLogo', '-ExecutionPolicy', 'Bypass']] : [SHELL, ['-l']])

// Which agent commands are installed, by name.
export function findCommands(cmds, env) {
  if (!WIN) {
    const script = `for c in ${cmds.join(' ')}; do command -v $c >/dev/null 2>&1 && echo $c; done; true`
    return new Promise((resolve) => execFile(SHELL, ['-lic', script], { timeout: 10000, env }, (err, out) => resolve({ ok: !err, found: new Set(String(out).split('\n').map((l) => l.trim())) })))
  }
  return Promise.all(cmds.map((c) => new Promise((resolve) => execFile('where.exe', [c], { timeout: 8000, env, windowsHide: true }, (err) => resolve(err ? null : c))))).then((r) => ({ ok: true, found: new Set(r.filter(Boolean)) }))
}

// Stops a process and everything it started.
export function killTree(pid, hard = false) {
  if (!pid) return
  if (WIN) {
    spawn('taskkill', ['/pid', String(pid), '/T', ...(hard ? ['/F'] : [])], { windowsHide: true, stdio: 'ignore' }).on('error', () => {})
    return
  }
  try {
    process.kill(-pid, hard ? 'SIGKILL' : 'SIGTERM')
  } catch {}
}

// Shows a folder (or a file, selected) in Finder or Explorer.
export function reveal(p) {
  if (WIN) return spawn('explorer.exe', path.extname(p) ? [`/select,${p}`] : [p], { windowsHide: true, detached: true, stdio: 'ignore' }).unref()
  return spawn('open', path.extname(p) ? ['-R', p] : [p], { detached: true, stdio: 'ignore' }).unref()
}

// Spawns a one-off command line whose output streams back (Documents, Diagrams, Memory scans).
export function launch(command, cwd, env) {
  const [file, args] = runArgs(command)
  return spawn(file, args, { cwd, env, detached: !WIN, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
}
