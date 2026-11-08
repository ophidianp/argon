// Keeps Argon light on the GPU. Every redraw of the board also makes the glass above it re-blur,
// so things that move on their own only redraw as often as they need to:
//  - while you drag, pan or zoom: every frame, so wires stick to tiles
//  - otherwise: a few times a second
//  - when Argon is not the focused window: CSS animations pause (body.idle)
let hot = 0;
const bump = () => { hot = performance.now() + 450; };
addEventListener('pointerdown', bump, true);
addEventListener('pointermove', (e) => { if (e.buttons) bump(); }, true);
addEventListener('wheel', bump, { capture: true, passive: true });
addEventListener('keydown', bump, true);
export const isHot = (now = performance.now()) => now < hot;
export const focused = () => document.hasFocus() && !document.hidden;

// Runs fn every frame while you interact, else at most once per idleMs.
export function paced(fn, idleMs = 160) {
  let last = 0;
  const f = (now) => {
    if (isHot(now) || now - last >= idleMs) { last = now; try { fn(now); } catch (e) { console.error(e); } }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}

export function initPace() {
  const sync = () => document.body.classList.toggle('idle', !focused());
  addEventListener('focus', sync); addEventListener('blur', sync); document.addEventListener('visibilitychange', sync);
  sync();
}
