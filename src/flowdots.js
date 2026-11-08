// Dots keep streaming along every wire on the board: slow while idle, quick and bright while work moves.
import { animationsOn } from './appearance.js';

const NS = 'http://www.w3.org/2000/svg';
const dots = new Map();
const calm = matchMedia('(prefers-reduced-motion: reduce)');
// [selector, runs from the far end back to the start]
const KINDS = [['svg.mgr-wires path[data-k]', true], ['svg.hand-wires path[data-w]', false], ['svg.pipe-wires path.wire', false]];

function run(p, rev, now, live) {
  const svg = p.ownerSVGElement; if (!svg || !svg.parentElement || svg.parentElement.offsetParent === null) return;
  if (p.classList.contains('paused') || p.classList.contains('temp')) return;
  const len = p.getTotalLength(); if (len < 40) return;
  live.add(p);
  const n = Math.max(2, Math.round(len / 110)); let ds = dots.get(p);
  if (!ds || ds.length !== n || ds[0].ownerSVGElement !== svg) {
    if (ds) ds.forEach((c) => c.remove());
    ds = Array.from({ length: n }, () => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('class', 'fdot'); svg.append(c); return c; });
    dots.set(p, ds);
  }
  const active = p.classList.contains('flow'), sp = active ? 170 : 46, gap = len / n, base = (now / 1000) * sp;
  const color = p.style.getPropertyValue('--wc') || 'var(--accent)';
  ds.forEach((c, i) => {
    const k = ((base + i * gap) % len) / len, pt = p.getPointAtLength(len * (rev ? 1 - k : k));
    c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y); c.setAttribute('r', active ? 3.4 : 2.4);
    c.style.setProperty('--pc', color); c.style.opacity = (Math.sin(Math.PI * k) * (active ? 1 : .55)).toFixed(3);
  });
}

function frame(now) {
  const live = new Set();
  if (animationsOn() && !calm.matches && !document.hidden) {
    for (const [sel, rev] of KINDS) document.querySelectorAll(sel).forEach((p) => run(p, rev, now, live));
  }
  dots.forEach((ds, p) => { if (!live.has(p)) { ds.forEach((c) => c.remove()); dots.delete(p); } });
  requestAnimationFrame(frame);
}

export function initFlowDots() { requestAnimationFrame(frame); }
