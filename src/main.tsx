import '@fontsource-variable/jetbrains-mono'
import '@xyflow/react/dist/style.css'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import './theme'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// Inside the desktop app the top bar doubles as the window's title bar (see desktop/main.cjs).
if ('vibeboardDesktop' in window) document.body.classList.add('desktop')
if (window.vibeboardDesktop?.platform === 'win32') document.body.classList.add('win')
// The store, for Argon's own scripted checks (the desktop test driver).
import('./store').then((m) => Object.assign(window, { __argonStore: m.useStore }))

// No StrictMode: double-mounted effects would open every PTY socket twice.
createRoot(document.getElementById('root')!).render(<App />)
