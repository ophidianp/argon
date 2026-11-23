"""Mouse 33 logo: "M33" drawn as one connected piece with a flat, horizontal pen nib
(thick strokes on the climbs, hairlines on the turns), swept along smooth Bezier centrelines
and sheared forward. Writes the path data used by the site's logo, favicon and images."""
import sys, json
import numpy as np
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union
from shapely import affinity

H = 27.0

def bez(p0, p1, p2, p3, n=56):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = map(np.array, (p0, p1, p2, p3))
    return (1-t)**3*p0 + 3*(1-t)**2*t*p1 + 3*(1-t)*t**2*p2 + t**3*p3

def stroke(curves, w, t):
    pts = np.vstack([bez(*c) for c in curves])
    nib = np.array([[-w/2, -t/2], [w/2, -t/2], [w/2, t/2], [-w/2, t/2]])
    return unary_union([Polygon(np.vstack([nib + a, nib + b])).convex_hull for a, b in zip(pts[:-1], pts[1:])])

def to_path(g, nd=2):
    out = []
    for p in (g.geoms if isinstance(g, MultiPolygon) else [g]):
        for ring in [p.exterior, *p.interiors]:
            c = list(ring.coords)[:-1]
            out.append("M" + " L".join(f"{x:.{nd}f},{y:.{nd}f}" for x, y in c) + "Z")
    return "".join(out)

def build(skew=44.0, extra=12.0, W=5.6, T=2.2, sp=9.2, mark_only=False, mgap=3.0):
    top, bot = T/2, H - T/2
    # M: one wave, up-down-up-down
    a, seq, x = sp*0.58, [], 0.0
    for i in range(4):
        y0, y1 = (bot, top) if i % 2 == 0 else (top, bot)
        seq.append(((x, y0), (x + a, y0), (x + sp - a, y1), (x + sp, y1)))
        x += sp
    m_end = x
    shapes = [stroke(seq, W, T)]
    if not mark_only:
        r, gap = 17.0, 20.5
        x3 = m_end + mgap
        def three(a3, tail_to, top_from):
            return stroke([
                ((top_from, top), (a3 + r*0.55, top), (a3 + r, top), (a3 + r, 6.6)),
                ((a3 + r, 6.6), (a3 + r, 11.6), (a3 + r*0.62, 13.5), (a3 + r*0.3, 13.5)),
                ((a3 + r*0.3, 13.5), (a3 + r*0.75, 13.5), (a3 + r*1.06, 15.2), (a3 + r*1.06, 19.8)),
                ((a3 + r*1.06, 19.8), (a3 + r*1.06, 25.0), (a3 + r*0.6, bot), (tail_to, bot)),
            ], W, T)
        # first 3: its tail runs back along the baseline into the M's last foot
        t1 = three(x3, m_end - 1.0, x3)
        # second 3: top bar starts at the first 3's shoulder, tail runs into the first 3's bowl
        t2 = three(x3 + gap, x3 + r*0.75, x3 + r*0.7)
        threes = unary_union([t1, t2])
        threes = affinity.skew(threes, xs=-extra, origin=(0, H))   # the 3s lean a little harder
        shapes.append(threes)
    g = unary_union(shapes)
    g = affinity.skew(g, xs=-skew, origin=(0, H)).simplify(0.035)
    minx, miny, maxx, maxy = g.bounds
    g = affinity.translate(g, -minx, -miny)
    return g, (maxx - minx, maxy - miny)

if __name__ == "__main__":
    res = {}
    for v in sys.argv[1:]:
        s, e, mg = map(float, v.split(":"))
        g, (w, h) = build(s, e, mgap=mg)
        res[v] = {"d": to_path(g), "w": round(w, 2), "h": round(h, 2), "parts": len(getattr(g, "geoms", [g]))}
    print(json.dumps(res))
