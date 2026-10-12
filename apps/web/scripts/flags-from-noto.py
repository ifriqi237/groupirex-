#!/usr/bin/env python3
"""Drapeaux des 54 pays d'Afrique pour l'annuaire des partenaires (public/flags/<code>.png).

Les images sont extraites de la police Noto Color Emoji (Google, SIL Open Font License 1.1),
recadrées et réduites. À relancer seulement pour régénérer les fichiers :

    python3 scripts/flags-from-noto.py [/chemin/NotoColorEmoji.ttf]

Dépendances : fontTools, Pillow.
"""
import io
import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image

root = Path(__file__).resolve().parent.parent
font = TTFont(sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf')
codes = re.findall(r"code: '([A-Z]{2})'", (root / '../../packages/core/src/africa.ts').read_text(encoding='utf8'))
assert len(codes) == 54, len(codes)

cmap = font.getBestCmap()
indicator = lambda letter: cmap[0x1F1E6 + ord(letter) - 65]  # lettres « indicateur régional »
ligatures = {}
for lookup in font['GSUB'].table.LookupList.Lookup:
    for sub in lookup.SubTable:
        sub = sub.ExtSubTable if sub.LookupType == 7 else sub
        for first, items in (getattr(sub, 'ligatures', None) or {}).items():
            for lig in items:
                ligatures[(first, tuple(lig.Component))] = lig.LigGlyph

out = root / 'public/flags'
out.mkdir(parents=True, exist_ok=True)
total = 0
for code in codes:
    glyph = ligatures[(indicator(code[0]), (indicator(code[1]),))]
    data = next(strike[glyph].imageData for strike in font['CBDT'].strikeData if glyph in strike)
    image = Image.open(io.BytesIO(data)).convert('RGBA')
    image = image.crop(image.getbbox())
    # 72 px de large (affichés à 24-36 px) et palette réduite : environ 2 ko par drapeau.
    image = image.resize((72, round(72 * image.height / image.width)), Image.LANCZOS).quantize(colors=96, method=Image.FASTOCTREE)
    target = out / f'{code.lower()}.png'
    image.save(target, optimize=True)
    total += target.stat().st_size
(out / 'LICENSE.txt').write_text(
    'Drapeaux extraits de la police Noto Color Emoji (Google), version ' + font['name'].getDebugName(5).split(';')[0].replace('Version ', '') + '.\n'
    'Police sous SIL Open Font License 1.1 : https://openfontlicense.org\n'
    'Source : https://github.com/googlefonts/noto-emoji\n',
    encoding='utf8',
)
print(f'{len(codes)} drapeaux écrits dans {out} ({total // 1024} ko)')
