import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, a[:70]
    s = s.replace(a, b)
# Run the team follows wires backwards: the task starts at the head of each chain.
rep("""    ts.forEach((tg, i) => {
      const task = (m.tasks.get(tg) || '').trim() || mTask(tg);
      mAgents(tg).forEach((a, j) => { if (a.agent === 'shell') return; line(a, `> [${m.title}] ${task}`, 'p'); a.queue = (MSCRIPT[a.agent] || MSCRIPT.codex)(task).map((x) => [...x]); a.wait = 1 + j + i; a.mgr = m; m.pending.add(a); setStatus(a, 'working'); });
      setTimeout(() => mPacket(m, tg, true), 80 + i * 140);
    });""", """    const team = new Set(ts.flatMap(mAgents));
    // Who feeds this agent? Walk its incoming wires back to the agent where the chain starts.
    const headOf = (a) => { const seen = new Set([a]); let cur = a; for (;;) { const w = hw.find((x) => x.to === cur && !seen.has(x.from) && x.from.agent !== 'shell' && tiles.includes(x.from)); if (!w) return cur; seen.add(w.from); cur = w.from; } };
    const started = new Set();
    ts.forEach((tg, i) => {
      const task = (m.tasks.get(tg) || '').trim() || mTask(tg);
      mAgents(tg).forEach((a, j) => {
        if (a.agent === 'shell') return;
        const head = headOf(a);
        if (head !== a) {
          // The task goes in at the start of the chain; the wires carry it to this agent, which then reports back.
          a.mgrAfter = m; m.pending.add(a);
          if (!team.has(head) && !started.has(head)) { started.add(head); line(head, `> [${m.title}] ${task}`, 'p'); head.queue = (MSCRIPT[head.agent] || MSCRIPT.codex)(task).map((x) => [...x]); head.wait = 1 + j + i; setStatus(head, 'working'); toast(`${head.name} starts, then its wire hands the work to ${a.name}`); }
          return;
        }
        line(a, `> [${m.title}] ${task}`, 'p'); a.queue = (MSCRIPT[a.agent] || MSCRIPT.codex)(task).map((x) => [...x]); a.wait = 1 + j + i; a.mgr = m; m.pending.add(a); setStatus(a, 'working');
      });
      setTimeout(() => mPacket(m, tg, true), 80 + i * 140);
    });""")
rep("m.pending.forEach((a) => { a.mgr = null; });", "m.pending.forEach((a) => { a.mgr = null; a.mgrAfter = null; });")
rep("""  function twDone(t) {
""", """  function twDone(t) {
    if (t.mgrAfter) { const m = t.mgrAfter; t.mgrAfter = null; mReport(m, t); }
""")
open(p, 'w', encoding='utf-8').write(s)
print('ok')
