#!/usr/bin/env python3
"""Build the offline data files for one map area from an OpenStreetMap extract.

Reads:   an .osm.pbf (or .osm) file cut to the area, and optionally a flood
         GeoJSON made by fetch_fema.py.
Writes:  search.sqlite  - address / place search index (SQLite FTS4)
         graph.bin      - road network for offline directions
         pois.json      - hospitals, shelters, water, etc.
         flood.geojson  - simplified floodplain shapes for the map layer
         meta.json      - counts and sizes

Run:  python3 pipeline/build_area.py --pbf area.osm.pbf --out app/data/nw-houston \
          --id nw-houston --name "..." --bbox W S E N [--flood flood_raw.geojson]
"""
import argparse
import json
import math
import os
import re
import sqlite3
import struct
import sys
import time
from array import array

import numpy as np
import osmium
import shapely
from shapely.geometry import LineString, shape, mapping
from shapely.strtree import STRtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from textnorm import normalize  # noqa: E402

# ---------------------------------------------------------------- road rules
# Car speed in km/h when the road has no maxspeed tag (US-style defaults).
CAR_SPEED = {
    "motorway": 105, "motorway_link": 72, "trunk": 89, "trunk_link": 56,
    "primary": 72, "primary_link": 48, "secondary": 64, "secondary_link": 48,
    "tertiary": 56, "tertiary_link": 40, "unclassified": 48, "residential": 40,
    "living_street": 16, "service": 24, "road": 40,
}
FOOT_ONLY = {"footway", "path", "pedestrian", "steps", "track", "cycleway", "bridleway", "corridor"}
NO_FOOT = {"motorway", "motorway_link"}
NO_BIKE = {"motorway", "motorway_link", "steps"}
NO_WORDS = {"no", "private_no", "use_sidepath"}

F_CAR_FWD, F_CAR_BWD, F_FOOT, F_BIKE_FWD, F_BIKE_BWD = 1, 2, 4, 8, 16
F_FLOOD100, F_UNDERPASS, F_BAYOU, F_FORD, F_FLOOD500, F_PRIVATE, F_SLOWBIKE = 32, 64, 128, 256, 512, 1024, 2048

POI_LABELS = {
    "hospital": "Hospital", "clinic": "Clinic / urgent care", "pharmacy": "Pharmacy",
    "police": "Police station", "fire": "Fire station", "shelter": "Shelter",
    "community": "Community center", "water": "Drinking water", "grocery": "Grocery store",
    "fuel": "Gas station", "foodbank": "Food bank / pantry", "emergency": "Emergency management",
}
# places that count as "the same kind" when removing duplicates
SAME_GROUP = {"hospital": "med", "clinic": "med", "pharmacy": "pharmacy", "police": "safety", "fire": "safety",
              "emergency": "safety", "shelter": "shelter", "community": "shelter", "water": "water",
              "grocery": "food", "foodbank": "food", "fuel": "fuel"}


def poi_category(t):
    a, h, s = t.get("amenity"), t.get("healthcare"), t.get("shop")
    if a == "hospital" or h == "hospital":
        return "hospital"
    if a in ("clinic", "doctors") or h in ("clinic", "urgent_care", "centre"):
        return "clinic"
    if a == "pharmacy" or h == "pharmacy" or s == "chemist":
        return "pharmacy"
    if a == "police":
        return "police"
    if a == "fire_station":
        return "fire"
    if (t.get("social_facility") == "shelter" or t.get("emergency") == "assembly_point"
            or a == "refugee_site" or (a == "shelter" and t.get("shelter_type") in ("emergency", "storm_shelter"))):
        return "shelter"
    if a == "food_bank" or t.get("social_facility") == "food_bank":
        return "foodbank"
    if a == "community_centre":
        return "community"
    if a in ("drinking_water", "water_point") or t.get("man_made") in ("water_tap", "water_well"):
        return "water"
    if s in ("supermarket", "grocery", "greengrocer", "convenience", "wholesale"):
        return "grocery"
    if a == "fuel":
        return "fuel"
    return None


PLACE_KEYS = ("amenity", "shop", "tourism", "leisure", "office", "healthcare", "building",
              "public_transport", "railway", "aeroway", "historic", "craft", "emergency")


def parse_maxspeed(v):
    if not v:
        return None
    m = re.match(r"\s*(\d+(?:\.\d+)?)\s*(km/h|kmh)?", v)
    if not m:
        return None
    n = float(m.group(1))
    if not m.group(2):  # Texas speed signs are in mph
        n *= 1.609
    return n if 5 <= n <= 140 else None


def tag_is_no(v):
    return v in ("no", "private_no")


def road_rules(t):
    """Return (car_fwd, car_bwd, foot, bike_fwd, bike_bwd, car_kmh, extra_flags) or None."""
    hw = t.get("highway")
    if not hw or t.get("area") == "yes":
        return None
    if hw not in CAR_SPEED and hw not in FOOT_ONLY:
        return None
    access = t.get("access")
    if access == "no" and not any(t.get(k) in ("yes", "designated", "permissive") for k in ("foot", "bicycle", "motor_vehicle", "motorcar")):
        return None
    flags = 0
    car = hw in CAR_SPEED
    for k in ("access", "vehicle", "motor_vehicle", "motorcar"):
        if t.get(k) == "no":
            car = False
        elif t.get(k) in ("yes", "designated", "permissive", "destination"):
            car = car or (hw in CAR_SPEED)
    if t.get("access") == "private" or t.get("motor_vehicle") == "private":
        flags |= F_PRIVATE
    foot = hw not in NO_FOOT
    if t.get("foot") in ("no", "use_sidepath") or (access == "no" and t.get("foot") not in ("yes", "designated", "permissive")):
        foot = False
    if t.get("foot") in ("yes", "designated", "permissive"):
        foot = True
    bike = hw not in NO_BIKE
    if t.get("bicycle") in ("no", "use_sidepath") or (access == "no" and t.get("bicycle") not in ("yes", "designated", "permissive")):
        bike = False
    if t.get("bicycle") in ("yes", "designated", "permissive"):
        bike = True
    if bike and hw in ("footway", "pedestrian", "corridor", "path", "bridleway") and t.get("bicycle") not in ("yes", "designated"):
        flags |= F_SLOWBIKE  # allowed, but think "walk the bike"
    ow = t.get("oneway")
    if hw in ("motorway",) or t.get("junction") == "roundabout":
        ow = ow or "yes"
    fwd, bwd = True, True
    if ow in ("yes", "true", "1"):
        bwd = False
    elif ow == "-1":
        fwd = False
    bfwd, bbwd = bike, bike
    if t.get("oneway:bicycle") != "no" and t.get("cycleway") not in ("opposite", "opposite_lane"):
        bfwd, bbwd = bike and fwd, bike and bwd
    speed = parse_maxspeed(t.get("maxspeed")) or CAR_SPEED.get(hw, 30)
    if not hw.startswith("motorway"):
        speed *= 0.85  # traffic lights and stop signs
    if t.get("tunnel") in ("yes", "building_passage", "culvert"):
        flags |= F_UNDERPASS
    else:
        try:
            if float(t.get("layer", "0").split(";")[0]) < 0:
                flags |= F_UNDERPASS
        except ValueError:
            pass
    if t.get("ford") in ("yes", "stepping_stones"):
        flags |= F_FORD
    return (car and fwd, car and bwd, foot, bfwd, bbwd, max(5, min(140, speed)), flags)


def clean_text(v):
    """Remove line breaks, tabs and other hidden characters some OSM names contain."""
    if not v:
        return v
    v = re.sub(r"[\x00-\x1f\x7f\u200b-\u200f\u2028\u2029\ufeff]+", " ", str(v))
    return re.sub(r"\s+", " ", v).strip()


FRONTAGE = re.compile(r"^(.*\b(?:Freeway|Fwy|Highway|Hwy|Tollway|Expressway|Expy|Parkway|Pkwy))\s+(?:Frontage|Service|Feeder)\s+(?:Road|Rd)$", re.I)


def mailing_street(street):
    """OSM often writes "Southwest Freeway Frontage Road"; mailing addresses (and
    the Census) use the main road name: "Southwest Freeway"."""
    m = FRONTAGE.match(street or "")
    return m.group(1) if m else street


def road_name(t):
    n = t.get("name")
    ref = t.get("ref")
    if n and ref and t.get("highway", "").startswith(("motorway", "trunk")):
        return f"{n} ({ref})"
    return n or ref or ""


def centroid(nodes):
    xs, ys = [], []
    for n in nodes:
        if n.location.valid():
            xs.append(n.location.lon)
            ys.append(n.location.lat)
    if not xs:
        return None
    return sum(xs) / len(xs), sum(ys) / len(ys)


class Collector(osmium.SimpleHandler):
    def __init__(self, bbox):
        super().__init__()
        self.w, self.s, self.e, self.n = bbox
        # roads
        self.refs = array("q")
        self.lons = array("d")
        self.lats = array("d")
        self.way_start = array("l")
        self.way_info = []  # (rules, name)
        # lines used for flood hints
        self.waterways = []
        self.rail_bridges = []
        self.bridge_way_idx = set()
        self.layer = {}
        # search + pois
        self.addresses = []  # (hn, street, unit, pc, city, name, lon, lat)
        self.places = []  # (name, kind, lon, lat, extra)
        self.pois = []
        self.ford_nodes = set()

    def inside(self, lon, lat):
        return self.w <= lon <= self.e and self.s <= lat <= self.n

    def _feature(self, t, lon, lat):
        if not self.inside(lon, lat):
            return
        t = {k: clean_text(v) for k, v in t.items()}
        hn, street = t.get("addr:housenumber"), t.get("addr:street")
        name = t.get("name")
        if hn and street:
            self.addresses.append((hn, street, t.get("addr:unit", ""), t.get("addr:postcode", ""),
                                   t.get("addr:city", ""), name or "", lon, lat))
        cat = poi_category(t)
        if cat:
            addr = " ".join(x for x in (hn, street) if x)
            self.pois.append({"cat": cat, "name": name or POI_LABELS[cat], "lat": round(lat, 6), "lon": round(lon, 6),
                              "addr": addr, "pc": t.get("addr:postcode", ""), "phone": t.get("phone", ""), "src": "osm"})
        if name and (cat or any(k in t for k in PLACE_KEYS)) and not (hn and street):
            kind = POI_LABELS.get(cat) or (t.get("amenity") or t.get("shop") or t.get("tourism") or t.get("leisure")
                                           or t.get("healthcare") or t.get("office") or "place").replace("_", " ")
            addr = " ".join(x for x in (hn, street) if x)
            self.places.append((name, kind, lon, lat, addr, t.get("addr:postcode", "")))
        elif name and hn and street and cat:
            pass  # already in addresses with its name
        place = t.get("place")
        if name and place in ("city", "town", "village", "suburb", "neighbourhood", "hamlet", "locality", "quarter"):
            self.places.append((name, "area: " + place, lon, lat, "", ""))

    def node(self, n):
        t = n.tags
        if len(t) == 0:
            return
        if t.get("ford") == "yes":
            self.ford_nodes.add(n.id)
        self._feature(dict(t), n.location.lon, n.location.lat)

    def way(self, w):
        t = {k: clean_text(v) for k, v in w.tags}
        rules = road_rules(t)
        if rules:
            start = len(self.refs)
            ok = 0
            for nd in w.nodes:
                if not nd.location.valid():
                    continue
                self.refs.append(nd.ref)
                self.lons.append(nd.location.lon)
                self.lats.append(nd.location.lat)
                ok += 1
            if ok >= 2:
                self.way_start.append(start)
                self.way_info.append((rules, road_name(t), t.get("bridge") not in (None, "no")))
            else:
                del self.refs[start:]
                del self.lons[start:]
                del self.lats[start:]
        else:
            if t.get("waterway") in ("river", "stream", "canal"):
                pts = [(nd.location.lon, nd.location.lat) for nd in w.nodes if nd.location.valid()]
                if len(pts) >= 2:
                    self.waterways.append(LineString(pts))
            if t.get("railway") and t.get("bridge") not in (None, "no"):
                pts = [(nd.location.lon, nd.location.lat) for nd in w.nodes if nd.location.valid()]
                if len(pts) >= 2:
                    self.rail_bridges.append(LineString(pts))
        # buildings and other features with addresses / names
        if len(t) and not t.get("highway"):
            c = centroid(w.nodes)
            if c:
                self._feature(t, c[0], c[1])
        elif t.get("highway") and t.get("name") is None:
            pass


def haversine_np(lon1, lat1, lon2, lat2):
    r = 6371008.8
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def build_graph(c, flood_geoms, out_path):
    t0 = time.time()
    refs = np.frombuffer(c.refs, dtype=np.int64)
    lons = np.frombuffer(c.lons, dtype=np.float64)
    lats = np.frombuffer(c.lats, dtype=np.float64)
    starts = np.frombuffer(c.way_start, dtype=np.int64) if len(c.way_start) else np.zeros(0, dtype=np.int64)
    nways = len(starts)
    ends = np.append(starts[1:], len(refs)).astype(np.int64)
    # a node is a graph node if it is used more than once or is a way end
    uniq, counts = np.unique(refs, return_counts=True)
    is_split = np.zeros(len(refs), dtype=bool)
    shared = uniq[counts > 1]
    is_split |= np.isin(refs, shared)
    is_split[starts] = True
    is_split[ends - 1] = True
    split_ids = np.unique(refs[is_split])
    node_index = {}
    # graph node coordinates
    first_pos = {}
    for i in np.nonzero(is_split)[0]:
        r = int(refs[i])
        if r not in first_pos:
            first_pos[r] = i
    node_ids = split_ids
    node_lon = np.zeros(len(node_ids))
    node_lat = np.zeros(len(node_ids))
    for k, r in enumerate(node_ids):
        r = int(r)
        node_index[r] = k
        p = first_pos[r]
        node_lon[k] = lons[p]
        node_lat[k] = lats[p]

    base_nodes = len(node_ids)
    extra_lon, extra_lat = [], []
    names = [""]
    name_idx = {"": 0}
    eu, ev, elen, espeed, eflags, ename, egeom = (array("I"), array("I"), array("f"), array("B"),
                                                  array("H"), array("I"), array("I"))
    coords = array("i")
    lines = []
    edge_is_bridge = []
    seg_len = haversine_np(lons[:-1], lats[:-1], lons[1:], lats[1:]) if len(lons) > 1 else np.zeros(0)
    for wi in range(nways):
        s, e = int(starts[wi]), int(ends[wi])
        (cf, cb, ft, bf, bb, kmh, flags), name, is_bridge = c.way_info[wi]
        base = 0
        if cf: base |= F_CAR_FWD
        if cb: base |= F_CAR_BWD
        if ft: base |= F_FOOT
        if bf: base |= F_BIKE_FWD
        if bb: base |= F_BIKE_BWD
        if base == 0:
            continue
        base |= flags
        ni = name_idx.get(name)
        if ni is None:
            ni = name_idx[name] = len(names)
            names.append(name)
        seg_start = s
        for i in range(s + 1, e):
            # split at junctions, and every ~150 m so a point always snaps near its road
            if not is_split[i] and i != e - 1 and seg_len[seg_start:i].sum() < 150:
                continue
            for r_, pos_ in ((int(refs[seg_start]), seg_start), (int(refs[i]), i)):
                if r_ not in node_index:
                    node_index[r_] = len(extra_lon) + base_nodes
                    extra_lon.append(lons[pos_]); extra_lat.append(lats[pos_])
            u, v = node_index[int(refs[seg_start])], node_index[int(refs[i])]
            pts = list(zip(lons[seg_start:i + 1], lats[seg_start:i + 1]))
            length = float(seg_len[seg_start:i].sum())
            f = base
            if c.ford_nodes and any(int(r) in c.ford_nodes for r in refs[seg_start:i + 1]):
                f |= F_FORD
            if u != v or length > 1:
                line = LineString(pts)
                simp = line.simplify(0.00002) if len(pts) > 2 else line
                eu.append(u); ev.append(v); elen.append(max(length, 0.5))
                espeed.append(int(round(kmh))); eflags.append(f); ename.append(ni)
                egeom.append(len(coords) // 2)
                for x, y in simp.coords:
                    coords.append(int(round(x * 1e6))); coords.append(int(round(y * 1e6)))
                lines.append(simp)
                edge_is_bridge.append(is_bridge)
            seg_start = i
    ne = len(eu)
    egeom.append(len(coords) // 2)
    node_lon = np.concatenate([node_lon, np.array(extra_lon, dtype=np.float64)])
    node_lat = np.concatenate([node_lat, np.array(extra_lat, dtype=np.float64)])
    node_ids = np.arange(len(node_lon))
    print(f"  graph: {len(node_ids)} nodes, {ne} road pieces, {len(coords)//2} shape points "
          f"({time.time()-t0:.0f}s)")

    # ---- flood hints
    eflags_np = np.frombuffer(eflags, dtype=np.uint16).copy()
    lines_arr = np.array(lines, dtype=object)
    if flood_geoms and ne:
        for level, bit in (("100", F_FLOOD100), ("500", F_FLOOD500)):
            geoms = [g for g, lv in flood_geoms if lv == level]
            if not geoms:
                continue
            tree = STRtree(geoms)
            ei, _ = tree.query(lines_arr, predicate="intersects")
            eflags_np[np.unique(ei)] |= bit
    if c.waterways and ne:
        bridge_idx = np.nonzero(np.array(edge_is_bridge))[0]
        if len(bridge_idx):
            tree = STRtree(c.waterways)
            ei, _ = tree.query(lines_arr[bridge_idx], predicate="intersects")
            eflags_np[bridge_idx[np.unique(ei)]] |= F_BAYOU
        # roads at ground level that cross a waterway also count as a crossing
        ground = np.nonzero(~np.array(edge_is_bridge) & ((eflags_np & F_UNDERPASS) == 0))[0]
        if len(ground):
            tree = STRtree(c.waterways)
            ei, _ = tree.query(lines_arr[ground], predicate="intersects")
            eflags_np[ground[np.unique(ei)]] |= F_BAYOU
    if c.rail_bridges and ne:
        ground = np.nonzero(~np.array(edge_is_bridge))[0]
        tree = STRtree(c.rail_bridges)
        ei, _ = tree.query(lines_arr[ground], predicate="intersects")
        eflags_np[ground[np.unique(ei)]] |= F_UNDERPASS
    flood_counts = {k: int(((eflags_np & b) > 0).sum()) for k, b in
                    (("flood100", F_FLOOD100), ("flood500", F_FLOOD500), ("underpass", F_UNDERPASS),
                     ("bayou", F_BAYOU), ("ford", F_FORD))}
    print(f"  flood hints on road pieces: {flood_counts}")

    # ---- write binary
    name_bytes = json.dumps(names, ensure_ascii=False).encode("utf-8")

    def pad(b):
        return b + b"\0" * ((-len(b)) % 4)

    parts = [
        np.round(node_lon * 1e6).astype(np.int32).tobytes(),
        np.round(node_lat * 1e6).astype(np.int32).tobytes(),
        eu.tobytes(), ev.tobytes(), elen.tobytes(),
        pad(espeed.tobytes()), pad(eflags_np.tobytes()), ename.tobytes(), egeom.tobytes(),
        coords.tobytes(), pad(name_bytes),
    ]
    header = struct.pack("<4sIIIII", b"HSG1", 1, len(node_ids), ne, len(coords) // 2, len(name_bytes))
    with open(out_path, "wb") as f:
        f.write(header)
        for p in parts:
            f.write(p)
    # street index for search: one entry per street name per ~3 km cell
    streets = {}
    lens = np.frombuffer(elen, dtype=np.float32)
    for k in range(ne):
        nm = names[ename[k]]
        if not nm:
            continue
        g0 = egeom[k]
        x, y = coords[2 * g0] / 1e6, coords[2 * g0 + 1] / 1e6
        key = (nm, round(x / 0.03), round(y / 0.03))
        cur = streets.get(key)
        if cur is None or lens[k] > cur[2]:
            streets[key] = (x, y, float(lens[k]))
    return len(node_ids), ne, flood_counts, streets


def load_flood(path, bbox):
    if not path or not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        gj = json.load(f)
    out = []
    clip = shapely.box(*bbox)
    for feat in gj.get("features", []):
        p = feat.get("properties") or {}
        if not feat.get("geometry"):
            continue
        try:
            g = shapely.make_valid(shape(feat["geometry"]))
        except Exception:
            continue
        sub = (p.get("ZONE_SUBTY") or "").upper()
        if p.get("SFHA_TF") == "T" or "FLOODWAY" in sub:
            level = "100"
        elif "0.2" in sub:
            level = "500"
        else:
            continue
        g = g.intersection(clip)
        if not g.is_empty:
            out.append((g, level))
    print(f"  flood shapes: {len(out)}")
    return out


def write_flood_layer(flood, path):
    by = {"100": [], "500": []}
    for g, lv in flood:
        by[lv].append(g)
    feats = []
    for lv, geoms in by.items():
        if not geoms:
            continue
        try:
            merged = shapely.union_all(geoms)
        except shapely.errors.GEOSException:
            merged = shapely.union_all([shapely.make_valid(g.buffer(0)) for g in geoms])
        merged = shapely.make_valid(merged).simplify(0.00015, preserve_topology=True)
        try:
            merged = shapely.set_precision(shapely.make_valid(merged), 0.00001)
        except shapely.errors.GEOSException:
            pass  # keep full precision if rounding would break a shape
        feats.append({"type": "Feature", "properties": {"level": lv}, "geometry": mapping(merged)})
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, separators=(",", ":"))


def assign_zips(c, pois, path):
    """Give every address / place / essential a ZIP code from the official Census
    ZIP areas when OpenStreetMap has none. Where both exist and disagree, the
    OSM value is kept and the disagreement is reported for checking."""
    clean = lambda z: (re.match(r"\s*(\d{5})", z or "") or [None, ""])[1]
    report = {"filled": 0, "agree": 0, "disagree": 0, "disagreeSamples": [], "noZipArea": 0}
    if not path or not os.path.exists(path):
        c.addresses = [(hn, st, un, clean(pc), city, nm, lo, la) for hn, st, un, pc, city, nm, lo, la in c.addresses]
        return None
    with open(path, encoding="utf-8") as f:
        gj = json.load(f)
    geoms, zips = [], []
    for feat in gj["features"]:
        try:
            geoms.append(shapely.make_valid(shape(feat["geometry"])))
            zips.append(feat["properties"]["zip"])
        except Exception:
            pass
    tree = STRtree(geoms)

    def lookup(lons, lats):
        out = [None] * len(lons)
        if not lons:
            return out
        pi, gi = tree.query(shapely.points(lons, lats), predicate="within")
        for a_, b_ in zip(pi, gi):
            out[a_] = zips[b_]
        return out

    z = lookup([a[6] for a in c.addresses], [a[7] for a in c.addresses])
    new = []
    for (hn, st, un, pc, city, nm, lo, la), zz in zip(c.addresses, z):
        pc = clean(pc)
        if not zz:
            report["noZipArea"] += 1
        elif not pc:
            pc = zz
            report["filled"] += 1
        elif pc == zz:
            report["agree"] += 1
        else:
            report["disagree"] += 1
            if len(report["disagreeSamples"]) < 15:
                report["disagreeSamples"].append(f"{hn} {st}: OSM {pc}, Census {zz}")
        new.append((hn, st, un, pc, city, nm, lo, la))
    c.addresses = new
    z = lookup([p[2] for p in c.places], [p[3] for p in c.places])
    c.places = [(nm, kd, lo, la, ad, clean(pc) or (zz or "")) for (nm, kd, lo, la, ad, pc), zz in zip(c.places, z)]
    z = lookup([p["lon"] for p in pois], [p["lat"] for p in pois])
    for p_, zz in zip(pois, z):
        p_["pc"] = clean(p_.get("pc")) or (zz or "")
    print(f"  ZIP codes (Census): {report['filled']} filled in, {report['agree']} agree, "
          f"{report['disagree']} disagree (OSM kept), {report['noZipArea']} outside ZIP areas")
    return report


def merge_curated(path, c, pois, bbox):
    """Add scouted, verified places. Ones without coordinates are placed only by an
    exact address (or exact name) match in the OSM data — never guessed."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    addr_index = {}
    for hn, street, unit, pc, city, name, lon, lat in c.addresses:
        addr_index.setdefault((hn.lower(), normalize(street)), (lon, lat))
    name_index = {}
    for name, kind, lon, lat, addr, pc in c.places:
        name_index.setdefault(normalize(name), (lon, lat))
    w, s_, e, n = bbox
    added, report = [], {"added": 0, "placedByAddress": [], "placedByName": [], "notFound": [], "outsideArea": 0}
    for item in data["pois"]:
        lon, lat = item.get("lon"), item.get("lat")
        if lat is None or lon is None:
            m = re.match(r"\s*(\d+[a-zA-Z]?)\s+(.+)", item["addr"].split(",")[0])
            hit = addr_index.get((m.group(1).lower(), normalize(m.group(2)))) if m else None
            if hit:
                report["placedByAddress"].append(item["name"])
            else:
                hit = name_index.get(normalize(item["name"]))
                if hit:
                    report["placedByName"].append(item["name"])
            if not hit:
                report["notFound"].append(f'{item["name"]} ({item["addr"]})')
                continue
            lon, lat = hit
        if not (w <= lon <= e and s_ <= lat <= n):
            report["outsideArea"] += 1
            continue
        added.append({"cat": item["cat"], "name": item["name"], "lat": round(lat, 6), "lon": round(lon, 6),
                      "addr": item["addr"], "pc": item.get("pc", ""), "phone": item.get("phone", ""),
                      "note": item.get("note", ""), "src": "scouted"})
    # drop OpenStreetMap copies of the same place (same kind, within ~120 m)
    def close(a, b):
        return abs(a["lat"] - b["lat"]) < 0.0011 and abs(a["lon"] - b["lon"]) < 0.0012
    kept = [p for p in pois if not any(p["cat"] == q["cat"] and close(p, q) for q in added)]
    report["added"] = len(added)
    report["osmDuplicatesRemoved"] = len(pois) - len(kept)
    print(f"  scouted places: {report['added']} added, {len(report['placedByAddress'])} placed by OSM address, "
          f"{len(report['placedByName'])} by OSM name, not found: {report['notFound']}")
    return kept + added, report


def write_search(c, streets, pois, path):
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.executescript("""
      PRAGMA page_size=4096;
      CREATE TABLE p(id INTEGER PRIMARY KEY, label TEXT, sub TEXT, kind TEXT, lat REAL, lon REAL,
                     hn TEXT, street TEXT, pc TEXT, rank INTEGER);
      CREATE VIRTUAL TABLE f USING fts4(content="", txt);
    """)
    rows = []
    seen = set()
    pc_points = {}
    for hn, street, unit, pc, city, name, lon, lat in c.addresses:
        key = (hn.lower(), street.lower(), unit.lower(), round(lat, 4), round(lon, 4))
        if key in seen:
            continue
        seen.add(key)
        mail = mailing_street(street)
        label = f"{hn} {mail}" + (f" #{unit}" if unit else "")
        sub = ", ".join(x for x in (name, city or "", ("TX " + pc) if pc else "") if x)
        txt = normalize(f"{label} {pc} {city} {name}" + (f" {street}" if mail != street else ""))
        rows.append((label, sub, "address", lat, lon, hn.lower(), normalize(mail), pc, 1, txt))
        if pc and re.fullmatch(r"\d{5}", pc):
            s = pc_points.setdefault(pc, [0.0, 0.0, 0])
            s[0] += lon; s[1] += lat; s[2] += 1
    for name, kind, lon, lat, addr, pc in c.places:
        sub = ", ".join(x for x in (kind, addr, ("TX " + pc) if pc else "") if x)
        rows.append((name, sub, "place", lat, lon, "", "", pc, 2, normalize(f"{name} {kind} {addr} {pc}")))
    for p in pois:
        if p.get("src") == "scouted":
            sub = ", ".join(x for x in (POI_LABELS.get(p["cat"], ""), p["addr"], ("TX " + p["pc"]) if p["pc"] else "") if x)
            rows.append((p["name"], sub, "place", p["lat"], p["lon"], "", "", p["pc"], 2,
                         normalize(f'{p["name"]} {POI_LABELS.get(p["cat"], "")} {p["addr"]} {p["pc"]}')))
    for (nm, _, _), (x, y, _) in streets.items():
        rows.append((nm, "street", "street", y, x, "", normalize(nm), "", 3, normalize(nm + " street road")))
    for pc, (sx, sy, n) in pc_points.items():
        rows.append((f"ZIP {pc}", "ZIP code area (center)", "zip", sy / n, sx, "", "", pc, 4, f"{pc} zip"))
    db.executemany("INSERT INTO p(label,sub,kind,lat,lon,hn,street,pc,rank) VALUES (?,?,?,?,?,?,?,?,?)",
                   [r[:9] for r in rows])
    db.executemany("INSERT INTO f(docid, txt) VALUES (?,?)", [(i + 1, r[9]) for i, r in enumerate(rows)])
    db.execute("CREATE INDEX p_street ON p(street)")
    db.execute("INSERT INTO f(f) VALUES('optimize')")
    db.commit()
    db.execute("VACUUM")
    db.close()
    counts = {}
    for r in rows:
        counts[r[2]] = counts.get(r[2], 0) + 1
    print(f"  search index: {counts}")
    return counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--bbox", nargs=4, type=float, required=True)
    ap.add_argument("--flood")
    ap.add_argument("--curated", help="pipeline/curated_pois.json (scouted, verified places)")
    ap.add_argument("--zcta", help="Census ZIP code areas from fetch_zcta.py")
    ap.add_argument("--kind", default="metro", help="metro or state pack")
    ap.add_argument("--region", default="TX")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    t0 = time.time()
    print(f"[{a.id}] reading {a.pbf}")
    c = Collector(a.bbox)
    c.apply_file(a.pbf, locations=True, idx="flex_mem")
    print(f"  read {len(c.way_info)} roads, {len(c.addresses)} addresses, {len(c.pois)} essentials "
          f"({time.time()-t0:.0f}s)")
    flood = load_flood(a.flood, a.bbox)
    nn, ne, flood_counts, streets = build_graph(c, flood, os.path.join(a.out, "graph.bin"))
    write_flood_layer(flood, os.path.join(a.out, "flood.geojson"))
    # de-duplicate essentials (same name within ~50 m)
    seen, pois = set(), []
    for p in c.pois:
        k = (p["cat"], p["name"].lower(), round(p["lat"], 3), round(p["lon"], 3))
        if k not in seen:
            seen.add(k)
            pois.append(p)
    zip_report = assign_zips(c, pois, a.zcta)
    curated_report = None
    if a.curated:
        pois, curated_report = merge_curated(a.curated, c, pois, a.bbox)
    with open(os.path.join(a.out, "pois.json"), "w", encoding="utf-8") as f:
        json.dump(pois, f, separators=(",", ":"), ensure_ascii=False)
    search_counts = write_search(c, streets, pois, os.path.join(a.out, "search.sqlite"))
    poi_counts = {}
    for p in pois:
        poi_counts[p["cat"]] = poi_counts.get(p["cat"], 0) + 1
    files = {}
    for fn in ("basemap.pmtiles", "search.sqlite", "graph.bin", "pois.json", "flood.geojson"):
        fp = os.path.join(a.out, fn)
        if os.path.exists(fp):
            files[fn] = os.path.getsize(fp)
    meta = {
        "id": a.id, "name": a.name, "kind": a.kind, "region": a.region, "bbox": a.bbox, "scouted": curated_report, "zipCheck": zip_report, "built": time.strftime("%Y-%m-%d"),
        "files": files, "bytes": sum(files.values()),
        "counts": {"graphNodes": nn, "roadPieces": ne, "search": search_counts, "essentials": poi_counts,
                   "floodRoadPieces": flood_counts},
        "hasFlood": bool(flood), "hasBasemap": "basemap.pmtiles" in files,
    }
    with open(os.path.join(a.out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    print(f"[{a.id}] done in {time.time()-t0:.0f}s, files: {files}")


if __name__ == "__main__":
    main()
