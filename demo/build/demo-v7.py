import sys, re
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
def rep(a, b, n=1):
    global s
    c = s.count(a)
    assert c == n, (a[:80], c)
    s = s.replace(a, b)

MAPSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/></svg>'

# ---------- markup ----------
rep('<button class="ib" type="button" id="b-mission" aria-label="Mission map" title="Mission map (Ctrl+M)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    '<button class="ib" type="button" id="b-mission" aria-label="Mission Map" title="Mission Map (Ctrl+M)">' + MAPSVG)
rep('<div class="sh-head"><h2>Make it yours</h2>', '<div class="sh-head"><h2>Settings</h2>')
rep('<button class="send" type="submit">Send</button></form>\n    <div class="chips" id="cmd-chips"></div>',
    '<button class="mic" type="button" id="cmd-mic" aria-label="Dictate" title="Dictate (hold Space on the board)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button><button class="send" type="submit">Send</button></form>\n    <div class="chips" id="cmd-chips"></div>')
rep('<p class="hint">In the app this is <b>Ctrl K</b>.', '<p class="hint">In the app this is <b>Ctrl K</b>. Hold <b>Space</b> on the board to talk instead of typing.')
# presets button in the dock, right before the Manager
i = s.index('<button class="ib accent" type="button" data-add="manager"')
s = s[:i] + '<button class="ib" type="button" id="d-presets" data-only="board" aria-label="Team presets" title="Team presets: start a wired team"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="6" rx="2"/><rect x="14" y="4" width="7" height="6" rx="2"/><rect x="8.5" y="14" width="7" height="6" rx="2"/><path d="M10 7h4M6.5 10v2.5a1.5 1.5 0 0 0 1.5 1.5h.5M17.5 10v2.5a1.5 1.5 0 0 1-1.5 1.5h-.5"/></svg></button>\n  ' + s[i:]

# ---------- hooks into the existing script ----------
rep("tiles.push(t); paintChip(t); wireButtons(t); dragTile(t); return t;", "tiles.push(t); paintChip(t); wireButtons(t); dragTile(t); twDecorate(t); return t;")
rep("        if (t.status !== 'resting') setStatus(t, 'resting');\n        if (t.mgr)", "        if (t.status !== 'resting') { setStatus(t, 'resting'); twDone(t); }\n        if (t.mgr)")
a = s.index("        const ask = document.createElement('div'); ask.className = 'ask';")
b = s.index("toast(`${t.name} needs you`);", a) + len("toast(`${t.name} needs you`);")
s = s[:a] + "        askUI(t, q);" + s[b:]
rep("t.body.querySelector('.ask')?.remove();", "t.el.querySelector('.qcard')?.remove();")
rep("    if (openSheet === '#s-usage') renderUsage();\n", "    if (openSheet === '#s-usage') renderUsage();\n    window.__mxPaint && window.__mxPaint();\n")
rep("""    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') { e.preventDefault(); show('#s-mission'); }""", """    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') { e.preventDefault(); openMx(); }""")
rep("$('#b-mission').onclick = () => show('#s-mission');", "$('#b-mission').onclick = () => openMx();")
rep("  if (wide()) $('#s-mission').classList.add('on');\n", "")
rep("$('#s-mission').classList.toggle('on', wasWide);", "$('#s-mission').classList.remove('on');")
rep("function sync() { $('#b-mission').classList.toggle('on', $('#s-mission').classList.contains('on'));", "function sync() { $('#b-mission').classList.toggle('on', $('#s-mission').classList.contains('on') || !$('#mx').hidden);")

# Settings: the old body becomes the Appearance tab
a = s.index("  function renderSettings() {\n")
first = "  function renderSettings() {\n    const b = $('#set-body'); const top = b.scrollTop; b.innerHTML = '';\n"
assert s[a:a+len(first)] == first, s[a:a+200]
end = s.index("    b.scrollTop = top;\n  }\n", a)
s = s[:a] + "  function appearancePane(b) {\n" + s[a+len(first):end] + "  }\n" + s[end+len("    b.scrollTop = top;\n  }\n"):]

# ---------- the teamwork block ----------
JS = open(sys.argv[2], encoding='utf-8').read()
rep("  /* ---------- start ---------- */", JS + "\n  /* ---------- start ---------- */")
CSS = open(sys.argv[3], encoding='utf-8').read()
rep("</style>", CSS + "\n</style>")
s = s.replace('__MAPSVG__', MAPSVG)
open(p, 'w', encoding='utf-8').write(s)
print('ok', len(s))
