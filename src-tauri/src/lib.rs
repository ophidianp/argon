// Argon backend (Tauri). Owns the real terminals, saving, git, file reads and token stats.
// The web frontend is the same one the Electron build uses; src/tauri-bridge.js maps
// window.argon.* onto these commands.
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const NO_WINDOW: u32 = 0x0800_0000;

// ---------- shared state ----------
struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    // Swappable, so a page reload can reattach to a shell that is still running.
    chan: Arc<Mutex<Channel<PtyEvent>>>,
}

#[derive(Default)]
struct App {
    ptys: Mutex<HashMap<String, Pty>>,
    last_backup: Mutex<u64>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}
fn mtime_ms(p: &Path) -> Option<f64> {
    fs::metadata(p).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as f64)
}
fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}
fn state_dir() -> PathBuf {
    if let Ok(d) = std::env::var("ARGON_DATA") {
        if !d.is_empty() {
            return PathBuf::from(d);
        }
    }
    // Same folder the Electron build used, so boards carry over.
    dirs::config_dir().unwrap_or_else(home).join("Argon")
}

/// A Command that never flashes a console window.
fn quiet(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    c.creation_flags(NO_WINDOW);
    c
}

// ---------- PATH refresh: Windows only updates PATH for programs started after an install ----------
#[cfg(windows)]
fn expand_vars(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(a) = rest.find('%') {
        out.push_str(&rest[..a]);
        let after = &rest[a + 1..];
        if let Some(b) = after.find('%') {
            let name = &after[..b];
            match std::env::var(name) {
                Ok(v) => out.push_str(&v),
                Err(_) => { out.push('%'); out.push_str(name); out.push('%'); }
            }
            rest = &after[b + 1..];
        } else {
            out.push_str(&rest[a..]);
            rest = "";
        }
    }
    out.push_str(rest);
    out
}
#[cfg(windows)]
fn refresh_path() {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let read = |root, key: &str| -> String {
        RegKey::predef(root).open_subkey(key).and_then(|k| k.get_value::<String, _>("Path")).map(|v| expand_vars(&v)).unwrap_or_default()
    };
    let sys = read(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment");
    let usr = read(HKEY_CURRENT_USER, "Environment");
    if sys.is_empty() && usr.is_empty() {
        return;
    }
    let cur = std::env::var("PATH").unwrap_or_default();
    let mut seen = HashSet::new();
    let parts: Vec<String> = sys.split(';').chain(usr.split(';')).chain(cur.split(';'))
        .map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        .filter(|p| seen.insert(p.to_lowercase().trim_end_matches('\\').to_string()))
        .collect();
    std::env::set_var("PATH", parts.join(";"));
}
#[cfg(not(windows))]
fn refresh_path() {}

fn shell_path() -> String {
    if cfg!(windows) {
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let pwsh = Path::new(&pf).join("PowerShell").join("7").join("pwsh.exe");
        if pwsh.exists() { pwsh.to_string_lossy().into_owned() } else { "powershell.exe".into() }
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}

// ---------- terminals ----------
#[derive(Deserialize)]
struct SpawnOpts {
    id: String,
    command: Option<String>,
    cwd: Option<String>,
    cols: Option<f64>,
    rows: Option<f64>,
    env: Option<HashMap<String, Value>>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "t", content = "d")]
enum PtyEvent {
    Data(String),
    Exit(i64),
}

#[tauri::command]
fn pty_spawn(app: AppHandle, state: State<App>, opts: SpawnOpts, on_event: Channel<PtyEvent>) -> Value {
    refresh_path();
    if let Some(p) = state.ptys.lock().unwrap().get(&opts.id) {
        *p.chan.lock().unwrap() = on_event;
        return json!({ "ok": true, "reused": true });
    }
    let sh = shell_path();
    let mut cmd = CommandBuilder::new(&sh);
    if cfg!(windows) {
        cmd.args(["-NoLogo", "-ExecutionPolicy", "Bypass"]);
        if let Some(c) = opts.command.as_deref().filter(|c| !c.is_empty()) {
            cmd.args(["-NoExit", "-Command", c]);
        }
    } else if let Some(c) = opts.command.as_deref().filter(|c| !c.is_empty()) {
        cmd.args(["-lc", &format!("{c}; exec {sh}")]);
    } else {
        cmd.arg("-l");
    }
    let dir = opts.cwd.as_deref().map(PathBuf::from).filter(|p| p.is_dir()).unwrap_or_else(home);
    cmd.cwd(dir);
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    if let Some(env) = &opts.env {
        for (k, v) in env {
            let v = match v { Value::String(s) => s.clone(), Value::Null => continue, other => other.to_string() };
            cmd.env(k, v);
        }
    }
    cmd.env("ARGON", "1");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM", "xterm-256color");

    let size = PtySize {
        cols: opts.cols.unwrap_or(100.0).max(20.0) as u16,
        rows: opts.rows.unwrap_or(30.0).max(5.0) as u16,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = match native_pty_system().openpty(size) {
        Ok(p) => p,
        Err(e) => return json!({ "ok": false, "error": e.to_string() }),
    };
    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => return json!({ "ok": false, "error": e.to_string() }),
    };
    drop(pair.slave);
    let pid = child.process_id();
    let mut reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => return json!({ "ok": false, "error": e.to_string() }),
    };
    let writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => return json!({ "ok": false, "error": e.to_string() }),
    };
    let killer = child.clone_killer();
    let chan = Arc::new(Mutex::new(on_event));
    state.ptys.lock().unwrap().insert(opts.id.clone(), Pty { master: pair.master, writer, killer, chan: chan.clone() });

    // Reader: stream output to the page, never splitting a UTF-8 character across messages.
    let ch = chan.clone();
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let valid = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) => if e.error_len().is_some() { pending.len() } else { e.valid_up_to() },
                    };
                    if valid == 0 { continue; }
                    let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
                    pending.drain(..valid);
                    // If the page is reloading, drop this chunk but keep the shell's output flowing.
                    let _ = ch.lock().unwrap().send(PtyEvent::Data(text));
                }
            }
        }
    });
    // Waiter: when the shell exits, drop the pty (which also ends the reader) and tell the page.
    let id = opts.id.clone();
    std::thread::spawn(move || {
        let code = child.wait().map(|s| s.exit_code() as i64).unwrap_or(-1);
        std::thread::sleep(Duration::from_millis(60));
        app.state::<App>().ptys.lock().unwrap().remove(&id);
        let _ = chan.lock().unwrap().send(PtyEvent::Exit(code));
    });
    json!({ "ok": true, "pid": pid })
}

#[tauri::command]
fn pty_write(state: State<App>, id: String, data: String) {
    if let Some(p) = state.ptys.lock().unwrap().get_mut(&id) {
        let _ = p.writer.write_all(data.as_bytes());
        let _ = p.writer.flush();
    }
}

#[tauri::command]
fn pty_resize(state: State<App>, id: String, cols: f64, rows: f64) {
    if cols <= 1.0 || rows <= 1.0 { return; }
    if let Some(p) = state.ptys.lock().unwrap().get(&id) {
        let _ = p.master.resize(PtySize { cols: cols as u16, rows: rows as u16, pixel_width: 0, pixel_height: 0 });
    }
}

#[tauri::command]
fn pty_kill(state: State<App>, id: String) -> bool {
    if let Some(mut p) = state.ptys.lock().unwrap().remove(&id) {
        let _ = p.killer.kill();
    }
    true
}

#[tauri::command]
fn pty_alive(state: State<App>, id: String) -> bool {
    state.ptys.lock().unwrap().contains_key(&id)
}

// ---------- state ----------
const MAX_BACKUPS: usize = 25;

#[tauri::command]
fn state_load() -> Value {
    fs::read_to_string(state_dir().join("argon-state.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null)
}

#[tauri::command]
fn state_save(state: State<App>, json: String) -> bool {
    let dir = state_dir();
    let file = dir.join("argon-state.json");
    let tmp = dir.join("argon-state.json.tmp");
    if fs::create_dir_all(&dir).is_err() || fs::write(&tmp, &json).is_err() || fs::rename(&tmp, &file).is_err() {
        return false;
    }
    // Versioned backups, at most one a minute.
    let now = now_ms();
    let mut last = state.last_backup.lock().unwrap();
    if now - *last > 60_000 {
        *last = now;
        let bdir = dir.join("backups");
        let _ = fs::create_dir_all(&bdir);
        let stamp = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S-%3fZ");
        let _ = fs::write(bdir.join(format!("state-{stamp}.json")), &json);
        if let Ok(rd) = fs::read_dir(&bdir) {
            let mut files: Vec<PathBuf> = rd.flatten().map(|e| e.path())
                .filter(|p| p.file_name().map(|n| n.to_string_lossy().starts_with("state-")).unwrap_or(false)).collect();
            files.sort();
            while files.len() > MAX_BACKUPS { let _ = fs::remove_file(files.remove(0)); }
        }
    }
    true
}

#[tauri::command]
fn state_dir_path() -> String {
    state_dir().to_string_lossy().into_owned()
}

// ---------- dialogs / shell ----------
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn shell_open(app: AppHandle, url: String) {
    use tauri_plugin_opener::OpenerExt;
    let lower = url.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

#[tauri::command]
fn shell_reveal(app: AppHandle, path: String) {
    use tauri_plugin_opener::OpenerExt;
    if !path.is_empty() { let _ = app.opener().open_path(path, None::<&str>); }
}

#[tauri::command]
fn app_home() -> String {
    home().to_string_lossy().into_owned()
}

// ---------- agent detection ----------
fn which(cmd: &str) -> Option<String> {
    let tool = if cfg!(windows) { "where.exe" } else { "which" };
    let out = quiet(tool).arg(cmd).output().ok()?;
    if !out.status.success() { return None; }
    String::from_utf8_lossy(&out.stdout).lines().next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[tauri::command]
async fn agents_detect(cmds: Vec<String>) -> HashMap<String, Option<String>> {
    refresh_path();
    let handles: Vec<_> = cmds.into_iter().map(|c| std::thread::spawn(move || { let r = which(&c); (c, r) })).collect();
    handles.into_iter().filter_map(|h| h.join().ok()).collect()
}

// Sign-in check: only looks for whether each CLI's own login file exists. Never reads or sends the contents.
fn has_file(p: &Path) -> bool { fs::metadata(p).map(|m| m.len() > 2).unwrap_or(false) }
fn file_has(p: &Path, needle: &str) -> bool { fs::read_to_string(p).map(|s| s.contains(needle)).unwrap_or(false) }
fn env_set(k: &str) -> bool { std::env::var(k).map(|v| !v.is_empty()).unwrap_or(false) }

#[tauri::command]
fn agents_auth() -> Value {
    let h = home();
    let claude = std::env::var("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|_| h.join(".claude"));
    let codex = std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| h.join(".codex"));
    json!({
        "claude": has_file(&claude.join(".credentials.json")) || file_has(&h.join(".claude.json"), "\"oauthAccount\"") || env_set("ANTHROPIC_API_KEY"),
        "codex": has_file(&codex.join("auth.json")) || env_set("OPENAI_API_KEY"),
        "gemini": has_file(&h.join(".gemini").join("oauth_creds.json")) || env_set("GEMINI_API_KEY") || env_set("GOOGLE_API_KEY"),
    })
}

// ---------- git ----------
fn git(cwd: &str, args: &[&str]) -> Value {
    match quiet("git").args(args).current_dir(cwd).output() {
        Ok(o) => json!({
            "ok": o.status.success(),
            "out": String::from_utf8_lossy(&o.stdout),
            "err": String::from_utf8_lossy(&o.stderr),
        }),
        Err(e) => json!({ "ok": false, "out": "", "err": e.to_string() }),
    }
}
fn ok(v: &Value) -> bool { v["ok"].as_bool().unwrap_or(false) }
fn out(v: &Value) -> String { v["out"].as_str().unwrap_or("").to_string() }

#[tauri::command]
async fn git_info(cwd: String) -> Value {
    if cwd.is_empty() || !Path::new(&cwd).exists() { return json!({ "repo": false }); }
    let top = git(&cwd, &["rev-parse", "--show-toplevel"]);
    if !ok(&top) { return json!({ "repo": false }); }
    let run = |args: Vec<&'static str>, c: String| std::thread::spawn(move || git(&c, &args));
    let hb = run(vec!["rev-parse", "--abbrev-ref", "HEAD"], cwd.clone());
    let hs = run(vec!["status", "--porcelain"], cwd.clone());
    let hr = run(vec!["branch", "--format=%(refname:short)"], cwd.clone());
    let hl = run(vec!["log", "-8", "--pretty=format:%h\x1f%s\x1f%cr"], cwd.clone());
    let ha = run(vec!["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], cwd.clone());
    let (branch, status, branches, log, ab) = (hb.join().unwrap(), hs.join().unwrap(), hr.join().unwrap(), hl.join().unwrap(), ha.join().unwrap());
    let (mut behind, mut ahead, mut upstream) = (0i64, 0i64, false);
    if ok(&ab) {
        let o = out(&ab);
        let m: Vec<&str> = o.split_whitespace().collect();
        behind = m.first().and_then(|s| s.parse().ok()).unwrap_or(0);
        ahead = m.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        upstream = true;
    }
    let changes: Vec<Value> = out(&status).lines().filter(|l| !l.is_empty())
        .map(|l| json!({ "code": l.get(0..2).unwrap_or(""), "file": l.get(3..).unwrap_or("") })).collect();
    let branches: Vec<String> = out(&branches).lines().filter(|l| !l.is_empty()).map(String::from).collect();
    let log: Vec<Value> = out(&log).lines().filter(|l| !l.is_empty()).map(|l| {
        let p: Vec<&str> = l.split('\x1f').collect();
        json!({ "h": p.first().unwrap_or(&""), "s": p.get(1).unwrap_or(&""), "t": p.get(2).unwrap_or(&"") })
    }).collect();
    json!({
        "repo": true, "root": out(&top).trim(), "branch": out(&branch).trim(),
        "changes": changes, "branches": branches, "log": log,
        "ahead": ahead, "behind": behind, "upstream": upstream,
    })
}

#[tauri::command]
async fn git_action(cwd: String, action: String, arg: Option<Value>) -> Value {
    let arg = match arg { Some(Value::String(s)) => s, Some(Value::Null) | None => String::new(), Some(v) => v.to_string() };
    match action.as_str() {
        "commit" => {
            let add = git(&cwd, &["add", "-A"]);
            if !ok(&add) { return add; }
            let msg = if arg.is_empty() { "Update from Argon".to_string() } else { arg };
            git(&cwd, &["commit", "-m", &msg])
        }
        "pull" => git(&cwd, &["pull", "--ff-only"]),
        "push" => git(&cwd, &["push"]),
        "checkout" => git(&cwd, &["checkout", &arg]),
        "fetch" => git(&cwd, &["fetch", "--all", "--prune"]),
        _ => json!({ "ok": false, "err": "unknown action" }),
    }
}

// ---------- files ----------
const SKIP_DIRS: &[&str] = &[".git", "node_modules", ".next", "dist", "build", ".venv", "__pycache__", ".gradle", "target", ".idea"];

#[tauri::command]
fn fs_list(dir: String) -> Vec<Value> {
    let mut v: Vec<(bool, String, String)> = match fs::read_dir(&dir) {
        Ok(rd) => rd.flatten().filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir && SKIP_DIRS.contains(&name.as_str()) { return None; }
            Some((is_dir, name, e.path().to_string_lossy().into_owned()))
        }).collect(),
        Err(_) => vec![],
    };
    v.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    v.into_iter().map(|(d, n, p)| json!({ "name": n, "dir": d, "path": p })).collect()
}

// Files changed since a time (ms since 1970) under a folder: what a team run produced. Skips build and dot folders.
#[tauri::command]
async fn fs_changed(dir: String, since: u64, limit: Option<usize>) -> Vec<Value> {
    let limit = limit.unwrap_or(400);
    let since = std::time::UNIX_EPOCH + std::time::Duration::from_millis(since);
    let mut out: Vec<(std::time::SystemTime, String, u64)> = vec![];
    let mut stack = vec![(std::path::PathBuf::from(&dir), 0usize)];
    let mut seen = 0usize;
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            seen += 1;
            if seen > 40000 { break; }
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if depth < 8 && !name.starts_with('.') && !SKIP_DIRS.contains(&name.as_str()) { stack.push((e.path(), depth + 1)); }
            } else if let Ok(m) = e.metadata() {
                if let Ok(t) = m.modified() { if t >= since { out.push((t, e.path().to_string_lossy().into_owned(), m.len())); } }
            }
        }
    }
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out.into_iter().take(limit).map(|(_, p, n)| json!({ "path": p, "size": n })).collect()
}

#[tauri::command]
fn fs_read(file: String) -> Value {
    match fs::metadata(&file) {
        Ok(m) if m.len() > 1024 * 1024 => json!({ "ok": false, "error": "File is larger than 1 MB." }),
        Ok(_) => match fs::read(&file) {
            Ok(b) if b.contains(&0) => json!({ "ok": false, "error": "Binary file." }),
            Ok(b) => json!({ "ok": true, "text": String::from_utf8_lossy(&b) }),
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        },
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn fs_write(file: String, text: String) -> bool {
    let p = Path::new(&file);
    if let Some(d) = p.parent() { let _ = fs::create_dir_all(d); }
    fs::write(p, text).is_ok()
}

#[tauri::command]
fn fs_exists(file: String) -> bool {
    Path::new(&file).exists()
}

// ---------- context gauge: how full each Claude Code session's context is ----------
fn claude_bases() -> Vec<PathBuf> {
    let mut v = vec![];
    if let Ok(d) = std::env::var("CLAUDE_CONFIG_DIR") { if !d.is_empty() { v.push(PathBuf::from(d)); } }
    v.push(home().join(".claude"));
    v
}
fn project_slug(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}
fn usage_sum(u: &Value) -> i64 {
    ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"].iter().map(|k| u[*k].as_i64().unwrap_or(0)).sum()
}
fn last_usage(file: &Path) -> Option<Value> {
    let mtime = mtime_ms(file)?;
    let mut f = fs::File::open(file).ok()?;
    let size = f.metadata().ok()?.len();
    let len = size.min(400_000);
    f.seek(SeekFrom::Start(size - len)).ok()?;
    let mut buf = Vec::with_capacity(len as usize);
    f.take(len).read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    for line in text.lines().rev() {
        if !line.contains("\"usage\"") { continue; }
        let Ok(j) = serde_json::from_str::<Value>(line) else { continue };
        let u = &j["message"]["usage"];
        if !u.is_object() || j["isSidechain"].as_bool().unwrap_or(false) { continue; }
        return Some(json!({ "used": usage_sum(u), "model": j["message"]["model"].as_str().unwrap_or(""), "mtime": mtime, "file": file.to_string_lossy() }));
    }
    Some(json!({ "used": 0, "model": "", "mtime": mtime, "file": file.to_string_lossy() }))
}

#[tauri::command]
async fn claude_context(cwd: String, count: Option<f64>) -> Vec<Value> {
    let count = count.unwrap_or(4.0).clamp(1.0, 12.0) as usize;
    let mut files: Vec<(PathBuf, f64)> = vec![];
    for b in claude_bases() {
        let d = b.join("projects").join(project_slug(&cwd));
        if let Ok(rd) = fs::read_dir(d) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().map(|x| x == "jsonl").unwrap_or(false) {
                    if let Some(m) = mtime_ms(&p) { files.push((p, m)); }
                }
            }
        }
    }
    files.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    files.into_iter().take(count).filter_map(|(p, _)| last_usage(&p)).collect()
}

// ---------- dictation: Windows voice typing (Win+H) types into whatever has focus ----------
#[tauri::command]
async fn dictate_win() -> bool {
    if !cfg!(windows) { return false; }
    let ps = "Add-Type -Namespace W -Name K -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, int f, int e);'; [W.K]::keybd_event(0x5B,0,0,0); [W.K]::keybd_event(0x48,0,0,0); [W.K]::keybd_event(0x48,0,2,0); [W.K]::keybd_event(0x5B,0,2,0)";
    quiet("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", ps]).status().map(|s| s.success()).unwrap_or(false)
}

// ---------- token usage (read from local Claude Code / Codex logs) ----------
fn walk(dir: &Path, ext: &str, out: &mut Vec<PathBuf>, depth: u32) {
    if depth > 4 { return; }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) { walk(&p, ext, out, depth + 1); }
        else if p.to_string_lossy().ends_with(ext) { out.push(p); }
    }
}
fn parse_ts(s: &str) -> Option<chrono::DateTime<chrono::Local>> {
    chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&chrono::Local))
}

#[tauri::command]
async fn usage_tokens(days: Option<f64>) -> Value {
    let days = days.unwrap_or(14.0);
    let since_ms = now_ms() as f64 - days * 86_400_000.0;
    let mut by_day: serde_json::Map<String, Value> = serde_json::Map::new();
    let mut bump = |day: &str, agent: &str, k: &str, v: i64| {
        if v == 0 { return; }
        let d = by_day.entry(day.to_string()).or_insert_with(|| json!({}));
        let a = d.as_object_mut().unwrap().entry(agent.to_string()).or_insert_with(|| json!({ "input": 0, "output": 0, "cache": 0 }));
        let cur = a[k].as_i64().unwrap_or(0);
        a[k] = json!(cur + v);
    };
    let mut seen = HashSet::new();
    for base in claude_bases() {
        let mut files = vec![];
        walk(&base.join("projects"), ".jsonl", &mut files, 0);
        for f in files {
            if mtime_ms(&f).map(|m| m < since_ms).unwrap_or(true) { continue; }
            let Ok(text) = fs::read_to_string(&f) else { continue };
            for line in text.lines() {
                if !line.contains("\"usage\"") { continue; }
                let Ok(j) = serde_json::from_str::<Value>(line) else { continue };
                let u = &j["message"]["usage"];
                if !u.is_object() { continue; }
                let key = format!("{}{}", j["message"]["id"].as_str().unwrap_or(""), j["requestId"].as_str().unwrap_or(""));
                if !key.is_empty() && !seen.insert(key) { continue; }
                let Some(ts) = j["timestamp"].as_str().and_then(parse_ts) else { continue };
                if (ts.timestamp_millis() as f64) < since_ms { continue; }
                let d = ts.format("%Y-%m-%d").to_string();
                bump(&d, "claude", "input", u["input_tokens"].as_i64().unwrap_or(0));
                bump(&d, "claude", "output", u["output_tokens"].as_i64().unwrap_or(0));
                bump(&d, "claude", "cache", u["cache_read_input_tokens"].as_i64().unwrap_or(0) + u["cache_creation_input_tokens"].as_i64().unwrap_or(0));
            }
        }
    }
    let codex = std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| home().join(".codex"));
    let mut files = vec![];
    walk(&codex.join("sessions"), ".jsonl", &mut files, 0);
    for f in files {
        if mtime_ms(&f).map(|m| m < since_ms).unwrap_or(true) { continue; }
        let Ok(text) = fs::read_to_string(&f) else { continue };
        for line in text.lines() {
            if !line.contains("token_count") { continue; }
            let Ok(j) = serde_json::from_str::<Value>(line) else { continue };
            let info = &j["payload"]["info"]["last_token_usage"];
            if !info.is_object() { continue; }
            let Some(ts) = j["timestamp"].as_str().and_then(parse_ts) else { continue };
            if (ts.timestamp_millis() as f64) < since_ms { continue; }
            let d = ts.format("%Y-%m-%d").to_string();
            let cached = info["cached_input_tokens"].as_i64().unwrap_or(0);
            bump(&d, "codex", "input", info["input_tokens"].as_i64().unwrap_or(0) - cached);
            bump(&d, "codex", "output", info["output_tokens"].as_i64().unwrap_or(0));
            bump(&d, "codex", "cache", cached);
        }
    }
    Value::Object(by_day)
}

// ---------- window ----------
/// Native Windows blur behind the window (Mica on Windows 11, Acrylic as a fallback).
// The window and taskbar icon, drawn by the page in the current accent and theme.
#[tauri::command]
fn set_app_icon(app: AppHandle, png: Vec<u8>) -> bool {
    let Some(w) = app.get_webview_window("main") else { return false };
    match tauri::image::Image::from_bytes(&png) {
        Ok(img) => w.set_icon(img).is_ok(),
        Err(_) => false,
    }
}

#[tauri::command]
fn set_backdrop(app: AppHandle, kind: String) -> bool {
    let Some(w) = app.get_webview_window("main") else { return false };
    #[cfg(windows)]
    {
        let _ = window_vibrancy::clear_mica(&w);
        let _ = window_vibrancy::clear_acrylic(&w);
        return match kind.as_str() {
            "mica" => window_vibrancy::apply_mica(&w, Some(true)).is_ok() || window_vibrancy::apply_acrylic(&w, Some((18, 15, 27, 160))).is_ok(),
            "acrylic" => window_vibrancy::apply_acrylic(&w, Some((18, 15, 27, 160))).is_ok(),
            _ => true,
        };
    }
    #[allow(unreachable_code)]
    { let _ = (w, kind); false }
}

/// Dev aid: prints a value from the page to the terminal that started Argon.
#[tauri::command]
fn dev_log(msg: String) {
    println!("{msg}");
}

/// Web engine switches. Tauri's defaults plus memory savers; see README for the measurements.
const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

pub fn run() {
    refresh_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(App::default())
        .invoke_handler(tauri::generate_handler![
            pty_spawn, pty_write, pty_resize, pty_kill, pty_alive,
            state_load, state_save, state_dir_path,
            pick_folder, shell_open, shell_reveal, app_home,
            agents_detect, agents_auth, git_info, git_action,
            fs_list, fs_read, fs_write, fs_exists,
            claude_context, dictate_win, usage_tokens, set_backdrop, set_app_icon, fs_changed, dev_log,
        ])
        .setup(|app| {
            // The window is built here (not in tauri.conf.json) so we can tune the web engine.
            let args = std::env::var("ARGON_WV_ARGS").unwrap_or_else(|_| WEBVIEW_ARGS.to_string());
            let w = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("Argon")
                .inner_size(1500.0, 920.0)
                .min_inner_size(900.0, 600.0)
                .decorations(false)
                .transparent(true)
                .disable_drag_drop_handler()
                .visible(false)
                .additional_browser_args(&args)
                .build()?;
            // Dev aid: ARGON_EVAL=<js> runs in the page after start; the page reports back via dev_log.
            if let Ok(js) = std::env::var("ARGON_EVAL") {
                let delay = std::env::var("ARGON_EVAL_DELAY").ok().and_then(|d| d.parse().ok()).unwrap_or(4000u64);
                let w2 = w.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(delay));
                    let wrapped = format!("(async () => {{ let r; try {{ r = await ({js}); }} catch (e) {{ r = 'failed: ' + e; }} window.__TAURI__.core.invoke('dev_log', {{ msg: '[eval] ' + JSON.stringify(r) }}); }})()");
                    let _ = w2.eval(&wrapped);
                });
            }
            w.show()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Argon")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Close every shell so no agent keeps running after Argon quits.
                let st = app.state::<App>();
                let mut ptys = st.ptys.lock().unwrap();
                for (_, mut p) in ptys.drain() { let _ = p.killer.kill(); }
            }
        });
}
