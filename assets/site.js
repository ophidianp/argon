const root = document.documentElement;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? Math.min(ms, 60) : ms));

/* ---------- Accent (personalization, shared with the "Make it yours" demo) ---------- */
const ACCENTS = [
  ["Lavender", "#9a83d4"], ["Orchid", "#c07ad0"], ["Rose", "#e0889f"], ["Coral", "#e8957a"],
  ["Amber", "#e2b15a"], ["Mint", "#6fcfa3"], ["Teal", "#5cc2c2"], ["Sky", "#7ea8ec"],
];
function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100, [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]];
}
const hsl = (h, s, l) => `hsl(${h.toFixed(1)} ${Math.min(100, Math.max(0, s)).toFixed(1)}% ${Math.min(96, Math.max(4, l)).toFixed(1)}%)`;
function accentVars(hex) {
  const [h, s, l, [r, g, b]] = hexToHsl(hex);
  const rgba = (a) => `rgba(${r}, ${g}, ${b}, ${a})`;
  return {
    dark: { "--accent": hex, "--accent-2": hsl(h, s, l + 16), "--accent-ink": hsl(h, s * 0.6, 8), "--accent-soft": rgba(0.13), "--glow": rgba(0.4) },
    light: { "--accent": hsl(h, s * 0.85, Math.min(l, 50) - 4), "--accent-2": hsl(h, s, l), "--accent-ink": "#ffffff", "--accent-soft": rgba(0.1), "--glow": rgba(0.25) },
  };
}
let accentHex = store.get("argon-accent") || "#f0553a"; // Ember, the app's default
function applyAccent() {
  const vars = accentVars(accentHex)[root.dataset.theme === "light" ? "light" : "dark"];
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
function setAccent(hex) {
  accentHex = hex;
  store.set("argon-accent", hex);
  store.set("argon-accent-vars", JSON.stringify(accentVars(hex)));
  applyAccent();
  window.dispatchEvent(new Event("argon:accent"));
}

/* ---------- Theme ---------- */
const themeToggle = document.querySelector(".theme-toggle");
const themeMeta = document.querySelector('meta[name="theme-color"]');
function setTheme(theme, persist = false) {
  const isDark = theme !== "light";
  root.dataset.theme = isDark ? "dark" : "light";
  themeToggle?.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
  if (themeMeta) themeMeta.content = isDark ? "#0a0908" : "#f5f1ea";
  if (persist) store.set("argon-theme", root.dataset.theme);
  applyAccent();
  window.dispatchEvent(new Event("argon:theme"));
}
// A saved choice wins; otherwise keep whatever the page (or the host showing it) already set.
const savedTheme = store.get("argon-theme");
setTheme(savedTheme === "light" || savedTheme === "dark" ? savedTheme : root.dataset.theme === "light" ? "light" : "dark");
themeToggle?.addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  if (document.startViewTransition && !reduceMotion) document.startViewTransition(() => setTheme(next, true));
  else setTheme(next, true);
});

/* ---------- Mobile menu ---------- */
const menuToggle = document.querySelector(".menu-toggle");
const siteNav = document.querySelector(".site-nav");
menuToggle?.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(open));
  siteNav.classList.toggle("is-open", open);
});

/* ---------- Nav pill that glides between links ---------- */
if (siteNav) {
  const pill = document.createElement("span");
  pill.className = "nav-pill";
  siteNav.prepend(pill);
  const current = siteNav.querySelector('[aria-current="page"]');
  const moveTo = (link) => {
    if (!link) { pill.style.opacity = "0"; return; }
    pill.style.opacity = "1";
    pill.style.width = `${link.offsetWidth}px`;
    pill.style.transform = `translateX(${link.offsetLeft}px)`;
  };
  siteNav.querySelectorAll("a").forEach((link) => link.addEventListener("pointerenter", () => moveTo(link)));
  siteNav.addEventListener("pointerleave", () => moveTo(current));
  requestAnimationFrame(() => moveTo(current));
  window.addEventListener("resize", () => moveTo(current));
}

/* ---------- Scroll progress + header state ---------- */
const header = document.querySelector(".site-header");
const progress = document.querySelector(".scroll-progress");
let scrollQueued = false;
function onScroll() {
  scrollQueued = false;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  progress?.style.setProperty("--progress", max > 0 ? (window.scrollY / max).toFixed(4) : 0);
  header?.classList.toggle("is-scrolled", window.scrollY > 20);
}
window.addEventListener("scroll", () => { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(onScroll); } }, { passive: true });
onScroll();

/* ---------- Split headlines into words for the mask reveal ---------- */
document.querySelectorAll(".split").forEach((heading) => {
  let index = 0;
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const fragment = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { fragment.append(part); return; }
          const outer = document.createElement("span");
          outer.className = "w";
          const inner = document.createElement("span");
          inner.textContent = part;
          if (node.classList.contains("grad")) inner.className = "grad";
          inner.style.setProperty("--i", index++);
          outer.append(inner);
          fragment.append(outer);
        });
        child.replaceWith(fragment);
      } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== "BR") {
        walk(child);
      }
    });
  };
  walk(heading);
  heading.querySelectorAll(".grad:not(.w > .grad)").forEach((element) => element.classList.remove("grad"));
});

/* ---------- Scroll reveal (with stagger for [data-stagger] children) ---------- */
document.querySelectorAll("[data-stagger]").forEach((group) => {
  [...group.children].forEach((child, i) => { child.classList.add("reveal"); child.style.setProperty("--d", `${i * 110}ms`); });
});
document.querySelectorAll("[data-reveal]").forEach((element) => element.classList.add("reveal"));
const revealTargets = document.querySelectorAll(".reveal, .split, .steps");
if (reduceMotion || !("IntersectionObserver" in window)) {
  revealTargets.forEach((element) => element.classList.add("in"));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("in"); observer.unobserve(entry.target); } });
  }, { threshold: 0.14, rootMargin: "0px 0px -6% 0px" });
  revealTargets.forEach((element) => observer.observe(element));
}

/* ---------- Pointer effects: card spotlight + magnetic buttons ---------- */
const finePointer = window.matchMedia("(pointer: fine)").matches;
if (finePointer && !reduceMotion) {
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    });
  });
  document.querySelectorAll(".btn-primary, .btn-ghost").forEach((button) => {
    button.addEventListener("pointermove", (event) => {
      const rect = button.getBoundingClientRect();
      button.style.setProperty("--bx", `${(event.clientX - rect.left - rect.width / 2) * 0.18}px`);
      button.style.setProperty("--by", `${(event.clientY - rect.top - rect.height / 2) * 0.28}px`);
    });
    button.addEventListener("pointerleave", () => { button.style.setProperty("--bx", "0px"); button.style.setProperty("--by", "0px"); });
  });
}

/* ---------- Features page table of contents ---------- */
const tocLinks = [...document.querySelectorAll(".toc a")];
if (tocLinks.length && "IntersectionObserver" in window) {
  const sections = tocLinks.map((link) => document.querySelector(link.getAttribute("href")));
  const tocObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) tocLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`));
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  sections.forEach((section) => section && tocObserver.observe(section));
}

/* ---------- Demo lab tabs ---------- */
document.querySelectorAll(".lab").forEach((lab) => {
  const tabs = [...lab.querySelectorAll(".lab-tab")];
  const select = (tab, focus = false) => {
    tabs.forEach((other) => {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
      document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
    });
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      select(tabs[(i + step + tabs.length) % tabs.length], true);
    });
  });
});

/* =================================================================
   Mini Argon: tiles, statuses and typed output used by the demos
   ================================================================= */
const AGENT_COLORS = { "Claude Code": "#d9a07a", Codex: "#8fd1c0", "Gemini CLI": "#7fa8f0", Terminal: "#8f86a8" };
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function makeTile(parent, { name, agent, x, y, w, h }) {
  const t = el("div", "mtile");
  Object.assign(t.style, { left: x, top: y, width: w, height: h });
  const color = AGENT_COLORS[agent] || "#f0553a";
  t.innerHTML = `<div class="mtile-head"><span class="dot resting"></span><span>${esc(name)}</span><span class="badge" style="color:${color}">${esc(agent)}</span></div><div class="mtile-body"></div>`;
  parent.append(t);
  const body = t.querySelector(".mtile-body");
  const dot = t.querySelector(".dot");
  const api = {
    el: t, name,
    status: "resting",
    set(st) { api.status = st; dot.className = "dot " + st; t.classList.toggle("needs", st === "needs"); api.onStatus && api.onStatus(st); },
    line(text, cls = "") {
      const l = el("div", cls, esc(text));
      body.append(l);
      while (body.children.length > 18) body.firstChild.remove();
      return l;
    },
    async type(text, cls = "", speed = 14) {
      const l = api.line("", cls);
      if (reduceMotion) { l.textContent = text; return; }
      for (let i = 1; i <= text.length; i++) { l.textContent = text.slice(0, i); await sleep(speed); }
    },
    clear() { body.innerHTML = ""; },
  };
  return api;
}

function onVisible(node, fn) {
  if (!("IntersectionObserver" in window)) { fn(true); return; }
  new IntersectionObserver(([e]) => fn(e.isIntersecting), { threshold: 0.15 }).observe(node);
}

/* ---------- Hero: a live Argon board ---------- */
const hero = document.querySelector("[data-hero-board]");
if (hero) {
  const board = hero.querySelector(".mock-board");
  const tiles = [
    makeTile(board, { name: "claude-1", agent: "Claude Code", x: "4%", y: "6%", w: "47%", h: "52%" }),
    makeTile(board, { name: "codex-1", agent: "Codex", x: "4%", y: "62%", w: "34%", h: "33%" }),
    makeTile(board, { name: "gemini-1", agent: "Gemini CLI", x: "40%", y: "62%", w: "33%", h: "33%" }),
  ];
  const note = el("div", "mnote", "<b>Today</b>Ship the onboarding flow");
  Object.assign(note.style, { left: "54%", top: "8%", width: "19%" });
  board.append(note);
  const map = el("div", "mmap", "<h4>Mission map</h4>");
  board.append(map);
  const rows = tiles.map((t) => {
    const r = el("div", "mmap-row", `<span class="dot resting"></span><div>${t.name}<small>Resting</small></div>`);
    map.append(r);
    return r;
  });
  const fpsW = document.querySelector("[data-hero-working]");
  const fpsN = document.querySelector("[data-hero-needs]");
  const LABEL = { working: "Working", resting: "Resting", needs: "Needs you" };
  const refresh = () => {
    tiles.forEach((t, i) => {
      rows[i].className = "mmap-row" + (t.status === "needs" ? " needs" : "");
      rows[i].innerHTML = `<span class="dot ${t.status}"></span><div>${t.name}<small>${LABEL[t.status]}</small></div>`;
    });
    if (fpsW) fpsW.textContent = `${tiles.filter((t) => t.status === "working").length} of 3`;
    if (fpsN) fpsN.textContent = String(tiles.filter((t) => t.status === "needs").length);
  };
  tiles.forEach((t) => { t.onStatus = refresh; });

  let running = false, visible = true;
  onVisible(hero, (v) => { visible = v; if (v && !running) loop(); });
  const waitVisible = async () => { while (!visible || document.hidden) await sleep(400); };

  const scripts = [
    async (t) => {
      t.set("working");
      await t.type("> build the onboarding flow", "p");
      await t.type("Reading src/onboarding/…", "dim", 10);
      await t.type("Plan: 3 screens, progress bar, skip", "", 10);
      await t.type("Editing Welcome.tsx  +42 −3", "ok", 10);
      await t.type("Allow edit to src/App.tsx? (y/n)", "warn", 12);
      t.set("needs");
      await sleep(2600);
      await t.type("y", "p", 40);
      t.set("working");
      await t.type("Editing App.tsx  +8 −1", "ok", 10);
      await t.type("✓ Onboarding flow ready", "ok", 12);
      t.set("resting");
    },
    async (t) => {
      await sleep(900);
      t.set("working");
      await t.type("> write tests for auth", "p");
      await t.type("Running npm test…", "dim", 10);
      await t.type("✗ 2 failing", "warn", 10);
      await t.type("Fixing token refresh…", "", 10);
      await t.type("✓ 24 passing", "ok", 10);
      t.set("resting");
    },
    async (t) => {
      await sleep(1700);
      t.set("working");
      await t.type("> review the open PR", "p");
      await t.type("Reading 6 changed files…", "dim", 10);
      await t.type("2 suggestions, 0 blockers", "", 10);
      await t.type("✓ Review posted", "ok", 10);
      t.set("resting");
    },
  ];
  async function loop() {
    running = true;
    for (;;) {
      await waitVisible();
      await Promise.all(tiles.map((t, i) => scripts[i](t)));
      await sleep(3200);
      await waitVisible();
      tiles.forEach((t) => t.clear());
    }
  }
}

/* ---------- Demo: command bar ---------- */
function demoCommand(host) {
  host.innerHTML = `<div class="demo">
    <div class="demo-head"><div><div class="demo-title">Tell your agents what to do</div><p class="demo-sub">Pick who to send to, type, press Enter. Same as Ctrl+K in Argon.</p></div></div>
    <div class="demo-stage"></div>
    <div class="demo-foot">
      <div class="chipset" role="group" aria-label="Send to"></div>
      <form class="field-inline"><span class="p">›_</span><input type="text" aria-label="Message" value="Add a dark mode toggle" autocomplete="off"><button class="btn btn-primary btn-sm" type="submit">Send <span class="arrow" aria-hidden="true">↵</span></button></form>
    </div></div>`;
  const stage = host.querySelector(".demo-stage");
  const tiles = [
    makeTile(stage, { name: "claude-1", agent: "Claude Code", x: "3%", y: "6%", w: "45%", h: "54%" }),
    makeTile(stage, { name: "codex-1", agent: "Codex", x: "51%", y: "6%", w: "46%", h: "54%" }),
    makeTile(stage, { name: "gemini-1", agent: "Gemini CLI", x: "27%", y: "64%", w: "46%", h: "31%" }),
  ];
  tiles.forEach((t) => { t.line("Ready.", "dim"); });
  const chips = host.querySelector(".chipset");
  const picked = new Set(tiles.map((t) => t.name));
  const opts = [["@all", tiles.map((t) => t.name)], ["#frontend", ["claude-1", "codex-1"]], ...tiles.map((t) => ["@" + t.name, [t.name]])];
  const render = () => {
    chips.innerHTML = "";
    for (const [label, names] of opts) {
      const on = names.every((n) => picked.has(n)) && (label === "@all" || names.length !== tiles.length);
      const b = el("button", "chipbtn", label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(label === "@all" ? picked.size === tiles.length : on && picked.size === names.length));
      b.onclick = () => { picked.clear(); names.forEach((n) => picked.add(n)); render(); };
      chips.append(b);
    }
  };
  render();
  const replies = [
    ["Reading the theme setup…", "Adding a toggle to the header", "Editing Header.tsx  +18 −2", "✓ Done"],
    ["Searching for CSS variables…", "Writing dark palette", "Editing theme.css  +31", "✓ Done"],
    ["Checking contrast ratios…", "All text passes 4.5:1", "✓ Done"],
  ];
  host.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = host.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    tiles.forEach((t, i) => {
      if (!picked.has(t.name)) return;
      (async () => {
        t.set("working");
        await t.type("> " + text, "p", 10);
        for (const r of replies[i]) { await sleep(380); await t.type(r, r.startsWith("✓") ? "ok" : r.startsWith("Editing") ? "ok" : "dim", 9); }
        t.set("resting");
      })();
    });
  });
}

/* ---------- Demo: loops ---------- */
function demoLoop(host) {
  host.innerHTML = `<div class="demo">
    <div class="demo-head"><div><div class="demo-title">Loops that stop themselves</div><p class="demo-sub">Argon re-sends the prompt each time the agent goes idle, and retires the loop when the goal phrase appears.</p></div></div>
    <div class="demo-stage"></div>
    <div class="demo-foot">
      <button class="btn btn-primary btn-sm" type="button" data-start>Start loop <span class="arrow" aria-hidden="true">↻</span></button>
      <div class="stats"><div class="stat">Runs<b data-runs>0</b></div><div class="stat">Failing tests<b data-fail>5</b></div><div class="stat">Loop<b data-state>Off</b></div></div>
    </div></div>`;
  const stage = host.querySelector(".demo-stage");
  const t = makeTile(stage, { name: "claude-1", agent: "Claude Code", x: "4%", y: "7%", w: "62%", h: "86%" });
  const card = el("div", "mnote", "<b>Loop · claude-1</b>When idle, send:<br><i>“Run the tests and fix the first failure. Say ALL GREEN when every test passes.”</i><br><br>Stop when output says <b style='display:inline'>ALL GREEN</b>");
  Object.assign(card.style, { left: "69%", top: "7%", width: "27%" });
  stage.append(card);
  t.line("Loop is off.", "dim");
  const runsEl = host.querySelector("[data-runs]"), failEl = host.querySelector("[data-fail]"), stateEl = host.querySelector("[data-state]"), btn = host.querySelector("[data-start]");
  let busy = false;
  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true; btn.disabled = true;
    t.clear();
    let fail = 5, runs = 0;
    failEl.textContent = fail; failEl.className = "warn"; stateEl.textContent = "Running"; stateEl.className = "";
    while (fail > 0) {
      runs++; runsEl.textContent = runs;
      t.set("working");
      await t.type("> Run the tests and fix the first failure…", "p", 6);
      await t.type(`✗ ${fail} failing`, "warn", 8);
      fail = Math.max(0, fail - (fail > 2 ? 2 : 1));
      await t.type(`Fixed. ${fail ? fail + " left" : "Re-running…"}`, "dim", 8);
      if (!fail) await t.type("✓ ALL GREEN", "ok", 14);
      failEl.textContent = fail; failEl.className = fail ? "warn" : "good";
      t.set("resting");
      await sleep(fail ? 900 : 300);
      if (fail) t.line("(idle → loop sends the prompt again)", "dim");
    }
    stateEl.textContent = "Goal met"; stateEl.className = "good";
    t.line("Loop retired: goal phrase found.", "dim");
    busy = false; btn.disabled = false; btn.innerHTML = 'Run again <span class="arrow" aria-hidden="true">↻</span>';
  });
}

/* ---------- Demo: handoff ---------- */
function demoHandoff(host) {
  host.innerHTML = `<div class="demo">
    <div class="demo-head"><div><div class="demo-title">Hand work to a fresh agent</div><p class="demo-sub">The outgoing agent writes a brief; the next one reads it and carries on.</p></div></div>
    <div class="demo-stage"></div>
    <div class="demo-foot">
      <button class="btn btn-primary btn-sm" type="button" data-go>Hand off claude-1 → codex-1 <span class="arrow" aria-hidden="true">→</span></button>
      <div class="stats"><div class="stat">Step<b data-step>Ready</b></div></div>
    </div></div>`;
  const stage = host.querySelector(".demo-stage");
  const a = makeTile(stage, { name: "claude-1", agent: "Claude Code", x: "3%", y: "8%", w: "44%", h: "84%" });
  const b = makeTile(stage, { name: "codex-1", agent: "Codex", x: "53%", y: "8%", w: "44%", h: "84%" });
  const seed = () => { a.clear(); b.clear(); a.line("> migrate the API to v2", "p"); a.line("Moved 14 of 22 routes", "ok"); a.line("Context window: 92% used", "warn"); b.line("Ready.", "dim"); };
  seed();
  const file = el("div", "mnote", "<b>.argon/handoffs</b>claude-1.md");
  Object.assign(file.style, { left: "30%", top: "40%", width: "auto", opacity: "0", transition: "left 1.4s cubic-bezier(.16,1,.3,1), opacity .5s" });
  stage.append(file);
  const step = host.querySelector("[data-step]"), btn = host.querySelector("[data-go]");
  let busy = false;
  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true; btn.disabled = true;
    seed();
    step.textContent = "Writing brief";
    a.set("working");
    await a.type("> write a handoff brief to .argon/handoffs/", "p", 8);
    await a.type("Goal, done, left, key files, gotchas", "dim", 8);
    await a.type("✓ Saved claude-1.md", "ok", 10);
    a.set("resting");
    file.style.left = "30%"; file.style.opacity = "1";
    await sleep(300);
    step.textContent = "Passing it on";
    file.style.left = "58%";
    await sleep(1400);
    file.style.opacity = "0";
    step.textContent = "Carrying on";
    b.set("working");
    await b.type("> read .argon/handoffs/claude-1.md and continue", "p", 8);
    await b.type("Picking up at route 15 of 22", "dim", 8);
    await b.type("Moved 22 of 22 routes", "ok", 8);
    await b.type("✓ Migration finished", "ok", 10);
    b.set("resting");
    step.textContent = "Done"; step.className = "good";
    busy = false; btn.disabled = false;
  });
}

/* ---------- Demo: make it yours ---------- */
function demoTheme(host) {
  host.innerHTML = `<div class="demo">
    <div class="demo-head"><div><div class="demo-title">Make it yours</div><p class="demo-sub">Pick an accent: this whole website changes with it, just like Argon does. Your pick is remembered.</p></div></div>
    <div class="demo-stage" style="display:grid;place-items:center"><div class="mock" style="width:86%"><div class="mock-top"><img class="logo" src="assets/argon-icon.svg" alt=""><b>argon</b><span class="mock-tab on"><i></i>my-app</span><span class="mock-cmd">Tell your agents…</span></div><div class="mock-board" style="height:200px"></div></div></div>
    <div class="demo-foot">
      <div class="swatches" role="group" aria-label="Accent color"></div>
      <div class="seg" role="group" aria-label="Mode"><button type="button" data-mode="dark">Dark</button><button type="button" data-mode="light">Light</button></div>
      <label class="ab-ctl"><span>Chromatic aberration</span><input type="range" min="0" max="100" step="1" aria-label="Chromatic aberration"><b></b></label>
    </div></div>`;
  const board = host.querySelector(".mock-board");
  const t1 = makeTile(board, { name: "claude-1", agent: "Claude Code", x: "4%", y: "10%", w: "50%", h: "80%" });
  t1.set("working"); t1.line("> polish the settings page", "p"); t1.line("Editing Settings.tsx  +12", "ok");
  const n = el("div", "mnote", "<b>Note</b>Accent looks good");
  Object.assign(n.style, { left: "60%", top: "14%", width: "30%" });
  board.append(n);
  const sw = host.querySelector(".swatches");
  const paint = () => {
    sw.querySelectorAll(".swatch").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hex === accentHex)));
    host.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === root.dataset.theme)));
  };
  for (const [name, hex] of ACCENTS) {
    const b = el("button", "swatch");
    b.type = "button"; b.dataset.hex = hex; b.title = name; b.setAttribute("aria-label", name); b.style.background = hex;
    b.onclick = () => { setAccent(hex); paint(); };
    sw.append(b);
  }
  host.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { setTheme(b.dataset.mode, true); paint(); }));
  window.addEventListener("argon:theme", paint);
  paint();
  // chromatic aberration slider (drives the glass on the whole site)
  const ab = host.querySelector(".ab-ctl input"), abv = host.querySelector(".ab-ctl b");
  let saved = 25;
  try { const v = localStorage.getItem("argon-ab"); if (v !== null && !isNaN(+v)) saved = +v; } catch (_) {}
  const showAb = () => { abv.textContent = ab.value + "%"; ab.style.setProperty("--pct", ab.value + "%"); };
  ab.value = saved; showAb();
  ab.addEventListener("input", () => { showAb(); window.dispatchEvent(new CustomEvent("argon:ab", { detail: +ab.value })); });
  ab.addEventListener("change", () => { try { localStorage.setItem("argon-ab", ab.value); } catch (_) {} });
}

const DEMOS = { command: demoCommand, loop: demoLoop, handoff: demoHandoff, theme: demoTheme };
document.querySelectorAll("[data-demo]").forEach((host) => DEMOS[host.dataset.demo]?.(host));

/* ---------- Launch video: plays muted while on screen; the button turns sound on and off ---------- */
document.querySelectorAll("[data-launch-video]").forEach((video) => {
  const btn = video.parentElement.querySelector("[data-video-sound]");
  const label = btn?.querySelector("[data-sound-label]");
  const sync = () => {
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(!video.muted));
    label.textContent = video.muted ? "Sound off" : "Sound on";
    btn.querySelector("[data-icon-off]").toggleAttribute("hidden", !video.muted);
    btn.querySelector("[data-icon-on]").toggleAttribute("hidden", video.muted);
  };
  btn?.addEventListener("click", () => {
    video.muted = !video.muted;
    if (!video.muted && video.paused) video.play().catch(() => {});
    sync();
  });
  // Click the picture to pause or play.
  video.addEventListener("click", () => (video.paused ? video.play().catch(() => {}) : video.pause()));
  // With reduced motion it waits for a click; otherwise it plays only while in view.
  if (!reduceMotion && "IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting) video.play().catch(() => {});
      else video.pause();
    }, { threshold: 0.35 }).observe(video);
  }
  sync();
});

/* ---------- Liquid glass: refraction + chromatic aberration (Chromium), glare, gliding lens (assets/liquid-glass.js) ---------- */
(() => {
  const LG = window.LiquidGlass;
  if (!LG) return;
  if (LG.chromium) root.dataset.lens = "1";
  // Strongest glass first: only the first 25 get the lens filter, the rest stay blur-only (keeps the GPU cool).
  const tiers = [
    [".site-header, .mock-top, .mmap, .hero-readout", 70],
    [".demo, .release-panel", 55],
    [".card, .platform, .fact", 50],
    [".btn-ghost, .video-sound, .seg, .chipbtn, .theme-toggle, .menu-toggle, .copy-btn, .field-inline", 44],
  ];
  for (const [sel, s] of tiers) document.querySelectorAll(sel).forEach((el) => LG.glassify(el, s));
  document.querySelectorAll(".mock").forEach((el) => LG.glassify(el, 0));
  LG.init({ max: 25 });
  document.querySelectorAll(".seg").forEach((c) => LG.attachLens(c, "button"));
  document.querySelectorAll(".lab-tabs").forEach((c) => LG.attachLens(c, ".lab-tab"));
  let abT = 0;
  window.addEventListener("argon:ab", (e) => { cancelAnimationFrame(abT); abT = requestAnimationFrame(() => LG.setAberration(e.detail)); });
  // phone menu grows out of its button
  menuToggle?.addEventListener("click", () => { if (siteNav?.classList.contains("is-open")) LG.morphFrom(menuToggle, siteNav, 520); });
})();
