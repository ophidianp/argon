import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, a[:70]
    s = s.replace(a, b)
# A "Tell it what to do" bar at the bottom of every agent console.
rep("""<button class="tb x" data-a="close" type="button" aria-label="Close" title="Close">✕</button></span></div><div class="tbody"></div>';
    el.querySelector('b').textContent = name;""", """<button class="tb x" data-a="close" type="button" aria-label="Close" title="Close">✕</button></span></div><div class="tbody"></div><form class="tell"><input type="text" autocomplete="off" enterkeyhint="send"><button type="submit" aria-label="Send" title="Send (Enter)">↵</button></form>';
    el.querySelector('b').textContent = name;""")
rep("""    tiles.push(t); paintChip(t); wireButtons(t); dragTile(t); twDecorate(t); return t;""", """    const tf = el.querySelector('.tell'), ti = tf.firstChild; ti.placeholder = agent === 'shell' ? `Run a command in ${name}…` : `Tell ${name} what to do…`; ti.setAttribute('aria-label', ti.placeholder);
    tf.addEventListener('pointerdown', (e) => e.stopPropagation());
    tf.addEventListener('submit', (e) => {
      e.preventDefault(); const v = ti.value.trim(); if (!v) return; ti.value = '';
      if (t.agent === 'shell') { line(t, '$ ' + v, 'p'); line(t, 'done', 'd'); return; }
      respond(t, v); const out = hw.filter((w) => w.from === t);
      toast(out.length ? `${t.name} is on it. When it finishes, the wire hands off to ${out.map((w) => w.to.name).join(' and ')}` : `${t.name} is on it`);
    });
    tiles.push(t); paintChip(t); wireButtons(t); dragTile(t); twDecorate(t); return t;""")
css = """
.tell { flex: none; display: flex; align-items: center; gap: 4px; margin: 0 6px 6px; padding: 2px 2px 2px 10px; border-radius: 9px; background: rgba(0,0,0,.22); box-shadow: inset 0 0 0 1px rgba(255,255,255,.07); transition: box-shadow .2s, background .2s; }
.tell:focus-within { background: rgba(0,0,0,.32); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-light) 55%, transparent); }
.tell input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--term-text); font: 12px/1 var(--mono); padding: 6px 0; }
.tell input::placeholder { color: color-mix(in srgb, var(--term-text) 42%, transparent); }
.tell button { flex: none; width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; color: color-mix(in srgb, var(--term-text) 60%, transparent); font-size: 13px; }
.tell button:hover { color: var(--text); background: rgba(255,255,255,.08); }
@media (max-width: 640px) { .tell input { font-size: 16px; } }
.tile.docked .tell { display: none; }
"""
i = s.index('</style>'); s = s[:i] + css + s[i:]
open(p, 'w', encoding='utf-8').write(s)
print('ok')
