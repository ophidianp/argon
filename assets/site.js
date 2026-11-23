/* Argon website: theme toggle, header, mobile menu, first-visit preloader, FAQ animation and
   the pinned feature stage on the home page. Loaded at the end of every page. */
(() => {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* theme toggle, remembered per viewer (the saved choice is applied in each page's head) */
  const theme = $("theme");
  if (theme) theme.addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    const go = () => { root.dataset.theme = next; };
    document.startViewTransition && !calm ? document.startViewTransition(go) : go();
    try { localStorage.setItem("argon-theme", next); } catch (e) {}
  });

  /* header: solid after a little scroll, always visible; menu on narrow screens */
  const hdr = $("hdr"), menu = $("menu");
  const setMenu = (open) => { hdr.classList.toggle("open", open); if (menu) menu.setAttribute("aria-expanded", String(open)); };
  if (menu) {
    menu.addEventListener("click", () => setMenu(!hdr.classList.contains("open")));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
    hdr.querySelectorAll(".nav a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
    addEventListener("resize", () => { if (innerWidth > 880) setMenu(false); });
  }

  /* pinned feature stage: steps light up as the section scrolls past */
  const tear = $("team"), stage = $("tstage");
  const steps = tear ? [...tear.querySelectorAll(".steps > li")] : [];
  const LBL = steps.map((s) => s.dataset.lbl);
  let cur = -1;
  const setStep = (n) => {
    if (n === cur) return; cur = n;
    steps.forEach((s, i) => s.classList.toggle("on", i === n));
    stage.dataset.s = n;
    $("tlbl").textContent = LBL[n];
  };
  steps.forEach((s, i) => s.addEventListener("click", (e) => {
    if (e.target.closest("a") || innerWidth <= 900) return;
    const max = tear.offsetHeight - innerHeight;
    scrollTo({ top: tear.offsetTop + max * (i + 0.5) / steps.length, behavior: calm ? "auto" : "smooth" });
  }));
  const onTear = () => {
    if (!tear) return;
    if (innerWidth <= 900) { setStep(cur < 0 ? 0 : cur); return; }
    const r = tear.getBoundingClientRect(), max = tear.offsetHeight - innerHeight;
    const p = Math.min(1, Math.max(0, -r.top / max));
    $("bar").style.width = p * 100 + "%";
    setStep(Math.min(steps.length - 1, Math.floor(p * steps.length)));
  };
  /* on phones the stage sits under the list: cycle it slowly instead */
  if (tear) setInterval(() => { if (innerWidth <= 900 && !calm) { const n = (cur + 1) % steps.length; cur = -1; setStep(n); } }, 2800);

  const onScroll = () => { hdr.classList.toggle("solid", scrollY > 10); onTear(); };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onTear);
  if (tear) setStep(0);
  onScroll();

  /* FAQ: slide each answer open and closed instead of snapping */
  document.querySelectorAll(".faq details").forEach((d) => {
    const ans = d.querySelector(":scope > :not(summary)");
    let anim = null;
    d.querySelector("summary").addEventListener("click", (e) => {
      if (!ans || calm) return;
      e.preventDefault();
      const opening = !d.open || d.classList.contains("closing");
      const from = d.open ? ans.offsetHeight : 0;
      if (anim) anim.cancel();
      d.open = true;
      d.classList.toggle("closing", !opening);
      const to = opening ? ans.scrollHeight : 0;
      anim = ans.animate([{ height: from + "px", opacity: opening ? 0 : 1 }, { height: to + "px", opacity: opening ? 1 : 0 }],
        { duration: opening ? 340 : 260, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
      anim.onfinish = () => { anim = null; if (!opening) { d.open = false; d.classList.remove("closing"); } };
    });
  });

  /* first-visit preloader: the logo fills in, then the page fades up */
  if (root.classList.contains("preload")) {
    let done = false;
    const finish = () => { if (done) return; done = true; root.classList.add("pre-done"); setTimeout(() => root.classList.remove("preload", "pre-done"), 650); };
    const go = () => setTimeout(finish, Math.max(0, 1350 - performance.now()));
    document.readyState === "complete" ? go() : addEventListener("load", go);
    setTimeout(finish, 4000);
  }
})();
