// Buildings are made of "parts" (wings, towers, columns, entablatures, roof
// structures). Every part is a prism with its own facade style and roof shape,
// and is pre-fractured into chunks: its footprint is cut by a grid into pieces
// and stacked into layers; a chunk = (piece, layer). Intact parts are drawn
// from one merged mesh; once hit, a part switches to a mesh rebuilt from its
// surviving chunks, so only the region the rocket hit is taken apart.
// Ornaments (cornices, parapets, plinths, pilasters, capitals) belong to the
// chunk they sit on and disappear with it.
import * as THREE from 'three';
import { makeFacadeMaterial, WIN } from './facade.js?v=36';

const EPS = 1e-3;

export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function area(p) {
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

// oriented box along the longest edge
export function obb(poly) {
  let best = -1, ux = 1, uz = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) { best = L; ux = (b[0] - a[0]) / L; uz = (b[1] - a[1]) / L; }
  }
  let vx = -uz, vz = ux;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of poly) {
    const u = x * ux + z * uz, v = x * vx + z * vz;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  let hl = (u1 - u0) / 2, hw = (v1 - v0) / 2;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const cx = cu * ux + cv * vx, cz = cu * uz + cv * vz;
  if (hw > hl) { [hl, hw] = [hw, hl]; [ux, uz, vx, vz] = [vx, vz, -ux, -uz]; }
  return { cx, cz, ux, uz, vx, vz, hl, hw };
}

// ------------------------------------------------------------ roofs
function makeRoof(spec, pts) {
  if (!spec || !spec.type || spec.type === 'flat' || !(spec.h > 0)) return { max: 0, fn: () => 0 };
  const o = obb(pts);
  const h = spec.h;
  let ax = o.ux, az = o.uz; // ridge direction
  if (spec.axis) { const L = Math.hypot(spec.axis[0], spec.axis[1]); ax = spec.axis[0] / L; az = spec.axis[1] / L; }
  const px = -az, pz = ax;
  let hwR = 0, hlR = 0;
  for (const [x, z] of pts) {
    hwR = Math.max(hwR, Math.abs((x - o.cx) * px + (z - o.cz) * pz));
    hlR = Math.max(hlR, Math.abs((x - o.cx) * ax + (z - o.cz) * az));
  }
  const cx = spec.center ? spec.center[0] : o.cx, cz = spec.center ? spec.center[1] : o.cz;
  let R = spec.r || 0;
  if (!R) for (const [x, z] of pts) R = Math.max(R, Math.hypot(x - cx, z - cz));
  const fns = {
    gable: (x, z) => h * Math.max(0, 1 - Math.abs((x - o.cx) * px + (z - o.cz) * pz) / hwR),
    hip: (x, z) => {
      const dv = hwR - Math.abs((x - o.cx) * px + (z - o.cz) * pz);
      const du = hlR - Math.abs((x - o.cx) * ax + (z - o.cz) * az);
      return Math.max(0, Math.min(h, (h / hwR) * Math.min(dv, du)));
    },
    pyramid: (x, z) => {
      const dv = hwR - Math.abs((x - o.cx) * px + (z - o.cz) * pz);
      const du = hlR - Math.abs((x - o.cx) * ax + (z - o.cz) * az);
      return Math.max(0, h * Math.min(dv / hwR, du / hlR));
    },
    dome: (x, z) => { const d = Math.hypot(x - cx, z - cz) / R; return d >= 1 ? 0 : h * Math.sqrt(1 - d * d); },
    vault: (x, z) => { const d = Math.abs((x - o.cx) * px + (z - o.cz) * pz) / hwR; return d >= 1 ? 0 : h * Math.sqrt(1 - d * d); },
    bowl: (x, z) => { const d = Math.min(1, Math.hypot(x - cx, z - cz) / R); return h * d * d * (3 - 2 * d); },
  };
  return { max: h, fn: fns[spec.type] || (() => 0) };
}

// ------------------------------------------------------------ geometry builder
// Compact vertex format (~30 bytes/vertex instead of 60) in growable typed arrays,
// so building the city doesn't spike memory on phones.
//   position f32x3, normal i8x3 (normalized), colour u8x3 (normalized),
//   aFac u8x4 (style, floorH*20, bay*20, groundH*20), aFuv f32x2
class GeoBuilder {
  constructor(cap = 4096) {
    this.n = 0; this.cap = cap;
    this.pos = new Float32Array(cap * 3); this.nor = new Int8Array(cap * 3); this.col = new Uint8Array(cap * 3);
    this.fac = new Uint8Array(cap * 4); this.fuv = new Float32Array(cap * 2);
  }
  get count() { return this.n; }
  grow(need) {
    if (need <= this.cap) return;
    let cap = this.cap;
    while (cap < need) cap *= 2;
    const g = (a, k) => { const b = new a.constructor(cap * k); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.nor = g(this.nor, 3); this.col = g(this.col, 3); this.fac = g(this.fac, 4); this.fuv = g(this.fuv, 2);
    this.cap = cap;
  }
  // triangle with true flat normal; winding flipped so the normal agrees with `hint`
  tri(a, b, c, hint, col, fac, ua, ub, uc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-9) return;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { let t = b; b = c; c = t; t = ub; ub = uc; uc = t; nx = -nx; ny = -ny; nz = -nz; }
    const qx = Math.round(nx / L * 127), qy = Math.round(ny / L * 127), qz = Math.round(nz / L * 127);
    const cr = Math.round(Math.min(1, col.r) * 255), cg = Math.round(Math.min(1, col.g) * 255), cb = Math.round(Math.min(1, col.b) * 255);
    const f0 = fac[0], f1 = Math.min(255, Math.round(fac[1] * 20)), f2 = Math.min(255, Math.round(fac[2] * 20)), f3 = Math.min(255, Math.round(fac[3] * 20));
    this.grow(this.n + 3);
    const V = [a, b, c], U = [ua, ub, uc];
    for (let k = 0; k < 3; k++) {
      const i = this.n++;
      this.pos[i * 3] = V[k][0]; this.pos[i * 3 + 1] = V[k][1]; this.pos[i * 3 + 2] = V[k][2];
      this.nor[i * 3] = qx; this.nor[i * 3 + 1] = qy; this.nor[i * 3 + 2] = qz;
      this.col[i * 3] = cr; this.col[i * 3 + 1] = cg; this.col[i * 3 + 2] = cb;
      this.fac[i * 4] = f0; this.fac[i * 4 + 1] = f1; this.fac[i * 4 + 2] = f2; this.fac[i * 4 + 3] = f3;
      this.fuv[i * 2] = U[k][0]; this.fuv[i * 2 + 1] = U[k][1];
    }
  }
  quad(a, b, c, d, hint, col, fac, uv) {
    const Z = [0, 0];
    this.tri(a, b, c, hint, col, fac, uv ? uv[0] : Z, uv ? uv[1] : Z, uv ? uv[2] : Z);
    this.tri(a, c, d, hint, col, fac, uv ? uv[0] : Z, uv ? uv[2] : Z, uv ? uv[3] : Z);
  }
  toGeometry() {
    const n = this.n;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, n * 3), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 3), 3, true));
    g.setAttribute('aFac', new THREE.BufferAttribute(this.fac.slice(0, n * 4), 4, false));
    g.setAttribute('aFuv', new THREE.BufferAttribute(this.fuv.slice(0, n * 2), 2));
    g.computeBoundingSphere();
    // free the builder's scratch arrays right away
    this.pos = this.nor = this.col = this.fac = this.fuv = null;
    return g;
  }
}

const CONCRETE = new THREE.Color('#8e8880');
const DARK_CONCRETE = new THREE.Color('#6e6963');
const PLAIN = [0, 3, 3, 3];

export const DEFAULT_STYLE = {
  wall: '#e6e2d9', trim: '#f1efe9', roof: '#7b8186', win: WIN.GRID, bay: 3.6, floorH: 3.6, groundH: 0,
  cornice: null, parapet: 0, plinth: null, bands: [], pilaster: null, blankAxis: null, minWinEdge: 2.4,
};

export class Building {
  constructor(spec, owner, index) {
    this.owner = owner; this.index = index;
    this.name = owner.name; this.kind = owner.kind;
    const pts = spec.poly.map(p => [p[0], p[1]]);
    if (area(pts) < 0) pts.reverse();
    this.pts = pts;
    const st = this.style = { ...DEFAULT_STYLE, ...(spec.style || {}) };
    this.base = owner.base;
    this.minY = spec.minY || 0;
    this.floating = this.minY > 0.01;
    this.ybot = this.floating ? this.base + this.minY : this.base - 4;
    this.ytop = this.base + this.minY + spec.h;
    this.floorH = st.floorH;
    this.groundH = st.groundH || st.floorH;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    Object.assign(this, { minx, maxx, minz, maxz });
    this.roof = makeRoof(spec.roof, pts);
    this.color = new THREE.Color(st.wall);
    this.trim = new THREE.Color(st.trim);
    this.roofCol = new THREE.Color(spec.roof && spec.roof.color ? spec.roof.color : st.roof);
    this.plinthCol = new THREE.Color(st.plinth && st.plinth.col ? st.plinth.col : st.trim);
    this.nL = Math.max(1, Math.round((this.ytop - this.ybot) / 3.4));
    this.lh = (this.ytop - this.ybot) / this.nL;
    this.supportSpec = spec.supports || null;
    this.supportSpan = spec.supportSpan ?? 7.5;
    this.supportParts = null;
    this.damaged = false;
    this.mesh = null;
    // original edges: window bays are fitted to each wall so windows sit evenly
    this.edges = pts.map((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
      const bays = Math.max(1, Math.round(len / st.bay));
      let blank = len < st.minWinEdge;
      if (st.blankAxis) blank = blank || Math.abs(ux * st.blankAxis[0] + uz * st.blankAxis[1]) > 0.85;
      return { ax: a[0], az: a[1], bx: b[0], bz: b[1], ux, uz, len, bay: len / bays, blank };
    });
    this.fracture(makeRng((owner.id * 31 + index * 7919) % 2147483647 || 1));
  }

  key(ix, iz) { return ix * 4096 + iz; }

  fracture(r) {
    const ar = Math.abs(area(this.pts));
    const cs = ar < 40 ? 2 : ar < 150 ? 3 : ar < 700 ? 4 : 5;
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
        if (a < 0.08) continue;
        const side = [], eid = [];
        let cx = 0, cz = 0, pminx = Infinity, pmaxx = -Infinity, pminz = Infinity, pmaxz = -Infinity;
        for (let i = 0; i < p.length; i++) {
          const A = p[i], B = p[(i + 1) % p.length];
          let s = 0;
          if (Math.abs(A[0] - x0) < EPS && Math.abs(B[0] - x0) < EPS) s = 1;
          else if (Math.abs(A[0] - x1) < EPS && Math.abs(B[0] - x1) < EPS) s = 2;
          else if (Math.abs(A[1] - z0) < EPS && Math.abs(B[1] - z0) < EPS) s = 3;
          else if (Math.abs(A[1] - z1) < EPS && Math.abs(B[1] - z1) < EPS) s = 4;
          side.push(s);
          eid.push(s === 0 ? this.matchEdge(A, B) : -1);
          cx += A[0]; cz += A[1];
          pminx = Math.min(pminx, A[0]); pmaxx = Math.max(pmaxx, A[0]);
          pminz = Math.min(pminz, A[1]); pmaxz = Math.max(pmaxz, A[1]);
        }
        const facade = side.some(s => s === 0);
        const idx = this.pieces.length;
        this.pieces.push({ pts: p, side, eid, ix, iz, cx: cx / p.length, cz: cz / p.length,
          pminx, pmaxx, pminz, pmaxz, x0, x1, z0, z1, facade, nb: [], tris: null });
        const k = this.key(ix, iz);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(idx);
      }
    }
    const dirs = [[-1, 0, 1], [1, 0, 2], [0, -1, 3], [0, 1, 4]];
    this.pieces.forEach((p) => {
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
          if (ov > 0.1 && touch) p.nb.push({ q: qi, s });
        }
      }
    });
    this.total = this.pieces.length * this.nL;
    this.alive = new Uint8Array(this.total).fill(1);
    this.aliveCount = this.total;
  }

  matchEdge(A, B) {
    const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
    let best = 0, bd = Infinity;
    this.edges.forEach((e, i) => {
      const t = (mx - e.ax) * e.ux + (mz - e.az) * e.uz;
      if (t < -0.05 || t > e.len + 0.05) return;
      const d = Math.abs((mx - e.ax) * e.uz - (mz - e.az) * e.ux);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  topAt(x, z) { return this.ytop + (this.roof.max ? this.roof.fn(x, z) : 0); }

  hit(x, y, z) {
    if (x < this.minx || x > this.maxx || z < this.minz || z > this.maxz || y < this.ybot || y >= this.ytop + this.roof.max) return -1;
    if (y >= this.ytop && y >= this.topAt(x, z)) return -1;
    const ix = Math.floor((x - this.gx0) / this.cs), iz = Math.floor((z - this.gz0) / this.cs);
    const list = this.cells.get(this.key(ix, iz));
    if (!list) return -1;
    for (const pi of list) {
      if (pip(this.pieces[pi].pts, x, z)) {
        const l = Math.min(this.nL - 1, Math.floor((y - this.ybot) / this.lh));
        const c = pi * this.nL + l;
        return this.alive[c] ? c : -1;
      }
    }
    return -1;
  }

  topAlive() {
    for (let pi = 0; pi < this.pieces.length; pi++) if (this.alive[pi * this.nL + this.nL - 1]) return true;
    return false;
  }

  chunkInfo(c) {
    const p = this.pieces[Math.floor(c / this.nL)], l = c % this.nL;
    const extra = l === this.nL - 1 ? this.roof.max * 0.5 : 0;
    return {
      x: (p.pminx + p.pmaxx) / 2, y: this.ybot + (l + 0.5) * this.lh + extra * 0.5, z: (p.pminz + p.pmaxz) / 2,
      sx: Math.max(0.3, p.pmaxx - p.pminx), sy: this.lh + extra, sz: Math.max(0.3, p.pmaxz - p.pminz),
      color: p.facade ? this.color : CONCRETE,
    };
  }

  // column = true: a vertical cylinder of radius R wipes out every floor (sky laser)
  // ring = [r0, r1]: earthquake band, knocks out the ground floors of everything in the band
  // line = {ox,oy,oz,dx,dy,dz,len}: a beam of radius R cuts every chunk it passes through
  blast(x, y, z, R, rand, column = false, ring = null, line = null) {
    if (line) return this.beamCut(line, R);
    const killed = [];
    const nL = this.nL;
    for (let pi = 0; pi < this.pieces.length; pi++) {
      const p = this.pieces[pi];
      const dx = p.cx - x, dz = p.cz - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > (R + this.cs) * (R + this.cs)) continue;
      const l0 = column || ring ? 0 : Math.max(0, Math.floor((y - R - this.ybot) / this.lh));
      const l1 = ring ? Math.min(nL - 1, Math.floor((this.base + 7 - this.ybot) / this.lh)) : column ? nL - 1 : Math.min(nL - 1, Math.floor((y + R - this.ybot) / this.lh));
      for (let l = l0; l <= l1; l++) {
        const c = pi * nL + l;
        if (!this.alive[c]) continue;
        if (ring) { if (d2 >= ring[0] * ring[0] && d2 < ring[1] * ring[1]) { this.alive[c] = 0; killed.push(c); } continue; }
        if (column) { if (d2 < R * R) { this.alive[c] = 0; killed.push(c); } continue; }
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

  beamCut(L, R) {
    const killed = [], nL = this.nL;
    const pad = R + this.cs * 0.4;
    for (let pi = 0; pi < this.pieces.length; pi++) {
      const p = this.pieces[pi];
      for (let l = 0; l < nL; l++) {
        const c = pi * nL + l;
        if (!this.alive[c]) continue;
        const cy = this.ybot + (l + 0.5) * this.lh;
        const vx = p.cx - L.ox, vy = cy - L.oy, vz = p.cz - L.oz;
        const t = Math.max(0, Math.min(L.len, vx * L.dx + vy * L.dy + vz * L.dz));
        const ex = vx - L.dx * t, ey = vy - L.dy * t, ez = vz - L.dz * t;
        if (ex * ex + ez * ez < pad * pad && Math.abs(ey) < R + this.lh * 0.5) { this.alive[c] = 0; killed.push(c); }
      }
    }
    this.aliveCount -= killed.length;
    const fallen = killed.length ? this.collapse() : [];
    return { killed, fallen };
  }

  // chunks no longer connected to the ground (or to the part's base) fall down
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

  dropPiece(pi, out) {
    for (let l = 0; l < this.nL; l++) {
      const c = pi * this.nL + l;
      if (this.alive[c]) { this.alive[c] = 0; this.aliveCount--; out.push(c); }
    }
  }

  sideAlive(p, s, l) {
    for (const nb of p.nb) if (nb.s === s && this.alive[nb.q * this.nL + l]) return true;
    return false;
  }

  // ---------------------------------------------------------- geometry
  facFor(e) {
    const st = this.style;
    return [e.blank ? 0 : st.win, this.floorH, e.bay, this.groundH];
  }

  facadeWall(gb, p, i, y0, y1a, y1b) {
    const a = p.pts[i], b = p.pts[(i + 1) % p.pts.length];
    const e = this.edges[p.eid[i]];
    const ua = (a[0] - e.ax) * e.ux + (a[1] - e.az) * e.uz, ub = (b[0] - e.ax) * e.ux + (b[1] - e.az) * e.uz;
    const B = this.base;
    gb.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1b, b[1]], [a[0], y1a, a[1]], [e.uz, 0, -e.ux], this.color, this.facFor(e),
      [[ua, y0 - B], [ub, y0 - B], [ub, y1b - B], [ua, y1a - B]]);
  }

  interiorWall(gb, p, i, y0, y1a, y1b, col) {
    const a = p.pts[i], b = p.pts[(i + 1) % p.pts.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    const B = this.base;
    gb.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1b, b[1]], [a[0], y1a, a[1]], [dz / L, 0, -dx / L], col,
      [WIN.INTERIOR, this.floorH, 3, this.groundH], [[0, y0 - B], [L, y0 - B], [L, y1b - B], [0, y1a - B]]);
  }

  cap(gb, p, yfn, up, col) {
    if (!p.tris) p.tris = triangulate(p.pts);
    const hint = up ? [0, 1, 0] : [0, -1, 0];
    for (const t of p.tris) {
      const a = p.pts[t[0]], b = p.pts[t[1]], c = p.pts[t[2]];
      gb.tri([a[0], yfn(a[0], a[1]), a[1]], [b[0], yfn(b[0], b[1]), b[1]], [c[0], yfn(c[0], c[1]), c[1]], hint, col, PLAIN, [0, 0], [0, 0], [0, 0]);
    }
  }

  // horizontal projecting band along a facade segment (cornice, plinth, string course)
  band(gb, a, b, e, yA, yB, d, col, extA, extB) {
    const nx = e.uz, nz = -e.ux;
    const a0 = [a[0] - e.ux * extA, a[1] - e.uz * extA], b0 = [b[0] + e.ux * extB, b[1] + e.uz * extB];
    const A1 = [a0[0] + nx * d, a0[1] + nz * d], B1 = [b0[0] + nx * d, b0[1] + nz * d];
    gb.quad([A1[0], yA, A1[1]], [B1[0], yA, B1[1]], [B1[0], yB, B1[1]], [A1[0], yB, A1[1]], [nx, 0, nz], col, PLAIN);
    gb.quad([a0[0], yB, a0[1]], [b0[0], yB, b0[1]], [B1[0], yB, B1[1]], [A1[0], yB, A1[1]], [0, 1, 0], col, PLAIN);
    gb.quad([a0[0], yA, a0[1]], [b0[0], yA, b0[1]], [B1[0], yA, B1[1]], [A1[0], yA, A1[1]], [0, -1, 0], col, PLAIN);
  }

  // box sticking out of the wall at position u along edge e (pilaster, capital)
  boxOut(gb, e, u, w, d, yA, yB, col, top) {
    const nx = e.uz, nz = -e.ux;
    const p0 = [e.ax + e.ux * (u - w / 2), e.az + e.uz * (u - w / 2)], p1 = [e.ax + e.ux * (u + w / 2), e.az + e.uz * (u + w / 2)];
    const q0 = [p0[0] + nx * d, p0[1] + nz * d], q1 = [p1[0] + nx * d, p1[1] + nz * d];
    gb.quad([q0[0], yA, q0[1]], [q1[0], yA, q1[1]], [q1[0], yB, q1[1]], [q0[0], yB, q0[1]], [nx, 0, nz], col, PLAIN);
    gb.quad([p0[0], yA, p0[1]], [q0[0], yA, q0[1]], [q0[0], yB, q0[1]], [p0[0], yB, p0[1]], [-e.ux, 0, -e.uz], col, PLAIN);
    gb.quad([p1[0], yA, p1[1]], [q1[0], yA, q1[1]], [q1[0], yB, q1[1]], [p1[0], yB, p1[1]], [e.ux, 0, e.uz], col, PLAIN);
    if (top) gb.quad([p0[0], yB, p0[1]], [p1[0], yB, p1[1]], [q1[0], yB, q1[1]], [q0[0], yB, q0[1]], [0, 1, 0], col, PLAIN);
  }

  ornaments(gb, p, l) {
    if (!p.facade) return;
    const st = this.style;
    const y0 = this.ybot + l * this.lh, y1 = y0 + this.lh;
    const top = l === this.nL - 1;
    const n = p.pts.length;
    for (let i = 0; i < n; i++) {
      if (p.side[i] !== 0) continue;
      const a = p.pts[i], b = p.pts[(i + 1) % n];
      const e = this.edges[p.eid[i]];
      const atA = Math.hypot(a[0] - e.ax, a[1] - e.az) < 0.05, atB = Math.hypot(b[0] - e.bx, b[1] - e.bz) < 0.05;
      if (top && st.cornice) {
        const d = st.cornice.d, h = this.roof.max ? Math.min(st.cornice.h, 0.6) : st.cornice.h;
        this.band(gb, a, b, e, this.ytop - h, this.ytop + 0.05, d, this.trim, atA ? d : 0, atB ? d : 0);
      }
      if (top && st.parapet && !this.roof.max) {
        const ph = st.parapet, nx = e.uz, nz = -e.ux, t = 0.35;
        const yA = this.ytop, yB = this.ytop + ph;
        gb.quad([a[0], yA, a[1]], [b[0], yA, b[1]], [b[0], yB, b[1]], [a[0], yB, a[1]], [nx, 0, nz], this.color, PLAIN);
        const ai = [a[0] - nx * t, a[1] - nz * t], bi = [b[0] - nx * t, b[1] - nz * t];
        gb.quad([ai[0], yA, ai[1]], [bi[0], yA, bi[1]], [bi[0], yB, bi[1]], [ai[0], yB, ai[1]], [-nx, 0, -nz], this.color, PLAIN);
        gb.quad([a[0], yB, a[1]], [b[0], yB, b[1]], [bi[0], yB, bi[1]], [ai[0], yB, ai[1]], [0, 1, 0], this.trim, PLAIN);
      }
      if (st.plinth && !this.floating) {
        const yA = Math.max(y0, this.ybot), yB = Math.min(y1, this.base + st.plinth.h);
        if (yB > yA) this.band(gb, a, b, e, yA, yB, st.plinth.d, this.plinthCol, atA ? st.plinth.d : 0, atB ? st.plinth.d : 0);
      }
      for (const bd of st.bands) {
        const yA = this.base + bd.y, yB = yA + bd.h;
        if (yA >= y0 && yA < y1) this.band(gb, a, b, e, yA, yB, bd.d, this.trim, atA ? bd.d : 0, atB ? bd.d : 0);
      }
      const pl = st.pilaster;
      if (pl && !e.blank) {
        const ua = (a[0] - e.ax) * e.ux + (a[1] - e.az) * e.uz, ub = (b[0] - e.ax) * e.ux + (b[1] - e.az) * e.uz;
        const lo = Math.min(ua, ub), hi = Math.max(ua, ub);
        const sp = e.bay * (pl.every || 1);
        const yA = Math.max(y0, this.base + (pl.from || 0)), yB = Math.min(y1, this.base + (pl.to ?? (this.ytop - this.base)));
        if (yB > yA) {
          for (let k = Math.ceil((lo + 1e-6) / sp); k * sp <= hi + 1e-6; k++) {
            const u = k * sp;
            if (u < pl.w * 0.6 || u > e.len - pl.w * 0.6) continue;
            const capTop = this.base + (pl.to ?? (this.ytop - this.base));
            const hasCap = capTop > y0 && capTop <= y1 + 1e-6;
            this.boxOut(gb, e, u, pl.w, pl.d, yA, hasCap ? capTop - 0.9 : yB, this.trim, false);
            if (hasCap) this.boxOut(gb, e, u, pl.w * 1.45, pl.d * 1.5, capTop - 0.9, capTop, this.trim, true);
          }
        }
      }
    }
  }

  // whole-wall ornaments for an intact flat-roofed part (one band per wall, not per chunk)
  ornamentsWhole(gb) {
    const st = this.style, B = this.base;
    for (const e of this.edges) {
      const a = [e.ax, e.az], b = [e.bx, e.bz];
      if (st.cornice) this.band(gb, a, b, e, this.ytop - st.cornice.h, this.ytop + 0.05, st.cornice.d, this.trim, st.cornice.d, st.cornice.d);
      if (st.parapet) {
        const ph = st.parapet, nx = e.uz, nz = -e.ux, t = 0.35, yA = this.ytop, yB = this.ytop + ph;
        gb.quad([a[0], yA, a[1]], [b[0], yA, b[1]], [b[0], yB, b[1]], [a[0], yB, a[1]], [nx, 0, nz], this.color, PLAIN);
        const ai = [a[0] - nx * t, a[1] - nz * t], bi = [b[0] - nx * t, b[1] - nz * t];
        gb.quad([ai[0], yA, ai[1]], [bi[0], yA, bi[1]], [bi[0], yB, bi[1]], [ai[0], yB, ai[1]], [-nx, 0, -nz], this.color, PLAIN);
        gb.quad([a[0], yB, a[1]], [b[0], yB, b[1]], [bi[0], yB, bi[1]], [ai[0], yB, ai[1]], [0, 1, 0], this.trim, PLAIN);
      }
      if (st.plinth && !this.floating) this.band(gb, a, b, e, this.ybot, B + st.plinth.h, st.plinth.d, this.plinthCol, st.plinth.d, st.plinth.d);
      for (const bd of st.bands) if (B + bd.y > this.ybot && B + bd.y < this.ytop) this.band(gb, a, b, e, B + bd.y, B + bd.y + bd.h, bd.d, this.trim, bd.d, bd.d);
      const pl = st.pilaster;
      if (pl && !e.blank) {
        const sp = e.bay * (pl.every || 1);
        const capTop = B + (pl.to ?? (this.ytop - B));
        const yA = Math.max(this.ybot, B + (pl.from || 0));
        for (let k = 1; k * sp <= e.len + 1e-6; k++) {
          const u = k * sp;
          if (u < pl.w * 0.6 || u > e.len - pl.w * 0.6) continue;
          this.boxOut(gb, e, u, pl.w, pl.d, yA, capTop - 0.9, this.trim, false);
          this.boxOut(gb, e, u, pl.w * 1.45, pl.d * 1.5, capTop - 0.9, capTop, this.trim, true);
        }
      }
    }
  }

  buildIntact(gb) {
    const start = gb.count;
    if (!this.roof.max) {
      // flat roof: one quad per wall and one roof polygon (much lighter than per chunk)
      const B = this.base;
      for (const e of this.edges) {
        gb.quad([e.ax, this.ybot, e.az], [e.bx, this.ybot, e.bz], [e.bx, this.ytop, e.bz], [e.ax, this.ytop, e.az], [e.uz, 0, -e.ux], this.color, this.facFor(e),
          [[0, this.ybot - B], [e.len, this.ybot - B], [e.len, this.ytop - B], [0, this.ytop - B]]);
      }
      const whole = { pts: this.pts, tris: null };
      this.cap(gb, whole, () => this.ytop, true, this.roofCol);
      if (this.floating) this.cap(gb, whole, () => this.ybot, false, this.trim);
      this.ornamentsWhole(gb);
      this.range = [start, gb.count - start];
      return;
    }
    const top = (x, z) => this.topAt(x, z);
    for (const p of this.pieces) {
      const n = p.pts.length;
      for (let i = 0; i < n; i++) {
        if (p.side[i] !== 0) continue;
        const a = p.pts[i], b = p.pts[(i + 1) % n];
        this.facadeWall(gb, p, i, this.ybot, top(a[0], a[1]), top(b[0], b[1]));
      }
      this.cap(gb, p, top, true, this.roofCol);
      if (this.floating) this.cap(gb, p, () => this.ybot, false, this.trim);
      if (p.facade) for (let l = 0; l < this.nL; l++) this.ornaments(gb, p, l);
    }
    this.range = [start, gb.count - start];
  }

  buildDamagedGeometry() {
    const gb = new GeoBuilder();
    const nL = this.nL, A = this.alive;
    const tmp = new THREE.Color();
    for (let pi = 0; pi < this.pieces.length; pi++) {
      const p = this.pieces[pi];
      const n = p.pts.length;
      for (let l = 0; l < nL; l++) {
        const c = pi * nL + l;
        if (!A[c]) continue;
        const y0 = this.ybot + l * this.lh;
        const isTop = l === nL - 1;
        const yt = (x, z) => isTop ? this.topAt(x, z) : y0 + this.lh;
        const shade = 0.82 + 0.25 * (((c * 2654435761) >>> 0) % 1000) / 1000;
        tmp.copy(CONCRETE).multiplyScalar(shade);
        for (let i = 0; i < n; i++) {
          const s = p.side[i];
          const a = p.pts[i], b = p.pts[(i + 1) % n];
          if (s === 0) this.facadeWall(gb, p, i, y0, yt(a[0], a[1]), yt(b[0], b[1]));
          else if (!this.sideAlive(p, s, l)) this.interiorWall(gb, p, i, y0, yt(a[0], a[1]), yt(b[0], b[1]), tmp);
        }
        if (isTop) this.cap(gb, p, yt, true, this.roofCol);
        else if (!A[c + 1]) this.cap(gb, p, yt, true, DARK_CONCRETE);
        if (l > 0 && !A[c - 1]) this.cap(gb, p, () => y0, false, DARK_CONCRETE);
        if (l === 0 && this.floating) this.cap(gb, p, () => y0, false, this.trim);
        this.ornaments(gb, p, l);
      }
    }
    return gb.toGeometry();
  }
}

// ------------------------------------------------------------ city manager
export class City {
  constructor(structures, scene) {
    this.scene = scene;
    this.structures = structures;
    this.buildings = [];
    for (const s of structures) {
      s.parts = s.specs.map((sp, i) => new Building(sp, s, i));
      s.specs.forEach((sp, i) => {
        if (sp.supports) s.parts[i].supportParts = sp.supports.map(k => s.parts[k]).filter(Boolean);
        else if (s.parts[i].floating) s.parts[i].supportBelow = s.parts.filter(q => !q.floating || q.ytop <= s.parts[i].ybot + 0.5).filter(q => q !== s.parts[i]);
      });
      s.total = s.parts.reduce((t, p) => t + p.total, 0);
      this.buildings.push(...s.parts);
    }
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
    this.material = makeFacadeMaterial();
    const gb = new GeoBuilder();
    for (const b of this.buildings) b.buildIntact(gb);
    this.mesh = new THREE.Mesh(gb.toGeometry(), this.material);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.totalChunks = this.buildings.reduce((s, b) => s + b.total, 0);
    this.triangles = gb.count / 3;
  }

  near(x, z) { return this.grid.get(Math.floor(x / this.G) * 100000 + Math.floor(z / this.G)) || []; }

  hit(x, y, z) {
    for (const b of this.near(x, z)) {
      const c = b.hit(x, y, z);
      if (c >= 0) return { b, c };
    }
    return null;
  }

  occupied(x, z) {
    for (const b of this.near(x, z)) if (!b.floating && x >= b.minx && x <= b.maxx && z >= b.minz && z <= b.maxz && pip(b.pts, x, z)) return true;
    return false;
  }

  // pieces of a floating part that lost what holds them up drop (with everything above)
  dropUnsupported(b) {
    const out = [];
    const span2 = b.supportSpan * b.supportSpan;
    const live = b.supportParts ? b.supportParts.filter(s => s.aliveCount > 0 && s.topAlive()) : null;
    for (let pi = 0; pi < b.pieces.length; pi++) {
      if (!b.alive[pi * b.nL]) continue;
      const p = b.pieces[pi];
      let ok;
      if (live) {
        ok = live.some(s => { const dx = (s.minx + s.maxx) / 2 - p.cx, dz = (s.minz + s.maxz) / 2 - p.cz; return dx * dx + dz * dz <= span2; });
      } else {
        ok = b.supportBelow.some(s => s.hit(p.cx, b.ybot - 0.6, p.cz) >= 0)
          || b.pieces.some((q, qi) => qi !== pi && b.alive[qi * b.nL] && Math.abs(q.cx - p.cx) + Math.abs(q.cz - p.cz) < b.cs * 1.5
            && b.supportBelow.some(s => s.hit(q.cx, b.ybot - 0.6, q.cz) >= 0));
      }
      if (!ok) b.dropPiece(pi, out);
    }
    if (out.length) out.push(...b.collapse());
    return out;
  }

  explode(x, y, z, R, rand, column = false, ring = null, line = null) {
    if (line) return this.beam(line, R);
    const out = [];
    const touched = new Set();
    const seen = new Set();
    for (let gx = Math.floor((x - R - 10) / this.G); gx <= Math.floor((x + R + 10) / this.G); gx++)
      for (let gz = Math.floor((z - R - 10) / this.G); gz <= Math.floor((z + R + 10) / this.G); gz++)
        for (const b of this.grid.get(gx * 100000 + gz) || []) {
          if (seen.has(b)) continue;
          seen.add(b);
          if (x + R < b.minx || x - R > b.maxx || z + R < b.minz || z - R > b.maxz || (!column && !ring && (y - R > b.ytop + b.roof.max || y + R < b.ybot))) continue;
          if (ring && b.floating) continue;
          const res = b.blast(x, y, z, R, rand, column, ring);
          if (res.killed.length || res.fallen.length) {
            out.push({ b, ...res });
            touched.add(b.owner);
          }
        }
    // floating parts (entablatures, roofs, penthouses) fall when what holds them is gone
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const s of touched) for (const b of s.parts) {
        if (b.aliveCount === 0 || !(b.supportParts || b.supportBelow)) continue;
        const fallen = this.dropUnsupported(b);
        if (fallen.length) {
          const ex = out.find(r => r.b === b);
          if (ex) ex.fallen.push(...fallen); else out.push({ b, killed: [], fallen });
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (const r of out) this.refresh(r.b);
    return out;
  }

  beam(L, R) {
    const out = [], touched = new Set(), seen = new Set();
    const steps = Math.ceil(L.len / (this.G * 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * L.len;
      const x = L.ox + L.dx * t, z = L.oz + L.dz * t;
      for (let gx = Math.floor((x - R - 6) / this.G); gx <= Math.floor((x + R + 6) / this.G); gx++)
        for (let gz = Math.floor((z - R - 6) / this.G); gz <= Math.floor((z + R + 6) / this.G); gz++)
          for (const b of this.grid.get(gx * 100000 + gz) || []) {
            if (seen.has(b)) continue;
            seen.add(b);
            const res = b.beamCut(L, R);
            if (res.killed.length || res.fallen.length) { out.push({ b, ...res }); touched.add(b.owner); }
          }
    }
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const s of touched) for (const b of s.parts) {
        if (b.aliveCount === 0 || !(b.supportParts || b.supportBelow)) continue;
        const fallen = this.dropUnsupported(b);
        if (fallen.length) { const ex = out.find(r => r.b === b); if (ex) ex.fallen.push(...fallen); else out.push({ b, killed: [], fallen }); changed = true; }
      }
      if (!changed) break;
    }
    for (const r of out) this.refresh(r.b);
    return out;
  }

  hideIntact(b) {
    const attr = this.mesh.geometry.attributes.position;
    attr.array.fill(0, b.range[0] * 3, (b.range[0] + b.range[1]) * 3);
    attr.needsUpdate = true;
  }

  refresh(b) {
    if (!b.damaged) { b.damaged = true; this.hideIntact(b); }
    if (b.mesh) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh = null; }
    if (b.aliveCount > 0) {
      b.mesh = new THREE.Mesh(b.buildDamagedGeometry(), this.material);
      b.mesh.castShadow = true; b.mesh.receiveShadow = true;
      this.scene.add(b.mesh);
    }
  }
}
