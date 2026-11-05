#!/usr/bin/env python3
"""Download US Census ZIP Code Tabulation Areas (ZCTA) for a box.

Official public-domain government data (Census TIGERweb). Used to give every
address and place a correct ZIP code. Run while online only.

  python3 pipeline/fetch_zcta.py --bbox W S E N --out zcta.geojson
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

SERVICE = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer"


def get_json(url, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "offline-houston-survival-map-builder"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            print(f"  retry {i+1}/{tries}: {e}", file=sys.stderr)
            time.sleep(5 * (i + 1))
    raise RuntimeError("Census TIGERweb did not answer: " + url)


def find_layer():
    info = get_json(SERVICE + "?f=json")
    for lyr in info.get("layers", []):
        name = lyr.get("name", "").lower()
        if "zip code tabulation" in name and "label" not in name:
            return lyr["id"], lyr["name"]
    raise RuntimeError("ZCTA layer not found in TIGERweb")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", nargs=4, type=float, required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    layer, name = find_layer()
    print(f"Census layer {layer}: {name}")
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({
            "where": "1=1", "geometry": ",".join(map(str, a.bbox)), "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": 4326,
            "maxAllowableOffset": 0.0001, "geometryPrecision": 5,
            "resultOffset": offset, "resultRecordCount": 100, "f": "geojson",
        })
        gj = get_json(f"{SERVICE}/{layer}/query?{q}")
        got = gj.get("features", [])
        for f in got:
            p = f.get("properties") or {}
            zip5 = next((str(p[k]) for k in ("ZCTA5", "ZCTA5CE20", "ZCTA5CE10", "BASENAME", "GEOID") if p.get(k)), None)
            if zip5 and f.get("geometry"):
                feats.append({"type": "Feature", "properties": {"zip": zip5[-5:]}, "geometry": f["geometry"]})
        print(f"  {len(feats)} ZIP areas so far")
        if len(got) < 100:
            break
        offset += len(got)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f)
    print(f"wrote {len(feats)} ZIP code areas to {a.out}")


if __name__ == "__main__":
    main()
