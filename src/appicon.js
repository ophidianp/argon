// The window and taskbar icon follows your theme and accent: the Argon atom is drawn here in the
// current colors and handed to Windows. Works for every accent, custom colors included.
let lastKey = '', timer = 0;

function draw(c, { bg, light, accent, accentLight, accentDeep, nucleus, glow }) {
  const S = 256, g = c.getContext('2d');
  c.width = c.height = S;
  g.clearRect(0, 0, S, S);
  // tile: rounded square in the theme's background
  const r = S * 0.23, m = S * 0.04, w = S - m * 2;
  g.beginPath(); g.roundRect(m, m, w, w, r); g.fillStyle = bg; g.fill();
  g.save(); g.clip();
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.42);
  rg.addColorStop(0, glow); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, S, S);
  g.restore();
  if (light) { g.lineWidth = S * 0.012; g.strokeStyle = 'rgba(0,0,0,.08)'; g.beginPath(); g.roundRect(m, m, w, w, r); g.stroke(); }
  // three orbits and the nucleus
  g.lineWidth = S * 0.058; g.lineCap = 'round';
  const orbit = (deg, color) => { g.save(); g.translate(S / 2, S / 2); g.rotate((deg * Math.PI) / 180); g.beginPath(); g.ellipse(0, 0, S * 0.355, S * 0.13, 0, 0, Math.PI * 2); g.strokeStyle = color; g.stroke(); g.restore(); };
  orbit(60, accentDeep); orbit(120, accent); orbit(0, accentLight);
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.085, 0, Math.PI * 2); g.fillStyle = nucleus; g.fill();
}

// colors: { bg, light, accent, accentLight, accentDeep, nucleus, glow } (any CSS colors)
export function syncAppIcon(colors) {
  if (!window.argon || !window.argon.setAppIcon) return;
  const key = JSON.stringify(colors);
  if (key === lastKey) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    lastKey = key;
    try {
      const c = document.createElement('canvas'); draw(c, colors);
      c.toBlob(async (b) => { if (!b) return; try { await window.argon.setAppIcon(new Uint8Array(await b.arrayBuffer())); } catch (_) {} }, 'image/png');
    } catch (_) {}
  }, 250);
}
