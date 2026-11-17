/* Transparency: read-only chat log loaded from assets/chat-log.json */
(() => {
  const chat = document.getElementById("chat");
  if (!chat) return;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (t) => esc(t)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[([^\]\n]+)\]\([^)\s]*\)/g, "$1");
  const render = (text) => text.split(/```[^\n]*\n?/).map((p, i) =>
    i % 2 ? "<pre><code>" + esc(p.replace(/\n$/, "")) + "</code></pre>" : inline(p.replace(/^\n+|\n+$/g, ""))).join("");
  const label = { opus: "Claude Opus 5.5", sonnet: "Claude Sonnet 5.5", fable: "Claude Fable 5.2" };
  const meta = document.getElementById("chat-meta");
  const jump = document.getElementById("chat-jump");
  const foot = document.getElementById("chat-foot");

  fetch("assets/chat-log.json")
    .then((r) => { if (!r.ok) throw new Error("missing"); return r.json(); })
    .then((d) => {
      const out = [];
      let lastWho = "", lastDay = "";
      d.messages.forEach((m) => {
        const day = (m.ts || "").slice(0, 10);
        if (day && day !== lastDay) {
          lastDay = day; lastWho = "";
          const dt = new Date(day + "T12:00:00");
          out.push('<div class="day">' + dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) + "</div>");
        }
        const who = m.r === "u" ? "me" : "them " + (m.m || "");
        if (who !== lastWho) {
          lastWho = who;
          out.push(m.r === "u"
            ? '<div class="who me">You</div>'
            : '<div class="who ' + (m.m || "") + '"><i></i>' + (label[m.m] || "Claude") + "</div>");
        }
        const tag = m.img ? '<span class="tag">Sent a screenshot</span>' + (m.t ? "<br>" : "") : "";
        out.push('<div class="bubble ' + (m.r === "u" ? "me" : "them") + '">' + tag + render(m.t) + "</div>");
      });
      chat.innerHTML = out.join("");
      const s = d.stats;
      meta.textContent = (s.user + s.assistant) + " messages · you " + s.user + " · Claude " + s.assistant;
      if (d.exported) foot.textContent = "Read-only copy of the session, exported " +
        new Date(d.exported).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) + ". Later messages are not included.";
      chat.scrollTop = chat.scrollHeight;
      let atEnd = true, queued = false;
      const sync = () => {
        queued = false;
        atEnd = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
        jump.textContent = atEnd ? "Jump to start" : "Jump to latest";
      };
      chat.addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(sync); } }, { passive: true });
      sync();
      jump.addEventListener("click", () => chat.scrollTo({ top: atEnd ? 0 : chat.scrollHeight, behavior: calm ? "auto" : "smooth" }));
    })
    .catch(() => {
      chat.innerHTML = '<p class="chat-empty">The chat log could not be loaded. Open this site from a web server, not a local file.</p>';
      meta.textContent = "Unavailable";
    });
})();
