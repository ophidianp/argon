// Modals, menus and small dialogs (Electron has no window.prompt).
import { h } from './state.js';
import { glassify, morphFrom } from './glass.js';

let morphSource = null;
// The next modal grows out of this element (e.g. the button that opened it).
export function setMorphSource(el) { morphSource = el; }

const motion = () => !document.body.classList.contains('no-anim') && !matchMedia('(prefers-reduced-motion: reduce)').matches;

export function modal({ title, sub, body, foot, wide = false, onClose, cls = '', peek = false }) {
  const root = document.getElementById('modal-root');
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey, true);
    back.classList.add('closing');
    setTimeout(() => back.remove(), motion() ? 160 : 0);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const m = h('div', { class: 'modal' + (wide ? ' wide' : '') + (cls ? ' ' + cls : '') },
    h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, title), sub ? h('div', { class: 'modal-sub' }, sub) : null),
      h('button', { class: 'icon-btn', onclick: close, title: 'Close' }, '✕')),
    h('div', { class: 'modal-body' }, body),
    foot ? h('div', { class: 'modal-foot' }, foot) : null);
  const back = h('div', { class: 'modal-back' + (peek ? ' peek' : ''), onpointerdown: (e) => { if (e.target === back) close(); } }, m);
  root.append(back);
  glassify(m);
  const src = morphSource; morphSource = null;
  if (src && src.isConnected && motion()) { m.classList.add('morphing'); morphFrom(src, m, 480); }
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => { const f = m.querySelector('[autofocus], input, textarea, select'); f && f.focus(); }, 30);
  return { close, el: m };
}

export function askText(title, { value = '', placeholder = '', okLabel = 'OK', multiline = false, sub } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = multiline
      ? h('textarea', { rows: 5, placeholder, style: { width: '100%', resize: 'vertical' } })
      : h('input', { type: 'text', placeholder, style: { width: '100%' } });
    input.value = value;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { e.preventDefault(); finish(input.value); } });
    const m = modal({
      title, sub, body: input,
      foot: [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => finish(input.value) }, okLabel)],
      onClose: () => { if (!done) { done = true; resolve(null); } },
    });
    setTimeout(() => { input.focus(); input.select && input.select(); }, 40);
  });
}

export function confirmBox(title, sub, okLabel = 'Confirm', danger = true) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const ok = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => finish(true) }, okLabel);
    const m = modal({
      title, sub, body: h('div'),
      foot: [h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'), ok],
      onClose: () => { if (!done) { done = true; resolve(false); } },
    });
    setTimeout(() => ok.focus(), 40);
  });
}

// items: [{label, note, dot, onClick, missing}] | 'sep' | {title}
export function showMenu(x, y, items) {
  const root = document.getElementById('menu-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', esc, true); };
  const away = (e) => { if (!menu.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const menu = h('div', { class: 'menu' });
  glassify(menu, { refract: false });
  for (const it of items) {
    if (it === 'sep') { menu.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.title) { menu.append(h('div', { class: 'menu-title' }, it.title)); continue; }
    menu.append(h('button', {
      class: 'menu-item' + (it.missing ? ' missing' : ''), title: it.tip || null,
      onclick: () => { close(); it.onClick && it.onClick(); },
    },
      it.dot ? h('span', { class: 'mi-dot', style: { background: it.dot } }) : null,
      h('span', { class: 'mi-label' }, it.label),
      it.note ? h('span', { class: 'mi-note' }, it.note) : null));
  }
  root.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  menu.style.transformOrigin = (x - parseFloat(menu.style.left)) + 'px ' + (y - parseFloat(menu.style.top)) + 'px';
  setTimeout(() => { window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', esc, true); });
  return close;
}
