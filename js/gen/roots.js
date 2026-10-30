// Roots: a botanical-engraving root system grown by space colonization.
// Attractors are scattered in a soil ellipse below the ground line (and an optional
// crown ellipse above it). Nodes grow from a collar at the ground line toward them,
// with gravitropism and noise wander. Thickness comes from the pipe model
// (r^p summed over children), so roots taper from the trunk to hair-thin tips.
// Strokes are cached on an offscreen layer that is revealed by birth iteration.

const TAU = Math.PI * 2;
const HOLD = 3.5; // seconds the finished drawing stays up before the growth loops

// ---- uniform spatial grid ---------------------------------------------------
function makeGrid(cell) {
  return { cell: Math.max(1, cell), m: new Map() };
}
const cellKey = (i, j) => ((i + 4096) << 13) ^ (j + 4096);
function gAdd(g, x, y, id) {
  const k = cellKey(Math.floor(x / g.cell), Math.floor(y / g.cell));
  let a = g.m.get(k);
  if (!a) g.m.set(k, (a = []));
  a.push(id);
}
// Visit every id whose cell touches the square of half-size r around (x, y).
function gEach(g, x, y, r, fn) {
  const i0 = Math.floor((x - r) / g.cell), i1 = Math.floor((x + r) / g.cell);
  const j0 = Math.floor((y - r) / g.cell), j1 = Math.floor((y + r) / g.cell);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const a = g.m.get(cellKey(i, j));
      if (a) for (let q = 0; q < a.length; q++) fn(a[q]);
    }
  }
}

// ---- attractors -------------------------------------------------------------
function sampleEllipse(rng, cx, cy, rx, ry, n, ok) {
  const A = { x: [], y: [], alive: [] };
  let guard = 0;
  while (A.x.length < n && guard++ < n * 60) {
    const u = rng.range(-1, 1), v = rng.range(-1, 1);
    if (u * u + v * v > 1) continue;
    const x = cx + u * rx, y = cy + v * ry;
    if (!ok(x, y)) continue;
    A.x.push(x); A.y.push(y); A.alive.push(1);
  }
  return A;
}

// ---- space colonization -----------------------------------------------------
// N: shared node list {x,y,p,b,sys}. starts: node ids already in the system.
// o: { dInfl, dKill, step, tx, ty, g, wander, nf, off, maxIter, sys }
function grow(env, N, starts, A, o) {
  const { rng, noise } = env;
  const ng = makeGrid(o.dInfl), ag = makeGrid(o.dKill);
  const dK2 = o.dKill * o.dKill, dI2 = o.dInfl * o.dInfl;
  const kill = (x, y) =>
    gEach(ag, x, y, o.dKill, (i) => {
      if (!A.alive[i]) return;
      const dx = A.x[i] - x, dy = A.y[i] - y;
      if (dx * dx + dy * dy < dK2) A.alive[i] = 0;
    });
  for (const id of starts) gAdd(ng, N[id].x, N[id].y, id);
  for (let i = 0; i < A.x.length; i++) gAdd(ag, A.x[i], A.y[i], i);
  for (const id of starts) kill(N[id].x, N[id].y);
  let live = [];
  for (let i = 0; i < A.x.length; i++) if (A.alive[i]) live.push(i);

  for (let k = 1; k <= o.maxIter && live.length; k++) {
    const sum = new Map();
    for (const i of live) {
      const x = A.x[i], y = A.y[i];
      let best = -1, bd = dI2;
      gEach(ng, x, y, o.dInfl, (n) => {
        const dx = x - N[n].x, dy = y - N[n].y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = n; }
      });
      if (best < 0) continue;
      const d = Math.sqrt(bd) || 1e-6;
      let e = sum.get(best);
      if (!e) sum.set(best, (e = [0, 0]));
      e[0] += (x - N[best].x) / d;
      e[1] += (y - N[best].y) / d;
    }
    if (!sum.size) break;
    const born = [];
    for (const [n, e] of sum) {
      const L = Math.hypot(e[0], e[1]);
      if (L < 1e-9) continue;
      const dx0 = e[0] / L + o.tx * o.g, dy0 = e[1] / L + o.ty * o.g;
      const a = o.wander * (noise.noise2(N[n].x * o.nf, N[n].y * o.nf + o.off) * 1.8 + rng.gauss() * 0.12);
      const c = Math.cos(a), sn = Math.sin(a);
      const rx = dx0 * c - dy0 * sn, ry = dx0 * sn + dy0 * c;
      const dl = Math.hypot(rx, ry) || 1;
      N.push({ x: N[n].x + (rx / dl) * o.step, y: N[n].y + (ry / dl) * o.step, p: n, b: k - 1 + (born.length + 1) / (sum.size + 1), sys: o.sys });
      born.push(N.length - 1);
    }
    for (const id of born) {
      gAdd(ng, N[id].x, N[id].y, id);
      kill(N[id].x, N[id].y);
    }
    live = live.filter((i) => A.alive[i]);
  }
}

// Seeds a chain of nodes from `parent` with heading `ang` (radians from straight down,
// positive = toward +x). The heading relaxes toward vertical, so laterals arc downward.
function chain(env, N, parent, ang, n, b0, bStep, sys, step, bend) {
  const { rng } = env;
  let prev = parent, x = N[parent].x, y = N[parent].y, a = ang;
  const ids = [];
  for (let i = 0; i < n; i++) {
    a = a * (1 - bend) + rng.gauss() * 0.12;
    x += Math.sin(a) * step;
    y += Math.cos(a) * step;
    N.push({ x, y, p: prev, b: b0 + i * bStep, sys });
    prev = N.length - 1;
    ids.push(prev);
  }
  return ids;
}

function lowerBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= v) lo = m + 1; else hi = m;
  }
  return lo;
}

// ---- drawing ----------------------------------------------------------------
const LX = -0.6, LY = -0.8; // light comes from the upper left

function renderItem(g, it, S, P) {
  const N = S.N, R = S.R, s = S.s;
  if (it.t === 0) {
    const c = it.c, p = N[c].p;
    const px = N[p].x, py = N[p].y, cx = N[c].x, cy = N[c].y;
    const pr = R[p], cr = R[c];
    let dx = cx - px, dy = cy - py;
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) return;
    dx /= L; dy /= L;
    const nx = -dy, ny = dx;
    g.fillStyle = P.ink;
    g.beginPath();
    g.moveTo(px + nx * pr, py + ny * pr);
    g.lineTo(cx + nx * cr, cy + ny * cr);
    g.lineTo(cx - nx * cr, cy - ny * cr);
    g.lineTo(px - nx * pr, py - ny * pr);
    g.closePath();
    g.fill();
    if (cr > 0.6 * s) {
      g.beginPath();
      g.arc(cx, cy, cr, 0, TAU);
      g.fill();
    }
    if (cr > 2.6 * s) {
      g.strokeStyle = P.paper;
      g.globalAlpha = 0.28;
      g.lineWidth = 0.5 * s;
      for (const o2 of [-0.45, 0.2]) {
        g.beginPath();
        g.moveTo(px + nx * pr * o2, py + ny * pr * o2);
        g.lineTo(cx + nx * cr * o2, cy + ny * cr * o2);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    if (cr > 1.6 * s) {
      const side = nx * LX + ny * LY >= 0 ? 1 : -1;
      const o = 0.42;
      g.strokeStyle = P.paper;
      g.globalAlpha = 0.5;
      g.lineWidth = Math.max(0.5 * s, cr * 0.26);
      g.beginPath();
      g.moveTo(px + nx * side * pr * o, py + ny * side * pr * o);
      g.lineTo(cx + nx * side * cr * o, cy + ny * side * cr * o);
      g.stroke();
      g.globalAlpha = 1;
    }
  } else if (it.t === 1) {
    // root hair
    g.strokeStyle = P.accent;
    g.lineWidth = 0.6 * s;
    g.beginPath();
    g.moveTo(it.x, it.y);
    g.quadraticCurveTo(it.x + it.dx * it.l * 0.5 + it.bx, it.y + it.dy * it.l * 0.5 + it.by, it.x + it.dx * it.l, it.y + it.dy * it.l);
    g.stroke();
  } else if (it.t === 2) {
    // leaf cluster: stippled dots
    g.fillStyle = P.ink;
    for (const d of it.dots) {
      g.beginPath();
      g.arc(it.x + d[0], it.y + d[1], d[2], 0, TAU);
      g.fill();
    }
  } else if (it.t === 3) {
    // leaf blade: outlined ellipse with paper fill
    g.beginPath();
    g.ellipse(it.x, it.y, it.len * 0.5, it.wid * 0.5, it.ang, 0, TAU);
    g.fillStyle = P.paper;
    g.fill();
    g.strokeStyle = P.ink;
    g.lineWidth = 0.8 * s;
    g.stroke();
  }
}

export default {
  id: 'roots',
  name: 'Roots',
  blurb: 'A root system grown toward buried attractors, tapered by the pipe model, and cut into the paper like an engraving.',
  restartOnPlay: true,
  params: [
    { key: 'ground', label: 'Ground', type: 'knob', min: 0.2, max: 0.8, step: 0.01, default: 0.4, group: 'Soil' },
    { key: 'depth', label: 'Depth', type: 'knob', min: 0.15, max: 1, step: 0.01, default: 0.6, group: 'Soil' },
    { key: 'spread', label: 'Spread', type: 'knob', min: 0.15, max: 1, step: 0.01, default: 0.6, group: 'Soil' },
    { key: 'branching', label: 'Branching', type: 'knob', min: 20, max: 220, step: 1, default: 42, unit: 'px', group: 'Growth' },
    { key: 'gravity', label: 'Gravitropism', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.35, group: 'Growth' },
    { key: 'wander', label: 'Wander', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.35, group: 'Growth' },
    { key: 'step', label: 'Step', type: 'knob', min: 3, max: 20, step: 0.5, default: 8, unit: 'px', group: 'Growth' },
    { key: 'taper', label: 'Taper', type: 'knob', min: 1.6, max: 3.2, step: 0.05, default: 2.4, group: 'Growth' },
    { key: 'thickness', label: 'Max thickness', type: 'knob', min: 4, max: 40, step: 0.5, default: 16, unit: 'px', group: 'Growth' },
    { key: 'hairs', label: 'Root hairs', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Growth' },
    { key: 'speed', label: 'Growth speed', type: 'knob', min: 1, max: 60, step: 0.5, default: 8, unit: ' it/s', live: true, group: 'Growth' },
    { key: 'tree', label: 'Tree', type: 'toggle', default: true, group: 'Tree' },
    { key: 'crown', label: 'Crown size', type: 'knob', min: 0.2, max: 1, step: 0.01, default: 0.7, group: 'Tree' },
    { key: 'leaves', label: 'Leaf density', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Tree' },
    { key: 'texture', label: 'Soil texture', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Line' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#2b1d14', group: 'Color' },
    { key: 'paper', label: 'Paper', type: 'color', default: '#efe7d8', group: 'Color' },
    { key: 'accent', label: 'Accent (tips)', type: 'color', default: '#8c3b22', group: 'Color' },
    { key: 'seed', label: 'Seed', type: 'seed', default: 1234, group: 'Seed' },
  ],

  setup(env) {
    const { w, h, params: P, rng, noise, state: S } = env;
    const s = Math.min(w, h) / 1200;
    const gy = P.ground * h;
    const cx = w / 2;
    const below = h - gy - 0.02 * h;
    const above = gy - 0.03 * h;
    const step = P.step * s;
    const dInfl = P.branching * s;
    const dKill = step * 1.6;

    // ---- growth -----------------------------------------------------------
    const N = [];
    N.push({ x: cx, y: gy, p: -1, b: 0, sys: 0 }); // collar at the ground line
    const rootIds = [0];

    // Taproot seed, straight down with a slight drift.
    const rRy = P.depth * below * 0.5;
    const rRx = P.spread * w * 0.44;
    const tapLen = Math.max(3, Math.round((rRy * 1.2) / step));
    const tap = [0];
    {
      let prev = 0, x = cx, y = gy;
      for (let i = 0; i < tapLen; i++) {
        x += rng.gauss() * step * 0.12;
        y += step;
        N.push({ x, y, p: prev, b: i * 0.15, sys: 0 });
        prev = N.length - 1;
        tap.push(prev);
        rootIds.push(prev);
      }
    }
    // Laterals off the taproot, arcing down and out.
    const nLat = rng.int(3, 5);
    for (let i = 0; i < nLat; i++) {
      const j = Math.floor(rng.range(0.12, 0.8) * (tap.length - 1));
      const side = rng.chance(0.5) ? 1 : -1;
      const ids = chain(env, N, tap[j], side * rng.range(0.75, 1.25), rng.int(4, 8), N[tap[j]].b + 1.2, 0.15, 0, step, 0.12);
      rootIds.push(...ids);
    }
    // Two near-surface spreaders from the collar, for the shallow fan.
    for (const side of [-1, 1]) {
      const ids = chain(env, N, 0, side * rng.range(1.2, 1.45), rng.int(4, 6), 0.4, 0.15, 0, step, 0.1);
      rootIds.push(...ids);
    }

    // Root attractors: an ellipse below the ground line. Spread widens it, depth deepens it.
    const RA = sampleEllipse(rng, cx, gy + rRy, rRx, rRy, 2600, (x, y) => {
      if (y < gy + 2 * s || y > h - 0.02 * h) return false;
      const f = (y - gy) / (rRy * 2); // 0 at the surface, 1 at the bottom of the ellipse
      return rng() < 0.35 + 0.65 * (1 - f);
    });
    grow(env, N, rootIds, RA, {
      dInfl, dKill, step, tx: 0, ty: 1, g: P.gravity, wander: P.wander,
      nf: 1 / (140 * s), off: 17.3, maxIter: 700, sys: 0,
    });

    // Crown: a trunk from the collar, then branches growing upward toward a blob of attractors.
    if (P.tree) {
      const trunkH = above * 0.36;
      const nT = Math.max(3, Math.round(trunkH / step));
      const trunkIds = [];
      let prev = 0, x = cx;
      for (let i = 0; i < nT; i++) {
        x += rng.gauss() * step * 0.05;
        N.push({ x, y: gy - (i + 1) * step, p: prev, b: 0.5 + i * 0.15, sys: 1 });
        prev = N.length - 1;
        trunkIds.push(prev);
      }
      const ry = P.crown * above * 0.4;
      const ccy = gy - trunkH - ry * 0.9;
      const CA = sampleEllipse(rng, cx, ccy, ry * 1.3, ry, 1100, (x2, y2) => y2 > 0.02 * h);
      grow(env, N, trunkIds, CA, {
        dInfl, dKill, step, tx: 0, ty: -1, g: P.gravity * 0.5, wander: P.wander,
        nf: 1 / (140 * s), off: 41.7, maxIter: 700, sys: 1,
      });
    }

    // ---- pipe model thickness ----------------------------------------------
    const M = N.length;
    const kids = new Int32Array(M);
    for (let i = 0; i < M; i++) if (N[i].p >= 0) kids[N[i].p]++;
    const sumP = new Float64Array(M), rad = new Float64Array(M), pe = P.taper;
    for (let i = M - 1; i >= 0; i--) {
      const r = kids[i] ? Math.pow(sumP[i], 1 / pe) : 1;
      rad[i] = r;
      if (N[i].p >= 0) sumP[N[i].p] += Math.pow(r, pe);
    }
    const k = (P.thickness * s) / Math.max(1e-6, rad[0]);
    const R = new Float64Array(M);
    let maxB = 0;
    for (let i = 0; i < M; i++) {
      R[i] = Math.max(0.22 * s, rad[i] * k);
      if (N[i].b > maxB) maxB = N[i].b;
    }

    // ---- items to reveal, sorted by birth -----------------------------------
    const items = [];
    for (let i = 1; i < M; i++) if (N[i].p >= 0) items.push({ t: 0, c: i, b: N[i].b });

    // Root hairs along fine roots.
    for (let i = 1; i < M; i++) {
      if (N[i].sys !== 0 || R[i] > 1.0 * s || !rng.chance(P.hairs * 0.8)) continue;
      const p = N[i].p;
      let dx = N[i].x - N[p].x, dy = N[i].y - N[p].y;
      const L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      const nx = -dy, ny = dx;
      const count = rng.int(1, 3);
      for (let q = 0; q < count; q++) {
        const side = rng.chance(0.5) ? 1 : -1;
        const hx = dx * 0.8 + nx * side * 0.45, hy = dy * 0.8 + ny * side * 0.45;
        const hl = Math.hypot(hx, hy);
        items.push({
          t: 1, x: N[i].x, y: N[i].y, dx: hx / hl, dy: hy / hl,
          l: rng.range(2, 5) * s * (0.5 + P.hairs * 0.5),
          bx: rng.gauss() * 0.6 * s, by: rng.gauss() * 0.6 * s,
          b: N[i].b + rng.range(0.2, 1.5),
        });
      }
    }

    // Crown tips: leaf stipple clusters and a few blades.
    for (let i = 1; i < M; i++) {
      if (N[i].sys !== 1 || kids[i] || !rng.chance(P.leaves)) continue;
      const dots = [];
      const nd = rng.int(7, 16);
      const rr = rng.range(4, 11) * s;
      for (let q = 0; q < nd; q++) {
        const a = rng.range(0, TAU), d = Math.sqrt(rng.range(0, 1)) * rr;
        dots.push([Math.cos(a) * d, Math.sin(a) * d, rng.range(0.7, 1.6) * s]);
      }
      items.push({ t: 2, x: N[i].x, y: N[i].y, dots, b: N[i].b + 1 });
      const p = N[i].p;
      const base = Math.atan2(N[i].y - N[p].y, N[i].x - N[p].x);
      const nb = rng.int(0, 2);
      for (let q = 0; q < nb; q++) {
        items.push({
          t: 3, x: N[i].x + rng.gauss() * 3 * s, y: N[i].y + rng.gauss() * 3 * s,
          ang: base + rng.gauss() * 0.7, len: rng.range(14, 22) * s, wid: rng.range(6, 9) * s,
          b: N[i].b + 1.5 + q * 0.3,
        });
      }
    }
    items.sort((a, b) => a.b - b.b);
    const births = new Float64Array(items.length);
    for (let i = 0; i < items.length; i++) births[i] = items[i].b;

    // ---- static layer: paper, soil, ground line ------------------------------
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    };
    const bg = mk();
    const bx2 = bg.getContext('2d');
    bx2.fillStyle = P.paper;
    bx2.fillRect(0, 0, w, h);
    // paper tooth
    bx2.fillStyle = P.ink;
    for (let i = 0; i < (w * h) / 700; i++) {
      bx2.globalAlpha = rng.range(0.02, 0.06);
      bx2.fillRect(rng() * w, rng() * h, 1, 1);
    }
    bx2.globalAlpha = 1;
    const tex = P.texture;
    if (tex > 0) {
      // horizontal hatch in the soil, thinning with depth
      for (let y = gy + 4 * s; y < h; y += (2.2 + 9 * Math.pow((y - gy) / (h - gy), 0.8)) * s * rng.range(0.8, 1.2)) {
        const f = (y - gy) / (h - gy);
        const n = Math.round((w / (34 * s)) * tex * (1 - f) * 1.0);
        bx2.strokeStyle = P.ink;
        for (let q = 0; q < n; q++) {
          const x0 = rng() * w;
          const dens = 0.35 + 0.65 * (0.5 + 0.5 * noise.noise2(x0 * 0.004, y * 0.02));
          if (rng() > dens) continue;
          const len = rng.range(20, 150) * s * (1 - 0.55 * f);
          bx2.globalAlpha = (0.4 * (1 - f) ** 1.3) * rng.range(0.5, 1);
          bx2.lineWidth = (0.5 + 0.5 * (1 - f)) * s;
          bx2.beginPath();
          bx2.moveTo(x0, y + rng.gauss() * 0.4 * s);
          bx2.lineTo(x0 + len, y + rng.gauss() * 0.4 * s);
          bx2.stroke();
        }
      }
      // stipple, denser near the surface
      bx2.fillStyle = P.ink;
      const dots = Math.round(((w * (h - gy)) / 260) * tex);
      for (let q = 0; q < dots; q++) {
        const y = gy + (h - gy) * Math.pow(rng(), 1.9);
        const f = (y - gy) / (h - gy);
        bx2.globalAlpha = 0.35 * (1 - f) + 0.05;
        bx2.beginPath();
        bx2.arc(rng() * w, y, rng.range(0.4, 0.9) * s, 0, TAU);
        bx2.fill();
      }
      // strata: long wavy lines at irregular depths
      const nStrata = Math.floor(tex * 6);
      bx2.strokeStyle = P.ink;
      for (let q = 0; q < nStrata; q++) {
        const y0 = gy + (h - gy) * rng.range(0.12, 0.92);
        bx2.globalAlpha = rng.range(0.2, 0.4);
        bx2.lineWidth = 0.7 * s;
        bx2.beginPath();
        for (let x = 0; x <= w; x += 6 * s) {
          const y = y0 + noise.noise2(x * 0.003, q * 7.1) * 14 * s;
          if (x === 0) bx2.moveTo(x, y); else bx2.lineTo(x, y);
        }
        bx2.stroke();
      }
      bx2.globalAlpha = 1;
    }
    // ground line: a heavy engraved stroke with a fine companion below
    bx2.strokeStyle = P.ink;
    bx2.lineWidth = 1.6 * s;
    bx2.beginPath();
    for (let x = 0; x <= w; x += 6 * s) {
      const y = gy + noise.noise2(x * 0.004, 3.1) * 2.5 * s;
      if (x === 0) bx2.moveTo(x, y); else bx2.lineTo(x, y);
    }
    bx2.stroke();
    bx2.globalAlpha = 0.5;
    bx2.lineWidth = 0.6 * s;
    bx2.beginPath();
    bx2.moveTo(0, gy + 4 * s);
    bx2.lineTo(w, gy + 4 * s);
    bx2.stroke();
    bx2.globalAlpha = 1;

    // ---- commit state -----------------------------------------------------
    const grow2 = mk();
    S.N = N;
    S.R = R;
    S.s = s;
    S.items = items;
    S.births = births;
    S.maxB = maxB;
    S.bg = bg;
    S.grow = grow2;
    S.gctx = grow2.getContext('2d');
    S.ptr = 0;
  },

  draw(env, t) {
    const { ctx, w, h, params: P, state: S, playing } = env;
    if (!S.bg) return;
    const total = S.items.length;
    let target = total;
    if (playing) {
      const T = S.maxB / P.speed + HOLD;
      const tt = t % T;
      target = lowerBound(S.births, tt * P.speed);
    }
    if (target < S.ptr) {
      S.gctx.setTransform(1, 0, 0, 1, 0, 0);
      S.gctx.clearRect(0, 0, w, h);
      S.ptr = 0;
    }
    if (target > S.ptr) {
      const g = S.gctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      for (let i = S.ptr; i < target; i++) renderItem(g, S.items[i], S, P);
      g.globalAlpha = 1;
      S.ptr = target;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(S.bg, 0, 0);
    ctx.drawImage(S.grow, 0, 0);
  },
};
