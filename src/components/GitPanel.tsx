import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleArrowUp,
  CircleCheck,
  CircleAlert,
  GitBranch,
  History,
  RotateCw,
  Sparkle,
  X,
} from "lucide-react";
import { api, type GitInfo } from "../api";
import { project, useStore } from "../store";
import { GitHubMark } from "./icons";
import { BranchMenu, GitDrawer, type GitView } from "./GitDiff";

// The remote as a web page: git@github.com:owner/repo.git and https://github.com/owner/repo both work.
const webOf = (remote: string | null) => {
  const m = remote?.match(
    /^(?:[\w+]+:\/\/)?(?:[^@/]+@)?([^:/]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/,
  );
  return m
    ? {
        url: `https://${m[1]}/${m[2]}`,
        name: m[2],
        github: m[1] === "github.com",
      }
    : null;
};
// Cut in the middle so the owner's start and the repo name both stay readable.
const middle = (s: string, max = 26) =>
  s.length <= max ? s : `${s.slice(0, 10)}…${s.slice(-(max - 11))}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

const CHANGE_WORD: Record<string, string> = { M: "Edited", A: "New", U: "New", D: "Deleted", R: "Renamed", C: "Copied" };

export function GitPill() {
  const p = useStore(project)!;
  const [git, setGit] = useState<GitInfo | null | undefined>(undefined); // null: not a repository
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const loading = useRef(false);
  const load = () => {
    // A big repository can take longer than the interval: never two at once.
    if (loading.current) return;
    loading.current = true;
    api
      .git(p.path)
      .then(setGit)
      .catch(() => setGit(undefined))
      .finally(() => (loading.current = false));
  };
  useEffect(() => {
    load();
    const t = setInterval(() => !document.hidden && load(), 15_000);
    addEventListener("focus", load);
    return () => {
      clearInterval(t);
      removeEventListener("focus", load);
    };
  }, [p.path]);
  if (git === undefined) return null;
  // A folder without git still gets the pill: one click makes it a repository.
  if (git === null)
    return (
      <div style={{ position: "relative" }}>
        {open && (
          <div className="menu git-panel git-init nowheel">
            <div className="git-clean">
              <GitBranch size={16} color="var(--muted)" />
              <span>
                <div>This folder is not a git repository</div>
                <div className="git-dir">
                  Start one to save snapshots of the work and see every change.
                </div>
              </span>
            </div>
            {failed && <div className="git-foot bad">{failed}</div>}
            <button
              className="git-commit"
              onClick={() =>
                api
                  .gitAction("init", p.path)
                  .then(() => (setFailed(null), load()))
                  .catch((e) => setFailed((e as Error).message))
              }
            >
              <GitBranch size={15} /> Initialize git
            </button>
          </div>
        )}
        <button
          className="pill git-pill muted"
          onClick={() => setOpen((v) => !v)}
        >
          <GitBranch size={15} /> No git
        </button>
      </div>
    );
  const web = webOf(git.remote);
  return (
    <div style={{ position: "relative" }}>
      {open && (
        <GitPanel
          git={git}
          cwd={p.path}
          name={web?.name ?? p.name}
          web={web?.url}
          reload={load}
          onClose={() => setOpen(false)}
        />
      )}
      <button className="pill git-pill" onClick={() => setOpen((v) => !v)}>
        {web?.github ? <GitHubMark size={16} /> : <GitBranch size={15} />}{" "}
        {git.branch}{" "}
        {git.changes > 0 && <span className="n">{git.changes}</span>}
      </button>
    </div>
  );
}

// Commit and push in one go, without a terminal: tick the files, keep or write the message.
function GitPanel({
  git,
  cwd,
  name,
  web,
  reload,
  onClose,
}: {
  git: GitInfo;
  cwd: string;
  name: string;
  web?: string;
  reload: () => void;
  onClose: () => void;
}) {
  const [history, setHistory] = useState(false);
  const [skip, setSkip] = useState<Set<string>>(new Set()); // files left out of the next commit
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<
    null | "commit" | "push" | "pull" | "message"
  >(null);
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null);
  const [view, setView] = useState<GitView | null>(null);
  const [branches, setBranches] = useState(false);

  const picked = git.files.filter((f) => !skip.has(f.path));
  // Nothing unticked: commit everything, including files past the listed 200.
  const files = skip.size ? picked.map((f) => f.path) : undefined;
  const count = files?.length ?? git.changes;
  const placeholder = `Update ${plural(count, "file")}`;
  const sync = !git.remote
    ? "local only"
    : !git.upstream
      ? "only on this Mac"
      : git.ahead || git.behind
        ? [
            git.ahead && `${git.ahead} to upload`,
            git.behind && `${git.behind} to download`,
          ]
            .filter(Boolean)
            .join(" · ")
        : "up to date";

  const act = async (action: "push" | "pull", ok: string) => {
    setBusy(action);
    setDone(null);
    try {
      await api.gitAction(action, cwd);
      setDone({ ok: true, text: ok });
    } catch (e) {
      setDone({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
      reload();
    }
  };
  const write = async () => {
    setBusy("message");
    try {
      setMessage(
        (await api.gitAction("message", cwd, undefined, files)).message ?? "",
      );
    } catch (e) {
      setDone({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const commit = async () => {
    if (!count || busy) return;
    setBusy("commit");
    setDone(null);
    try {
      await api.gitAction("commit", cwd, message.trim() || placeholder, files);
      setMessage("");
      setSkip(new Set());
      let text = `Saved ${plural(count, "file")}`;
      if (git.remote) {
        setBusy("push");
        try {
          await api.gitAction("push", cwd);
          text += " and uploaded";
        } catch (e) {
          text += `, but the upload failed: ${(e as Error).message}`;
          return setDone({ ok: false, text });
        }
      }
      setDone({ ok: true, text });
    } catch (e) {
      setDone({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
      reload();
    }
  };
  const toggle = (p: string) =>
    setSkip((cur) => {
      const next = new Set(cur);
      if (!next.delete(p)) next.add(p);
      return next;
    });

  return (
    <>
      {view && (
        <GitDrawer
          cwd={cwd}
          view={view}
          onClose={() => setView(null)}
          onChanged={reload}
        />
      )}
      {branches && (
        <BranchMenu
          cwd={cwd}
          current={git.branch}
          onClose={() => setBranches(false)}
          onDone={(text, ok) => {
            setBranches(false);
            setDone({ ok, text });
            reload();
          }}
        />
      )}
      <div className="menu git-panel nowheel">
        <div className="git-head">
          <span className="gh-box">
            {web?.includes("github.com") ? (
              <GitHubMark size={20} />
            ) : (
              <GitBranch size={18} />
            )}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <div className="t">{middle(name)}</div>
            <div className="s">
              <button
                className="gh-branch"
                title="Switch or start a branch"
                onClick={() => setBranches((v) => !v)}
              >
                <GitBranch size={11} />{" "}
                <span className="mono">{git.branch}</span>{" "}
                <ChevronDown size={11} />
              </button>{" "}
              <span className="faint">{sync}</span>
            </div>
          </span>
          <button
            className={`round-btn sm ${history ? "on" : ""}`}
            title="All saved versions"
            onClick={() => setHistory((v) => !v)}
          >
            <History size={15} />
          </button>
          {web && (
            <a
              className="round-btn sm"
              title="Open on the web"
              href={web}
              target="_blank"
              rel="noreferrer"
            >
              <ArrowUpRight size={15} />
            </a>
          )}
          <button className="round-btn sm" title="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {history ? (
          <div className="git-scroll">
            <div className="git-sec">
              Saved versions <span className="n">{git.commits.length}</span>
            </div>
            {git.commits.map((c) => (
              <button
                className="commit"
                key={c.hash}
                onClick={() => setView({ kind: "commit", hash: c.hash })}
              >
                <span className="bullet" />
                <span className="subject">{c.subject}</span>
                <span className="when">{c.when}</span>
                <span className="meta">
                  <span className="hash">{c.hash}</span> {c.author}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="git-sec">
              {git.changes ? `${plural(git.changes, "changed file")}` : "Changes"}
              {git.changes > 0 && (
                <>
                  <span className="spacer" />
                  <button
                    className="link"
                    onClick={() =>
                      setSkip(
                        skip.size
                          ? new Set()
                          : new Set(git.files.map((f) => f.path)),
                      )
                    }
                  >
                    {skip.size ? "Select all" : "Select none"}
                  </button>
                </>
              )}
            </div>
            {git.changes ? (
              <div className="git-scroll git-files">
                {git.files.map((f) => {
                  const slash = f.path.lastIndexOf("/");
                  const code = f.code === "??" ? "U" : f.code[0];
                  return (
                    <div
                      key={f.path}
                      className={`git-file ${view?.kind === "file" && view.path === f.path ? "open" : ""}`}
                      title={f.orig ? `${f.orig} → ${f.path}` : f.path}
                    >
                      <button
                        className={`git-check ${skip.has(f.path) ? "" : "on"}`}
                        title={
                          skip.has(f.path)
                            ? "Include in the commit"
                            : "Leave out of the commit"
                        }
                        onClick={() => toggle(f.path)}
                      >
                        {!skip.has(f.path) && (
                          <Check size={11} strokeWidth={3.5} />
                        )}
                      </button>
                      <button
                        className="git-open"
                        title="See what changed"
                        onClick={() => setView({ kind: "file", path: f.path })}
                      >
                        <span className="git-where">
                          <span className="git-name">
                            {f.path.slice(slash + 1)}
                          </span>
                          {slash > 0 && (
                            <span className="git-dir">
                              {f.path.slice(0, slash)}
                            </span>
                          )}
                        </span>
                        <span
                          className={`git-word c-${code}`}
                          title={`${f.add} lines added, ${f.del} removed`}
                        >
                          {CHANGE_WORD[code] ?? "Changed"}
                        </span>
                      </button>
                    </div>
                  );
                })}
                {git.changes > git.files.length && (
                  <div className="git-dir" style={{ padding: "4px 0 0 52px" }}>
                    and {git.changes - git.files.length} more, committed with
                    the rest
                  </div>
                )}
              </div>
            ) : (
              <div className="git-clean">
                <CircleCheck size={16} color="var(--done)" />
                <span>
                  <div>Everything is saved</div>
                  <div className="git-dir">Nothing new since the last version.</div>
                </span>
              </div>
            )}
            {git.changes > 0 && (
              <div className="git-compose">
                <div className="git-msg">
                  <input
                    placeholder={`What changed? (${placeholder})`}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && commit()}
                  />
                  <button
                    title="Let your agent write it"
                    disabled={!!busy || !count}
                    onClick={write}
                  >
                    <Sparkle
                      size={15}
                      className={busy === "message" ? "spin" : ""}
                    />
                  </button>
                </div>
                <button
                  className="git-commit"
                  title={git.remote ? "git commit and push" : "git commit"}
                  disabled={!!busy || !count}
                  onClick={commit}
                >
                  {busy === "commit" || busy === "push" ? (
                    <RotateCw size={15} className="spin" />
                  ) : (
                    <CircleArrowUp
                      size={17}
                      fill="#fff"
                      color="var(--accent)"
                    />
                  )}
                  {busy === "commit"
                    ? "Saving…"
                    : busy === "push"
                      ? "Uploading…"
                      : `${git.remote ? "Save and upload" : "Save"} ${plural(count, "file")}`}
                </button>
              </div>
            )}
            {git.remote &&
              (git.behind > 0 ||
                (git.changes === 0 &&
                  (git.ahead > 0 ||
                    (!git.upstream && git.commits.length > 0)))) && (
                <div className="git-syncrow">
                  {git.behind > 0 && (
                    <button
                      className="btn"
                      disabled={!!busy}
                      onClick={() => act("pull", "Downloaded the latest")}
                      title="Get the latest from the remote (only when it does not need a merge)"
                    >
                      <ArrowDown size={14} />{" "}
                      {busy === "pull" ? "Downloading…" : `Download ${git.behind} new`}
                    </button>
                  )}
                  {git.changes === 0 && (git.ahead > 0 || !git.upstream) && (
                    <button
                      className="btn"
                      disabled={!!busy}
                      onClick={() => act("push", "Uploaded")}
                    >
                      <ArrowUp size={14} />{" "}
                      {busy === "push"
                        ? "Uploading…"
                        : git.upstream
                          ? `Upload ${git.ahead}`
                          : "Upload this branch"}
                    </button>
                  )}
                </div>
              )}
            {git.commits.length > 0 && (
              <>
                <div className="git-sec">Last saved</div>
                {git.commits.slice(0, 3).map((c) => (
                  <button
                    className="git-recent"
                    key={c.hash}
                    onClick={() => setView({ kind: "commit", hash: c.hash })}
                  >
                    <span className="bullet" />
                    <span className="subject">{c.subject}</span>
                    <span className="when">{c.when}</span>
                  </button>
                ))}
              </>
            )}
          </>
        )}
        {done && (
          <div className={`git-foot ${done.ok ? "" : "bad"}`}>
            {done.ok ? (
              <CircleCheck size={15} color="var(--done)" />
            ) : (
              <CircleAlert size={15} color="var(--accent)" />
            )}
            <span>{done.text}</span>
          </div>
        )}
      </div>
    </>
  );
}
