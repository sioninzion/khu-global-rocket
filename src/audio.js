// Tiny synthesized sound effects (no audio files needed).
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; }
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
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
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
    return this.muted;
  }
}
