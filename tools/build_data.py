#!/usr/bin/env python3
"""Bake OpenStreetMap + terrain tiles for Kyung Hee Univ. Global Campus into data/campus.json.

Usage: python3 tools/build_data.py <osm_all.json> <dem_dir> <out.json>

Inputs:
  osm_all.json : Overpass `out geom` result (buildings, highways, landuse ... in bbox)
  dem_dir      : Terrarium PNG tiles named 14_<x>_<y>.png (AWS open terrain tiles)
"""
import json, math, os, struct, sys, zlib, glob, hashlib

OSM, DEM_DIR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

# Origin: the main gate (경희대학교 국제캠퍼스 정문)
LAT0, LON0 = 37.24733, 127.07841
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110574.0
BBOX = (37.2345, 127.0738, 37.2515, 127.0898)  # s, w, n, e


def proj(lat, lon):
    return ((lon - LON0) * KX, -(lat - LAT0) * KZ)


# ---------------------------------------------------------------- PNG / DEM
def read_png(path):
    b = open(path, "rb").read()
    assert b[:8] == b"\x89PNG\r\n\x1a\n"
    i, idat, w = 8, b"", 0
    while i < len(b):
        ln, typ = struct.unpack(">I4s", b[i:i + 8])
        data = b[i + 8:i + 8 + ln]
        if typ == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", data[:10])
            assert depth == 8 and ctype == 2
        elif typ == b"IDAT":
            idat += data
        i += 12 + ln
    raw = zlib.decompress(idat)
    bpp, stride = 3, w * 3
    out, prev, p = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[p]; p += 1
        row = bytearray(raw[p:p + stride]); p += stride
        for x in range(stride):
            a = row[x - bpp] if x >= bpp else 0
            c = prev[x - bpp] if x >= bpp else 0
            up = prev[x]
            if f == 1: row[x] = (row[x] + a) & 255
            elif f == 2: row[x] = (row[x] + up) & 255
            elif f == 3: row[x] = (row[x] + ((a + up) >> 1)) & 255
            elif f == 4:
                pa, pb, pc = abs(up - c), abs(a - c), abs(a + up - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (up if pb <= pc else c)
                row[x] = (row[x] + pr) & 255
        out.append(row); prev = row
    return w, out


tiles = {}
for f in glob.glob(os.path.join(DEM_DIR, "14_*_*.png")):
    _, x, y = os.path.basename(f)[:-4].split("_")
    tiles[(int(x), int(y))] = read_png(f)[1]
Z = 14; N = 2 ** Z


def elev_px(px, py):
    tx, ty = int(px // 256), int(py // 256)
    row = tiles[(tx, ty)][int(py) % 256]
    x = (int(px) % 256) * 3
    r, g, b = row[x], row[x + 1], row[x + 2]
    return r * 256 + g + b / 256 - 32768


def elev(lat, lon):
    px = (lon + 180) / 360 * N * 256
    r = math.radians(lat)
    py = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * N * 256
    px -= 0.5; py -= 0.5
    x0, y0 = math.floor(px), math.floor(py)
    fx, fy = px - x0, py - y0
    e00, e10 = elev_px(x0, y0), elev_px(x0 + 1, y0)
    e01, e11 = elev_px(x0, y0 + 1), elev_px(x0 + 1, y0 + 1)
    return (e00 * (1 - fx) + e10 * fx) * (1 - fy) + (e01 * (1 - fx) + e11 * fx) * fy


BASE_ELEV = elev(LAT0, LON0)

# terrain grid in local metres
x_min, z_max = proj(BBOX[0], BBOX[1])
x_max, z_min = proj(BBOX[2], BBOX[3])
STEP = 8.0
nx = int((x_max - x_min) / STEP) + 1
nz = int((z_max - z_min) / STEP) + 1
heights = []
for j in range(nz):
    z = z_min + j * STEP
    lat = LAT0 - z / KZ
    for i in range(nx):
        x = x_min + i * STEP
        lon = LON0 + x / KX
        heights.append(round(elev(lat, lon) - BASE_ELEV, 1))


def hgt(x, z):
    fi = min(max((x - x_min) / STEP, 0), nx - 1.001)
    fj = min(max((z - z_min) / STEP, 0), nz - 1.001)
    i, j = int(fi), int(fj); fx, fz = fi - i, fj - j
    h = heights
    a = h[j * nx + i] * (1 - fx) + h[j * nx + i + 1] * fx
    b = h[(j + 1) * nx + i] * (1 - fx) + h[(j + 1) * nx + i + 1] * fx
    return a * (1 - fz) + b * fz


# ---------------------------------------------------------------- OSM
osm = json.load(open(OSM))["elements"]


def ring(geom):
    pts = [proj(p["lat"], p["lon"]) for p in geom if p]
    if len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) < 1e-6 and abs(pts[0][1] - pts[-1][1]) < 1e-6:
        pts = pts[:-1]
    # dedupe consecutive
    clean = []
    for p in pts:
        if not clean or math.hypot(p[0] - clean[-1][0], p[1] - clean[-1][1]) > 0.3:
            clean.append(p)
    return [[round(x, 1), round(z, 1)] for x, z in clean]


def area(r):
    return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2


def outer_rings(e):
    if e["type"] == "way":
        return [ring(e["geometry"])]
    rings = []
    for m in e.get("members", []):
        if m.get("role") == "outer" and m.get("geometry"):
            rings.append(ring(m["geometry"]))
    return rings


def hash01(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


DEFAULT_LEVELS = {"house": 2, "apartments": 15, "residential": 5, "school": 4, "college": 5,
                  "university": 5, "dormitory": 8, "commercial": 4, "retail": 2, "kindergarten": 2}

buildings, roads, areas = [], [], []
ROAD_W = {"motorway": 16, "trunk": 14, "primary": 12, "secondary": 11, "tertiary": 8,
          "residential": 6, "unclassified": 6, "living_street": 5, "service": 4.5,
          "pedestrian": 4, "footway": 2.2, "path": 2, "cycleway": 2.2, "steps": 2.5, "track": 3}

for e in osm:
    t = e.get("tags", {})
    if "building" in t:
        for r in outer_rings(e):
            if len(r) < 3:
                continue
            a = area(r)
            if abs(a) < 12:
                continue
            if a < 0:  # make counter-clockwise in (x,z) -> consistent winding
                r = r[::-1]
            name = t.get("name", "")
            kind = t["building"]
            if "height" in t:
                try: h = float(t["height"].replace("m", ""))
                except ValueError: h = None
            else:
                h = None
            lv = t.get("building:levels")
            try: lv = int(float(lv)) if lv else None
            except ValueError: lv = None
            if lv is None:
                if kind in DEFAULT_LEVELS:
                    lv = DEFAULT_LEVELS[kind]
                else:
                    aa = abs(a)
                    lv = 5 if aa > 2500 else 4 if aa > 800 else 3 if aa > 200 else 2
                    if aa > 800: lv += int(hash01(str(e["id"])) * 3)
            if "정문" in name:
                lv, h = 1, 9.0
            if h is None:
                h = lv * 3.6 + 1.0
            hs = [hgt(x, z) for x, z in r]
            cx = sum(p[0] for p in r) / len(r); cz = sum(p[1] for p in r) / len(r)
            buildings.append({"id": e["id"], "n": name, "k": kind, "lv": max(1, lv), "h": round(h, 1),
                              "b": round(min(hs + [hgt(cx, cz)]), 2), "p": r})
    elif e["type"] == "way" and "highway" in t and e.get("geometry"):
        w = ROAD_W.get(t["highway"])
        if not w:
            continue
        pts = [list(map(lambda v: round(v, 1), proj(p["lat"], p["lon"]))) for p in e["geometry"]]
        roads.append({"w": w, "t": t["highway"], "p": pts})
    elif e["type"] in ("way", "relation") and ("landuse" in t or "leisure" in t or "natural" in t or t.get("amenity") == "parking"):
        k = t.get("landuse") or t.get("leisure") or t.get("natural") or "parking"
        m = {"grass": "grass", "park": "grass", "recreation_ground": "grass", "meadow": "grass",
             "village_green": "grass", "garden": "grass", "golf_course": "grass", "farmland": "farm",
             "orchard": "farm", "forest": "wood", "wood": "wood", "scrub": "wood", "pitch": "pitch",
             "track": "track", "stadium": "pitch", "parking": "parking", "residential": "res",
             "education": "edu", "university": "edu", "construction": "dirt", "water": "water",
             "commercial": "res", "retail": "res", "cemetery": "grass", "playground": "pitch"}.get(k)
        if not m:
            continue
        for r in outer_rings(e):
            if len(r) >= 3:
                areas.append({"k": m, "p": r})

campus = []
for e in osm:
    if e["type"] == "relation" and e["id"] == 11246784:
        campus = outer_rings(e)

# sort areas: large first so small (pitch, parking) draw on top
areas.sort(key=lambda a: -abs(area(a["p"])))

out = {
    "origin": [LAT0, LON0], "baseElev": round(BASE_ELEV, 1),
    "terrain": {"x0": round(x_min, 1), "z0": round(z_min, 1), "step": STEP, "nx": nx, "nz": nz, "h": heights},
    "buildings": buildings, "roads": roads, "areas": areas, "campus": campus,
    "attribution": "© OpenStreetMap contributors (ODbL); terrain: Mapzen/AWS Terrain Tiles",
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print("buildings", len(buildings), "roads", len(roads), "areas", len(areas), "terrain", nx, nz,
      "h range", min(heights), max(heights), "size", os.path.getsize(OUT))
