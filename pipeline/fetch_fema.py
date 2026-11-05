#!/usr/bin/env python3
"""Download FEMA floodplain shapes (National Flood Hazard Layer) for a box.

Only run this while online. Output is a GeoJSON file that build_area.py uses
to mark flood-prone roads. This is FLOODPLAIN MAP data (where floods are
likely over the years), not a live flood report.

  python3 pipeline/fetch_fema.py --bbox W S E N --out flood_raw.geojson
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

SERVICE = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer"
WHERE = "SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2 PCT%' OR ZONE_SUBTY LIKE '%FLOODWAY%'"


def get_json(url, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "offline-houston-survival-map-builder"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # FEMA's server is often slow; wait and retry
            print(f"  retry {i+1}/{tries}: {e}", file=sys.stderr)
            time.sleep(5 * (i + 1))
    raise RuntimeError("FEMA service did not answer: " + url)


def find_layer():
    info = get_json(SERVICE + "?f=json")
    for lyr in info.get("layers", []):
        if lyr.get("name", "").lower() == "flood hazard zones":
            return lyr["id"]
    return 28


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--step", type=float, default=0.1, help="tile size in degrees")
    a = ap.parse_args()
    layer = find_layer()
    print(f"FEMA layer {layer}")
    w, s, e, n = a.bbox
    feats, seen = [], set()
    x = w
    while x < e:
        y = s
        while y < n:
            box = f"{x},{y},{min(x + a.step, e)},{min(y + a.step, n)}"
            offset = 0
            while True:
                q = urllib.parse.urlencode({
                    "where": WHERE, "geometry": box, "geometryType": "esriGeometryEnvelope",
                    "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
                    "outFields": "OBJECTID,FLD_ZONE,ZONE_SUBTY,SFHA_TF", "outSR": 4326,
                    "maxAllowableOffset": 0.00005, "geometryPrecision": 6,
                    "resultOffset": offset, "resultRecordCount": 500, "f": "geojson",
                })
                gj = get_json(f"{SERVICE}/{layer}/query?{q}")
                got = gj.get("features", [])
                for f in got:
                    oid = (f.get("properties") or {}).get("OBJECTID") or f.get("id")
                    if oid in seen:
                        continue
                    seen.add(oid)
                    feats.append(f)
                if not got or not (gj.get("exceededTransferLimit") or gj.get("properties", {}).get("exceededTransferLimit")):
                    if len(got) < 500:
                        break
                offset += len(got)
            print(f"  tile {box}: total {len(feats)} shapes")
            y += a.step
        x += a.step
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f)
    print(f"wrote {len(feats)} floodplain shapes to {a.out}")


if __name__ == "__main__":
    main()
