"""The two versions of the delivery strip side by side, for the owner's
five-person test. Needs shots/{home,producto,franja2-home,franja2-producto}-primera-390.png
(src/shots.js). Writes franja/inicio-390.png and franja/producto-390.png."""
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
F = os.path.join(ROOT, 'fonts', 'ttf')
big = ImageFont.truetype(os.path.join(F, 'FiraSans-SemiBold.ttf'), 40)
small = ImageFont.truetype(os.path.join(F, 'FiraSans-Regular.ttf'), 30)
for src, name, label in (('home', 'inicio', 'Inicio'), ('producto', 'producto', 'Producto')):
    a = Image.open(os.path.join(ROOT, 'shots', f'{src}-primera-390.png')).convert('RGB')
    b = Image.open(os.path.join(ROOT, 'shots', f'franja2-{src}-primera-390.png')).convert('RGB')
    gap, head, pad = 48, 150, 40
    W = pad * 2 + a.width + gap + b.width; H = head + max(a.height, b.height) + pad
    im = Image.new('RGB', (W, H), '#E9E3DA'); d = ImageDraw.Draw(im)
    for i, (img, t, s) in enumerate(((a, 'Versión 1', 'Franja achiote'), (b, 'Versión 2', 'Franja blanca con filete achiote de 4 px'))):
        x = pad + i * (a.width + gap)
        d.text((x, 34), f'{label} · {t}', font=big, fill='#1E1A16'); d.text((x, 88), s, font=small, fill='#574E45')
        im.paste(img, (x, head)); d.rectangle((x - 1, head - 1, x + img.width, head + img.height), outline='#7A6F63', width=2)
    os.makedirs(os.path.join(ROOT, 'franja'), exist_ok=True)
    im.save(os.path.join(ROOT, 'franja', f'{name}-390.png'), optimize=True)
    print(name, im.size)

# Check: the two versions must differ only inside the strip (same height, so
# nothing below it moves). Prints the image rows that differ.
from PIL import ImageChops
for src in ('home', 'producto'):
    a = Image.open(os.path.join(ROOT, 'shots', f'{src}-primera-390.png')).convert('RGB')
    b = Image.open(os.path.join(ROOT, 'shots', f'franja2-{src}-primera-390.png')).convert('RGB')
    d = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 24 else 0)
    rows = [y for y in range(d.height) if d.crop((0, y, d.width, y + 1)).getbbox()]
    print(src, 'same size' if a.size == b.size else 'SIZE DIFFERS', '; rows that differ:', (rows[0], rows[-1], len(rows)) if rows else 'none')
