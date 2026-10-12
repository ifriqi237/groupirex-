#!/usr/bin/env python3
"""Prépare la photo d'une catégorie : public/categories/<slug>.webp, au format des tuiles (9:7).

    python3 scripts/category-image.py <slug> <photo>

Un produit sur fond blanc est détouré de ses marges puis centré ; une photo avec décor est gardée
entière, ses côtés complétés par un flou de la même photo — ou, quand son fond est presque blanc
(photo compressée, fond gris très clair), par le prolongement de son bord. L'image n'est jamais déformée.
Il reste à pointer la catégorie vers l'image : dans le back-office (rubrique Catégories) ou par
une migration, comme 0005 et 0006. Dépendance : Pillow.
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

slug, source = sys.argv[1], sys.argv[2]
W, H = 720, 560  # 9:7
photo = Image.open(source).convert('RGB')
white = Image.new('RGB', photo.size, (255, 255, 255))
box = ImageChops.difference(photo, white).convert('L').point(lambda v: 255 if v > 18 else 0).getbbox() or (0, 0, *photo.size)
on_white = (box[2] - box[0]) < photo.width * 0.98 or (box[3] - box[1]) < photo.height * 0.98

if on_white:
    # Produit sur fond blanc : on le détoure de ses marges, puis on le centre sans le déformer.
    # Il occupe au plus 86 % de la largeur et 78 % de la hauteur de la tuile ; pas d'agrandissement au-delà de 2 fois.
    pad = round(max(photo.size) * 0.03)  # un peu de marge, pour que le fondu ne morde pas sur le produit
    subject = photo.crop((max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, photo.width), min(box[3] + pad, photo.height)))
    scale = min(W * 0.86 / subject.width, H * 0.78 / subject.height, 2)
    subject = subject.resize((round(subject.width * scale), round(subject.height * scale)), Image.LANCZOS)
    canvas = Image.new('RGB', (W, H), (255, 255, 255))
    # Fondu vers le blanc sur le pourtour : une ombre douce coupée par le détourage ne laisse pas de bord net.
    edge = Image.new('L', subject.size, 255)
    for i in range(22):
        level = round(255 * (i + 1) / 22)
        edge.paste(level, (i, i, subject.width - i, i + 1))
        edge.paste(level, (i, subject.height - i - 1, subject.width - i, subject.height - i))
        edge.paste(level, (i, i, i + 1, subject.height - i))
        edge.paste(level, (subject.width - i - 1, i, subject.width - i, subject.height - i))
    canvas.paste(subject, ((W - subject.width) // 2, (H - subject.height) // 2), edge)
    note = f'sujet {subject.width}×{subject.height} sur fond blanc'
else:
    # Photo avec décor : on la garde entière. Les bandes laissées sur les côtés sont remplies par
    # la même photo, agrandie et floutée, avec un fondu aux raccords.
    scale = min(W / photo.width, H / photo.height)
    sharp = photo.resize((round(photo.width * scale), round(photo.height * scale)), Image.LANCZOS)
    cover = max(W / photo.width, H / photo.height)
    back = photo.resize((round(photo.width * cover), round(photo.height * cover)), Image.LANCZOS)
    left, top = (back.width - W) // 2, (back.height - H) // 2
    # Fond presque blanc (bord de la photo clair et sans couleur) : un flou y laisserait des traînées
    # colorées ; on complète alors par du blanc.
    edge = sorted(photo.getpixel((x, y)) for x in (0, photo.width - 1) for y in range(0, photo.height, 4))
    pale = min(edge[len(edge) // 2]) >= 236 and max(edge[len(edge) // 2]) - min(edge[len(edge) // 2]) <= 10
    if pale:
        # On prolonge le bord même de la photo (sa teinte exacte, ligne par ligne) : le raccord ne se voit pas.
        canvas = Image.new('RGB', (W, H), (255, 255, 255))
        x0, y0 = (W - sharp.width) // 2, (H - sharp.height) // 2
        if sharp.width < W:
            canvas.paste(sharp.crop((0, 0, 4, sharp.height)).resize((x0 + 4, sharp.height)).filter(ImageFilter.GaussianBlur(6)), (0, y0))
            canvas.paste(sharp.crop((sharp.width - 4, 0, sharp.width, sharp.height)).resize((W - x0 - sharp.width + 4, sharp.height)).filter(ImageFilter.GaussianBlur(6)), (x0 + sharp.width - 4, y0))
        if sharp.height < H:
            canvas.paste(sharp.crop((0, 0, sharp.width, 4)).resize((sharp.width, y0 + 4)).filter(ImageFilter.GaussianBlur(6)), (x0, 0))
            canvas.paste(sharp.crop((0, sharp.height - 4, sharp.width, sharp.height)).resize((sharp.width, H - y0 - sharp.height + 4)).filter(ImageFilter.GaussianBlur(6)), (x0, y0 + sharp.height - 4))
    else:
        canvas = back.crop((left, top, left + W, top + H)).filter(ImageFilter.GaussianBlur(26))
    mask = Image.new('L', sharp.size, 255)
    fade = 0 if pale else 28  # bord prolongé : pas de fondu, le raccord est déjà exact
    for i in range(fade):
        level = round(255 * (i + 1) / fade)
        if sharp.width < W:
            mask.paste(level, (i, 0, i + 1, sharp.height))
            mask.paste(level, (sharp.width - i - 1, 0, sharp.width - i, sharp.height))
        if sharp.height < H:
            mask.paste(level, (0, i, sharp.width, i + 1))
            mask.paste(level, (0, sharp.height - i - 1, sharp.width, sharp.height - i))
    canvas.paste(sharp, ((W - sharp.width) // 2, (H - sharp.height) // 2), mask)
    note = f'photo entière {sharp.width}×{sharp.height}, côtés complétés' + (' par le prolongement du bord' if pale else '')

out = Path(__file__).resolve().parent.parent / 'public/categories' / f'{slug}.webp'
out.parent.mkdir(parents=True, exist_ok=True)
canvas.save(out, quality=90, method=6)
print(f'{out} : {W}×{H}, {note}, {out.stat().st_size // 1024} ko')
