#!/usr/bin/env python3
"""Write app/data/areas.json: the list of downloadable areas and their sizes."""
import json
import os
import sys

out = sys.argv[1] if len(sys.argv) > 1 else "app/data"
areas = []
for d in sorted(os.listdir(out)):
    meta_path = os.path.join(out, d, "meta.json")
    if not os.path.exists(meta_path):
        continue
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    files = {}
    for fn in ("basemap.pmtiles", "search.sqlite", "graph.bin", "pois.json", "flood.geojson", "meta.json"):
        fp = os.path.join(out, d, fn)
        if os.path.exists(fp):
            files[fn] = os.path.getsize(fp)
    meta["files"] = files
    meta["bytes"] = sum(files.values())
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    areas.append({k: meta[k] for k in ("id", "name", "bbox", "built", "files", "bytes", "hasFlood", "hasBasemap")})
with open(os.path.join(out, "areas.json"), "w", encoding="utf-8") as f:
    json.dump({"areas": areas}, f, indent=1)
for a in areas:
    print(f"  {a['id']}: {a['bytes']/1e6:.1f} MB  {a['files']}")
