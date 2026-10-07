#!/usr/bin/env python3
# evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""Measure how far each constellation's stars sit from the ink of its figure.

    python scripts/fit-constellation-art.py            # measure every figure
    python scripts/fit-constellation-art.py --fit      # and try to refit each one
    python scripts/fit-constellation-art.py --write    # keep a refit, if any helps

WHAT THIS IS FOR

    A constellation figure is drawn around its own stars, so the one thing
    that can be measured about its placement without a reference is how far
    those stars sit from the nearest inked line. For every star of the
    constellation down to magnitude 4.5, that distance in degrees; the
    figure's score is the mean of them. Zero would be every star on a line.

    It is the regression check for the build script: cropping a tile,
    changing its resolution or its encoding must leave the score alone,
    because none of that moves ink on the sky.

WHAT THE REFIT TRIED, AND WHAT IT FOUND

    OpenSpace hangs each drawing as a flat plane -- one direction, one
    rotation, one size, set by hand -- and at a wide field that reads
    perfectly well; zoomed in, a drawing can sit a degree or two from the
    stars. Stellarium pins its artwork to three named stars, but its
    anchors are image coordinates into Johan Meuris' drawings, not
    Hedberg's, so they cannot be borrowed.

    So a refit was tried: three small rotations of each plane and one
    scale, Nelder-Mead from the shipped placement, accepted only if the
    score improved and the figure stayed within MAX_SHIFT degrees and
    MAX_SCALE of its size. Over the 67 figures with enough stars it moved
    the mean from 1.78 to 1.76 degrees and Orion from 0.65 to 0.64:
    nothing. The shipped placements were already at this objective's
    optimum, and the rest is in the drawings -- Hedberg drew figures, not
    star charts, and a line need not pass through every star.

    The objective is honest about that limit. Ink is nearly everywhere in
    a drawing this size, so "nearest ink" cannot tell a right placement
    from one shifted a degree; it can tell a placement that has come apart
    from its stars, which is what a regression check needs.

    What the refit could not see, a different measurement did: the planes
    are TILTED to the line of sight, and the app had been flattening that
    tilt away by treating the corners as unit vectors. That story is in
    the build script, under "THE CORNERS ARE NOT UNIT VECTORS".

THE MEASUREMENT DOES NOT DEPEND ON THE TILE

    A star outside the tile is measured to the nearest ink like any other,
    not charged for being outside, so cropping a tile around its ink cannot
    change a score. The ink is sampled to a grid of points and every star
    is measured to the nearest one, brute force: a few thousand points and
    a few dozen stars.
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.optimize import minimize

ROOT = Path(__file__).resolve().parent.parent
FIG_JS = ROOT / "site" / "src" / "data" / "figures.js"
ATLAS = ROOT / "site" / "src" / "data" / "figures.webp"
STARS = ROOT / "site" / "src" / "data" / "stars.json"

DEG = math.pi / 180
MAG_LIMIT = 4.5
GRID = 192           # the ink is sampled to this many points across a tile
MAX_SHIFT = 6.0      # degrees a refit may move a figure's centre
MAX_SCALE = 0.25     # fractional change of size a refit may make


def unit(v):
    return v / (np.linalg.norm(v) or 1.0)


def load_figures():
    src = FIG_JS.read_text(encoding="utf-8")
    figs = json.loads(re.search(r"export const FIGURES = (\[.*?\]);", src, re.S).group(1))
    tile = int(re.search(r"FIGURE_TILE = (\d+)", src).group(1))
    cols = int(re.search(r"FIGURE_COLS = (\d+)", src).group(1))
    return figs, tile, cols


def load_stars():
    by = {}
    for row in json.loads(STARS.read_text()):
        if len(row) < 6 or not row[5]:
            continue
        name = row[5].strip()
        con = name.split()[-1] if " " in name else name[-3:]
        if len(con) != 3:
            continue
        ra, dec, mag = float(row[0]), float(row[1]), float(row[2])
        if mag > MAG_LIMIT:
            continue
        by.setdefault(con, []).append(np.array([
            math.cos(dec * DEG) * math.cos(ra * DEG),
            math.cos(dec * DEG) * math.sin(ra * DEG),
            math.sin(dec * DEG)]))
    return by


def plane_of(corners):
    """The plane the corners are points of: its centre and half-axes.

    The corners ship at their true distances, as a parallelogram, so this
    is read straight off them -- no projection, no fit.
    """
    tl, tr, br, bl = [np.array(c, dtype=float) for c in corners]
    centre = (tl + tr + br + bl) / 4.0
    ex = (tr - tl) / 2.0                                # half-width, +u
    ey = (tl - bl) / 2.0                                # half-height, -v
    return centre, ex, ey


def corners_of(centre, ex, ey):
    return [centre - ex + ey, centre + ex + ey, centre + ex - ey, centre - ex - ey]


def span_of(centre, ex):
    """The tile's width on the sky, in degrees, edge midpoint to edge midpoint."""
    a, b = unit(centre - ex), unit(centre + ex)
    return math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(a, b))))))


def rot(axis, ang):
    a = unit(np.asarray(axis, dtype=float))
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * (K @ K)


def uv_of(stars, centre, ex, ey):
    """Where each star's ray meets the plane, as (u, v) with the tile at [0, 1]."""
    n = np.cross(ex, ey)
    d0 = float(np.dot(centre, n))
    sx2, sy2 = float(np.dot(ex, ex)), float(np.dot(ey, ey))
    out = []
    for d in stars:
        den = float(np.dot(d, n))
        if abs(den) < 1e-12:
            out.append(None)
            continue
        t = d0 / den                    # the ray meets the plane at t * d
        if t <= 0:                      # behind the eye: no place on the plane
            out.append(None)
            continue
        q = d * t - centre
        out.append(((float(np.dot(q, ex)) / sx2 + 1) / 2,
                    (1 - float(np.dot(q, ey)) / sy2) / 2))
    return out


def ink_points(tile):
    """The ink of a tile as (u, v) points, sampled on a GRID x GRID lattice."""
    t = tile.convert("RGBA").resize((GRID, GRID), Image.BOX)
    lum = np.asarray(t.convert("L"), dtype=float)
    alpha = np.asarray(t.split()[3], dtype=float)
    ys, xs = np.nonzero((lum * alpha / 255) > 8)
    return np.column_stack(((xs + 0.5) / GRID, (ys + 0.5) / GRID))


def score(stars, centre, ex, ey, pts, span_deg):
    """Mean distance, in degrees, from each star to the nearest ink."""
    total, used = 0.0, 0
    for uv in uv_of(stars, centre, ex, ey):
        if uv is None:
            total += span_deg
        else:
            total += float(np.min(np.hypot(pts[:, 0] - uv[0], pts[:, 1] - uv[1]))) * span_deg
        used += 1
    return total / max(1, used)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fit", action="store_true", help="try to refit each figure to its stars")
    ap.add_argument("--write", action="store_true", help="keep any refit that helps (implies --fit)")
    args = ap.parse_args()
    do_fit = args.fit or args.write

    figs, TILE, COLS = load_figures()
    by = load_stars()
    atlas = Image.open(ATLAS)

    rows, improved = [], 0
    for f in figs:
        stars = by.get(f["a"], [])
        if len(stars) < 3:
            rows.append((f["a"], f["n"], None, None, len(stars)))
            continue
        centre, ex, ey = plane_of(f["c"])
        span = span_of(centre, ex)
        col, row = f["i"] % COLS, f["i"] // COLS
        pts = ink_points(atlas.crop((col * TILE, row * TILE, (col + 1) * TILE, (row + 1) * TILE)))
        if not len(pts):
            rows.append((f["a"], f["n"], None, None, len(stars)))
            continue
        base = score(stars, centre, ex, ey, pts, span)
        best = base

        if do_fit:
            c_unit, rx, ry = unit(centre), unit(ex), unit(ey)

            def apply(p):
                R = rot(rx, p[0]) @ rot(ry, p[1]) @ rot(c_unit, p[2])
                k = 1.0 + p[3]
                return R @ centre, k * (R @ ex), k * (R @ ey)

            res = minimize(lambda p: score(stars, *apply(p), pts, span), np.zeros(4),
                           method="Nelder-Mead",
                           options={"xatol": 1e-4, "fatol": 1e-4, "maxiter": 600})
            nc, nex, ney = apply(res.x)
            moved = math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(unit(nc), c_unit))))))
            if res.fun < base and moved <= MAX_SHIFT and abs(res.x[3]) <= MAX_SCALE:
                best = res.fun
                improved += 1
                if args.write:
                    f["c"] = [[round(float(x), 6) for x in v] for v in corners_of(nc, nex, ney)]
        rows.append((f["a"], f["n"], base, best, len(stars)))

    scored = [r for r in rows if r[2] is not None]
    print(f"{'figure':22} {'stars':>5} {'star-to-ink':>12}" + (f" {'refit':>8}" if do_fit else ""))
    for a, n, base, best, ns in sorted(scored, key=lambda r: -r[2]):
        line = f"{a:4} {n:17} {ns:5} {base:8.2f} deg"
        if do_fit:
            line += f" {best:8.2f}"
        print(line)
    measured = {r[0] for r in scored}
    for a, n, _, _, ns in rows:
        if a not in measured:
            print(f"{a:4} {n:17} {ns:5}   (not measured: too few stars, or no ink)")
    vals = sorted(r[2] for r in scored)
    print(f"\n{len(scored)} figures measured: mean {sum(vals) / len(vals):.2f} deg, "
          f"median {vals[len(vals) // 2]:.2f} deg, worst {vals[-1]:.2f} deg, "
          f"{sum(1 for v in vals if v < 1)} within a degree")
    if do_fit:
        after = [r[3] for r in scored]
        print(f"refit: {improved} of {len(scored)} improved; mean {sum(after) / len(after):.2f} deg after")

    if args.write:
        src = FIG_JS.read_text(encoding="utf-8")
        src = re.sub(r"export const FIGURES = \[.*?\];",
                     "export const FIGURES = " + json.dumps(figs, separators=(",", ":")) + ";",
                     src, flags=re.S)
        FIG_JS.write_text(src, encoding="utf-8")
        print(f"wrote {FIG_JS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
