import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, a[:70]
    s = s.replace(a, b)
# Dots keep streaming along every wire: slow when idle, quick and bright while work moves.
rep("""  (function hLoop() { if (hw.length) paintWires(); requestAnimationFrame(hLoop); })();""", """  (function hLoop() { if (hw.length) paintWires(); requestAnimationFrame(hLoop); })();
  const fdots = new Map(), calm = matchMedia('(prefers-reduced-motion: reduce)');
  (function flowLoop(now) {
    const live = new Set();
    const run = (p, host, color, rev, active) => {
      if (!p || !p.isConnected) return; const len = p.getTotalLength(); if (len < 40) return;
      live.add(p); const n = Math.max(2, Math.round(len / 110)); let ds = fdots.get(p);
      if (!ds || ds.length !== n) { ds && ds.forEach((c) => c.remove()); ds = Array.from({ length: n }, () => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('class', 'fdot'); host.append(c); return c; }); fdots.set(p, ds); }
      const sp = active ? 170 : 46, gap = len / n, base = (now / 1000) * sp;
      ds.forEach((c, i) => { const k = ((base + i * gap) % len) / len, at = rev ? 1 - k : k, pt = p.getPointAtLength(len * at); c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y); c.setAttribute('r', active ? 3.4 : 2.4); c.style.setProperty('--pc', color || 'var(--accent-light)'); c.style.opacity = (Math.sin(Math.PI * k) * (active ? 1 : .55)).toFixed(3); });
    };
    if (L.anim && !calm.matches) {
      if (mode === 'board') {
        mwires.querySelectorAll('path[data-k]').forEach((p) => run(p, mwires, p.style.getPropertyValue('--wc'), true, p.classList.contains('flow')));
        hw.forEach((w) => { if (!w.paused) run(w.p, hsvg, w.p && w.p.style.getPropertyValue('--wc'), false, !!(w.p && w.p.classList.contains('flow'))); });
      } else if (pipeShown()) links.forEach((l) => run(l.el, wires, l.el && l.el.style.getPropertyValue('--wc'), false, l.state === 'flow'));
    }
    fdots.forEach((ds, p) => { if (!live.has(p)) { ds.forEach((c) => c.remove()); fdots.delete(p); } });
    requestAnimationFrame(flowLoop);
  })(performance.now());""")
css = """
#mwires circle.fdot, #hwires circle.fdot, #wires circle.fdot { fill: color-mix(in srgb, var(--pc) 45%, #fff); filter: drop-shadow(0 0 3px var(--pc)) drop-shadow(0 0 7px var(--pc)); pointer-events: none; }
"""
i = s.index('</style>'); s = s[:i] + css + s[i:]
open(p, 'w', encoding='utf-8').write(s)
print('ok')
