#!/usr/bin/env python3
"""Make a tiny SYNTHETIC basemap.pmtiles for the Testville test town, in the
same layer layout as the Protomaps basemap (earth, water, roads), so tests can
check that map tiles really draw. Tests only — not real map data.

  python3 tests/make_fixture_basemap.py OUT.pmtiles
"""
import gzip
import json
import math
import sys

import mapbox_vector_tile
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

W, S, E, N = -95.48, 29.86, -95.41, 29.90
LAT0, LON0, DLAT, DLON = 29.875, -95.465, 0.003, 0.004


def tile_bounds(z, x, y):
    n = 2 ** z
    lon1, lon2 = x / n * 360 - 180, (x + 1) / n * 360 - 180
    lat = lambda t: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * t / n))))
    return lon1, lat(y + 1), lon2, lat(y)


def to_tile(lon, lat, b):
    x = (lon - b[0]) / (b[2] - b[0]) * 4096
    merc = lambda v: math.log(math.tan(math.pi / 4 + math.radians(v) / 2))
    y = (merc(b[3]) - merc(lat)) / (merc(b[3]) - merc(b[1])) * 4096
    return round(x), round(y)


def tiles_for(z):
    n = 2 ** z
    x1 = int((W + 180) / 360 * n)
    x2 = int((E + 180) / 360 * n)
    ty = lambda lat: int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    for x in range(x1, x2 + 1):
        for y in range(ty(N), ty(S) + 1):
            yield x, y


roads = []
for i in range(6):
    roads.append(([(LON0, LAT0 + i * DLAT), (LON0 + 6 * DLON, LAT0 + i * DLAT)], "minor_road"))
for j in range(7):
    roads.append(([(LON0 + j * DLON, LAT0), (LON0 + j * DLON, LAT0 + 5 * DLAT)], "major_road"))
by = LAT0 + 2.5 * DLAT

with open(sys.argv[1], "wb") as f:
    w = Writer(f)
    for z in range(8, 15):
        for x, y in sorted(tiles_for(z), key=lambda t: zxy_to_tileid(z, *t)):
            b = tile_bounds(z, x, y)
            earth = [{"geometry": "POLYGON((0 0, 4096 0, 4096 4096, 0 4096, 0 0))", "properties": {"kind": "earth"}}]
            water = [{"geometry": "LINESTRING(%d %d, %d %d)" % (*to_tile(LON0 - DLON, by, b), *to_tile(LON0 + 7 * DLON, by, b)),
                      "properties": {"kind": "stream", "name": "Test Bayou"}}]
            rl = []
            for pts, kind in roads:
                p = [to_tile(lo, la, b) for lo, la in pts]
                rl.append({"geometry": "LINESTRING(%s)" % ", ".join(f"{a} {c}" for a, c in p),
                           "properties": {"kind": kind, "name": "Test road", "min_zoom": 8}})
            data = mapbox_vector_tile.encode([
                {"name": "earth", "features": earth},
                {"name": "water", "features": water},
                {"name": "roads", "features": rl},
            ], default_options={"y_coord_down": True, "quantize_bounds": None})
            w.write_tile(zxy_to_tileid(z, x, y), gzip.compress(data))
    w.finalize(
        {"tile_type": TileType.MVT, "tile_compression": Compression.GZIP, "min_zoom": 8, "max_zoom": 14,
         "min_lon_e7": int(W * 1e7), "min_lat_e7": int(S * 1e7), "max_lon_e7": int(E * 1e7), "max_lat_e7": int(N * 1e7),
         "center_zoom": 12, "center_lon_e7": int(-95.45 * 1e7), "center_lat_e7": int(29.88 * 1e7)},
        {"vector_layers": [{"id": "earth", "fields": {}}, {"id": "water", "fields": {}}, {"id": "roads", "fields": {}}],
         "attribution": "synthetic test data"},
    )
print("wrote", sys.argv[1])
