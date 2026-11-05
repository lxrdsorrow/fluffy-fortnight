#!/usr/bin/env python3
"""Make a tiny SYNTHETIC test town ("Testville") as OpenStreetMap XML plus a
fake floodplain file. Used only by automated tests; it is not real Houston data.

  python3 tests/make_fixture.py OUTDIR
"""
import json
import os
import sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
LAT0, LON0, DLAT, DLON = 29.875, -95.465, 0.003, 0.004
ROWS = ["Alpha St", "Bravo St", "Charlie St", "Delta St", "Echo St", "Foxtrot St"]
COLS = [f"{n} Ave" for n in ("1st", "2nd", "3rd", "4th", "5th", "6th", "7th")]
nodes, ways = [], []
nid = [0]


def node(lat, lon, tags=None):
    nid[0] += 1
    nodes.append((nid[0], lat, lon, tags or {}))
    return nid[0]


grid = {}
for i in range(len(ROWS)):
    for j in range(len(COLS)):
        grid[i, j] = node(LAT0 + i * DLAT, LON0 + j * DLON)
for i, name in enumerate(ROWS):
    tags = {"highway": "residential", "name": name}
    if name == "Charlie St":
        tags["oneway"] = "yes"
    ways.append(([grid[i, j] for j in range(len(COLS))], tags))
for j, name in enumerate(COLS):
    ways.append(([grid[i, j] for i in range(len(ROWS))], {"highway": "tertiary", "name": name}))
# walking shortcut
ways.append(([grid[0, 0], grid[1, 1], grid[2, 2]], {"highway": "footway"}))
# freeway to an island that only cars can reach
isl = node(LAT0 + 2 * DLAT, LON0 + 9 * DLON)
isl2 = node(LAT0 + 2.5 * DLAT, LON0 + 9.5 * DLON)
ways.append(([grid[2, 6], isl], {"highway": "motorway", "name": "Test Freeway", "oneway": "no"}))
ways.append(([isl, isl2], {"highway": "residential", "name": "Island Rd"}))
# a bayou between rows 2 and 3
by = LAT0 + 2.5 * DLAT
ways.append(([node(by, LON0 - DLON), node(by, LON0 + 7 * DLON)], {"waterway": "stream", "name": "Test Bayou"}))
# addresses along each street
for i, name in enumerate(ROWS):
    for j in range(len(COLS) - 1):
        for k, off in enumerate((0.3, 0.7)):
            hn = 100 * (j + 1) + 2 * k + (0 if i % 2 == 0 else 1)
            node(LAT0 + i * DLAT + 0.0002, LON0 + (j + off) * DLON,
                 {"addr:housenumber": str(hn), "addr:street": name, "addr:postcode": "77999", "addr:city": "Testville"})
# essentials
node(LAT0 + 5 * DLAT + 0.0003, LON0 + 6 * DLON, {"amenity": "hospital", "name": "Testville General Hospital"})
node(LAT0 + 0.0003, LON0 + 0.5 * DLON, {"social_facility": "shelter", "amenity": "social_facility", "name": "Testville Shelter"})
node(LAT0 + 3 * DLAT + 0.0003, LON0 + 2 * DLON, {"amenity": "drinking_water"})
node(LAT0 + 1 * DLAT + 0.0003, LON0 + 4 * DLON, {"amenity": "pharmacy", "name": "Test Pharmacy"})
node(LAT0 + 4 * DLAT + 0.0003, LON0 + 1 * DLON, {"amenity": "fuel", "name": "Test Gas"})
node(LAT0 + 3 * DLAT, LON0 + 5 * DLON, {"place": "neighbourhood", "name": "Testville Heights"})

with open(os.path.join(out, "testville.osm"), "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="fixture">\n')
    for i, lat, lon, tags in nodes:
        if tags:
            f.write(f'<node id="{i}" version="1" lat="{lat:.7f}" lon="{lon:.7f}">')
            for k, v in tags.items():
                f.write(f'<tag k="{k}" v="{v}"/>')
            f.write("</node>\n")
        else:
            f.write(f'<node id="{i}" version="1" lat="{lat:.7f}" lon="{lon:.7f}"/>\n')
    for w, (refs, tags) in enumerate(ways, start=1):
        f.write(f'<way id="{w}" version="1">' + "".join(f'<nd ref="{r}"/>' for r in refs))
        f.write("".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items()) + "</way>\n")
    f.write("</osm>\n")

band = [[LON0 - DLON, by - 0.0008], [LON0 + 7 * DLON, by - 0.0008], [LON0 + 7 * DLON, by + 0.0008],
        [LON0 - DLON, by + 0.0008], [LON0 - DLON, by - 0.0008]]
with open(os.path.join(out, "flood.geojson"), "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"SFHA_TF": "T", "FLD_ZONE": "AE", "ZONE_SUBTY": ""},
         "geometry": {"type": "Polygon", "coordinates": [band]}}]}, f)
print("bbox", LON0 - 2 * DLON, LAT0 - DLAT, LON0 + 11 * DLON, LAT0 + 7 * DLAT)
