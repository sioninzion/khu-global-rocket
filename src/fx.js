// Particles (fire / smoke) and building debris.
import * as THREE from 'three';

export class Particles {
  constructor(scene, cap, additive) {
    this.cap = cap; this.next = 0;
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.s0 = new Float32Array(cap); this.grow = new Float32Array(cap); this.a0 = new Float32Array(cap);
    this.drag = new Float32Array(cap); this.buoy = new Float32Array(cap); this.c0 = new Float32Array(cap * 3);
    this.fire = additive;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 500 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; uniform float uScale;
        varying float vA; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vA = alpha; vC = color;
          gl_PointSize = size * uScale / max(-mv.z, 0.5); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.05, d) * vA; gl_FragColor = vec4(vC, a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, size, grow, life, r, g, b, alpha = 1, drag = 0.97, buoy = 0) {
    const i = this.next; this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.c0[i * 3] = r; this.c0[i * 3 + 1] = g; this.c0[i * 3 + 2] = b;
    this.s0[i] = size; this.grow[i] = grow; this.life[i] = life; this.max[i] = life;
    this.a0[i] = alpha; this.drag[i] = drag; this.buoy[i] = buoy;
  }
  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      this.life[i] -= dt;
      const t = 1 - Math.max(this.life[i], 0) / this.max[i];
      const k = Math.pow(this.drag[i], dt * 60);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.buoy[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + this.grow[i] * t;
      if (this.fire) {
        this.alpha[i] = this.a0[i] * (1 - t) * (1 - t);
        this.col[i * 3] = this.c0[i * 3]; this.col[i * 3 + 1] = this.c0[i * 3 + 1] * (1 - t * 0.8); this.col[i * 3 + 2] = this.c0[i * 3 + 2] * (1 - t);
      } else {
        this.alpha[i] = this.a0[i] * Math.min(1, t * 8) * (1 - t);
        this.col[i * 3] = this.c0[i * 3]; this.col[i * 3 + 1] = this.c0[i * 3 + 1]; this.col[i * 3 + 2] = this.c0[i * 3 + 2];
      }
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
  setScale(s) { this.uniforms.uScale.value = s; }
}

export class Debris {
  constructor(scene, cap, terrain) {
    this.cap = cap; this.terrain = terrain; this.next = 0;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.items = [];
    for (let i = 0; i < cap; i++) this.items.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: new THREE.Vector3(), t: 0 });
    this.m = new THREE.Matrix4(); this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.dq = new THREE.Quaternion(); this.e = new THREE.Euler(); this.tmpS = new THREE.Vector3();
    for (let i = 0; i < cap; i++) { this.mesh.setMatrixAt(i, this.zero); this.mesh.setColorAt(i, new THREE.Color(1, 1, 1)); }
    scene.add(this.mesh);
  }
  spawn(x, y, z, sx, sy, sz, vx, vy, vz, color, spin) {
    const i = this.next; this.next = (this.next + 1) % this.cap;
    const it = this.items[i];
    it.on = true; it.t = 0; it.life = 7 + Math.random() * 4;
    it.p.set(x, y, z); it.v.set(vx, vy, vz); it.s.set(sx, sy, sz); it.q.identity();
    it.w.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
    this.mesh.setColorAt(i, color);
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      const it = this.items[i];
      if (!it.on) continue;
      any = true;
      it.t += dt;
      it.v.y -= 22 * dt;
      it.p.addScaledVector(it.v, dt);
      const gy = this.terrain.height(it.p.x, it.p.z);
      const half = it.s.y * 0.35;
      if (it.p.y - half < gy) {
        it.p.y = gy + half;
        if (it.v.y < 0) it.v.y *= -0.25;
        it.v.x *= 0.6; it.v.z *= 0.6; it.w.multiplyScalar(0.6);
      }
      this.e.set(it.w.x * dt, it.w.y * dt, it.w.z * dt);
      this.dq.setFromEuler(this.e); it.q.multiply(this.dq);
      let sc = 1;
      if (it.t > it.life) sc = Math.max(0, 1 - (it.t - it.life) / 1.5);
      if (sc <= 0) { it.on = false; this.mesh.setMatrixAt(i, this.zero); continue; }
      this.tmpS.copy(it.s).multiplyScalar(sc);
      this.m.compose(it.p, it.q, this.tmpS);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
