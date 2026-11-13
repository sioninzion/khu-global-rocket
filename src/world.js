// Terrain, ground map texture, surrounding hills, trees and sky.
import * as THREE from 'three';
import { pip, makeRng } from './buildings.js?v=32';

export class Terrain {
  constructor(t) {
    Object.assign(this, t);
    if (t.h16) {
      // heights stored as little-endian int16 decimetres, base64-encoded
      const bin = atob(t.h16);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const i16 = new Int16Array(bytes.buffer);
      this.h = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) this.h[i] = i16[i] / 10;
    }
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

// grid sample indices for a given stride (always includes the last row/column)
export function strideIdx(n, stride) {
  const out = [];
  for (let i = 0; i < n - 1; i += stride) out.push(i);
  out.push(n - 1);
  return out;
}

export function buildTerrainMesh(terrain, groundCanvas, stride = 1) {
  const { nx, nz, step, x0, z0, h } = terrain;
  const is = strideIdx(nx, stride), js = strideIdx(nz, stride);
  const NX = is.length, NZ = js.length;
  const pos = new Float32Array(NX * NZ * 3), uv = new Float32Array(NX * NZ * 2);
  for (let b = 0; b < NZ; b++) for (let a = 0; a < NX; a++) {
    const i = is[a], j = js[b], k = b * NX + a;
    pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = h[j * nx + i]; pos[k * 3 + 2] = z0 + j * step;
    uv[k * 2] = i / (nx - 1); uv[k * 2 + 1] = 1 - j / (nz - 1);
  }
  const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
  let o = 0;
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(groundCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position;\nvUp = normal.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying float vUp;
float tHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float tNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  float n = tNoise(vWPos.xz * 0.9) * 0.5 + tNoise(vWPos.xz * 0.23) * 0.35 + tNoise(vWPos.xz * 0.05) * 0.15;
  diffuseColor.rgb *= 0.86 + 0.26 * n;
  // steep cuts (graded slopes, retaining walls, rock) show bare earth and stone
  float steep = smoothstep(0.80, 0.62, vUp);
  vec3 rock = mix(vec3(0.42, 0.38, 0.32), vec3(0.56, 0.54, 0.50), tNoise(vWPos.xz * 0.4 + vWPos.y * 0.3));
  diffuseColor.rgb = mix(diffuseColor.rgb, rock, steep * 0.85);
}`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// low-detail hills around the mapped area so the world has no visible edge
export function buildOuterGround(terrain, stride = 1) {
  const xs = [], zs = [];
  const ring = [4500, 2500, 1400, 800, 450, 220, 90];
  for (const d of ring) xs.push(terrain.x0 - d);
  for (const i of strideIdx(terrain.nx, stride)) xs.push(terrain.x0 + i * terrain.step);
  for (const d of ring.slice().reverse()) xs.push(terrain.x1 + d);
  for (const d of ring) zs.push(terrain.z0 - d);
  for (const j of strideIdx(terrain.nz, stride)) zs.push(terrain.z0 + j * terrain.step);
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

export function buildTrees(data, terrain, city, MAX = 9000) {
  const rnd = makeRng(42);
  const spots = [];
  const areas = data.areas.slice().sort((a, b) => (a.k === 'wood' ? 0 : 1) - (b.k === 'wood' ? 0 : 1));
  for (const a of areas) {
    const dens = a.k === 'wood' ? 1 / 55 : a.k === 'grass' ? 1 / 450 : a.k === 'edu' || a.k === 'res' ? 1 / 900 : 0;
    if (!dens) continue;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of a.p) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    const n = Math.min(6000, Math.floor((maxx - minx) * (maxz - minz) * dens));
    for (let i = 0; i < n && spots.length < MAX; i++) {
      const x = minx + rnd() * (maxx - minx), z = minz + rnd() * (maxz - minz);
      if (!terrain.inside(x, z, 2) || !pip(a.p, x, z) || city.occupied(x, z) || city.occupied(x + 3, z) || city.occupied(x - 3, z) || city.occupied(x, z + 3) || city.occupied(x, z - 3)) continue;
      spots.push([x, z, a.k === 'wood']);
    }
  }
  // deciduous crown: lumpy icosahedron; pine: two stacked cones
  const crown = new THREE.IcosahedronGeometry(1, 1);
  {
    const p = crown.attributes.position, r2 = makeRng(5);
    for (let i = 0; i < p.count; i++) {
      const k = 0.82 + r2() * 0.3;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.9 + 0.95, p.getZ(i) * k);
    }
    crown.computeVertexNormals();
  }
  const pineA = new THREE.ConeGeometry(1, 0.62, 8); pineA.translate(0, 0.55, 0);
  const pineB = new THREE.ConeGeometry(0.72, 0.5, 8); pineB.translate(0, 0.95, 0);
  const pine = mergeGeos([pineA, pineB]);
  const trunk = new THREE.CylinderGeometry(0.1, 0.16, 1, 5); trunk.translate(0, 0.5, 0);
  const decid = [], pines = [];
  for (const s of spots) (rnd() < (s[2] ? 0.42 : 0.25) ? pines : decid).push(s);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const dm = new THREE.InstancedMesh(crown, leafMat, decid.length);
  const pm = new THREE.InstancedMesh(pine, leafMat, pines.length);
  const tm = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x5a4632 }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  // mid-November in Korea: mostly green with autumn yellows, oranges and reds
  const leaf = ['#4a6e36', '#567b3c', '#3f6230', '#6b8440', '#8a8a3a', '#b8902e', '#c46a2a', '#9c3f2a', '#a7742f'].map(c => new THREE.Color(c));
  const leafW = [5, 5, 4, 3, 2, 2, 2, 1, 2];
  const leafPick = () => { let r = rnd() * leafW.reduce((a, b) => a + b, 0); for (let i = 0; i < leaf.length; i++) { r -= leafW[i]; if (r <= 0) return leaf[i]; } return leaf[0]; };
  const pineCol = ['#2f4f2a', '#355a2e', '#2a4426'].map(c => new THREE.Color(c));
  let ti = 0;
  const tmpC = new THREE.Color();
  decid.forEach(([x, z], i) => {
    const y = terrain.height(x, z), H = 7 + rnd() * 7, R = 2.4 + rnd() * 2.2;
    e.set(0, rnd() * 6.3, 0); q.setFromEuler(e);
    p.set(x, y + H * 0.38, z); sc.set(R, H * 0.55, R); m.compose(p, q, sc); dm.setMatrixAt(i, m);
    dm.setColorAt(i, tmpC.copy(leafPick()).multiplyScalar(0.85 + rnd() * 0.3));
    p.set(x, y - 0.3, z); sc.set(1.2, H * 0.6, 1.2); m.compose(p, q, sc); tm.setMatrixAt(ti++, m);
  });
  pines.forEach(([x, z], i) => {
    const y = terrain.height(x, z), H = 9 + rnd() * 9, R = 2.0 + rnd() * 1.4;
    e.set(0, rnd() * 6.3, 0); q.setFromEuler(e);
    p.set(x, y + H * 0.22, z); sc.set(R, H, R); m.compose(p, q, sc); pm.setMatrixAt(i, m);
    pm.setColorAt(i, tmpC.copy(pineCol[Math.floor(rnd() * pineCol.length)]).multiplyScalar(0.85 + rnd() * 0.3));
    p.set(x, y - 0.3, z); sc.set(1, H * 0.4, 1); m.compose(p, q, sc); tm.setMatrixAt(ti++, m);
  });
  tm.count = ti;
  for (const im of [dm, pm]) { im.castShadow = true; im.receiveShadow = true; }
  return [dm, pm, tm];
}

function mergeGeos(list) {
  const pos = [], nor = [];
  for (const g of list) {
    const gi = g.index ? g.toNonIndexed() : g;
    pos.push(...gi.attributes.position.array); nor.push(...gi.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
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
