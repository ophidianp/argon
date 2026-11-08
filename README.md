# Argon

A command deck for your coding agents. Run Claude Code, Codex, Gemini, Copilot and plain terminals side by side on one board, wire them into teams, and see who needs you at a glance.

## Two shells, one app

The whole interface lives in `src/` and is shared:

| | Tauri (Rust) | Electron |
|---|---|---|
| Backend | `src-tauri/src/lib.rs` | `main.js` + `preload.js` |
| Terminals | ConPTY via `portable-pty` | `node-pty` |
| Rendering | WebView2, GPU on | Chromium, GPU off by default |
| Run | `npm run app` | `npm start` |
| Build | `npm run build:app` | not packaged |

`src/tauri-bridge.js` gives the page the same `window.argon` API under Tauri that `preload.js` gives it under Electron, so every feature works in both.

## Measured on Windows 11 (Radeon RX 6500 XT, 8 terminals open)

| | Tauri | Electron |
|---|---|---|
| Installer | 1.7 MB | not packaged (357 MB runtime) |
| App binary | 5.0 MB | 357 MB |
| Memory in Task Manager | 199 MB | 213 MB |
| Draws with | the GPU (Direct3D 11) | Microsoft Basic Render (CPU) |

Memory is mostly the web engine, which both builds share. Tauri's real wins are the size and the GPU: every liquid-glass blur and lens is drawn by the graphics card instead of the CPU.

## Build the Tauri app

Needs Rust (stable, MSVC), the Visual Studio C++ build tools and Node.js.

```
npm install
npm run build:app
```

The installer lands in `src-tauri/target/release/bundle/nsis/`. If your project folder is deeply nested and the linker fails with `LNK1104`, point Cargo at a short folder first: `set CARGO_TARGET_DIR=C:\argon-target`.

## Where your boards live

`%APPDATA%\Argon\argon-state.json`, with up to 25 automatic backups in `backups\`. Both shells use the same file, so switching keeps your boards.
