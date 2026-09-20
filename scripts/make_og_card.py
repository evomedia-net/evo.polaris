r"""Render this app's link-preview card.

    python scripts\make_og_card.py --shot media\og-shot.png --out site\og-card.png

The fleet has a shared generator at evo.scripts\make_og_card.py and most sites
should use it. This one does not, for the reason that file's own header gives
for evo.ehs: a card built around a product image is a different layout, and it
belongs with the image it depends on.

The shared layout reserves `w - 400` for text and insets the shot beside it.
That suits a card whose picture is supporting evidence. Here the picture IS the
product - a sky chart with Polaris ringed and the Dipper pointing at it - and
squeezing it into the leftover column made it smaller than in any earlier
version, which was the whole complaint.

So: the original arrangement. Wordmark, headline, a short supporting paragraph,
a rule, the domain - and the chart at 470px on the right.

WHY EVERYTHING IS LARGER THAN IT LOOKS IT NEEDS TO BE. LinkedIn re-encodes and
downscales what it fetches; a card that is pin-sharp at 1200px is rendered from
a much smaller copy in the feed. Type that reads comfortably at full size turns
to mush there. The sizes here are the largest the composition allows, not the
smallest that looked fine on a desktop.

THE CHART IS NEVER UPSCALED. The app draws its sky chart on a 420px canvas; the
first three cards took that and scaled it UP to 470px, which is why they stayed
soft however the quality was set. media/og-shot.png is rendered by the app's own
drawSkyChart at 1260px and comes DOWN to 470 here. To regenerate it, open the
live site and run:

    const chart = await import('/src/chart.js');
    const astro = await import('/src/astro.js');
    const stars = await (await fetch('/src/data/stars.json')).json();
    const lst = astro.lstHours(astro.julianDay(new Date()), -95.2622);
    const c = document.createElement('canvas'); c.width = c.height = 1260;
    chart.drawSkyChart(c.getContext('2d'),
        {stars, lst, radiusDeg: 50, night: false, size: 1260, south: false});
    c.toBlob(b => { const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = 'og-shot.png'; a.click(); });

Use a NORTHERN longitude/latitude. The card says find Polaris, and Polaris is
not visible from the southern hemisphere - a southern chart shipped once, and
it contradicted the words printed beside it.

PNG, not JPEG: flat colour and text on a dark ground is what PNG keeps sharp
and what JPEG's chroma subsampling smears.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONTS = Path("C:/Windows/Fonts")
SANS = "segoeui.ttf"
SANS_BOLD = "segoeuib.ttf"
SANS_SEMIBOLD = "seguisb.ttf"
MONO_BOLD = "consolab.ttf"

SIZE = (1200, 630)

# The app's own palette, from site/src/style.css, so the card and the page look
# like one product rather than two.
BG = "#080b14"
INK = "#e8ecf4"
DIM = "#b6c0d4"        # --ink-dim lifted a little: it is read at thumbnail size
ACCENT = "#7CFFB2"
LINE = "#243049"

PAD = 78
CHART_CX, CHART_CY, CHART_D = 880, 315, 470

TITLE = "evo.polaris"
HEADLINE = ["Free polar alignment for star", "trackers and equatorial mounts."]
# The supporting paragraph. Both sentences are the README's claims, unchanged.
PARAGRAPH = ["Works offline. Reads the numbers aloud.",
             "No pinching, dragging or press-and-hold."]
DOMAIN = "polaris.evomedia.net"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def build(shot: Path) -> Image.Image:
    card = Image.new("RGB", SIZE, BG)
    draw = ImageDraw.Draw(card)

    # No glow behind the chart. A radial falloff was tried and removed: PIL has
    # no radial fill, and stacking ellipses to fake one banded visibly at this
    # size - a hard circular edge across the left of the card. Flat ground is
    # the honest version, and the disc has its own outline to sit against.

    # The chart, brought DOWN from 1260px and masked to a circle.
    im = Image.open(shot).convert("RGB").resize((CHART_D, CHART_D), Image.LANCZOS)
    mask = Image.new("L", (CHART_D, CHART_D), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, CHART_D - 1, CHART_D - 1), fill=255)
    card.paste(im, (CHART_CX - CHART_D // 2, CHART_CY - CHART_D // 2), mask)
    draw.ellipse((CHART_CX - CHART_D // 2, CHART_CY - CHART_D // 2,
                  CHART_CX + CHART_D // 2, CHART_CY + CHART_D // 2),
                 outline=LINE, width=2)

    # Wordmark, with the dot in the accent colour exactly as the page's <h1>.
    f_title = font(SANS_BOLD, 62)
    x, y = PAD, 128
    draw.text((x, y), "evo", font=f_title, fill=INK)
    x += draw.textlength("evo", font=f_title)
    draw.text((x, y), ".", font=f_title, fill=ACCENT)
    x += draw.textlength(".", font=f_title)
    draw.text((x, y), "polaris", font=f_title, fill=INK)

    f_head = font(SANS_SEMIBOLD, 35)
    y = 238
    for line in HEADLINE:
        draw.text((PAD, y), line, font=f_head, fill=INK)
        y += 46

    f_para = font(SANS, 29)
    y = 358
    for line in PARAGRAPH:
        draw.text((PAD, y), line, font=f_para, fill=DIM)
        y += 40

    draw.rectangle((PAD, 478, PAD + 74, 481), fill=ACCENT)

    draw.text((PAD, 508), DOMAIN, font=font(MONO_BOLD, 26), fill=DIM)
    return card


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--shot", required=True, type=Path,
                    help="the sky chart, square, rendered by drawSkyChart")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    im = Image.open(args.shot)
    if im.width != im.height:
        raise SystemExit(f"--shot must be square; got {im.width}x{im.height}")
    # Upscaling the chart is the defect this file exists to prevent, so it is
    # refused rather than merely discouraged.
    if im.width < CHART_D:
        raise SystemExit(
            f"--shot is {im.width}px and the card draws it at {CHART_D}px: "
            "that would upscale. Re-render it at 1260px (see the module "
            "docstring) rather than letting it be stretched.")

    card = build(args.shot)
    if card.size != SIZE:
        raise SystemExit(f"size drifted: {card.size}")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    card.save(args.out, "PNG", optimize=True)
    print(f"wrote {args.out}  {card.width}x{card.height}  "
          f"{args.out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
