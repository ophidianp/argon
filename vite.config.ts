import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Settings → About shows the version from package.json.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

const target = 'http://127.0.0.1:4317'

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    proxy: {
      '/api': { target, changeOrigin: true },
      '/ws': { target, ws: true, changeOrigin: true },
    },
  },
})
