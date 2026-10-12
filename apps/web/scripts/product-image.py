#!/usr/bin/env python3
"""Prépare la photo d'un produit de démonstration : public/photos/<nom>.webp et <nom>-480.webp.

    python3 scripts/product-image.py <nom> <photo>

Une image de produit est recadrée différemment selon l'endroit (carré sur la fiche, 4:3 dans les
listes, 16:10 dans la bannière de l'accueil). On livre donc un carré : la photo y tient entière,
centrée, et son fond est prolongé en haut et en bas (ou sur les côtés). Le produit reste ainsi
visible en entier dans les trois cadrages. L'image n'est jamais déformée.
Une photo sur fond blanc n'a besoin de rien de plus : le site la montre entière dans chaque cadre
(composant ProductImage), si bien qu'un produit haut n'est jamais rogné.
En exploitation, les photos de produit se téléversent depuis le back-office (fiche produit).
Dépendance : Pillow.
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageStat

name, source = sys.argv[1], sys.argv[2]
SIDE = 1200
photo = Image.open(source).convert('RGB')

# Produit perdu au milieu d'un grand fond blanc (moins de 70 % de l'image en largeur comme en hauteur) :
# on resserre le cadre autour de lui, avec une marge, pour qu'il ne paraisse pas minuscule sur le site.
blank = Image.new('RGB', photo.size, (255, 255, 255))
box = ImageChops.difference(photo, blank).convert('L').point(lambda v: 255 if v > 18 else 0).getbbox()
if box and (box[2] - box[0]) < photo.width * 0.7 and (box[3] - box[1]) < photo.height * 0.7:
    pad = round(max(box[2] - box[0], box[3] - box[1]) * 0.08)
    photo = photo.crop((max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, photo.width), min(box[3] + pad, photo.height)))
scale = SIDE / max(photo.size)
sharp = photo.resize((round(photo.width * scale), round(photo.height * scale)), Image.LANCZOS)
x0, y0 = (SIDE - sharp.width) // 2, (SIDE - sharp.height) // 2


def band(strip: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Prolonge une fine bande de bord sur toute la marge."""
    return strip.resize(size, Image.BILINEAR).filter(ImageFilter.GaussianBlur(8))


def uniform(strip: Image.Image) -> bool:
    return max(ImageStat.Stat(strip).stddev) < 14


def white(strip: Image.Image) -> bool:
    """Bord blanc : la marge reste d'un blanc pur, sans y prolonger le grain de la photo."""
    return min(ImageStat.Stat(strip).mean) >= 246


canvas = Image.new('RGB', (SIDE, SIDE), (255, 255, 255))
if sharp.height < SIDE:
    top, bottom = sharp.crop((0, 0, sharp.width, 4)), sharp.crop((0, sharp.height - 4, sharp.width, sharp.height))
    plain = uniform(top) and uniform(bottom)
    if plain and not (white(top) and white(bottom)):
        canvas.paste(band(top, (SIDE, y0 + 4)), (0, 0))
        canvas.paste(band(bottom, (SIDE, SIDE - y0 - sharp.height + 4)), (0, y0 + sharp.height - 4))
elif sharp.width < SIDE:
    left, right = sharp.crop((0, 0, 4, sharp.height)), sharp.crop((sharp.width - 4, 0, sharp.width, sharp.height))
    plain = uniform(left) and uniform(right)
    if plain and not (white(left) and white(right)):
        canvas.paste(band(left, (x0 + 4, SIDE)), (0, 0))
        canvas.paste(band(right, (SIDE - x0 - sharp.width + 4, SIDE)), (x0 + sharp.width - 4, 0))
else:
    plain = True
if not plain:
    # Décor chargé au bord : on complète par la même photo, agrandie et floutée.
    cover = SIDE / min(photo.size)
    back = photo.resize((round(photo.width * cover), round(photo.height * cover)), Image.LANCZOS)
    left, top = (back.width - SIDE) // 2, (back.height - SIDE) // 2
    canvas = back.crop((left, top, left + SIDE, top + SIDE)).filter(ImageFilter.GaussianBlur(40))
canvas.paste(sharp, (x0, y0))


out = Path(__file__).resolve().parent.parent / 'public/photos'
out.mkdir(parents=True, exist_ok=True)
canvas.save(out / f'{name}.webp', quality=88, method=6)
canvas.resize((480, 480), Image.LANCZOS).save(out / f'{name}-480.webp', quality=84, method=6)
sizes = ', '.join(f'{(out / f).stat().st_size // 1024} ko' for f in (f'{name}.webp', f'{name}-480.webp'))
print(f'{out}/{name}.webp : {SIDE}×{SIDE}, photo {sharp.width}×{sharp.height}, fond {"prolongé" if plain else "flouté"} ; vignette 480×480 ({sizes})')
