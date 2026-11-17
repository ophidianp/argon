"""Exports the Claude Code session transcript (the session Argon was made in) as assets/chat-log.json for the Transparency page.

    python tools/make_chatlog.py <session.jsonl>

Keeps only what was said in the chat: the user's own messages and the
assistant's text. Tool calls, tool output, hidden reminders and system notices
are dropped. Local file paths, the machine's LAN address, email addresses,
API keys and tokens, and the Windows account name are masked. Images the user
sent appear as a "sent a screenshot" tag.
"""
import json
import os
import re
import sys

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "chat-log.json")

TAGS = re.compile(r"<(system-reminder|local-command-caveat|local-command-stdout|command-name|command-message|command-args|ide_[a-z_]+|task-notification|side-sessions-event|ci-monitor-event|artifact-view-context|agent-message)\b[^>]*>.*?</\1>", re.S)
WRAP = re.compile(r"</?pasted_content[^>]*>|<artifact-content-authored-by-others/>")
IMG = re.compile(r"\[Image(?: #\d+)?(?:: [^\]]*)?\]")
SECRET = re.compile(
    r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}"
    r"|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b"
    r"|(?i:bearer\s+)[A-Za-z0-9._~+/=-]{20,}|\b[A-Fa-f0-9]{40,}\b")
PATH_WIN = re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s\"'`)\]]+(?:[\\/][^\s\"'`)\]]*)*")
PATH_MSYS = re.compile(r"/c/Users/[^/\s\"'`)\]]+(?:/[^\s\"'`)\]]*)*")
PATH_SLUG = re.compile(r"\bC--Users-[\w-]+")
IP = re.compile(r"(?<![\d.])(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3})(?![\d.])")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
ACCOUNT = re.compile(r"\bneman\w*", re.I)


def clean(t):
    t = TAGS.sub("", t)
    t = IMG.sub("", t)
    t = WRAP.sub("", t)
    t = SECRET.sub("[secret]", t)
    t = PATH_WIN.sub("[local path]", t)
    t = PATH_MSYS.sub("[local path]", t)
    t = PATH_SLUG.sub("[local path]", t)
    t = IP.sub("[local address]", t)
    t = EMAIL.sub("[email]", t)
    t = ACCOUNT.sub("[user]", t)
    return t.strip()


def model_key(m):
    m = m or ""
    if "opus" in m:
        return "opus"
    if "sonnet" in m:
        return "sonnet"
    if "fable" in m:
        return "fable"
    if "haiku" in m:
        return "haiku"
    return None


messages = []
for line in open(src, encoding="utf-8"):
    try:
        r = json.loads(line)
    except ValueError:
        continue
    kind = r.get("type")
    ts = r.get("timestamp") or ""

    if kind == "user":
        if r.get("isMeta") or r.get("isCompactSummary"):
            continue
        c = r["message"]["content"]
        text, img = "", False
        if isinstance(c, str):
            text = c
        else:
            if any(b.get("type") == "tool_result" for b in c):
                continue
            img = any(b.get("type") == "image" for b in c) or any("[Image" in b.get("text", "") for b in c if b.get("type") == "text")
            text = "\n".join(b.get("text", "") for b in c if b.get("type") == "text")
        if "This session is being continued from a previous conversation" in text:
            continue
        text = clean(text)
        if text.startswith("[Image:"):
            text = ""
        if text or img:
            messages.append({"r": "u", "t": text, "img": img, "ts": ts})

    elif kind == "attachment":
        a = r.get("attachment") or {}
        if a.get("type") == "queued_command" and (a.get("origin") or {}).get("kind") == "human":
            text = a.get("prompt")
            if isinstance(text, list):
                text = "\n".join(b.get("text", "") for b in text if isinstance(b, dict))
            text = clean(text or "")
            if text:
                messages.append({"r": "u", "t": text, "img": False, "ts": a.get("timestamp") or ts})

    elif kind == "assistant":
        m = r.get("message") or {}
        mk = model_key(m.get("model"))
        for b in m.get("content") or []:
            if b.get("type") == "text":
                text = clean(b.get("text", ""))
                if text and text != "No response requested.":
                    messages.append({"r": "a", "t": text, "m": mk, "ts": ts})

stats = {"user": sum(1 for m in messages if m["r"] == "u"),
         "assistant": sum(1 for m in messages if m["r"] == "a")}
for k in ("opus", "sonnet", "fable", "haiku"):
    stats[k] = sum(1 for m in messages if m.get("m") == k)
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump({"exported": messages[-1]["ts"] if messages else "", "stats": stats, "messages": messages},
          open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(stats, os.path.getsize(out) // 1024, "KB")
print("last user message:", [m for m in messages if m["r"] == "u"][-1]["t"][:120])
