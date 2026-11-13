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
  // laser beam, repulsor-style: a quick rising charge-up whine with a punchy thump,
  // then a bright airy energy stream (high tones with vibrato over a hissing whoosh), and a falling tail on release
  beam(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.bm) {
      const out = ctx.createGain(); out.gain.value = 0.0001; out.connect(this.master);
      // charge-up whine
      const ch = ctx.createOscillator(); ch.type = 'sine';
      ch.frequency.setValueAtTime(320, t); ch.frequency.exponentialRampToValueAtTime(1900, t + 0.22);
      const chg = ctx.createGain(); chg.gain.setValueAtTime(0.0001, t); chg.gain.exponentialRampToValueAtTime(0.35, t + 0.05); chg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      ch.connect(chg).connect(this.master); ch.start(t); ch.stop(t + 0.32);
      // punch
      const th = ctx.createOscillator(); th.type = 'sine';
      th.frequency.setValueAtTime(140, t + 0.12); th.frequency.exponentialRampToValueAtTime(45, t + 0.4);
      const thg = ctx.createGain(); thg.gain.setValueAtTime(0.0001, t); thg.gain.setValueAtTime(0.0001, t + 0.12); thg.gain.exponentialRampToValueAtTime(0.5, t + 0.14); thg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      th.connect(thg).connect(this.master); th.start(t); th.stop(t + 0.5);
      // sustained energy stream
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
      o1.type = 'sine'; o1.frequency.value = 880; o2.type = 'triangle'; o2.frequency.value = 1322; o3.type = 'sine'; o3.frequency.value = 1763;
      const vib = ctx.createOscillator(); vib.frequency.value = 7.5; const vibG = ctx.createGain(); vibG.gain.value = 18;
      vib.connect(vibG); vibG.connect(o1.frequency); vibG.connect(o2.frequency); vibG.connect(o3.frequency);
      const tone = ctx.createGain(); tone.gain.value = 0.16;
      o1.connect(tone); o2.connect(tone); o3.connect(tone);
      const hiss = ctx.createBufferSource(); hiss.buffer = this.noise; hiss.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.2;
      const sw = ctx.createOscillator(); sw.frequency.value = 3.2; const swG = ctx.createGain(); swG.gain.value = 900;
      sw.connect(swG).connect(bp.frequency);
      const hg = ctx.createGain(); hg.gain.value = 0.5;
      hiss.connect(bp).connect(hg);
      tone.connect(out); hg.connect(out);
      for (const n of [o1, o2, o3, vib, hiss, sw]) n.start(t + 0.12);
      out.gain.setValueAtTime(0.0001, t + 0.12); out.gain.exponentialRampToValueAtTime(0.42, t + 0.2);
      this.bm = { nodes: [o1, o2, o3, vib, hiss, sw], out, o1, o2, o3 };
    } else if (!on && this.bm) {
      const b = this.bm; this.bm = null;
      // falling tail
      for (const o of [b.o1, b.o2, b.o3]) o.frequency.setTargetAtTime(o.frequency.value * 0.45, t, 0.08);
      b.out.gain.cancelScheduledValues(t); b.out.gain.setValueAtTime(b.out.gain.value || 0.42, t); b.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      for (const n of b.nodes) n.stop(t + 0.32);
    }
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
    return this.muted;
  }
}
