"""Lockup PNGs with the same clear space on every side (verifier's note: the
first set had 7 px on the left and 3-6 px on the right at 60 px high).
Reads assets/logo/<lockup>-raw.png (src/render.js, 240 px high), crops it to
its visible pixels, and writes <lockup>.png (60 px high) and @2x.png (120 px
high): the ink is 80 % of the height and the clear space is 10 % of the
height on all four sides (6 px at 60 px, about the stroke of the mark).
Then deletes the raw file. Run after render.js, before checkpng.py."""
import os, glob
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for raw in sorted(glob.glob(os.path.join(ROOT, 'assets', 'logo', '*-raw.png'))):
    im = Image.open(raw).convert('RGBA'); box = im.split()[3].point(lambda a: 255 if a > 8 else 0).getbbox()
    ink = im.crop(box)
    for h, suffix in ((60, '.png'), (120, '@2x.png')):
        m = round(h * 0.10); ih = h - 2 * m; iw = round(ink.width * ih / ink.height)
        out = Image.new('RGBA', (iw + 2 * m, h), (0, 0, 0, 0)); out.paste(ink.resize((iw, ih), Image.LANCZOS), (m, m))
        out.save(raw.replace('-raw.png', suffix), optimize=True)
    os.remove(raw)
print('lockup PNGs padded')
