// Tauri bridge: gives the page the same window.argon API that Electron's preload.js provides,
// backed by the Rust commands in src-tauri/src/lib.rs. Does nothing inside Electron.
(() => {
  if (window.argon || !window.__TAURI__) return;
  const T = window.__TAURI__;
  const invoke = T.core.invoke;
  const win = () => T.window.getCurrentWindow();
  const dataHandlers = new Map();
  const exitHandlers = new Map();

  window.argon = {
    platform: 'win32',
    shell: 'tauri',
    pty: {
      spawn: (opts) => {
        const ch = new T.core.Channel();
        ch.onmessage = (m) => {
          if (m.t === 'Data') { const h = dataHandlers.get(opts.id); if (h) h(m.d); }
          else if (m.t === 'Exit') { const h = exitHandlers.get(opts.id); if (h) h(m.d); }
        };
        return invoke('pty_spawn', { opts, onEvent: ch });
      },
      write: (id, data) => { invoke('pty_write', { id, data }).catch(() => {}); },
      resize: (id, cols, rows) => { invoke('pty_resize', { id, cols, rows }).catch(() => {}); },
      kill: (id) => invoke('pty_kill', { id }),
      alive: (id) => invoke('pty_alive', { id }),
      onData: (id, fn) => { dataHandlers.set(id, fn); },
      onExit: (id, fn) => { exitHandlers.set(id, fn); },
      off: (id) => { dataHandlers.delete(id); exitHandlers.delete(id); },
    },
    state: {
      load: () => invoke('state_load'),
      save: (json) => invoke('state_save', { json }),
      dir: () => invoke('state_dir_path'),
    },
    pickFolder: () => invoke('pick_folder'),
    claudeContext: (cwd, count) => invoke('claude_context', { cwd, count }),
    claudeTranscript: (o) => invoke('claude_transcript', { cwd: o.cwd, session: o.session || null, file: o.file || null, profile: o.profile || null, bytes: o.bytes || null, known: o.known == null ? null : o.known }),
    dictateWin: () => invoke('dictate_win'),
    openExternal: (url) => invoke('shell_open', { url }),
    reveal: (path) => invoke('shell_reveal', { path }),
    home: () => invoke('app_home'),
    detectAgents: (cmds) => invoke('agents_detect', { cmds }),
    agentAuth: () => invoke('agents_auth'),
    git: {
      info: (cwd) => invoke('git_info', { cwd }),
      action: (cwd, action, arg) => invoke('git_action', { cwd, action, arg: arg == null ? null : arg }),
    },
    fs: {
      list: (dir) => invoke('fs_list', { dir }),
      read: (file) => invoke('fs_read', { file }),
      write: (file, text) => invoke('fs_write', { file, text }),
      exists: (file) => invoke('fs_exists', { file }),
      changed: (dir, since, limit) => invoke('fs_changed', { dir, since: Math.floor(since), limit }),
      mkdir: (dir) => invoke('fs_mkdir', { dir }),
      rename: (from, to) => invoke('fs_rename', { from, to }),
      trash: (path) => invoke('fs_trash', { path }),
      remove: (file) => invoke('fs_remove', { file }),
      open: (path) => invoke('open_path', { path }),
    },
    usage: (days) => invoke('usage_tokens', { days }),
    // Electron tinted its built-in caption buttons; here the buttons are ours and follow the theme.
    setOverlay: () => {},
    backdrop: (kind) => invoke('set_backdrop', { kind }),
    setAppIcon: (png) => invoke('set_app_icon', { png: Array.from(png) }),
    zoom: (f) => { try { T.webview.getCurrentWebview().setZoom(f); } catch (_) {} },
  };

  // ---------- window chrome: our own caption buttons and drag-to-move ----------
  const ICON = {
    min: '<svg viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>',
    max: '<svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    restore: '<svg viewBox="0 0 10 10"><path d="M2.5 2.5V.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1"/><rect x=".5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    close: '<svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/></svg>',
  };
  const NO_DRAG = 'button, a, input, textarea, select, nav, [contenteditable="true"], .nodrag, .tab, .cmd-trigger, #mode-seg';
  function chrome() {
    document.documentElement.classList.add('tauri');
    const bar = document.createElement('div'); bar.className = 'win-ctl';
    const mk = (k, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'wc-' + k; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = ICON[k]; b.onclick = fn; bar.append(b); return b; };
    mk('min', 'Minimize', () => win().minimize());
    const max = mk('max', 'Maximize', () => win().toggleMaximize());
    mk('close', 'Close', () => win().close());
    document.body.append(bar);
    const syncMax = async () => { try { const m = await win().isMaximized(); max.innerHTML = m ? ICON.restore : ICON.max; max.title = m ? 'Restore' : 'Maximize'; document.documentElement.classList.toggle('maximized', m); } catch (_) {} };
    syncMax(); try { win().onResized(syncMax); } catch (_) {}
    const top = document.getElementById('topbar');
    if (top) {
      top.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest(NO_DRAG)) return;
        if (e.detail === 2) { win().toggleMaximize(); return; }
        win().startDragging();
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', chrome); else chrome();
})();
