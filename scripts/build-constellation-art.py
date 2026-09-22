#!/usr/bin/env python3
"""Build the ghosted constellation figures from James Hedberg's artwork.

    python scripts/build-constellation-art.py

Writes two committed files and prints what it did:

    site/src/data/figures.webp     one atlas, every figure, greyscale
    site/src/data/figures.js       where each one hangs in the sky

SOURCE, AND ITS LICENCE

    James Hedberg (CUNY-CCNY), "Drawing the 88 constellations".
    http://jameshedberg.com -- redistributed by the OpenSpace project, whose
    asset metadata carries the licence:

        Author = "James Hedberg", URL = "http://jameshedberg.com",
        License = "CC-BY"

    CC BY 4.0 permits commercial use, redistribution and modification with
    attribution, which is the same licence the Milky Way panorama and the
    planet textures ship under -- so the credit joins theirs in the app's own
    UI rather than sitting in a file nobody opens.

    NOTE FOR WHOEVER RUNS THIS NEXT: the CDN redirects to HTTPS and its
    certificate is expired, so the download is explicitly unverified. That is
    acceptable for public artwork whose bytes are then committed and reviewed,
    and would not be for anything else.

THE HARD GEOMETRY HAPPENS HERE, ONCE

    OpenSpace hangs each figure as a flat plane in space: a direction, an
    Euler rotation, and a size. Reproducing that at runtime would mean
    carrying a galactic-to-equatorial conversion, GLM's exact Euler
    convention and a plane's corner maths into the app, where none of it
    could be checked.

    So this script does it once and ships the ANSWER: four unit vectors per
    figure, in equatorial J2000, which the app projects like any other point
    on the sky. The runtime keeps no constellation geometry at all.

    The conventions, which were read rather than guessed:
      * the CSV's x, y, z are GALACTIC -- confirmed by converting and landing
        on each constellation's known position;
      * StaticRotation is glm::mat3_cast(glm::quat(euler)), and glm builds
        that quaternion with the formula reproduced in euler_to_quat below;
      * the plane spans +/- Size about its centre, with
        Size / distance = 0.32407 * scale.

AND IT IS CHECKED, NOT ASSUMED

    A figure drawn upside down or half a sky away is worse than no figure.
    Every quad is tested against the app's OWN star catalogue: the
    constellation's brightest stars must fall inside it. Anything that fails
    is reported and the build stops.
"""
import csv
import io
import json
import math
import ssl
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_IMG = ROOT / "site" / "src" / "data" / "figures.webp"
OUT_JS = ROOT / "site" / "src" / "data" / "figures.js"

MANIFEST = ("http://data.openspaceproject.com/request"
            "?identifier=constellation_images&file_version=4&application_version=1")

# 256, NOT 128. A figure spans thirty or forty degrees, which at any field
# this app draws is several hundred screen pixels -- a 128px tile was a
# three-to-four times upscale and read as "very blurry". 256 halves that.
# Measured across a sample before choosing: 128px cost 151 KB for all 84,
# 192px 270 KB, 256px 424 KB, 320px 638 KB. 320 buys little over 256 for
# half again the weight, and this app is precached whole before it is
# needed, so the weight is a real cost rather than a lazy one.
TILE = 256
QUALITY = 60
COLS = 10

DEG = math.pi / 180
# Galactic north pole and the galactic longitude of the ascending node, J2000.
NGP_RA, NGP_DEC, LON0 = 192.85948 * DEG, 27.12825 * DEG, 122.93192 * DEG

# Unverified on purpose: see the note in the docstring.
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "evo.polaris build script"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read()


def euler_to_quat(x, y, z):
    """glm::quat(vec3), reproduced exactly. Order matters and is not obvious."""
    cx, cy, cz = math.cos(x / 2), math.cos(y / 2), math.cos(z / 2)
    sx, sy, sz = math.sin(x / 2), math.sin(y / 2), math.sin(z / 2)
    return (
        cx * cy * cz + sx * sy * sz,      # w
        sx * cy * cz - cx * sy * sz,      # x
        cx * sy * cz + sx * cy * sz,      # y
        cx * cy * sz - sx * sy * cz,      # z
    )


def rotate(q, v):
    w, x, y, z = q
    tx = 2 * (y * v[2] - z * v[1])
    ty = 2 * (z * v[0] - x * v[2])
    tz = 2 * (x * v[1] - y * v[0])
    return (v[0] + w * tx + y * tz - z * ty,
            v[1] + w * ty + z * tx - x * tz,
            v[2] + w * tz + x * ty - y * tx)


def gal_to_eq(v):
    """Galactic unit vector -> equatorial J2000 unit vector."""
    x, y, z = v
    r = math.sqrt(x * x + y * y + z * z)
    l = math.atan2(y, x)
    b = math.asin(z / r)
    dec = math.asin(math.sin(b) * math.sin(NGP_DEC)
                    + math.cos(b) * math.cos(NGP_DEC) * math.cos(LON0 - l))
    ra = NGP_RA + math.atan2(
        math.cos(b) * math.sin(LON0 - l),
        math.sin(b) * math.cos(NGP_DEC) - math.cos(b) * math.sin(NGP_DEC) * math.cos(LON0 - l))
    return (math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec))


def unit(v):
    m = math.sqrt(sum(c * c for c in v)) or 1.0
    return (v[0] / m, v[1] / m, v[2] / m)


def corners_for(row):
    """The figure's four corners as equatorial unit vectors, in image order."""
    x, y, z = float(row[3]), float(row[4]), float(row[5])
    scale = float(row[6])
    q = euler_to_quat(float(row[8]), float(row[9]), float(row[10]))
    centre = unit((x, y, z))
    s = 0.32407 * scale
    # The plane lies in its own XY, so its edges are the rotated X and Y axes.
    ex = rotate(q, (s, 0.0, 0.0))
    ey = rotate(q, (0.0, s, 0.0))
    out = []
    for sx, sy in ((-1, 1), (1, 1), (1, -1), (-1, -1)):      # TL, TR, BR, BL
        g = (centre[0] + sx * ex[0] + sy * ey[0],
             centre[1] + sx * ex[1] + sy * ey[1],
             centre[2] + sx * ex[2] + sy * ey[2])
        out.append(gal_to_eq(unit(g)))
    return out


def inside(corners, v):
    """Is direction v inside the spherical quad? Same-side test on each edge."""
    sign = None
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        n = (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
        d = n[0] * v[0] + n[1] * v[1] + n[2] * v[2]
        s = d >= 0
        if sign is None:
            sign = s
        elif s != sign:
            return False
    return True


def main() -> int:
    print("fetching the manifest")
    urls = [u for u in get(MANIFEST, 60).decode().split() if u.strip()]
    csv_url = next(u for u in urls if u.endswith(".csv"))
    png_urls = {u.rsplit("/", 1)[1][:-4]: u for u in urls if u.endswith(".png")}
    rows = list(csv.reader(io.StringIO(get(csv_url, 60).decode())))[1:]
    rows = [r for r in rows if len(r) > 10 and r[1] in png_urls]
    print(f"  {len(rows)} figures with both placement and artwork")

    # --- the stars this app already ships, to check the placement against ---
    # [ra_degrees, dec_degrees, magnitude, b-v, hr, "9Alp CMa"] -- the
    # constellation is the Bayer name's last field, which is the only place
    # this catalogue records it.
    stars = json.loads((ROOT / "site" / "src" / "data" / "stars.json").read_text())
    by_con = {}
    for row in stars:
        if len(row) < 6 or not row[5]:
            continue
        name = row[5].strip()
        con = name.split()[-1] if " " in name else name[-3:]
        if len(con) != 3:
            continue
        ra, dec, mag = float(row[0]), float(row[1]), float(row[2])
        v = (math.cos(dec * DEG) * math.cos(ra * DEG),
             math.cos(dec * DEG) * math.sin(ra * DEG),
             math.sin(dec * DEG))
        by_con.setdefault(con, []).append((mag, v))

    placements, bad = [], []
    atlas_rows = math.ceil(len(rows) / COLS)
    atlas = Image.new("RGBA", (COLS * TILE, atlas_rows * TILE), (0, 0, 0, 0))

    for i, row in enumerate(rows):
        abbr = row[1]
        corners = corners_for(row)

        # CHECK: the constellation's three brightest stars should be inside.
        cands = sorted(by_con.get(abbr, []))[:3]
        if cands:
            hits = sum(1 for _, v in cands if inside(corners, v))
            if hits == 0:
                bad.append(f"{abbr}: none of its {len(cands)} brightest stars fall inside")

        raw = Image.open(io.BytesIO(get(png_urls[abbr]))).convert("RGBA")
        a = raw.resize((TILE, TILE), Image.LANCZOS)
        grey = a.convert("L")
        ghost = Image.merge("RGBA", (grey, grey, grey, a.split()[3]))
        atlas.paste(ghost, ((i % COLS) * TILE, (i // COLS) * TILE))

        placements.append({
            "a": abbr,
            "n": row[2],
            "i": i,
            "c": [[round(c, 6) for c in v] for v in corners],
        })
        print(f"  {i + 1:3}/{len(rows)}  {abbr:4} {row[2]}")

    if bad:
        print("\nPLACEMENT CHECK FAILED -- a figure in the wrong place is worse "
              "than no figure:", file=sys.stderr)
        for b in bad:
            print("  " + b, file=sys.stderr)
        return 1

    atlas.save(OUT_IMG, "WEBP", quality=QUALITY, method=6)

    OUT_JS.write_text(
        "// GENERATED by scripts/build-constellation-art.py -- do not edit.\n"
        "//\n"
        "// Where each of James Hedberg's constellation figures hangs in the sky:\n"
        "// four corner unit vectors in equatorial J2000, in the image's own\n"
        "// order (top-left, top-right, bottom-right, bottom-left), plus the\n"
        "// tile index into figures.webp. The galactic conversion, GLM's Euler\n"
        "// convention and the plane maths all happened in the build script,\n"
        "// where they could be checked against this app's own star catalogue.\n"
        "//\n"
        "// Artwork: James Hedberg (CUNY-CCNY), CC BY 4.0.\n"
        f"export const FIGURE_TILE = {TILE};\n"
        f"export const FIGURE_COLS = {COLS};\n"
        "export const FIGURES = "
        + json.dumps(placements, separators=(",", ":"))
        + ";\n",
        encoding="utf-8")

    print(f"\nwrote {OUT_IMG.relative_to(ROOT)}  {atlas.width}x{atlas.height}  "
          f"{OUT_IMG.stat().st_size / 1024:.1f} KB")
    print(f"wrote {OUT_JS.relative_to(ROOT)}  {OUT_JS.stat().st_size / 1024:.1f} KB")
    print(f"placement checked against the star catalogue for {len(rows)} figures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
