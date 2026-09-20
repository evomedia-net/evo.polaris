#!/usr/bin/env python3
r"""Generate the constellation stick figures the sky view draws.

    python scripts/build-constellations.py

Writes src/data/constellations.js.

WHY THE FIGURES ARE WRITTEN IN BAYER LETTERS AND NOT HR NUMBERS. A line drawn
to the wrong star still looks like a constellation -- it is just a wrong one,
and nothing in the app can tell. Writing "Alp UMa" and resolving it against the
catalogue at build time means a mistake is a build failure with a name in it,
rather than a slightly wrong picture nobody notices. Every star below is
checked; an unresolved one stops the build.

The set is the constellations people actually point at: the ones used for
star-hopping, the zodiac's recognisable members, and the southern figures that
matter for polar alignment. Not all 88 -- a sky full of lines is unreadable
exactly when you are trying to find one thing.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STARS = ROOT / "site" / "src" / "data" / "stars.json"
OUT = ROOT / "site" / "src" / "data" / "constellations.js"

# "9Alp CMa", "Alp Car", "Alp1Cen", "34Mu  UMa" -> (greek, super, constellation)
# The superscript may be separated by a space -- the catalogue writes Mu1 Sco
# as "Mu 1Sco" -- so the gap has to be allowed or every superscripted star in a
# figure fails to resolve.
NAME = re.compile(
    r"^\s*\d*\s*([A-Z][a-z]{1,2})\s*(\d?)\s*([A-Z][A-Za-z]{2})\s*$")

# Each entry: display name, and the segments as Bayer letters.
FIGURES = {
    "UMa": ("The Big Dipper", [
        ("Eta", "Zet"), ("Zet", "Eps"), ("Eps", "Del"),
        ("Del", "Gam"), ("Gam", "Bet"), ("Bet", "Alp"), ("Alp", "Del")]),
    "UMi": ("The Little Dipper", [
        ("Alp", "Del"), ("Del", "Eps"), ("Eps", "Zet"),
        ("Zet", "Bet"), ("Bet", "Gam"), ("Gam", "Eta"), ("Eta", "Zet")]),
    "Cas": ("Cassiopeia", [
        ("Eps", "Del"), ("Del", "Gam"), ("Gam", "Alp"), ("Alp", "Bet")]),
    "Cep": ("Cepheus", [
        ("Alp", "Bet"), ("Bet", "Gam"), ("Gam", "Iot"),
        ("Iot", "Alp"), ("Iot", "Del"), ("Del", "Zet"), ("Zet", "Alp")]),
    "Dra": ("Draco", [
        ("Lam", "Kap"), ("Kap", "Alp"), ("Alp", "Iot"), ("Iot", "The"),
        ("The", "Eta"), ("Eta", "Zet"), ("Zet", "Chi"), ("Chi", "Xi"),
        ("Xi", "Gam"), ("Gam", "Bet"), ("Bet", "Nu"), ("Nu", "Xi")]),
    "Cyg": ("Cygnus, the Northern Cross", [
        ("Alp", "Gam"), ("Gam", "Bet"), ("Del", "Gam"), ("Gam", "Eps")]),
    "Lyr": ("Lyra", [
        ("Alp", "Zet"), ("Zet", "Del"), ("Del", "Gam"),
        ("Gam", "Bet"), ("Bet", "Zet")]),
    "Aql": ("Aquila", [
        ("Alp", "Bet"), ("Alp", "Gam"), ("Gam", "Del"),
        ("Del", "Zet"), ("Del", "The")]),
    "Boo": ("Bootes", [
        ("Alp", "Eps"), ("Eps", "Del"), ("Del", "Bet"),
        ("Bet", "Gam"), ("Gam", "Rho"), ("Rho", "Alp")]),
    "CrB": ("Corona Borealis", [
        ("The", "Bet"), ("Bet", "Alp"), ("Alp", "Gam"),
        ("Gam", "Del"), ("Del", "Eps")]),
    "Her": ("Hercules", [
        ("Bet", "Zet"), ("Zet", "Eps"), ("Eps", "Del"), ("Del", "Bet"),
        ("Zet", "Eta"), ("Eta", "Pi"), ("Pi", "Eps")]),
    "Leo": ("Leo", [
        ("Alp", "Eta"), ("Eta", "Gam"), ("Gam", "Zet"), ("Zet", "Mu"),
        ("Mu", "Eps"), ("Gam", "Del"), ("Del", "Bet"), ("Bet", "The"),
        ("The", "Alp")]),
    "Vir": ("Virgo", [
        ("Alp", "The"), ("The", "Gam"), ("Gam", "Eta"),
        ("Gam", "Del"), ("Del", "Eps")]),
    "Sco": ("Scorpius", [
        ("Bet", "Del"), ("Del", "Pi"), ("Del", "Sig"), ("Sig", "Alp"),
        ("Alp", "Tau"), ("Tau", "Eps"), ("Eps", "Mu"), ("Mu", "Zet"),
        ("Zet", "Eta"), ("Eta", "The"), ("The", "Iot"), ("Iot", "Kap"),
        ("Kap", "Lam"), ("Lam", "Ups")]),
    "Sgr": ("Sagittarius, the Teapot", [
        ("Zet", "Eps"), ("Eps", "Del"), ("Del", "Lam"), ("Lam", "Phi"),
        ("Phi", "Zet"), ("Del", "Gam"), ("Lam", "Del"), ("Phi", "Sig"),
        ("Sig", "Tau"), ("Tau", "Zet")]),
    "Ori": ("Orion", [
        ("Alp", "Zet"), ("Zet", "Eps"), ("Eps", "Del"), ("Del", "Gam"),
        ("Gam", "Alp"), ("Del", "Bet"), ("Zet", "Kap"), ("Kap", "Bet")]),
    "Tau": ("Taurus", [
        ("Alp", "The"), ("The", "Gam"), ("Gam", "Del"), ("Del", "Eps"),
        ("Eps", "Bet"), ("Alp", "Zet")]),
    "Gem": ("Gemini", [
        ("Alp", "Tau"), ("Tau", "Eps"), ("Eps", "Nu"),
        ("Bet", "Del"), ("Del", "Zet"), ("Zet", "Gam"), ("Del", "Eps")]),
    "Aur": ("Auriga", [
        ("Alp", "Bet"), ("Bet", "The"), ("The", "Iot"),
        ("Iot", "Eps"), ("Eps", "Alp")]),
    "Per": ("Perseus", [
        ("Alp", "Gam"), ("Gam", "Eta"), ("Alp", "Del"),
        ("Del", "Eps"), ("Eps", "Zet"), ("Alp", "Bet"), ("Bet", "Rho")]),
    "And": ("Andromeda", [
        ("Alp", "Del"), ("Del", "Bet"), ("Bet", "Gam")]),
    "Peg": ("Pegasus, the Great Square", [
        ("Alp", "Bet"), ("Bet", "Gam"), ("Gam", "Alp"),
        ("Alp", "Zet"), ("Zet", "The"), ("Bet", "Eta")]),
    "CMa": ("Canis Major", [
        ("Alp", "Bet"), ("Alp", "Del"), ("Del", "Eta"),
        ("Del", "Eps"), ("Eps", "Bet")]),
    "Cru": ("The Southern Cross", [("Gam", "Alp"), ("Bet", "Del")]),
    "Cen": ("Centaurus, the Pointers", [("Alp", "Bet")]),
    "Car": ("Carina", [
        ("Alp", "Bet"), ("Bet", "Ups"), ("Ups", "Iot"), ("Iot", "Eps")]),
}


def load_index():
    """{(greek, super, con): (hr, mag)} for every named star in the catalogue."""
    index = {}
    for ra, dec, mag, bv, hr, name in json.loads(STARS.read_text()):
        if not name:
            continue
        m = NAME.match(name)
        if not m:
            continue
        key = (m.group(1), m.group(2), m.group(3))
        # Keep the brightest when a letter has superscripted components: the
        # figure means the one you can see.
        if key not in index or mag < index[key][1]:
            index[key] = (hr, mag)
    return index


def resolve(index, greek, con):
    for sup in ("", "1", "2"):
        hit = index.get((greek, sup, con))
        if hit:
            return hit[0]
    return None


def main() -> int:
    index = load_index()
    out, missing = {}, []

    for con, (label, segments) in FIGURES.items():
        lines = []
        for a, b in segments:
            ha, hb = resolve(index, a, con), resolve(index, b, con)
            if ha is None:
                missing.append(f"{a} {con}")
            if hb is None:
                missing.append(f"{b} {con}")
            if ha is not None and hb is not None:
                lines.append([ha, hb])
        out[con] = {"name": label, "lines": lines}

    if missing:
        print("unresolved stars -- fix the figure rather than shipping a wrong "
              "line:", file=sys.stderr)
        for m in sorted(set(missing)):
            print(f"  {m}", file=sys.stderr)
        return 1

    body = json.dumps(out, separators=(",", ":"), ensure_ascii=False)
    OUT.write_text(
        "// GENERATED by scripts/build-constellations.py -- do not edit.\n"
        "// Stick figures for the constellations people actually point at,\n"
        "// resolved from Bayer letters against the shipped Bright Star\n"
        "// Catalogue so a wrong letter is a build failure, not a wrong line.\n"
        f"export const CONSTELLATIONS = {body};\n",
        encoding="utf-8", newline="\n")

    segs = sum(len(v["lines"]) for v in out.values())
    print(f"constellations.js  {len(out)} figures, {segs} segments, "
          f"{OUT.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
