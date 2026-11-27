"""Builds every font file the eight apps ship, from pinned open-licence sources.

Run from anywhere (needs Python 3, fontTools 4.x and brotli; network to the npm
registry, or OFFLINE=<folder> holding the two .tgz files):

    python3 -I src/fonts.py

Sources (SIL Open Font License 1.1, no Reserved Font Name in either licence):

    @expo-google-fonts/epilogue 0.4.2   Epilogue 2.112 static TTF (Google Fonts build)
    @expo-google-fonts/fira-sans 0.4.1  Fira Sans 4.203 static TTF (Google Fonts build)

Each tarball is checked against the registry's sha512 integrity AND the sha256
written below before anything is read from it. Only the seven TTFs we use are
read from the tarball (by exact member name); nothing is extracted to disk.

For each of Epilogue 600, 700, 800 and Fira Sans 400, 500, 600, 700 the script:

1. Tabular lining figures by default. The digits 0-9 in the cmap point at
   the font's own tabular glyphs (zero.tf ... nine.tf, the targets of its
   `tnum` lookup), so prices, counts, times and the code keep their width on
   the web, in React Native on iOS and Android (no reliance on fontVariant)
   and in pictures. Proportional figures are no longer reachable (we use
   none). The `tnum` feature still exists and changes nothing visible.
2. U+202F NARROW NO-BREAK SPACE, used between thousands in every amount, is
   added as an empty glyph: the width of U+2009 THIN SPACE when the font has
   one (Epilogue: 400/2000 em), else 0.2 em (Fira Sans: 200/1000). U+00A0,
   used inside times and quantities (SISTEMA §3 rule 8), is already in both.
3. Names. Typographic family (nameID 16) "Epilogue" or "Fira Sans" and
   subfamily (17) "SemiBold", "Medium" ... on every file; legacy family (1)
   and style (2) follow the RIBBI rule (400 and 700 are "Regular"/"Bold" of
   the family; other weights are their own legacy family with style
   "Regular"). iOS groups faces by nameID 16, so `fontFamily: "Fira Sans"`
   with `fontWeight: "500"` finds Medium. (The F2 files had no nameID 16 on
   Fira Medium and SemiBold, so iOS would have fallen back to Regular or
   Bold: builder dry run, finding 3.) nameID 5 gets the build stamp.
4. Subset to what Spanish and English screens, money and dates use:
   U+0020-007E, U+00A0-017F, U+0192, U+02C6-02DD, U+2000-206F, U+20A0-20CF,
   U+2122, U+2190-2193, U+2212, U+2215, U+2713, U+FFFD, every OpenType
   layout feature kept (kerning, ligatures, case, locl), hinting kept.
5. Writes fonts/ttf/<Family>-<Weight>.ttf (phones: the expo-font config
   plugin and fonts.web.ts) and fonts/web/<family>-<weight>.woff2 (the four
   web apps: ONE file per weight, so next/font/local needs no unicode-range
   and every price finds its ₡ in the same file).
6. Checks every output (characters the product writes, tabular digits,
   U+202F, name table, weight class, kerning) and writes fonts/manifest.json
   (sources with checksums; outputs with sha256, size and checks) and
   fonts/glyph-check.txt. Exits 1 on any failed check. A second run gives
   byte-identical files (checked: same sha256).

The F2 woff2 files in fonts/f2/ stay only as the input of src/logo.py (the
lockup outlines are drawn and must not move); no page or app loads them.
"""
import base64, hashlib, io, json, os, sys, tarfile, urllib.request
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.ttLib.tables._g_l_y_f import Glyph

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
F = os.path.join(ROOT, 'fonts')
STAMP = 'Yuntera build 2026-11-27: tabular figures default, U+202F added, subset'
SOURCES = {
    'epilogue': {'package': '@expo-google-fonts/epilogue', 'version': '0.4.2',
                 'url': 'https://registry.npmjs.org/@expo-google-fonts/epilogue/-/epilogue-0.4.2.tgz',
                 'integrity': 'sha512-69gLWq6t92cfULCQ6lhbdC6zTa04sXJXlXF8BeTV4G8/wYf9PuEaBoPQUy7Wr8TJSaxgKHyOxpoJTXJbaIljTA==',
                 'sha256': '88a12946e3168c4592b091802fe28750dcbef83ad1542f7758e0a8225acfbbe8'},
    'fira': {'package': '@expo-google-fonts/fira-sans', 'version': '0.4.1',
             'url': 'https://registry.npmjs.org/@expo-google-fonts/fira-sans/-/fira-sans-0.4.1.tgz',
             'integrity': 'sha512-zQVs67baYyBVEScaCGKG3MBtGe2hPNc7R3Axmj7JmWs310kOem4poL1mB+O52rwfFqiigzxV876BHFZBxoie1Q==',
             'sha256': '89eaf2db7774f47fb5854c8193386ca5cccd591454555443439e49553d44a710'},
}
WNAME = {400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold'}
FACES = [('epilogue', 'Epilogue', 'Epilogue', 'epilogue', w) for w in (600, 700, 800)] + \
        [('fira', 'Fira Sans', 'FiraSans', 'fira-sans', w) for w in (400, 500, 600, 700)]
KEEP = (list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) + [0x192] + list(range(0x2C6, 0x2DE))
        + list(range(0x2000, 0x2070)) + list(range(0x20A0, 0x20D0))
        + [0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x2215, 0x2713, 0xFFFD])
NEED = {'₡': 0x20A1, 'U+202F': 0x202F, 'U+00A0': 0xA0, '−': 0x2212, 'ñ': 0xF1, 'Ñ': 0xD1, 'á': 0xE1, 'é': 0xE9,
        'í': 0xED, 'ó': 0xF3, 'ú': 0xFA, 'ü': 0xFC, '¿': 0xBF, '¡': 0xA1, '«': 0xAB, '»': 0xBB, '×': 0xD7,
        '·': 0xB7, '–': 0x2013, '…': 0x2026}


def fetch(key):
    s = SOURCES[key]
    off = os.environ.get('OFFLINE')
    if off:
        data = open(os.path.join(off, os.path.basename(s['url'])), 'rb').read()
    else:
        with urllib.request.urlopen(s['url'], timeout=120) as r:
            data = r.read()
    sri = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
    if sri != s['integrity'] or hashlib.sha256(data).hexdigest() != s['sha256']:
        sys.exit(f'checksum mismatch for {s["package"]} {s["version"]}: refusing to build')
    return tarfile.open(fileobj=io.BytesIO(data), mode='r:gz')


def member(tar, key, weight):
    fam = 'Epilogue' if key == 'epilogue' else 'FiraSans'
    name = f'package/{weight}{WNAME[weight]}/{fam}_{weight}{WNAME[weight]}.ttf'
    return tar.extractfile(name).read(), name


def tabular_default(t):
    """Point the cmap's digits at the targets of the font's own tnum lookup."""
    gsub = t['GSUB'].table
    idx = sorted({i for fr in gsub.FeatureList.FeatureRecord if fr.FeatureTag == 'tnum' for i in fr.Feature.LookupListIndex})
    mapping = {}
    for i in idx:
        for st in gsub.LookupList.Lookup[i].SubTable:
            st = getattr(st, 'ExtSubTable', st)
            mapping.update(getattr(st, 'mapping', None) or {})
    done = 0
    for table in t['cmap'].tables:
        if table.isUnicode():
            for cp in range(0x30, 0x3A):
                g = table.cmap.get(cp)
                if g in mapping:
                    table.cmap[cp] = mapping[g]; done += 1
    return done


def add_nnbsp(t):
    cmap = t.getBestCmap()
    if 0x202F in cmap:
        return 'already present'
    upm = t['head'].unitsPerEm
    width = t['hmtx'][cmap[0x2009]][0] if 0x2009 in cmap else round(upm * 0.2)
    gname = 'uni202F'
    order = t.getGlyphOrder() + [gname]
    g = Glyph(); g.numberOfContours = 0
    t['glyf'].glyphs[gname] = g
    t['hmtx'].metrics[gname] = (width, 0)
    t.setGlyphOrder(order)
    t['glyf'].glyphOrder = order
    t['maxp'].numGlyphs = len(order)
    for table in t['cmap'].tables:
        if table.isUnicode():
            table.cmap[0x202F] = gname
    return f'added, advance {width}/{upm} em'


def set_names(t, family, weight):
    style = WNAME[weight]
    ribbi = weight in (400, 700)
    ps = f'{family.replace(" ", "")}-{style}'
    version = (t['name'].getDebugName(5) or '').split(';')[0]
    vals = {1: family if ribbi else f'{family} {style}', 2: style if ribbi else 'Regular',
            3: f'{version.replace("Version ", "")};{ps};yuntera', 4: f'{family} {style}', 5: f'{version}; {STAMP}',
            6: ps, 16: family, 17: style}
    name = t['name']
    for nid in vals:
        name.removeNames(nameID=nid)
    for nid, v in vals.items():
        name.setName(v, nid, 3, 1, 0x409)
        name.setName(v, nid, 1, 0, 0)
    t['OS/2'].usWeightClass = weight
    fs = t['OS/2'].fsSelection & ~0b1100001  # clear ITALIC, BOLD, REGULAR
    fs |= 0b100000 if weight == 700 else (0b1000000 if weight == 400 else 0)
    t['OS/2'].fsSelection = fs
    t['head'].macStyle = 1 if weight == 700 else 0


def do_subset(t):
    opt = subset.Options()
    opt.layout_features = ['*']
    opt.name_IDs = ['*']; opt.name_languages = ['*']; opt.name_legacy = True
    opt.notdef_outline = True; opt.glyph_names = True; opt.legacy_kern = True
    opt.hinting = True
    s = subset.Subsetter(options=opt)
    s.populate(unicodes=KEEP + [0x202F])
    s.subset(t)


def check(path, family, weight):
    t = TTFont(path)
    cmap = t.getBestCmap(); hm = t['hmtx']
    n = t['name']
    gpos = {fr.FeatureTag for fr in t['GPOS'].table.FeatureList.FeatureRecord} if 'GPOS' in t else set()
    res = {
        'missing': [k for k, cp in NEED.items() if cp not in cmap],
        'digits_tabular': len({hm[cmap[0x30 + i]][0] for i in range(10)}) == 1,
        'nnbsp_advance': hm[cmap[0x202F]][0] if 0x202F in cmap else None,
        'name1': n.getDebugName(1), 'name2': n.getDebugName(2), 'name6': n.getDebugName(6),
        'name16': n.getDebugName(16), 'name17': n.getDebugName(17),
        'weightClass': t['OS/2'].usWeightClass, 'kern': 'kern' in gpos, 'codepoints': len(cmap),
    }
    res['ok'] = (not res['missing'] and res['digits_tabular'] and res['nnbsp_advance'] is not None
                 and res['name16'] == family and res['name17'] == WNAME[weight] and res['weightClass'] == weight and res['kern'])
    return res


def main():
    os.makedirs(os.path.join(F, 'ttf'), exist_ok=True); os.makedirs(os.path.join(F, 'web'), exist_ok=True)
    tars = {k: fetch(k) for k in SOURCES}
    manifest = {'script': 'src/fonts.py', 'stamp': STAMP,
                'licence': 'SIL Open Font License 1.1, no Reserved Font Name: fonts/OFL-epilogue.txt, fonts/OFL-FiraSans.txt; changes listed in fonts/MODIFICATIONS.txt',
                'sources': {k: {kk: v[kk] for kk in ('package', 'version', 'url', 'integrity', 'sha256')} for k, v in SOURCES.items()},
                'faces': []}
    lines, failed = [], False
    for key, family, file_family, web_family, weight in FACES:
        raw, mname = member(tars[key], key, weight)
        t = TTFont(io.BytesIO(raw), recalcTimestamp=False)
        digits = tabular_default(t)
        nn = add_nnbsp(t)
        set_names(t, family, weight)
        do_subset(t)
        t['head'].modified = t['head'].created  # fixed, so a second run gives the same bytes
        ttf = os.path.join(F, 'ttf', f'{file_family}-{WNAME[weight]}.ttf')
        woff2 = os.path.join(F, 'web', f'{web_family}-{weight}.woff2')
        t.flavor = None
        t.save(ttf, reorderTables=True)
        w = TTFont(ttf, recalcTimestamp=False); w.flavor = 'woff2'; w.save(woff2)
        face = {'family': family, 'weight': weight, 'source': f'{SOURCES[key]["package"]}@{SOURCES[key]["version"]}:{mname}',
                'source_sha256': hashlib.sha256(raw).hexdigest(), 'digits_remapped': digits, 'nnbsp': nn, 'outputs': {}}
        for p in (ttf, woff2):
            c = check(p, family, weight)
            failed |= not c['ok']
            face['outputs'][os.path.relpath(p, ROOT)] = {'sha256': hashlib.sha256(open(p, 'rb').read()).hexdigest(),
                                                         'bytes': os.path.getsize(p), 'check': c}
            lines.append(f"{os.path.relpath(p, F)}: {'ok' if c['ok'] else 'FAIL'}; family {c['name16']!r} / {c['name17']!r} "
                         f"(legacy {c['name1']!r} {c['name2']!r}, PostScript {c['name6']}), weight {c['weightClass']}; "
                         f"{c['codepoints']} code points; tabular digits {'yes' if c['digits_tabular'] else 'NO'}; "
                         f"U+202F advance {c['nnbsp_advance']}; kern {'yes' if c['kern'] else 'NO'}; missing: {', '.join(c['missing']) or 'none'}")
        manifest['faces'].append(face)
    json.dump(manifest, open(os.path.join(F, 'manifest.json'), 'w'), indent=1, ensure_ascii=False)
    open(os.path.join(F, 'glyph-check.txt'), 'w').write(
        'Checked by src/fonts.py on every shipped file: the characters ' + ' '.join(NEED)
        + '; tabular default digits; U+202F; nameID 16/17; weight class; kerning.\n' + '\n'.join(lines) + '\n')
    print('\n'.join(lines))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
