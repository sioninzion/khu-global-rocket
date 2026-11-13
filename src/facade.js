// Procedural facade shader: windows, glass, brick, arches, balconies are drawn
// per pixel from per-vertex style attributes, so every building gets crisp,
// correctly sized windows without textures.
//   aFac = (style, floorHeight, bayWidth, groundFloorHeight)
//   aFuv = (metres along the wall, metres above the building's ground level)
import * as THREE from 'three';

export const WIN = {
  NONE: 0, CLASSIC: 1, GRID: 2, RIBBON: 3, CURTAIN: 4, APART: 5, BRICK: 6, ARCH: 7,
  GOTHIC: 8, INTERIOR: 9, ARCADE: 10, SHOP: 11, GREENHOUSE: 12, BRICKPLAIN: 13,
};

const GLSL = /* glsl */`
varying vec4 vFac;
varying vec2 vFuv;
float facGlass = 0.0;

float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fFill(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }

float brickMortar(vec2 uv) {
  float row = floor(uv.y / 0.075);
  float bx = fract(uv.x / 0.24 + mod(row, 2.0) * 0.5);
  float by = fract(uv.y / 0.075);
  float m = max(1.0 - smoothstep(0.0, 0.06, bx) + smoothstep(0.94, 1.0, bx), 1.0 - smoothstep(0.0, 0.14, by));
  return clamp(m, 0.0, 1.0);
}

void facadeShade(inout vec3 col) {
  int st = int(vFac.x + 0.5);
  if (st == 0) return;
  float fh = max(vFac.y, 1.0), bw = max(vFac.z, 0.5), gh = max(vFac.w, 1.0);
  float u = vFuv.x, v = vFuv.y;
  float aaU = fwidth(u), aaV = fwidth(v);
  float aaM = max(aaU, aaV) * 0.8 + 0.004;
  // distance fade: when a bay is only a few pixels wide, blend to its average colour
  float lod = smoothstep(0.18, 0.55, aaU / bw * 2.0);

  float flH = v < gh ? gh : fh;
  float fl = v < gh ? 0.0 : 1.0 + floor((v - gh) / fh);
  float py = v < gh ? v : mod(v - gh, fh);
  float bay = floor(u / bw);
  float px = (fract(u / bw) - 0.5) * bw;

  if (st == 9) { // exposed interior: concrete with floor slabs
    float slab = 1.0 - smoothstep(0.28, 0.34, py / flH * 3.0);
    col *= mix(1.0, 0.62, slab);
    return;
  }

  bool brick = (st == 6 || st == 10 || st == 13);
  if (brick) {
    float m = brickMortar(vec2(u, v));
    float tone = 0.88 + 0.22 * fHash(vec2(floor(u / 0.24 + mod(floor(v / 0.075), 2.0) * 0.5), floor(v / 0.075)));
    vec3 b = col * tone;
    b = mix(b, vec3(0.78, 0.76, 0.72), m * 0.85);
    col = mix(b, col * 0.97, lod);
    if (st == 13) return;
  }

  float ww = 0.6, y0 = 0.22, y1 = 0.82;
  if (st == 1) { ww = 0.42; y0 = 0.24; y1 = 0.80; }
  else if (st == 2) { ww = 0.68; y0 = 0.22; y1 = 0.84; }
  else if (st == 3) { ww = 1.02; y0 = 0.30; y1 = 0.82; }
  else if (st == 4) { ww = 1.02; y0 = 0.03; y1 = 0.99; }
  else if (st == 5) { ww = 0.84; y0 = 0.06; y1 = 0.86; }
  else if (st == 6) { ww = 0.44; y0 = 0.25; y1 = 0.80; }
  else if (st == 7) { ww = 0.44; y0 = 0.20; y1 = 0.86; }
  else if (st == 8) { ww = 0.32; y0 = 0.10; y1 = 0.92; }
  else if (st == 10) { ww = 0.64; y0 = -0.01; y1 = 0.86; }
  else if (st == 11) { ww = 0.86; y0 = 0.10; y1 = 0.92; }
  else if (st == 12) { ww = 1.02; y0 = -0.02; y1 = 1.02; }
  if (fl == 0.0 && (st == 1 || st == 2 || st == 7)) { y1 = 0.88; }
  float hw = ww * bw * 0.5, wy0 = y0 * flH, wy1 = y1 * flH;

  float d;
  if (st == 7 || st == 10) { // round arch
    float yc = wy1 - min(hw, (wy1 - wy0) * 0.5);
    d = py > yc ? length(vec2(px, py - yc)) - hw : max(abs(px) - hw, wy0 - py);
  } else if (st == 8) { // pointed gothic arch
    float R = hw * 1.7, yc = wy1 - R * 0.8;
    float dt = max(length(vec2(px - (R - hw), py - yc)), length(vec2(px + (R - hw), py - yc))) - R;
    d = py > yc ? max(dt, wy0 - py) : max(abs(px) - hw, wy0 - py);
  } else {
    d = max(abs(px) - hw, max(wy0 - py, py - wy1));
  }
  float m = fFill(d, aaM);
  float frame = fFill(d - 0.14, aaM) - m;

  vec3 glass = vec3(0.15, 0.19, 0.25);
  if (st == 4 || st == 2 || st == 3) glass = vec3(0.17, 0.25, 0.33);
  if (st == 10) glass = vec3(0.07, 0.06, 0.06);
  if (st == 12) glass = vec3(0.62, 0.74, 0.74);
  float r = fHash(vec2(bay, fl));
  glass *= 0.8 + 0.4 * r;
  glass += vec3(0.07, 0.08, 0.09) * smoothstep(0.3, 1.0, (py - wy0) / max(wy1 - wy0, 0.1));
  if (st != 10 && r > 0.82) glass = mix(glass, vec3(0.80, 0.78, 0.70), 0.35); // drawn blinds

  // mullions / transoms
  if (st == 2 || st == 3 || st == 4 || st == 11 || st == 12) {
    float mx = abs(fract(u / 1.25) - 0.5) * 1.25;
    float mull = 1.0 - smoothstep(0.035 - aaU, 0.035 + aaU, mx);
    float my = st == 4 ? abs(py - flH * 0.5) : 99.0;
    mull = max(mull, 1.0 - smoothstep(0.04 - aaV, 0.04 + aaV, my));
    glass = mix(glass, col * 0.7, mull * 0.8);
  }
  if (st == 5) { // balcony railing band
    float rail = smoothstep(wy0 - aaV, wy0 + aaV, py) * (1.0 - smoothstep(0.38 * flH - aaV, 0.38 * flH + aaV, py));
    glass = mix(glass, vec3(0.86, 0.87, 0.86), rail * 0.6);
  }

  vec3 c = col * (1.0 - frame * 0.33);
  if (st == 2 || st == 3 || st == 4) { // spandrel line at floor slabs
    float sl = 1.0 - smoothstep(0.0, 0.05 + aaV, abs(py - flH * 0.02));
    c *= 1.0 - 0.08 * sl;
  }
  c = mix(c, glass, m);
  float cover = clamp(ww, 0.0, 1.0) * clamp(y1 - y0, 0.0, 1.0);
  vec3 avg = mix(col * 0.95, glass, cover * 0.85);
  col = mix(c, avg, lod);
  facGlass = (st == 10 || st == 12) ? 0.0 : mix(m, cover * 0.6, lod);
  // grime / ambient occlusion towards the ground
  col *= mix(0.78, 1.0, smoothstep(-0.5, 2.5, v));
}
`;

export function makeFacadeMaterial(opts = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFac;\nattribute vec2 aFuv;\nvarying vec4 vFac;\nvarying vec2 vFuv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFac = aFac;\nvFuv = aFuv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\nfacadeShade(diffuseColor.rgb);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += facGlass * vec3(0.10, 0.13, 0.17);');
  };
  m.customProgramCacheKey = () => 'facade-v1';
  return m;
}
