/* Liquid glass kit (from the Argon app, src/glass.js). Self-contained, no imports.
   Edge refraction + chromatic aberration (Chromium only), pointer glare, a gliding hover lens,
   spring morphs. Usage:
     <link rel="stylesheet" href="liquid-glass.css"> <script src="liquid-glass.js" defer></script>
     <div data-glass>…</div>            strength = default (70)
     <div data-glass="50">…</div>       custom refraction strength
     <div data-glass="0">…</div>        blur + rim + glare only (cheap, no filter)
     LiquidGlass.init({ selectors: '.card, .btn', strength: 60, lens: ['.nav'], lensItems: 'a', max: 25 });
   Aberration (0-100) is read from localStorage 'argon-ab' (default 25); LiquidGlass.setAberration(n) changes it live. */
(function () {
  'use strict';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var ua = navigator.userAgentData;
  var CHROMIUM = !!(ua && ua.brands && ua.brands.some(function (b) { return /Chromium|Google Chrome|Microsoft Edge/.test(b.brand); }));
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
  var SPRING = 'linear(0, 0.0066, 0.0263 2.1%, 0.1023 4.4%, 0.2319 7.3%, 0.4103 10.6%, 0.6029 14.4%, 0.7663 18.3%, 0.8897 22.6%, 0.9582 26.6%, 1.0047 31.3%, 1.0272 36.7%, 1.0311 41.2%, 1.0219 48.3%, 1.0052 61.3%, 0.9989 77.7%, 1)';
  var defs = null, seq = 0, cfg = { strength: 70, max: 25 };
  var prism = readAb();
  var items = new Map(); // el -> {id,w,h,s,p,str,timer,vis}
  var ro = null, io = null;

  function readAb() {
    var v = 25;
    try { var s = localStorage.getItem('argon-ab'); if (s !== null && !isNaN(+s)) v = +s; } catch (e) {}
    return Math.max(0, Math.min(1, v / 100)); // same as the app: 25% -> prism 0.25
  }

  function ensureDefs() {
    if (defs) return defs;
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    defs = document.createElementNS(SVGNS, 'defs');
    svg.appendChild(defs); document.body.appendChild(svg);
    return defs;
  }

  // Lens map (rim bends the backdrop) + dispersion map (pulls red and blue apart toward the rim).
  function dispMaps(w, h, radius) {
    var k = Math.min(1, 420 / Math.max(w, h));
    var W = Math.max(4, Math.round(w * k)), H = Math.max(4, Math.round(h * k)), R = radius * k;
    var bezel = Math.max(8 * k, Math.min(R * 1.25 + 6 * k, Math.min(W, H) / 2, 42 * k));
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(W, H), d = img.data, img2 = ctx.createImageData(W, H), d2 = img2.data;
    var cx = W / 2, cy = H / 2, hx = W / 2 - R, hy = H / 2 - R;
    for (var y = 0; y < H; y++) {
      var py = y + 0.5 - cy, ay = Math.abs(py), sy = Math.sign(py) || 1;
      for (var x = 0; x < W; x++) {
        var px = x + 0.5 - cx, ax = Math.abs(px), sx = Math.sign(px) || 1;
        var qx = ax - hx, qy = ay - hy, sd, nx, ny;
        if (qx > 0 && qy > 0) { var len = Math.hypot(qx, qy); sd = len - R; nx = (qx / len) * sx; ny = (qy / len) * sy; }
        else if (qx > qy) { sd = qx - R; nx = sx; ny = 0; }
        else { sd = qy - R; nx = 0; ny = sy; }
        var i = (y * W + x) * 4, inside = -sd, m = 0;
        if (inside >= 0 && inside < bezel) m = Math.pow(1 - inside / bezel, 1.5);
        d[i] = 128 - nx * m * 127; d[i + 1] = 128 - ny * m * 127; d[i + 2] = 128; d[i + 3] = 255;
        var rx = px / cx, ry = py / cy, rr = Math.min(1, Math.hypot(rx, ry));
        var base = inside >= 0 ? 0.55 * Math.pow(rr, 1.4) : 0;
        var ex = rx * base + nx * m * 0.65, ey = ry * base + ny * m * 0.65;
        d2[i] = 128 + Math.max(-1, Math.min(1, ex)) * 127; d2[i + 1] = 128 + Math.max(-1, Math.min(1, ey)) * 127;
        d2[i + 2] = 128; d2[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0); var lens = cv.toDataURL();
    ctx.putImageData(img2, 0, 0);
    return [lens, cv.toDataURL()];
  }

  function filterMarkup(id, w, h, maps, s) {
    var a = (6 + s * 0.3) * prism * 2.6;
    var R = '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', G = '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', B = '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0';
    return '<filter id="' + id + '" x="0" y="0" width="' + w + '" height="' + h + '" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">' +
      '<feImage href="' + maps[0] + '" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="none" result="lensMap"/>' +
      '<feImage href="' + maps[1] + '" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="none" result="dispMap"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="lensMap" scale="' + s.toFixed(1) + '" xChannelSelector="R" yChannelSelector="G" result="lens"/>' +
      '<feDisplacementMap in="lens" in2="dispMap" scale="' + (-a).toFixed(1) + '" xChannelSelector="R" yChannelSelector="G" result="dr"/>' +
      '<feColorMatrix in="dr" type="matrix" values="' + R + '" result="r"/>' +
      '<feDisplacementMap in="lens" in2="dispMap" scale="' + (-a * 0.5).toFixed(1) + '" xChannelSelector="R" yChannelSelector="G" result="dg"/>' +
      '<feColorMatrix in="dg" type="matrix" values="' + G + '" result="g"/>' +
      '<feColorMatrix in="lens" type="matrix" values="' + B + '" result="b"/>' +
      '<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/></filter>';
  }

  function clear(el, it) {
    el.style.removeProperty('--lg-filter');
    var f = defs && defs.querySelector('#' + it.id); if (f) f.remove();
    it.w = 0;
  }

  function build(el, it, force) {
    if (!el.isConnected) { drop(el); return; }
    if (!it.vis) return; // off-screen: rebuild when it scrolls in
    var w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight), s = it.str * 1.1;
    if (s <= 0 || w < 10 || h < 10) { clear(el, it); return; }
    if (!force && w === it.w && h === it.h && it.s === s && it.p === prism) return;
    it.w = w; it.h = h; it.s = s; it.p = prism;
    var r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, h / 2, w / 2);
    var holder = document.createElementNS(SVGNS, 'svg');
    holder.innerHTML = filterMarkup(it.id, w, h, dispMaps(w, h, r), s);
    var old = ensureDefs().querySelector('#' + it.id); if (old) old.remove();
    defs.appendChild(holder.firstElementChild);
    el.style.setProperty('--lg-filter', 'url(#' + it.id + ')');
  }

  function drop(el) {
    var it = items.get(el); if (!it) return;
    if (ro) ro.unobserve(el); if (io) io.unobserve(el);
    clearTimeout(it.timer);
    var f = defs && defs.querySelector('#' + it.id); if (f) f.remove();
    items.delete(el);
  }

  function schedule(el, force) {
    var it = items.get(el); if (!it) return;
    clearTimeout(it.timer);
    it.timer = setTimeout(function () { build(el, it, force); }, it.w ? 90 : 0); // wait for size to settle
  }

  function glassify(el, strength) {
    el.classList.add('lg');
    var str = strength == null ? cfg.strength : +strength;
    if (!CHROMIUM || !(str > 0) || items.has(el) || items.size >= cfg.max) return el; // over the cap: blur-only glass
    if (!ro) ro = new ResizeObserver(function (es) { es.forEach(function (e) { schedule(e.target, false); }); });
    if (!io) io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { var it = items.get(e.target); if (!it) return; it.vis = e.isIntersecting; if (it.vis) schedule(e.target, false); });
    }, { rootMargin: '200px' });
    items.set(el, { id: 'lgf' + (++seq), w: 0, h: 0, s: 0, str: str, vis: false });
    ro.observe(el); io.observe(el);
    return el;
  }

  function setAberration(pct) {
    try { localStorage.setItem('argon-ab', String(pct)); } catch (e) {}
    prism = readAb();
    items.forEach(function (it, el) { build(el, it, true); });
  }

  function rebuild() { items.forEach(function (it, el) { build(el, it, true); }); }

  // Glare that follows the pointer across glass.
  function initGlare() {
    var last = null;
    document.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var el = e.target.closest ? e.target.closest('.lg') : null;
      if (last && last !== el) last.classList.remove('lg-hot');
      last = el; if (!el) return;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
      el.classList.add('lg-hot');
    }, { passive: true });
    document.addEventListener('pointerleave', function () { if (last) last.classList.remove('lg-hot'); last = null; });
  }

  // A soft glass pill that glides (spring) to whichever item you hover inside a bar.
  function attachLens(container, selector) {
    if (!container || container.querySelector(':scope > .lens')) return null;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    var lens = document.createElement('div'); lens.className = 'lens'; lens.setAttribute('aria-hidden', 'true');
    container.insertBefore(lens, container.firstChild);
    var shown = false;
    function move(b) {
      function place() {
        lens.style.width = b.offsetWidth + 'px'; lens.style.height = b.offsetHeight + 'px';
        lens.style.transform = 'translate(' + b.offsetLeft + 'px,' + b.offsetTop + 'px)';
      }
      if (!shown) { lens.classList.add('snap'); place(); void lens.offsetWidth; lens.classList.remove('snap'); } else place();
      shown = true; lens.classList.add('on');
    }
    container.addEventListener('pointerover', function (e) {
      var b = e.target.closest(selector);
      if (b && container.contains(b) && b.offsetParent && b.offsetParent === lens.offsetParent) move(b);
    });
    container.addEventListener('pointerleave', function () { shown = false; lens.classList.remove('on'); });
    return lens;
  }

  // Grow a panel out of the element that opened it.
  function morphFrom(source, target, ms) {
    if (!source || !target || REDUCED.matches || !target.animate) return;
    var a = source.getBoundingClientRect(), b = target.getBoundingClientRect();
    if (!a.width || !b.width) return;
    target.animate([
      { transformOrigin: 'top left', transform: 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px) scale(' + (a.width / b.width) + ',' + (a.height / b.height) + ')', opacity: 0.35, filter: 'blur(6px)' },
      { transformOrigin: 'top left', transform: 'none', opacity: 1, filter: 'blur(0)' }
    ], { duration: ms || 420, easing: SPRING });
  }

  function init(opts) {
    opts = opts || {};
    if (opts.strength != null) cfg.strength = +opts.strength;
    if (opts.max != null) cfg.max = +opts.max;
    document.documentElement.classList.add(CHROMIUM ? 'lg-refract' : 'lg-norefract');
    // explicit data-glass first (they get filter slots before the generic selectors)
    document.querySelectorAll('[data-glass]').forEach(function (el) {
      var v = el.getAttribute('data-glass'); glassify(el, v === '' ? null : v);
    });
    if (opts.selectors) document.querySelectorAll(opts.selectors).forEach(function (el) { glassify(el, null); });
    if (opts.lens) {
      var list = typeof opts.lens === 'string' ? [opts.lens] : opts.lens;
      list.forEach(function (sel) { document.querySelectorAll(sel).forEach(function (c) { attachLens(c, opts.lensItems || 'a, button'); }); });
    }
    if (!init.done) { initGlare(); init.done = true; }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(rebuild);
  }

  window.LiquidGlass = { init: init, glassify: glassify, attachLens: attachLens, morphFrom: morphFrom,
    setAberration: setAberration, rebuild: rebuild, SPRING: SPRING, chromium: CHROMIUM,
    get aberration() { return Math.round(prism * 100); } };
  if (document.currentScript && document.currentScript.hasAttribute('data-auto')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); }); else init();
  }
})();
