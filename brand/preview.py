"""Render the argon logo to a PNG for checking: python -I brand/preview.py out.png [key=value ...]"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw
from shapely.geometry import MultiPolygon
from argon_logo import build, parts
kw = {k: float(v) for k, v in (a.split("=") for a in sys.argv[2:])}
g, (w, h) = build(**kw)
s = 12; img = Image.new("RGB", (int(w * s) + 40, int(h * s) + 40), "white"); d = ImageDraw.Draw(img)
for p in (g.geoms if isinstance(g, MultiPolygon) else [g]):
    d.polygon([(20 + x * s, 20 + y * s) for x, y in p.exterior.coords], fill="#E2491E")
    for r in p.interiors: d.polygon([(20 + x * s, 20 + y * s) for x, y in r.coords], fill="white")
small = img.resize((img.width // 6, img.height // 6), Image.LANCZOS)
img.paste(small, (img.width - small.width - 10, img.height - small.height - 10))
img.save(sys.argv[1]); print("size", round(w, 1), round(h, 1), "parts", parts(g))
