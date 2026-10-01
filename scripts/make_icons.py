#!/usr/bin/env python3
"""Generate the app icons (mini gauge on dark background). Run once; output in icons/."""
import math, os
from PIL import Image, ImageDraw
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')
COLS = [(138, 148, 166), (242, 201, 76), (242, 153, 74), (39, 174, 96)]
BOUNDS = [(0, 3), (3, 5), (5, 7), (7, 10)]

def icon(size, pad_frac=0.0, rounded=True):
    S = size * 4; im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    if rounded: d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=(15, 20, 28, 255))
    else: d.rectangle([0, 0, S, S], fill=(15, 20, 28, 255))
    inner = S * (1 - 2 * pad_frac); off = S * pad_frac
    cx, cy = S / 2, off + inner * 0.64; R = inner * 0.36; w = inner * 0.12
    box = [cx - R, cy - R, cx + R, cy + R]
    for (a, b), col in zip(BOUNDS, COLS):  # 0 on the right (angle 0) -> 10 on the left (angle 180)
        a0, a1 = 180 * a / 10 + (1.5 if a else 0), 180 * b / 10 - (1.5 if b < 10 else 0)
        d.arc(box, start=360 - a1, end=360 - a0, fill=col + (255,), width=int(w))
    v = 7.5; ang = math.pi * v / 10; L = R - w * 0.9
    tip = (cx + L * math.cos(ang), cy - L * math.sin(ang)); px, py = math.sin(ang) * w * 0.28, math.cos(ang) * w * 0.28
    d.polygon([tip, (cx + px, cy + py), (cx - px, cy - py)], fill=(255, 255, 255, 255))
    r1 = w * 0.42; d.ellipse([cx - r1, cy - r1, cx + r1, cy + r1], fill=(255, 255, 255, 255))
    r2 = w * 0.18; d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=COLS[3] + (255,))
    return im.resize((size, size), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))
icon(512, pad_frac=0.1, rounded=False).save(os.path.join(OUT, 'icon-maskable-512.png'))
icon(180, rounded=False).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
print('icons written to', OUT)
