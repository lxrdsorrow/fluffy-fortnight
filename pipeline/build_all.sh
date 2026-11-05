#!/usr/bin/env bash
# Download and build ALL offline Houston data. Needs internet (run it once,
# and again whenever you want fresher data). The app itself never needs this.
#
# Needs: curl, python3 (pip install osmium shapely numpy), osmium-tool.
# Usage: bash pipeline/build_all.sh            (all areas in pipeline/areas.json)
#        bash pipeline/build_all.sh nw-houston (just one area)
set -euo pipefail
cd "$(dirname "$0")/.."
WORK=${WORK:-build-cache}
OUT=app/data
PMTILES_VERSION=1.31.2
mkdir -p "$WORK" "$OUT"

# 1. The pmtiles tool (cuts the Houston piece out of the world basemap)
if [ ! -x "$WORK/pmtiles" ]; then
  echo "== getting pmtiles tool"
  curl -fsSL -o "$WORK/pmtiles.tgz" \
    "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz"
  tar -xzf "$WORK/pmtiles.tgz" -C "$WORK" pmtiles
fi

# 2. OpenStreetMap data for Texas (about 700 MB download, cut down below)
if [ ! -s "$WORK/texas.osm.pbf" ] || [ -n "$(find "$WORK/texas.osm.pbf" -mtime +6 2>/dev/null)" ]; then
  echo "== downloading OpenStreetMap Texas extract"
  curl -fL --retry 4 -o "$WORK/texas.osm.pbf.part" https://download.geofabrik.de/north-america/us/texas-latest.osm.pbf
  mv "$WORK/texas.osm.pbf.part" "$WORK/texas.osm.pbf"
fi

# 3. Newest world basemap build from Protomaps (we only download the Houston part)
BASEMAP_URL=""
for i in $(seq 0 14); do
  d=$(date -u -d "-$i day" +%Y%m%d)
  if curl -fsI "https://build.protomaps.com/$d.pmtiles" >/dev/null 2>&1; then
    BASEMAP_URL="https://build.protomaps.com/$d.pmtiles"; break
  fi
done
echo "== basemap source: ${BASEMAP_URL:-NONE FOUND (map will show roads from routing data only)}"

AREAS=$(python3 -c "import json;print(' '.join(a['id'] for a in json.load(open('pipeline/areas.json'))['areas']))")
[ $# -gt 0 ] && AREAS="$*"

for id in $AREAS; do
  read -r NAME W S E N MAXZ KIND REGION < <(python3 - "$id" <<'EOF'
import json, sys
a = next(x for x in json.load(open("pipeline/areas.json"))["areas"] if x["id"] == sys.argv[1])
print(a["name"].replace(" ", "_"), *a["bbox"], a["maxzoom"], a.get("kind", "metro"), a.get("region", "TX"))
EOF
)
  NAME=${NAME//_/ }
  echo "== area $id: $NAME  bbox $W,$S,$E,$N"
  mkdir -p "$OUT/$id"
  osmium extract -b "$W,$S,$E,$N" "$WORK/texas.osm.pbf" -o "$WORK/$id.osm.pbf" --overwrite
  if [ -n "$BASEMAP_URL" ]; then
    "$WORK/pmtiles" extract "$BASEMAP_URL" "$OUT/$id/basemap.pmtiles" --bbox="$W,$S,$E,$N" --maxzoom="$MAXZ"
  fi
  FLOOD_ARG=()
  if python3 pipeline/fetch_fema.py --bbox "$W" "$S" "$E" "$N" --out "$WORK/$id-flood.geojson"; then
    FLOOD_ARG=(--flood "$WORK/$id-flood.geojson")
  else
    echo "!! FEMA flood data could not be downloaded; building without the flood layer"
  fi
  ZCTA_ARG=()
  if python3 pipeline/fetch_zcta.py --bbox "$W" "$S" "$E" "$N" --out "$WORK/$id-zcta.geojson"; then
    ZCTA_ARG=(--zcta "$WORK/$id-zcta.geojson")
  else
    echo "!! Census ZIP areas could not be downloaded; using OpenStreetMap ZIP codes only"
  fi
  python3 pipeline/build_area.py --pbf "$WORK/$id.osm.pbf" --out "$OUT/$id" --id "$id" \
    --name "$NAME" --bbox "$W" "$S" "$E" "$N" --kind "$KIND" --region "$REGION" \
    --curated pipeline/curated_pois.json "${FLOOD_ARG[@]}" "${ZCTA_ARG[@]}"
done

python3 pipeline/write_manifest.py "$OUT"
echo "== sizes"
du -sh "$OUT"/*/ || true
