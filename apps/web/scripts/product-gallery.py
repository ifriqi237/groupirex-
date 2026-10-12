#!/usr/bin/env python3
"""Galerie d'un produit de démonstration : vues de détail et courte vidéo, à partir de sa photo.

    python3 scripts/product-gallery.py <nom> "<cx,cy,côté>;<cx,cy,côté>;…"

La page d'une offre présente le produit dans un carrousel (jusqu'à dix photos et une vidéo).
Pour que la démonstration le montre sans disposer d'autres prises de vue, ce script tire de
public/photos/<nom>.webp :
  - une vue de détail par zone demandée (centre et côté en fractions de l'image, ou bien un
    rectangle x0,y0,x1,y1 posé entier sur un carré blanc) : <nom>-d1.webp, <nom>-d1-480.webp, … ;
  - une vidéo de six secondes qui parcourt lentement la photo : <nom>.mp4.
Ce sont des contenus de démonstration. En exploitation, les vraies photos et la vraie vidéo se
téléversent depuis le back-office (fiche produit, onglet « Photos et vidéos »).
Dépendances : Pillow, ffmpeg.
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageFilter

name, zones = sys.argv[1], [z for z in sys.argv[2].split(';') if z.strip()]
photos = Path(__file__).resolve().parent.parent / 'public/photos'
source = Image.open(photos / f'{name}.webp').convert('RGB')
W, H = source.size

for n, zone in enumerate(zones, 1):
    values = [float(v) for v in zone.split(',')]
    if len(values) == 4:
        # Rectangle x0,y0,x1,y1 : la zone est posée entière, centrée, sur un carré blanc.
        x0, y0, x1, y1 = values
        part = source.crop((round(x0 * W), round(y0 * H), round(x1 * W), round(y1 * H)))
        edge = max(part.size)
        detail = Image.new('RGB', (edge, edge), (255, 255, 255))
        detail.paste(part, ((edge - part.width) // 2, (edge - part.height) // 2))
    else:
        cx, cy, side = values
        half = side * W / 2
        left = min(max(cx * W - half, 0), W - 2 * half)
        top = min(max(cy * H - half, 0), H - 2 * half)
        detail = source.crop((round(left), round(top), round(left + 2 * half), round(top + 2 * half)))
    # Agrandissement modéré, avec un léger renfort de netteté.
    detail = detail.resize((1000, 1000), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    detail.save(photos / f'{name}-d{n}.webp', quality=86, method=6)
    detail.resize((480, 480), Image.LANCZOS).save(photos / f'{name}-d{n}-480.webp', quality=84, method=6)

# Vidéo : un lent zoom avant sur la photo, 6 secondes, 720 × 720, sans son.
frames = 150
video = photos / f'{name}.mp4'
subprocess.run(
    [
        'ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-i', str(photos / f'{name}.webp'),
        '-vf', f"scale=2160:2160,zoompan=z='1+0.22*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=720x720:fps=25,format=yuv420p",
        '-frames:v', str(frames), '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-movflags', '+faststart', '-an', str(video),
    ],
    check=True,
)
print(f'{name} : {len(zones)} vue(s) de détail, vidéo de {video.stat().st_size // 1024} ko')
