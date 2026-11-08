// npm run dev: the server (restarted on changes) and the Vite page, on any platform.
import { spawn } from 'node:child_process'
const opts = { stdio: 'inherit', shell: process.platform === 'win32' }
const kids = [spawn('node', ['--watch', 'server/index.mjs'], opts), spawn('npx', ['vite'], opts)]
const stop = () => { for (const k of kids) k.kill() ; process.exit() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const k of kids) k.on('exit', stop)
