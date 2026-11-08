# Argon: notes for agents working on Argon itself

Argon is a Windows desktop "command deck" for coding agents. You run Claude Code, Codex, Gemini, Copilot and plain terminals side by side on one infinite board, wire them into teams, and see who needs you at a glance. You are very likely running inside Argon right now, developing it from the inside.

The owner is the only user and tester. They write casually and fast. Answer in plain, short language. They care a lot about the look (liquid glass, motion, accent colors) and about performance (GPU, RAM).

## Standing preferences from the owner
- **Always push** finished work to GitHub (`origin`, branch `tauri`) without asking each time.
- When they send a screenshot or recording of something broken, reproduce it first, then fix the cause, then verify in the real app.
- Keep the demo in step with the app when a feature is visible in both (see "Web demo" below).
- Plain words in the UI. No jargon in labels or toasts.

## Repo layout (branch `tauri` is the live one)
- `src/`: the whole interface, plain ES modules, no bundler. Shared by both shells.
  - `app.js` startup and wiring; `state.js` state, `S.data`, `save()`, `emit/on` events, `h()` DOM helper
  - `board.js` pan and zoom (plus the sharp-zoom "LOD" redraw), ink with the pen palette colors
  - `tiles.js` every tile type (console, note, checklist, kanban, calendar, text, web, files = mini file manager, git, image, group), `addNode`, `removeNode`, groups (`fitGroup`, `groupColor`), `remountTile`
  - `consoles.js` terminals (xterm.js), `sendTo()` (the first message to an agent also points it at the board), status detection
  - `teamwork.js` console-to-console and group wires (done / reply / if / review / context), handoffs, presets, question buttons, context gauge, dictation, the "Tell … what to do" bar
  - `manager.js` the team tiles: **Prompter** (prompt, a task per agent or group, Run; wire it only to the first agent, chain wires bring the rest in), **Manager** (supervisor: what each agent is doing), **Secretary** (output: summary, links, proof, every output file grouped by folder)
  - `boardapi.js` the board as a shared whiteboard for agents: writes `<project>/.argon/board/BOARD.md` and applies JSON requests from `.argon/board/inbox/`
  - `appearance.js` themes, accents (accent also tints the window), glass, `look()` (must keep returning the same object), `applyAppearance()`; `appicon.js` draws the taskbar icon in the current accent
  - `flowdots.js` streaming dots on wires; `pace.js` keeps redraws cheap (every frame only while you interact, `body.idle` when the window isn't focused)
  - `missionmap.js` the Mission Map (leads, teams, consoles); `panels.js` command bar, settings, usage, memory; `icons.js` the line icon set
  - `pipeline.js` the old Pipeline mode. **The mode is removed from the UI**; the file stays only because other modules use its report helpers (`collectReports`, `resultParts`, `absPath`) and tile hooks
  - `tauri-bridge.js` gives the page the same `window.argon` API under Tauri that `preload.js` gives it under Electron
- `src-tauri/`: the Rust shell (Tauri 2). `src/lib.rs` has every command (ptys via `portable-pty`, files, git, dialogs, Mica/Acrylic, app icon, `fs_changed`, the file manager commands, `dev_log`). The window is built in Rust (no decorations, transparent).
- `main.js`, `preload.js`: the older Electron shell. Still works, GPU off, not packaged. Keep new `window.argon` APIs available in both.
- `demo/`: the web demo (a single-file simulation of Argon). See below.
- Branches: `tauri` (live), `main` (older Electron line), `argon-website` (the marketing site; it is also the repo's default branch on GitHub).

## Build, run, test
- Needs Rust (stable, MSVC), Visual Studio C++ build tools, Node.js. On this PC add Node to PATH in PowerShell first: `$env:Path += ";C:\Program Files\nodejs"`.
- Build the app: `npx tauri build`. The installer lands in `<target>\release\bundle\nsis\Argon_1.0.0_x64-setup.exe` (about 1.8 MB).
- If linking fails with `LNK1104` (deep paths), set a short `CARGO_TARGET_DIR` first.
- A running `argon.exe` locks its own file, so the build can't replace it. Build into a different `CARGO_TARGET_DIR` (alternate two folders) instead of closing the owner's Argon, because closing it kills every running agent.
- Windows Smart App Control sometimes blocks a freshly built, unsigned exe for a few minutes ("An Application Control policy has blocked this file"). Wait and retry; never change that security setting.
- Electron shell: `npm start`.
- **Testing inside the real app:** set `ARGON_EVAL` to a JS snippet (an async IIFE that returns an object) and `ARGON_EVAL_DELAY` (ms). The app runs it in the page and prints `[eval] {...}` to stdout. Set `ARGON_DATA` to a scratch folder so tests never touch real boards. Redirect stdout to a file and read the `[eval]` line.
- Under Electron, `window.argon` is frozen (contextBridge), so you can't mock its functions there; mock them under Tauri.
- No JS bundler or test runner: syntax-check modules with `node --check` on a copy renamed to `.mjs`.
- Measure GPU per process with the `\GPU Engine(*)\Utilization Percentage` counter, filtered by the argon.exe process tree.

## Data
- Boards: `%APPDATA%\Argon\argon-state.json` (+ up to 25 backups in `backups\`). Shared by both shells.
- Per project: `.argon/` in the workspace folder (git-ignored): `board/BOARD.md`, `board/inbox/`, `board/results/`, `manager/<run>/<agent>.md` reports, handoff briefs.

## The team in the argon workspace
Left to right on the board: **Prompter** → **researcher** → **Build** group (**claude-1** + **builder**) → **shipper** → **Secretary**, with the **Manager** under the Prompter. Wires hand work on when each step is done.
- **researcher**: changes no code. Finds the files involved and writes a step-by-step plan to `.argon/research.md`.
- **Build** group: builds from `.argon/research.md`. Split the work between you and say who takes what, so you don't edit the same files, then test in the real app as described above.
- **shipper**: final checkout. Reads the whole diff, syntax-checks changed modules, builds, fixes small things, then commits and pushes to `origin tauri`. Reports anything it couldn't fix.
If your console's title is one of these, that's your role when a task comes from the Prompter.

## The board for agents (you can use it now)
Read `.argon/board/BOARD.md` in the project folder. It lists every tile with its id, position and contents, the groups, agents and wires, and the exact JSON to write into `.argon/board/inbox/` to add notes, checklists, kanban boards, text, web previews or file managers, edit or move tiles, group them, wire agents, message another agent, or delete tiles (never agent consoles). Results come back in `.argon/board/results/`.

## Things that bit us (don't repeat them)
- `look()` must return the same object every time. It once returned a fresh copy each call, and since the wire-dot loop calls it every frame, Settings edited a stale copy and nothing applied.
- A group's frame lets clicks through to the board (`pointer-events: none`), and its children inherit that. Anything clickable on a group needs `pointer-events: auto`, and drop targets on groups need a geometric hit test.
- Lists that skip re-rendering while they hold focus must only skip for text inputs, or buttons inside them look dead.
- Continuous animations under liquid glass are expensive because every repaint re-blurs the glass. Animate only what's working, cap frame rates, no SVG blur filters on moving things, rest when unfocused. An idle board measured 59% GPU before this and 0% after.
- The folder picker must use the non-blocking dialog (`pick_folder` with a callback) with the window as parent. The blocking one silently failed on Windows.
- Workspace `cwd` can be saved with forward slashes (`C:/Users/...`). Normalize before comparing paths.
- Python edits on files with CRLF line endings: normalize to `\n`, edit, restore.

## Web demo (`demo/`)
- `demo/index.html` is the current demo, published as the claude.ai artifact https://claude.ai/artifact/2KNY5sMP1YufYsxKRt4tX8 (owner's account).
- It is rebuilt from `demo/build/argon-demo-v6-backup.html` by running, in order: `demo-v7.py <html> demo-v7.js demo-v7.css`, then `demo-v7b.py <html>`, `demo-v7c.py <html>`, `demo-v7d.py <html>`, `demo-v7e.py <html>`. Each script does exact, asserted string replacements.
- The demo predates some app changes. It still has Pipeline mode and the old single Manager, and lacks the Prompter / Manager / Secretary split, the file manager, the board bridge and the pen palette.

## Open threads
- "Central workspace": the owner asked for "a central workspace thing" to work. Not yet clarified. Ask them what they mean before building.
- The owner wants to move Argon's development into Argon itself (this workspace is the start of that).
- The demo needs catching up with the app (see above).
- Taskbar icon: pinned taskbar buttons may keep the exe's built-in icon; unpinned ones follow the accent. Not verified on the owner's taskbar.
