// Dots keep streaming along every wire on the board: slow while idle, quick and bright while work moves.
// Kept light on the GPU: no blur filters, a capped frame rate, and when Argon isn't the focused window
// only the wires that are carrying work keep moving.
import { animationsOn } from './appearance.js';
import { focused } from './pace.js';

const NS = 'http://www.w3.org/2000/svg';
const dots = new Map();
const lens = new WeakMap(); // path -> [d, length], so lengths are only measured when a wire changes
// [selector, runs from the far end back to the start] (team wires say which way with data-rev)
const KINDS = [['svg.mgr-wires path[data-k]', 'data'], ['svg.hand-wires path[data-w]', false], ['svg.pipe-wires path.wire', false]];
const FPS_ACTIVE = 30, FPS_IDLE = 15, FPS_AWAY = 8;
let last = 0;

function lengthOf(p) {
  const d = p.getAttribute('d'), c = lens.get(p);
  if (c && c[0] === d) return c[1];
  const l = p.getTotalLength(); lens.set(p, [d, l]); return l;
}

function run(p, rev, now, live, away) {
  const svg = p.ownerSVGElement; if (!svg || !svg.parentElement || svg.parentElement.offsetParent === null) return false;
  if (p.classList.contains('paused') || p.classList.contains('temp')) return false;
  const active = p.classList.contains('flow');
  if (away && !active) return false;
  const len = lengthOf(p); if (len < 40) return false;
  live.add(p);
  const n = Math.max(2, Math.min(8, Math.round(len / 120))); let ds = dots.get(p);
  if (!ds || ds.length !== n || ds[0].ownerSVGElement !== svg) {
    if (ds) ds.forEach((c) => c.remove());
    ds = Array.from({ length: n }, () => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('class', 'fdot'); svg.append(c); return c; });
    dots.set(p, ds);
  }
  const sp = active ? 170 : 46, gap = len / n, base = (now / 1000) * sp;
  const color = p.style.getPropertyValue('--wc') || 'var(--accent)';
  ds.forEach((c, i) => {
    const k = ((base + i * gap) % len) / len, pt = p.getPointAtLength(len * (rev ? 1 - k : k));
    c.setAttribute('cx', pt.x.toFixed(1)); c.setAttribute('cy', pt.y.toFixed(1)); c.setAttribute('r', active ? 3.4 : 2.4);
    if (c.style.getPropertyValue('--pc') !== color) c.style.setProperty('--pc', color);
    c.style.opacity = (Math.sin(Math.PI * k) * (active ? 1 : .55)).toFixed(2);
  });
  return active;
}

let anyActive = false;
function frame(now) {
  requestAnimationFrame(frame);
  const away = !focused();
  const fps = away ? FPS_AWAY : anyActive ? FPS_ACTIVE : FPS_IDLE;
  if (now - last < 1000 / fps - 2) return;
  last = now;
  const live = new Set(); let act = false;
  if (animationsOn() && !document.hidden) {
    for (const [sel, rev] of KINDS) document.querySelectorAll(sel).forEach((p) => { if (run(p, rev === 'data' ? p.dataset.rev !== '0' : rev, now, live, away)) act = true; });
  }
  anyActive = act;
  dots.forEach((ds, p) => { if (!live.has(p)) { ds.forEach((c) => c.remove()); dots.delete(p); } });
}

export function initFlowDots() { requestAnimationFrame(frame); }
