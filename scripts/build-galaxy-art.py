#!/usr/bin/env python3
# evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.
"""Build the galaxy picture atlas and where each picture hangs in the sky.

    python scripts/build-galaxy-art.py

Writes site/src/data/galaxies.webp and site/src/data/galaxy-art.js. Run
rarely -- both are committed, like figures.webp and planets.webp.

WHAT, AND UNDER WHAT TERMS
    Thirteen photographs, one per galaxy, chosen by Kelly from candidates laid
    side by side (2026-10-10): option B, natural colour, all CC BY 4.0, from
    NOIRLab, ESO and ESA/Hubble. That is the same licence the Milky Way and
    the planet textures ship under, so the credit joins theirs on the map's
    key, and every picture's full credit is in README.md.

    M 32 and M 110 get none of their own. Both sit inside the Andromeda
    picture, which shows them where they are; a second picture of each would
    show them twice (#267).

    Every source is pinned by sha256. A picture that has changed upstream is
    a build failure, not a quietly different sky.

WHERE EACH ONE GOES -- FROM THE FILE, NOT FROM THE PAGE
    Each JPG carries its sky mapping as AVM metadata (XMP): the size of the
    original, a reference pixel, the sky position at that pixel, degrees per
    pixel and a rotation. The image pages show only the reference position,
    labelled "Position", and it is NOT the centre: for Andromeda it is near
    the bottom of the frame, 40 arcminutes from the middle. So nothing here
    trusts the page; the mapping is read from the file.

    AVM's mapping is a gnomonic (TAN) projection, and a TAN image is an affine
    map from pixels onto the plane tangent to the sky at the reference point.
    So the four corners of each tile are put ON THAT PLANE, not on the unit
    sphere, and the sky view's constellation layer -- which blends four
    corners and projects the result -- reproduces the picture's own mapping
    exactly at every point, not just at the corners. Rotation, scale and a
    mirrored picture all come out of the same four vectors.

WHAT IS DONE TO THE PIXELS
    * The sky background is subtracted, per channel, at its 30th percentile
      and a little more: the layer draws additively, and a grey sky would
      brighten a square round every galaxy -- turned with the sky, a diamond.
    * Each picture fades out in a circle round ITS GALAXY: whole within 1.15
      of the galaxy's radius, black by 1.6. The galaxy's place in the frame
      comes from running the picture's own mapping backwards, so a galaxy
      that is not in the middle of its picture (the Large Magellanic Cloud
      fills the top half of its) keeps its fade round itself. Nothing of a
      frame is left to see, at any rotation.
    * The frame's edges are feathered too, over 12% of the short side, for
      the pictures whose galaxy runs off them (Andromeda is wider than its
      frame).
    * Each picture is padded square with black, and scaled into one TILE x
      TILE cell of the atlas.

ONE ATLAS, LIKE THE PLANETS AND THE FIGURES
    The app works with the radio off, so it is precached; one file, one
    decode. TILE stays modest because the atlas and its red Night Mode copy
    are each a canvas of this size on a phone.
"""
import hashlib
import io
import json
import math
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_IMG = ROOT / "site" / "src" / "data" / "galaxies.webp"
OUT_JS = ROOT / "site" / "src" / "data" / "galaxy-art.js"
TILE = 512
COLS = 4
QUALITY = 80
FEATHER = 0.12
SKY_PERCENTILE = 30
SKY_EXTRA = 3            # levels taken off beyond the percentile
KEEP, GONE = 1.15, 1.6   # the fade round each galaxy, in galaxy radii

# key, the page, the 1280 px "screen" JPG, its sha256, and the credit as the
# page gives it. All CC BY 4.0.
SOURCES = [
    ("lmc", "https://noirlab.edu/public/images/noirlab2030a/",
     "https://storage.noirlab.edu/media/archives/images/screen/noirlab2030a.jpg",
     None, "CTIO/NOIRLab/NSF/AURA/SMASH/D. Nidever (Montana State University); image processing: Travis Rector (University of Alaska Anchorage), Mahdi Zamani & Davide de Martin"),
    ("smc", "https://noirlab.edu/public/images/noirlab2030b/",
     "https://storage.noirlab.edu/media/archives/images/screen/noirlab2030b.jpg",
     None, "CTIO/NOIRLab/NSF/AURA/SMASH/D. Nidever (Montana State University); image processing: Travis Rector (University of Alaska Anchorage), Mahdi Zamani & Davide de Martin"),
    ("m31", "https://noirlab.edu/public/images/noao0001a/",
     "https://storage.noirlab.edu/media/archives/images/screen/noao0001a.jpg",
     None, "Bill Schoening, Vanessa Harvey/REU program/NOIRLab/NSF/AURA"),
    ("m33", "https://www.eso.org/public/images/eso1424a/",
     "https://cdn.eso.org/images/screen/eso1424a.jpg",
     None, "ESO"),
    ("cena", "https://www.eso.org/public/images/eso1221a/",
     "https://cdn.eso.org/images/screen/eso1221a.jpg",
     None, "ESO"),
    ("m81", "https://noirlab.edu/public/images/noao-m81/",
     "https://storage.noirlab.edu/media/archives/images/screen/noao-m81.jpg",
     None, "N.A.Sharp/NOIRLab/NSF/AURA"),
    ("m83", "https://noirlab.edu/public/images/noirlab2429a/",
     "https://storage.noirlab.edu/media/archives/images/screen/noirlab2429a.jpg",
     None, "CTIO/NOIRLab/DOE/NSF/AURA; image processing: T.A. Rector (University of Alaska Anchorage/NSF NOIRLab), D. de Martin (NSF NOIRLab) & M. Zamani (NSF NOIRLab)"),
    ("m101", "https://noirlab.edu/public/images/noao-m101ubviha/",
     "https://storage.noirlab.edu/media/archives/images/screen/noao-m101ubviha.jpg",
     None, "T.A. Rector (University of Alaska Anchorage) and H. Schweiker (WIYN and NOIRLab/NSF/AURA)"),
    ("ngc55", "https://www.eso.org/public/images/eso0914a/",
     "https://cdn.eso.org/images/screen/eso0914a.jpg",
     None, "ESO"),
    ("m104", "https://esahubble.org/images/heic2506a/",
     "https://cdn.esahubble.org/archives/images/screen/heic2506a.jpg",
     None, "ESA/Hubble & NASA, K. Noll"),
    ("ngc6822", "https://www.eso.org/public/images/eso0938a/",
     "https://cdn.eso.org/images/screen/eso0938a.jpg",
     None, "ESO"),
    ("ngc300", "https://www.eso.org/public/images/eso1037a/",
     "https://cdn.eso.org/images/screen/eso1037a.jpg",
     None, "ESO"),
    ("m94", "https://noirlab.edu/public/images/noao-m94/",
     "https://storage.noirlab.edu/media/archives/images/screen/noao-m94.jpg",
     None, "Hillary Mathis, N.A.Sharp/NOIRLab/NSF/AURA"),
]

PINS = ROOT / "scripts" / "galaxy-art-sources.json"


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "evo.polaris build script (dev@evomedia.net)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def avm(data: bytes) -> dict:
    """The sky mapping from the JPG's XMP. Raises if any part is missing."""
    x = data.decode("latin-1")

    def seq(name):
        m = re.search(r"avm:Spatial\." + name + r">\s*<rdf:Seq>(.*?)</rdf:Seq>", x, re.S)
        if not m:
            raise ValueError(f"no Spatial.{name} in the file's XMP")
        return [float(v) for v in re.findall(r"<rdf:li>\s*([-+0-9.eE]+)\s*</rdf:li>", m.group(1))]

    rot = re.search(r'avm:Spatial\.Rotation="([-+0-9.eE]+)"', x) or \
        re.search(r"<avm:Spatial\.Rotation>\s*([-+0-9.eE]+)\s*<", x)
    frame = re.search(r'avm:Spatial\.CoordinateFrame="(\w+)"', x)
    proj = re.search(r'avm:Spatial\.CoordinateSystemProjection="(\w+)"', x)
    if frame and frame.group(1) not in ("ICRS", "FK5"):
        raise ValueError(f"unexpected frame {frame.group(1)}")
    if proj and proj.group(1) != "TAN":
        raise ValueError(f"unexpected projection {proj.group(1)}")
    return {
        "dim": seq("ReferenceDimension"), "pix": seq("ReferencePixel"),
        "val": seq("ReferenceValue"), "scale": seq("Scale"),
        "rot": float(rot.group(1)) if rot else 0.0,
    }


def plane_point(m: dict, s: float, t: float) -> list:
    """The point on the tangent plane for a position in the ORIGINAL image.

    (s, t) is measured from the top-left corner in original pixels. AVM
    pixels are FITS pixels: 1-based, counted up from the bottom.
    """
    w0, h0 = m["dim"]
    x = s + 0.5
    y = h0 - t + 0.5
    dx = (x - m["pix"][0]) * m["scale"][0]
    dy = (y - m["pix"][1]) * m["scale"][1]
    r = math.radians(m["rot"])
    xi = math.radians(dx * math.cos(r) - dy * math.sin(r))
    eta = math.radians(dx * math.sin(r) + dy * math.cos(r))
    ra0, dec0 = (math.radians(v) for v in m["val"])
    u = [math.cos(dec0) * math.cos(ra0), math.cos(dec0) * math.sin(ra0), math.sin(dec0)]
    east = [-math.sin(ra0), math.cos(ra0), 0.0]
    north = [-math.sin(dec0) * math.cos(ra0), -math.sin(dec0) * math.sin(ra0), math.cos(dec0)]
    return [u[i] + xi * east[i] + eta * north[i] for i in range(3)]


def radec(p: list) -> tuple:
    n = math.sqrt(sum(v * v for v in p))
    return (math.degrees(math.atan2(p[1], p[0])) % 360, math.degrees(math.asin(p[2] / n)))


def galaxies() -> dict:
    """key -> (ra, dec, major axis in arcmin), from the app's own galaxy list."""
    src = (ROOT / "site" / "src" / "data" / "galaxies.js").read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r"key: '(\w+)'.*?ra: ([-0-9.]+), dec: ([-0-9.]+),.*?maj: ([-0-9.]+)", src, re.S):
        out[m.group(1)] = (float(m.group(2)), float(m.group(3)), float(m.group(4)))
    return out


def pixel_of(m: dict, ra: float, dec: float) -> tuple:
    """Where a sky position falls in the ORIGINAL image: the mapping backwards."""
    a, d = math.radians(ra), math.radians(dec)
    a0, d0 = (math.radians(v) for v in m["val"])
    cosc = math.sin(d0) * math.sin(d) + math.cos(d0) * math.cos(d) * math.cos(a - a0)
    xi = math.degrees(math.cos(d) * math.sin(a - a0) / cosc)
    eta = math.degrees((math.cos(d0) * math.sin(d) - math.sin(d0) * math.cos(d) * math.cos(a - a0)) / cosc)
    r = math.radians(m["rot"])
    dx = xi * math.cos(r) + eta * math.sin(r)
    dy = -xi * math.sin(r) + eta * math.cos(r)
    x = m["pix"][0] + dx / m["scale"][0]
    y = m["pix"][1] + dy / m["scale"][1]
    return (x - 0.5, m["dim"][1] - y + 0.5)


def prepare(data: bytes, m: dict, gal: tuple) -> Image.Image:
    im = Image.open(io.BytesIO(data)).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    sky = np.percentile(a.reshape(-1, 3), SKY_PERCENTILE, axis=0) + SKY_EXTRA
    a = np.clip((a - sky) * (255.0 / np.maximum(1.0, 255.0 - sky)), 0, 255)
    h, w = a.shape[:2]
    k = m["dim"][0] / w                     # original pixels per pixel here
    # The frame's edges.
    f = max(2, int(min(w, h) * FEATHER))
    ramp = lambda n: np.minimum(1.0, np.minimum(np.arange(n) + 0.5, n - np.arange(n) - 0.5) / f)
    fade = (0.5 - 0.5 * np.cos(np.pi * ramp(h)))[:, None] * (0.5 - 0.5 * np.cos(np.pi * ramp(w)))[None, :]
    # A circle round the galaxy itself.
    gx, gy = (v / k for v in pixel_of(m, gal[0], gal[1]))
    radius = (gal[2] / 2 / 60) / abs(m["scale"][0]) / k
    yy, xx = np.mgrid[0:h, 0:w]
    rr = np.hypot(xx + 0.5 - gx, yy + 0.5 - gy) / radius
    t = np.clip((rr - KEEP) / (GONE - KEEP), 0, 1)
    fade = fade * (0.5 + 0.5 * np.cos(np.pi * t))
    a = a * fade[:, :, None]
    return Image.fromarray(a.astype(np.uint8), "RGB")


def main() -> int:
    pins = json.loads(PINS.read_text(encoding="utf-8")) if PINS.exists() else {}
    gals = galaxies()
    rows = (len(SOURCES) + COLS - 1) // COLS
    atlas = Image.new("RGB", (COLS * TILE, rows * TILE), (0, 0, 0))
    art, credits, new_pins = [], [], {}
    for i, (key, page, url, _, credit) in enumerate(SOURCES):
        data = fetch(url)
        digest = hashlib.sha256(data).hexdigest()
        if key in pins and pins[key] != digest:
            print(f"{key}: {url} has CHANGED upstream (sha256 {digest}, pinned {pins[key]}). "
                  "Look at it, then delete its pin to accept it.", file=sys.stderr)
            return 1
        new_pins[key] = digest
        m = avm(data)
        im = prepare(data, m, gals[key])
        ws, hs = im.size
        w0, h0 = m["dim"]
        if abs(ws / hs - w0 / h0) > 0.01:
            print(f"{key}: the JPG is not the original's shape ({ws}x{hs} vs {w0}x{h0})", file=sys.stderr)
            return 1
        # Square, padded with black, then into the tile.
        side = max(ws, hs)
        sq = Image.new("RGB", (side, side), (0, 0, 0))
        sq.paste(im, ((side - ws) // 2, (side - hs) // 2))
        tile = sq.resize((TILE, TILE), Image.LANCZOS)
        atlas.paste(tile, ((i % COLS) * TILE, (i // COLS) * TILE))
        # The tile's corners, in original pixels, on the picture's own plane.
        k = w0 / ws
        L = side * k
        ox, oy = (side - ws) / 2 * k, (side - hs) / 2 * k
        corners = [plane_point(m, u - ox, v - oy) for (u, v) in ((0, 0), (L, 0), (L, L), (0, L))]
        centre = radec(plane_point(m, w0 / 2, h0 / 2))
        art.append({"k": key, "i": i, "c": [[round(c, 6) for c in v] for v in corners]})
        credits.append({"k": key, "credit": credit, "page": page, "license": "CC BY 4.0"})
        print(f"{key:8} centre {centre[0]:9.4f} {centre[1]:+9.4f}  {ws}x{hs}  rot {m['rot']:+.2f}")
    OUT_IMG.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT_IMG, "WEBP", quality=QUALITY, method=6)
    PINS.write_bytes((json.dumps(new_pins, indent=2) + "\n").encode("utf-8"))
    OUT_JS.write_bytes((
        "// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris\n"
        "// Created by Kelly Michels · dev@evomedia.net\n"
        "// The code is MIT-licensed (see LICENSE). The data's source and terms are named below and in README.md.\n\n"
        "// GENERATED by scripts/build-galaxy-art.py -- do not edit.\n"
        "//\n"
        "// Where each galaxy picture hangs in the sky: four corner vectors in\n"
        "// equatorial J2000, in the tile's own order (top-left, top-right,\n"
        "// bottom-right, bottom-left), on the plane tangent to the sky at the\n"
        "// picture's reference point -- NOT unit vectors, so that the\n"
        "// constellation layer's blend of them reproduces each picture's own\n"
        "// gnomonic mapping exactly. Plus the tile index into galaxies.webp.\n"
        "//\n"
        "// Every picture is CC BY 4.0; GALAXY_CREDITS carries each one's credit\n"
        "// and source page, which README.md lists in full.\n\n"
        f"export const GALAXY_TILE = {TILE};\n"
        f"export const GALAXY_COLS = {COLS};\n"
        f"export const GALAXY_ART = {json.dumps(art, separators=(',', ':'))};\n"
        f"export const GALAXY_CREDITS = {json.dumps(credits, indent=2, ensure_ascii=False)};\n"
    ).encode("utf-8"))
    print(f"wrote {OUT_IMG.relative_to(ROOT)} ({OUT_IMG.stat().st_size // 1024} KB) and {OUT_JS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
