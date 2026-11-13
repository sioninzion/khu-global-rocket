// Left half: floating joystick. Right half: boost (hold). Keyboard fallback for desktop.
export class Input {
  constructor() {
    this.jx = 0; this.jy = 0; this.joyId = null; this.boostIds = new Set();
    this.keys = new Set();
    this.R = 60;
    try { this.invert = localStorage.getItem('khu-invert') === '1'; } catch { this.invert = false; }
    this.zone = document.getElementById('touch');
    this.base = document.getElementById('joyBase');
    this.knob = document.getElementById('joyKnob');
    this.btn = document.getElementById('boostBtn');
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => this.down(e));
    z.addEventListener('pointermove', (e) => this.move(e));
    z.addEventListener('pointerup', (e) => this.up(e));
    z.addEventListener('pointercancel', (e) => this.up(e));
    z.addEventListener('lostpointercapture', (e) => this.up(e));
    addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.boostIds.clear(); this.resetJoy(); this.btn.classList.remove('on'); });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  down(e) {
    e.preventDefault();
    try { this.zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (e.clientX < innerWidth * 0.5) {
      if (this.joyId !== null) return;
      this.joyId = e.pointerId; this.cx = e.clientX; this.cy = e.clientY;
      this.base.style.left = e.clientX + 'px'; this.base.style.top = e.clientY + 'px';
      this.base.style.bottom = 'auto';
      this.base.classList.add('on');
      this.setKnob(0, 0);
    } else {
      this.boostIds.add(e.pointerId);
      this.btn.classList.add('on');
    }
  }
  move(e) {
    if (e.pointerId !== this.joyId) return;
    e.preventDefault();
    let dx = e.clientX - this.cx, dy = e.clientY - this.cy;
    const d = Math.hypot(dx, dy);
    if (d > this.R) { dx *= this.R / d; dy *= this.R / d; }
    this.setKnob(dx, dy);
    this.jx = dx / this.R; this.jy = dy / this.R;
  }
  up(e) {
    if (e.pointerId === this.joyId) this.resetJoy();
    if (this.boostIds.delete(e.pointerId) && this.boostIds.size === 0) this.btn.classList.remove('on');
  }
  resetJoy() {
    this.joyId = null; this.jx = 0; this.jy = 0;
    this.base.classList.remove('on');
    this.base.style.left = ''; this.base.style.top = ''; this.base.style.bottom = '';
    this.setKnob(0, 0);
  }
  setKnob(x, y) { this.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`; }
  toggleInvert() { this.invert = !this.invert; try { localStorage.setItem('khu-invert', this.invert ? '1' : '0'); } catch { /* ignore */ } return this.invert; }
  // x: right +, y: nose up +
  read() {
    const k = this.keys;
    let x = this.jx, y = -this.jy;
    if (k.has('ArrowLeft') || k.has('KeyA')) x = -1;
    if (k.has('ArrowRight') || k.has('KeyD')) x = 1;
    if (k.has('ArrowUp') || k.has('KeyW')) y = 1;
    if (k.has('ArrowDown') || k.has('KeyS')) y = -1;
    const dz = (v) => Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92;
    x = dz(x); y = dz(y);
    if (this.invert) y = -y;
    const boost = this.boostIds.size > 0 || k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight');
    return { x, y, boost };
  }
}
