# Argon

A Windows desktop app: a board where several coding agents (Claude Code, Codex, Gemini CLI…) run in real
terminals side by side, grouped into teams that hand work to one another along wires.

## Layout

- `server/` — local Node server on port 4317 (`PORT`). `index.mjs` runs each agent in a `node-pty`
  terminal and streams it over WebSocket; `helpers.mjs` is the MCP server a lead uses to add helpers;
  `platform.mjs` holds everything that differs between Windows and macOS/Linux (shell, quoting,
  stopping process trees, revealing files, data folder). Keep platform differences in that file.
- `src/` — React 19 + Vite + React Flow + zustand board. `store.ts` is the state; `theme.ts` light/dark;
  `appearance.ts` personalization (palettes, accent, glass, Mica, font, size); `glass.ts` the liquid
  glass refraction; `appicon.ts` the taskbar icon drawn in the accent; `components/Personalize.tsx` its
  Settings section.
- `desktop/` — Electron window (`main.cjs`) and bridge (`preload.cjs`, exposed as `window.vibeboardDesktop`).
- `shared/` — code used by both server and page.

## Windows specifics

- Agents and commands run in Windows PowerShell 5.1 (`ARGON_SHELL` to change) via `-EncodedCommand`;
  quote arguments with `shq` from `platform.mjs`, never by hand.
- The PATH is refreshed from the saved Machine + User PATH at start, so npm-installed CLIs are found.
- Data lives in `%APPDATA%\Argon\board` (`ARGON_DATA` for a separate board, e.g. in tests).
- Claude status comes from hooks (`claude-hooks.json`, curl to `/api/hook/...`) and its transcript.

## Commands

- `npm start` — build and open the app. `npm run dev` — Vite + server with reload.
- `npm test` — server and unit tests. `npx tsc --noEmit -p tsconfig.json` — type-check.
- `npm run dist` — Windows installer in `release/`.

## Rules

- Keep the LICENSE file as it is (MIT notice of the base this was built on).
- User-facing text says "this PC", Explorer, Ctrl — not Mac terms.
