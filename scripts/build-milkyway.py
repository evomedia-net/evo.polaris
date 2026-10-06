#!/usr/bin/env python3
# evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""Build the Milky Way texture from ESO's all-sky panorama.

    python scripts/build-milkyway.py [--source path/to/eso0932a.tif]

Downloads the source if it is not given, writes site/src/data/milkyway.webp,
and prints what it did. Run rarely -- the output is committed, like stars.json.

SOURCE, AND WHY THIS ONE

    ESO/S. Brunier -- "The Milky Way panorama", eso0932a
    https://www.eso.org/public/images/eso0932a/

    6000x3000, and already in the projection this needs: galactic longitude
    across, latitude up, plane horizontal. Licensed CC BY 4.0, which permits
    redistribution and commercial use with a visible credit -- so the credit
    is part of the app's UI, not just a line in a licence file. ESO's terms
    say it "cannot be hidden or separated from the image", so it appears
    wherever the sky is drawn, full screen included.

    The lossless TIF is used rather than the JPEG. It is barely larger over
    the wire (mostly black sky compresses hard) and the JPEG's 8-pixel blocks
    survive into the diffuse layer as a faint cellular texture once anything
    non-linear touches them.

LONGITUDE RUNS LEFTWARD, AND THAT WAS MEASURED, NOT ASSUMED

    Getting it backwards mirrors the entire sky, and it is the kind of mistake
    that looks plausible. So it was checked against two objects whose galactic
    coordinates are known exactly:

        LMC  l=280.5 b=-32.9   leftward 38.2   rightward 11.1   (background 7.7)
        SMC  l=302.8 b=-44.3   leftward 18.7   rightward 10.0

    Both land on a bright cloud only under the leftward reading, which is the
    astronomical convention. The galactic centre also falls at x=2978 of 3000,
    and the faintest point along b=0 at the anticentre, as it must.

THE STARS HAVE TO COME OUT

    This is a photograph, so it contains tens of thousands of point stars --
    and the app draws its OWN stars from Hipparcos, at computed positions. Two
    sets of stars, slightly offset, would undermine the one thing this view
    promises: that what you see is where things really are.

    Removal is by DIFFERENCE, not morphology. Blur to get the diffuse
    component, find pixels standing far above it, replace only those. A star
    is a few pixels at 16.7 px/deg; the band is degrees and even the
    Magellanic Clouds are ~170 px, so the diffuse structure is never touched.
    A grey opening was tried first and left a cellular texture across the
    bright regions -- its square structuring element, printed on the picture.

    KNOWN LIMIT: a handful of ~1 degree blobs survive, being the photographic
    halos of the very brightest stars and some globular clusters. They sit at
    the true positions of stars the app draws anyway, so they read as halo
    rather than as duplicates. Raising SIGMA on the passes below would take
    them, at the cost of flattening structure inside the Magellanic Clouds.
    That trade was taken deliberately in this direction.

WHY GREYSCALE

    The naked-eye Milky Way has no colour -- at that light level human vision
    is scotopic. Storing luminance also means the app can tint it, which is
    what makes Night Mode work, and costs a third of the bytes.
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
    from scipy import ndimage
except ImportError as e:                                    # pragma: no cover
    sys.exit(f"needs numpy, pillow and scipy: {e}")

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "src" / "data" / "milkyway.webp"
SOURCE_URL = "https://cdn.eso.org/images/original/eso0932a.tif"
CREDIT = "ESO/S. Brunier"

# Output size. The source is 0.06 deg/px; this keeps most of that at 0.088,
# which matters because the view zooms to a 10 degree field. It costs about
# 60 KB -- the whole sky, against 360 KB of star catalogue.
OUT_W, OUT_H = 4096, 2048
QUALITY = 80

# Star-removal passes: (blur sigma in source pixels, threshold in sigmas).
# Coarse first for the big halos, then finer for ordinary stars.
PASSES = ((6.0, 2.5), (4.0, 3.0), (2.5, 3.0))


def fetch(path: Path) -> Path:
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {SOURCE_URL}")
    urllib.request.urlretrieve(SOURCE_URL, path)
    return path


def diffuse(a: np.ndarray) -> np.ndarray:
    """The photograph with its point sources replaced by their surroundings."""
    work = a.copy()
    for sigma, k in PASSES:
        smooth = ndimage.gaussian_filter(work, sigma)
        resid = work - smooth
        stars = resid > k * resid.std()
        work = np.where(stars, smooth, work)
        print(f"  sigma {sigma}: replaced {stars.mean() * 100:.2f}% of pixels")
    return work


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", type=Path, default=None,
                    help="the ESO TIF; downloaded to a temp path if omitted")
    args = ap.parse_args()

    src = fetch(args.source or (ROOT / ".cache" / "eso0932a.tif"))
    a = np.asarray(Image.open(src).convert("L"), dtype=np.float32)
    print(f"  source {a.shape[1]}x{a.shape[0]}, {360 / a.shape[1]:.3f} deg/px")
    if a.shape != (3000, 6000):
        print(f"  WARNING: expected 6000x3000, got {a.shape[1]}x{a.shape[0]}. "
              "The projection assumptions in this file are about THAT image.")

    work = diffuse(a)

    # Two-stage downsample: box-average to halfway, then Lanczos. One big
    # Lanczos step from 6000 wide leaves aliasing in the dust lanes.
    half = np.asarray(Image.fromarray(work).resize((3000, 1500), Image.BOX),
                      dtype=np.float32)
    half = ndimage.gaussian_filter(half, 0.8)

    img = Image.fromarray(np.clip(half, 0, 255).astype(np.uint8))
    img = img.resize((OUT_W, OUT_H), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "WEBP", quality=QUALITY, method=6)

    kb = OUT.stat().st_size / 1024
    print(f"\n  wrote {OUT.relative_to(ROOT)}  {OUT_W}x{OUT_H}  "
          f"{360 / OUT_W:.3f} deg/px  {kb:.1f} KB")
    print(f"  credit that MUST be shown wherever this is drawn: {CREDIT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
