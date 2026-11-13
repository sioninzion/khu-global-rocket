// Building models. Campus landmarks are modelled by hand from photo references
// (shape, storeys, colonnades, towers, roofs, materials); everything else gets a
// style from its OSM type (Korean apartment blocks, houses, schools, shops...).
import { WIN } from './facade.js?v=40';
import { obb, area, makeRng, pip } from './buildings.js?v=40';

// ------------------------------------------------------------ geometry helpers
const circle = (cx, cz, r, n = 12) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * Math.PI * 2) * r, cz + Math.sin(i / n * Math.PI * 2) * r]);

function frame(o) { // local (u along long axis, v across) -> world
  return (u, v) => [o.cx + o.ux * u + o.vx * v, o.cz + o.uz * u + o.vz * v];
}
function rectL(L, u0, u1, v0, v1) { return [L(u0, v0), L(u1, v0), L(u1, v1), L(u0, v1)]; }

function centroid(poly) {
  let x = 0, z = 0;
  for (const p of poly) { x += p[0]; z += p[1]; }
  return [x / poly.length, z / poly.length];
}

// keep the part of poly on the side (p - P)·N >= 0
function clipHalf(poly, P, N) {
  const out = [];
  const f = (p) => (p[0] - P[0]) * N[0] + (p[1] - P[1]) * N[1];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

// longest edge whose outward normal faces (dx, dz)
function facingEdge(poly, dx, dz) {
  const ccw = area(poly) > 0;
  let best = null, score = -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
    if (!ccw) { nx = -nx; nz = -nz; }
    const dot = nx * dx + nz * dz;
    if (dot > 0.7 && L * dot > score) { score = L * dot; best = { a, b, L, nx, nz, ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L }; }
  }
  return best;
}

// whole facade on one side: spans every edge facing the same way as the longest one
function facingSpan(poly, dx, dz) {
  const e = facingEdge(poly, dx, dz);
  if (!e) return null;
  const ccw = area(poly) > 0;
  const tx = e.ux, tz = e.uz;
  let s = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.5) continue;
    let nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
    if (!ccw) { nx = -nx; nz = -nz; }
    if (nx * e.nx + nz * e.nz < 0.95) continue;
    for (const p of [a, b]) {
      s = Math.max(s, p[0] * e.nx + p[1] * e.nz);
      const t = p[0] * tx + p[1] * tz;
      t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
  }
  const A = [e.nx * s + tx * t0, e.nz * s + tz * t0];
  return { a: A, b: [e.nx * s + tx * t1, e.nz * s + tz * t1], L: t1 - t0, nx: e.nx, nz: e.nz, ux: tx, uz: tz };
}

// ------------------------------------------------------------ styles
const STONE = '#ece9e2', STONE2 = '#e3ded3', MARBLE = '#f3f1ec', TRIM = '#f7f6f2';
const ROOF_GRAY = '#7c8287', ROOF_GREEN = '#6f7f78';
const COLUMN = { wall: MARBLE, trim: TRIM, win: WIN.NONE, cornice: { h: 1.1, d: 0.35 }, plinth: { h: 0.9, d: 0.3, col: '#dcd8cf' } };

const S = (o) => o;

// classical stone campus building (KHU Global campus look: white granite, giant order)
const classical = (o = {}) => S({
  wall: STONE, trim: TRIM, roof: ROOF_GRAY, win: WIN.CLASSIC, bay: 3.4, floorH: 4.2, groundH: 4.8,
  cornice: { h: 1.3, d: 0.9 }, parapet: 1.3, plinth: { h: 1.4, d: 0.35, col: '#d6d1c6' },
  bands: [{ y: 4.8, h: 0.45, d: 0.25 }], pilaster: { every: 2, w: 0.9, d: 0.32, from: 1.4 }, ...o,
});
const modernWhite = (o = {}) => S({
  wall: '#eeede9', trim: '#f5f5f2', roof: ROOF_GRAY, win: WIN.GRID, bay: 3.2, floorH: 4.0, groundH: 4.5,
  cornice: { h: 0.6, d: 0.35 }, parapet: 1.1, plinth: { h: 0.9, d: 0.2, col: '#cfcdc7' }, ...o,
});

// colonnade: free-standing columns in front of a facade edge + entablature on top
function colonnade(specs, edge, o) {
  const { offset = 4, spacing = 5.5, r = 0.85, h, pad = 3, entab = 2.4, depthBack = 0.4 } = o;
  const first = specs.length;
  const n = Math.max(2, Math.floor((edge.L - pad * 2) / spacing) + 1);
  const span = (n - 1) * spacing, s0 = (edge.L - span) / 2;
  const cols = [];
  for (let k = 0; k < n; k++) {
    const t = s0 + k * spacing;
    const cx = edge.a[0] + edge.ux * t + edge.nx * offset, cz = edge.a[1] + edge.uz * t + edge.nz * offset;
    cols.push(specs.length);
    specs.push({ poly: circle(cx, cz, r, 12), h, style: COLUMN });
  }
  const u0 = s0 - r * 2, u1 = s0 + span + r * 2;
  const P = (t, d) => [edge.a[0] + edge.ux * t + edge.nx * d, edge.a[1] + edge.uz * t + edge.nz * d];
  specs.push({
    poly: [P(u0, -depthBack), P(u1, -depthBack), P(u1, offset + r * 1.6), P(u0, offset + r * 1.6)],
    minY: h, h: entab, supports: cols, supportSpan: spacing * 0.9 + offset * 0.5,
    style: { wall: MARBLE, trim: TRIM, roof: ROOF_GRAY, win: WIN.NONE, cornice: { h: 0.9, d: 0.55 }, bands: [], parapet: 0.9 },
  });
  return { cols, entab: specs.length - 1, first };
}

// ------------------------------------------------------------ hand-made campus landmarks
const LANDMARKS = {
  // 네오르네상스 새천년기념탑 (main gate): triumphal arch + colonnaded wings with statues
  473963422(b) {
    const o = obb(b.p);
    const L = frame({ ...o, cx: o.cx, cz: o.cz });
    const specs = [];
    const gate = { wall: MARBLE, trim: TRIM, roof: ROOF_GRAY, win: WIN.NONE, cornice: { h: 1.2, d: 0.6 }, plinth: { h: 1.6, d: 0.35, col: '#dedad1' },
      pilaster: { every: 1, w: 1.0, d: 0.35, from: 1.6 }, bay: 2.2, floorH: 4, bands: [] };
    // centre of the arch: OSM central block sits slightly off the polygon centre
    const c0 = 0;
    specs.push({ poly: rectL(L, c0 - 8, c0 - 3.4, -3.6, 3.6), h: 21, style: gate }); // 0 left pier
    specs.push({ poly: rectL(L, c0 + 3.4, c0 + 8, -3.6, 3.6), h: 21, style: gate }); // 1 right pier
    specs.push({ poly: rectL(L, c0 - 8, c0 + 8, -3.6, 3.6), minY: 13.5, h: 7.5, supports: [0, 1], supportSpan: 9,
      style: { ...gate, pilaster: null, bands: [{ y: 17.5, h: 0.4, d: 0.25 }] } }); // 2 arch lintel
    specs.push({ poly: rectL(L, c0 - 5.5, c0 + 5.5, -2.6, 2.6), minY: 21, h: 3.2,
      style: { ...gate, pilaster: null, cornice: { h: 0.6, d: 0.4 }, plinth: null } }); // 3 attic
    specs.push({ poly: rectL(L, c0 - 1.4, c0 + 1.4, -1.2, 1.2), minY: 24.2, h: 3.4,
      style: { wall: '#8c8576', trim: '#9a9384', win: WIN.NONE }, roof: { type: 'pyramid', h: 1.2, color: '#8c8576' } }); // 4 statue group
    for (const side of [-1, 1]) {
      const uA = c0 + side * 8, uB = side < 0 ? o.hl * -1 + 0.5 : o.hl - 0.5;
      const lo = Math.min(uA, uB), hi = Math.max(uA, uB);
      const cols = [];
      const cs0 = side < 0 ? lo + 3.8 : lo + 1.8, cs1 = side < 0 ? hi - 1.8 : hi - 3.8;
      for (let u = cs0; u <= cs1 + 1e-6; u += 2.7) for (const v of [-2.3, 2.3]) {
        const [x, z] = L(u, v);
        cols.push(specs.length);
        specs.push({ poly: circle(x, z, 0.45, 10), h: 9.5, style: { ...COLUMN, cornice: { h: 0.7, d: 0.22 }, plinth: { h: 0.7, d: 0.2, col: '#dcd8cf' } } });
      }
      const endA = side < 0 ? lo : hi - 2.6, endB = side < 0 ? lo + 2.6 : hi;
      specs.push({ poly: rectL(L, endA, endB, -3.3, 3.3), h: 12.5, style: { ...gate, pilaster: null } }); // end pylon
      const ent = specs.length;
      specs.push({ poly: rectL(L, lo + 0.6, hi - 0.6, -3.1, 3.1), minY: 9.5, h: 2.3, supports: cols, supportSpan: 3.4,
        style: { ...gate, pilaster: null, plinth: null, cornice: { h: 0.6, d: 0.45 }, parapet: 0.8 } });
      for (let u = lo + 3; u <= hi - 3; u += 5.4) {
        const [x, z] = L(u, 0);
        specs.push({ poly: circle(x, z, 0.55, 8), minY: 11.8, h: 2.4,
          style: { wall: '#8c8576', trim: '#9a9384', win: WIN.NONE } });
      }
    }
    return specs;
  },

  // 중앙도서관: wide white granite block on a podium, giant colonnade facing 사색의 광장 (east)
  474085534(b) {
    const specs = [{ poly: b.p, h: 26, style: classical({ floorH: 4.6, groundH: 5.2, plinth: { h: 3.2, d: 0.6, col: '#d4cfc4' },
      bands: [{ y: 5.2, h: 0.5, d: 0.3 }, { y: 21.5, h: 0.4, d: 0.2 }], pilaster: { every: 2, w: 1.0, d: 0.35, from: 3.2, to: 21.5 } }) }];
    const e = facingSpan(b.p, 1, 0);
    if (e) {
      specs.push({ poly: [[e.a[0], e.a[1]], [e.b[0], e.b[1]], [e.b[0] + e.nx * 9, e.b[1] + e.nz * 9], [e.a[0] + e.nx * 9, e.a[1] + e.nz * 9]], h: 3.2,
        style: { wall: '#d9d4ca', trim: '#e6e2da', roof: '#cfcac0', win: WIN.NONE, cornice: { h: 0.4, d: 0.3 } } }); // podium terrace & steps
      colonnade(specs, e, { offset: 4.8, spacing: 6.2, r: 0.95, h: 23.6, pad: 4, entab: 2.6 });
    }
    return specs;
  },

  // 체육대학관 (old main building): neoclassical, Corinthian colonnade toward the plaza
  455726113(b) {
    const specs = [{ poly: b.p, h: 23, style: classical({ floorH: 4.4 }) }];
    const e = facingSpan(b.p, -1, 0);
    if (e) colonnade(specs, e, { offset: 4.2, spacing: 5.4, r: 0.85, h: 18.5, pad: 3, entab: 2.2 });
    return specs;
  },

  // 예술·디자인대학관: white neo-gothic, vertical piers, central tower with pinnacles (north front)
  474085536(b) {
    const st = classical({ wall: '#f2f0eb', win: WIN.GOTHIC, bay: 3.0, floorH: 4.2, groundH: 4.6, bands: [{ y: 4.6, h: 0.45, d: 0.3 }],
      pilaster: { every: 1, w: 0.75, d: 0.55, from: 1.4 }, cornice: { h: 1.2, d: 0.7 }, parapet: 1.6 });
    const specs = [{ poly: b.p, h: 30, style: st }];
    const e = facingEdge(b.p, 0, -1);
    if (e) {
      const mid = e.L / 2, tw = 15, td = 13;
      const P = (t, d) => [e.a[0] + e.ux * t + e.nx * d, e.a[1] + e.uz * t + e.nz * d];
      const tower = [P(mid - tw / 2, 1.5), P(mid + tw / 2, 1.5), P(mid + tw / 2, -td), P(mid - tw / 2, -td)];
      specs.push({ poly: tower, h: 44, style: { ...st, cornice: { h: 1.0, d: 0.6 }, parapet: 1.2 } });
      const ti = specs.length - 1;
      for (const [t, d] of [[mid - tw / 2 + 1, 0.5], [mid + tw / 2 - 1, 0.5], [mid - tw / 2 + 1, -td + 1], [mid + tw / 2 - 1, -td + 1]]) {
        const [x, z] = P(t, d);
        specs.push({ poly: circle(x, z, 0.9, 8), minY: 44, h: 4,
          style: { wall: '#f2f0eb', trim: TRIM, win: WIN.NONE }, roof: { type: 'pyramid', h: 4.5, color: '#e9e6e0' } });
      }
      const [cx, cz] = P(mid, -td / 2 + 0.75);
      specs.push({ poly: circle(cx, cz, 3.2, 8), minY: 44, h: 3,
        style: { wall: '#f2f0eb', trim: TRIM, win: WIN.GOTHIC, bay: 2.4, floorH: 3 }, roof: { type: 'pyramid', h: 7, color: '#6d7a7d' } });
      // glass roof over the central entrance
      specs.push({ poly: [P(mid - 6, 6), P(mid + 6, 6), P(mid + 6, 1.5), P(mid - 6, 1.5)], h: 5.5,
        style: { wall: '#cfe0e6', trim: TRIM, win: WIN.CURTAIN, bay: 2, floorH: 5.5 }, roof: { type: 'gable', h: 1.6, axis: [e.nx, e.nz], color: '#b8ced6' } });
    }
    return specs;
  },

  // 공학관: white modern "robot" - long spine with two arms, taller core
  455725718(b) {
    const st = modernWhite({ floorH: 3.9, bay: 3.3 });
    const specs = [{ poly: b.p, h: 27, style: st }];
    const o = obb(b.p);
    const L = frame(o);
    specs.push({ poly: rectL(L, -8, 8, -6, 6), minY: 27, h: 6, style: { ...st, win: WIN.RIBBON, parapet: 1, cornice: { h: 0.5, d: 0.3 } } });
    return specs;
  },

  // 전자정보대학관 + 응용과학대학관 (brick, older) around a courtyard
  474085540(b) {
    const [cx, cz] = centroid(b.p);
    const west = clipHalf(b.p, [cx, cz], [-1, 0]), east = clipHalf(b.p, [cx, cz], [1, 0]);
    const specs = [];
    if (east.length >= 3) specs.push({ poly: east, h: 30, style: modernWhite({ wall: '#e8e8e5', floorH: 4.1, bay: 3.0, win: WIN.GRID,
      pilaster: { every: 1, w: 0.4, d: 0.7, from: 4.5 }, cornice: { h: 0.8, d: 0.6 } }) });
    if (west.length >= 3) specs.push({ poly: west, h: 21, style: { wall: '#9b4f3b', trim: '#efece6', roof: ROOF_GRAY, win: WIN.BRICK, bay: 3.2, floorH: 4.0,
      cornice: { h: 0.9, d: 0.5 }, parapet: 1.0, plinth: { h: 1.0, d: 0.2, col: '#d0ccc2' }, bands: [{ y: 4.0, h: 0.35, d: 0.15 }] } });
    return specs;
  },

  // 우정원: big white dormitory with blue glass and a pediment on the front
  8269760(b) {
    const st = modernWhite({ wall: '#f0eeea', floorH: 3.3, groundH: 4.6, bay: 3.1, win: WIN.GRID, cornice: { h: 0.9, d: 0.6 },
      plinth: { h: 1.4, d: 0.3, col: '#c9c6bf' }, bands: [{ y: 4.6, h: 0.4, d: 0.25 }] });
    const specs = [{ poly: b.p, h: 31, style: st }];
    const e = facingEdge(b.p, 1, 0);
    if (e) {
      const P = (t, d) => [e.a[0] + e.ux * t + e.nx * d, e.a[1] + e.uz * t + e.nz * d];
      const m = e.L / 2;
      specs.push({ poly: [P(m - 12, 0.6), P(m + 12, 0.6), P(m + 12, -4), P(m - 12, -4)], minY: 31, h: 1.2,
        style: { ...st, win: WIN.NONE, cornice: null, parapet: 0, plinth: null, bands: [] }, roof: { type: 'gable', h: 5.5, axis: [e.nx, e.nz], color: '#e9e7e2' } });
    }
    return specs;
  },

  // 선승관 (종합체육관): round red-brick arena with arched arcades and a low dome
  585696506(b) {
    const o = obb(b.p);
    const round = b.p.filter(p => p[1] < o.cz + o.hl * 0.2);
    let cx = 0, cz = 0;
    for (const p of round) { cx += p[0]; cz += p[1]; }
    cx /= round.length; cz /= round.length;
    return [{ poly: b.p, h: 21, style: { wall: '#a8573f', trim: '#ece7de', roof: '#8f9c98', win: WIN.ARCADE, bay: 4.4, floorH: 7, groundH: 7,
      cornice: { h: 1.0, d: 0.6 }, plinth: { h: 1.0, d: 0.25, col: '#d8d2c7' }, bands: [{ y: 7, h: 0.5, d: 0.3 }, { y: 14, h: 0.5, d: 0.3 }] },
    roof: { type: 'dome', h: 13, center: [cx, cz] } }];
  },

  // 평화의 노천극장: stone seating bowl with a temple-front stage colonnade
  474531805(b) {
    const [cx, cz] = centroid(b.p);
    const specs = [{ poly: b.p, h: 0.6, style: { wall: '#c9c3b6', trim: '#ddd8cd', roof: '#b9b3a6', win: WIN.NONE }, roof: { type: 'bowl', h: 9, center: [cx, cz] } }];
    const e = facingEdge(b.p, 0.7, -0.7) || facingEdge(b.p, 1, 0);
    if (e) colonnade(specs, e, { offset: 3, spacing: 3.6, r: 0.55, h: 8, pad: 4, entab: 1.6, depthBack: 0.2 });
    return specs;
  },

  // 외국어대학관: white modern, two round blocks joined by a linear block (phone handset)
  585696507: (b) => [{ poly: b.p, h: 20, style: modernWhite({ win: WIN.RIBBON, floorH: 4.0, bay: 3.0, cornice: { h: 0.7, d: 0.5 } }) }],
  // 학생회관
  474085535: (b) => [{ poly: b.p, h: 22, style: classical({ floorH: 4.2 }) }],
  // 생명과학대학: beige block with its tall chimney ("목욕탕")
  474521121(b) {
    const o = obb(b.p);
    const L = frame(o);
    return [{ poly: b.p, h: 21, style: modernWhite({ wall: '#e9e2d4', win: WIN.GRID, floorH: 4.0 }) },
      { poly: rectL(L, o.hl - 4.5, o.hl - 1, -1.8, 1.8), h: 35, style: { wall: '#dcd4c6', trim: '#ece7de', win: WIN.NONE, cornice: { h: 0.6, d: 0.3 } } }];
  },
  // 국제대학 (아태관): classical with arched windows
  474085539: (b) => [{ poly: b.p, h: 21, style: classical({ win: WIN.ARCH, floorH: 4.0 }) }],
  474085542: (b) => [{ poly: b.p, h: 17, style: classical({ floorH: 4.0 }) }], // 국제학관
  474085537: (b) => [{ poly: b.p, h: 33, style: modernWhite({ floorH: 4.0 }) }], // 멀티미디어교육관 (8F)
  474085538: (b) => [{ poly: b.p, h: 22, style: modernWhite({ floorH: 4.2 }) }], // 글로벌관
  6739958: (b) => dorm(b, 12), // 제2기숙사 남자동
  6739964: (b) => dorm(b, 10), // 제2기숙사 여자동
  170482640: (b) => dorm(b, 6), // 애지원
  // 천문대: small block with an observatory dome
  474521125(b) {
    const o = obb(b.p);
    return [{ poly: b.p, h: 12, style: classical({ floorH: 4, pilaster: null }) },
      { poly: circle(o.cx, o.cz, Math.min(o.hw, 7) * 0.85, 16), minY: 12, h: 1.6, style: { wall: '#d7dbdf', trim: '#e6e8ea', win: WIN.NONE },
        roof: { type: 'dome', h: Math.min(o.hw, 7) * 0.85, color: '#cfd5da' } }];
  },
  // 원예생물공학 온실: concrete base with a glass greenhouse on the roof
  474521122(b) {
    const o = obb(b.p);
    const L = frame(o);
    return [{ poly: b.p, h: 8, style: modernWhite({ floorH: 4 }) },
      { poly: rectL(L, -o.hl * 0.75, o.hl * 0.75, -o.hw * 0.7, o.hw * 0.7), minY: 8, h: 3.2,
        style: { wall: '#d3e6e8', trim: '#eef3f3', win: WIN.GREENHOUSE, bay: 2, floorH: 3.2 }, roof: { type: 'gable', h: 2.6, color: '#c7dfe2' } }];
  },
  474521123: (b) => [{ poly: b.p, h: 11, style: { wall: '#9e5741', trim: '#ece6dc', roof: ROOF_GRAY, win: WIN.BRICK, bay: 3.2, floorH: 3.6, cornice: { h: 0.6, d: 0.3 }, parapet: 0.8 } }], // 도예관
  455728922: (b) => [{ poly: b.p, h: 12, style: modernWhite({ wall: '#cfd1d2', win: WIN.RIBBON, floorH: 4, cornice: null, parapet: 0 }), roof: { type: 'gable', h: 2.4, color: '#6f7a83' } }], // 공학실험동
  455728923: (b) => [{ poly: b.p, h: 15, style: { wall: '#c4c1ba', trim: '#d7d4cd', roof: ROOF_GRAY, win: WIN.RIBBON, bay: 6, floorH: 7, groundH: 7, parapet: 1 } }], // 원자로센터
};

function dorm(b, floors) {
  const st = modernWhite({ wall: '#e7e6e1', floorH: 3.1, groundH: 4.2, bay: 2.9, win: WIN.GRID, cornice: { h: 0.6, d: 0.4 }, parapet: 1.2 });
  const o = obb(b.p);
  const L = frame(o);
  const H = 4.2 + (floors - 1) * 3.1;
  return [{ poly: b.p, h: H, style: st },
    { poly: rectL(L, -Math.min(6, o.hl * 0.4), Math.min(6, o.hl * 0.4), -Math.min(4, o.hw * 0.6), Math.min(4, o.hw * 0.6)), minY: H, h: 4,
      style: { ...st, win: WIN.NONE, parapet: 0.8 } }];
}

// ------------------------------------------------------------ generic buildings by type
const APT_WALL = ['#f3f1ec', '#efece5', '#f2efe8', '#ebe8e2'];
const APT_ROOF = ['#3d5a7a', '#5b6670', '#4f6b5a', '#7a4a3c', '#6d6f73'];
const HOUSE_WALL = ['#e8dfcf', '#d9c8ae', '#f0ebe1', '#c49a7c', '#a8644c', '#e3e0d9'];
const HOUSE_ROOF = ['#8e3b2e', '#46505a', '#3f5f7d', '#5a6e4a', '#6b4a3a'];
const SHOP_WALL = ['#dcd7cd', '#c9cdd1', '#e6e1d6', '#b9b4aa', '#d6cbbb'];

function generic(b, rnd, inCampus) {
  const k = b.k, ar = Math.abs(area(b.p)), h = b.h, lv = Math.max(1, b.lv);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const o = obb(b.p);
  const L = frame(o);
  if (k === 'apartments' || (lv >= 9 && !inCampus)) {
    const fl = h / lv;
    const st = { wall: pick(APT_WALL), trim: '#f7f6f3', roof: '#8a8e91', win: WIN.APART, bay: 3.3, floorH: fl, groundH: fl * 1.4,
      parapet: 1.4, plinth: { h: 1.2, d: 0.15, col: '#c8c4bb' }, blankAxis: o.hl > o.hw * 1.6 ? [o.vx, o.vz] : null, minWinEdge: 4 };
    return [{ poly: b.p, h, style: st },
      { poly: rectL(L, -Math.min(o.hl * 0.42, 14), Math.min(o.hl * 0.42, 14), -o.hw * 0.75, o.hw * 0.75), minY: h, h: 3.2,
        style: { ...st, win: WIN.NONE, parapet: 0, plinth: null, blankAxis: null }, roof: { type: 'hip', h: 3.2, color: pick(APT_ROOF) } }];
  }
  if (inCampus) {
    const fl = 4;
    return [{ poly: b.p, h: Math.max(h, 8), style: rnd() < 0.5 ? classical({ floorH: fl, pilaster: ar > 600 ? { every: 2, w: 0.8, d: 0.3, from: 1.4 } : null })
      : modernWhite({ floorH: fl }) }];
  }
  if (k === 'house' || (ar < 180 && rnd() < 0.6)) {
    const fl = 2.9, hh = Math.max(lv, 2) * fl;
    return [{ poly: b.p, h: hh, style: { wall: pick(HOUSE_WALL), trim: '#f1ede5', win: WIN.CLASSIC, bay: 3.0, floorH: fl, groundH: fl, minWinEdge: 2.2,
      cornice: { h: 0.3, d: 0.45 } }, roof: { type: rnd() < 0.55 ? 'gable' : 'hip', h: Math.min(o.hw * 0.75, 3.6), color: pick(HOUSE_ROOF) } }];
  }
  if (k === 'school' || k === 'kindergarten' || k === 'college') {
    return [{ poly: b.p, h: Math.max(lv, 4) * 3.8, style: { wall: '#efe5cf', trim: '#f6f1e6', roof: ROOF_GREEN, win: WIN.RIBBON, bay: 3.4, floorH: 3.8,
      groundH: 3.8, parapet: 1.0, cornice: { h: 0.4, d: 0.3 }, plinth: { h: 0.8, d: 0.15, col: '#b9a990' } } }];
  }
  if (k === 'commercial' || k === 'retail' || ar > 300) {
    const fl = 3.8;
    return [{ poly: b.p, h: Math.max(lv, 2) * fl, style: { wall: pick(SHOP_WALL), trim: '#eceae6', roof: '#7d8186', win: rnd() < 0.4 ? WIN.CURTAIN : WIN.GRID,
      bay: 3.6, floorH: fl, groundH: 4.4, parapet: 1.0, cornice: { h: 0.4, d: 0.25 } } }];
  }
  // low-rise villa / misc
  const fl = 2.9;
  return [{ poly: b.p, h: Math.max(lv, 2) * fl + 0.6, style: { wall: pick(HOUSE_WALL), trim: '#eeeae2', roof: '#808488', win: rnd() < 0.3 ? WIN.BRICK : WIN.CLASSIC,
    bay: 3.0, floorH: fl, groundH: fl, parapet: 0.9, minWinEdge: 2.2, cornice: { h: 0.3, d: 0.3 } } }];
}

export function buildStructures(data) {
  const out = [];
  for (const b of data.buildings) {
    const rnd = makeRng(b.id % 2147483647 || 1);
    const [cx, cz] = centroid(b.p);
    const inCampus = data.campus.some(poly => pip(poly, cx, cz));
    const fn = LANDMARKS[b.id];
    let specs;
    try { specs = fn ? fn(b, rnd) : generic(b, rnd, inCampus); } catch (e) { console.warn('model failed', b.id, e); specs = null; }
    if (!specs || !specs.length) specs = generic(b, rnd, inCampus);
    out.push({ id: b.id, name: b.n, kind: b.k, base: b.b, inCampus, landmark: !!fn, specs });
  }
  return out;
}
