// Argon — main process
// Owns the real terminals (node-pty), saving, git, file reads and token stats.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const pty = require('node-pty');

app.setName('Argon');
// Electron's GPU process crash-loops on some Windows drivers. Argon's UI is plain DOM,
// so software rendering is smooth enough. Set ARGON_GPU=1 to try hardware acceleration.
if (process.env.ARGON_GPU !== '1') app.disableHardwareAcceleration();
if (process.env.ARGON_DATA) app.setPath('userData', process.env.ARGON_DATA); // separate data folder for testing
const STATE_DIR = app.getPath('userData');
const STATE_FILE = path.join(STATE_DIR, 'argon-state.json');
const BACKUP_DIR = path.join(STATE_DIR, 'backups');
const MAX_BACKUPS = 25;

let win = null;
const ptys = new Map(); // id -> pty

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0b14',
    title: 'Argon',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#b9a8e6', height: 60 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('closed', () => { win = null; });
  // Renderer errors go to the terminal that launched Argon.
  win.webContents.on('console-message', (e) => {
    const lvl = e.level;
    if (lvl === 'error' || lvl === 'warning' || lvl === 2 || lvl === 3) console.log(`[renderer ${lvl}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  // Dev aid: ARGON_CLICK=<css selector> clicks an element after start (used for screenshots in testing).
  if (process.env.ARGON_CLICK) {
    win.webContents.once('did-finish-load', () => setTimeout(() => {
      win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(process.env.ARGON_CLICK)})?.click()`).catch(() => {});
    }, 2500));
  }
  // Dev aid: ARGON_EVAL=<js> runs in the page after start and prints the result.
  if (process.env.ARGON_EVAL) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      try { console.log('[eval]', JSON.stringify(await win.webContents.executeJavaScript(process.env.ARGON_EVAL))); } catch (err) { console.log('[eval] failed', String(err)); }
    }, +(process.env.ARGON_EVAL_DELAY || 4000)));
  }
  // Dev aid: ARGON_SHOT=<file.png> saves a screenshot a few seconds after start.
  if (process.env.ARGON_SHOT) {
    setTimeout(async () => {
      try { const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.ARGON_SHOT, img.toPNG()); console.log('[shot] saved'); } catch (err) { console.log('[shot] failed', err); }
    }, +(process.env.ARGON_SHOT_DELAY || 6000));
  }
}

// ---------- terminals ----------
function shellPath() {
  // Prefer PowerShell 7 if present, otherwise Windows PowerShell.
  if (process.platform !== 'win32') return process.env.SHELL || '/bin/bash';
  const pwsh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
  return fs.existsSync(pwsh) ? pwsh : 'powershell.exe';
}

// Windows only updates PATH for programs started after an install.
// Re-read it from the registry so newly installed tools (npm, claude…) work right away.
const { execFileSync } = require('child_process');
function regPath(key) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
    const m = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    return m ? m[1].trim().replace(/%([^%]+)%/g, (s, v) => process.env[v] ?? s) : '';
  } catch (_) { return ''; }
}
function refreshPath() {
  if (process.platform !== 'win32') return;
  const sys = regPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment');
  const usr = regPath('HKCU\\Environment');
  if (!sys && !usr) return;
  const seen = new Set();
  const parts = [...sys.split(';'), ...usr.split(';'), ...(process.env.PATH || '').split(';')]
    .map(s => s.trim()).filter(Boolean)
    .filter(p => { const k = p.toLowerCase().replace(/\\$/, ''); if (seen.has(k)) return false; seen.add(k); return true; });
  process.env.PATH = parts.join(';');
  if (process.env.Path !== undefined) process.env.Path = process.env.PATH;
}
refreshPath();

ipcMain.handle('pty:spawn', (_e, opts) => {
  refreshPath();
  const { id, command, cwd, cols, rows, env } = opts;
  if (ptys.has(id)) return { ok: true, reused: true };
  const sh = shellPath();
  let args;
  if (process.platform === 'win32') {
    args = ['-NoLogo', '-ExecutionPolicy', 'Bypass'];
    if (command) args.push('-NoExit', '-Command', command);
  } else {
    args = command ? ['-lc', `${command}; exec ${sh}`] : ['-l'];
  }
  let dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  let p;
  try {
    p = pty.spawn(sh, args, {
      name: 'xterm-256color',
      cols: Math.max(20, cols || 100),
      rows: Math.max(5, rows || 30),
      cwd: dir,
      env: { ...process.env, ...(env || {}), ARGON: '1', COLORTERM: 'truecolor' },
      useConpty: true,
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
  ptys.set(id, p);
  p.onData((data) => { if (win) win.webContents.send('pty:data', id, data); });
  p.onExit(({ exitCode }) => {
    ptys.delete(id);
    if (win) win.webContents.send('pty:exit', id, exitCode);
  });
  return { ok: true, pid: p.pid };
});

ipcMain.on('pty:write', (_e, id, data) => { const p = ptys.get(id); if (p) p.write(data); });
ipcMain.on('pty:resize', (_e, id, cols, rows) => {
  const p = ptys.get(id);
  if (p && cols > 1 && rows > 1) { try { p.resize(cols, rows); } catch (_) {} }
});
ipcMain.handle('pty:kill', (_e, id) => {
  const p = ptys.get(id);
  if (p) { try { p.kill(); } catch (_) {} ptys.delete(id); }
  return true;
});
ipcMain.handle('pty:alive', (_e, id) => ptys.has(id));

// ---------- state ----------
ipcMain.handle('state:load', () => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return null; }
});

let lastBackup = 0;
ipcMain.handle('state:save', (_e, json) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, STATE_FILE);
  // Versioned backups, at most one a minute.
  const now = Date.now();
  if (now - lastBackup > 60_000) {
    lastBackup = now;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(BACKUP_DIR, `state-${stamp}.json`), json);
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('state-')).sort();
    while (files.length > MAX_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  }
  return true;
});

ipcMain.handle('state:dir', () => STATE_DIR);

// ---------- dialogs / shell ----------
// ---------- window chrome ----------
ipcMain.handle('win:overlay', (_e, o) => {
  try { if (win && o) win.setTitleBarOverlay({ color: o.color || '#00000000', symbolColor: o.symbolColor, height: Math.round(o.height || 60) }); } catch (_) {}
});
ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('shell:open', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});
ipcMain.handle('shell:reveal', (_e, p) => { if (p) shell.openPath(p); });
ipcMain.handle('app:home', () => os.homedir());

// ---------- agent detection ----------
function which(cmd) {
  return new Promise((resolve) => {
    const tool = process.platform === 'win32' ? 'where.exe' : 'which';
    execFile(tool, [cmd], { windowsHide: true }, (err, out) => {
      resolve(!err && out.trim() ? out.trim().split(/\r?\n/)[0] : null);
    });
  });
}
ipcMain.handle('agents:detect', async (_e, cmds) => {
  refreshPath();
  const out = {};
  await Promise.all(cmds.map(async c => { out[c] = await which(c); }));
  return out;
});

// Sign-in check: only looks for whether each CLI's own login file exists.
// Never reads or sends the contents.
function hasFile(p) { try { return fs.statSync(p).size > 2; } catch (_) { return false; } }
function fileHas(p, needle) { try { return fs.readFileSync(p, 'utf8').includes(needle); } catch (_) { return false; } }
ipcMain.handle('agents:auth', () => {
  const home = os.homedir();
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const codexDir = process.env.CODEX_HOME || path.join(home, '.codex');
  const geminiDir = path.join(home, '.gemini');
  return {
    claude: hasFile(path.join(claudeDir, '.credentials.json')) || fileHas(path.join(home, '.claude.json'), '"oauthAccount"') || !!process.env.ANTHROPIC_API_KEY,
    codex: hasFile(path.join(codexDir, 'auth.json')) || !!process.env.OPENAI_API_KEY,
    gemini: hasFile(path.join(geminiDir, 'oauth_creds.json')) || !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_API_KEY,
  };
});

// ---------- git ----------
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: stdout || '', err: stderr || (err ? String(err.message) : '') });
    });
  });
}
ipcMain.handle('git:info', async (_e, cwd) => {
  if (!cwd || !fs.existsSync(cwd)) return { repo: false };
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return { repo: false };
  const [branch, status, branches, log, ab] = await Promise.all([
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['status', '--porcelain']),
    git(cwd, ['branch', '--format=%(refname:short)']),
    git(cwd, ['log', '-8', '--pretty=format:%h\x1f%s\x1f%cr']),
    git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
  ]);
  let behind = 0, ahead = 0, upstream = false;
  if (ab.ok) { const m = ab.out.trim().split(/\s+/); behind = +m[0] || 0; ahead = +m[1] || 0; upstream = true; }
  return {
    repo: true,
    root: top.out.trim(),
    branch: branch.out.trim(),
    changes: status.out.split(/\r?\n/).filter(Boolean).map(l => ({ code: l.slice(0, 2), file: l.slice(3) })),
    branches: branches.out.split(/\r?\n/).filter(Boolean),
    log: log.out.split(/\r?\n/).filter(Boolean).map(l => { const [h, s, t] = l.split('\x1f'); return { h, s, t }; }),
    ahead, behind, upstream,
  };
});
ipcMain.handle('git:action', async (_e, cwd, action, arg) => {
  switch (action) {
    case 'commit': {
      const add = await git(cwd, ['add', '-A']);
      if (!add.ok) return add;
      return git(cwd, ['commit', '-m', String(arg || 'Update from Argon')]);
    }
    case 'pull': return git(cwd, ['pull', '--ff-only']);
    case 'push': return git(cwd, ['push']);
    case 'checkout': return git(cwd, ['checkout', String(arg)]);
    case 'fetch': return git(cwd, ['fetch', '--all', '--prune']);
    default: return { ok: false, err: 'unknown action' };
  }
});

// ---------- files ----------
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.venv', '__pycache__', '.gradle', 'target', '.idea']);
ipcMain.handle('fs:list', (_e, dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => !(d.isDirectory() && SKIP_DIRS.has(d.name)))
      .map(d => ({ name: d.name, dir: d.isDirectory(), path: path.join(dir, d.name) }))
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  } catch (_) { return []; }
});
ipcMain.handle('fs:read', (_e, file) => {
  try {
    const st = fs.statSync(file);
    if (st.size > 1024 * 1024) return { ok: false, error: 'File is larger than 1 MB.' };
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return { ok: false, error: 'Binary file.' };
    return { ok: true, text: buf.toString('utf8') };
  } catch (err) { return { ok: false, error: String(err.message) }; }
});
ipcMain.handle('fs:write', (_e, file, text) => {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return true; }
  catch (_) { return false; }
});
ipcMain.handle('fs:exists', (_e, file) => fs.existsSync(file));
ipcMain.handle('fs:changed', (_e, dir, since, limit = 400) => {
  const SKIP = new Set(['node_modules', 'dist', 'build', 'target', '__pycache__']); const out = []; const stack = [[dir, 0]]; let seen = 0;
  while (stack.length && seen < 40000) {
    const [d, depth] = stack.pop(); let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of ents) { seen++; const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 8 && !e.name.startsWith('.') && !SKIP.has(e.name)) stack.push([p, depth + 1]); }
      else { try { const st = fs.statSync(p); if (st.mtimeMs >= since) out.push({ path: p, size: st.size, t: st.mtimeMs }); } catch (_) {} } }
  }
  return out.sort((a, b) => b.t - a.t).slice(0, limit).map(({ path: f, size }) => ({ path: f, size }));
});

// ---------- token usage (read from local Claude Code / Codex logs) ----------
function walk(dir, ext, out, depth = 0) {
  if (depth > 4) return out;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out, depth + 1);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}
function dayKey(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// ---------- context gauge: how full each Claude Code session's context is ----------
// Claude keeps a transcript per session in ~/.claude/projects/<folder with symbols turned into dashes>/<id>.jsonl.
function claudeProjectDir(base, cwd) { return path.join(base, 'projects', String(cwd || '').replace(/[^A-Za-z0-9]/g, '-')); }
function lastUsage(file) {
  try {
    const st = fs.statSync(file), size = st.size, len = Math.min(size, 400_000), fd = fs.openSync(file, 'r'), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]; if (!line.includes('"usage"')) continue;
      let j; try { j = JSON.parse(line); } catch (_) { continue; }
      const u = j.message && j.message.usage; if (!u || j.isSidechain) continue;
      const used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
      return { used, model: (j.message && j.message.model) || '', mtime: st.mtimeMs, file };
    }
    return { used: 0, model: '', mtime: st.mtimeMs, file };
  } catch (_) { return null; }
}
ipcMain.handle('app:icon', (_e, png) => { try { if (win) win.setIcon(nativeImage.createFromBuffer(Buffer.from(png))); return true; } catch (_) { return false; } });
ipcMain.handle('claude:context', async (_e, cwd, count = 4) => {
  const bases = [process.env.CLAUDE_CONFIG_DIR, path.join(os.homedir(), '.claude')].filter(Boolean);
  const files = [];
  for (const b of bases) { const d = claudeProjectDir(b, cwd); try { for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl')) files.push(path.join(d, f)); } catch (_) {} }
  return files.map(f => { try { return [f, fs.statSync(f).mtimeMs]; } catch (_) { return null; } }).filter(Boolean)
    .sort((a, b) => b[1] - a[1]).slice(0, Math.max(1, Math.min(12, count))).map(([f]) => lastUsage(f)).filter(Boolean);
});

// ---------- dictation: Windows voice typing (Win+H) types into whatever has focus ----------
ipcMain.handle('dictate:win', async () => {
  if (process.platform !== 'win32') return false;
  const ps = "Add-Type -Namespace W -Name K -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, int f, int e);'; [W.K]::keybd_event(0x5B,0,0,0); [W.K]::keybd_event(0x48,0,0,0); [W.K]::keybd_event(0x48,0,2,0); [W.K]::keybd_event(0x5B,0,2,0)";
  return new Promise((resolve) => { require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (err) => resolve(!err)); });
});

ipcMain.handle('usage:tokens', async (_e, days = 14) => {
  const since = Date.now() - days * 86400_000;
  const byDay = {}; // day -> {claude:{in,out,cache}, codex:{...}}
  const bump = (day, agent, k, v) => {
    if (!day || !v) return;
    byDay[day] = byDay[day] || {};
    byDay[day][agent] = byDay[day][agent] || { input: 0, output: 0, cache: 0 };
    byDay[day][agent][k] += v;
  };
  const claudeDirs = [process.env.CLAUDE_CONFIG_DIR, path.join(os.homedir(), '.claude')].filter(Boolean);
  const seen = new Set();
  for (const base of claudeDirs) {
    for (const f of walk(path.join(base, 'projects'), '.jsonl', [])) {
      try { if (fs.statSync(f).mtimeMs < since) continue; } catch (_) { continue; }
      let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let j; try { j = JSON.parse(line); } catch (_) { continue; }
        const u = j.message && j.message.usage;
        if (!u) continue;
        const key = (j.message.id || '') + (j.requestId || '');
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        const ts = Date.parse(j.timestamp);
        if (!(ts >= since)) continue;
        const d = dayKey(ts);
        bump(d, 'claude', 'input', u.input_tokens || 0);
        bump(d, 'claude', 'output', u.output_tokens || 0);
        bump(d, 'claude', 'cache', (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0));
      }
    }
  }
  const codexBase = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  for (const f of walk(path.join(codexBase, 'sessions'), '.jsonl', [])) {
    try { if (fs.statSync(f).mtimeMs < since) continue; } catch (_) { continue; }
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('token_count')) continue;
      let j; try { j = JSON.parse(line); } catch (_) { continue; }
      const info = j.payload && j.payload.info && j.payload.info.last_token_usage;
      if (!info) continue;
      const ts = Date.parse(j.timestamp);
      if (!(ts >= since)) continue;
      const d = dayKey(ts);
      bump(d, 'codex', 'input', (info.input_tokens || 0) - (info.cached_input_tokens || 0));
      bump(d, 'codex', 'output', info.output_tokens || 0);
      bump(d, 'codex', 'cache', info.cached_input_tokens || 0);
    }
  }
  return byDay;
});

// ---------- lifecycle ----------
app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  for (const p of ptys.values()) { try { p.kill(); } catch (_) {} }
  ptys.clear();
  app.quit();
});
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
