"""Writes the Argon logo files from argon_logo.py: brand/logo.svg (+ white), favicon.svg and
apple-touch-icon.png (the "a" on an ember tile), og.png (the wordmark on the dark page), and
stamps the wordmark path into the <symbol id="argon"> of every page.

    python -I brand/make_assets.py
"""
import os, re, sys, glob, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import MultiPolygon
from argon_logo import build, to_path

HERE = os.path.dirname(os.path.abspath(__file__)); SITE = os.path.join(HERE, "..")
ACC, ACC_LIGHT, INK, DARK = "#FF6A3D", "#D2421A", "#111111", "#111111"
word, (ww, wh) = build()
mark, (mw, mh) = build(mark_only=True)
D_WORD, D_MARK = to_path(word), to_path(mark)
pad = 0.6
VB = f"{-pad} {-pad} {ww + 2 * pad:.2f} {wh + 2 * pad:.2f}"

def svg_word(fill=ACC_LIGHT):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VB}">'
            f'<title>Argon</title><path fill="{fill}" d="{D_WORD}"/></svg>\n')

def svg_icon():
    s = 22 / max(mw, mh); ox, oy = (32 - mw * s) / 2, (32 - mh * s) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="{ACC}"/>'
            f'<path fill="{INK}" transform="translate({ox:.2f} {oy:.2f}) scale({s:.4f})" d="{D_MARK}"/></svg>\n')

def raster(g, scale, offset, img, color, hole):
    d = ImageDraw.Draw(img)
    for p in (g.geoms if isinstance(g, MultiPolygon) else [g]):
        d.polygon([(offset[0] + x * scale, offset[1] + y * scale) for x, y in p.exterior.coords], fill=color)
        for ring in p.interiors:
            d.polygon([(offset[0] + x * scale, offset[1] + y * scale) for x, y in ring.coords], fill=hole)

def touch_icon(n=180, ss=4):
    N = n * ss; img = Image.new("RGB", (N, N), ACC)
    s = N * 0.6 / max(mw, mh)
    raster(mark, s, ((N - mw * s) / 2, (N - mh * s) / 2), img, INK, ACC)
    return img.resize((n, n), Image.LANCZOS)

def og(ss=2):
    W, H = 1200 * ss, 630 * ss; img = Image.new("RGB", (W, H), DARK)
    s = 760 * ss / ww
    raster(word, s, (110 * ss, 118 * ss), img, ACC, DARK)
    d = ImageDraw.Draw(img)
    try:
        f1 = ImageFont.truetype("C:/Windows/Fonts/seguisb.ttf", 44 * ss)
        f2 = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 22 * ss)
        d.text((110 * ss, 448 * ss), "All your agents, one calm board.", font=f1, fill="#F2EFE6")
        d.text((112 * ss, 516 * ss), "COMMAND DECK FOR CODING AGENTS · WINDOWS", font=f2, fill="#8C887D")
    except OSError:
        pass
    return img.resize((1200, 630), Image.LANCZOS)

def stamp_pages():
    sym = f'<symbol id="argon" viewBox="{VB}"><path fill="currentColor" d="{D_WORD}"/></symbol>'
    for page in glob.glob(os.path.join(SITE, "*.html")):
        src = open(page, encoding="utf-8").read()
        out = re.sub(r'<symbol id="argon"[^>]*>.*?</symbol>', lambda m: sym, src, flags=re.S)
        if out != src:
            open(page, "w", encoding="utf-8", newline="\n").write(out)

if __name__ == "__main__":
    open(os.path.join(HERE, "logo.svg"), "w").write(svg_word())
    open(os.path.join(HERE, "logo-white.svg"), "w").write(svg_word("#ffffff"))
    open(os.path.join(SITE, "favicon.svg"), "w").write(svg_icon())
    touch_icon().save(os.path.join(SITE, "apple-touch-icon.png"))
    og().save(os.path.join(SITE, "og.png"), optimize=True)
    json.dump({"word": D_WORD, "viewBox": VB, "mark": D_MARK}, open(os.path.join(HERE, "logo.json"), "w"))
    stamp_pages()
    parts = len(word.geoms) if isinstance(word, MultiPolygon) else 1
    print("word", round(ww, 2), round(wh, 2), "viewBox", VB, "parts", parts, len(D_WORD), "chars")
