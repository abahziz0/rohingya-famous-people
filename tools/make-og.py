"""make-og — the 1200×630 cards shown when a page is shared on social media.

usage: python3 make-og.py cards.json
cards.json is a list of {"out", "images", "title", "subtitle", "kicker"}:
one image makes a person's card (portrait left, name right),
several make the home card (a row of portraits, the title beneath).
"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

W, H = 1200, 630
PLASTER = (221, 220, 215)
INK = (74, 72, 66)
MID = (102, 100, 92)
ACCENT = (142, 91, 69)

def font(size, italic=False):
    for path, index in [('/System/Library/Fonts/Supplemental/Baskerville.ttc', 2 if italic else 0),
                        ('/System/Library/Fonts/Supplemental/Georgia.ttf', 0),
                        ('/System/Library/Fonts/Supplemental/Times New Roman.ttf', 0)]:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=index)
            except OSError:
                continue
    return ImageFont.load_default()

def wall():
    """plaster with a little tooth, a touch lighter at its heart"""
    im = Image.new('RGB', (W, H), PLASTER)
    noise = Image.effect_noise((W, H), 9).convert('RGB')
    im = ImageChops.add(ImageChops.multiply(im, Image.new('RGB', (W, H), (250, 250, 250))), ImageChops.subtract(noise, Image.new('RGB', (W, H), (122, 122, 122))))
    heart = Image.new('L', (W, H), 0)
    ImageDraw.Draw(heart).ellipse((W * 0.1, -H * 0.2, W * 0.9, H * 1.2), fill=26)
    heart = heart.filter(ImageFilter.GaussianBlur(160))
    return Image.composite(Image.new('RGB', (W, H), (236, 235, 231)), im, heart)

def vignette(size):
    """the same soft oval the wall uses to let a portrait sink into the plaster"""
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).ellipse((size * 0.14, size * 0.12, size * 0.86, size * 0.92), fill=255)
    return m.filter(ImageFilter.GaussianBlur(size * 0.07))

def engraved(draw, xy, text, f, fill, anchor='la'):
    """ink pressed into plaster: light catches the lower lip of the cut"""
    x, y = xy
    draw.text((x, y + 1), text, font=f, fill=(250, 249, 246), anchor=anchor)
    draw.text((x, y), text, font=f, fill=fill, anchor=anchor)

def spaced(text):
    """small capitals set wide, the way the wall's labels are"""
    return ' '.join(text)

def wrap(draw, text, f, width):
    lines, line = [], ''
    for word in text.split():
        trial = (line + ' ' + word).strip()
        if draw.textlength(trial, font=f) <= width or not line:
            line = trial
        else:
            lines.append(line); line = word
    if line:
        lines.append(line)
    return lines

def person_card(c):
    im = wall()
    size = 600
    portrait = Image.open(c['images'][0]).convert('RGB').resize((size, size), Image.LANCZOS)
    im.paste(portrait, (40, 15), vignette(size))
    d = ImageDraw.Draw(im)
    x, width = 640, 500
    engraved(d, (x, 170), spaced(c['kicker'].upper()), font(17), MID)
    d.line((x, 205, x + 60, 205), fill=(190, 188, 182), width=1)
    d.line((x, 206, x + 60, 206), fill=(246, 245, 242), width=1)
    f = font(62)
    lines = wrap(d, c['title'], f, width)
    if len(lines) > 2:
        f = font(48); lines = wrap(d, c['title'], f, width)
    y = 230
    for line in lines[:3]:
        engraved(d, (x, y), line, f, INK)
        y += int(f.size * 1.12)
    y += 18
    for line in wrap(d, c['subtitle'], font(25, italic=True), width)[:3]:
        engraved(d, (x, y), line, font(25, italic=True), MID)
        y += 36
    return im

def home_card(c):
    im = wall()
    imgs = c['images'][:5]
    size = 300
    gap = (W - size * len(imgs)) // (len(imgs) + 1)
    for i, path in enumerate(imgs):
        p = Image.open(path).convert('RGB').resize((size, size), Image.LANCZOS)
        im.paste(p, (gap + i * (size + gap), 60), vignette(size))
    d = ImageDraw.Draw(im)
    engraved(d, (W // 2, 430), spaced(c['title'].upper()), font(40), INK, anchor='ma')
    engraved(d, (W // 2, 500), c['subtitle'], font(26, italic=True), MID, anchor='ma')
    return im

cards = json.load(open(sys.argv[1]))
for c in cards:
    im = person_card(c) if len(c['images']) == 1 else home_card(c)
    os.makedirs(os.path.dirname(c['out']), exist_ok=True)
    im.save(c['out'], 'JPEG', quality=86, optimize=True, progressive=True)
    print('og:', os.path.basename(c['out']))
