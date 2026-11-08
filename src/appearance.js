// Personalization: theme, accent, liquid glass, backdrop, terminal, layout, motion, name.
import { S } from './state.js';
import { setRefraction } from './glass.js';

export const ACCENTS = [
  { name: 'Lavender', hex: '#9a83d4' },
  { name: 'Orchid', hex: '#c07ad0' },
  { name: 'Rose', hex: '#e0889f' },
  { name: 'Coral', hex: '#e8957a' },
  { name: 'Amber', hex: '#e2b15a' },
  { name: 'Lime', hex: '#a9cf6a' },
  { name: 'Mint', hex: '#6fcfa3' },
  { name: 'Teal', hex: '#5cc2c2' },
  { name: 'Sky', hex: '#7ea8ec' },
  { name: 'Silver', hex: '#a9adbd' },
  { name: 'Clay', hex: '#d97757' },
  { name: 'Jade', hex: '#10a37f' },
  { name: 'Spark', hex: '#7c9df5' },
  { name: 'Iris', hex: '#a371f7' },
];

export const THEMES = {
  midnight: { name: 'Midnight', bg: '#0d0b14', bg2: '#120f1b', panel: '#181423', panel2: '#201a2e', panel3: '#2a2340', line: '#2c2541', line2: '#3a3156', text: '#ebe6f6', muted: '#9a90b3', dim: '#6b6382', term: '#0f0c18' },
  abyss:    { name: 'Abyss',    bg: '#000000', bg2: '#05040a', panel: '#0c0a12', panel2: '#14111c', panel3: '#1d1928', line: '#1d1928', line2: '#2b2539', text: '#eeeaf8', muted: '#9a90b3', dim: '#665e7c', term: '#000000' },
  dusk:     { name: 'Dusk',     bg: '#1a1724', bg2: '#211d2e', panel: '#2a2539', panel2: '#332d45', panel3: '#3d3652', line: '#3a3350', line2: '#4b4366', text: '#f2eef9', muted: '#b0a7c8', dim: '#8a81a3', term: '#1c1828' },
  slate:    { name: 'Slate',    bg: '#0d1016', bg2: '#121620', panel: '#191e2a', panel2: '#212736', panel3: '#2b3244', line: '#262d3e', line2: '#353e54', text: '#e6e9f2', muted: '#959db4', dim: '#646c84', term: '#0f131b' },
  // Styled after the agents' own CLIs and apps.
  claude:   { name: 'Claude',   bg: '#1f1e1d', bg2: '#262624', panel: '#30302e', panel2: '#3a3936', panel3: '#44433f', line: '#3e3d39', line2: '#4f4d48', text: '#f5f4ef', muted: '#b7b5a9', dim: '#8a877d', term: '#1f1e1d' },
  codex:    { name: 'Codex',    bg: '#0b0b0c', bg2: '#111113', panel: '#18181b', panel2: '#202024', panel3: '#2a2a2f', line: '#26262b', line2: '#34343a', text: '#ececec', muted: '#a1a1aa', dim: '#71717a', term: '#0b0b0c' },
  gemini:   { name: 'Gemini',   bg: '#131314', bg2: '#1b1c1d', panel: '#1e1f20', panel2: '#282a2c', panel3: '#333537', line: '#2f3133', line2: '#3c4043', text: '#e3e3e3', muted: '#a8adb3', dim: '#80868b', term: '#131314' },
  copilot:  { name: 'Copilot',  bg: '#010409', bg2: '#0d1117', panel: '#161b22', panel2: '#1c2128', panel3: '#22272e', line: '#21262d', line2: '#30363d', text: '#e6edf3', muted: '#9198a1', dim: '#6e7681', term: '#0d1117' },
  daylight: { name: 'Daylight', light: true, bg: '#e7e4ef', bg2: '#efecf6', panel: '#ffffff', panel2: '#f4f1fa', panel3: '#e8e3f3', line: '#dcd5ea', line2: '#c8bfdc', text: '#1c1727', muted: '#5a526e', dim: '#8a829e', term: '#fbfaff' },
};

// Solid background colors. "" means the theme's own background.
export const BG_COLORS = [
  ['', 'Theme'], ['#0b0910', 'Ink'], ['#000000', 'Black'], ['#161021', 'Plum'], ['#0e1424', 'Navy'], ['#0c1a1d', 'Deep teal'],
  ['#0e1912', 'Forest'], ['#1b1310', 'Espresso'], ['#151619', 'Graphite'], ['#2a2236', 'Heather'],
  ['#efecf6', 'Mist'], ['#f6f4ef', 'Paper'], ['#e8eef8', 'Cloud'], ['#e9f0ea', 'Sage'], ['#ffffff', 'White'],
];

export const FONTS = ['Cascadia Code', 'Cascadia Mono', 'Consolas', 'JetBrains Mono', 'Fira Code', 'Lucida Console', 'Courier New'];
export const UI_FONTS = ['Segoe UI Variable Text', 'Segoe UI', 'Bahnschrift', 'Calibri', 'Verdana', 'Trebuchet MS', 'Georgia'];

// Terminal color schemes. "auto" follows the theme and accent.
const A = (bg, fg, c) => ({ background: bg, foreground: fg, black: c[0], red: c[1], green: c[2], yellow: c[3], blue: c[4], magenta: c[5], cyan: c[6], white: c[7], brightBlack: c[8], brightRed: c[9], brightGreen: c[10], brightYellow: c[11], brightBlue: c[12], brightMagenta: c[13], brightCyan: c[14], brightWhite: c[15] });
const DARK_ANSI = ['#1c1828', '#e0727c', '#7fd1a0', '#f0c674', '#82a7f0', '#b79cf0', '#7fd1d0', '#d8d0ec', '#5a5272', '#f08f98', '#9fe0b8', '#f5d48f', '#a0bdf5', '#cdb8f5', '#9fe3e2', '#f5f2fb'];
const LIGHT_ANSI = ['#2a2438', '#c4404f', '#2f8f5b', '#a87612', '#3567c4', '#7d4fc2', '#228a8a', '#6e6684', '#7a7290', '#d85462', '#39a56b', '#bf8a1c', '#4a7bd8', '#9163d6', '#2ba0a0', '#1c1727'];
export const TERM_SCHEMES = {
  auto: { name: 'Match theme' },
  nocturne: { name: 'Nocturne', ...A('#0b0f1a', '#d6deeb', ['#1b2233', '#ef6b73', '#7fdbca', '#ecc48d', '#82aaff', '#c792ea', '#7fdbca', '#d6deeb', '#4b5670', '#ff8a92', '#a2f0dc', '#f5d4a6', '#a5c2ff', '#dab2f2', '#a2f0dc', '#ffffff']) },
  ember: { name: 'Ember', ...A('#160f0c', '#f0e2d6', ['#2a1d17', '#ec6b5d', '#a8c47a', '#f0b25a', '#7ea6d9', '#d58bb0', '#78c2b2', '#e8d9cb', '#5e4a3f', '#ff8a7c', '#c0db93', '#ffcb7a', '#9cbde8', '#e8a6c6', '#95d6c8', '#fff4ea']) },
  grove: { name: 'Grove', ...A('#0c130f', '#dcebe0', ['#18241c', '#e07a6f', '#8fd694', '#e2cf7a', '#7fb1d6', '#c39ad6', '#77cfc0', '#d4e4d8', '#4a5e50', '#f0958b', '#a9e8ad', '#f0e09a', '#9cc8e8', '#d6b3e6', '#95e0d3', '#f4fff7']) },
  neon: { name: 'Neon', ...A('#05040a', '#f2f0ff', ['#16141f', '#ff4d7d', '#3dffa8', '#ffe14d', '#4db8ff', '#c24dff', '#4dfff3', '#e6e3f5', '#4a4660', '#ff7a9d', '#7affc4', '#fff07a', '#7acbff', '#d47aff', '#7afff7', '#ffffff']) },
  mono: { name: 'Mono', ...A('#0e0e10', '#e4e4e8', ['#1c1c20', '#d0d0d4', '#bdbdc2', '#e4e4e8', '#a8a8ae', '#c6c6cb', '#b4b4ba', '#e4e4e8', '#55555c', '#e6e6ea', '#d2d2d6', '#f4f4f6', '#c0c0c6', '#dcdce0', '#cacace', '#ffffff']) },
  clay: { name: 'Clay', ...A('#1f1e1d', '#f5f4ef', ['#30302e', '#e2725b', '#9cbb7a', '#e5b567', '#7fa3d1', '#c48fb5', '#82b8b0', '#e8e6dc', '#6b6964', '#f08d76', '#b4d193', '#f1ca86', '#9ab9e0', '#d6a8c8', '#9ccdc5', '#ffffff']) },
  gemini: { name: 'Gemini', ...A('#131314', '#e3e3e3', ['#282a2c', '#f28b82', '#81c995', '#fdd663', '#8ab4f8', '#c58af9', '#78d9ec', '#e3e3e3', '#5f6368', '#f6aea9', '#a8dab5', '#fde293', '#aecbfa', '#d7aefb', '#a1e4f2', '#ffffff']) },
  github: { name: 'GitHub', ...A('#0d1117', '#e6edf3', ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4', '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#ffffff']) },
  paper: { name: 'Paper', ...A('#fbfaf7', '#26222e', LIGHT_ANSI) },
};

// One-click looks that set several options at once.
export const LOOKS = [
  { name: 'Liquid Lavender', set: { theme: 'midnight', accent: '#9a83d4', glass: 'liquid', bgColor: '', termScheme: 'auto' } },
  { name: 'Obsidian', set: { theme: 'abyss', accent: '#5cc2c2', glass: 'frosted', bgColor: '#000000', pattern: 'grid', termScheme: 'nocturne' } },
  { name: 'Daybreak', set: { theme: 'daylight', accent: '#7ea8ec', glass: 'liquid', bgColor: '', termScheme: 'paper' } },
  { name: 'Campfire', set: { theme: 'dusk', accent: '#e8957a', glass: 'tinted', bgColor: '#1b1310', termScheme: 'ember' } },
  { name: 'Lagoon', set: { theme: 'slate', accent: '#6fcfa3', glass: 'liquid', bgColor: '#0c1a1d', termScheme: 'grove' } },
  { name: 'Claude', set: { theme: 'claude', accent: '#d97757', glass: 'liquid', bgColor: '', pattern: 'dots', termScheme: 'clay' } },
  { name: 'Codex', set: { theme: 'codex', accent: '#10a37f', glass: 'liquid', bgColor: '', pattern: 'grid', termScheme: 'mono' } },
  { name: 'Gemini', set: { theme: 'gemini', accent: '#7c9df5', glass: 'liquid', bgColor: '', pattern: 'dots', termScheme: 'gemini' } },
  { name: 'Copilot', set: { theme: 'copilot', accent: '#a371f7', glass: 'liquid', bgColor: '', pattern: 'dots', termScheme: 'github' } },
  { name: 'Prism', set: { theme: 'midnight', accent: '#c07ad0', glass: 'liquid', bgColor: '#161021', termScheme: 'neon' } },
];

export function defaults() {
  return {
    name: '', greeting: true,
    theme: 'midnight', accent: '#9a83d4',
    glass: 'liquid', blur: 2, tint: 12, refraction: true, refractStrength: 70, aberration: 25, glassV: 2, specular: true, glassTiles: true,
    bgColor: '', pattern: 'dots', patternSize: 24, backdrop: 'off',
    termScheme: 'auto', termFont: 'Cascadia Code', lineHeight: 1.15, letterSpacing: 0, cursor: 'block', cursorBlink: true, termOpacity: 100, termPadding: 6,
    layout: 'floating', dock: 'left', density: 'comfortable', radius: 14, uiFont: 'Segoe UI Variable Text', uiScale: 100, shadow: 60,
    animations: true, motion: 'normal', bounce: true,
  };
}

export function look() {
  const cur = S.data.settings.appearance || {};
  // migrate the first personalization version
  if (cur.bg) { cur.pattern = cur.bg === 'grid' ? 'grid' : cur.bg === 'plain' ? 'none' : 'dots'; delete cur.bg; }
  for (const k of ['wallDim', 'wallBlur', 'auroraMotion']) delete cur[k]; // backgrounds are solid colors only
  if (cur.backdrop != null && !['off', 'mica', 'acrylic'].includes(cur.backdrop)) delete cur.backdrop; // old wallpaper setting; the new one is Windows blur
  if (cur.corners && cur.radius == null) { cur.radius = { rounded: 14, soft: 10, sharp: 4 }[cur.corners] ?? 14; delete cur.corners; }
  if ((cur.glassV || 1) < 2) { Object.assign(cur, { blur: 2, tint: 12, refractStrength: 70, aberration: 25, glassV: 2 }); if (cur.glass === 'frosted') cur.glass = 'liquid'; } // clear glass
  // Fill in missing keys on the same object: callers hold on to it and change it, so it must never be swapped for a copy.
  const d = defaults(); for (const k of Object.keys(d)) if (!(k in cur)) cur[k] = d[k];
  S.data.settings.appearance = cur;
  return cur;
}

// ---- color helpers ----
export function hexToRgb(hex) {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [154, 131, 212];
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hsl = (h, s, l, a = 1) => `hsl(${(((h % 360) + 360) % 360).toFixed(1)} ${clamp(s, 0, 100).toFixed(1)}% ${clamp(l, 0, 100).toFixed(1)}% / ${a})`;
const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;

export function palette(hex) {
  const rgb = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(rgb);
  const a = (al) => rgba(rgb, al);
  return {
    accent: hex, h, s, l,
    accent2: hsl(h, s * 0.9, l - 10),
    accentDeep: hsl(h, s * 0.8, l - 28),
    accentLight: hsl(h, s, Math.min(88, l + 16)),
    soft: a(0.16), soft2: a(0.35), glow: a(0.38), glowSoft: a(0.18), dot: a(0.16), line: a(0.07),
    rgb,
  };
}

const GLASS = {
  liquid:  { blur: 1.0, tint: 1.0, sat: 1.15, rim: 1 },
  frosted: { blur: 1, tint: 1, sat: 1.4, rim: 0.7, minBlur: 18, minTint: 45 },
  tinted:  { blur: 1.0, tint: 1.0, sat: 1.5, rim: 0.9, accent: true, minTint: 35 },
  solid:   { blur: 0, tint: 99, sat: 1, rim: 0.4 },
};

const SPEED = { relaxed: 1.45, normal: 1, snappy: 0.62 };

export function applyAppearance() {
  const L = look();
  const t = THEMES[L.theme] || THEMES.midnight;
  const p = palette(L.accent);
  const g = GLASS[L.glass] || GLASS.liquid;
  const root = document.documentElement.style;
  const body = document.body;
  const set = (k, v) => root.setProperty(k, v);
  // theme
  set('--bg', t.bg); set('--bg-2', t.bg2); set('--panel', t.panel); set('--panel-2', t.panel2); set('--panel-3', t.panel3);
  set('--line', t.line); set('--line-2', t.line2); set('--text', t.text); set('--muted', t.muted); set('--dim', t.dim);
  document.documentElement.style.colorScheme = t.light ? 'light' : 'dark';
  body.dataset.tone = t.light ? 'light' : 'dark';
  // accent
  set('--accent', p.accent); set('--accent-2', p.accent2); set('--accent-deep', p.accentDeep); set('--accent-light', t.light ? p.accent2 : p.accentLight);
  set('--accent-soft', p.soft); set('--accent-soft-2', p.soft2); set('--glow', p.glow); set('--glow-soft', p.glowSoft);
  set('--dot', t.light ? rgba(p.rgb, 0.3) : p.dot); set('--grid-line', t.light ? rgba(p.rgb, 0.14) : p.line); set('--working', t.light ? p.accent2 : p.accentLight);
  // shape
  const r = clamp(+L.radius || 0, 0, 26);
  set('--radius', r + 'px'); set('--radius-sm', Math.round(r * 0.62) + 'px'); set('--radius-lg', Math.round(r * 1.3) + 'px');
  set('--bar-r', Math.round(Math.min(24, r * 1.6 + 2)) + 'px');
  set('--shadow-a', String((L.shadow / 100) * (t.light ? 0.22 : 0.55)));
  // glass
  const panelRgb = hexToRgb(t.panel);
  const tintA = clamp((Math.max(L.tint, g.minTint || 0) / 100) * g.tint, 0, 1);
  const tintRgb = g.accent ? panelRgb.map((c, i) => Math.round(c * 0.7 + p.rgb[i] * 0.3)) : panelRgb;
  set('--g-tint', rgba(tintRgb, tintA.toFixed(3)));
  set('--g-tint-strong', rgba(tintRgb, clamp(tintA + 0.5, 0, 0.92).toFixed(3))); // panels full of text stay readable
  set('--g-blur', (Math.max(L.blur, g.minBlur || 0) * g.blur).toFixed(1) + 'px');
  set('--g-sat', String(g.sat));
  set('--g-rim', String((L.specular ? 1 : 0.35) * g.rim * (t.light ? 0.9 : 1)));
  set('--g-hi', t.light ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.5)');
  set('--g-edge', t.light ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.13)');
  set('--g-edge-dark', t.light ? 'rgba(40,30,70,.10)' : 'rgba(0,0,0,.35)');
  body.dataset.glass = L.glass;
  body.dataset.specular = L.specular ? '1' : '0';
  body.dataset.gtiles = L.glassTiles && L.glass !== 'solid' ? '1' : '0';
  const ab = L.glass === 'solid' ? 0 : clamp(+L.aberration || 0, 0, 100) / 100;
  set('--prism', ab.toFixed(2));
  setRefraction(L.refraction && L.glass !== 'solid' && L.glass !== 'frosted' ? L.refractStrength : L.refraction && L.glass === 'frosted' ? L.refractStrength * 0.5 : 0, ab);
  // terminal
  const ts = termColors();
  const tbg = hexToRgb(ts.background);
  const top = clamp(L.termOpacity, 30, 100) / 100;
  set('--term-bg', rgba(tbg, top));
  set('--term-solid', ts.background);
  set('--term-pad', clamp(+L.termPadding, 0, 20) + 'px');
  body.dataset.tglass = top < 1 ? '1' : '0';
  // layout
  body.dataset.layout = L.layout;
  body.dataset.dock = L.dock;
  body.dataset.density = L.density;
  const barH = L.density === 'compact' ? 38 : 44;
  const gap = L.layout === 'floating' ? 8 : 0;
  set('--bar-h', barH + 'px'); set('--gap', gap + 'px');
  set('--ui-font', `"${L.uiFont}", "Segoe UI", system-ui, sans-serif`);
  try { window.argon.zoom(clamp(L.uiScale, 75, 140) / 100); } catch (_) {}
  try { window.argon.setOverlay({ color: '#00000000', symbolColor: t.light ? '#3a3150' : p.accentLight.replace(/ \/ 1\)$/, ')'), height: barH + gap * 2 }); } catch (_) {}
  // motion
  body.classList.toggle('no-anim', !L.animations);
  set('--t', String(SPEED[L.motion] || 1));
  body.dataset.bounce = L.bounce ? '1' : '0';
  // background: always one solid color
  set('--canvas', L.bgColor || t.bg2);
  // Tauri build: Windows' own blur behind the window (Mica / Acrylic), drawn by the OS compositor.
  if (window.argon && window.argon.backdrop) {
    const k = ['mica', 'acrylic'].includes(L.backdrop) ? L.backdrop : 'off';
    document.documentElement.dataset.backdrop = k;
    if (applyAppearance._bd !== k) { applyAppearance._bd = k; window.argon.backdrop(k).catch(() => {}); }
  }
  const board = document.getElementById('board');
  board.dataset.pattern = L.pattern;
  board.dataset.bg = L.pattern; // older selectors
  greet();
}

export function animationsOn() {
  return look().animations && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function termColors() {
  const L = look();
  const t = THEMES[L.theme] || THEMES.midnight;
  const sc = TERM_SCHEMES[L.termScheme];
  if (sc && sc.background) return sc;
  return t.light ? A(t.term, t.text, LIGHT_ANSI) : A(t.term, t.text, DARK_ANSI);
}

export function autoTermPreview() {
  const t = THEMES[look().theme] || THEMES.midnight;
  return t.light ? A(t.term, t.text, LIGHT_ANSI) : A(t.term, t.text, DARK_ANSI);
}

export function terminalTheme() {
  const L = look();
  const p = palette(L.accent);
  const c = termColors();
  const light = (() => { const [r, g, b] = hexToRgb(c.background); return (r * 299 + g * 587 + b * 114) / 1000 > 150; })();
  return {
    ...c,
    background: 'rgba(0,0,0,0)', // the tile paints the background so it can be see-through
    cursor: light ? p.accent2 : p.accentLight, cursorAccent: c.background,
    selectionBackground: light ? rgba(p.rgb, 0.28) : p.soft2,
  };
}

export function terminalOptions() {
  const L = look();
  return {
    fontFamily: terminalFont(),
    fontSize: S.data.settings.fontSize || 13,
    lineHeight: clamp(+L.lineHeight || 1.15, 1, 2),
    letterSpacing: clamp(+L.letterSpacing || 0, -2, 4),
    cursorStyle: L.cursor || 'block',
    cursorBlink: !!L.cursorBlink,
    theme: terminalTheme(),
  };
}

export function terminalFont() {
  const f = look().termFont || 'Cascadia Code';
  return `"${f}", "Cascadia Mono", Consolas, monospace`;
}

export function greet() {
  const L = look();
  const title = document.querySelector('#empty-hint .eh-title');
  if (!title) return;
  const hr = new Date().getHours();
  const part = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  title.textContent = L.name && L.greeting ? `${part}, ${L.name}` : L.greeting ? part : 'An empty board';
}
