import * as THREE from 'three';
import { City } from './buildings.js?v=5';
import { buildStructures } from './models.js?v=5';
import { Terrain, drawGroundCanvas, buildTerrainMesh, buildOuterGround, buildTrees, buildSky } from './world.js?v=5';
import { Particles, Debris } from './fx.js?v=5';
import { Input } from './input.js?v=5';
import { Sfx } from './audio.js?v=5';

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

const KIND = { apartments: '아파트', house: '주택', school: '학교', college: '대학 건물', dormitory: '기숙사', commercial: '상가', retail: '상가', residential: '주거 건물' };

async function main() {
  setLoad('캠퍼스 지도 불러오는 중…');
  const data = await (await fetch('data/campus.json?v=5')).json();
  await frame();

  // ------------------------------------------------------------ renderer / scene
  const dpr = Math.min(window.devicePixelRatio || 1, Q.dpr);
  const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: !MOBILE && dpr < 1.5, powerPreference: 'high-performance' });
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); showError('그래픽 메모리가 부족해요. 새로고침하면 다시 시도해요.'); });
  renderer.setPixelRatio(dpr);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc9dbe8, 350, 2600);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 9000);
  scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x6a7352, 1.15));
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
  // weapons: ballistic missile unlocks after destroying UNLOCK_AT chunks (remembered on this device)
  const UNLOCK_AT = 300;
  try { S.unlocked = localStorage.getItem('khu-ballistic') === '1'; } catch { S.unlocked = false; }
  S.weapon = S.nextWeapon = 'rocket';
  function setUnlocked() {
    S.unlocked = true;
    try { localStorage.setItem('khu-ballistic', '1'); } catch { /* ignore */ }
    $('wBallistic').classList.remove('locked');
    $('wLock').textContent = '';
  }
  function pickWeapon(w) {
    if (w === 'ballistic' && !S.unlocked) { toast(`🔒 ${UNLOCK_AT}조각을 부수면 열려요 (지금 ${S.score}조각)`); return; }
    S.nextWeapon = w;
    $('wRocket').classList.toggle('on', w === 'rocket');
    $('wBallistic').classList.toggle('on', w === 'ballistic');
    if (S.mode === 'pad' || S.mode === 'title') { const t = S.t; resetRocket(); S.t = t; }
    else toast(`다음 발사부터 ${crafts[w].name}`);
  }
  if (S.unlocked) setUnlocked();
  $('wRocket').addEventListener('click', () => pickWeapon('rocket'));
  $('wBallistic').addEventListener('click', () => pickWeapon('ballistic'));
  window.__game = { S, city, terrain, input, camera };

  function resetRocket() {
    S.mode = 'pad'; S.t = 0; S.speed = 0; S.fuel = 1; S.boosting = false; S.manual = false;
    S.yaw = startYaw; S.pitch = 1.55; S.roll = 0;
    S.pos.set(pad.x, padTop + 2.4, pad.z);
    for (const c of Object.values(crafts)) c.group.visible = false;
    craft = crafts[S.nextWeapon];
    S.weapon = S.nextWeapon;
    document.body.classList.toggle('ballistic', S.weapon === 'ballistic');
    $('skillName').textContent = craft.skill;
    if (craft.booster && craft.booster.parent !== craft.group) restoreBooster();
    S.dashed = false; S.dashT = 0; S.prevSkill = false;
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
    toast('🎯 분리! 돌진');
  }

  function toast(msg, big = false) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('big', big);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  function explode(hitB) {
    const p = S.pos.clone();
    const power = clamp((S.speed - 50) / 65, 0, 1);
    // ballistic dash: blast keeps growing with speed (capped only to stay playable)
    const R = S.weapon === 'ballistic' && S.dashed ? Math.min(48, 10 + (S.speed - 60) * 0.06) : 8 + 6 * power;
    const big = clamp(R / 12, 1, 4);
    const res = city.explode(p.x, p.y, p.z, R, Math.random);
    let killedN = 0, fallenN = 0;
    let main = hitB ? res.find(r => r.b.owner === hitB.owner) : null;
    for (const r of res) {
      if (!main || r.killed.length > main.killed.length && !hitB) main = r;
      for (const c of r.killed) {
        const ci = r.b.chunkInfo(c);
        tmp.set(ci.x - p.x, ci.y - p.y, ci.z - p.z).normalize();
        const sp = 10 + Math.random() * 18 + power * 12;
        debris.spawn(ci.x, ci.y, ci.z, ci.sx * 0.9, ci.sy * 0.85, ci.sz * 0.9,
          tmp.x * sp, tmp.y * sp + 6 + Math.random() * 10, tmp.z * sp, ci.color, 6);
        const fs = 0.4 + Math.random() * 0.9;
        debris.spawn(ci.x, ci.y, ci.z, fs, fs * 0.7, fs, tmp.x * sp * 1.6, 10 + Math.random() * 18, tmp.z * sp * 1.6, ci.color, 14);
        if (killedN % 2 === 0) smoke.spawn(ci.x, ci.y, ci.z, tmp.x * 3, 2, tmp.z * 3, 5, 14, 3 + Math.random() * 2, 0.55, 0.53, 0.5, 0.7, 0.97, 1.5);
        killedN++;
      }
      for (const c of r.fallen) {
        const ci = r.b.chunkInfo(c);
        debris.spawn(ci.x, ci.y, ci.z, ci.sx * 0.95, ci.sy * 0.95, ci.sz * 0.95,
          (Math.random() - 0.5) * 4, -2 - Math.random() * 3, (Math.random() - 0.5) * 4, ci.color, 1.5);
        if (fallenN % 4 === 0) smoke.spawn(ci.x, Math.max(ci.y - 6, r.b.base + 2), ci.z, (Math.random() - 0.5) * 6, 1, (Math.random() - 0.5) * 6, 7, 22, 4 + Math.random() * 3, 0.62, 0.59, 0.54, 0.6, 0.98, 1);
        fallenN++;
      }
    }
    // fireball
    for (let i = 0; i < 55 * big; i++) {
      tmp.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      const sp = (8 + Math.random() * 26) * Math.sqrt(big);
      fire.spawn(p.x, p.y, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp, 5 + Math.random() * 6, 8 + R, 0.5 + Math.random() * 0.7, 1, 0.75, 0.35, 1, 0.9, 2);
    }
    for (let i = 0; i < 40; i++) {
      tmp.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5).normalize();
      const sp = 30 + Math.random() * 40;
      fire.spawn(p.x, p.y, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp, 0.6, 0, 0.6 + Math.random() * 0.6, 1, 0.9, 0.5, 1, 0.94, -8);
    }
    for (let i = 0; i < 35 * big; i++) {
      tmp.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      const sp = (4 + Math.random() * 10) * Math.sqrt(big);
      const g = 0.18 + Math.random() * 0.15;
      smoke.spawn(p.x, p.y, p.z, tmp.x * sp, tmp.y * sp, tmp.z * sp, 6, 22 + R * 2, 3 + Math.random() * 3, g, g, g, 0.85, 0.96, 3);
    }
    flash.position.copy(p); flash.intensity = 4000;
    sfx.boom(Math.min(1.6, 0.7 + power * 0.4 + (big - 1) * 0.3));
    if (fallenN > 15) setTimeout(() => sfx.rumble(), 250);
    S.shake = 1.4 + power + (big - 1) * 1.2;
    const n = killedN + fallenN;
    S.score += n;
    const justUnlocked = !S.unlocked && S.score >= UNLOCK_AT;
    let msg;
    if (main) {
      const b = main.b;
      const name = b.name || KIND[b.kind] || '건물';
      msg = `${name} 명중! ${n}조각 파괴`;
      for (const s of new Set(res.map(r => r.b.owner))) {
        const alive = s.parts.reduce((t, q) => t + q.aliveCount, 0);
        if (!downSet.has(s) && alive / s.total < 0.15) { downSet.add(s); S.down++; msg = `${s.name || KIND[s.kind] || '건물'} 붕괴! 💥 ${n}조각`; }
      }
    } else {
      msg = hitB === null && S.outOfBounds ? '범위를 벗어났어요' : n ? `${n}조각 파괴` : '지면 충돌!';
    }
    toast(msg, !!main);
    if (justUnlocked) {
      setUnlocked();
      setTimeout(() => toast('🎯 탄도미사일 해금! 위에서 고를 수 있어요', true), 1600);
    }
    S.mode = 'boom'; S.t = 0; S.boomPos.copy(p);
    S.orbit = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
    rocket.visible = false;
    sfx.engine(false);
    S.shots++;
    updateHud();
  }

  function updateHud() {
    $('score').textContent = S.score.toLocaleString();
    $('down').textContent = S.down;
    $('shots').textContent = S.shots;
  }

  function computeFwd() {
    eul.set(S.pitch, -S.yaw, 0, 'YXZ');
    return fwd.set(0, 0, -1).applyEuler(eul);
  }

  // ------------------------------------------------------------ update
  function update(dt) {
    const inp = input.read();
    S.t += dt;
    if (S.mode === 'pad') {
      const left = S.countdown - S.t;
      $('center').textContent = left > 0 ? Math.ceil(left) : '';
      if (left <= 0) {
        S.mode = 'flight'; S.t = 0; S.speed = 6; S.outOfBounds = false;
        setFlames(true);
        toast(S.firstLaunch ? '발사! 왼쪽으로 조종, 오른쪽은 스킬'
          : S.weapon === 'ballistic' ? '탄도미사일 발사! 스킬을 누르면 그 방향으로 돌진' : '발사!');
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
      const steps = Math.max(1, Math.ceil(dist / 0.8));
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
    } else if (S.mode === 'boom') {
      if (S.t > 3.4) resetRocket();
    }

    rocket.position.copy(S.pos);
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
    fire.update(dt); smoke.update(dt); debris.update(dt);
    flash.intensity *= Math.exp(-dt * 7);
    if (flash.intensity < 1) flash.intensity = 0;

    updateCamera(dt);

    // HUD
    const agl = S.pos.y - terrain.height(S.pos.x, S.pos.z);
    $('speed').textContent = Math.round(S.speed * 3.6);
    $('alt').textContent = Math.max(0, Math.round(agl));
    const gauge = S.weapon === 'ballistic' ? (S.dashed ? 0 : 1) : S.fuel;
    $('boostFill').style.transform = `scaleX(${gauge.toFixed(3)})`;
    $('boostBtn').classList.toggle('empty', S.weapon === 'ballistic' ? S.dashed : S.fuel < 0.12 && !S.boosting);
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
    } else if (S.mode === 'debug') {
      // camera placed by window.__game.look() for testing
    } else if (S.mode === 'boom') {
      S.orbit += dt * 0.35;
      const dist = 42 + S.t * 4;
      tmp.set(S.boomPos.x + Math.sin(S.orbit) * dist, S.boomPos.y + 14 + S.t * 2, S.boomPos.z + Math.cos(S.orbit) * dist);
      // keep the orbit camera out of buildings
      for (let i = 0; i < 40 && city.hit(tmp.x, tmp.y, tmp.z); i++) tmp.y += 4;
      camPos.lerp(tmp, 1 - Math.exp(-dt * 2));
      if (city.hit(camPos.x, camPos.y, camPos.z)) camPos.y += 30 * dt;
      camLook.lerp(S.boomPos, 1 - Math.exp(-dt * 4));
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
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    baseFov = w < h ? 80 : 62;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
    const s = h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    fire.setScale(s); smoke.setScale(s);
    $('portrait').classList.toggle('show', w < h);
  }
  addEventListener('resize', resize);
  resize();
  S.pos.set(pad.x, padTop + 2.4, pad.z);
  updateCamera(0.016);

  // debug/testing hook: advance the simulation without requestAnimationFrame
  window.__game.look = (px, py, pz, tx, ty, tz) => {
    S.mode = 'debug'; camPos.set(px, py, pz); camLook.set(tx, ty, tz); rocket.visible = false;
    document.getElementById('title').classList.add('hide');
    updateCamera(0); renderer.render(scene, camera); return 'ok';
  };
  window.__game.unlock = () => { S.score = Math.max(S.score, UNLOCK_AT); setUnlocked(); return 'ok'; };
  window.__game.pick = (w) => pickWeapon(w);
  window.__game.find = (name) => { const s = city.structures.find(q => q.name === name); const b = s.parts[0]; return [(b.minx + b.maxx) / 2, b.base, (b.minz + b.maxz) / 2, b.ytop - b.base]; };
  window.__game.step = (n = 1, dt = 1 / 60, render = true) => { for (let i = 0; i < n; i++) update(dt); if (render) { drawMini(1); renderer.render(scene, camera); } return S.mode; };
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
      shadowsOn = false; sun.castShadow = false; $('btnShadow').classList.remove('on');
      toast('부드럽게 돌아가도록 그림자를 껐어요');
    } else {
      renderer.setPixelRatio(1); resize();
      toast('부드럽게 돌아가도록 해상도를 낮췄어요');
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
    if (raw < 0.5) watchPerf(raw);
    update(dt);
    drawMini(dt);
    renderer.render(scene, camera);
  });

  // ------------------------------------------------------------ UI
  $('btnInvert').classList.toggle('on', input.invert);
  $('btnInvert').addEventListener('click', () => { $('btnInvert').classList.toggle('on', input.toggleInvert()); });
  $('btnShadow').classList.toggle('on', shadowsOn);
  $('btnShadow').addEventListener('click', () => {
    shadowsOn = !shadowsOn; sun.castShadow = shadowsOn;
    $('btnShadow').classList.toggle('on', shadowsOn);
    try { localStorage.setItem('khu-shadows', shadowsOn ? '1' : '0'); } catch { /* ignore */ }
  });
  $('btnMute').addEventListener('click', () => { $('btnMute').textContent = sfx.toggleMute() ? '🔇' : '🔊'; });
  $('btnReset').addEventListener('click', () => { if (confirm('캠퍼스를 복구할까요? (점수 초기화)')) location.reload(); });
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
    resetRocket();
  });
}

main().catch((e) => {
  console.error(e);
  showError('불러오기 실패: ' + e.message);
});
