// Tiny synthesized sound effects (no audio files needed).
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; }
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    this.engF = ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 500;
    this.engG = ctx.createGain(); this.engG.gain.value = 0;
    src.connect(this.engF).connect(this.engG).connect(this.master);
    src.start();
  }
  engine(on, boost) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engG.gain.setTargetAtTime(on ? (boost ? 0.32 : 0.16) : 0, t, 0.08);
    this.engF.frequency.setTargetAtTime(boost ? 1500 : 650, t, 0.15);
  }
  boom(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(80, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.1 * strength, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
    src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + 2.1);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9 * strength, t); og.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 1.2);
  }
  rumble() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
    src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + 2.6);
  }
  // deep rising hum while a black hole exists
  drone(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.dr) {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'sine';
      o1.frequency.value = 38; o2.frequency.value = 57;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      o1.connect(f); o2.connect(f); f.connect(g).connect(this.master);
      o1.start(); o2.start();
      this.dr = { o1, o2, f, g };
    } else if (!on && this.dr) {
      const d = this.dr; this.dr = null;
      d.g.gain.setTargetAtTime(0.0001, t, 0.05);
      d.o1.stop(t + 0.4); d.o2.stop(t + 0.4);
    }
  }
  droneLevel(x) {
    if (!this.dr) return;
    const t = this.ctx.currentTime;
    this.dr.g.gain.setTargetAtTime(0.05 + 0.4 * x, t, 0.1);
    this.dr.o1.frequency.setTargetAtTime(38 - 14 * x, t, 0.2);
    this.dr.o2.frequency.setTargetAtTime(57 - 22 * x, t, 0.2);
    this.dr.f.frequency.setTargetAtTime(180 + 260 * x, t, 0.2);
  }
  // laser beam: a heavy low "woooong" - thick low tones through a slowly swelling low-pass, with a sub rumble
  beam(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.bm) {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), sub = ctx.createOscillator();
      o1.type = 'sawtooth'; o1.frequency.value = 55;
      o2.type = 'sawtooth'; o2.frequency.value = 82.6;
      sub.type = 'sine'; sub.frequency.value = 41;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 6;
      const swell = ctx.createOscillator(); swell.frequency.value = 0.9; // slow "woo-oong" swell
      const swellG = ctx.createGain(); swellG.gain.value = 220;
      swell.connect(swellG).connect(lp.frequency);
      const trem = ctx.createOscillator(); trem.frequency.value = 7; // slight throb
      const tremG = ctx.createGain(); tremG.gain.value = 0.18;
      const amp = ctx.createGain(); amp.gain.value = 0.8;
      trem.connect(tremG).connect(amp.gain);
      const subG = ctx.createGain(); subG.gain.value = 0.55;
      o1.connect(lp); o2.connect(lp); lp.connect(amp); sub.connect(subG).connect(amp);
      const out = ctx.createGain(); out.gain.value = 0.0001;
      amp.connect(out).connect(this.master);
      for (const n of [o1, o2, sub, swell, trem]) n.start(t);
      out.gain.exponentialRampToValueAtTime(0.5, t + 0.15);
      this.bm = { nodes: [o1, o2, sub, swell, trem], out, tones: [o1, o2, sub] };
    } else if (!on && this.bm) {
      const b = this.bm; this.bm = null;
      for (const o of b.tones) o.frequency.setTargetAtTime(o.frequency.value * 0.6, t, 0.1); // winds down
      b.out.gain.cancelScheduledValues(t); b.out.gain.setValueAtTime(Math.max(0.0001, b.out.gain.value), t); b.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      for (const n of b.nodes) n.stop(t + 0.35);
    }
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
    return this.muted;
  }
}
