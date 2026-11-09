// Liquid glass: edge refraction (SVG displacement with a slight color split), pointer glare,
// a gliding hover lens, and a morph helper for panels that grow out of the button that opened them.
const SVGNS = 'http://www.w3.org/2000/svg';
let defs = null, strength = 0, prism = 0.6, seq = 0;
const items = new Map(); // element -> { id, w, h, s, ro, timer }

function ensureDefs() {
  if (defs) return defs;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  defs = document.createElementNS(SVGNS, 'defs');
  svg.append(defs);
  document.body.append(svg);
  return defs;
}

// Displacement map for a rounded rectangle: pixels near the rim sample from further inside,
// which bends the backdrop like the thick edge of a lens. The second map is a dispersion field
// (stronger toward the rim) used to pull red and blue apart: chromatic aberration.
function dispMaps(w, h, radius) {
  const k = Math.min(1, 420 / Math.max(w, h));
  const W = Math.max(4, Math.round(w * k)), H = Math.max(4, Math.round(h * k));
  const R = radius * k;
  const bezel = Math.max(8 * k, Math.min(R * 1.25 + 6 * k, Math.min(W, H) / 2, 42 * k));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const img2 = ctx.createImageData(W, H);
  const d2 = img2.data;
  const cx = W / 2, cy = H / 2, hx = W / 2 - R, hy = H / 2 - R;
  for (let y = 0; y < H; y++) {
    const py = y + 0.5 - cy, ay = Math.abs(py), sy = Math.sign(py) || 1;
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - cx, ax = Math.abs(px), sx = Math.sign(px) || 1;
      const qx = ax - hx, qy = ay - hy;
      let sd, nx, ny;
      if (qx > 0 && qy > 0) { const len = Math.hypot(qx, qy); sd = len - R; nx = (qx / len) * sx; ny = (qy / len) * sy; }
      else if (qx > qy) { sd = qx - R; nx = sx; ny = 0; }
      else { sd = qy - R; nx = 0; ny = sy; }
      const i = (y * W + x) * 4;
      const inside = -sd;
      let m = 0;
      if (inside >= 0 && inside < bezel) { const t = 1 - inside / bezel; m = Math.pow(t, 1.5); } // thick rounded rim
      d[i] = 128 - nx * m * 127;
      d[i + 1] = 128 - ny * m * 127;
      d[i + 2] = 128; d[i + 3] = 255;
      // dispersion: points away from the center, grows toward the edges, peaks on the rim
      const rx = px / cx, ry = py / cy;
      const rr = Math.min(1, Math.hypot(rx, ry));
      const base = inside >= 0 ? 0.55 * Math.pow(rr, 1.4) : 0;
      const ex = rx * base + nx * m * 0.65, ey = ry * base + ny * m * 0.65;
      d2[i] = 128 + Math.max(-1, Math.min(1, ex)) * 127;
      d2[i + 1] = 128 + Math.max(-1, Math.min(1, ey)) * 127;
      d2[i + 2] = 128; d2[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const lens = cv.toDataURL();
  ctx.putImageData(img2, 0, 0);
  return [lens, cv.toDataURL()];
}

function filterMarkup(id, w, h, [lensUrl, dispUrl], s) {
  // 1) bend the backdrop at the rim (lens). 2) shift red outward and blue inward along the
  // dispersion field, so whatever is behind the glass splits into red and blue fringes.
  const a = (6 + s * 0.3) * prism * 2.6;
  const only = { r: '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', g: '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', b: '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0' };
  return `<filter id="${id}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feImage href="${lensUrl}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="lensMap"/>
<feImage href="${dispUrl}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="dispMap"/>
<feDisplacementMap in="SourceGraphic" in2="lensMap" scale="${s.toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="lens"/>
<feDisplacementMap in="lens" in2="dispMap" scale="${(-a).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="dr"/>
<feColorMatrix in="dr" type="matrix" values="${only.r}" result="r"/>
<feDisplacementMap in="lens" in2="dispMap" scale="${(-a * 0.5).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="dg"/>
<feColorMatrix in="dg" type="matrix" values="${only.g}" result="g"/>
<feColorMatrix in="lens" type="matrix" values="${only.b}" result="b"/>
<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>
</filter>`;
}

function build(el, it, force) {
  if (!el.isConnected) { drop(el); return; }
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if ((strength <= 0 && prism <= 0) || w < 10 || h < 10) {
    el.style.removeProperty('--lg-filter');
    defs?.querySelector('#' + it.id)?.remove();
    it.w = 0; it.s = 0;
    return;
  }
  if (!force && w === it.w && h === it.h && it.s === strength && it.p === prism) return;
  it.w = w; it.h = h; it.s = strength; it.p = prism;
  const cs = getComputedStyle(el);
  const r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, h / 2, w / 2);
  const markup = filterMarkup(it.id, w, h, dispMaps(w, h, r), strength * 1.1);
  const holder = document.createElementNS(SVGNS, 'svg');
  holder.innerHTML = markup;
  const f = holder.firstElementChild;
  ensureDefs().querySelector('#' + it.id)?.remove();
  defs.append(f);
  el.style.setProperty('--lg-filter', `url(#${it.id})`);
}

function drop(el) {
  const it = items.get(el);
  if (!it) return;
  it.ro?.disconnect();
  clearTimeout(it.timer);
  defs?.querySelector('#' + it.id)?.remove();
  items.delete(el);
}

function purge() { for (const el of [...items.keys()]) if (!el.isConnected) drop(el); }

function schedule(el) {
  const it = items.get(el);
  if (!it) return;
  clearTimeout(it.timer);
  // rebuild once size settles (panels animate their size)
  it.timer = setTimeout(() => build(el, it, false), it.w ? 90 : 0);
}

// Turn an element into liquid glass. opts.refract=false skips the lens edge (cheap glass).
export function glassify(el, opts = {}) {
  el.classList.add('lg');
  if (opts.refract === false) return el;
  purge();
  if (items.has(el)) return el;
  const it = { id: 'lgf' + (++seq), w: 0, h: 0, s: 0 };
  items.set(el, it);
  it.ro = new ResizeObserver(() => schedule(el));
  it.ro.observe(el);
  requestAnimationFrame(() => build(el, it, true));
  return el;
}

export function setRefraction(s, ab = prism) {
  const next = Math.max(0, +s || 0);
  const nextP = Math.max(0, Math.min(1, +ab || 0));
  if (next === strength && nextP === prism) return;
  strength = next; prism = nextP;
  purge();
  for (const [el, it] of items) build(el, it, true);
}

export function rebuildGlass() { purge(); for (const [el, it] of items) build(el, it, true); }

// Glare that follows the pointer across glass surfaces.
export function initGlassFx() {
  let last = null;
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest ? e.target.closest('.lg') : null;
    if (last && last !== el) last.classList.remove('lg-hot');
    last = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
    el.classList.add('lg-hot');
  }, { passive: true });
  document.addEventListener('pointerleave', () => { last?.classList.remove('lg-hot'); last = null; });
}

// A soft glass pill that glides to whichever button you hover inside a bar.
export function attachLens(container, selector) {
  const lens = document.createElement('div');
  lens.className = 'lens';
  container.prepend(lens);
  let shown = false;
  const move = (b) => {
    const place = () => {
      lens.style.width = b.offsetWidth + 'px';
      lens.style.height = b.offsetHeight + 'px';
      lens.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
    };
    if (!shown) { lens.classList.add('snap'); place(); void lens.offsetWidth; lens.classList.remove('snap'); }
    else place();
    shown = true;
    lens.classList.add('on');
  };
  container.addEventListener('pointerover', (e) => {
    const b = e.target.closest(selector);
    if (b && container.contains(b) && b.offsetParent) move(b);
  });
  container.addEventListener('pointerleave', () => { shown = false; lens.classList.remove('on'); });
  return lens;
}

// The same gliding lens everywhere else in the app: hover any button, menu item or row and a glass
// pill springs to it, then glides between its neighbours. The lens lives in the hovered element's
// parent, so it only travels between siblings (a menu's items, a tile's header buttons, a list's rows).
// Bars that already have their own lens (the dock, the top bar, the zoom buttons) are left alone.
const LENS_ITEMS = 'button, [role="button"], .menu-item, .cmd-item, .tab, .chip, .frow, .check-row, .kadd, .ap-item, .mm-item, .mx-node, .mx-link, .team-row, .preset-row, .po-link, .po-file, .po-dir-name, .sup-row, .fm-crumb, .ask-b, .pick-card, .onb-card';
const LENS_SKIP = '#dock, #topbar .top-actions, #zoomctl, .win-ctl, .xterm, .wire-chip, .wire-dot, .switch, .swatch, .slider, .seg, .settings-nav, .ms-seg, .btn.primary, .sv-send, .sv-stop, .chip2, .opt.primary, [data-nolens]';
const hosts = new WeakMap(); // parent element -> { lens, shown } | null (can't host)
function lensHost(p) {
  if (hosts.has(p)) { const v = hosts.get(p); if (v && v.lens.parentNode !== p) p.prepend(v.lens); return v; }
  const cs = getComputedStyle(p);
  let ok = cs.display !== 'contents' && cs.display !== 'inline' && !/^(UL|OL|TABLE|TBODY|TR|SELECT)$/.test(p.tagName);
  if (ok && cs.position === 'static') {
    // making it positioned would re-anchor any absolutely placed children: skip those parents
    for (const c of p.children) { const q = getComputedStyle(c).position; if (q === 'absolute' || q === 'fixed') { ok = false; break; } }
    if (ok) p.style.position = 'relative';
  }
  if (!ok) { hosts.set(p, null); return null; }
  p.classList.add('lens-host');
  const lens = document.createElement('div');
  lens.className = 'lens auto';
  p.prepend(lens);
  const v = { lens, shown: false };
  p.addEventListener('pointerleave', () => { v.shown = false; lens.classList.remove('on'); });
  p.addEventListener('scroll', () => { v.shown = false; lens.classList.remove('on'); }, { passive: true });
  hosts.set(p, v);
  return v;
}
export function initAutoLens() {
  let lastEl = null;
  document.addEventListener('pointerover', (e) => {
    const b = e.target.closest && e.target.closest(LENS_ITEMS);
    if (b === lastEl) return;
    if (lastEl) lastEl.classList.remove('lensed');
    lastEl = null;
    if (!b || b.disabled || b.closest(LENS_SKIP) || !b.parentElement || !b.offsetParent) return;
    const pos = getComputedStyle(b).position;
    if (pos === 'absolute' || pos === 'fixed' || b.offsetWidth < 8 || b.offsetHeight < 8) return;
    const v = lensHost(b.parentElement);
    if (!v || b.offsetParent !== b.parentElement) return;
    const { lens } = v;
    const r = getComputedStyle(b).borderRadius;
    const place = () => {
      lens.style.width = b.offsetWidth + 'px';
      lens.style.height = b.offsetHeight + 'px';
      lens.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
      lens.style.borderRadius = r && r !== '0px' ? r : '';
    };
    if (!v.shown) { lens.classList.add('snap'); place(); void lens.offsetWidth; lens.classList.remove('snap'); }
    else place();
    v.shown = true;
    lens.classList.add('on');
    b.classList.add('lensed');
    lastEl = b;
  }, { passive: true });
}

export const SPRING = 'linear(0, 0.0066, 0.0263 2.1%, 0.1023 4.4%, 0.2319 7.3%, 0.4103 10.6%, 0.6029 14.4%, 0.7663 18.3%, 0.8897 22.6%, 0.9582 26.6%, 1.0047 31.3%, 1.0272 36.7%, 1.0311 41.2%, 1.0219 48.3%, 1.0052 61.3%, 0.9989 77.7%, 1)';

// Grow a panel out of the element that opened it (shared-element morph).
export function morphFrom(source, target, ms = 420) {
  if (!source || !target || document.body.classList.contains('no-anim')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a = source.getBoundingClientRect(), b = target.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const t = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t')) || 1;
  const bounce = document.body.dataset.bounce !== '0';
  target.animate([
    { transformOrigin: 'top left', transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, opacity: 0.35, filter: 'blur(6px)' },
    { transformOrigin: 'top left', transform: 'none', opacity: 1, filter: 'blur(0)' },
  ], { duration: ms * t, easing: bounce ? SPRING : 'cubic-bezier(.16,1,.3,1)' });
}
