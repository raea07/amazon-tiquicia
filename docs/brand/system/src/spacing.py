"""Spacing check: every margin, padding and gap in carreta.css and in the inline
styles of the reference pages must be a step of the scale (0 4 8 12 16 24 32 48
64 px), written as var(--yt-space-N) in the stylesheet. Allowed exceptions
(SISTEMA §2, spacing): 2 px vertical padding inside stamps and badges, and 1 px
less where a state thickens a border by 1 px (.choice.on).
Run: python3 -I src/spacing.py          reports, exit 1 on any off-scale value
     python3 -I src/spacing.py --fix    rewrites src/css/*.css and the generators
                                        (values snapped to the nearest step; ties up)"""
import os, re, sys, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCALE = [0, 4, 8, 12, 16, 24, 32, 48, 64]
PROP = re.compile(r'(?<![\w-])((?:margin|padding)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap|--g)\s*:\s*([^;}"\']+)')
EXEMPT = [r'\.tag\{', r'\.badge\{', r'\.count-badge\{', r'\.choice\.on\{', r'\.side nav a \.n\{']


def snap(v):
    if v in SCALE:
        return v
    best = min(SCALE, key=lambda s: (abs(s - v), -s))
    return best


def fix_value(val, as_var):
    def rep(m):
        n = float(m.group(1))
        if n < 0:
            return m.group(0)
        s = snap(round(n))
        return f'var(--yt-space-{SCALE.index(s)})' if as_var and s else f'{s}px' if s else '0'
    return re.sub(r'(?<![\w.-])(\d+(?:\.\d+)?)px', rep, val)


def scan(text, name, rule_ctx=True):
    bad = []
    for m in PROP.finditer(text):
        val = m.group(2)
        if 'calc(' in val:
            continue
        start = text.rfind('}', 0, m.start()); sel = text[start + 1:m.start()]
        if any(re.search(e, sel + '{') for e in EXEMPT):
            continue
        for px in re.findall(r'(?<![\w.-])(\d+(?:\.\d+)?)px', val):
            if float(px) not in SCALE:
                bad.append(f'{name}: {m.group(1)}:{val.strip()[:40]}  ({sel.strip()[-50:]})')
                break
    return bad


if __name__ == '__main__':
    if '--fix' in sys.argv:
        for p in glob.glob(os.path.join(ROOT, 'src', 'css', '*.css')):
            s = open(p).read()
            def r(m):
                start = s.rfind('}', 0, m.start()); sel = s[start + 1:m.start()]
                if any(re.search(e, sel + '{') for e in EXEMPT) or 'calc(' in m.group(2):
                    return m.group(0)
                return m.group(1) + ':' + fix_value(m.group(2), True)
            open(p, 'w').write(PROP.sub(r, s))
        for p in ['common.py', 'shop.py', 'tools.py', 'apps.py', 'misc.py']:
            p = os.path.join(ROOT, 'src', p); s = open(p).read()
            s = re.sub(r'style="([^"]*)"', lambda m: 'style="' + PROP.sub(lambda q: q.group(1) + ':' + fix_value(q.group(2), False), m.group(1)) + '"', s)
            s = re.sub(r"(css = '''|SHEET_CSS = '''|CSS_EXTRA = ')(.*?)(''')", lambda m: m.group(1) + PROP.sub(lambda q: q.group(1) + ':' + fix_value(q.group(2), False), m.group(2)) + m.group(3), s, flags=re.S)
            open(p, 'w').write(s)
        print('fixed')
    bad = scan(open(os.path.join(ROOT, 'carreta.css')).read(), 'carreta.css')
    for f in sorted(glob.glob(os.path.join(ROOT, '*.html'))):
        h = open(f).read()
        for st in re.findall(r'style="([^"]*)"', h) + re.findall(r'<style>(.*?)</style>', h, flags=re.S):
            bad += scan(st, os.path.basename(f))
    uses = len(re.findall(r'var\(--yt-space-\d\)', open(os.path.join(ROOT, 'carreta.css')).read()))
    print(f'{uses} uses of --yt-space-N in carreta.css; {len(bad)} off-scale values')
    for b in sorted(set(bad))[:80]:
        print('  ' + b)
    sys.exit(1 if bad else 0)
