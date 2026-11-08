// First-run welcome: your name, a look, your agents, a short tour, then your first folder.
import { S, save, h } from './state.js';
import { look, applyAppearance, LOOKS, THEMES } from './appearance.js';
import { AGENTS } from './agents.js';
import { glassify } from './glass.js';

const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="onbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color: var(--accent-light)"/><stop offset="1" style="stop-color: var(--accent-deep, var(--accent))"/></linearGradient></defs><circle cx="16" cy="16" r="4.2" fill="url(#onbg)"/><ellipse cx="16" cy="16" rx="13" ry="5.2" fill="none" stroke="url(#onbg)" stroke-width="1.6"/><ellipse cx="16" cy="16" rx="13" ry="5.2" fill="none" stroke="url(#onbg)" stroke-width="1.6" transform="rotate(60 16 16)"/><ellipse cx="16" cy="16" rx="13" ry="5.2" fill="none" stroke="url(#onbg)" stroke-width="1.6" transform="rotate(120 16 16)"/></svg>';

export function openOnboarding({ onFolder, onAgents } = {}) {
  if (document.querySelector('.onb-scrim')) return;
  const L = look();
  let step = 0;
  const STEPS = 5;
  const scrim = h('div', { class: 'onb-scrim' });
  const card = h('div', { class: 'onb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to Argon' });
  const bars = h('div', { class: 'onb-steps' }, ...Array.from({ length: STEPS }, () => h('i')));
  const page = h('div', { class: 'onb-page' });
  const back = h('button', { class: 'btn', onclick: () => go(step - 1) }, 'Back');
  const next = h('button', { class: 'btn primary', onclick: () => go(step + 1) }, 'Next');
  const skip = h('button', { class: 'onb-skip', onclick: () => done() }, 'Skip');
  card.append(bars, page, h('div', { class: 'onb-foot' }, skip, h('div', { class: 'spacer' }), back, next));
  scrim.append(card); document.body.append(scrim);
  glassify(card, { refract: false });

  const done = () => { S.data.settings.onboarded = true; S.data.settings.seenSetup = true; save(); scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220 }).onfinish = () => scrim.remove(); };
  const pages = [
    () => {
      const name = h('input', { type: 'text', placeholder: 'Your first name (optional)', value: L.name || '' });
      name.addEventListener('input', () => { L.name = name.value.trim().slice(0, 30); save(); });
      setTimeout(() => name.focus(), 300);
      return [
        h('div', { class: 'onb-hero', html: LOGO }),
        h('h1', {}, 'Welcome to Argon'),
        h('p', { class: 'onb-sub' }, 'Run Claude Code, Codex, Gemini, Copilot and your own terminals side by side on one board. Group them, wire them into a pipeline, or hand a goal to a Manager and let it run the team.'),
        h('div', { class: 'onb-field' }, h('label', {}, 'What should Argon call you?'), name),
      ];
    },
    () => {
      const grid = h('div', { class: 'onb-grid' });
      for (const lk of LOOKS) {
        const t = THEMES[lk.set.theme] || THEMES.midnight;
        const on = L.theme === lk.set.theme && L.accent === lk.set.accent;
        const c = h('button', { class: 'onb-card' + (on ? ' on' : ''), onclick: () => { Object.assign(L, lk.set); save(); applyAppearance(); grid.querySelectorAll('.onb-card').forEach((x) => x.classList.toggle('on', x === c)); } },
          h('div', { class: 'onb-swatch', style: { background: `linear-gradient(135deg, ${lk.set.bgColor || t.bg2}, ${t.panel})` } }, h('i', { style: { background: lk.set.accent } }), h('i', { style: { background: t.text } }), h('i', { style: { background: t.muted } })),
          h('b', {}, lk.name), h('span', {}, t.light ? 'Light' : `${t.name} · ${lk.set.glass} glass`));
        grid.append(c);
      }
      return [h('h1', {}, 'Pick a look'), h('p', { class: 'onb-sub' }, 'Claude, Codex, Gemini and Copilot each have a look styled after their own apps. You can change everything later in Settings.'), grid];
    },
    () => {
      const list = AGENTS.filter((a) => a.cmd).slice(0, 8);
      const grid = h('div', { class: 'onb-grid' }, ...list.map((a) => {
        const ok = S.installed && S.installed[a.cmd];
        return h('div', { class: 'onb-card' + (ok ? ' on' : '') }, h('b', { style: { color: a.color } }, a.name), h('span', {}, ok ? '✓ Installed' : 'Not found on PATH'));
      }));
      const found = list.filter((a) => S.installed && S.installed[a.cmd]).length;
      return [h('h1', {}, found ? `Found ${found} agent${found === 1 ? '' : 's'}` : 'Your agents'),
        h('p', { class: 'onb-sub' }, 'Each agent runs in its own real terminal with its own login, so nothing about your accounts changes.'),
        grid,
        onAgents ? h('button', { class: 'btn', style: { marginTop: '14px' }, onclick: () => { done(); onAgents(); } }, 'Install or sign in to agents…') : ''];
    },
    () => [h('h1', {}, 'How it works'), h('p', { class: 'onb-sub' }, 'Switch modes at the top. Everything is drag and drop.'),
      h('div', { class: 'onb-tour' },
        h('div', {}, h('i', {}, '⬚'), h('b', {}, 'Board'), h('span', {}, 'A free canvas for agents, notes, checklists, previews and git. Drop tiles into a group and it tiles them into a tidy grid.')),
        h('div', {}, h('i', {}, '⧉'), h('b', {}, 'Pipeline'), h('span', {}, 'Stages wired together. Each stage hands its reports to the next, and Output gathers the summary, links and proof.')),
        h('div', {}, h('i', {}, '◎'), h('b', {}, 'Manager'), h('span', {}, 'Wire a Manager to groups or terminals, give it a goal, and it hands out the tasks and collects the results.')),
        h('div', {}, h('i', {}, '›_'), h('b', {}, 'Tell your agents'), h('span', {}, 'Ctrl K messages everyone, a #group or one @agent, as if you typed it in their terminal.')))],
    () => [h('h1', {}, L.name ? `You're set, ${L.name}` : "You're set"), h('p', { class: 'onb-sub' }, 'Open a project folder to make your first workspace. Every agent you start there works in that folder.'),
      onFolder ? h('button', { class: 'btn primary', style: { padding: '10px 18px' }, onclick: () => { done(); onFolder(); } }, 'Open a folder…') : ''],
  ];
  function go(i) {
    if (i >= STEPS) { done(); return; }
    step = Math.max(0, i);
    page.innerHTML = ''; page.style.animation = 'none'; void page.offsetWidth; page.style.animation = '';
    page.append(...pages[step]().filter(Boolean));
    bars.querySelectorAll('i').forEach((b, k) => b.classList.toggle('on', k <= step));
    back.style.visibility = step ? '' : 'hidden';
    next.textContent = step === STEPS - 1 ? 'Start' : 'Next';
  }
  scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); });
  go(0);
}
