"""Argon logo: lowercase "argon" written as one connected piece with the same flat
rectangular nib as the Mouse 33 logo (W=5.6, T=2.2: thick stems, hairline joins), swept
along cubic Bezier centrelines, unioned and sheared 44 deg forward. The g's tail swings back
under the word as a baseline swash. Writes the path data for the site's logo and icons."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from shapely.geometry import MultiPolygon
from shapely.ops import unary_union
from shapely import affinity
from logo_gen import stroke, to_path

H = 27.0
K = 0.5523  # cubic circle constant

def line(a, b):
    a, b = np.array(a, float), np.array(b, float)
    return (tuple(a), tuple(a + (b - a) / 3), tuple(a + 2 * (b - a) / 3), tuple(b))

def oval(cx, cy, rx, ry, start="top"):
    """closed oval, counter-clockwise on screen (y down), starting at its top."""
    t, l, b, r = (cx, cy - ry), (cx - rx, cy), (cx, cy + ry), (cx + rx, cy)
    return [
        (t, (cx - rx * K, cy - ry), (cx - rx, cy - ry * K), l),
        (l, (cx - rx, cy + ry * K), (cx - rx * K, cy + ry), b),
        (b, (cx + rx * K, cy + ry), (cx + rx, cy + ry * K), r),
        (r, (cx + rx, cy - ry * K), (cx + rx * K, cy - ry), t),
    ]

def strokes(P):
    W, T = P["W"], P["T"]
    top, bot = T / 2, H - T / 2
    cy, ry = H / 2, (bot - top) / 2
    out = []
    # a: bowl + stem, stem foot turns into a baseline join to the r
    ax, aw = 0.0, P["aw"]
    sa = ax + aw
    out.append(oval(ax + aw / 2, cy, aw / 2, ry))
    rx = sa + P["ar"]
    out.append([line((sa, top), (sa, bot - 6)),
                ((sa, bot - 6), (sa, bot), (sa + 2.5, bot), (rx + 1, bot))])
    # r: stem up from the baseline join, shoulder ends in a drooping flag;
    # its foot runs on along the baseline into the bottom of the g's bowl
    gx, gw = rx + P["rg"], P["gw"]
    sg = gx + gw
    out.append([line((rx, bot), (rx, top + 8)),
                ((rx, top + 8), (rx, top + 2.5), (rx + 3, top), (rx + 6.5, top)),
                ((rx + 6.5, top), (rx + 8.5, top), (rx + P["flag"], top + 1.5), (rx + P["flag"], top + 4.5))])
    out.append([line((rx, bot), (gx + gw / 2, bot))])
    # g: bowl + long stem; the tail swings left under the word as a swash
    d = bot + P["desc"]
    out.append(oval(gx + gw / 2, cy, gw / 2, ry))
    out.append([line((sg, top), (sg, d - 7)),
                ((sg, d - 7), (sg, d), (sg - 4, d), (sg - 10, d)),
                line((sg - 10, d), (P["swash"], d))])
    # ear of the g runs on as the o's top
    ox, ow = sg + P["go"], P["ow"]
    out.append(oval(ox + ow / 2, cy, ow / 2, ry))
    nx = ox + ow + P["on"]
    out.append([line((sg, top), (nx, top))])
    # n: stem, arch, foot with an exit flick
    nw = P["nw"]
    out.append([line((nx, top), (nx, bot))])
    out.append([((nx, top + 9), (nx, top + 2), (nx + 3, top), (nx + nw / 2, top)),
                ((nx + nw / 2, top), (nx + nw - 2, top), (nx + nw, top + 3), (nx + nw, top + 9)),
                line((nx + nw, top + 9), (nx + nw, bot - 6)),
                ((nx + nw, bot - 6), (nx + nw, bot), (nx + nw + 2.5, bot), (nx + nw + 6, bot))])
    return out

DEFAULT = dict(W=5.6, T=2.2, aw=18, ar=11, rg=14, flag=11, gw=18, desc=10, swash=14, go=6, ow=18, on=6, nw=16, back=12.0, skew=44.0)

def build(mark_only=False, **kw):
    P = dict(DEFAULT, **kw)
    S = strokes(P)
    if mark_only:  # the a on its own, for the favicon and touch icon
        S = S[:2]
        S[1] = [S[1][0], ((S[1][1][0]), S[1][1][1], S[1][1][2], (S[1][1][0][0] + 6, S[1][1][3][1]))]
    g = unary_union([stroke(c, P["W"], P["T"]) for c in S])
    g = affinity.skew(g, xs=P["back"], origin=(0, H))  # stems lean back first, like the M33 downstrokes
    g = affinity.skew(g, xs=-P["skew"], origin=(0, H)).simplify(0.035)
    minx, miny, maxx, maxy = g.bounds
    g = affinity.translate(g, -minx, -miny)
    return g, (maxx - minx, maxy - miny)

def parts(g):
    return len(g.geoms) if isinstance(g, MultiPolygon) else 1

if __name__ == "__main__":
    g, (w, h) = build()
    print(json.dumps({"w": round(w, 2), "h": round(h, 2), "parts": parts(g)}))
