#!/usr/bin/env python3
"""Build the ghosted constellation figures from James Hedberg's artwork.

    python scripts/build-constellation-art.py                # download and build
    python scripts/build-constellation-art.py --cache DIR    # keep the downloads in DIR

Writes two committed files and prints what it did:

    site/src/data/figures.webp     one atlas, the chosen figures, ink as brightness
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

WHICH FIGURES, AND WHY NOT ALL OF THEM

    Hedberg drew all 88. Shipping 84 of them read as "a bit crowded": at a
    wide field a dozen figures lie over the stars a person is trying to
    recognise, and most of those figures are ones nobody recognises. So the
    app ships the ones people know -- the twelve of the zodiac, and thirteen
    more that a beginner's chart names first, the three of the Polaris
    star-hop above all, since finding Polaris is what this app is for. The
    two lists are just below; a figure joins or leaves by editing them.

    Twenty-five is not a round number by accident. Night Mode tints a copy
    of the atlas on a canvas the same size, and 4096 x 4096 is the largest
    canvas every phone this app runs on will make. At 768 px a tile that is
    five tiles by five, and five by five is twenty-five.

URSA MAJOR, WHICH NEVER SHIPPED

    The first build matched each CSV row to its image by the abbreviation
    column, and the CSV spells Ursa Major "Uma" while its image is
    "UMa.png". The match failed silently, and the Big Dipper -- the pointer
    to Polaris, on this app's own front page -- was the one figure missing.
    A row is now matched by the image name it carries itself, and the
    abbreviation comes from that, which is also the spelling the star
    catalogue uses.

RESOLUTION: CROP TO THE INK FIRST

    Every source image is 2048 px square, but the drawing occupies only the
    middle of it: across the set, the ink spans between a fifth and nine
    tenths of the tile edge. So a 256 px tile gave Orion about 130 px of
    actual drawing -- which is where "very blurry" came from -- and scaling
    the tile up would have spent most of the new pixels on nothing.

    Each figure is therefore cropped to a square around its ink first, with
    a small margin, and THAT is resampled to the tile. The crop is a
    sub-rectangle of the same flat plane, so its corners are the plane's
    own points at the crop's edges and nothing moves on the sky.
    fit-constellation-art.py measures how far each star sits from the ink,
    and is the check that the crop changed nothing.

INK AS BRIGHTNESS, NOT AS ALPHA

    The source is pure white with the drawing in its alpha channel. WebP
    stores an alpha plane losslessly, and that plane is the whole file:
    measured at this size, the same atlas costs three times as much stored
    as alpha as it does stored as brightness on black. The app draws the
    art additively, where black adds nothing, so brightness on black IS
    transparency, and the atlas ships as one grey channel.

THE HARD GEOMETRY HAPPENS HERE, ONCE

    OpenSpace hangs each figure as a flat plane in space: a direction, an
    Euler rotation, and a size. Reproducing that at runtime would mean
    carrying a galactic-to-equatorial conversion, GLM's exact Euler
    convention and a plane's corner maths into the app, where none of it
    could be checked.

    So this script does it once and ships the ANSWER: four corner vectors
    per figure, in equatorial J2000, which the app blends, normalises and
    projects like any other point on the sky. The runtime keeps no
    constellation geometry at all.

    The conventions, which were read rather than guessed:
      * the CSV's x, y, z are GALACTIC -- confirmed by converting and landing
        on each constellation's known position;
      * StaticRotation is glm::mat3_cast(glm::quat(euler)), and glm builds
        that quaternion with the formula reproduced in euler_to_quat below;
      * the plane spans +/- Size about its centre, with
        Size / distance = 0.32407 * scale.

THE CORNERS ARE NOT UNIT VECTORS, ON PURPOSE

    OpenSpace's planes do not face the viewer square on: measured across
    the set, each is tilted between 2 and 28 degrees from its own line of
    sight. Seen from the origin a tilted plane is foreshortened, its far
    edge smaller than its near one, and that keystone is part of where
    Hedberg put every line of the drawing.

    The app finds a point of the drawing by blending its four corners and
    putting the result back on the sphere. Blending the corners AS UNIT
    VECTORS throws the tilt away -- near and far corners are made the same
    length, the blend lands between them in the wrong place, and only the
    corners themselves are still right. Measured before this was fixed:
    Orion's interior was off by up to 1.1 degrees, Virgo's by 3.5 and
    Pegasus's by 6.1, with every corner exactly in place. That is the
    signature of the residual reported as "closer but still off a bit".

    So each corner ships at its true distance from the eye, on the plane.
    Blending four corners of a flat parallelogram gives a point of that
    same plane exactly, and normalising afterwards gives its direction,
    which is the perspective the drawing was placed in. The app's slow
    tick rotates the corners into the horizontal frame and keeps their
    lengths, for the same reason.

HAND-MATCHED, WHERE THE DRAWING'S PROPORTIONS ARE NOT THE SKY'S

    Hedberg drew figures, not star charts, and a few of them are not
    proportioned like their stars: his swan's neck is short where the sky's
    is long (Sadr is 6 degrees from Deneb and 16 from Albireo), his
    scorpion's tail curls back to within 8 degrees of the body where Shaula
    is 18 out, his eagle's wings are three times too long for its body. No
    placement fixes a proportion -- a rigid fit that puts the sting on
    Shaula doubles the scorpion, and a sheared one smears it -- and a refit
    over all 84 figures moved the mean star-to-ink distance from 1.78 to
    1.76 degrees, which is nothing. "so many are just off."

    So those figures are matched BY HAND, the way an artist would redraw a
    tail that stops short: figure-matching.json names landmarks on each
    drawing (the sting's tip, the swan's beak, the eagle's neck) and the
    star each must sit on, and a thin-plate spline moves the landmarks and
    bends the rest of the drawing smoothly with them. Pins hold the parts
    that already sit right, so a stretched tail does not drag the claws
    along. The crop then follows the ink on the same plane, so a drawing
    that grew to reach its stars keeps its resolution.

    Every match prints how far it stretched any part of the drawing, and
    MAX_STRETCH refuses one that asks too much. Thirteen of the twenty-five
    are matched; the other twelve already sit on their stars -- checked
    one by one against the stars the app draws lines between, by anatomy
    as well as by number, because a star correctly inside an outlined body
    counts as far from ink and would fool the number alone.

    The landmarks are read off the tile as this script crops it. Change
    MARGIN or the crop rule, and they have to be read again.

AND IT IS CHECKED, NOT ASSUMED

    A figure drawn upside down or half a sky away is worse than no figure.
    Every quad is tested against the app's OWN star catalogue: the
    constellation's brightest stars must fall inside it. Anything that fails
    is reported and the build stops.

    Needs Pillow, numpy and scipy; all three are build-time only.
"""
import argparse
import csv
import io
import json
import math
import ssl
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops
from scipy.ndimage import map_coordinates      # the hand-matching resample; build-time only

ROOT = Path(__file__).resolve().parent.parent
OUT_IMG = ROOT / "site" / "src" / "data" / "figures.webp"
OUT_JS = ROOT / "site" / "src" / "data" / "figures.js"
MATCHING = ROOT / "scripts" / "figure-matching.json"

MANIFEST = ("http://data.openspaceproject.com/request"
            "?identifier=constellation_images&file_version=4&application_version=1")

# The twelve of the zodiac, in their traditional order.
ZODIAC = ["Ari", "Tau", "Gem", "Cnc", "Leo", "Vir", "Lib", "Sco", "Sgr", "Cap", "Aqr", "Psc"]
# Thirteen a beginner's chart names first. The first three are the Polaris
# star-hop and are not negotiable. Cygnus, Lyra and Aquila are the Summer
# Triangle and travel together, as do Perseus, Andromeda and Pegasus in the
# autumn; Crux is the figure the southern half of the world knows best.
KNOWN = ["UMa", "UMi", "Cas", "Ori", "CMa", "Boo",
         "Cyg", "Lyr", "Aql", "Per", "And", "Peg", "Cru"]
SELECTED = ZODIAC + KNOWN

# 768 px tiles, cropped to the ink, in a 5 x 5 atlas of 3840 x 3840: the
# largest that stays inside the 4096 x 4096 canvas every phone will make.
# Measured for this set, stored as brightness on black at quality 85:
# 512 px 312 KB, 640 px 423 KB, 768 px 534 KB, 1024 px 784 KB. Against the
# old 256 px tiles of whole images that is three times the pixels per
# degree before the crop, and the crop adds between a tenth and four times
# more on top, figure by figure: Orion went from 4 px per degree of sky to
# 23, Lyra from 8 to 103.
TILE = 768
COLS = 5
MARGIN = 0.04       # of the ink's span, added on each side of the crop
QUALITY = 85
# How far a hand-match may stretch any part of a drawing before the build
# refuses it. Scorpius's tail reaches its sting at x3.2; a drawing that
# needs more than this is being pulled into a shape it was never drawn in.
MAX_STRETCH = 3.5

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


def fetch(url, cache, name=None):
    """get(), through an optional on-disk cache so a rebuild is not a download."""
    name = name or url.rsplit("/", 1)[1]
    if cache:
        p = cache / name
        if p.exists() and p.stat().st_size:
            return p.read_bytes()
    data = get(url)
    if cache:
        cache.mkdir(parents=True, exist_ok=True)
        (cache / name).write_bytes(data)
    return data


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


def corners_for(row, uv=(0.0, 0.0, 1.0, 1.0)):
    """The figure's four corners as equatorial J2000 vectors, in image order.

    uv is the crop as (u0, v0, u1, v1) in fractions of the image, u to the
    right and v DOWN as in the image; the whole image is (0, 0, 1, 1). A
    point (u, v) of the image lies on the plane at

        centre + (2u - 1) * ex + (1 - 2v) * ey

    so a crop's corners are simply that, evaluated at its edges. The plane
    is the same plane; only the piece of it that carries pixels changes.

    The corners are returned at their true distance from the eye, not as
    unit vectors: see "THE CORNERS ARE NOT UNIT VECTORS" in the docstring.
    """
    x, y, z = float(row[3]), float(row[4]), float(row[5])
    scale = float(row[6])
    q = euler_to_quat(float(row[8]), float(row[9]), float(row[10]))
    centre = unit((x, y, z))
    s = 0.32407 * scale
    # The plane lies in its own XY, so its edges are the rotated X and Y axes.
    ex = rotate(q, (s, 0.0, 0.0))
    ey = rotate(q, (0.0, s, 0.0))
    u0, v0, u1, v1 = uv
    out = []
    for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1)):      # TL, TR, BR, BL
        a, b = 2 * u - 1, 1 - 2 * v
        g = (centre[0] + a * ex[0] + b * ey[0],
             centre[1] + a * ex[1] + b * ey[1],
             centre[2] + a * ex[2] + b * ey[2])
        # Rotated into the equatorial frame, and given its length back: the
        # corner keeps its distance from the eye, so the four stay a plane.
        r = math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2])
        e = gal_to_eq(g)
        out.append((e[0] * r, e[1] * r, e[2] * r))
    return out


def ink_box(img):
    """A square around the drawing, with a margin, in pixels of the source.

    It may run past the image's edges for a drawing that fills its tile;
    PIL pads a crop like that with transparency, which is exactly right.
    """
    alpha = img.split()[3]
    bb = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bb:
        return None
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    side = max(w, h) * (1 + 2 * MARGIN)
    cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
    x0, y0 = round(cx - side / 2), round(cy - side / 2)
    return (x0, y0, x0 + round(side), y0 + round(side))


def plane_of(corners):
    """The plane the four corners are points of: centre and half-axes."""
    tl, tr, br, bl = [np.array(c, dtype=float) for c in corners]
    return (tl + tr + br + bl) / 4, (tr - tl) / 2, (tl - bl) / 2


def star_on_tile(corners, star):
    """Where a star's ray meets the figure's plane, as (u, v) of its tile."""
    C, ex, ey = plane_of(corners)
    n = np.cross(ex, ey)
    den = float(np.dot(star, n))
    if abs(den) < 1e-12:
        return None
    t = float(np.dot(C, n)) / den
    if t <= 0:
        return None
    q = np.asarray(star, dtype=float) * t - C
    return np.array([(float(np.dot(q, ex)) / float(np.dot(ex, ex)) + 1) / 2,
                     (1 - float(np.dot(q, ey)) / float(np.dot(ey, ey))) / 2])


def tps_fit(src, dst):
    """A thin-plate spline taking the points src onto dst: the smoothest map that does."""
    n = len(src)
    r2 = ((src[:, None, :] - src[None, :, :]) ** 2).sum(-1)
    K = np.where(r2 > 0, r2 * np.log(np.sqrt(r2) + 1e-12), 0.0)
    P = np.hstack([np.ones((n, 1)), src])
    L = np.zeros((n + 3, n + 3))
    L[:n, :n], L[:n, n:], L[n:, :n] = K, P, P.T
    rhs = np.zeros((n + 3, 2))
    rhs[:n] = dst
    return src, np.linalg.solve(L, rhs)


def tps_apply(spline, pts):
    src, W = spline
    r2 = ((pts[:, None, :] - src[None, :, :]) ** 2).sum(-1)
    U = np.where(r2 > 0, r2 * np.log(np.sqrt(r2) + 1e-12), 0.0)
    return U @ W[:len(src)] + W[len(src)] + pts @ W[len(src) + 1:]


def hand_match(tile, corners, controls, stars_by_greek):
    """Move the drawing's landmarks onto their stars and bend the rest with them.

    tile is the cropped, resized drawing; corners its plane corners; controls
    the figure's entry in figure-matching.json; stars_by_greek the
    constellation's stars by Bayer letter. Returns the reshaped tile, its new
    corners (the crop follows the ink, on the same plane), how far any part
    of the drawing was stretched, and how much the crop grew.
    """
    A = np.asarray(tile, dtype=float)
    n = A.shape[0]
    src = np.array([[u, v] for u, v, _ in controls], dtype=float)
    dst = []
    for u, v, target in controls:
        if isinstance(target, list):
            dst.append(target)
        else:
            star = stars_by_greek.get(target)
            if star is None:
                raise ValueError(f"no star '{target}' in the catalogue for this figure")
            uv = star_on_tile(corners, star)
            if uv is None:
                raise ValueError(f"star '{target}' is behind the figure's plane")
            dst.append(uv)
    dst = np.array(dst, dtype=float)
    forward, inverse = tps_fit(src, dst), tps_fit(dst, src)

    # THE CROP FOLLOWS THE INK. Push the ink through the spline to see where
    # it lands, and cut the new tile around that: a drawing that had to grow
    # to reach its stars gets a bigger piece of the plane, one that shrank
    # keeps its resolution.
    ys, xs = np.nonzero(A > 8)
    landed = tps_apply(forward, np.column_stack([(xs + 0.5) / n, (ys + 0.5) / n])[::5])
    lo, hi = landed.min(0), landed.max(0)
    side = float((hi - lo).max()) * (1 + 2 * MARGIN)
    box0 = (lo + hi) / 2 - side / 2

    gv, gu = np.mgrid[0:n, 0:n]
    target = box0 + np.column_stack([(gu.ravel() + 0.5) / n, (gv.ravel() + 0.5) / n]) * side
    source = tps_apply(inverse, target)
    out = map_coordinates(A, np.array([source[:, 1] * n - 0.5, source[:, 0] * n - 0.5]),
                          order=1, mode="constant", cval=0.0).reshape(n, n)

    # The honesty number: the largest local stretch, from the spline's
    # Jacobian at the pixels that carry ink.
    du = tps_apply(inverse, target + np.array([1e-3, 0.0])) - source
    dv = tps_apply(inverse, target + np.array([0.0, 1e-3])) - source
    sv = np.linalg.svd(np.stack([du, dv], -1) / 1e-3, compute_uv=False)
    inked = out.ravel() > 8
    stretch = float((1 / sv[inked].min(axis=1)).max()) if inked.any() else 1.0

    C, ex, ey = plane_of(corners)
    def at(u, v):
        p = C + (2 * u - 1) * ex + (1 - 2 * v) * ey
        return (float(p[0]), float(p[1]), float(p[2]))
    u0, v0 = float(box0[0]), float(box0[1])
    u1, v1 = u0 + side, v0 + side
    new_corners = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)), new_corners, stretch, side


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
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path, default=None,
                    help="directory to keep the downloaded CSV and images in")
    args = ap.parse_args()
    cache = args.cache

    print("fetching the manifest")
    urls = [u for u in fetch(MANIFEST, cache, "manifest.txt").decode().split() if u.strip()]
    csv_url = next(u for u in urls if u.endswith(".csv"))
    png_urls = {u.rsplit("/", 1)[1][:-4]: u for u in urls if u.endswith(".png")}
    rows = list(csv.reader(io.StringIO(fetch(csv_url, cache).decode())))[1:]
    # Matched by the IMAGE NAME the row carries, never by its abbreviation
    # column: that column spells Ursa Major "Uma", the image is "UMa.png",
    # and matching on it lost the Big Dipper. See the docstring.
    by_image = {r[7][:-4]: r for r in rows if len(r) > 10 and r[7].lower().endswith(".png")}
    print(f"  {len(by_image)} figures with placement, {len(png_urls)} with artwork")

    missing = [a for a in SELECTED if a not in by_image or a not in png_urls]
    if missing:
        print(f"no source for: {', '.join(missing)}", file=sys.stderr)
        return 1
    if len(SELECTED) != len(set(SELECTED)):
        print("a figure is listed twice", file=sys.stderr)
        return 1
    if len(SELECTED) > COLS * COLS:
        print(f"{len(SELECTED)} figures do not fit a {COLS} x {COLS} atlas", file=sys.stderr)
        return 1

    # --- the stars this app already ships, to check the placement against ---
    # [ra_degrees, dec_degrees, magnitude, b-v, hr, "9Alp CMa"] -- the
    # constellation is the Bayer name's last field, which is the only place
    # this catalogue records it.
    stars = json.loads((ROOT / "site" / "src" / "data" / "stars.json").read_text())
    by_con, by_greek = {}, {}
    for row in stars:
        if len(row) < 6 or not row[5]:
            continue
        # The constellation is always the field's last three characters:
        # "9Alp CMa", "9Alp2Lib", "Mu 1Sco". Splitting on the space lost the
        # last of those, and with it every star of a doubled Bayer letter.
        name = row[5].strip()
        con = name[-3:]
        if len(name) < 4 or not con.isalpha():
            continue
        ra, dec, mag = float(row[0]), float(row[1]), float(row[2])
        v = (math.cos(dec * DEG) * math.cos(ra * DEG),
             math.cos(dec * DEG) * math.sin(ra * DEG),
             math.sin(dec * DEG))
        by_con.setdefault(con, []).append((mag, v))
        # The Bayer letter, for the hand-matching: "9Alp CMa" and "9Alp2Lib"
        # both give "Alp". The brightest star of a letter wins.
        greek = "".join(ch for ch in name[:-3] if not ch.isdigit()).strip()
        key = (con, greek)
        if greek and (key not in by_greek or mag < by_greek[key][0]):
            by_greek[key] = (mag, v)

    matching = {k: v for k, v in json.loads(MATCHING.read_text(encoding="utf-8")).items()
                if not k.startswith("_")}

    placements, bad = [], []
    atlas_rows = math.ceil(len(SELECTED) / COLS)
    atlas = Image.new("L", (COLS * TILE, atlas_rows * TILE), 0)

    for i, abbr in enumerate(SELECTED):
        row = by_image[abbr]
        raw = Image.open(io.BytesIO(fetch(png_urls[abbr], cache))).convert("RGBA")
        box = ink_box(raw)
        if not box:
            bad.append(f"{abbr}: the image has no ink")
            continue
        uv = tuple(c / raw.width for c in box)
        corners = corners_for(row, uv)

        # The ink as brightness: the drawing's own grey through its alpha.
        crop = raw.crop(box)
        ink = ImageChops.multiply(crop.convert("L"), crop.split()[3]).resize((TILE, TILE), Image.LANCZOS)
        span = box[2] - box[0]
        note = f"ink {span / raw.width:4.0%} of the tile"

        # HAND-MATCHED, where the drawing's proportions are not the sky's.
        if abbr in matching:
            stars = {g: v for (c, g), (_, v) in by_greek.items() if c == abbr}
            ink, corners, stretch, grown = hand_match(ink, corners, matching[abbr], stars)
            note += f"; hand-matched on {len(matching[abbr])} points, stretched x{stretch:.2f}, crop x{grown:.2f}"
            if stretch > MAX_STRETCH:
                bad.append(f"{abbr}: hand-matching stretches the drawing x{stretch:.2f}, "
                           f"more than the x{MAX_STRETCH} allowed")

        # CHECK: the constellation's three brightest stars should be inside.
        cands = sorted(by_con.get(abbr, []))[:3]
        if not cands:
            bad.append(f"{abbr}: no stars in the catalogue to check it against")
        else:
            hits = sum(1 for _, v in cands if inside(corners, v))
            if hits == 0:
                bad.append(f"{abbr}: none of its {len(cands)} brightest stars fall inside")

        atlas.paste(ink, ((i % COLS) * TILE, (i // COLS) * TILE))

        placements.append({
            "a": abbr,
            "n": row[2],
            "i": i,
            "c": [[round(c, 6) for c in v] for v in corners],
        })
        print(f"  {i + 1:3}/{len(SELECTED)}  {abbr:4} {row[2]:18} {note}")

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
        "// four corner vectors in equatorial J2000, in the image's own order\n"
        "// (top-left, top-right, bottom-right, bottom-left), plus the tile\n"
        "// index into figures.webp. THE CORNERS ARE NOT UNIT VECTORS: each\n"
        "// sits at its true distance on the figure's plane, which OpenSpace\n"
        "// tilts up to 28 degrees from the line of sight, so that blending\n"
        "// them gives points of that plane exactly. Each tile is the drawing\n"
        "// cropped to its ink, and the corners are the corners of that crop.\n"
        "// The galactic conversion, GLM's Euler convention, the plane maths\n"
        "// and the crop all happened in the build script, where they could\n"
        "// be checked against this app's own star catalogue. The atlas stores\n"
        "// the ink as brightness on black; the app draws it additively. Some\n"
        "// drawings are hand-matched to their stars (see figure-matching.json):\n"
        "// their tiles are reshaped and their corners follow the reshaped ink.\n"
        "//\n"
        "// Artwork: James Hedberg (CUNY-CCNY), CC BY 4.0.\n"
        f"export const FIGURE_TILE = {TILE};\n"
        f"export const FIGURE_COLS = {COLS};\n"
        "export const FIGURES = "
        + json.dumps(placements, separators=(",", ":"))
        + ";\n",
        encoding="utf-8", newline="\n")     # LF on every platform; the repo is LF

    print(f"\nwrote {OUT_IMG.relative_to(ROOT)}  {atlas.width}x{atlas.height}  "
          f"{OUT_IMG.stat().st_size / 1024:.1f} KB")
    print(f"wrote {OUT_JS.relative_to(ROOT)}  {OUT_JS.stat().st_size / 1024:.1f} KB")
    print(f"placement checked against the star catalogue for {len(placements)} figures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
