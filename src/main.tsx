import '@fontsource-variable/jetbrains-mono'
import '@xyflow/react/dist/style.css'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import './theme'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// Inside the desktop app the top bar doubles as the window's title bar (see desktop/main.cjs).
if ('vibeboardDesktop' in window) document.body.classList.add('desktop')

// No StrictMode: double-mounted effects would open every PTY socket twice.
createRoot(document.getElementById('root')!).render(<App />)
