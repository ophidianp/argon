import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, a[:70]
    s = s.replace(a, b)
# Manager wires leave from whichever side of the Manager faces the agent, instead of always the left socket.
rep("""  function mCurve([x1, y1], [x2, y2]) {""", """  // Joins an agent (b) and the Manager (M) on the sides that face each other: left/right when they sit side by side, top/bottom when stacked.
  function wireEnds(b, M) {
    const ty = b.y + Math.min(24, b.h / 2), my = M.y + 18;
    if (b.x >= M.x + M.w - 20) return [[b.x, ty], [-1, 0], [M.x + M.w, my], [1, 0]];
    if (b.x + b.w <= M.x + 20) return [[b.x + b.w, ty], [1, 0], [M.x, my], [-1, 0]];
    if (b.y + b.h <= M.y + 10) return [[b.x + b.w / 2, b.y + b.h], [0, 1], [M.x + M.w / 2, M.y], [0, -1]];
    if (b.y >= M.y + M.h - 10) return [[b.x + b.w / 2, b.y], [0, -1], [M.x + M.w / 2, M.y + M.h], [0, 1]];
    return [[b.x + b.w, ty], [1, 0], [M.x + M.w, my], [1, 0]];
  }
  function wirePath(b, M) {
    const [[x1, y1], [ax, ay], [x2, y2], [bx, by]] = wireEnds(b, M);
    const c = Math.max(50, (ax ? Math.abs(x2 - x1) : Math.abs(y2 - y1)) / 2);
    return `M${x1},${y1} C${x1 + c * ax},${y1 + c * ay} ${x2 + c * bx},${y2 + c * by} ${x2},${y2}`;
  }
  function mCurve([x1, y1], [x2, y2]) {""")
rep("""        p.setAttribute('d', mCurve(mFrom(live, m), [m.el.offsetLeft, m.el.offsetTop + 18]));""",
    """        p.setAttribute('d', wirePath(live, { x: m.el.offsetLeft, y: m.el.offsetTop, w: m.el.offsetWidth, h: m.el.offsetHeight }));""")
open(p, 'w', encoding='utf-8').write(s)
print('ok')
