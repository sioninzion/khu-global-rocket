import * as THREE from 'three';
import { NIGHT } from './facade.js?v=54';
import { City } from './buildings.js?v=54';
import { buildStructures } from './models.js?v=54';
import { Terrain, drawGroundCanvas, buildTerrainMesh, buildOuterGround, buildTrees, buildSky } from './world.js?v=54';
import { Particles, Debris } from './fx.js?v=54';
import { Input } from './input.js?v=54';
import { Sfx } from './audio.js?v=54';

const $ = (id) => document.getElementById(id);
const setLoad = (t) => { $('loadMsg').textContent = t; };
// yield so the loading text can paint (setTimeout also covers background tabs)
const frame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 60); });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// phones/tablets get a lighter world (fewer triangles, no shadows by default, lower resolution)
const MOBILE = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const Q = MOBILE
  ? { dpr: 1.25, terrainStride: 2, trees: 3000, fire: 700, smoke: 1200, debris: 900, shadows: false, shadowMap: 1024 }
  : { dpr: 1.75, terrainStride: 1, trees: 9000, fire: 1600, smoke: 2600, debris: 1800, shadows: true, shadowMap: 2048 };

// show problems on screen instead of silently hanging
function showError(msg) {
  const el = document.getElementById('loadMsg');
  if (el) el.textContent = '⚠️ ' + msg;
  const t = document.getElementById('title');
  if (t) t.classList.remove('hide');
}
addEventListener('error', (e) => showError('오류: ' + (e.message || e.error)));
addEventListener('unhandledrejection', (e) => showError('오류: ' + (e.reason && e.reason.message || e.reason)));

const SKILL_ICON = { rocket: '🔥', ballistic: '🎯', bomber: '💣', cluster: '💥', nuke: '☢️', airstrike: '🛰️', blackhole: '🌀', quake: '⛏️', laser: '🔴', hunter: '🎯' };
const WEAPON_LABEL = { ballistic: '🎯 탄도미사일', bomber: '💣 폭격 로켓', cluster: '💥 집속탄', nuke: '☢️ 핵폭탄', airstrike: '🛰️ 공중 지원', blackhole: '⚫ 블랙홀 미사일', quake: '🌋 지진탄', laser: '🔴 레이저 미사일', hunter: '🧨 유도 폭격 로켓' };
const KIND = { apartments: '아파트', house: '주택', school: '학교', college: '대학 건물', dormitory: '기숙사', commercial: '상가', retail: '상가', residential: '주거 건물' };

async function main() {
  setLoad('캠퍼스 지도 불러오는 중…');
  const data = await (await fetch('data/campus.json?v=54')).json();
  await frame();

  // ------------------------------------------------------------ renderer / scene
  const dpr = Math.min(window.devicePixelRatio || 1, Q.dpr);
  const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: !MOBILE && dpr < 1.5, powerPreference: 'high-performance' });
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); showError('그래픽 메모리가 부족해요. 새로고침하면 다시 시도해요.'); });
  renderer.setPixelRatio(dpr);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc9dbe8, 350, 2600);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 9000);
  const hemi = new THREE.HemisphereLight(0xe4f0ff, 0x6a7352, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.9);
  const SUN_DIR = new THREE.Vector3(0.45, 0.55, -0.7).normalize();
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sun, sun.target);
  // sun shadows in a box that follows the camera
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  let shadowsOn = Q.shadows;
  try { const v = localStorage.getItem('khu-shadows'); if (v !== null) shadowsOn = v === '1'; } catch { /* ignore */ }
  sun.castShadow = shadowsOn;
  sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
  Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 10, far: 1200 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.5;
  const flash = new THREE.PointLight(0xffa955, 0, 160, 1.2);
  const engineLight = new THREE.PointLight(0xff9a40, 0, 70, 1.6); // rocket exhaust glow (night only)
  scene.add(engineLight);
  let night = false;
  scene.add(flash);
  const sky = buildSky();
  scene.add(sky);

  setLoad('지형 만드는 중…'); await frame();
  const terrain = new Terrain(data.terrain);
  const groundCanvas = drawGroundCanvas(data, terrain);
  scene.add(buildTerrainMesh(terrain, groundCanvas, Q.terrainStride));
  scene.add(buildOuterGround(terrain, Q.terrainStride));

  setLoad('건물 조각내는 중…'); await frame();
  const city = new City(buildStructures(data), scene);
  setLoad('나무 심는 중…'); await frame();
  for (const m of buildTrees(data, terrain, city, Q.trees)) scene.add(m);

  const fire = new Particles(scene, Q.fire, true);
  const smoke = new Particles(scene, Q.smoke, false);
  const debris = new Debris(scene, Q.debris, terrain);
  const input = new Input();
  const sfx = new Sfx();

  // ------------------------------------------------------------ launch pad at the main gate
  const pad = new THREE.Vector3(0, 0, 30);
  for (let i = 0; i < 40 && city.occupied(pad.x, pad.z); i++) pad.z += 3;
  pad.y = terrain.height(pad.x, pad.z);
  const target = new THREE.Vector2(104, 716); // toward 중앙도서관
  const startYaw = Math.atan2(target.x - pad.x, -(target.y - pad.z));
  const padGroup = new THREE.Group();
  const concrete = new THREE.MeshLambertMaterial({ color: 0x9a9894 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5, 1.6, 24), concrete);
  base.position.y = 0.2; padGroup.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.18, 6, 32), new THREE.MeshLambertMaterial({ color: 0xf2c230 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 1.02; padGroup.add(ring);
  const steel = new THREE.MeshLambertMaterial({ color: 0xc23b2b });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.8, 15, 0.8), steel);
  tower.position.set(3.4, 7.5, 0); padGroup.add(tower);
  for (let k = 0; k < 5; k++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.25, 0.25), steel);
    arm.position.set(2.2, 2.5 + k * 3, 0); padGroup.add(arm);
  }
  padGroup.position.copy(pad);
  padGroup.rotation.y = -startYaw;
  scene.add(padGroup);
  const padTop = pad.y + 1.0;

  // ------------------------------------------------------------ craft models (nose along -Z)
  const flameMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(0.32, 1.8, 12); flameGeo.rotateX(Math.PI / 2); flameGeo.translate(0, 0, 0.9);
  function addFlames(group, z, s) {
    const f1 = new THREE.Mesh(flameGeo, flameMat(0xffa040)); f1.position.z = z; f1.scale.setScalar(s);
    const f2 = new THREE.Mesh(flameGeo, flameMat(0xfff2b0)); f2.position.z = z; f2.scale.set(0.55 * s, 0.55 * s, 0.6 * s);
    group.add(f1, f2);
    return [f1, f2];
  }
  function cyl(r0, r1, len, mat, z) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, 18), mat);
    m.rotation.x = Math.PI / 2; m.position.z = z; return m;
  }
  function fins(group, mat, r, z, w, len, t) {
    for (let k = 0; k < 4; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(t, w, len), mat);
      const a = k * Math.PI / 2 + Math.PI / 4;
      fin.position.set(Math.cos(a) * r, Math.sin(a) * r, z);
      fin.rotation.z = a - Math.PI / 2;
      group.add(fin);
    }
  }
  // basic rocket: white body, red nose and fins
  const crafts = {};
  {
    const g = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: 0xf4f4f2 }), red = new THREE.MeshLambertMaterial({ color: 0xc8202f });
    g.add(cyl(0.36, 0.38, 3, white, 0), cyl(0.385, 0.385, 0.45, red, -0.9));
    const noseGeo = new THREE.ConeGeometry(0.36, 1.2, 16); noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, red); nose.position.z = -2.1; g.add(nose);
    fins(g, red, 0.62, 1.15, 0.75, 0.8, 0.06);
    crafts.rocket = { group: g, flames: addFlames(g, 1.5, 1), tail: 2.6, skill: '부스트', name: '기본 로켓' };
  }
  // ballistic missile: 1.8x thicker, olive warhead stage + detachable booster stage
  {
    const g = new THREE.Group();
    const R = 0.36 * 1.8;
    const olive = new THREE.MeshLambertMaterial({ color: 0x5d6647 }), gray = new THREE.MeshLambertMaterial({ color: 0x9a9f94 });
    const black = new THREE.MeshLambertMaterial({ color: 0x23251f }), yellow = new THREE.MeshLambertMaterial({ color: 0xd9b23a });
    g.add(cyl(R, R, 3.6, olive, -0.2), cyl(R + 0.01, R + 0.01, 0.35, yellow, -1.3), cyl(R + 0.01, R + 0.01, 0.2, black, 1.1));
    const noseGeo = new THREE.ConeGeometry(R, 2.0, 18); noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, gray); nose.position.z = -3.0; g.add(nose);
    fins(g, olive, R + 0.18, -1.0, 0.45, 0.9, 0.08); // small canards
    const nozzle = cyl(R * 0.55, R * 0.75, 0.5, black, 1.85); g.add(nozzle);
    const booster = new THREE.Group();
    booster.add(cyl(R * 1.02, R * 1.02, 2.8, gray, 3.0), cyl(R * 1.03, R * 1.03, 0.25, black, 1.75), cyl(R * 0.7, R * 0.85, 0.5, black, 4.55));
    fins(booster, olive, R + 0.5, 3.6, 1.3, 1.6, 0.1);
    const bFlames = addFlames(booster, 4.8, 1.9);
    g.add(booster);
    const flames = addFlames(g, 2.1, 1.5);
    crafts.ballistic = { group: g, flames, booster, bFlames, tail: 4.8, skill: '돌진', name: '탄도미사일' };
  }
  // bomber rocket: same spec as the basic rocket, dark grey with orange bands and bomb racks
  {
    const g = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x4a4e52 }), orange = new THREE.MeshLambertMaterial({ color: 0xe0782a });
    const black = new THREE.MeshLambertMaterial({ color: 0x2b2d2a });
    g.add(cyl(0.36, 0.38, 3, dark, 0), cyl(0.385, 0.385, 0.4, orange, -0.9), cyl(0.385, 0.385, 0.25, orange, 0.6));
    const noseGeo = new THREE.ConeGeometry(0.36, 1.2, 16); noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, orange); nose.position.z = -2.1; g.add(nose);
    fins(g, dark, 0.62, 1.15, 0.75, 0.8, 0.06);
    for (const sx of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 1.2, 3, 8), black);
      pod.rotation.x = Math.PI / 2; pod.position.set(sx * 0.48, -0.25, -0.1); g.add(pod);
    }
    crafts.bomber = { group: g, flames: addFlames(g, 1.5, 1), tail: 2.6, skill: '폭탄', name: '폭격 로켓' };
  }
  // cluster missile: silver body with panel lines and a segmented nose that splits open
  {
    const g = new THREE.Group();
    const R = 0.36 * 1.25;
    const silver = new THREE.MeshLambertMaterial({ color: 0xc9ced3 }), blue = new THREE.MeshLambertMaterial({ color: 0x2f5d9c });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
    g.add(cyl(R, R, 3.2, silver, 0), cyl(R + 0.01, R + 0.01, 0.25, blue, -1.0), cyl(R + 0.01, R + 0.01, 0.25, blue, 0.2), cyl(R + 0.01, R + 0.01, 0.12, dark, -0.4));
    const noseGeo = new THREE.ConeGeometry(R, 1.4, 16); noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, silver); nose.position.z = -2.3; g.add(nose);
    for (let k = 0; k < 4; k++) { // seams of the nose petals
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1.3), dark);
      const a2 = k * Math.PI / 2;
      seam.position.set(Math.cos(a2) * R * 0.55, Math.sin(a2) * R * 0.55, -2.2);
      seam.rotation.set(-Math.sin(a2) * 0.3, Math.cos(a2) * 0.3, 0);
      g.add(seam);
    }
    fins(g, blue, R + 0.25, 1.3, 0.8, 0.9, 0.06);
    crafts.cluster = { group: g, flames: addFlames(g, 1.6, 1.15), tail: 2.8, skill: '분열', name: '집속탄' };
  }
  // nuke: fat white bomb-nosed missile with yellow/black hazard bands
  {
    const g = new THREE.Group();
    const R = 0.36 * 1.7;
    const white = new THREE.MeshLambertMaterial({ color: 0xeeeeea }), yel = new THREE.MeshLambertMaterial({ color: 0xf2c230 });
    const blk = new THREE.MeshLambertMaterial({ color: 0x1e1f1c });
    g.add(cyl(R, R * 0.9, 3.0, white, 0.2), cyl(R + 0.01, R + 0.01, 0.35, yel, -0.6), cyl(R + 0.01, R + 0.01, 0.12, blk, -0.35), cyl(R + 0.01, R + 0.01, 0.12, blk, -0.85));
    const head = new THREE.Mesh(new THREE.SphereGeometry(R, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), white);
    head.rotation.x = -Math.PI / 2; head.position.z = -1.3; head.scale.set(1, 1.6, 1); g.add(head);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.25, 0.08, 6, 20), blk); ring.position.z = 1.55; g.add(ring);
    fins(g, blk, R + 0.3, 1.25, 0.9, 0.9, 0.08);
    crafts.nuke = { group: g, flames: addFlames(g, 1.7, 1.4), tail: 2.9, skill: '기폭', name: '핵폭탄' };
  }
  // air-support rocket: black with a glowing cyan targeting stripe
  {
    const g = new THREE.Group();
    const blk = new THREE.MeshLambertMaterial({ color: 0x22262b }), glow = new THREE.MeshBasicMaterial({ color: 0x5ff3ff });
    g.add(cyl(0.36, 0.38, 3, blk, 0), cyl(0.39, 0.39, 0.18, glow, -0.9), cyl(0.39, 0.39, 0.08, glow, 0.5));
    const noseGeo = new THREE.ConeGeometry(0.36, 1.2, 16); noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, blk); nose.position.z = -2.1; g.add(nose);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow); tip.position.z = -2.68; g.add(tip);
    fins(g, blk, 0.62, 1.15, 0.75, 0.8, 0.06);
    crafts.airstrike = { group: g, flames: addFlames(g, 1.5, 1), tail: 2.6, skill: '부스트', name: '공중 지원' };
  }
  // black-hole missile: matte black with glowing violet rings and a dark sphere warhead
  {
    const g = new THREE.Group();
    const R = 0.36 * 1.3;
    const blk = new THREE.MeshLambertMaterial({ color: 0x15141a }), vio = new THREE.MeshBasicMaterial({ color: 0xb36bff });
    g.add(cyl(R, R, 3.2, blk, 0), cyl(R + 0.02, R + 0.02, 0.1, vio, -1.1), cyl(R + 0.02, R + 0.02, 0.1, vio, -0.6), cyl(R + 0.02, R + 0.02, 0.1, vio, 0.9));
    const orb = new THREE.Mesh(new THREE.SphereGeometry(R * 1.15, 18, 12), new THREE.MeshBasicMaterial({ color: 0x050308 }));
    orb.position.z = -2.0; g.add(orb);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(R * 1.35, 0.05, 6, 24), vio); halo.position.z = -2.0; g.add(halo);
    fins(g, blk, R + 0.25, 1.25, 0.8, 0.9, 0.06);
    crafts.blackhole = { group: g, flames: addFlames(g, 1.6, 1.1), tail: 2.8, skill: '전개', name: '블랙홀 미사일' };
  }
  // earthquake drill missile: bronze body with a spiralled drill nose
  {
    const g = new THREE.Group();
    const R = 0.36 * 1.45;
    const bronze = new THREE.MeshLambertMaterial({ color: 0x8a5a2b }), steel = new THREE.MeshLambertMaterial({ color: 0xb8bcc0 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b2722 }), hazard = new THREE.MeshLambertMaterial({ color: 0xe08a1e });
    g.add(cyl(R, R, 3.0, bronze, 0.1), cyl(R + 0.01, R + 0.01, 0.3, hazard, -0.8), cyl(R + 0.01, R + 0.01, 0.12, dark, 0.7));
    const drillGeo = new THREE.ConeGeometry(R, 1.9, 18); drillGeo.rotateX(-Math.PI / 2);
    const drill = new THREE.Mesh(drillGeo, steel); drill.position.z = -2.35; g.add(drill);
    for (let k = 0; k < 5; k++) { // spiral flutes
      const t = k / 5, rr = R * (1 - t * 0.85);
      const fl = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.045, 5, 18), dark);
      fl.position.z = -1.5 - t * 1.6; fl.rotation.y = 0.35; g.add(fl);
    }
    fins(g, dark, R + 0.25, 1.2, 0.85, 0.9, 0.08);
    crafts.quake = { group: g, flames: addFlames(g, 1.65, 1.2), tail: 2.8, skill: '드릴', name: '지진탄', drill };
  }
  // laser missile: white body, red bands and a glowing emitter lens in the nose
  const LASER_MISSILE_R = 0.45;
  {
    const g = new THREE.Group();
    const R = LASER_MISSILE_R;
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f4 }), red = new THREE.MeshLambertMaterial({ color: 0xc81e4a });
    const glow = new THREE.MeshBasicMaterial({ color: 0xff3355 });
    g.add(cyl(R, R, 3.0, white, 0), cyl(R + 0.01, R + 0.01, 0.2, red, -0.9), cyl(R + 0.01, R + 0.01, 0.2, red, 0.5));
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.7, R, 0.9, 18), white); nose.rotation.x = Math.PI / 2; nose.position.z = -1.95; g.add(nose);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(R * 0.6, 16, 10), glow); lens.position.z = -2.4; g.add(lens);
    fins(g, red, R + 0.25, 1.2, 0.8, 0.85, 0.06);
    crafts.laser = { group: g, flames: addFlames(g, 1.5, 1.1), tail: 2.6, skill: '레이저', name: '레이저 미사일', lens };
  }
  // guided bomber: the bomber's big brother, black-and-orange with four missile rails
  {
    const g = new THREE.Group();
    const R = 0.36 * 1.2;
    const dark = new THREE.MeshLambertMaterial({ color: 0x2f3338 }), orange = new THREE.MeshLambertMaterial({ color: 0xff8a1e });
    const tipM = new THREE.MeshLambertMaterial({ color: 0xd9dde0 });
    g.add(cyl(R, R, 3.2, dark, 0), cyl(R + 0.01, R + 0.01, 0.35, orange, -0.9), cyl(R + 0.01, R + 0.01, 0.2, orange, 0.8));
    const noseGeo = new THREE.ConeGeometry(R, 1.3, 16); noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, orange); nose.position.z = -2.25; g.add(nose);
    for (let k = 0; k < 4; k++) { // missile rails
      const a = k * Math.PI / 2 + Math.PI / 4;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.4, 8), tipM);
      m.rotation.x = Math.PI / 2; m.position.set(Math.cos(a) * (R + 0.16), Math.sin(a) * (R + 0.16), -0.1); g.add(m);
    }
    fins(g, dark, R + 0.25, 1.25, 0.8, 0.9, 0.06);
    crafts.hunter = { group: g, flames: addFlames(g, 1.65, 1.1), tail: 2.8, skill: '탄두', name: '유도 폭격 로켓' };
  }
  for (const c of Object.values(crafts)) { c.group.rotation.order = 'YXZ'; c.group.visible = false; scene.add(c.group); }
  let craft = crafts.rocket;
  craft.group.visible = true; // shown on the pad behind the title screen
  const rocket = { // the craft currently flying (keeps the rest of the code simple)
    get position() { return craft.group.position; },
    get rotation() { return craft.group.rotation; },
    set visible(v) { craft.group.visible = v; },
    get visible() { return craft.group.visible; },
  };
  // falling spent booster stage
  const dropped = { obj: null, vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0 };

  // ------------------------------------------------------------ minimap
  const mini = $('mini'), mg = mini.getContext('2d');
  const MS = 150 * 2; mini.width = mini.height = MS;
  const mscale = Math.min(MS / terrain.W, MS / terrain.H);
  const mox = (MS - terrain.W * mscale) / 2, moz = (MS - terrain.H * mscale) / 2;
  const mX = (x) => mox + (x - terrain.x0) * mscale, mZ = (z) => moz + (z - terrain.z0) * mscale;
  const miniBase = document.createElement('canvas'); miniBase.width = miniBase.height = MS;
  {
    const g = miniBase.getContext('2d');
    g.fillStyle = '#26331d'; g.fillRect(0, 0, MS, MS);
    g.drawImage(groundCanvas, mox, moz, terrain.W * mscale, terrain.H * mscale);
    g.strokeStyle = 'rgba(255,230,120,0.9)'; g.lineWidth = 2;
    for (const poly of data.campus) { g.beginPath(); poly.forEach(([x, z], i) => i ? g.lineTo(mX(x), mZ(z)) : g.moveTo(mX(x), mZ(z))); g.closePath(); g.stroke(); }
  }

  // ------------------------------------------------------------ state
  const S = {
    mode: 'title', t: 0, pos: new THREE.Vector3(), yaw: startYaw, pitch: 1.55, roll: 0, speed: 0,
    fuel: 1, boosting: false, manual: false, score: 0, down: 0, shots: 0, shake: 0,
    boomPos: new THREE.Vector3(), orbit: 0, firstLaunch: true,
  };
  const fwd = new THREE.Vector3(), eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const camLook = new THREE.Vector3(), camPos = new THREE.Vector3(), tmp = new THREE.Vector3();
  const downSet = new Set();
  let baseFov = 62;
  // weapons unlock by total chunks destroyed (remembered on this device)
  const UNLOCKS = { ballistic: 300, bomber: 1200, cluster: 3400, nuke: 7000, airstrike: 12000, blackhole: 20000, quake: 30000, laser: 45000, hunter: 60000 };
  const WBTN = { rocket: 'wRocket', ballistic: 'wBallistic', bomber: 'wBomber', cluster: 'wCluster', nuke: 'wNuke', airstrike: 'wAir', blackhole: 'wBlack', quake: 'wQuake', laser: 'wLaser', hunter: 'wHunter' };
  S.unlocked = { rocket: true, ballistic: false, bomber: false };
  for (const w of Object.keys(UNLOCKS)) { try { S.unlocked[w] = localStorage.getItem('khu-' + w) === '1'; } catch { /* ignore */ } }
  S.weapon = S.nextWeapon = 'rocket';
  function setUnlocked(w) {
    S.unlocked[w] = true;
    try { localStorage.setItem('khu-' + w, '1'); } catch { /* ignore */ }
    $(WBTN[w]).classList.remove('locked');
    const lock = $(WBTN[w]).querySelector('small');
    if (lock) lock.textContent = '';
  }
  function pickWeapon(w) {
    if (!S.unlocked[w]) { toast(`🔒 ${UNLOCKS[w]}조각을 부수면 열려요 (지금 ${S.score}조각)`); return; }
    S.nextWeapon = w;
    for (const k in WBTN) $(WBTN[k]).classList.toggle('on', k === w);
    if (S.mode === 'pad' || S.mode === 'title') { const t = S.t; resetRocket(); S.t = t; }
  }
  for (const w of Object.keys(UNLOCKS)) if (S.unlocked[w]) setUnlocked(w);
  for (const w in WBTN) $(WBTN[w]).addEventListener('click', () => pickWeapon(w));
  function checkUnlocks() {
    let delay = 1600;
    for (const [w, need] of Object.entries(UNLOCKS)) {
      if (!S.unlocked[w] && S.score >= need) {
        setUnlocked(w);
        const msg = { ballistic: '🎯 탄도미사일', bomber: '💣 폭격 로켓', cluster: '💥 집속탄', nuke: '☢️ 핵폭탄', airstrike: '🛰️ 공중 지원', blackhole: '⚫ 블랙홀 미사일', quake: '🌋 지진탄', laser: '🔴 레이저 미사일', hunter: '🧨 유도 폭격 로켓' }[w] + ' 해금! 위에서 고를 수 있어요';
        setTimeout(() => toast(msg, true), delay);
        delay += 2600;
      }
    }
  }
  window.__game = { S, city, terrain, input, camera };

  function resetRocket() {
    S.mode = 'pad'; S.t = 0; S.speed = 0; S.fuel = 1; S.boosting = false; S.manual = false;
    S.yaw = startYaw; S.pitch = 1.55; S.roll = 0;
    S.pos.set(pad.x, padTop + 2.4, pad.z);
    for (const c of Object.values(crafts)) c.group.visible = false;
    craft = crafts[S.nextWeapon];
    S.weapon = S.nextWeapon;
    for (const w of Object.keys(crafts)) document.body.classList.toggle(w, S.weapon === w);
    $('skillName').textContent = craft.skill;
    $('skillIcon').textContent = SKILL_ICON[S.weapon] || '🔥';
    $('skillBadge').classList.toggle('show', S.weapon === 'bomber' || S.weapon === 'hunter');
    if (craft.booster && craft.booster.parent !== craft.group) restoreBooster();
    S.dashed = false; S.dashT = 0; S.prevSkill = false; S.charges = MAX_CHARGES; S.clustered = false; S.drill = false; S.firing = false; S.hCharges = H_MAX; S.hQueue = 0; S.hFired = 0;
    rocket.visible = true;
    setFlames(false);
    S.countdown = S.firstLaunch ? 3 : 1.5;
  }

  function setFlames(on) {
    for (const f of craft.flames) f.visible = on && !(craft.booster && !S.dashed);
    if (craft.bFlames) for (const f of craft.bFlames) f.visible = on && !S.dashed;
  }
  function restoreBooster() {
    if (dropped.obj) { scene.remove(dropped.obj); dropped.obj = null; }
    const b = crafts.ballistic.booster;
    b.position.set(0, 0, 0); b.rotation.set(0, 0, 0);
    crafts.ballistic.group.add(b);
  }
  // ballistic skill: the booster stage drops away and the warhead rushes straight on
  function fireDash() {
    S.dashed = true; S.dashT = 0;
    S.dashDir = computeFwd().clone();
    S.speed = Math.max(S.speed, 70);
    const b = craft.booster;
    scene.attach(b);
    dropped.obj = b; dropped.t = 0;
    dropped.vel.copy(S.dashDir).multiplyScalar(S.speed * 0.35).add(new THREE.Vector3(0, -3, 0));
    dropped.spin.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
    setFlames(true);
    const p = S.pos;
    for (let i = 0; i < 30; i++) {
      tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      fire.spawn(p.x - S.dashDir.x * 3, p.y - S.dashDir.y * 3, p.z - S.dashDir.z * 3, tmp.x * 14, tmp.y * 14, tmp.z * 14, 2.5, 6, 0.4, 1, 0.8, 0.4, 1, 0.9, 0);
    }
    flash.position.copy(p); flash.intensity = 1500;
    S.shake = 1.2;
    sfx.boom(0.45);
  }

  // destroyed-chunk counter: "×1,234", adds up while things keep breaking, fades 1.4 s after the last hit
  let comboN = 0, comboTimer = 0;
  function addCombo(n) {
    comboN += n;
    const el = $('combo');
    el.textContent = `×${comboN.toLocaleString()}`;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop', 'show');
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => { el.classList.remove('show'); comboN = 0; }, 1400);
  }
  function toast(msg, big = false) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('big', big);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  // blow up chunks around p; shared by the rocket itself and by dropped bombs
  // pull = true: black hole, pieces are sucked toward p instead of thrown out (no fireball)
  function blast(p, R, power, hitB, quiet, column = false, pull = false, ring = null, line = null) {
    const big = clamp(R / 12, 0.45, 4);
    const res = city.explode(p.x, p.y, p.z, R, Math.random, column, ring, line);
    // huge blasts: only every k-th chunk becomes a flying piece (keeps phones smooth)
    const total = res.reduce((t, r) => t + r.killed.length + r.fallen.length, 0);
    const every = Math.max(1, Math.ceil(total / 700));
    let idx = 0;
    let killedN = 0, fallenN = 0;
    let main = hitB ? res.find(r => r.b.owner === hitB.owner) : null;
    for (const r of res) {
      if (!main || r.killed.length > main.killed.length && !hitB) main = r;
      for (const c of r.killed) {
        if (idx++ % every) { killedN++; continue; }
        const ci = r.b.chunkInfo(c);
        tmp.set(ci.x - p.x, ci.y - p.y, ci.z - p.z).normalize();
        if (line) { const t = tmp.x * line.dx + tmp.y * line.dy + tmp.z * line.dz; tmp.set(tmp.x - line.dx * t, tmp.y - line.dy * t + 0.4, tmp.z - line.dz * t).normalize(); }
        if (pull) {
          const sw = 8 + Math.random() * 8;
          debris.spawn(ci.x, ci.y, ci.z, ci.sx * 0.9, ci.sy * 0.85, ci.sz * 0.9, -tmp.x * 10 - tmp.z * sw, 4, -tmp.z * 10 + tmp.x * sw, ci.color, 5);
          killedN++;
          continue;
        }
        const sp = 10 + Math.random() * 18 + power * 12;
        debris.spawn(ci.x, ci.y, ci.z, ci.sx * 0.9, ci.sy * 0.85, ci.sz * 0.9,
          tmp.x * sp, tmp.y * sp + 6 + Math.random() * 10, tmp.z * sp, ci.color, 6);
        const fs = 0.4 + Math.random() * 0.9;
        debris.spawn(ci.x, ci.y, ci.z, fs, fs * 0.7, fs, tmp.x * sp * 1.6, 10 + Math.random() * 18, tmp.z * sp * 1.6, ci.color, 14);
        if (killedN % 2 === 0) smoke.spawn(ci.x, ci.y, ci.z, tmp.x * 3, 2, tmp.z * 3, 5, 14, 3 + Math.random() * 2, 0.55, 0.53, 0.5, 0.7, 0.97, 1.5);
        killedN++;
      }
      for (const c of r.fallen) {
        if (idx++ % every) { fallenN++; continue; }
        const ci = r.b.chunkInfo(c);
        debris.spawn(ci.x, ci.y, ci.z, ci.sx * 0.95, ci.sy * 0.95, ci.sz * 0.95,
          (Math.random() - 0.5) * 4, -2 - Math.random() * 3, (Math.random() - 0.5) * 4, ci.color, 1.5);
        if (fallenN % 4 === 0) smoke.spawn(ci.x, Math.max(ci.y - 6, r.b.base + 2), ci.z, (Math.random() - 0.5) * 6, 1, (Math.random() - 0.5) * 6, 7, 22, 4 + Math.random() * 3, 0.62, 0.59, 0.54, 0.6, 0.98, 1);
        fallenN++;
      }
    }
    // fireball
    for (let i = 0; i < (pull || line ? 0 : 55 * big); i++) {
      tmp.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      const sp = (8 + Math.random() * 26) * Math.sqrt(big);
      fire.spawn(p.x, p.y, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp, (5 + Math.random() * 6) * Math.sqrt(big), 8 * big + R, 0.5 + Math.random() * 0.7, 1, 0.75, 0.35, 1, 0.9, 2);
    }
    for (let i = 0; i < (pull || line ? 0 : 40 * Math.min(1, big)); i++) {
      tmp.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5).normalize();
      const sp = 30 + Math.random() * 40;
      fire.spawn(p.x, p.y, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp, 0.6, 0, 0.6 + Math.random() * 0.6, 1, 0.9, 0.5, 1, 0.94, -8);
    }
    for (let i = 0; i < (pull || line ? 0 : 35 * big); i++) {
      tmp.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      const sp = (4 + Math.random() * 10) * Math.sqrt(big);
      const g = 0.18 + Math.random() * 0.15;
      smoke.spawn(p.x, p.y, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp, 6 * Math.sqrt(big), 22 * big + R * 2, 3 + Math.random() * 3, g, g, g, 0.85, 0.96, 3);
    }
    if (!pull && !line) {
      if (!quiet || flash.intensity < 1500) { flash.position.copy(p); flash.intensity = quiet ? 1500 : 4000; }
      sfx.boom(Math.min(1.6, quiet ? 0.35 : 0.7 + power * 0.4 + (big - 1) * 0.3));
    }
    if (fallenN > 15) setTimeout(() => sfx.rumble(), 250);
    S.shake = Math.max(S.shake, quiet ? 0.5 : 1.4 + power + (big - 1) * 1.2);
    const n = killedN + fallenN;
    S.score += n;
    if (n > 0) addCombo(n);
    let downMsg = null;
    for (const s of new Set(res.map(r => r.b.owner))) {
      const alive = s.parts.reduce((t, q) => t + q.aliveCount, 0);
      if (!downSet.has(s) && alive / s.total < 0.15) { downSet.add(s); S.down++; downMsg = `${s.name || KIND[s.kind] || '건물'} 붕괴!`; }
    }
    checkUnlocks();
    updateHud();
    return { n, main, downMsg };
  }

  function explode(hitB) {
    const p = S.pos.clone();
    const power = clamp((S.speed - 50) / 65, 0, 1);
    // ballistic dash: blast keeps growing with speed (capped only to stay playable)
    // ballistic missile: blast radius (m) = impact speed in km/h (as on the HUD) / 23
    let R = S.weapon === 'ballistic' ? (S.speed * 3.6) / 23 : 8 + 6 * power;
    S.boomTime = 3.4; S.boomScale = 1;
    if (S.weapon === 'nuke') { R = NUKE_R; S.boomTime = 7; S.boomScale = 4; startNukeFx(p); }
    const { n, main, downMsg } = blast(p, R, S.weapon === 'nuke' ? 1 : power, hitB, false);
    if (S.weapon === 'airstrike') { startLaser(p); S.boomTime = 5.2; S.boomScale = 1.8; }
    if (S.weapon === 'blackhole') { startBlackHole(p); S.boomTime = BH_TIME + 1.4; S.boomScale = 2.3; }
    if (S.weapon === 'quake') {
      // plain impact: 100 m; drill dive: 0.7x the height it fell
      const qr = S.drill ? Math.max(20, 0.7 * (S.drillY0 - p.y)) : 100;
      startQuake(p, qr); S.boomTime = QUAKE_TIME + 2.5; S.boomScale = 4.2; }
    if (downMsg) toast(downMsg, true);
    S.mode = 'boom'; S.t = 0; S.boomPos.copy(p);
    S.orbit = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
    rocket.visible = false;
    sfx.engine(false);
    S.shots++;
    updateHud();
  }

  // ------------------------------------------------------------ nuke: flash, fireball, shockwave, mushroom cloud
  const NUKE_R = 62;
  const addMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const fireball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), addMat(0xffb060));
  const shock = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 64), addMat(0xfff0d0));
  shock.rotation.x = Math.PI / 2;
  fireball.visible = shock.visible = false;
  scene.add(fireball, shock);
  const nuke = { on: false, t: 0, p: new THREE.Vector3(), gy: 0 };
  function startNukeFx(p) {
    nuke.on = true; nuke.t = 0; nuke.p.copy(p); nuke.gy = terrain.height(p.x, p.z);
    fireball.visible = shock.visible = true;
    fireball.position.copy(p); shock.position.set(p.x, nuke.gy + 2, p.z);
    const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    flash.position.copy(p); flash.intensity = 30000;
    sfx.boom(1.6); setTimeout(() => sfx.rumble(), 300); setTimeout(() => sfx.boom(1.0), 900);
  }
  function updateNuke(dt) {
    if (!nuke.on) return;
    nuke.t += dt;
    const t = nuke.t, p = nuke.p;
    const fr = Math.min(1, t / 1.2);
    fireball.scale.setScalar(8 + 52 * (1 - (1 - fr) * (1 - fr)));
    fireball.position.y = p.y + t * 14;
    fireball.material.opacity = Math.max(0, 1 - t / 3.2);
    fireball.material.color.setHSL(0.08 - Math.min(0.06, t * 0.02), 1, 0.6 - Math.min(0.3, t * 0.08));
    const sr = 20 + t * 170;
    shock.scale.set(sr, sr, sr * 6);
    shock.material.opacity = Math.max(0, 0.9 - t / 2.2);
    S.shake = Math.max(S.shake, t < 2.5 ? 3.5 * (1 - t / 2.5) : 0);
    // mushroom cloud: rising stem and a spreading cap
    if (t < 5.5) {
      const top = nuke.gy + Math.min(150, 30 + t * 38);
      for (let i = 0; i < 6; i++) {
        const h = nuke.gy + Math.random() * (top - nuke.gy) * 0.85;
        const r = 6 + Math.random() * 10;
        const a = Math.random() * 6.28;
        const g = 0.35 + Math.random() * 0.2;
        smoke.spawn(p.x + Math.cos(a) * r, h, p.z + Math.sin(a) * r, Math.cos(a) * 2, 10 + Math.random() * 6, Math.sin(a) * 2, 14, 30, 4 + Math.random() * 3, g + 0.15, g + 0.08, g, 0.75, 0.97, 2);
      }
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * 6.28, r = Math.min(70, 15 + t * 14) * (0.4 + Math.random() * 0.6);
        const g = 0.45 + Math.random() * 0.2;
        smoke.spawn(p.x + Math.cos(a) * r, top + (Math.random() - 0.5) * 18, p.z + Math.sin(a) * r, Math.cos(a) * 8, 3, Math.sin(a) * 8, 22, 40, 5 + Math.random() * 3, g + 0.2, g + 0.1, g, 0.8, 0.97, 1);
      }
      if (t < 2.5) for (let i = 0; i < 6; i++) {
        const a = Math.random() * 6.28;
        fire.spawn(p.x + Math.cos(a) * 10, top - 10, p.z + Math.sin(a) * 10, Math.cos(a) * 12, 8, Math.sin(a) * 12, 16, 20, 1.2, 1, 0.55, 0.2, 0.9, 0.95, 4);
      }
      // ground dust ring pushed out by the shockwave
      if (t < 2.2) for (let i = 0; i < 6; i++) {
        const a = Math.random() * 6.28;
        smoke.spawn(p.x + Math.cos(a) * sr * 0.95, nuke.gy + 2, p.z + Math.sin(a) * sr * 0.95, Math.cos(a) * 25, 2, Math.sin(a) * 25, 10, 25, 2.5, 0.62, 0.57, 0.5, 0.6, 0.96, 1);
      }
    }
    if (t > 7) { nuke.on = false; fireball.visible = shock.visible = false; }
  }

  // ------------------------------------------------------------ laser missile: a beam 4x the missile's radius fired along the heading
  const BEAM_R = LASER_MISSILE_R * 4, BEAM_LEN = 840, BEAM_CUT_R = BEAM_R * 2.2; // drawn at BEAM_R, destroys within BEAM_CUT_R
  const beamGeo2 = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true); beamGeo2.rotateX(Math.PI / 2); beamGeo2.translate(0, 0, -0.5);
  const lzCore = new THREE.Mesh(beamGeo2, addMat(0xffffff)), lzGlow = new THREE.Mesh(beamGeo2, addMat(0xff2a4a));
  lzCore.material.side = lzGlow.material.side = THREE.DoubleSide;
  const lzGroup = new THREE.Group(); lzGroup.add(lzGlow, lzCore); lzGroup.visible = false; scene.add(lzGroup);
  let lzTick = 0;
  function updateBeam(dt) {
    const on = S.mode === 'flight' && S.weapon === 'laser' && S.firing;
    lzGroup.visible = on;
    sfx.beam(on && !S.paused);
    if (!on) { lzTick = 0; return; }
    computeFwd();
    const o = tmp.copy(S.pos).addScaledVector(fwd, 2.6);
    // the beam stops where it meets the ground
    let len = BEAM_LEN;
    for (let t = 4; t < BEAM_LEN; t += 4) {
      const x = o.x + fwd.x * t, y = o.y + fwd.y * t, z = o.z + fwd.z * t;
      if (y < terrain.height(x, z)) { len = t; break; }
    }
    lzGroup.position.copy(o);
    lzGroup.quaternion.copy(craft.group.quaternion);
    const pulse = 0.85 + 0.15 * Math.sin(performance.now() * 0.05);
    lzCore.scale.set(BEAM_R * 0.4 * pulse, BEAM_R * 0.4 * pulse, len);
    lzGlow.scale.set(BEAM_R * pulse, BEAM_R * pulse, len);
    lzCore.material.opacity = 0.95; lzGlow.material.opacity = 0.55;
    S.shake = Math.max(S.shake, 0.35);
    const end = new THREE.Vector3(o.x + fwd.x * len, o.y + fwd.y * len, o.z + fwd.z * len);
    for (let i = 0; i < 3; i++) fire.spawn(end.x, end.y, end.z, (Math.random() - 0.5) * 20, Math.random() * 15, (Math.random() - 0.5) * 20, 2, 3, 0.3, 1, 0.35, 0.4, 1, 0.94, 0);
    lzTick -= dt;
    if (lzTick <= 0) {
      lzTick = 1 / 18; // hits 18 times a second
      const { n, main, downMsg } = blast(o.clone(), BEAM_CUT_R, 0.8, null, true, false, false, null, { ox: o.x, oy: o.y, oz: o.z, dx: fwd.x, dy: fwd.y, dz: fwd.z, len });
      if (downMsg) toast(downMsg, true);
    }
  }

  // ------------------------------------------------------------ guided bomber: each skill press launches a warhead
  // that climbs slowly, picks a random building at least 50 m away (within 90 degrees of the heading) and dives on it.
  // With nothing in that cone it climbs 70 m above the carrier and dives on the nearest building still standing.
  const H_MAX = 4, H_RELOAD = 0.9, H_R = 18, H_MIN = 50, H_MAXD = Infinity, H_HALF = THREE.MathUtils.degToRad(45), H_VMAX = 1000, H_PER_SHOT = 12, H_GAP = 0.04; // 90-degree cone, 12 warheads 0.04 s apart
  const hunters = [];
  const hunterGeo = new THREE.ConeGeometry(0.28, 1.6, 8); hunterGeo.rotateX(-Math.PI / 2);
  const hunterMat = new THREE.MeshLambertMaterial({ color: 0xff8a1e });
  function structCenter(st) {
    let x = 0, z = 0, n = 0;
    for (const b of st.parts) { if (b.aliveCount <= 0) continue; x += (b.minx + b.maxx) / 2; z += (b.minz + b.maxz) / 2; n++; }
    return n ? [x / n, z / n] : null;
  }
  // a random chunk of that building that is still standing (searches every part, not just a few random tries)
  function aimPoint(st) {
    const parts = st.parts.filter(b => b.aliveCount > 0);
    if (!parts.length) return null;
    const solid = parts.filter(b => !b.floating);
    const pool = solid.length ? solid : parts;
    const b = pool[Math.floor(Math.random() * pool.length)];
    let c = Math.floor(Math.random() * b.total);
    for (let i = 0; i < b.total && !b.alive[c]; i++) c = (c + 1) % b.total;
    if (!b.alive[c]) return null;
    const ci = b.chunkInfo(c);
    // never aim below the ground (the lowest floor chunks sit partly underground)
    const v = new THREE.Vector3(ci.x, Math.max(ci.y, terrain.height(ci.x, ci.z) + 2.5), ci.z);
    v.b = b; v.c = c; // remember which chunk, so the warhead can notice when it is already gone
    return v;
  }
  const aimDead = (a) => !a || (a.b && !a.b.alive[a.c]);
  // keep each warhead on something that is still standing: same building if possible, otherwise a new target
  function reaim(h) {
    let a = h.st.parts.some(b => b.aliveCount > 0) ? aimPoint(h.st) : null;
    if (!a) {
      const tg = pickTarget();
      if (tg) { h.st = tg.st; a = aimPoint(tg.st); }
    }
    if (a) h.aim = a;
  }
  function pickTarget() {
    const hx = Math.sin(S.yaw), hz = -Math.cos(S.yaw);
    const inCone = [];
    let nearest = null, nd = Infinity;
    for (const st of city.structures) {
      const c = structCenter(st);
      if (!c) continue;
      if (st.parts.reduce((t, b) => t + b.aliveCount, 0) < st.total * 0.08) continue; // already mostly destroyed
      const dx = c[0] - S.pos.x, dz = c[1] - S.pos.z, d = Math.hypot(dx, dz);
      if (d < nd && d > 30) { nd = d; nearest = st; }
      if (d < H_MIN || d > H_MAXD) continue;
      if (Math.acos(Math.max(-1, Math.min(1, (dx * hx + dz * hz) / d))) <= H_HALF) inCone.push(st);
    }
    if (inCone.length) return { st: inCone[Math.floor(Math.random() * inCone.length)], climb: 50 };
    return nearest ? { st: nearest, climb: 70, fallback: true } : null;
  }
  // one press: a salvo of H_PER_SHOT warheads, H_GAP seconds apart (alternating left/right)
  function fireHunter() {
    const tg = pickTarget();
    if (!tg) return;
    S.hCharges -= 1;
    if (!(S.hQueue > 0)) S.hQTimer = 0;
    S.hQueue = (S.hQueue || 0) + H_PER_SHOT;
  }
  function launchWarhead(k) {
    const tg = pickTarget();
    if (!tg) { S.hQueue = 0; return; }
    computeFwd();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
    const side = 0;
    const mesh = new THREE.Mesh(hunterGeo, hunterMat);
    const p = S.pos.clone().add(new THREE.Vector3(0, -1, 0)).addScaledVector(right, side * 0.8);
    mesh.position.copy(p);
    scene.add(mesh);
    // a slight random scatter so the salvo visibly fans out a little as it leaves
    const sa = Math.random() * Math.PI * 2, sm = 8 + Math.random() * 4;
    // half the salvo climbs twice as high in the same time (50 m vs 100 m; fallback 70 m vs 140 m)
    const cs = k % 2 ? 2 : 1;
    hunters.push({ mesh, p, v: new THREE.Vector3(fwd.x * 8 + Math.cos(sa) * sm, (6 + Math.random() * 2) * cs, fwd.z * 8 + Math.sin(sa) * sm), phase: 'climb', dt: 0, cs,
      vmax: k % H_PER_SHOT === H_PER_SHOT - 1 ? 190 : H_VMAX, // the last warhead of every salvo is capped at 190 m/s
      topY: (tg.fallback ? S.pos.y : p.y) + tg.climb * cs, st: tg.st, aim: aimPoint(tg.st) || S.pos.clone(), t: 0, speed: 20 });
    sfx.boom(0.12);
  }
  function updateHunters(dt) {
    for (let i = hunters.length - 1; i >= 0; i--) {
      const h = hunters[i];
      h.t += dt;
      if (h.phase === 'climb') {
        // slow lift-off straight up to the release height
        h.v.x *= Math.exp(-dt * 1.5); h.v.z *= Math.exp(-dt * 1.5);
        // accelerating lift-off: starts slow and speeds up on the way up
        h.v.y = Math.min(40 * h.cs, h.v.y + 30 * h.cs * dt);
        if (h.p.y >= h.topY || h.t > 8) {
          h.phase = 'dive'; h.dt = 0; h.speed = Math.max(15, h.v.length() * 0.5);
          reaim(h);
        }
      } else {
        // dive: home on the aim point, accelerating
        // accelerating dive: the push grows the longer it flies (slow start, then a sharp rush)
        h.dt += dt;
        h.speed = Math.min(h.vmax, h.speed + (25 + 220 * h.dt) * dt);
        if (aimDead(h.aim)) reaim(h); // its spot was already blown away: pick a standing chunk instead
        const want = tmp.copy(h.aim).sub(h.p).normalize().multiplyScalar(h.speed);
        h.v.lerp(want, Math.min(1, dt * 4));
      }
      const d = h.v.length() * dt, steps = Math.max(1, Math.ceil(d / 0.8));
      let hit = null, done = false;
      for (let k = 0; k < steps && !done; k++) {
        h.p.addScaledVector(h.v, dt / steps);
        const hh = city.hit(h.p.x, h.p.y, h.p.z);
        if (hh) { hit = hh; done = true; }
        else if (h.p.y < terrain.height(h.p.x, h.p.z) + 0.3 || (h.phase === 'dive' && h.p.distanceTo(h.aim) < 2)) done = true;
      }
      h.mesh.position.copy(h.p);
      h.mesh.lookAt(tmp.copy(h.p).add(h.v));
      // trail: 3 puffs per frame, spread along this frame's path; for the first second only 1/4 of that
      const puffs = h.t < 1 ? (Math.random() < 0.75 ? 1 : 0) : 3;
      for (let j = 0; j < puffs; j++) {
        const f = j / 3;
        const tx = h.p.x - h.v.x * dt * f, ty = h.p.y - h.v.y * dt * f, tz = h.p.z - h.v.z * dt * f;
        fire.spawn(tx, ty, tz, -h.v.x * 0.1, -h.v.y * 0.1, -h.v.z * 0.1, h.phase === 'dive' ? 1.6 : 1.0, 1, 0.25, 1, 0.65, 0.25, 1, 0.94, 0);
        smoke.spawn(tx, ty, tz, 0, 0.5, 0, 0.9, 4, 1.6, 0.86, 0.85, 0.83, 0.5, 0.97, 0.4);
      }
      if (done || h.t > 20) {
        scene.remove(h.mesh);
        hunters.splice(i, 1);
        if (!done) continue;
        const { n, main, downMsg } = blast(h.p.clone(), (h.v.length() * 3.6) / 110, 0.7, /* radius (m) = impact speed in km/h / 110 */ hit ? hit.b : null, true);
        if (downMsg) toast(downMsg, true);
      }
    }
  }

  // ------------------------------------------------------------ earthquake: a ground wave knocks out ground floors,
  // so every building it passes loses its footing and collapses on itself
  const QUAKE_R = 210, QUAKE_TIME = 3.4;
  const quake = { on: false, t: 0, x: 0, z: 0, gy: 0, r: 0, n: 0, tick: 0, prev: 0 };
  const quakeRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 96), addMat(0xffb070));
  quakeRing.rotation.x = Math.PI / 2; quakeRing.visible = false; scene.add(quakeRing);
  function startQuake(p, radius) {
    Object.assign(quake, { R: radius, on: true, t: 0, x: p.x, z: p.z, gy: terrain.height(p.x, p.z), r: 0, n: 0, tick: 0, prev: 0 });
    quakeRing.visible = true;
    quakeRing.position.set(p.x, quake.gy + 1.5, p.z);
    for (let i = 0; i < 70; i++) { // dirt thrown up where the drill went in
      tmp.set(Math.random() - 0.5, 1.2 + Math.random(), Math.random() - 0.5).normalize();
      const sp = 15 + Math.random() * 30;
      smoke.spawn(p.x, quake.gy + 1, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp, 5, 16, 3 + Math.random() * 2, 0.45, 0.35, 0.24, 0.85, 0.96, -2);
    }
    sfx.boom(1.2); sfx.rumble(); setTimeout(() => sfx.rumble(), 700); setTimeout(() => sfx.rumble(), 1500); setTimeout(() => sfx.rumble(), 2300);
  }
  function updateQuake(dt) {
    if (!quake.on) return;
    quake.t += dt;
    const t = quake.t;
    const f = Math.min(1, t / QUAKE_TIME);
    quake.r = quake.R * (1 - (1 - f) * (1 - f) * 0.35) * f;
    quakeRing.scale.set(quake.r, quake.r, 60); // thin glowing line on the ground
    quakeRing.material.opacity = 0.7 * (1 - f);
    S.shake = Math.max(S.shake, 2.8 * (1 - f * 0.7));
    // dust wall riding the wave
    const n = MOBILE ? 10 : 20;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, rr = quake.r * (0.96 + Math.random() * 0.06);
      const x = quake.x + Math.cos(a) * rr, z = quake.z + Math.sin(a) * rr;
      if (!terrain.inside(x, z, 2)) continue;
      const g = 0.5 + Math.random() * 0.12;
      smoke.spawn(x, terrain.height(x, z) + 1, z, Math.cos(a) * 6, 4 + Math.random() * 5, Math.sin(a) * 6, 6, 14, 2.6, g, g * 0.88, g * 0.72, 0.75, 0.97, 1);
    }
    quake.tick -= dt;
    if (quake.tick <= 0 && quake.r > quake.prev + 2) {
      quake.tick = 0.18;
      const { n: k, downMsg } = blast(new THREE.Vector3(quake.x, quake.gy, quake.z), quake.r, 0.3, null, true, false, false, [quake.prev, quake.r]);
      quake.n += k;
      quake.prev = quake.r;
      if (downMsg) toast(downMsg, true);
    }
    if (t > QUAKE_TIME) {
      quake.on = false; quakeRing.visible = false;
    }
  }

  // ------------------------------------------------------------ black hole
  // A dark event horizon, a hot Keplerian accretion disk, gravitational lensing of
  // the whole screen around it, tidal "spaghettification" of everything it pulls in,
  // a dimming world and a rising drone; it ends in a collapse and a shockwave.
  // the hole starts small and grows with everything it eats (radius ~ sqrt of swallowed chunks);
  // it lives as long as it keeps feeding, up to BH_MAXLIFE seconds
  const BH_R0 = 22, BH_EAT = 1.7, BH_RMAX = 170, BH_TIME = 5.0, BH_MAXLIFE = 16;
  const bh = { on: false, t: 0, p: new THREE.Vector3(), n: 0, tick: 0, r: 0, core: 0, lens: 0, gy: 0 };
  const bhCore = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
  const diskMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uInner: { value: 1.25 }, uOuter: { value: 3.6 }, uFade: { value: 1 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime, uInner, uOuter, uFade; varying vec2 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float r = length(vP); float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
        float a = atan(vP.y, vP.x);
        float w = uTime * 2.6 / pow(max(r, 0.5), 1.5);         // inner orbits spin faster (Kepler)
        float s = a + w;
        float bands = n2(vec2(t * 14.0, s * 2.0)) * 0.6 + n2(vec2(t * 40.0, s * 6.0)) * 0.4;
        vec3 hot = vec3(1.0, 0.97, 0.9), mid = vec3(1.0, 0.62, 0.22), cool = vec3(0.65, 0.18, 0.08);
        vec3 col = mix(hot, mid, smoothstep(0.0, 0.35, t)); col = mix(col, cool, smoothstep(0.35, 1.0, t));
        float doppler = 0.55 + 0.75 * (0.5 + 0.5 * sin(a));    // approaching side looks brighter
        float alpha = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.65, 1.0, t)) * (0.45 + 0.75 * bands) * doppler * uFade;
        gl_FragColor = vec4(col * (1.4 - t), alpha);
      }`,
  });
  const bhDisk = new THREE.Mesh(new THREE.RingGeometry(1.25, 3.6, 128, 4), diskMat);
  const bhShock = new THREE.Mesh(new THREE.TorusGeometry(1, 0.04, 6, 64), addMat(0xc59bff));
  bhShock.rotation.x = Math.PI / 2; bhShock.visible = false; scene.add(bhShock);
  const bhGroup = new THREE.Group(); bhGroup.add(bhCore, bhDisk); bhGroup.visible = false; scene.add(bhGroup);
  const bhHemi = { base: hemi.intensity, sun: sun.intensity };
  window.__bhHemi = bhHemi;
  function startBlackHole(p) {
    Object.assign(bh, { on: true, t: 0, n: 0, tick: 0, r: 0, lens: 0, shockT: -1, life: BH_TIME, step: 1 });
    bh.p.copy(p);
    bh.gy = terrain.height(p.x, p.z);
    bh.p.y = Math.max(p.y, bh.gy + 6);
    bhGroup.position.copy(bh.p); bhGroup.visible = true; bhGroup.scale.setScalar(1);
    debris.attract = { x: bh.p.x, y: bh.p.y, z: bh.p.z, k: 0 };
    sfx.drone(true);
  }
  function updateBlackHole(dt) {
    // shockwave after the collapse
    if (bh.shockT >= 0) {
      bh.shockT += dt;
      const r = 10 + bh.shockT * 220;
      bhShock.scale.set(r, r, r * 4);
      bhShock.material.opacity = Math.max(0, 1 - bh.shockT / 1.3);
      if (bh.shockT > 1.3) { bh.shockT = -1; bhShock.visible = false; }
    }
    // the world brightens back after the collapse
    if (!bh.on) {
      hemi.intensity += (bhHemi.base - hemi.intensity) * Math.min(1, dt * 2);
      sun.intensity += (bhHemi.sun - sun.intensity) * Math.min(1, dt * 2);
      bh.lens = Math.max(0, bh.lens - dt * 3);
      return;
    }
    bh.t += dt;
    const t = bh.t;
    // sink toward the ground so whole buildings fall in
    bh.p.y += (bh.gy + 18 - bh.p.y) * Math.min(1, dt * 1.2);
    bhGroup.position.copy(bh.p);
    if (debris.attract) debris.attract.y = bh.p.y;
    const grow = Math.min(1, t / 1.6);
    const g3 = grow * grow * (3 - 2 * grow);
    const want = Math.min(BH_RMAX, (BH_R0 + BH_EAT * Math.sqrt(bh.n)) * g3);
    bh.r += (want - bh.r) * Math.min(1, dt * 2.5);
    S.boomScale = Math.max(2.3, bh.r / 24);
    if (bh.r > 40 + bh.step * 20) bh.step++;
    bh.core = 1.2 + bh.r * 0.14;
    bh.lens = g3;
    bhCore.scale.setScalar(bh.core);
    bhDisk.scale.setScalar(bh.core);
    bhDisk.rotation.set(Math.PI / 2 - 0.22, 0, 0); // nearly edge-on: lensing bends the far side over the top
    diskMat.uniforms.uTime.value = t;
    debris.attract.k = 180 + bh.r * 7;
    S.shake = Math.max(S.shake, 0.4 + grow * 0.9);
    // light itself is being swallowed
    hemi.intensity = bhHemi.base * (1 - 0.45 * g3);
    sun.intensity = bhHemi.sun * (1 - 0.5 * g3);
    sfx.droneLevel(g3);
    // gas spiralling in along the disk plane, and dust swirling off the ground
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.28, rr = bh.core * (2.4 + Math.random() * 2.5);
      const x = bh.p.x + Math.cos(a) * rr, z = bh.p.z + Math.sin(a) * rr, y = bh.p.y + (Math.random() - 0.5) * bh.core * 0.3;
      const sp = 18 + bh.r * 0.5;
      fire.spawn(x, y, z, (-Math.cos(a) * 0.5 - Math.sin(a) * 1.4) * sp, 0, (-Math.sin(a) * 0.5 + Math.cos(a) * 1.4) * sp, 1.1, -0.9, 0.6, 1, 0.6, 0.25, 0.9, 0.985, 0);
    }
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * 6.28, rr = bh.r * (0.6 + Math.random() * 0.9) + 8;
      const x = bh.p.x + Math.cos(a) * rr, z = bh.p.z + Math.sin(a) * rr;
      const sp = 10 + bh.r * 0.3;
      smoke.spawn(x, terrain.height(x, z) + 1.5, z, (-Math.cos(a) * 0.6 - Math.sin(a)) * sp, 4 + Math.random() * 6, (-Math.sin(a) * 0.6 + Math.cos(a)) * sp, 5, 6, 2.2, 0.42, 0.39, 0.36, 0.7, 0.985, 3);
    }
    if (t < bh.life) {
      bh.tick -= dt;
      if (bh.tick <= 0) {
        bh.tick = 0.3;
        const { n, downMsg } = blast(bh.p.clone(), Math.max(4, bh.r), 0.5, null, true, false, true);
        bh.n += n;
        if (n > 0) bh.life = Math.min(BH_MAXLIFE, Math.max(bh.life, t + 1.8)); // still feeding: stay alive
        if (downMsg) toast(downMsg, true);
      }
    } else {
      // collapse: the horizon shrinks to nothing, then a violet shockwave and flash
      const c = Math.max(0, 1 - (t - bh.life) / 0.45);
      bhGroup.scale.setScalar(Math.max(0.001, c * c));
      bh.lens = c;
      if (c === 0 && bhGroup.visible) {
        bhGroup.visible = false;
        debris.attract = null;
        sfx.drone(false);
        flash.position.copy(bh.p); flash.intensity = 14000;
        bhShock.position.copy(bh.p); bhShock.visible = true; bh.shockT = 0;
        for (let i = 0; i < 160; i++) {
          tmp.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).normalize();
          fire.spawn(bh.p.x, bh.p.y, bh.p.z, tmp.x * 95, tmp.y * 95, tmp.z * 95, 3, 8, 1.0, 0.8, 0.55, 1, 1, 0.93, 0);
        }
        sfx.boom(1.4);
        S.shake = 3.2;
        bh.on = false;
      }
    }
  }

  // ------------------------------------------------------------ screen-space gravitational lensing (only while a black hole exists)
  const lensRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: MOBILE ? 0 : 4 });
  const lensMat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: lensRT.texture }, uCenter: { value: new THREE.Vector2() }, uRs: { value: 0 }, uAspect: { value: 1 }, uK: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D tScene; uniform vec2 uCenter; uniform float uRs, uAspect, uK; varying vec2 vUv;
      void main(){
        vec2 d = vUv - uCenter; d.x *= uAspect;
        float r = max(length(d), 1e-5);
        vec2 dir = d / r;
        // light passing close to the hole is bent toward it (thin-lens Schwarzschild approximation)
        float defl = uK * 2.6 * uRs * uRs / r;
        vec2 off = dir * min(defl, r * 0.98); off.x /= uAspect;
        vec3 col = texture2D(tScene, vUv - off).rgb;
        // photon ring and the shadow of the event horizon
        float ring = exp(-pow((r - uRs * 1.55) / (uRs * 0.07 + 1e-4), 2.0)) * uK;
        col += vec3(1.0, 0.82, 0.55) * ring * 0.9;
        col *= mix(1.0, smoothstep(uRs * 0.98, uRs * 1.12, r), uK);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  const lensScene = new THREE.Scene();
  const lensCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const lensQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lensMat);
  lensQuad.frustumCulled = false; lensScene.add(lensQuad);
  const projV = new THREE.Vector3();
  function renderFrame() {
    if (bh.lens > 0.01 && bhGroup.visible !== undefined) {
      projV.copy(bh.p).project(camera);
      const dist = camera.position.distanceTo(bh.p);
      if (projV.z < 1 && dist > bh.core * 1.5) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        if (lensRT.width !== size.x || lensRT.height !== size.y) lensRT.setSize(size.x, size.y);
        lensMat.uniforms.uCenter.value.set(projV.x * 0.5 + 0.5, projV.y * 0.5 + 0.5);
        lensMat.uniforms.uAspect.value = size.x / size.y;
        lensMat.uniforms.uRs.value = (bh.core * Math.max(0.05, bhGroup.scale.x)) / dist / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
        lensMat.uniforms.uK.value = bh.lens;
        renderer.setRenderTarget(lensRT);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        renderer.render(lensScene, lensCam);
        return;
      }
    }
    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------ air support: a beam from the sky erases everything inside it
  const LASER_R = 25;
  const beam = new THREE.Group();
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true); beamGeo.translate(0, 0.5, 0);
  const beamCore = new THREE.Mesh(beamGeo, addMat(0xffffff)), beamGlow = new THREE.Mesh(beamGeo, addMat(0x48d8ff));
  beamCore.material.side = beamGlow.material.side = THREE.DoubleSide;
  const beamRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 48), addMat(0x8ff0ff)); beamRing.rotation.x = Math.PI / 2;
  beam.add(beamGlow, beamCore, beamRing); beam.visible = false; scene.add(beam);
  const laser = { on: false, t: 0, x: 0, z: 0, gy: 0, n: 0, tick: 0, r: 0 };
  function startLaser(p) {
    Object.assign(laser, { on: true, t: 0, x: p.x, z: p.z, gy: terrain.height(p.x, p.z), n: 0, tick: 0, r: 0 });
    beam.position.set(p.x, laser.gy, p.z); beam.visible = false;
  }
  function updateLaser(dt) {
    if (!laser.on) return;
    laser.t += dt;
    const t = laser.t - 0.7; // short targeting delay, then the beam drops
    if (t < 0) return;
    beam.visible = true;
    const H = 700;
    const drop = Math.min(1, t / 0.35); // beam front coming down from the sky
    const fade = t > 3.0 ? Math.max(0, 1 - (t - 3.0) / 0.6) : 1;
    laser.r = LASER_R * Math.min(1, 0.25 + t / 0.9);
    const pulse = 0.9 + 0.1 * Math.sin(t * 40);
    beamCore.scale.set(laser.r * 0.35 * pulse, H * drop, laser.r * 0.35 * pulse);
    beamGlow.scale.set(laser.r * pulse, H * drop, laser.r * pulse);
    beamCore.position.y = beamGlow.position.y = H * (1 - drop);
    beamRing.scale.setScalar(laser.r * (1.1 + 0.1 * Math.sin(t * 9)));
    beamRing.position.y = 1.5;
    beamCore.material.opacity = 0.95 * fade; beamGlow.material.opacity = 0.45 * fade; beamRing.material.opacity = 0.9 * fade;
    if (drop >= 1 && t < 3.0) {
      if (t - dt * 1.01 < 0.35) { sfx.boom(1.2); setTimeout(() => sfx.rumble(), 100); flash.position.set(laser.x, laser.gy + 30, laser.z); flash.intensity = 12000; }
      S.shake = Math.max(S.shake, 1.6);
      laser.tick -= dt;
      if (laser.tick <= 0) {
        laser.tick = 0.12;
        const { n, downMsg } = blast(new THREE.Vector3(laser.x, laser.gy, laser.z), laser.r, 1, null, true, true);
        laser.n += n;
        if (downMsg) toast(downMsg, true);
      }
      for (let i = 0; i < 10; i++) { // vaporised material and sparks
        const a = Math.random() * 6.28, r = Math.random() * laser.r;
        fire.spawn(laser.x + Math.cos(a) * r, laser.gy + Math.random() * 60, laser.z + Math.sin(a) * r, Math.cos(a) * 4, 20 + Math.random() * 30, Math.sin(a) * 4, 1.5, 3, 0.7, 0.6, 0.95, 1, 1, 0.95, 0);
      }
      const a = Math.random() * 6.28;
      smoke.spawn(laser.x + Math.cos(a) * laser.r, laser.gy + 2, laser.z + Math.sin(a) * laser.r, Math.cos(a) * 10, 6, Math.sin(a) * 10, 8, 20, 3, 0.5, 0.5, 0.52, 0.7, 0.96, 2);
    }
    if (t > 3.6) {
      laser.on = false; beam.visible = false;
    }
  }

  // ------------------------------------------------------------ bomber: flare-style bomb salvos
  const bombGeo = new THREE.CapsuleGeometry(0.28, 0.7, 3, 8); bombGeo.rotateX(Math.PI / 2);
  const bombMat = new THREE.MeshLambertMaterial({ color: 0x3b3f36 });
  const bombs = [];
  // reload 1.5x faster (2.2s -> ~1.47s); bomb power x4: destroyed volume grows with R^3, so radius 7 -> 11
  const BOMBS_PER_SALVO = 6, MAX_CHARGES = 3, CHARGE_TIME = 2.2 / 1.5, BOMB_R = 11;
  // cluster missile submunitions
  const CLUSTER_N = 18, SUB_R = 10, SUB_R_GROW = 7 * 2 / 3, SUB_R_MAX = 30; // radius grows ~4.7 m per second of flight
  const subGeo = new THREE.ConeGeometry(0.16, 0.9, 6); subGeo.rotateX(-Math.PI / 2);
  const subMat = new THREE.MeshLambertMaterial({ color: 0xd9dde0 });
  function dropSalvo() {
    computeFwd();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
    for (let i = 0; i < BOMBS_PER_SALVO; i++) {
      const side = i % 2 ? 1 : -1, k = Math.floor(i / 2);
      bombs.push({
        delay: i * 0.07, live: false, t: 0,
        side, spread: 5 + k * 4 + Math.random() * 2,
        mesh: null, pos: new THREE.Vector3(), vel: new THREE.Vector3(), right,
      });
    }
    S.charges -= 1;
    sfx.boom(0.15);
  }
  function releaseBomb(b) {
    b.live = true;
    b.pos.copy(S.pos).addScaledVector(fwd, -1.2).add(new THREE.Vector3(0, -0.6, 0));
    b.vel.copy(fwd).multiplyScalar(S.speed * 0.55).addScaledVector(b.right, b.side * b.spread).add(new THREE.Vector3(0, -2 - Math.random() * 3, 0));
    b.kind = 'bomb'; b.R = BOMB_R;
    b.mesh = new THREE.Mesh(bombGeo, bombMat);
    b.mesh.position.copy(b.pos);
    scene.add(b.mesh);
  }
  // cluster missile skill: the missile bursts and fans out submunitions over a wide area
  function fireCluster() {
    S.clustered = true;
    const f = computeFwd().clone();
    const up0 = Math.abs(f.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const a = new THREE.Vector3().crossVectors(f, up0).normalize(), bb = new THREE.Vector3().crossVectors(a, f).normalize();
    const v0 = Math.max(S.speed, 45) * 0.8;
    for (let i = 0; i < CLUSTER_N; i++) {
      const inner = i < 6;
      const ang = (inner ? i / 6 : (i - 6) / (CLUSTER_N - 6)) * Math.PI * 2 + (inner ? 0.5 : 0) + Math.random() * 0.25;
      const spread = (inner ? 9 : 20) + Math.random() * 6;
      const vel = f.clone().multiplyScalar(v0 * (0.8 + Math.random() * 0.35))
        .addScaledVector(a, Math.cos(ang) * spread).addScaledVector(bb, Math.sin(ang) * spread).add(new THREE.Vector3(0, 4, 0));
      const mesh = new THREE.Mesh(subGeo, subMat);
      mesh.position.copy(S.pos);
      scene.add(mesh);
      bombs.push({ kind: 'sub', live: true, delay: 0, t: 0, pos: S.pos.clone(), vel, mesh, R: SUB_R, v0: vel.length() });
    }
    const p = S.pos;
    for (let i = 0; i < 40; i++) {
      tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      fire.spawn(p.x, p.y, p.z, tmp.x * 18, tmp.y * 18, tmp.z * 18, 2.5, 5, 0.45, 1, 0.85, 0.5, 1, 0.9, 0);
      smoke.spawn(p.x, p.y, p.z, tmp.x * 6, tmp.y * 6, tmp.z * 6, 3, 10, 2.5, 0.8, 0.8, 0.78, 0.7, 0.95, 0.5);
    }
    flash.position.copy(p); flash.intensity = 2000;
    S.shake = 1.0;
    sfx.boom(0.5);
    rocket.visible = false;
    sfx.engine(false);
    S.mode = 'cluster'; S.t = 0;
    S.clusterN = 0; S.clusterHits = 0; S.clusterDone = 0; S.clusterSum = new THREE.Vector3();
    S.clusterDir = f; S.clusterFrom = p.clone();
  }
  function endCluster() {
    const c = S.clusterDone ? S.clusterSum.clone().divideScalar(S.clusterDone) : S.pos.clone();
    S.mode = 'boom'; S.t = 0; S.boomPos.copy(c);
    S.orbit = Math.atan2(camera.position.x - c.x, camera.position.z - c.z);
    S.shots++;
    updateHud();
  }
  function subCentroid(out) {
    let n = 0;
    out.set(0, 0, 0);
    for (const b of bombs) if (b.kind === 'sub') { out.add(b.pos); n++; }
    return n ? out.divideScalar(n) : null;
  }

  function updateBombs(dt) {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      if (!b.live) {
        b.delay -= dt;
        if (b.delay <= 0 && S.mode === 'flight') releaseBomb(b);
        else if (S.mode !== 'flight') bombs.splice(i, 1);
        continue;
      }
      b.t += dt;
      if (b.kind === 'sub') {
        // mini rockets: burn for a moment, then arc down onto their own target area
        // constant speed (gravity only bends the path); the warhead grows stronger the longer it flies
        b.vel.y -= 11 * dt;
        b.vel.setLength(b.v0);
        b.R = Math.min(SUB_R_MAX, SUB_R + SUB_R_GROW * b.t);
        fire.spawn(b.pos.x, b.pos.y, b.pos.z, -b.vel.x * 0.1, -b.vel.y * 0.1, -b.vel.z * 0.1, 1.1 + b.R * 0.06, 0.8, 0.22, 1, 0.7 - Math.min(0.4, b.t * 0.12), 0.3, 1, 0.94, 0);
        b.mesh.scale.setScalar(1 + Math.min(1.5, b.t * 0.5));
        smoke.spawn(b.pos.x, b.pos.y, b.pos.z, (Math.random() - 0.5), 0.5, (Math.random() - 0.5), 0.7, 3.5, 1.6, 0.9, 0.9, 0.88, 0.5, 0.97, 0.3);
      } else {
        b.vel.y -= 16 * dt;
        b.vel.multiplyScalar(Math.exp(-dt * 0.8)); // flares lose speed fast and drop behind
        // bright flare trail
        fire.spawn(b.pos.x, b.pos.y, b.pos.z, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, 1.4, 1.2, 0.35, 1, 0.85, 0.5, 1, 0.94, 0);
        if (Math.random() < 0.5) smoke.spawn(b.pos.x, b.pos.y, b.pos.z, 0, 0.6, 0, 0.8, 4, 1.4, 0.82, 0.8, 0.78, 0.45, 0.97, 0.4);
      }
      const d = b.vel.length() * dt, steps = Math.max(1, Math.ceil(d / 0.8));
      let hit = null, done = false;
      for (let k = 0; k < steps && !done; k++) {
        b.pos.addScaledVector(b.vel, dt / steps);
        const h = city.hit(b.pos.x, b.pos.y, b.pos.z);
        if (h) { hit = h; done = true; }
        else if (b.pos.y < terrain.height(b.pos.x, b.pos.z) + 0.2) done = true;
        else if (!terrain.inside(b.pos.x, b.pos.z, 5) || b.t > 10) { scene.remove(b.mesh); bombs.splice(i, 1); b.mesh = null; if (b.kind === 'sub') S.clusterDone++; break; }
      }
      if (!b.mesh) continue;
      b.mesh.position.copy(b.pos);
      b.mesh.lookAt(tmp.copy(b.pos).add(b.vel));
      if (done) {
        scene.remove(b.mesh);
        bombs.splice(i, 1);
        const { n, main, downMsg } = blast(b.pos.clone(), b.R, b.kind === 'sub' ? 0.5 : 0.6, hit ? hit.b : null, true);
        if (b.kind === 'sub') {
          S.clusterN += n; S.clusterHits += n > 0 ? 1 : 0; S.clusterDone++;
          S.clusterSum.add(b.pos);
          if (downMsg) toast(downMsg, true);
        } else if (downMsg) toast(downMsg, true);
      }
    }
  }

  function updateHud() {
    // progress toward the next weapon, and fill bars on locked slots
    const next = Object.entries(UNLOCKS).filter(([w]) => !S.unlocked[w]).sort((a, b) => a[1] - b[1])[0];
    if (next) {
      $('nextText').textContent = `다음 해금: ${WEAPON_LABEL[next[0]]} · ${S.score.toLocaleString()}/${next[1].toLocaleString()}`;
      $('nextBar').style.width = Math.min(100, S.score / next[1] * 100).toFixed(1) + '%';
    } else {
      $('nextText').textContent = '모든 무기 해금 완료! 🏆';
      $('nextBar').style.width = '100%';
    }
    for (const [w, need] of Object.entries(UNLOCKS)) if (!S.unlocked[w]) $(WBTN[w]).style.setProperty('--p', Math.min(1, S.score / need).toFixed(3));
    $('score').textContent = S.score.toLocaleString();
    $('down').textContent = S.down;
    // share of all pre-fractured chunks in the city that are gone
    const alive = city.buildings.reduce((t, b) => t + b.aliveCount, 0);
    $('ratio').textContent = ((1 - alive / city.totalChunks) * 100).toFixed(2) + '%';
  }

  function computeFwd() {
    eul.set(S.pitch, -S.yaw, 0, 'YXZ');
    return fwd.set(0, 0, -1).applyEuler(eul);
  }

  // ------------------------------------------------------------ update
  function update(dt) {
    if (S.paused) return; // settings panel open
    const inp = input.read();
    S.t += dt;
    if (S.mode === 'pad') {
      const left = S.countdown - S.t;
      $('center').textContent = left > 0 ? Math.ceil(left) : '';
      if (left <= 0) {
        S.mode = 'flight'; S.t = 0; S.speed = 6; S.outOfBounds = false;
        setFlames(true);
        S.firstLaunch = false;
        for (let i = 0; i < 40; i++) smoke.spawn(pad.x + (Math.random() - 0.5) * 4, padTop, pad.z + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 20, Math.random() * 3, (Math.random() - 0.5) * 20, 4, 14, 3 + Math.random() * 2, 0.85, 0.85, 0.83, 0.8, 0.95, 0.5);
      }
    } else if (S.mode === 'flight') {
      const skillPress = inp.boost && !S.prevSkill;
      S.prevSkill = inp.boost;
      if (S.weapon === 'ballistic' && S.dashed) {
        // locked heading, speed grows for as long as it flies (no limit)
        S.dashT += dt;
        S.speed += (70 + S.dashT * 25) * dt;
        S.roll += dt * 6; // spin-stabilised
        S.boosting = true;
        fwd.copy(S.dashDir);
      } else if (S.weapon === 'quake' && S.drill) {
        // drill dive: nose straight down, spinning, accelerating into the ground
        S.pitch += (-1.52 - S.pitch) * Math.min(1, dt * 5);
        S.roll += dt * 16;
        S.speed += (160 - S.speed) * Math.min(1, dt * 3);
        S.boosting = true;
        computeFwd();
      } else {
        if (Math.abs(inp.x) > 0.15 || Math.abs(inp.y) > 0.15) S.manual = true;
        if (!S.manual && S.t > 0.8 && S.t < 3) S.pitch = Math.max(0.04, S.pitch - dt * 1.1);
        const heavy = S.weapon === 'ballistic' ? 0.8 : 1;
        S.yaw += inp.x * 1.45 * heavy * dt;
        S.pitch = clamp(S.pitch + inp.y * 1.25 * heavy * dt, -1.4, 1.56);
        S.roll += (-inp.x * 0.8 - S.roll) * Math.min(1, dt * 6);
        let targetSpeed = 52;
        if (S.weapon === 'ballistic') {
          targetSpeed = 46;
          S.boosting = false;
          if (skillPress && S.t > 0.3) fireDash();
        } else if (S.weapon === 'hunter') {
          S.boosting = false;
          targetSpeed = 65 / 3.6; // the carrier cruises at 65 km/h (as shown on the HUD)
          S.hCharges = Math.min(H_MAX, S.hCharges + dt / H_RELOAD);
          if (skillPress && S.hCharges >= 1) fireHunter(); // presses stack onto the salvo already in progress
          if (S.hQueue > 0) { S.hQTimer -= dt; if (S.hQTimer <= 0) { S.hQTimer += H_GAP; launchWarhead(S.hFired++); S.hQueue--; } }
        } else if (S.weapon === 'laser') {
          S.boosting = false;
          targetSpeed = 100 / 3.6; // laser missile cruises at 100 km/h (as shown on the HUD)
          S.firing = inp.boost && S.fuel > (S.firing ? 0 : 0.1);
          S.fuel = clamp(S.fuel + (S.firing ? -0.17 : 0.12 * 1.8) * dt, 0, 1); // half the drain, 1.8x recharge
        } else if (S.weapon === 'quake') {
          S.boosting = false;
          if (skillPress && S.t > 0.3) { S.drill = true; S.drillY0 = S.pos.y; sfx.boom(0.3); }
        } else if (S.weapon === 'blackhole') {
          S.boosting = false;
          if (skillPress && S.t > 0.3) { explode(null); }
        } else if (S.weapon === 'nuke') {
          S.boosting = false;
          targetSpeed = 48;
          if (skillPress && S.t > 0.3) { explode(null); }
        } else if (S.weapon === 'cluster') {
          S.boosting = false;
          if (skillPress && S.t > 0.3) fireCluster();
        } else if (S.weapon === 'bomber') {
          S.boosting = false;
          S.charges = Math.min(MAX_CHARGES, S.charges + dt / CHARGE_TIME);
          if (skillPress && S.charges >= 1) dropSalvo();
        } else {
          S.boosting = inp.boost && S.fuel > (S.boosting ? 0 : 0.12);
          S.fuel = clamp(S.fuel + (S.boosting ? -0.32 : 0.11) * dt, 0, 1);
          if (S.boosting) targetSpeed = 120;
        }
        const dv = targetSpeed - S.speed;
        S.speed += clamp(dv, -40 * dt, (S.boosting ? 95 : 32) * dt);
        if (!S.dashed) computeFwd();
      }
      const dist = S.speed * dt;
      const steps = S.mode === 'flight' ? Math.max(1, Math.ceil(dist / 0.8)) : 0; // 0 once the craft has split or detonated
      for (let i = 0; i < steps; i++) {
        S.pos.addScaledVector(fwd, dist / steps);
        const h = city.hit(S.pos.x, S.pos.y, S.pos.z);
        if (h) { explode(h.b); break; }
        if (S.pos.y < terrain.height(S.pos.x, S.pos.z) + 0.3) { explode(null); break; }
        if (!terrain.inside(S.pos.x, S.pos.z, 15) || S.pos.y > 1200 || S.t > 60) { S.outOfBounds = true; explode(null); break; }
      }
      if (S.mode === 'flight') {
        // exhaust
        const tl = S.weapon === 'ballistic' && S.dashed ? 2.4 : craft.tail;
        const tx = S.pos.x - fwd.x * tl, ty = S.pos.y - fwd.y * tl, tz = S.pos.z - fwd.z * tl;
        const nS = S.boosting ? 3 : 2;
        for (let i = 0; i < nS; i++) {
          const r = 0.6;
          smoke.spawn(tx + (Math.random() - 0.5) * r, ty + (Math.random() - 0.5) * r, tz + (Math.random() - 0.5) * r,
            -fwd.x * 4 + (Math.random() - 0.5) * 2, -fwd.y * 4 + (Math.random() - 0.5) * 2, -fwd.z * 4 + (Math.random() - 0.5) * 2,
            1.0, S.boosting ? 7 : 5, 1.6 + Math.random(), 0.88, 0.87, 0.85, 0.55, 0.96, 0.6);
        }
        const fs = S.weapon === 'ballistic' ? (S.dashed ? 2.2 + Math.min(3, S.dashT * 0.5) : 2.0) : (S.boosting ? 1.8 : 1.1);
        fire.spawn(tx, ty, tz, -fwd.x * 14, -fwd.y * 14, -fwd.z * 14, fs, 0.6, 0.14, 1, 0.75, 0.35, 1, 0.95, 0);
        if (S.dashed) fire.spawn(tx, ty, tz, -fwd.x * 6 + (Math.random() - 0.5) * 3, -fwd.y * 6, -fwd.z * 6 + (Math.random() - 0.5) * 3, fs * 0.8, 2, 0.3, 1, 0.55, 0.2, 0.9, 0.95, 0);
        const base = S.weapon === 'ballistic' ? 1.5 : 1;
        const fl = (S.boosting ? 1.8 : 1) * (0.85 + Math.random() * 0.3) * (S.dashed ? 1.3 + Math.min(1.5, S.dashT * 0.3) : 1);
        const [f1, f2] = craft.flames;
        f1.scale.set(base * (S.boosting ? 1.3 : 1), base * (S.boosting ? 1.3 : 1), base * fl);
        f2.scale.set(0.55 * base, 0.55 * base, 0.6 * base * fl);
        if (craft.bFlames && !S.dashed) { const s2 = 1.9 * (0.85 + Math.random() * 0.3); craft.bFlames[0].scale.set(1.9, 1.9, s2); craft.bFlames[1].scale.set(1.05, 1.05, s2 * 0.6); }
      }
      sfx.engine(S.mode === 'flight', S.boosting);
    } else if (S.mode === 'cluster') {
      if (!bombs.some(b => b.kind === 'sub') || S.t > 12) endCluster();
    } else if (S.mode === 'boom') {
      if (S.t > (S.boomTime || 3.4) && !laser.on && !bh.on && !quake.on) resetRocket();
    }

    rocket.position.copy(S.pos);
    engineLight.position.copy(S.pos); engineLight.intensity = night && S.mode === 'flight' ? (S.boosting ? 900 : 500) : 0;
    rocket.rotation.set(S.pitch, -S.yaw, S.roll, 'YXZ');

    if (dropped.obj) {
      const o = dropped.obj;
      dropped.t += dt;
      dropped.vel.y -= 14 * dt;
      dropped.vel.multiplyScalar(Math.exp(-dt * 0.4));
      o.position.addScaledVector(dropped.vel, dt);
      o.rotation.x += dropped.spin.x * dt; o.rotation.y += dropped.spin.y * dt; o.rotation.z += dropped.spin.z * dt;
      if (Math.random() < 0.6) smoke.spawn(o.position.x, o.position.y, o.position.z, 0, 1, 0, 1.2, 5, 1.5, 0.35, 0.34, 0.33, 0.5, 0.97, 0.5);
      const gy = terrain.height(o.position.x, o.position.z);
      if (o.position.y < gy + 0.5 || dropped.t > 12) {
        for (let i = 0; i < 12; i++) smoke.spawn(o.position.x, gy + 1, o.position.z, (Math.random() - 0.5) * 8, 2, (Math.random() - 0.5) * 8, 3, 10, 2.5, 0.5, 0.48, 0.44, 0.7, 0.96, 1);
        scene.remove(o); dropped.obj = null;
      }
    }
    updateBombs(dt);
    updateNuke(dt);
    updateLaser(dt);
    updateBlackHole(dt);
    updateQuake(dt);
    updateBeam(dt);
    updateHunters(dt);
    fire.update(dt); smoke.update(dt); debris.update(dt);
    flash.intensity *= Math.exp(-dt * 7);
    if (flash.intensity < 1) flash.intensity = 0;

    updateCamera(dt);

    // HUD
    const agl = S.pos.y - terrain.height(S.pos.x, S.pos.z);
    $('speed').textContent = Math.round(S.speed * 3.6);
    $('alt').textContent = Math.max(0, Math.round(agl));
    const gauge = S.weapon === 'hunter' ? S.hCharges / H_MAX : S.weapon === 'laser' ? S.fuel : S.weapon === 'quake' ? (S.drill ? 0 : 1) : S.weapon === 'nuke' || S.weapon === 'blackhole' ? 1 : S.weapon === 'ballistic' ? (S.dashed ? 0 : 1) : S.weapon === 'cluster' ? (S.clustered ? 0 : 1) : S.weapon === 'bomber' ? S.charges / MAX_CHARGES : S.fuel;
    $('boostBtn').style.setProperty('--cd', gauge.toFixed(3));
    $('boostBtn').classList.toggle('empty', S.weapon === 'hunter' ? S.hCharges < 1 : S.weapon === 'cluster' ? S.clustered : S.weapon === 'ballistic' ? S.dashed : S.weapon === 'bomber' ? S.charges < 1 : S.fuel < 0.12 && !S.boosting);
    if (S.weapon === 'hunter') { const c = String(Math.floor(S.hCharges)); if ($('skillBadge').textContent !== c) $('skillBadge').textContent = c; }
    if (S.weapon === 'bomber') { const c = String(Math.floor(S.charges)); if ($('skillBadge').textContent !== c) $('skillBadge').textContent = c; }
  }

  function updateCamera(dt) {
    const k = 1 - Math.exp(-dt * 5);
    if (S.mode === 'pad' || S.mode === 'title') {
      const hx = Math.sin(startYaw), hz = -Math.cos(startYaw);
      const rise = S.mode === 'pad' ? S.t * 0.6 : 0;
      tmp.set(pad.x - hx * 20 + hz * 6, padTop + 10 + rise, pad.z - hz * 20 - hx * 6);
      camPos.lerp(tmp, S.mode === 'title' ? 1 : k);
      camLook.lerp(tmp.set(pad.x + hx * 30, padTop + 6, pad.z + hz * 30), S.mode === 'title' ? 1 : k);
    } else if (S.mode === 'flight' && S.t < 1.3) {
      // lift-off: watch the rocket leave the pad from the ground
      camLook.lerp(S.pos, 1 - Math.exp(-dt * 8));
    } else if (S.mode === 'flight') {
      computeFwd();
      const hl = Math.hypot(fwd.x, fwd.z) || 1;
      tmp.set(fwd.x * 0.55 + (fwd.x / hl) * 0.45, fwd.y * 0.55, fwd.z * 0.55 + (fwd.z / hl) * 0.45).normalize();
      const back = 11 + S.speed * 0.03;
      const desired = new THREE.Vector3(S.pos.x - tmp.x * back, S.pos.y - tmp.y * back + 3.2, S.pos.z - tmp.z * back);
      const follow = S.dashed ? 16 : 7;
      camPos.lerp(desired, 1 - Math.exp(-dt * follow));
      camLook.lerp(tmp.copy(S.pos).addScaledVector(fwd, 22), 1 - Math.exp(-dt * (S.dashed ? 18 : 9)));
    } else if (S.mode === 'cluster') {
      // watch the submunitions spread from behind and above the burst point
      const c = subCentroid(tmp) || S.boomPos;
      const hx = S.clusterDir.x, hz = S.clusterDir.z, hl = Math.hypot(hx, hz) || 1;
      const desired = new THREE.Vector3(c.x - hx / hl * 55, c.y + 38, c.z - hz / hl * 55);
      camPos.lerp(desired, 1 - Math.exp(-dt * 3));
      camLook.lerp(c, 1 - Math.exp(-dt * 6));
    } else if (S.mode === 'debug') {
      // camera placed by window.__game.look() for testing
    } else if (S.mode === 'boom') {
      S.orbit += dt * 0.35;
      const sc = S.boomScale || 1;
      const dist = (42 + S.t * 4) * sc;
      tmp.set(S.boomPos.x + Math.sin(S.orbit) * dist, S.boomPos.y + (14 + S.t * 2) * sc * (sc > 2 ? 0.8 : 1), S.boomPos.z + Math.cos(S.orbit) * dist);
      // keep the orbit camera out of buildings
      for (let i = 0; i < 40 && city.hit(tmp.x, tmp.y, tmp.z); i++) tmp.y += 4;
      camPos.lerp(tmp, 1 - Math.exp(-dt * 2));
      if (city.hit(camPos.x, camPos.y, camPos.z)) camPos.y += 30 * dt;
      camLook.lerp(quake.on ? tmp.set(quake.x, quake.gy + 10, quake.z) : bh.on ? bh.p : laser.on && laser.t > 0.7 ? tmp.set(laser.x, laser.gy + 25, laser.z) : nuke.on ? tmp.set(nuke.p.x, nuke.gy + Math.min(110, 20 + nuke.t * 25), nuke.p.z) : S.boomPos, 1 - Math.exp(-dt * 4));
    }
    const gy = terrain.height(camPos.x, camPos.z) + 2;
    if (camPos.y < gy) camPos.y = gy;
    camera.position.copy(camPos);
    if (S.shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * S.shake;
      camera.position.y += (Math.random() - 0.5) * S.shake;
      camera.position.z += (Math.random() - 0.5) * S.shake;
      S.shake *= Math.exp(-dt * 3);
    }
    camera.lookAt(camLook);
    const fovT = baseFov + (S.mode === 'flight' ? Math.min(22, Math.max(0, S.speed - 60) * 0.045) : 0);
    if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
    sky.position.copy(camera.position);
    // centre the shadow box a little ahead of the camera, snapped to shadow texels
    tmp.copy(camLook).sub(camera.position).setY(0);
    const ahead = Math.min(tmp.length(), 90);
    tmp.normalize().multiplyScalar(ahead).add(camera.position);
    const texel = 320 / Q.shadowMap;
    tmp.x = Math.round(tmp.x / texel) * texel; tmp.z = Math.round(tmp.z / texel) * texel;
    tmp.y = terrain.height(tmp.x, tmp.z);
    sun.target.position.copy(tmp);
    sun.position.copy(tmp).addScaledVector(SUN_DIR, 500);
  }

  let miniT = 0;
  function drawMini(dt) {
    miniT += dt;
    if (miniT < 0.1) return;
    miniT = 0;
    mg.drawImage(miniBase, 0, 0);
    mg.fillStyle = '#ff3b30';
    for (const s of downSet) { const b = s.parts[0]; mg.beginPath(); mg.arc(mX((b.minx + b.maxx) / 2), mZ((b.minz + b.maxz) / 2), 4, 0, 7); mg.fill(); }
    mg.fillStyle = '#ffd60a';
    mg.fillRect(mX(pad.x) - 4, mZ(pad.z) - 4, 8, 8);
    if (S.mode === 'flight' || S.mode === 'pad') {
      const x = mX(S.pos.x), z = mZ(S.pos.z);
      mg.save(); mg.translate(x, z); mg.rotate(S.yaw);
      mg.fillStyle = '#fff'; mg.strokeStyle = '#000'; mg.lineWidth = 2;
      mg.beginPath(); mg.moveTo(0, -11); mg.lineTo(7, 8); mg.lineTo(0, 4); mg.lineTo(-7, 8); mg.closePath(); mg.fill(); mg.stroke();
      mg.restore();
    }
  }

  // ------------------------------------------------------------ resize / loop
  let wasPortrait = false, hintTimer = 0;
  function showPortraitHint() {
    $('portrait').classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => $('portrait').classList.remove('show'), 3000);
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    baseFov = w < h ? 80 : 62;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
    const s = h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    fire.setScale(s); smoke.setScale(s);
    // the "turn sideways" hint shows for 3 s whenever the game is (or becomes) portrait while playing
    const portrait = w < h;
    if (portrait && !wasPortrait && document.body.classList.contains('playing')) showPortraitHint();
    if (!portrait) $('portrait').classList.remove('show');
    wasPortrait = portrait;
  }
  addEventListener('resize', resize);
  resize();
  S.pos.set(pad.x, padTop + 2.4, pad.z);
  updateCamera(0.016);

  // debug/testing hook: advance the simulation without requestAnimationFrame
  window.__game.look = (px, py, pz, tx, ty, tz) => {
    S.mode = 'debug'; camPos.set(px, py, pz); camLook.set(tx, ty, tz); rocket.visible = false;
    document.getElementById('title').classList.add('hide');
    updateCamera(0); renderFrame(); return 'ok';
  };
  window.__game.unlock = (w = 'ballistic') => { S.score = Math.max(S.score, UNLOCKS[w]); checkUnlocks(); return 'ok'; };
  window.__game.bombs = bombs;
  window.__game.hunters = hunters;
  window.__game.sfx = sfx;
  window.__game.pick = (w) => pickWeapon(w);
  window.__game.find = (name) => { const s = city.structures.find(q => q.name === name); const b = s.parts[0]; return [(b.minx + b.maxx) / 2, b.base, (b.minz + b.maxz) / 2, b.ytop - b.base]; };
  window.__game.step = (n = 1, dt = 1 / 60, render = true) => { for (let i = 0; i < n; i++) update(dt); if (render) { drawMini(1); renderFrame(); } return S.mode; };
  // adaptive quality: slow phones drop shadows first, then resolution
  let perfAcc = 0, perfN = 0, quality = 2;
  function watchPerf(rawDt) {
    if (quality === 0 || document.hidden || S.mode === 'title' || S.mode === 'debug') return;
    perfAcc += rawDt; perfN++;
    if (perfAcc < 2.5) return;
    const fps = perfN / perfAcc;
    perfAcc = 0; perfN = 0;
    if (fps >= 38) return;
    if (quality === 2 && shadowsOn) {
      shadowsOn = false; sun.castShadow = false; $('optShadow').checked = false;
    } else {
      renderer.setPixelRatio(1); resize();
      quality = 0; return;
    }
    quality = 1;
  }

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const raw = (now - last) / 1000;
    const dt = Math.min(0.05, raw);
    last = now;
    if (raw < 0.5 && !S.paused) watchPerf(raw);
    update(dt);
    drawMini(dt);
    renderFrame();
  });

  // ------------------------------------------------------------ UI
  // night mode: moonlit sky with stars, lit windows, dark fog; explosions and flames glow
  const DAY = { fog: new THREE.Color(0xc9dbe8), hemiSky: new THREE.Color(0xe4f0ff), hemiGround: new THREE.Color(0x6a7352), hemi: 1.15, sun: 2.9, sunCol: new THREE.Color(0xfff0dc) };
  const NIGHTL = { fog: new THREE.Color(0x0b1020), hemiSky: new THREE.Color(0x6f86b8), hemiGround: new THREE.Color(0x1a1f24), hemi: 0.42, sun: 0.75, sunCol: new THREE.Color(0xa8bde0) };
  function setNight(on) {
    night = on;
    const L = on ? NIGHTL : DAY;
    NIGHT.value = on ? 1 : 0;
    sky.material.uniforms.uNight.value = on ? 1 : 0;
    scene.fog.color.copy(L.fog);
    scene.fog.near = on ? 200 : 350; scene.fog.far = on ? 1900 : 2600;
    hemi.color.copy(L.hemiSky); hemi.groundColor.copy(L.hemiGround); hemi.intensity = L.hemi;
    sun.color.copy(L.sunCol); sun.intensity = L.sun;
    SUN_DIR.set(on ? -0.5 : 0.45, on ? 0.45 : 0.55, on ? 0.6 : -0.7).normalize(); // moonlight comes from the moon in the sky
    if (window.__bhHemi) { window.__bhHemi.base = L.hemi; window.__bhHemi.sun = L.sun; }
    renderer.setClearColor(L.fog);
    try { localStorage.setItem('khu-night', on ? '1' : '0'); } catch { /* ignore */ }
  }
  let nightPref = false;
  try { nightPref = localStorage.getItem('khu-night') === '1'; } catch { /* ignore */ }
  setNight(nightPref);
  $('optNight').checked = nightPref;
  $('optNight').addEventListener('change', (e) => setNight(e.target.checked));
  window.__game.setNight = setNight;

  // settings panel (pauses the game while open)
  let muted = false;
  try { muted = localStorage.getItem('khu-mute') === '1'; } catch { /* ignore */ }
  if (muted) sfx.toggleMute();
  $('optShadow').checked = shadowsOn;
  $('optSound').checked = !muted;
  $('optInvert').checked = input.invert;
  $('optShadow').addEventListener('change', (e) => {
    shadowsOn = e.target.checked; sun.castShadow = shadowsOn;
    try { localStorage.setItem('khu-shadows', shadowsOn ? '1' : '0'); } catch { /* ignore */ }
  });
  $('optSound').addEventListener('change', (e) => {
    if (sfx.muted === e.target.checked) sfx.toggleMute();
    try { localStorage.setItem('khu-mute', sfx.muted ? '1' : '0'); } catch { /* ignore */ }
  });
  $('optInvert').addEventListener('change', (e) => { if (input.invert !== e.target.checked) input.toggleInvert(); });
  const openSettings = (open) => {
    $('settings').classList.toggle('open', open);
    S.paused = open;
    if (open) { input.resetJoy(); input.boostIds.clear(); input.keys.clear(); $('boostBtn').classList.remove('on'); sfx.engine(false); sfx.beam(false); }
  };
  $('btnSettings').addEventListener('click', () => openSettings(true));
  $('optClose').addEventListener('click', () => openSettings(false));
  $('settings').addEventListener('click', (e) => { if (e.target === $('settings')) openSettings(false); });
  addEventListener('keydown', (e) => { if (e.code === 'Escape') openSettings(!S.paused); });
  $('optReset').addEventListener('click', () => { if (confirm('캠퍼스를 복구할까요? (점수 초기화)')) location.reload(); });
  updateHud();
  setLoad(`건물 ${city.structures.length}채 · 조각 ${city.totalChunks.toLocaleString()}개 준비 완료`);
  const start = $('start');
  start.disabled = false;
  start.textContent = '🚀 출격';
  start.addEventListener('click', () => {
    sfx.init();
    const de = document.documentElement;
    if (de.requestFullscreen && matchMedia('(pointer: coarse)').matches) {
      de.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    }
    $('title').classList.add('hide');
    document.body.classList.add('playing');
    if (innerWidth < innerHeight) { wasPortrait = true; showPortraitHint(); }
    resetRocket();
  });
}

main().catch((e) => {
  console.error(e);
  showError('불러오기 실패: ' + e.message);
});
