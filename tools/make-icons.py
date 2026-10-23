"""Génère l'icône et l'écran de démarrage de Canapé TV (Samsung Tizen). Usage : python3 tools/make-icons.py app"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
BG = (12, 14, 19)
CREAM = (243, 239, 231)
AMBER = (255, 181, 71)
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def radial(w, h):
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    cx, cy = w * 0.5, h * 0.4
    r = max(w, h) * 0.65
    steps = 60
    for i in range(steps, 0, -1):
        t = i / steps
        col = tuple(int(BG[k] + (c - BG[k]) * (1 - t) ) for k, c in enumerate((29, 34, 48)))
        rr = r * t
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col)
    return img

def icon(size, path):
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BG + (255,))
    # petit canapé stylisé
    w = s * 0.62; x0 = (s - w) / 2; y0 = s * 0.30
    d.rounded_rectangle([x0, y0, x0 + w, y0 + s * 0.20], radius=int(s * 0.06), fill=CREAM)
    d.rounded_rectangle([x0 - s * 0.06, y0 + s * 0.12, x0 + s * 0.10, y0 + s * 0.40], radius=int(s * 0.05), fill=CREAM)
    d.rounded_rectangle([x0 + w - s * 0.10, y0 + s * 0.12, x0 + w + s * 0.06, y0 + s * 0.40], radius=int(s * 0.05), fill=CREAM)
    d.rounded_rectangle([x0 + s * 0.06, y0 + s * 0.22, x0 + w - s * 0.06, y0 + s * 0.36], radius=int(s * 0.04), fill=AMBER)
    d.rectangle([x0 + s * 0.02, y0 + s * 0.40, x0 + s * 0.07, y0 + s * 0.46], fill=CREAM)
    d.rectangle([x0 + w - s * 0.07, y0 + s * 0.40, x0 + w - s * 0.02, y0 + s * 0.46], fill=CREAM)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(path)

def splash(path):
    w, h = 1920, 1080
    img = radial(w, h)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(BOLD, 150)
    text = "canapé"
    tw = d.textlength(text, font=f)
    dot = d.textlength(".", font=f)
    x = (w - tw - dot) / 2
    y = h * 0.40 - 90
    d.text((x, y), text, font=f, fill=CREAM)
    d.text((x + tw, y), ".", font=f, fill=AMBER)
    img.save(path)

def tizen_icon(path, w=512, h=423):
    # Samsung demande une icône de 512 × 423 : fond plein, canapé au centre
    img = radial(w, h).convert("RGBA")
    tmp = out + "/.icon-tmp.png"
    icon(h, tmp)
    sq = Image.open(tmp)
    img.alpha_composite(sq, ((w - h) // 2, 0))
    os.remove(tmp)
    img.save(path)

tizen_icon(out + "/icon.png")
splash(out + "/splash.png")
print("ok")
