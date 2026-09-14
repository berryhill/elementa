"""Regenerate committed social cards with Pillow and the supplied transparent wordmark.
Requires Pillow and system DejaVu Sans. No AI-generated or redrawn brand artwork.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
for lang, date, location in [
    ('es', '19–20 DE FEBRERO DE 2027', 'PLAYA VENAO, PANAMÁ'),
    ('en', 'FEBRUARY 19–20, 2027', 'PLAYA VENAO, PANAMA'),
]:
    image = Image.new('RGB', (1200, 630), '#080e0e')
    draw = ImageDraw.Draw(image)
    cream = '#eadfc9'
    draw.rectangle((36, 36, 1163, 593), outline='#504f43', width=1)
    wordmark = Image.open(ROOT / 'public/assets/elementa-wordmark.png').convert('RGBA')
    wordmark.thumbnail((960, 120), Image.Resampling.LANCZOS)
    image.paste(wordmark, ((1200-wordmark.width)//2, 175), wordmark)
    def centered(text, y, size):
        font = ImageFont.truetype(FONT, size)
        draw.text((600, y), text, font=font, fill=cream, anchor='mt')
    centered('O R I G I N S   2 0 2 7', 302, 28)
    draw.line((530, 380, 670, 380), fill='#746e5f', width=1)
    centered(date, 423, 30)
    centered(location, 478, 23)
    target = ROOT / f'public/assets/elementa-social-{lang}-v1.jpg'
    image.save(target, quality=95, subsampling=0, optimize=True)
    print(target.name, target.stat().st_size)
