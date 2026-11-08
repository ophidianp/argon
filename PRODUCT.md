# Product

vibeboard is a Mac app: a board where several command-line coding agents (Claude Code, Codex, Gemini and others) work side by side on one project.

## Platform

web (a local web app, also shipped inside an Electron window for macOS)

## Who it is for

- People who already run coding agents in a terminal and want many of them in view at once.
- People who are not at ease with a terminal and still want to use these agents. The app must explain itself: every control says what it does, and nobody should need to read terminal output to know what an agent is doing.

## What it must stay true to

- Every console is a real terminal running the real CLI. Nothing is emulated, and the terminal is always one click away.
- Everything runs on the user's Mac, with the user's own CLI sign-ins. The server listens on 127.0.0.1 only.
- An agent never gets permission to act because of a design choice: approving an action is always the user's explicit click, on the action as the agent stated it.
- Open source (MIT). Independent project, not affiliated with Symvibe or Apple. No third-party assets beyond the licensed agent icons.

## Words

Plain words in the interface: agent, group, connect, project. Technical terms (repo, commit) only where the person is already doing something technical. The interface is in English.
