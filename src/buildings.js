// Buildings: extruded OSM footprints that are pre-fractured into chunks.
// Each footprint is cut by a grid into "pieces" (polygon clipped to a cell) and
// stacked into vertical "layers". A chunk = (piece, layer). Intact buildings are
// drawn from one merged mesh; once hit, a building switches to a mesh rebuilt from
// its surviving chunks, so only the region the rocket hit is taken apart.
import * as THREE from 'three';

const EPS = 1e-3;

export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function area(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[(i + 1) % n];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

function clip(poly, axis, val, keepGreater) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ina = keepGreater ? a[axis] >= val : a[axis] <= val;
    const inb = keepGreater ? b[axis] >= val : b[axis] <= val;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (val - a[axis]) / (b[axis] - a[axis]);
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      p[axis] = val;
      out.push(p);
    }
  }
  return out;
}

export function pip(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

function triangulate(pts) {
  const v = pts.map(p => new THREE.Vector2(p[0], p[1]));
  try { return THREE.ShapeUtils.triangulateShape(v, []); } catch { return []; }
}

// ------------------------------------------------------------ geometry builder
class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; }
  get count() { return this.pos.length / 3; }
  tri(a, b, c, n, ua, ub, uc, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { let t = b; b = c; c = t; t = ub; ub = uc; uc = t; }
    const P = this.pos, N = this.nor, U = this.uv, C = this.col;
    P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) { N.push(n[0], n[1], n[2]); C.push(col.r, col.g, col.b); }
    U.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  wall(p, q, y0, y1, base, floorH, col) {
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const ex = dx / len, ez = dz / len;
    const n = [ez, 0, -ex]; // outward for CCW polygons
    const u0 = (p[0] * ex + p[1] * ez) / 4, u1 = u0 + len / 4;
    const v0 = (y0 - base) / floorH, v1 = (y1 - base) / floorH;
    const a = [p[0], y0, p[1]], b = [q[0], y0, q[1]], c = [q[0], y1, q[1]], d = [p[0], y1, p[1]];
    this.tri(a, b, c, n, [u0, v0], [u1, v0], [u1, v1], col);
    this.tri(a, c, d, n, [u0, v0], [u1, v1], [u0, v1], col);
  }
  cap(pts, tris, y, up, col) {
    const n = up ? [0, 1, 0] : [0, -1, 0];
    for (const t of tris) {
      const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
      this.tri([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], n, [0, 0], [0, 0], [0, 0], col);
    }
  }
}

function toGeometry(parts) {
  // parts: array of GeoBuilder -> one geometry with one group per part
  const total = parts.reduce((s, p) => s + p.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2), col = new Float32Array(total * 3);
  const g = new THREE.BufferGeometry();
  let o = 0;
  parts.forEach((p, i) => {
    pos.set(p.pos, o * 3); nor.set(p.nor, o * 3); col.set(p.col, o * 3); uv.set(p.uv, o * 2);
    g.addGroup(o, p.count, i);
    o += p.count;
  });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------ palettes
const PAL = {
  campus: ['#e2d6c0', '#d6cbb8', '#c48a6c', '#e9e4da', '#cdb99a', '#b8b2a6'],
  apartments: ['#f0ece4', '#e8e2d6', '#f3efe8', '#e4ddcf'],
  house: ['#cfae8c', '#ddd3c2', '#b98f74'],
  other: ['#d8d2c6', '#c9c3b6', '#e0d8c8', '#bfb7a8'],
};
const ROOF = ['#6d7075', '#5f6a63', '#7a7570', '#8a8e90'];
const CONCRETE = new THREE.Color('#8e8880');
const DARK_CONCRETE = new THREE.Color('#6e6963');

export class Building {
  constructor(d, index, inCampus) {
    this.d = d; this.index = index; this.name = d.n; this.kind = d.k;
    const pts = d.p.map(p => [p[0], p[1]]);
    if (area(pts) < 0) pts.reverse();
    this.pts = pts;
    this.base = d.b; this.ybot = d.b - 4; this.ytop = d.b + d.h;
    this.floorH = d.h / d.lv;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    Object.assign(this, { minx, maxx, minz, maxz });
    const r = makeRng(d.id % 2147483647);
    const pal = d.k === 'apartments' ? PAL.apartments : d.k === 'house' ? PAL.house : inCampus ? PAL.campus : PAL.other;
    this.color = new THREE.Color(pal[Math.floor(r() * pal.length)]);
    this.roof = new THREE.Color(ROOF[Math.floor(r() * ROOF.length)]);
    this.nL = Math.max(1, Math.round((this.ytop - this.ybot) / 3.4));
    this.lh = (this.ytop - this.ybot) / this.nL;
    this.damaged = false;
    this.mesh = null;
    this.fracture(r);
  }

  key(ix, iz) { return ix * 4096 + iz; }

  fracture(r) {
    const ar = Math.abs(area(this.pts));
    const cs = ar < 120 ? 3 : ar < 700 ? 4 : 5;
    this.cs = cs;
    this.gx0 = this.minx - r() * cs; this.gz0 = this.minz - r() * cs;
    const nx = Math.ceil((this.maxx - this.gx0) / cs) + 1, nz = Math.ceil((this.maxz - this.gz0) / cs) + 1;
    this.pieces = []; this.cells = new Map();
    for (let ix = 0; ix < nx; ix++) {
      const x0 = this.gx0 + ix * cs, x1 = x0 + cs;
      if (x1 < this.minx || x0 > this.maxx) continue;
      const strip = clip(clip(this.pts, 0, x0, true), 0, x1, false);
      if (strip.length < 3) continue;
      for (let iz = 0; iz < nz; iz++) {
        const z0 = this.gz0 + iz * cs, z1 = z0 + cs;
        const p = clip(clip(strip, 1, z0, true), 1, z1, false);
        if (p.length < 3) continue;
        const a = area(p);
        if (a < 0.3) continue;
        const side = [];
        let cx = 0, cz = 0, pminx = Infinity, pmaxx = -Infinity, pminz = Infinity, pmaxz = -Infinity;
        for (let i = 0; i < p.length; i++) {
          const A = p[i], B = p[(i + 1) % p.length];
          let s = 0;
          if (Math.abs(A[0] - x0) < EPS && Math.abs(B[0] - x0) < EPS) s = 1;
          else if (Math.abs(A[0] - x1) < EPS && Math.abs(B[0] - x1) < EPS) s = 2;
          else if (Math.abs(A[1] - z0) < EPS && Math.abs(B[1] - z0) < EPS) s = 3;
          else if (Math.abs(A[1] - z1) < EPS && Math.abs(B[1] - z1) < EPS) s = 4;
          side.push(s);
          cx += A[0]; cz += A[1];
          pminx = Math.min(pminx, A[0]); pmaxx = Math.max(pmaxx, A[0]);
          pminz = Math.min(pminz, A[1]); pmaxz = Math.max(pmaxz, A[1]);
        }
        const facade = side.some(s => s === 0);
        const idx = this.pieces.length;
        this.pieces.push({ pts: p, side, ix, iz, cx: cx / p.length, cz: cz / p.length,
          pminx, pmaxx, pminz, pmaxz, x0, x1, z0, z1, facade, nb: [], tris: null });
        const k = this.key(ix, iz);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(idx);
      }
    }
    // neighbour pieces across shared cell borders
    const dirs = [[-1, 0, 1], [1, 0, 2], [0, -1, 3], [0, 1, 4]];
    this.pieces.forEach((p, pi) => {
      for (const [dx, dz, s] of dirs) {
        const list = this.cells.get(this.key(p.ix + dx, p.iz + dz));
        if (!list) continue;
        for (const qi of list) {
          const q = this.pieces[qi];
          const ov = dx !== 0
            ? Math.min(p.pmaxz, q.pmaxz) - Math.max(p.pminz, q.pminz)
            : Math.min(p.pmaxx, q.pmaxx) - Math.max(p.pminx, q.pminx);
          const touch = s === 1 ? p.pminx - p.x0 < EPS && q.pmaxx - q.x1 > -EPS
            : s === 2 ? p.x1 - p.pmaxx < EPS && q.x0 - q.pminx > -EPS
            : s === 3 ? p.pminz - p.z0 < EPS && q.pmaxz - q.z1 > -EPS
            : p.z1 - p.pmaxz < EPS && q.z0 - q.pminz > -EPS;
          if (ov > 0.2 && touch) p.nb.push({ q: qi, s });
        }
      }
    });
    this.total = this.pieces.length * this.nL;
    this.alive = new Uint8Array(this.total).fill(1);
    this.aliveCount = this.total;
  }

  // chunk index for a point, -1 if nothing solid there
  hit(x, y, z) {
    if (x < this.minx || x > this.maxx || z < this.minz || z > this.maxz || y < this.ybot || y >= this.ytop) return -1;
    const ix = Math.floor((x - this.gx0) / this.cs), iz = Math.floor((z - this.gz0) / this.cs);
    const list = this.cells.get(this.key(ix, iz));
    if (!list) return -1;
    for (const pi of list) {
      if (pip(this.pieces[pi].pts, x, z)) {
        const l = Math.floor((y - this.ybot) / this.lh);
        const c = pi * this.nL + l;
        return this.alive[c] ? c : -1;
      }
    }
    return -1;
  }

  chunkInfo(c) {
    const p = this.pieces[Math.floor(c / this.nL)], l = c % this.nL;
    return {
      x: (p.pminx + p.pmaxx) / 2, y: this.ybot + (l + 0.5) * this.lh, z: (p.pminz + p.pmaxz) / 2,
      sx: p.pmaxx - p.pminx, sy: this.lh, sz: p.pmaxz - p.pminz,
      color: p.facade ? this.color : CONCRETE,
    };
  }

  // remove chunks within radius R of (x,y,z); returns {killed, fallen}
  blast(x, y, z, R, rand) {
    const killed = [];
    const nL = this.nL;
    for (let pi = 0; pi < this.pieces.length; pi++) {
      const p = this.pieces[pi];
      const dx = p.cx - x, dz = p.cz - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > (R + this.cs) * (R + this.cs)) continue;
      const l0 = Math.max(0, Math.floor((y - R - this.ybot) / this.lh));
      const l1 = Math.min(nL - 1, Math.floor((y + R - this.ybot) / this.lh));
      for (let l = l0; l <= l1; l++) {
        const c = pi * nL + l;
        if (!this.alive[c]) continue;
        const dy = this.ybot + (l + 0.5) * this.lh - y;
        const d = Math.sqrt(d2 + dy * dy);
        // always take out the chunk that was struck (centre within ~4 m of impact)
        if (d < Math.max(R * (0.7 + 0.5 * rand()), 4.2)) { this.alive[c] = 0; killed.push(c); }
      }
    }
    this.aliveCount -= killed.length;
    const fallen = killed.length ? this.collapse() : [];
    return { killed, fallen };
  }

  // chunks no longer connected to the ground fall down
  collapse() {
    const nL = this.nL, np = this.pieces.length, A = this.alive;
    const vis = new Uint8Array(this.total);
    const st = [];
    for (let pi = 0; pi < np; pi++) { const c = pi * nL; if (A[c]) { vis[c] = 1; st.push(c); } }
    while (st.length) {
      const c = st.pop();
      const pi = Math.floor(c / nL), l = c % nL;
      const push = (c2) => { if (A[c2] && !vis[c2]) { vis[c2] = 1; st.push(c2); } };
      if (l + 1 < nL) push(c + 1);
      if (l > 0) push(c - 1);
      for (const nb of this.pieces[pi].nb) push(nb.q * nL + l);
    }
    const fallen = [];
    for (let c = 0; c < this.total; c++) if (A[c] && !vis[c]) { A[c] = 0; fallen.push(c); }
    this.aliveCount -= fallen.length;
    return fallen;
  }

  sideAlive(p, s, l) {
    for (const nb of p.nb) if (nb.s === s && this.alive[nb.q * this.nL + l]) return true;
    return false;
  }

  buildIntact(walls, roofs) {
    const start = walls.count;
    const n = this.pts.length;
    for (let i = 0; i < n; i++) walls.wall(this.pts[i], this.pts[(i + 1) % n], this.ybot, this.ytop, this.base, this.floorH, this.color);
    this.wallRange = [start, walls.count - start];
    const rs = roofs.count;
    roofs.cap(this.pts, triangulate(this.pts), this.ytop, true, this.roof);
    this.roofRange = [rs, roofs.count - rs];
  }

  buildDamagedGeometry() {
    const walls = new GeoBuilder(), plain = new GeoBuilder();
    const nL = this.nL, A = this.alive;
    const tmp = new THREE.Color();
    for (let pi = 0; pi < this.pieces.length; pi++) {
      const p = this.pieces[pi];
      let any = false;
      for (let l = 0; l < nL; l++) if (A[pi * nL + l]) { any = true; break; }
      if (!any) continue;
      if (!p.tris) p.tris = triangulate(p.pts);
      const n = p.pts.length;
      for (let l = 0; l < nL; l++) {
        const c = pi * nL + l;
        if (!A[c]) continue;
        const y0 = this.ybot + l * this.lh, y1 = y0 + this.lh;
        const shade = 0.82 + 0.25 * (((c * 2654435761) >>> 0) % 1000) / 1000;
        tmp.copy(CONCRETE).multiplyScalar(shade);
        for (let i = 0; i < n; i++) {
          const s = p.side[i];
          const a = p.pts[i], b = p.pts[(i + 1) % n];
          if (s === 0) walls.wall(a, b, y0, y1, this.base, this.floorH, this.color);
          else if (!this.sideAlive(p, s, l)) plain.wall(a, b, y0, y1, this.base, this.floorH, tmp);
        }
        if (l === nL - 1) plain.cap(p.pts, p.tris, y1, true, this.roof);
        else if (!A[c + 1]) plain.cap(p.pts, p.tris, y1, true, DARK_CONCRETE);
        if (l > 0 && !A[c - 1]) plain.cap(p.pts, p.tris, y0, false, DARK_CONCRETE);
      }
    }
    return toGeometry([walls, plain]);
  }
}

// ------------------------------------------------------------ window texture
function windowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#e9e9e9'; g.fillRect(0, 118, 128, 10);
  const grd = g.createLinearGradient(0, 28, 0, 96);
  grd.addColorStop(0, '#5a7088'); grd.addColorStop(1, '#2c3a4a');
  g.fillStyle = '#8a8a8a'; g.fillRect(14, 26, 100, 72);
  g.fillStyle = grd; g.fillRect(18, 30, 92, 64);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(18, 30, 92, 10);
  g.fillStyle = '#8a8a8a'; g.fillRect(62, 30, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------ city manager
export class City {
  constructor(data, scene, campusPolys) {
    this.scene = scene;
    const inCampus = (b) => {
      const cx = b.p.reduce((s, p) => s + p[0], 0) / b.p.length, cz = b.p.reduce((s, p) => s + p[1], 0) / b.p.length;
      return campusPolys.some(poly => pip(poly, cx, cz));
    };
    this.buildings = data.buildings.map((d, i) => new Building(d, i, inCampus(d)));
    this.G = 25;
    this.grid = new Map();
    for (const b of this.buildings) {
      for (let gx = Math.floor(b.minx / this.G); gx <= Math.floor(b.maxx / this.G); gx++)
        for (let gz = Math.floor(b.minz / this.G); gz <= Math.floor(b.maxz / this.G); gz++) {
          const k = gx * 100000 + gz;
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(b);
        }
    }
    this.wallMat = new THREE.MeshLambertMaterial({ map: windowTexture(), vertexColors: true });
    this.plainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const walls = new GeoBuilder(), roofs = new GeoBuilder();
    for (const b of this.buildings) b.buildIntact(walls, roofs);
    this.wallMesh = new THREE.Mesh(toGeometry([walls]), this.wallMat);
    this.roofMesh = new THREE.Mesh(toGeometry([roofs]), this.plainMat);
    scene.add(this.wallMesh, this.roofMesh);
    this.totalChunks = this.buildings.reduce((s, b) => s + b.total, 0);
  }

  near(x, z) { return this.grid.get(Math.floor(x / this.G) * 100000 + Math.floor(z / this.G)) || []; }

  hit(x, y, z) {
    for (const b of this.near(x, z)) {
      const c = b.hit(x, y, z);
      if (c >= 0) return { b, c };
    }
    return null;
  }

  // any building footprint at (x,z)? (used for tree placement)
  occupied(x, z) {
    for (const b of this.near(x, z)) if (x >= b.minx && x <= b.maxx && z >= b.minz && z <= b.maxz && pip(b.pts, x, z)) return true;
    return false;
  }

  explode(x, y, z, R, rand) {
    const out = [];
    const seen = new Set();
    for (let gx = Math.floor((x - R - 10) / this.G); gx <= Math.floor((x + R + 10) / this.G); gx++)
      for (let gz = Math.floor((z - R - 10) / this.G); gz <= Math.floor((z + R + 10) / this.G); gz++)
        for (const b of this.grid.get(gx * 100000 + gz) || []) {
          if (seen.has(b)) continue;
          seen.add(b);
          if (x + R < b.minx || x - R > b.maxx || z + R < b.minz || z - R > b.maxz || y - R > b.ytop || y + R < b.ybot) continue;
          const res = b.blast(x, y, z, R, rand);
          if (res.killed.length || res.fallen.length) {
            this.refresh(b);
            out.push({ b, ...res });
          }
        }
    return out;
  }

  hideIntact(b) {
    for (const [mesh, range] of [[this.wallMesh, b.wallRange], [this.roofMesh, b.roofRange]]) {
      const attr = mesh.geometry.attributes.position;
      attr.array.fill(0, range[0] * 3, (range[0] + range[1]) * 3);
      attr.needsUpdate = true;
    }
  }

  refresh(b) {
    if (!b.damaged) { b.damaged = true; this.hideIntact(b); }
    if (b.mesh) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh = null; }
    if (b.aliveCount > 0) {
      b.mesh = new THREE.Mesh(b.buildDamagedGeometry(), [this.wallMat, this.plainMat]);
      this.scene.add(b.mesh);
    }
  }
}
