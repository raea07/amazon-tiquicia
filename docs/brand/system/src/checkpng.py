"""Checks every PNG that src/render.js writes, and flattens the 1024 app icons
to RGB (the App Store refuses an alpha channel). Fails (exit 1) when:
- two PNGs that should differ are byte-identical (md5);
- a PNG is mostly one colour (more than 90 % of pixels equal to its most common colour,
  except the adaptive-icon background, which is one colour by design, and the
  themed (monocromo) and splash (inicio) images, which are mostly transparent by design);
- a lockup has less than 8 % visible (alpha > 8) pixels;
- the top-left 16 x 16 holds Chromium's broken-image grey rgb(192,192,192).
Run: python3 -I src/checkpng.py"""
import os, sys, glob, hashlib
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bad, seen, report = [], {}, []
files = sorted(glob.glob(os.path.join(ROOT, 'assets', 'app-icons', '*.png')) + glob.glob(os.path.join(ROOT, 'assets', 'logo', '*.png')))
for f in files:
    name = os.path.relpath(f, ROOT)
    if f.endswith('-1024.png'):
        im = Image.open(f)
        if im.mode != 'RGB':
            bg = Image.new('RGB', im.size, (255, 255, 255)); bg.paste(im, mask=im.convert('RGBA').split()[3]); bg.save(f)
    h = hashlib.md5(open(f, 'rb').read()).hexdigest()
    if h in seen:
        bad.append(f'{name} is identical to {seen[h]}')
    seen[h] = name
    mode = Image.open(f).mode
    im = Image.open(f).convert('RGBA'); w, hh = im.size; px = list(im.get_flattened_data()) if hasattr(im, "get_flattened_data") else list(im.getdata())
    corner = [im.getpixel((x, y)) for x in range(min(16, w)) for y in range(min(16, hh))]
    if sum(1 for p in corner if p[:3] == (192, 192, 192) and p[3] > 200) > 3:
        bad.append(f'{name} has the broken-image grey in its corner')
    from collections import Counter
    top, n = Counter(px).most_common(1)[0]
    share = n / len(px)
    visible = sum(1 for p in px if p[3] > 8) / len(px)
    if 'adaptativo-fondo' not in name and 'monocromo' not in name and 'inicio' not in name and share > 0.90 and 'logo' not in name:
        bad.append(f'{name} is {share:.0%} one colour {top}')
    if 'logo' in name and visible < 0.08:
        bad.append(f'{name} has only {visible:.1%} visible pixels')
    report.append(f'{name}\t{w}x{hh}\t{mode}\tmost common {share:.0%}\tvisible {visible:.0%}\t{h[:8]}')
open(os.path.join(ROOT, 'assets', 'png-check.txt'), 'w').write('\n'.join(report) + '\n' + ('\n'.join('FAIL ' + b for b in bad) if bad else 'all PNGs pass') + '\n')
print(len(files), 'PNGs;', 'FAIL:\n' + '\n'.join(bad) if bad else 'all pass')
sys.exit(1 if bad else 0)
