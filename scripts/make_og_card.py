# evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

r"""Render this app's link-preview card.

    python scripts\make_og_card.py            # writes site/og-card.png

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

THE CHART IS NEVER UPSCALED, AND IS NO LONGER A SCREENSHOT. Earlier cards took
the app's 420px canvas and scaled it UP to 470px, which is why they stayed soft
however the quality was set. The fix after that was a hand-captured 1260px
screenshot pasted into media/og-shot.png -- sharp, but it required opening the
live site and pasting JavaScript into the console to regenerate, and a card you
cannot rebuild from a single command is a card that drifts from the app.

So the chart is drawn here instead, in Python, from the same
site/src/data/stars.json the app ships and with the same projection. It renders
at SS times final size and comes down once with LANCZOS, so the stars -- which
are one or two pixels at final size -- resolve as points rather than aliased
squares. --shot is still accepted for a one-off, but nothing needs it.

The chart is NORTHERN and drawn at a fixed sidereal time. The card says find
Polaris, and Polaris is not visible from the southern hemisphere - a southern
chart shipped once and contradicted the words printed beside it. Fixing the
time also makes the card reproducible: rebuilding it on a different evening
must not silently produce a different picture and a pointless diff.

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
# Supersample the WHOLE card, text included, then come down once. LinkedIn
# re-encodes and downscales what it fetches, so the sharper the source the
# better it survives that second pass.
SS = 3

STARS = Path(__file__).resolve().parent.parent / "site" / "src" / "data" / "stars.json"
# Solved for, not guessed: puts Dubhe lower-left and Cassiopeia upper-right,
# the arrangement the app's own caption describes.
LST_HOURS = 20.06
FIELD_DEG = 50.0
BIG_DIPPER = [(5191, 5054), (5054, 4905), (4905, 4660), (4660, 4554),
              (4554, 4295), (4295, 4301), (4301, 4660)]
CASSIOPEIA = [(21, 168), (168, 264), (264, 403), (403, 542)]
LITTLE_DIPPER = [(424, 5563), (5563, 5735)]
POLARIS_HR, DUBHE_HR = 424, 4301
AMBER = "#ffb454"

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
# The supporting paragraph. Every line is a README claim, unchanged.
#
# WHO IT IS FOR GOES FIRST, AND IN THE BRIGHTER INK. The card said what the app
# does and never who it was built for, so the one thing that makes it different
# from every paid alternative was the one thing a shared link left out. The two
# lines under it are the evidence for the first: without them "made for
# astronomers with disabilities" is a claim, and with them it is a description.
PARAGRAPH = ["Made for astronomers with disabilities.",
             "Works offline. Reads the numbers aloud.",
             "Works entirely by single taps."]
DOMAIN = "polaris.evomedia.net"


def _star_colour(bv: float):
    for limit, rgb in ((-0.1, (168, 200, 255)), (0.3, (255, 255, 255)),
                       (0.6, (255, 246, 224)), (1.0, (255, 224, 168)),
                       (1.5, (255, 192, 128))):
        if bv < limit:
            return rgb
    return (255, 158, 110)


def render_chart(px: int) -> Image.Image:
    """The sky chart, square, px wide, drawn from the app's own catalogue."""
    import json
    import math

    img = Image.new("RGB", (px, px), BG)
    d = ImageDraw.Draw(img)
    c = px / 2
    r = px / 2 - max(1, px // 300)
    unit = max(1.0, px / 470)          # one final-size pixel, in chart pixels

    def place(ra, dec):
        rr = 90.0 - dec
        if rr > FIELD_DEG:
            return None
        ha = math.radians(LST_HOURS * 15.0 - ra)
        k = (rr / FIELD_DEG) * r
        return (c - k * math.sin(ha), c - k * math.cos(ha))

    for deg in range(10, int(FIELD_DEG) + 1, 10):
        rr = r * deg / FIELD_DEG
        d.ellipse([c - rr, c - rr, c + rr, c + rr], outline=LINE, width=max(1, int(unit)))

    placed = {}
    for ra, dec, mag, bv, hr, _n in json.loads(STARS.read_text()):
        if mag > 5.6:
            continue
        p = place(ra, dec)
        if p is None:
            continue
        placed[hr] = p
        rad = max(0.55 * unit, (6.2 - mag) * 0.42 * unit)
        d.ellipse([p[0] - rad, p[1] - rad, p[0] + rad, p[1] + rad], fill=_star_colour(bv))

    for group in (BIG_DIPPER, CASSIOPEIA, LITTLE_DIPPER):
        for a, b in group:
            if a in placed and b in placed:
                d.line([placed[a], placed[b]], fill="#5b7fb8", width=max(1, int(1.1 * unit)))

    if DUBHE_HR in placed and POLARIS_HR in placed:
        (x0, y0), (x1, y1) = placed[DUBHE_HR], placed[POLARIS_HR]
        total = math.hypot(x1 - x0, y1 - y0)
        dash, gap, t = 8 * unit, 6 * unit, 0.0
        while t < total:
            t2 = min(t + dash, total)
            d.line([(x0 + (x1 - x0) * t / total, y0 + (y1 - y0) * t / total),
                    (x0 + (x1 - x0) * t2 / total, y0 + (y1 - y0) * t2 / total)],
                   fill=AMBER, width=max(2, int(2.2 * unit)))
            t = t2 + gap

    if POLARIS_HR in placed:
        x, y = placed[POLARIS_HR]
        rr = 13 * unit
        d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=ACCENT, width=max(2, int(2 * unit)))
        d.text((x + rr + 7 * unit, y), "Polaris",
               font=font(SANS_SEMIBOLD, max(10, int(25 * unit))), fill=ACCENT, anchor="lm")

    # Clear of the outer ring. It sat ON the 50-degree circle before, so the
    # glyphs were struck through by a line at exactly mid-x-height.
    d.text((c, c + r - 30 * unit), "horizon below",
           font=font(SANS_SEMIBOLD, max(8, int(17 * unit))), fill=DIM, anchor="mm")
    return img


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def build(shot: Path | None = None) -> Image.Image:
    """Compose at SS times final size, then come down once with LANCZOS."""
    w, h = SIZE[0] * SS, SIZE[1] * SS
    card = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(card)

    # No glow behind the chart. A radial falloff was tried and removed: PIL has
    # no radial fill, and stacking ellipses to fake one banded visibly at this
    # size - a hard circular edge across the left of the card. Flat ground is
    # the honest version, and the disc has its own outline to sit against.

    # The chart: drawn at full supersampled size, or brought DOWN from a
    # supplied screenshot. Never up.
    d_px = CHART_D * SS
    if shot is None:
        im = render_chart(d_px)
    else:
        im = Image.open(shot).convert("RGB").resize((d_px, d_px), Image.LANCZOS)
    mask = Image.new("L", (d_px, d_px), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, d_px - 1, d_px - 1), fill=255)
    card.paste(im, (CHART_CX * SS - d_px // 2, CHART_CY * SS - d_px // 2), mask)
    draw.ellipse((CHART_CX * SS - d_px // 2, CHART_CY * SS - d_px // 2,
                  CHART_CX * SS + d_px // 2, CHART_CY * SS + d_px // 2),
                 outline=LINE, width=2 * SS)

    # Wordmark, with the dot in the accent colour exactly as the page's <h1>.
    f_title = font(SANS_BOLD, 62 * SS)
    x, y = PAD * SS, 128 * SS
    draw.text((x, y), "evo", font=f_title, fill=INK)
    x += draw.textlength("evo", font=f_title)
    draw.text((x, y), ".", font=f_title, fill=ACCENT)
    x += draw.textlength(".", font=f_title)
    draw.text((x, y), "polaris", font=f_title, fill=INK)

    f_head = font(SANS_SEMIBOLD, 35 * SS)
    y = 238 * SS
    for line in HEADLINE:
        draw.text((PAD * SS, y), line, font=f_head, fill=INK)
        y += 46 * SS

    # Three lines now rather than two, so the block starts higher: 338 + three
    # 40s ends at 458, which still clears the accent rule at 478.
    f_para = font(SANS, 29 * SS)
    y = 338 * SS
    for index, line in enumerate(PARAGRAPH):
        draw.text((PAD * SS, y), line, font=f_para,
                  fill=INK if index == 0 else DIM)
        y += 40 * SS

    draw.rectangle((PAD * SS, 478 * SS, (PAD + 74) * SS, 481 * SS), fill=ACCENT)

    draw.text((PAD * SS, 508 * SS), DOMAIN, font=font(MONO_BOLD, 26 * SS), fill=DIM)

    return card.resize(SIZE, Image.LANCZOS)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--shot", type=Path, default=None,
                    help="optional square chart image; omitted, the chart is "
                         "drawn from site/src/data/stars.json")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent.parent / "site" / "og-card.png")
    args = ap.parse_args()

    if args.shot is not None:
        im = Image.open(args.shot)
        if im.width != im.height:
            raise SystemExit(f"--shot must be square; got {im.width}x{im.height}")
        # Upscaling the chart is the defect this file exists to prevent, so it
        # is refused rather than merely discouraged.
        if im.width < CHART_D * SS:
            raise SystemExit(
                f"--shot is {im.width}px and the card draws it at "
                f"{CHART_D * SS}px internally: that would upscale. Omit --shot "
                "and let it be rendered.")

    card = build(args.shot)
    if card.size != SIZE:
        raise SystemExit(f"size drifted: {card.size}")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    card.save(args.out, "PNG", optimize=True)
    print(f"wrote {args.out}  {card.width}x{card.height}  "
          f"{args.out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
