#!/usr/bin/env python3
# evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""Build the planet texture atlas from Solar System Scope's maps.

    python scripts/build-planet-textures.py

Writes site/src/data/planets.webp and prints what it did. Run rarely -- the
output is committed, like stars.json and milkyway.webp.

SOURCE, AND WHY THIS ONE

    Solar System Scope (INOVE), https://www.solarsystemscope.com/textures/
    Equirectangular maps built from NASA imagery, and in the projection this
    needs: longitude across, latitude up.

    Licensed CC BY 4.0 -- "You may use, adapt, and share these textures for
    any purpose, even commercially" -- which is the same licence the Milky
    Way panorama ships under, so the credit joins it on the legend plate
    rather than hiding in a file nobody opens.

ONE ATLAS, NOT EIGHT FILES

    This app works with the radio off, so every byte is precached by the
    service worker before it is ever needed. Eight requests become one, one
    cache entry instead of eight, and the whole thing decodes once.

    The planets are stacked vertically, each TILE_W x TILE_H, in the order
    of PLANETS below -- which is the order the app's own PLANET_NAMES uses,
    because a renderer that has to look up which row is Saturn will one day
    get it wrong.

SMALL ON PURPOSE

    A planet is drawn a few dozen pixels across. A 2k map is four orders of
    magnitude more texture than that can show, so it is downscaled hard: at
    128x64 per planet the whole atlas is a few kilobytes, and at the size a
    disc is actually drawn there is nothing visible to lose. What survives is
    exactly what should: Jupiter's belts, Mars' dark maria, Saturn's bands.

    LANCZOS, not the default. Downscaling by 16x with a box filter turns
    Jupiter's belts into mud; Lanczos keeps the banding legible, which is the
    entire reason the texture is here.

PLUTO GETS NO TEXTURE, DELIBERATELY

    Solar System Scope does not publish one, and the New Horizons map covers
    one hemisphere -- the other is a blur from a flyby that saw it once. At
    magnitude 14 Pluto is also never visible to the eye. It keeps its flat
    colour, and the renderer falls back cleanly for anything with no row.
"""
import io
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "src" / "data" / "planets.webp"
BASE = "https://www.solarsystemscope.com/textures/download/"

TILE_W, TILE_H = 128, 64
QUALITY = 88

# Order matters: the renderer indexes rows by this list. Venus uses the
# SURFACE map rather than the cloud map -- the clouds are a featureless
# cream and would render as a blank disc, while the surface at least shows
# something, and neither is what an eye at a telescope sees anyway.
PLANETS = [
    ("Mercury", "2k_mercury.jpg"),
    ("Venus", "2k_venus_surface.jpg"),
    ("Mars", "2k_mars.jpg"),
    ("Jupiter", "2k_jupiter.jpg"),
    ("Saturn", "2k_saturn.jpg"),
    ("Uranus", "2k_uranus.jpg"),
    ("Neptune", "2k_neptune.jpg"),
]


def fetch(name: str) -> Image.Image:
    url = BASE + name
    print(f"  fetching {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "evo.polaris build script"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def main() -> int:
    atlas = Image.new("RGB", (TILE_W, TILE_H * len(PLANETS)))
    for row, (planet, filename) in enumerate(PLANETS):
        try:
            src = fetch(filename)
        except Exception as exc:                       # noqa: BLE001 - report and stop
            print(f"  FAILED {planet}: {exc}", file=sys.stderr)
            return 1
        tile = src.resize((TILE_W, TILE_H), Image.LANCZOS)
        atlas.paste(tile, (0, row * TILE_H))
        print(f"  {planet:<8} {src.width}x{src.height} -> {TILE_W}x{TILE_H}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT, "WEBP", quality=QUALITY, method=6)
    size = OUT.stat().st_size
    print(f"\nwrote {OUT.relative_to(ROOT)}  {atlas.width}x{atlas.height}  {size / 1024:.1f} KB")
    print(f"rows, in order: {', '.join(p for p, _ in PLANETS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
