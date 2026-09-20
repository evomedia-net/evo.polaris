#!/usr/bin/env bash
# Fetch the public-domain source catalogs that scripts/build-data.py converts.
#
# Only the GENERATED files are committed (src/data/). The Yale catalog is 1.7 MB
# of fixed-width text we never read directly, so it is fetched on demand.
set -euo pipefail
cd "$(dirname "$0")"

echo "Yale Bright Star Catalog (VizieR V/50)…"
curl -fsSL "https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz" -o bsc5.dat.gz
gunzip -f bsc5.dat.gz
echo "  $(wc -l < bsc5.dat) rows"

echo "NOAA World Magnetic Model 2025…"
curl -fsSL "https://www.ncei.noaa.gov/sites/default/files/2024-12/WMM2025COF.zip" -o wmm.zip
unzip -oj wmm.zip '*/WMM.COF' '*/WMM2025_TestValues.txt' -d .
mkdir -p ../test/fixtures
mv -f WMM2025_TestValues.txt ../test/fixtures/
rm -f wmm.zip
echo "  epoch $(head -1 WMM.COF | awk '{print $1}')"

echo
echo "Now run: python scripts/build-data.py"
