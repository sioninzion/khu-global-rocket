// Terrain, ground map texture, surrounding hills, trees and sky.
import * as THREE from 'three';
import { pip, makeRng } from './buildings.js';

export class Terrain {
  constructor(t) {
    Object.assign(this, t);
    this.W = (t.nx - 1) * t.step; this.H = (t.nz - 1) * t.step;
    this.x1 = t.x0 + this.W; this.z1 = t.z0 + this.H;
  }
  height(x, z) {
    const fi = Math.min(Math.max((x - this.x0) / this.step, 0), this.nx - 1.001);
    const fj = Math.min(Math.max((z - this.z0) / this.step, 0), this.nz - 1.001);
    const i = fi | 0, j = fj | 0, fx = fi - i, fz = fj - j, h = this.h, nx = this.nx;
    const a = h[j * nx + i] * (1 - fx) + h[j * nx + i + 1] * fx;
    const b = h[(j + 1) * nx + i] * (1 - fx) + h[(j + 1) * nx + i + 1] * fx;
    return a * (1 - fz) + b * fz;
  }
  inside(x, z, m = 0) { return x > this.x0 + m && x < this.x1 - m && z > this.z0 + m && z < this.z1 - m; }
}

const AREA_COL = {
  wood: '#4c6a38', grass: '#84a659', pitch: '#4f9a4a', track: '#b8644a', parking: '#8b8a85',
  res: '#a3a593', edu: '#9aa877', farm: '#a8a668', dirt: '#a58a63', water: '#5c86a8',
};

// draws OSM land use + roads + footprints into a canvas (ground texture & minimap)
export function drawGroundCanvas(data, terrain, size = 2048) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const sx = size / terrain.W, sz = size / terrain.H;
  const X = (x) => (x - terrain.x0) * sx, Z = (z) => (z - terrain.z0) * sz;
  g.fillStyle = '#6e8a50'; g.fillRect(0, 0, size, size);
  const rnd = makeRng(7);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(40,60,20,0.10)' : 'rgba(200,210,150,0.08)';
    const r = 3 + rnd() * 14;
    g.beginPath(); g.arc(rnd() * size, rnd() * size, r, 0, 7); g.fill();
  }
  const poly = (p) => { g.beginPath(); p.forEach(([x, z], i) => i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))); g.closePath(); };
  for (const a of data.areas) {
    g.fillStyle = AREA_COL[a.k] || '#7f9a5a';
    poly(a.p); g.fill();
    if (a.k === 'pitch') { g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5; g.stroke(); }
  }
  g.lineCap = 'round'; g.lineJoin = 'round';
  const minor = new Set(['footway', 'path', 'cycleway', 'steps', 'track', 'pedestrian']);
  const line = (r) => { g.beginPath(); r.p.forEach(([x, z], i) => i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))); };
  for (const r of data.roads) if (minor.has(r.t)) { g.strokeStyle = '#cbbfa8'; g.lineWidth = r.w * sx; line(r); g.stroke(); }
  for (const r of data.roads) if (!minor.has(r.t)) { g.strokeStyle = '#3f4144'; g.lineWidth = (r.w + 1.2) * sx; line(r); g.stroke(); }
  for (const r of data.roads) if (!minor.has(r.t)) { g.strokeStyle = '#56585c'; g.lineWidth = r.w * sx; line(r); g.stroke(); }
  for (const r of data.roads) if (r.w >= 8) {
    g.setLineDash([6 * sx, 6 * sx]); g.strokeStyle = 'rgba(240,210,90,0.8)'; g.lineWidth = 0.35 * sx; line(r); g.stroke(); g.setLineDash([]);
  }
  for (const b of data.buildings) { g.fillStyle = '#5b5852'; poly(b.p); g.fill(); }
  return c;
}

export function buildTerrainMesh(terrain, groundCanvas) {
  const { nx, nz, step, x0, z0, h } = terrain;
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = h[k]; pos[k * 3 + 2] = z0 + j * step;
    uv[k * 2] = i / (nx - 1); uv[k * 2 + 1] = 1 - j / (nz - 1);
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(groundCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
}

// low-detail hills around the mapped area so the world has no visible edge
export function buildOuterGround(terrain) {
  const xs = [], zs = [];
  const ring = [4500, 2500, 1400, 800, 450, 220, 90];
  for (const d of ring) xs.push(terrain.x0 - d);
  for (let i = 0; i < terrain.nx; i++) xs.push(terrain.x0 + i * terrain.step);
  for (const d of ring.slice().reverse()) xs.push(terrain.x1 + d);
  for (const d of ring) zs.push(terrain.z0 - d);
  for (let j = 0; j < terrain.nz; j++) zs.push(terrain.z0 + j * terrain.step);
  for (const d of ring.slice().reverse()) zs.push(terrain.z1 + d);
  const NX = xs.length, NZ = zs.length;
  const pos = new Float32Array(NX * NZ * 3), col = new Float32Array(NX * NZ * 3);
  const c1 = new THREE.Color('#5d7a43'), c2 = new THREE.Color('#41602f'), tmp = new THREE.Color();
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = xs[i], z = zs[j], k = j * NX + i;
    const cx = Math.min(Math.max(x, terrain.x0), terrain.x1), cz = Math.min(Math.max(z, terrain.z0), terrain.z1);
    const d = Math.hypot(x - cx, z - cz);
    let f = Math.min(1, d / 1500); f = f * f * (3 - 2 * f);
    const hill = 35 * Math.sin(x * 0.0021 + 1.3) * Math.cos(z * 0.0017) + 18 * Math.sin(x * 0.006 + z * 0.004) + 25;
    pos[k * 3] = x; pos[k * 3 + 1] = terrain.height(cx, cz) * (1 - f) + hill * f; pos[k * 3 + 2] = z;
    tmp.copy(c1).lerp(c2, 0.5 + 0.5 * Math.sin(x * 0.013) * Math.cos(z * 0.011));
    col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
  }
  const idx = [];
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
    if (xs[i] >= terrain.x0 - 0.01 && xs[i + 1] <= terrain.x1 + 0.01 && zs[j] >= terrain.z0 - 0.01 && zs[j + 1] <= terrain.z1 + 0.01) continue;
    const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

export function buildTrees(data, terrain, city) {
  const rnd = makeRng(42);
  const spots = [];
  const MAX = 4500;
  for (const a of data.areas) {
    const dens = a.k === 'wood' ? 1 / 90 : a.k === 'grass' || a.k === 'edu' ? 1 / 700 : 0;
    if (!dens) continue;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of a.p) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    const n = Math.min(3000, Math.floor((maxx - minx) * (maxz - minz) * dens));
    for (let i = 0; i < n && spots.length < MAX; i++) {
      const x = minx + rnd() * (maxx - minx), z = minz + rnd() * (maxz - minz);
      if (!terrain.inside(x, z, 2) || !pip(a.p, x, z) || city.occupied(x, z)) continue;
      spots.push([x, z]);
    }
  }
  const crown = new THREE.ConeGeometry(1, 1, 7); crown.translate(0, 0.5, 0);
  const trunk = new THREE.CylinderGeometry(0.12, 0.16, 1, 5); trunk.translate(0, 0.5, 0);
  const cm = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
  const tm = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x5a4632 }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const greens = ['#3f6b35', '#4b7a3a', '#365c2e', '#5a8240', '#2f5229'].map(c => new THREE.Color(c));
  spots.forEach(([x, z], i) => {
    const y = terrain.height(x, z), H = 6 + rnd() * 7, R = 1.8 + rnd() * 1.6;
    p.set(x, y + 1.6, z); s.set(R, H, R); m.compose(p, q, s); cm.setMatrixAt(i, m);
    cm.setColorAt(i, greens[Math.floor(rnd() * greens.length)]);
    p.set(x, y - 0.5, z); s.set(1, 2.4, 1); m.compose(p, q, s); tm.setMatrixAt(i, m);
  });
  return [cm, tm];
}

export function buildSky() {
  const geo = new THREE.SphereGeometry(5000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: new THREE.Vector3(0.45, 0.55, -0.7).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 sun; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 top = vec3(0.30,0.52,0.86), hor = vec3(0.80,0.88,0.95), low = vec3(0.62,0.70,0.66);
        vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.6)) : mix(hor, low, -h*5.0);
        float s = max(dot(normalize(vDir), sun), 0.0);
        c += vec3(1.0,0.9,0.7) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}
