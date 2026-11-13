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


def _cr(p0, p1, p2, p3, t):
    return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))


def elev(lat, lon):
    """Catmull-Rom bicubic sample of the terrarium DEM (smooth, no grid facets)."""
    px = (lon + 180) / 360 * N * 256
    r = math.radians(lat)
    py = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * N * 256
    px -= 0.5; py -= 0.5
    x0, y0 = math.floor(px), math.floor(py)
    fx, fy = px - x0, py - y0
    rows = []
    for j in range(-1, 3):
        rows.append(_cr(*(elev_px(x0 + i, y0 + j) for i in range(-1, 3)), fx))
    return _cr(*rows, fy)


BASE_ELEV = elev(LAT0, LON0)

# terrain grid in local metres
x_min, z_max = proj(BBOX[0], BBOX[1])
x_max, z_min = proj(BBOX[2], BBOX[3])
STEP = 4.0
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


# ---------------------------------------------------------------- terrain shaping
# Real campuses are graded: roads follow smooth grades, sports fields and building
# pads are flat, and wooded hills keep small natural bumps. Apply that to the DEM.
import base64, array

H = heights  # flat list nz*nx


def blend_region(x0b, z0b, x1b, z1b, fn):
    """Apply fn(x, z, h) -> (target, weight) to grid vertices in a bbox."""
    i0 = max(0, int((x0b - x_min) / STEP)); i1 = min(nx - 1, int((x1b - x_min) / STEP) + 1)
    j0 = max(0, int((z0b - z_min) / STEP)); j1 = min(nz - 1, int((z1b - z_min) / STEP) + 1)
    for j in range(j0, j1 + 1):
        z = z_min + j * STEP
        for i in range(i0, i1 + 1):
            x = x_min + i * STEP
            k = j * nx + i
            r = fn(x, z, H[k])
            if r:
                t, w = r
                if w > 0:
                    H[k] = H[k] * (1 - w) + t * w


def seg_dist(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    L2 = dx * dx + dz * dz
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / L2))
    qx, qz = ax + dx * t, az + dz * t
    return math.hypot(px - qx, pz - qz), t


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def pip(pts, x, z):
    c = False
    j = len(pts) - 1
    for i in range(len(pts)):
        a, b = pts[i], pts[j]
        if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
        j = i
    return c


def poly_dist(pts, x, z):
    d = min(seg_dist(x, z, pts[i][0], pts[i][1], pts[(i + 1) % len(pts)][0], pts[(i + 1) % len(pts)][1])[0] for i in range(len(pts)))
    return -d if pip(pts, x, z) else d


def bbox(pts):
    xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
    return min(xs), min(zs), max(xs), max(zs)


# 1. natural micro relief on wooded / grassy hills (deterministic value noise)
def vnoise(x, z):
    def h(i, j):
        n = (i * 374761393 + j * 668265263) & 0xFFFFFFFF
        n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
        return (n & 0xFFFF) / 65535.0
    i, j = math.floor(x), math.floor(z)
    fx, fz = x - i, z - j
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz)
    a = h(i, j) * (1 - fx) + h(i + 1, j) * fx
    b = h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx
    return a * (1 - fz) + b * fz


woods = [a["p"] for a in areas if a["k"] == "wood"]
for j in range(nz):
    z = z_min + j * STEP
    for i in range(nx):
        x = x_min + i * STEP
        n = (vnoise(x / 40, z / 40) - 0.5) * 3.0 + (vnoise(x / 13 + 7, z / 13 + 3) - 0.5) * 1.0
        H[j * nx + i] += n

# 2. roads: smooth grade along the centreline, flat across the carriageway
for r in roads:
    pts = r["p"]
    if len(pts) < 2:
        continue
    w = r["w"]
    # densify and smooth heights along the road
    dense = []
    for a, b in zip(pts, pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(L / 3))
        for k in range(n):
            t = k / n
            dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    dense.append(tuple(pts[-1]))
    raw = [hgt(x, z) for x, z in dense]
    win = 6 if w >= 6 else 3
    sm = [sum(raw[max(0, k - win):k + win + 1]) / len(raw[max(0, k - win):k + win + 1]) for k in range(len(raw))]
    inner, outer = w / 2 + 0.8, w / 2 + (7 if w >= 6 else 3.5)
    for k in range(len(dense) - 1):
        (ax, az), (bx, bz) = dense[k], dense[k + 1]
        ha, hb = sm[k], sm[k + 1]

        def fn(x, z, h, ax=ax, az=az, bx=bx, bz=bz, ha=ha, hb=hb):
            d, t = seg_dist(x, z, ax, az, bx, bz)
            if d > outer:
                return None
            return ha + (hb - ha) * t, 1 - smoothstep(inner, outer, d)
        blend_region(min(ax, bx) - outer, min(az, bz) - outer, max(ax, bx) + outer, max(az, bz) + outer, fn)

# 3. flat areas: pitches, tracks, parking
for a in areas:
    if a["k"] not in ("pitch", "track", "parking"):
        continue
    pts = a["p"]
    x0b, z0b, x1b, z1b = bbox(pts)
    samples = [hgt(x0b + (x1b - x0b) * u / 6, z0b + (z1b - z0b) * v / 6) for u in range(7) for v in range(7)
               if pip(pts, x0b + (x1b - x0b) * u / 6, z0b + (z1b - z0b) * v / 6)] or [hgt(*pts[0])]
    target = sum(samples) / len(samples)

    def fn(x, z, h, pts=pts, target=target):
        d = poly_dist(pts, x, z)
        if d > 6:
            return None
        return target, 1 - smoothstep(0.5, 6, d)
    blend_region(x0b - 6, z0b - 6, x1b + 6, z1b + 6, fn)

# 4. building pads: each building sits on a level pad; slopes are cut around it
for b in buildings:
    pts = b["p"]
    x0b, z0b, x1b, z1b = bbox(pts)
    cx = sum(p[0] for p in pts) / len(pts); cz = sum(p[1] for p in pts) / len(pts)
    samples = [hgt(x, z) for x, z in pts] + [hgt(cx, cz)]
    target = sorted(samples)[len(samples) // 2]
    b["b"] = round(target, 2)
    m = 9 if abs(area(pts)) > 400 else 5

    def fn(x, z, h, pts=pts, target=target, m=m):
        d = poly_dist(pts, x, z)
        if d > m:
            return None
        return target, 1 - smoothstep(1.0, m, d)
    blend_region(x0b - m, z0b - m, x1b + m, z1b + m, fn)

terrain_b64 = base64.b64encode(array.array("h", [max(-32768, min(32767, int(round(v * 10)))) for v in H]).tobytes()).decode()

campus = []
for e in osm:
    if e["type"] == "relation" and e["id"] == 11246784:
        campus = outer_rings(e)

# sort areas: large first so small (pitch, parking) draw on top
areas.sort(key=lambda a: -abs(area(a["p"])))

out = {
    "origin": [LAT0, LON0], "baseElev": round(BASE_ELEV, 1),
    "terrain": {"x0": round(x_min, 1), "z0": round(z_min, 1), "step": STEP, "nx": nx, "nz": nz, "h16": terrain_b64},
    "buildings": buildings, "roads": roads, "areas": areas, "campus": campus,
    "attribution": "© OpenStreetMap contributors (ODbL); terrain: Mapzen/AWS Terrain Tiles",
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print("buildings", len(buildings), "roads", len(roads), "areas", len(areas), "terrain", nx, nz,
      "h range", round(min(H), 1), round(max(H), 1), "size", os.path.getsize(OUT))
