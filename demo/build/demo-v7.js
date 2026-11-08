  /* ---------- settings that change how agents behave ---------- */
  const SET_DEF = { autoApprove: false, askCards: true, holdTalk: true, ctxRing: true, notify: true, sounds: false, defAgent: 'claude' };
  let SET = { ...SET_DEF }; try { Object.assign(SET, JSON.parse(store.get('argon-demo-set') || '{}')); } catch (_) {}
  const saveSet = () => store.set('argon-demo-set', JSON.stringify(SET));
  let setTab = 'general';
  function setToggle(key, after) { const c = document.createElement('input'); c.type = 'checkbox'; c.className = 'switch'; c.id = 'st-' + key; c.checked = !!SET[key]; c.onchange = () => { SET[key] = c.checked; saveSet(); after && after(c.checked); }; return c; }
  function setSeg(opts, key, after) {
    const sg = document.createElement('div'); sg.className = 'seg'; const pill = document.createElement('div'); pill.className = 'pill'; sg.append(pill);
    const placeP = () => { const on = sg.querySelector('button.on'); if (!on || !on.offsetWidth) return; pill.style.width = on.offsetWidth + 'px'; pill.style.transform = `translateX(${on.offsetLeft}px)`; };
    opts.forEach(([v, l]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; if (SET[key] === v) b.className = 'on'; b.onclick = () => { SET[key] = v; saveSet(); $$('button', sg).forEach((x) => x.classList.toggle('on', x === b)); placeP(); after && after(); }; sg.append(b); });
    new ResizeObserver(placeP).observe(sg); return sg;
  }
  const btn = (txt, fn, cls = 'chip') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = txt; b.onclick = fn; return b; };
  function renderSettings() {
    const b = $('#set-body'); const top = b.scrollTop; b.innerHTML = '';
    const nav = document.createElement('div'); nav.className = 'set-tabs'; nav.setAttribute('role', 'tablist');
    [['general', 'General'], ['agents', 'Agents'], ['look', 'Appearance'], ['data', 'Data']].forEach(([k, l]) => { const x = btn(l, () => { setTab = k; renderSettings(); $('#set-body').scrollTop = 0; }, setTab === k ? 'on' : ''); x.setAttribute('role', 'tab'); nav.append(x); });
    b.append(nav);
    if (setTab === 'look') appearancePane(b);
    else if (setTab === 'general') {
      const name = document.createElement('input'); name.type = 'text'; name.className = 'set-in'; name.placeholder = 'Your first name'; name.value = store.get('argon-demo-name') || ''; name.oninput = () => store.set('argon-demo-name', name.value.trim()); name.setAttribute('aria-label', 'Your name');
      b.append(
        group('You', row('Name', 'Used to greet you.', name)),
        group('New agents', row('Default agent', 'Presets and new consoles start with this one.', setSeg([['claude', 'Claude'], ['codex', 'Codex'], ['gemini', 'Gemini'], ['copilot', 'Copilot']], 'defAgent'), true)),
        group('Alerts', row('Tell me when an agent needs me', 'A banner pops up when one asks a question.', setToggle('notify')), row('Sound', 'A soft chime with each question.', setToggle('sounds', (on) => on && chime()))),
        group('Help', row('Welcome screen', 'Run the intro again.', btn('Show', openOnb)), row('Mission Map', 'Every lead, team and console on one map.', btn('Open', () => { hide(); openMx(); }))),
      );
    } else if (setTab === 'agents') {
      const warn = document.createElement('p'); warn.className = 'set-warn'; warn.textContent = 'Auto-approve presses Yes for you. Anything that deletes files or force-pushes still waits for you.';
      b.append(
        group('Permissions', row('Auto-approve', 'Agents keep going without stopping to ask. In the app this also starts them with their skip-permissions flag.', setToggle('autoApprove', (on) => { if (on) { consoles().forEach((t) => { if (t.status === 'needs' && t.askFn && !t.risky) t.askFn(true); }); toast('Auto-approve is on'); } else toast('Agents will ask again'); })), warn),
        group('Questions', row('Answer with buttons', 'When an agent asks, a card with the diff and Yes / No buttons pops over its console.', setToggle('askCards'))),
        group('Talking', row('Hold Space to talk', 'Hold Space on the board and speak. Words land in the command bar.', setToggle('holdTalk'))),
        group('Context', row('Context ring', 'Shows how full each agent\'s memory is. Tap it to compact or clear.', setToggle('ctxRing', paintRings))),
        group('Wires', row('How wires hand over', 'Drag from the dot on a console\'s right edge onto another console. Tap the chip on the wire to pick: when done, every reply, only if it matches, review until APPROVED, or shared context once.', document.createElement('span'), true)),
      );
    } else {
      const sure = btn('Reset', (e) => { const x = e.currentTarget; if (!x.dataset.sure) { x.dataset.sure = 1; x.textContent = 'Tap again to reset'; setTimeout(() => { if (x.isConnected) { delete x.dataset.sure; x.textContent = 'Reset'; } }, 2500); return; } ['argon-demo-set', 'argon-demo-look', 'argon-demo-name', 'argon-demo-mem', 'argon-demo-onb', 'argon-demo-mode'].forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} }); location.reload(); }, 'chip danger');
      const keys = document.createElement('div'); keys.className = 'set-keys';
      [['Ctrl K', 'Command bar'], ['Ctrl M', 'Mission Map'], ['Space (hold)', 'Talk'], ['N', 'New agent'], ['F', 'Fit everything'], ['Ctrl .', 'Board / Pipeline']].forEach(([k, l]) => { const r = document.createElement('div'); r.innerHTML = '<kbd></kbd><span></span>'; r.querySelector('kbd').textContent = k; r.querySelector('span').textContent = l; keys.append(r); });
      b.append(
        group('This demo', row('Restart the demo', 'Puts every tile back where it started.', btn('Restart', () => location.reload())), row('Forget my settings', 'Clears your name, look, memory and settings from this browser.', sure)),
        group('Shortcuts', keys),
      );
      const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'In the app everything stays on your PC. Boards save as JSON with automatic backups.'; b.append(p);
    }
    b.scrollTop = top;
  }
  let actx = null;
  function chime() { if (!SET.sounds) return; try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; o.type = 'sine'; g.gain.setValueAtTime(.0001, actx.currentTime); g.gain.exponentialRampToValueAtTime(.12, actx.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + .35); o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + .4); } catch (_) {} }

  /* ---------- questions as buttons (with auto-approve) ---------- */
  const RISKY = /rm -rf|force|delete|drop table/i;
  function askUI(t, q) {
    t.risky = RISKY.test(q);
    const done = (ok, always) => { if (!card.isConnected) return; card.classList.add('gone'); setTimeout(() => card.remove(), 200); t.askFn = null; line(t, ok ? (always ? '2' : '1') : '3', 'p'); if (always) t.trust = true; if (!ok) t.queue = [['Okay, skipped that step.', 'd']]; setStatus(t, 'working'); };
    t.askFn = done;
    let card;
    if (!SET.askCards) {
      card = document.createElement('div'); card.className = 'ask';
      card.innerHTML = '<button class="yes" type="button">Allow</button><button class="no" type="button">Deny</button>';
      card.querySelector('.yes').onclick = (e) => { e.stopPropagation(); done(true); };
      card.querySelector('.no').onclick = (e) => { e.stopPropagation(); done(false); };
      t.body.append(card);
    } else {
      const file = (q.match(/[\w./-]+\.\w{2,4}/) || [])[0];
      card = document.createElement('div'); card.className = 'qcard';
      card.innerHTML = '<div class="qq"><i>?</i><span></span></div><div class="qb"><button type="button" class="y"><kbd>1</kbd>Yes</button><button type="button" class="a"><kbd>2</kbd>Yes, don\'t ask again</button><button type="button" class="n"><kbd>3</kbd>No</button></div>';
      card.querySelector('.qq span').textContent = q;
      if (file) {
        const pre = document.createElement('div'); pre.className = 'qd';
        if (t.el.offsetHeight >= 200) [['12 −', ' const yearly = price * 12;', 'del'], ['12 +', ' const yearly = round(price * 12 * 0.8);', 'add'], ['13 +', ' const per = yearly ? "/yr" : "/mo";', 'add']].forEach(([n, x, c]) => { const d = document.createElement('div'); d.className = c; d.textContent = n + x; pre.append(d); });
        else { pre.classList.add('one'); pre.innerHTML = '<span class="add">+2</span> <span class="del">−1</span> <span></span>'; pre.lastChild.textContent = file.split('/').pop(); }
        card.querySelector('.qq').after(pre);
      }
      card.querySelector('.y').onclick = (e) => { e.stopPropagation(); done(true); };
      card.querySelector('.a').onclick = (e) => { e.stopPropagation(); done(true, true); toast(`${t.name} won't ask about edits again`); };
      card.querySelector('.n').onclick = (e) => { e.stopPropagation(); done(false); };
      card.addEventListener('pointerdown', (e) => e.stopPropagation());
      t.el.append(card);
    }
    setStatus(t, 'needs');
    if ((SET.autoApprove || t.trust) && !t.risky) {
      card.classList.add('auto'); const tag = document.createElement('em'); tag.textContent = t.trust && !SET.autoApprove ? 'trusted · approving…' : 'auto-approving…'; (card.querySelector('.qq') || card).append(tag);
      setTimeout(() => done(true), 1000);
    } else {
      if (SET.autoApprove && t.risky) { const tag = document.createElement('em'); tag.className = 'risky'; tag.textContent = 'needs you: looks risky'; (card.querySelector('.qq') || card).append(tag); }
      if (SET.notify && $('#mx').hidden) toast(`${t.name} needs you`);
      chime();
    }
  }

  /* ---------- wires between consoles, each with a type ---------- */
  const MODES = { done: ['When done', 'hands over once the agent finishes'], reply: ['Every reply', 'forwards every reply'], if: ['Only if it matches', 'hands over only when the reply matches'], review: ['Review until APPROVED', 'the reviewer sends fixes back until it says APPROVED (5 rounds max)'], context: ['Shared context (once)', 'shares the reply once as background'] };
  const hw = [];
  const hsvg = document.createElementNS(NS, 'svg'); hsvg.id = 'hwires'; layers.board.prepend(hsvg);
  const replyOf = (t) => [...t.body.children].filter((d) => !/\b(d|p|w|ask)\b/.test(d.className)).slice(-2).map((d) => d.textContent).join(' · ') || 'Done.';
  function hEnds(a, b) {
    if (b.x >= a.x + a.w - 20) return [[a.x + a.w, a.y + 30], [b.x, b.y + 30], 1];
    if (b.x + b.w <= a.x + 20) return [[a.x, a.y + 30], [b.x + b.w, b.y + 30], -1];
    return b.y > a.y ? [[a.x + a.w / 2, a.y + a.h], [b.x + b.w / 2, b.y], 0] : [[a.x + a.w / 2, a.y], [b.x + b.w / 2, b.y + b.h], 0];
  }
  function hCurve([x1, y1], [x2, y2], dir) {
    if (dir === 0) { const c = Math.max(30, Math.abs(y2 - y1) / 2) * (y2 >= y1 ? 1 : -1); return `M${x1},${y1} C${x1},${y1 + c} ${x2},${y2 - c} ${x2},${y2}`; }
    const c = Math.max(50, Math.abs(x2 - x1) / 2) * dir; return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
  }
  const chipTxt = (w) => w.paused ? '⏸ paused' : w.mode === 'review' ? (w.state === 'approved' ? '✓ approved' : w.state === 'stuck' ? 'review ✕' : w.rounds ? `review ${w.rounds}/5` : 'review') : w.mode === 'if' ? `if /${w.pattern}/` : w.mode === 'context' ? (w.used ? 'context ✓' : 'context') : w.mode;
  function paintWires() {
    if (mode !== 'board') return;
    for (const w of hw.slice()) {
      if (!tiles.includes(w.from) || !tiles.includes(w.to)) { w.p && w.p.remove(); w.chip && w.chip.remove(); hw.splice(hw.indexOf(w), 1); continue; }
      if (!w.p) { w.p = document.createElementNS(NS, 'path'); hsvg.append(w.p); }
      if (!w.chip) { const c = w.chip = document.createElement('button'); c.type = 'button'; c.addEventListener('pointerdown', (e) => e.stopPropagation()); c.onclick = (e) => { e.stopPropagation(); wireMenu(w, e.clientX, e.clientY); }; layers.board.append(c); }
      const [p1, p2, dir] = hEnds(R(w.from), R(w.to)), d = hCurve(p1, p2, dir);
      if (w.p.getAttribute('d') !== d) w.p.setAttribute('d', d);
      w.p.setAttribute('class', 'm-' + w.mode + (w.waiting || w.from.status === 'working' ? ' flow' : '') + (w.state === 'approved' ? ' ok' : '') + (w.paused ? ' paused' : ''));
      w.p.style.setProperty('--wc', AG[w.from.agent][1]);
      const tx = chipTxt(w); if (w.chip.textContent !== tx) w.chip.textContent = tx;
      w.chip.className = 'wchip m-' + w.mode + (w.state === 'approved' ? ' ok' : '');
      const mid = w.p.getPointAtLength(w.p.getTotalLength() / 2); w.chip.style.transform = `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%)`;
    }
  }
  (function hLoop() { if (hw.length) paintWires(); requestAnimationFrame(hLoop); })();
  function hPacket(w, back) {
    if (!L.anim || !w.p) return;
    const c = document.createElementNS(NS, 'circle'); c.setAttribute('r', 6); c.setAttribute('class', 'packet'); c.style.setProperty('--pc', AG[(back ? w.to : w.from).agent][1]); hsvg.append(c);
    const len = w.p.getTotalLength(), t0 = performance.now(), dur = 700;
    const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, pt = w.p.getPointAtLength(len * (back ? 1 - e : e)); c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y); if (k < 1) requestAnimationFrame(step); else c.remove(); };
    requestAnimationFrame(step);
  }
  function addWire(a, b, m = 'done') { if (a === b || hw.some((w) => w.from === a && w.to === b)) return null; const w = { from: a, to: b, mode: m, pattern: m === 'if' ? 'fail|error' : '' }; hw.push(w); paintWires(); return w; }
  function wireMenu(w, x, y) {
    const items = Object.entries(MODES).map(([k, [l]]) => [(w.mode === k ? '✓  ' : '') + l, () => {
      Object.assign(w, { mode: k, used: false, state: null, rounds: 0, waiting: false, paused: false, auto: 0 }); if (k === 'if' && !w.pattern) w.pattern = 'pass|done';
      paintWires(); toast(`${l}: ${MODES[k][1]}`);
    }]);
    items.push(['Hand over now', () => { w.paused = false; w.auto = 0; w.used = false; hand(w, replyOf(w.from)); }], ['Remove wire', () => { w.p.remove(); w.chip.remove(); hw.splice(hw.indexOf(w), 1); toast('Wire removed'); }, true]);
    menu(x + 110, y + 10, items);
  }
  function twDone(t) {
    for (const w of hw.slice()) {
      if (w.mode === 'review' && w.waiting && w.to === t) { reviewed(w); continue; }
      if (w.from !== t || w.paused) continue;
      if (w.mode === 'context' && w.used) continue;
      if (w.mode === 'review' && (w.state === 'approved' || w.state === 'stuck')) continue;
      const text = replyOf(t);
      if (w.mode === 'if') { let ok; try { ok = new RegExp(w.pattern || '.', 'i').test(text); } catch (_) { ok = false; } if (!ok) { toast(`${t.name}'s reply didn't match /${w.pattern}/, so nothing went to ${w.to.name}`); continue; } }
      w.auto = (w.auto || 0) + 1; if (w.auto > 8) { w.paused = true; toast(`Paused ${t.name} → ${w.to.name}: it fired 8 times in a row`); continue; }
      if (w.mode === 'context') w.used = true;
      hand(w, text);
    }
  }
  function hand(w, text) {
    const to = w.to, from = w.from; hPacket(w, false);
    setTimeout(() => {
      if (!tiles.includes(to)) return;
      if (w.mode === 'review') {
        w.waiting = true; w.state = 'reviewing';
        line(to, `> Review ${from.name}'s work. Reply APPROVED or list fixes.`, 'p');
        to.queue = (w.rounds ? [['Re-checking the fixes…', 'd'], ['Looks right now, 31 tests pass', 'ok'], ['APPROVED', 'b']] : [['Reading the diff…', 'd'], ['Toggle has no aria-label; yearly price rounds wrong', 'w'], ['Fixes: add an aria-label, round to cents', 'b']]).map((x) => [...x]);
        to.wait = 1; setStatus(to, 'working');
      } else if (w.mode === 'context') { line(to, `> Context from ${from.name}: ${text}`, 'p'); to.queue = [['Noted for later', 'b']]; to.wait = 1; setStatus(to, 'working'); }
      else respond(to, `${from.name} says: ${text}`.slice(0, 110));
      paintWires();
    }, 650);
  }
  function reviewed(w) {
    w.waiting = false; const text = replyOf(w.to);
    if (/APPROVED/.test(text)) { w.state = 'approved'; paintWires(); toast(`${w.to.name} approved ${w.from.name}'s work`); return; }
    w.rounds = (w.rounds || 0) + 1;
    if (w.rounds >= 5) { w.state = 'stuck'; toast('Review stopped after 5 rounds'); return; }
    w.state = 'fixing'; paintWires(); hPacket(w, true);
    setTimeout(() => { const f = w.from; if (!tiles.includes(f)) return; line(f, `> ${w.to.name} asked for fixes (round ${w.rounds} of 5): ${text}`, 'p'); f.queue = [['Fixing the review notes…', 'd'], ['Editing src/pricing/Toggle.tsx  +3 −1', 'ok'], ['Fixed: aria-label added, prices round to cents', 'b']]; f.wait = 1; setStatus(f, 'working'); }, 650);
  }
  function dragWire(t, e) {
    const tmp = document.createElementNS(NS, 'path'); tmp.setAttribute('class', 'temp'); hsvg.append(tmp); let hot = null;
    const hit = (m) => { for (const el of document.elementsFromPoint(m.clientX, m.clientY)) { const c = el.closest && el.closest('#L-board .tile.console'); if (c && c !== t.el) return tiles.find((x) => x.el === c); } return null; };
    const move = (m) => { const a = R(t), [x, y] = toWorld(m.clientX, m.clientY); tmp.setAttribute('d', hCurve([a.x + a.w, a.y + 30], [x, y], x >= a.x + a.w ? 1 : -1)); const n = hit(m); if (n !== hot) { hot && hot.el.classList.remove('wire-hot'); hot = n; hot && hot.el.classList.add('wire-hot'); } };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); tmp.remove(); if (!hot) return; hot.el.classList.remove('wire-hot'); const w = addWire(t, hot); if (w) { toast(`${t.name} → ${hot.name}. Tap the chip on the wire to pick how it hands over.`); hPacket(w); } };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up); move(e);
  }

  /* ---------- context ring ---------- */
  function twDecorate(t) {
    const dot = document.createElement('div'); dot.className = 'wdot'; dot.title = 'Drag onto another console to hand work over'; t.el.append(dot);
    dot.addEventListener('pointerdown', (e) => { if (t.space !== 'board') return; e.stopPropagation(); e.preventDefault(); dragWire(t, e); });
    if (t.agent === 'shell') return;
    const ring = t.ring = document.createElement('button'); ring.type = 'button'; ring.className = 'ctx'; ring.setAttribute('aria-label', 'Context used');
    ring.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="bg" cx="10" cy="10" r="7.5"/><circle class="fg" cx="10" cy="10" r="7.5" pathLength="100"/></svg><span></span>';
    ring.addEventListener('pointerdown', (e) => e.stopPropagation());
    ring.onclick = (e) => { e.stopPropagation(); const r = ring.getBoundingClientRect(); menu(r.right + 60, r.bottom + 6, [[`Compact · keeps a summary`, () => compact(t)], [`Clear · starts fresh`, () => clearCtx(t), true]]); };
    t.el.querySelector('.badge').before(ring);
  }
  const pctOf = (t) => Math.min(100, Math.round(t.tokens / 2000));
  function paintRings() {
    for (const t of consoles()) { if (!t.ring) continue; t.ring.hidden = !SET.ctxRing; const p = pctOf(t); if (t.ring.dataset.p === String(p)) continue; t.ring.dataset.p = p; t.ring.querySelector('.fg').style.strokeDasharray = `${p} 100`; t.ring.querySelector('span').textContent = p + '%'; t.ring.classList.toggle('warn', p >= 60 && p < 85); t.ring.classList.toggle('hot', p >= 85); t.ring.title = `Context: ${Math.round(t.tokens / 1000)}k of 200k tokens. Tap to compact or clear.`; }
  }
  setInterval(paintRings, 1000);
  function compact(t) { const k = Math.round(t.tokens / 1000); t.tokens = Math.round(t.tokens * .18); line(t, '> /compact', 'p'); t.queue = [['Compacting the conversation…', 'd'], [`Kept a summary · ${k}k → ${Math.round(t.tokens / 1000)}k tokens`, 'ok']]; t.wait = 1; setStatus(t, 'working'); paintRings(); }
  function clearCtx(t) { t.tokens = 1200; t.queue = []; t.body.innerHTML = ''; line(t, '> /clear', 'p'); line(t, 'Started a fresh conversation', 'd'); setStatus(t, 'resting'); paintRings(); toast(`Cleared ${t.name}`); }

  /* ---------- team presets ---------- */
  const PRESETS = [
    ['Plan → Build → Review', ['Planner', 'Builder', 'Reviewer'], [[0, 1, 'done'], [1, 2, 'review']], 'Plan the pricing page'],
    ['Build → Review', ['Builder', 'Reviewer'], [[0, 1, 'review']], 'Build the monthly/yearly toggle'],
    ['Fix → Test', ['Fixer', 'Tester'], [[0, 1, 'done'], [1, 0, 'if']], 'Fix the yearly price rounding'],
    ['Research → Write', ['Researcher', 'Writer'], [[0, 1, 'done']], 'Compare 3 competitor pricing pages'],
    ['Manager + team of 3', ['Builder 1', 'Builder 2', 'Builder 3'], [], null, true],
  ];
  const altAgent = (k) => k === 'codex' ? 'claude' : 'codex';
  function spawnTeam(p) {
    if (mode !== 'board') setMode('board');
    const [name, roles, wires, task, withMgr] = p, v = V(), W = v ? 280 : 330, H = v ? 160 : 190;
    const color = GC[(groups.length + 2) % GC.length], onBoard = tiles.filter((t) => t.space === 'board' && !t.stage).concat(groups);
    // a clear spot: under everything already on the board
    const x0 = onBoard.length ? Math.min(...onBoard.map((t) => t.x)) : 0, y0 = onBoard.length ? Math.max(...onBoard.map((t) => t.y + t.h)) + 90 : 0;
    const cx = x0 + 300, cy = y0 + 160;
    const g = makeGroup(name.replace(/→/g, '›'), color, cx - 300, cy - 160);
    const ts = roles.map((r, i) => {
      const k = i === roles.length - 1 && roles.length > 1 && !withMgr ? altAgent(SET.defAgent) : SET.defAgent;
      const t = spawnAgent(k, { space: 'board', pos: [cx - 300 + i * (W + 16), cy - 110], size: [W, H], group: g });
      t.name = r; t.el.querySelector('b').textContent = r; line(t, `${AG[k][0]} ready · ${r}`, 'd'); return t;
    });
    fitGroup(g, true); wires.forEach(([a, b, m]) => addWire(ts[a], ts[b], m));
    let m = null;
    if (withMgr) { m = v ? makeManager(g.x, g.y + g.h + 40, 300) : makeManager(g.x + g.w + 60, g.y, 340); enter(m.el); m.links = [g]; m.tasks.set(g, 'Build the pricing page and its tests'); paintManager(m); }
    paintChip(ts[0]); renderMission();
    const box = [g, m].filter(Boolean).reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }));
    setTimeout(() => flyTo(box), 120);
    if (task) setTimeout(() => respond(ts[0], task), 1100);
    toast(withMgr ? 'Team ready. Tap ▶ Run the team on the Manager.' : `Started ${name}. Watch the wires hand the work along.`);
  }
  $('#d-presets').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.right + 250, r.top, PRESETS.map((p) => [p[0], () => spawnTeam(p)])); };

  /* ---------- talk instead of typing ---------- */
  let dictT = 0, dictRec = null, holdT = 0, holding = false;
  function dictate() {
    const inp = $('#cmd-input'), form = $('#cmd-form');
    if (openSheet !== '#s-cmd') show('#s-cmd');
    form.classList.add('listening');
    const fake = () => { const say = 'add a yearly toggle to the pricing page'; inp.value = ''; let i = 0; clearInterval(dictT); dictT = setInterval(() => { inp.value = say.slice(0, ++i); if (i >= say.length) { clearInterval(dictT); form.classList.remove('listening'); toast('Sample words: this page can\'t use your mic. In the app, hold Space and talk.'); } }, 34); };
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { fake(); return; }
    try {
      const r = dictRec = new SR(); let got = false; r.lang = navigator.language || 'en-US'; r.interimResults = true;
      r.onresult = (ev) => { got = true; inp.value = [...ev.results].map((x) => x[0].transcript).join(''); };
      r.onerror = () => { dictRec = null; if (!got) fake(); else form.classList.remove('listening'); };
      r.onend = () => { dictRec = null; if (got) form.classList.remove('listening'); };
      r.start();
    } catch (_) { fake(); }
  }
  $('#cmd-mic').onclick = (e) => { e.preventDefault(); dictate(); };
  const typing = (e) => e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
  addEventListener('keydown', (e) => { if (e.code !== 'Space' || e.repeat || typing(e) || !SET.holdTalk || !$('#onb').hidden) return; e.preventDefault(); clearTimeout(holdT); holdT = setTimeout(() => { holding = true; dictate(); }, 450); });
  addEventListener('keyup', (e) => { if (e.code !== 'Space') return; clearTimeout(holdT); if (holding) { holding = false; try { dictRec && dictRec.stop(); } catch (_) {} } });
  addEventListener('pointerdown', () => clearTimeout(holdT), true);

  /* ---------- Mission Map: leads → teams → consoles ---------- */
  const mx = document.createElement('div'); mx.id = 'mx'; mx.hidden = true;
  mx.innerHTML = `<div class="mx-panel lg strong" role="dialog" aria-label="Mission Map"><header class="mx-head"><span class="mx-logo">__MAPSVG__</span><div class="mx-tt"><b>Mission Map</b><span class="mx-sub"></span></div><button class="ib" type="button" data-mx="set" aria-label="Settings" title="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/></svg></button><button class="ib" type="button" data-mx="close" aria-label="Close">✕</button></header><div class="mx-bar"><div class="mx-chips"></div><label class="mx-find"><span aria-hidden="true">⌕</span><input type="text" placeholder="Find a console or team" autocomplete="off" aria-label="Find a console or team"></label></div><div class="mx-body"><div class="mx-scroll"><div class="mx-graph"></div></div><aside class="mx-detail"></aside></div><footer class="mx-legend"><span><i class="sdot working"></i>Working</span><span><i class="sdot needs"></i>Needs you</span><span><i class="sdot"></i>Idle</span><span><i class="mx-dash"></i>Command bar only</span></footer></div>`;
  document.body.append(mx);
  const MX = { f: 'all', q: '', sel: null, mod: null };
  const LBL = { working: 'Working', needs: 'Needs you', resting: 'Idle', starting: 'Starting' };
  const stOf = (t) => t.status === 'starting' ? 'working' : t.status;
  function mxModel() {
    const cs = consoles(), teams = new Map();
    const tOf = (t) => t.space === 'pipe' ? (t.stage ? { key: 's' + t.stage.id, name: t.stage.title, color: STAGES[t.stage.key].color, ref: t.stage, kind: 'Pipeline stage' } : { key: 'pipe', name: 'Pipeline (no stage)', color: 'var(--dim)', kind: 'Pipeline' }) : t.group ? { key: 'g' + t.group.id, name: t.group.title, color: t.group.color, ref: t.group, kind: 'Team' } : { key: 'none', name: 'Ungrouped', color: 'var(--dim)', kind: 'No group' };
    cs.forEach((t) => { const x = tOf(t); if (!teams.has(x.key)) teams.set(x.key, { ...x, members: [] }); teams.get(x.key).members.push(t); });
    const leads = tiles.filter((t) => t.kind === 'manager').map((m) => { const ks = new Set(); mTargets(m).forEach((x) => { if (x.kind === 'group') ks.add('g' + x.id); else if (x.kind === 'console') ks.add(tOf(x).key); }); return { key: 'm' + m.id, name: m.title, ref: m, teams: ks, sub: m.running ? 'running the team' : 'Manager' }; });
    const pipeKeys = [...teams.keys()].filter((k) => k[0] === 's' || k === 'pipe');
    if (pipeKeys.length) leads.push({ key: 'pipe', name: 'Pipeline', pipe: true, teams: new Set(pipeKeys), sub: running ? 'running' : 'stage by stage' });
    const owned = new Set(leads.flatMap((l) => [...l.teams])), loose = [...teams.keys()].filter((k) => !owned.has(k));
    if (loose.length) leads.push({ key: 'you', name: 'You', you: true, teams: new Set(loose), sub: 'command bar' });
    const order = [...teams.values()].sort((a, b) => (a.key === 'none') - (b.key === 'none') || (a.key[0] === 's') - (b.key[0] === 's'));
    return { cs, teams: order, leads };
  }
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  function openMx() {
    if (!mx.hidden) { closeMx(); return; }
    hide(); closeMenu(); mx.hidden = false; void mx.offsetWidth; mx.classList.add('in'); mxPaint(); sync();
  }
  function closeMx() { mx.classList.remove('in'); mx.classList.remove('peek'); setTimeout(() => { if (!mx.classList.contains('in')) mx.hidden = true; sync(); }, L.anim ? 260 : 0); }
  mx.addEventListener('pointerdown', (e) => { if (e.target === mx) closeMx(); });
  $('[data-mx="close"]', mx).onclick = closeMx;
  $('[data-mx="set"]', mx).onclick = () => { closeMx(); setTab = 'general'; setTimeout(() => show('#s-settings'), 120); };
  $('.mx-find input', mx).addEventListener('input', (e) => { MX.q = e.target.value.trim().toLowerCase(); mxPaint(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mx.hidden) { e.stopPropagation(); closeMx(); } }, true);
  let mxT = 0; window.__mxPaint = () => { if (mx.hidden) return; clearTimeout(mxT); mxT = setTimeout(mxPaint, 120); };
  const vis = (t, tm) => (MX.f === 'all' || stOf(t) === MX.f) && (!MX.q || [t.name, t.role, AG[t.agent][0], tm.name].some((x) => x && x.toLowerCase().includes(MX.q)));
  function mxPaint() {
    const mod = MX.mod = mxModel(), chips = $('.mx-chips', mx), g = $('.mx-graph', mx), sc = $('.mx-scroll', mx).scrollTop;
    const n = (f) => mod.cs.filter((t) => f === 'all' || stOf(t) === f).length;
    chips.innerHTML = '';
    [['all', 'All'], ['working', 'Working'], ['needs', 'Needs you'], ['resting', 'Idle']].forEach(([k, l]) => { const c = el('button', 'mx-chip' + (MX.f === k ? ' on' : '')); c.type = 'button'; if (k !== 'all') c.append(el('i', 'sdot ' + (k === 'resting' ? '' : k))); c.append(l, el('b', '', String(n(k)))); c.onclick = () => { MX.f = k; mxPaint(); }; chips.append(c); });
    const nl = mod.leads.filter((l) => !l.you).length, nt = mod.teams.filter((t) => t.key !== 'none').length;
    $('.mx-sub', mx).textContent = `${nl} orchestrator${nl === 1 ? '' : 's'} · ${nt} team${nt === 1 ? '' : 's'} · ${mod.cs.length} consoles · ${n('working')} working`;
    g.innerHTML = '';
    const lines = document.createElementNS(NS, 'svg'); lines.setAttribute('class', 'mx-lines'); g.append(lines);
    const leadCol = el('div', 'mx-col mx-leads'), rows = el('div', 'mx-col mx-rows'); g.append(leadCol, rows);
    const shown = new Set();
    for (const tm of mod.teams) {
      const v = tm.members.filter((t) => vis(t, tm)); if (!v.length && (MX.f !== 'all' || MX.q)) continue; shown.add(tm.key);
      const wk = tm.members.filter((t) => stOf(t) === 'working').length, nd = tm.members.filter((t) => t.status === 'needs').length;
      const card = el('button', 'mx-node mx-team' + (nd ? ' needs' : wk ? ' working' : '') + (MX.sel === 'team:' + tm.key ? ' sel' : '')); card.type = 'button'; card.dataset.k = 'team:' + tm.key; card.style.setProperty('--tc', tm.color);
      card.append(el('i', 'mx-tdot')); const nt2 = el('span', 'mx-nt'); nt2.append(el('b', '', tm.name), el('small', '', `${tm.members.length} agent${tm.members.length === 1 ? '' : 's'}${wk ? ` · ${wk} working` : ''}${nd ? ` · ${nd} need you` : ''}`)); card.append(nt2, el('span', 'mx-count', String(tm.members.length)));
      card.onclick = () => mxPick('team:' + tm.key);
      const list = el('div', 'mx-cons');
      v.forEach((t) => { const st = stOf(t), r = el('button', 'mx-node mx-con ' + st + (MX.sel === 'con:' + t.id ? ' sel' : '')); r.type = 'button'; r.dataset.k = 'con:' + t.id; r.append(el('i', 'sdot ' + (st === 'resting' ? '' : st))); const nt3 = el('span', 'mx-nt'), b = el('b', '', t.name), em = el('em', '', AG[t.agent][0].split(' ')[0]); em.style.color = AG[t.agent][1]; b.append(em); nt3.append(b, el('small', '', `${LBL[st]}${t.agent !== 'shell' ? ' · ' + pctOf(t) + '% context' : ''}`)); r.append(nt3, el('span', 'mx-go', '›')); r.onclick = () => mxPick('con:' + t.id); r.ondblclick = () => mxGo(t); list.append(r); });
      const row2 = el('div', 'mx-row'); row2.append(card, list); rows.append(row2);
    }
    for (const l of mod.leads) {
      const k = [...l.teams].filter((x) => shown.has(x)).length; if (!k && (MX.f !== 'all' || MX.q)) continue;
      const b = el('button', 'mx-node mx-lead' + (l.you ? ' you' : '') + ((l.ref && l.ref.running) || (l.pipe && running) ? ' working' : '') + (MX.sel === 'lead:' + l.key ? ' sel' : '')); b.type = 'button'; b.dataset.k = 'lead:' + l.key;
      b.append(el('span', 'mx-lico', l.you ? '›_' : l.pipe ? '⧉' : '◎')); const nt4 = el('span', 'mx-nt'); nt4.append(el('b', '', l.name), el('small', '', `${k} team${k === 1 ? '' : 's'} · ${l.sub}`)); b.append(nt4, el('span', 'mx-count', String(k)));
      b.onclick = () => mxPick('lead:' + l.key); leadCol.append(b);
    }
    if (!mod.cs.length) g.append(el('div', 'mx-empty', 'No consoles yet. Tap ›_ in the dock or start a team from presets.'));
    if (!MX.sel || !g.querySelector(`[data-k="${MX.sel}"]`)) { const f = mod.cs.slice().sort((a, b) => (b.status === 'needs') - (a.status === 'needs')).find((t) => g.querySelector(`[data-k="con:${t.id}"]`)); MX.sel = f ? 'con:' + f.id : null; MX.sel && g.querySelector(`[data-k="${MX.sel}"]`).classList.add('sel'); }
    $('.mx-scroll', mx).scrollTop = sc;
    requestAnimationFrame(mxLines); mxDetail();
  }
  function mxPick(k) { MX.sel = k; $$('.mx-node.sel', mx).forEach((x) => x.classList.remove('sel')); mx.querySelector(`[data-k="${k}"]`)?.classList.add('sel'); mxLines(); mxDetail(); if (V()) mx.classList.add('peek'); }
  function mxGo(t) { closeMx(); if (t.space !== mode) setMode(t.space); setTimeout(() => flyTo(t.stage ? R(t.stage) : t), 60); }
  function mxLines() {
    const g = $('.mx-graph', mx), svgL = $('.mx-lines', g); if (!svgL || !MX.mod) return; svgL.innerHTML = '';
    if (V()) return;
    const base = g.getBoundingClientRect(); svgL.setAttribute('width', g.scrollWidth); svgL.setAttribute('height', g.scrollHeight);
    const pt = (e, right) => { const r = e.getBoundingClientRect(); return [(right ? r.right : r.left) - base.left, r.top + r.height / 2 - base.top]; };
    const path = (a, b, cls) => { const c = Math.max(36, (b[0] - a[0]) * .5), p = document.createElementNS(NS, 'path'); p.setAttribute('d', `M${a[0]},${a[1]} C${a[0] + c},${a[1]} ${b[0] - c},${b[1]} ${b[0]},${b[1]}`); p.setAttribute('class', cls); svgL.append(p); };
    const sel = MX.sel || '';
    for (const l of MX.mod.leads) { const le = g.querySelector(`[data-k="lead:${l.key}"]`); if (!le) continue; for (const k of l.teams) { const te = g.querySelector(`[data-k="team:${k}"]`); if (!te) continue; const hot = sel === 'lead:' + l.key || sel === 'team:' + k || (sel.startsWith('con:') && te.parentNode.querySelector(`[data-k="${sel}"]`)); path(pt(le, 1), pt(te, 0), (l.you ? 'dash ' : '') + (te.classList.contains('needs') ? 'needs ' : te.classList.contains('working') ? 'working ' : '') + (hot ? 'hot' : '')); } }
    for (const row of $$('.mx-row', g)) { const te = $('.mx-team', row); for (const ce of $$('.mx-con', row)) path(pt(te, 1), pt(ce, 0), (ce.classList.contains('needs') ? 'needs ' : ce.classList.contains('working') ? 'working ' : '') + (sel === ce.dataset.k || sel === te.dataset.k ? 'hot' : '')); }
  }
  const sec = (title, ...kids) => { const s = el('section', 'mx-sec'); s.append(el('div', 'mx-sh', title), ...kids.filter(Boolean)); return s; };
  const kv = (k, v) => { const r = el('div', 'mx-kv'); r.append(el('span', '', k), typeof v === 'string' ? el('b', '', v) : v); return r; };
  const lnk = (name, sub, color, fn, dash) => { const b = el('button', 'mx-link'); b.type = 'button'; const i = el('i', dash ? 'dash' : ''); i.style.background = color; const s2 = el('span'); s2.append(el('b', '', name), el('small', '', sub)); b.append(i, s2, el('span', 'mx-chev', '›')); b.onclick = fn; return b; };
  const msg = (ph, fn) => { const f = el('form', 'mx-msg'); const i = el('input'); i.placeholder = ph; i.setAttribute('aria-label', ph); f.append(i); f.onsubmit = (e) => { e.preventDefault(); if (i.value.trim()) { fn(i.value.trim()); i.value = ''; } }; return f; };
  function mxDetail() {
    const d = $('.mx-detail', mx); d.innerHTML = ''; const [kind, id] = (MX.sel || '').split(':'); const mod = MX.mod;
    const back = el('button', 'mx-back', '‹ Map'); back.type = 'button'; back.onclick = () => mx.classList.remove('peek'); d.append(back);
    const head = (ico, color, name, sub, tag) => { const h2 = el('div', 'mx-dh'), ic = el('span', 'mx-dico', ico); ic.style.background = color; const tx = el('div'); tx.append(el('b', '', name)); const sm = el('small', '', sub); if (tag) { const em = el('em', '', tag.name); em.style.setProperty('--tc', tag.color); sm.append(em); } tx.append(sm); h2.append(ic, tx); return h2; };
    if (kind === 'con') {
      const t = mod.cs.find((x) => String(x.id) === id); if (!t) return;
      const st = stOf(t), tm = mod.teams.find((x) => x.members.includes(t)), lead = tm && mod.leads.find((l) => l.teams.has(tm.key));
      const go = el('button', 'mx-primary', '↗ Go to the console'); go.type = 'button'; go.onclick = () => mxGo(t);
      const pair = el('div', 'mx-pair');
      const pause = el('button', 'mx-sec2', '❚❚ Pause'); pause.type = 'button'; pause.onclick = () => { t.queue = []; t.wait = 0; t.askFn && t.askFn(false); line(t, '^C interrupted', 'w'); setStatus(t, 'resting'); toast(`Paused ${t.name}`); };
      const kill = el('button', 'mx-sec2 danger', '⊘ Kill'); kill.type = 'button'; kill.onclick = () => { if (!kill.dataset.sure) { kill.dataset.sure = 1; kill.textContent = 'Tap again'; setTimeout(() => { if (kill.isConnected) { delete kill.dataset.sure; kill.textContent = '⊘ Kill'; } }, 2400); return; } closeTile(t); };
      pair.append(pause, kill);
      const meter = el('span', 'mx-meter'); const tr = el('span', 'mx-track'), fi = el('i'); fi.style.width = pctOf(t) + '%'; tr.append(fi); meter.append(tr, pctOf(t) + '%');
      const lastP = [...t.body.querySelectorAll('.p')].map((x) => x.textContent).filter((x) => x.startsWith('> ')).pop();
      d.append(head(AG[t.agent][0][0], AG[t.agent][1], t.name, AG[t.agent][0] + ' ', tm && tm.key !== 'none' ? tm : null), go, pair,
        sec('Now', kv('Status', el('b', 'mx-st ' + st, LBL[st])), kv('Task', (lastP ? lastP.slice(2) : t.space === 'pipe' ? t.role : 'Waiting for a task').slice(0, 60)), t.agent !== 'shell' ? kv('Context', meter) : null));
      if (t.status === 'needs' && t.askFn) { const q = [...t.body.querySelectorAll('.w')].pop(); const qb = el('div', 'mx-qb'); [['Yes', () => t.askFn(true)], ['Yes, don\'t ask again', () => t.askFn(true, true)], ['No', () => t.askFn(false)]].forEach(([l, fn], i) => { const b = el('button', 'mx-sec2' + (i === 0 ? ' yes' : ''), l); b.type = 'button'; b.onclick = fn; qb.append(b); }); d.append(sec('Asking', el('div', 'mx-q', q ? q.textContent.replace(/ \(y\/n\)$/, '') : 'Waiting for you'), qb)); }
      const bl = []; if (tm) bl.push(lnk(tm.name, tm.kind, tm.color, () => mxPick('team:' + tm.key))); if (lead) bl.push(lnk(lead.name, lead.you ? 'Through the command bar' : lead.pipe ? 'Runs stage by stage' : 'Orchestrator', 'var(--accent)', () => mxPick('lead:' + lead.key), lead.you)); d.append(sec('Belongs to', ...bl));
      const ws = hw.filter((w) => w.from === t || w.to === t); if (ws.length) d.append(sec('Wires', ...ws.map((w) => { const r = el('div', 'mx-wire'); r.append(el('span', '', w.from === t ? `→ ${w.to.name}` : `← ${w.from.name}`), el('em', '', chipTxt(w))); return r; })));
      if (t.agent !== 'shell') d.append(sec('Message', msg('Type and press Enter', (x) => { respond(t, x); toast(`Sent to ${t.name}`); })));
    } else if (kind === 'team') {
      const tm = mod.teams.find((x) => x.key === id); if (!tm) return; const lead = mod.leads.find((l) => l.teams.has(tm.key));
      d.append(head('⬚', tm.color, tm.name, `${tm.members.length} agents · ${tm.kind}`));
      if (tm.ref) { const go = el('button', 'mx-primary', '↗ Go to the team'); go.type = 'button'; go.onclick = () => { closeMx(); const sp = tm.key[0] === 's' ? 'pipe' : 'board'; if (sp !== mode) setMode(sp); setTimeout(() => flyTo(sp === 'pipe' ? R(tm.ref) : tm.ref), 60); }; d.append(go); }
      d.append(sec('Members', ...tm.members.map((t) => lnk(t.name, `${AG[t.agent][0]} · ${LBL[stOf(t)]}`, AG[t.agent][1], () => mxPick('con:' + t.id)))));
      if (lead) d.append(sec('Led by', lnk(lead.name, lead.you ? 'Through the command bar' : lead.sub, 'var(--accent)', () => mxPick('lead:' + lead.key), lead.you)));
      d.append(sec('Order the team', msg('Sent to every agent here', (x) => { const cs = tm.members.filter((t) => t.agent !== 'shell'); cs.forEach((t) => respond(t, x)); toast(`Sent to ${cs.length} agents`); })));
    } else if (kind === 'lead') {
      const l = mod.leads.find((x) => x.key === id); if (!l) return; const ts = mod.teams.filter((x) => l.teams.has(x.key));
      d.append(head(l.you ? '›_' : l.pipe ? '⧉' : '◎', 'var(--accent)', l.name, l.you ? 'You lead these through the command bar' : l.pipe ? 'Hands work from stage to stage' : 'Manager'));
      const go = el('button', 'mx-primary', l.you ? '›_ Open the command bar' : l.pipe ? '↗ Go to the pipeline' : '↗ Go to the Manager'); go.type = 'button';
      go.onclick = () => { closeMx(); if (l.you) setTimeout(() => show('#s-cmd'), 150); else if (l.pipe) setMode('pipe'); else { if (mode !== 'board') setMode('board'); setTimeout(() => flyTo(l.ref), 60); } };
      d.append(go);
      if (l.ref && l.ref.goalEl) d.append(sec('Goal', el('div', 'mx-q', l.ref.goalEl.value)));
      d.append(sec('Teams', ...(ts.length ? ts.map((x) => lnk(x.name, `${x.members.length} agents`, x.color, () => mxPick('team:' + x.key))) : [el('div', 'mx-q', 'No teams yet. Drag the Manager\'s socket onto a group.')])));
    }
  }
  addEventListener('resize', () => { if (!mx.hidden) mxLines(); });
