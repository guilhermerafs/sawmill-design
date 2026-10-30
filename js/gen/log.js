// Log interior: a cross-section of a felled log. Rings meander around an off-centre pith,
// bunch on the thin side, split into checks, wrap round knots; printed as a woodcut, an engraving,
// or planed to a polished slab.
//
// Architecture: setup() fills a coarse grid of smooth per-pixel fields (ring coordinate U, its gradient,
// age A, crack distance, bark distance, bark texture, ink blotches, angles). draw() bilinearly samples those
// fields per output pixel (half-res while animating, full-res when still) and does the ring profile, antialiasing,
// ink/paper texture there, so lines stay crisp regardless of the grid.
import { clamp, smoothstep as ss, hexToRgb } from '../lib/noise.js';

const TAU = Math.PI * 2;
const ST = 12; // field stride
const RT = 4096; // ray table size
const SIN = new Float32Array(1024);
for (let i = 0; i < 1024; i++) SIN[i] = Math.sin((i / 1024) * Math.PI * 2);

function mkCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export default {
  id: 'log',
  name: 'Log interior',
  blurb: 'A felled cross-section: rings crowding the thin side, checks splitting from the bark, pressed in ink or planed to a slab.',
  restartOnPlay: false,
  params: [
    { key: 'rings', label: 'Rings', type: 'knob', min: 8, max: 120, step: 1, default: 44, group: 'Growth' },
    { key: 'irregularity', label: 'Irregular', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Growth' },
    { key: 'eccentricity', label: 'Eccentric', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.45, group: 'Growth' },
    { key: 'warp', label: 'Warp', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.45, group: 'Growth' },

    { key: 'wobble', label: 'Outline', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Form' },
    { key: 'lobes', label: 'Lobes', type: 'knob', min: 0, max: 6, step: 1, default: 3, group: 'Form' },
    { key: 'bark', label: 'Bark', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.45, group: 'Form' },
    { key: 'knots', label: 'Knots', type: 'knob', min: 0, max: 3, step: 1, default: 1, group: 'Form' },

    { key: 'cracks', label: 'Checks', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Wood' },
    { key: 'crackDepth', label: 'Check depth', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.55, group: 'Wood' },
    { key: 'rays', label: 'Rays', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.5, live: true, group: 'Wood' },
    { key: 'lineWeight', label: 'Line weight', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.5, live: true, group: 'Wood' },

    { key: 'style', label: 'Style', type: 'dial', min: 0, max: 2, step: 1, default: 0, live: true, options: ['Woodcut', 'Engraved', 'Polished'], group: 'Print' },
    { key: 'coverage', label: 'Ink', type: 'knob', min: 0.3, max: 1, step: 0.01, default: 0.88, live: true, group: 'Print' },
    { key: 'speckle', label: 'Speckle', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.4, live: true, group: 'Print' },
    { key: 'speed', label: 'Speed', type: 'knob', min: 0, max: 3, step: 0.01, default: 1, live: true, group: 'Motion' },
    { key: 'motion', label: 'Motion', type: 'dial', min: 0, max: 2, step: 1, default: 0, live: true, options: ['Grow', 'Breathe', 'Still'], group: 'Motion' },

    { key: 'ink', label: 'Ink', type: 'color', default: '#2a1c12', live: true, group: 'Color' },
    { key: 'paper', label: 'Paper', type: 'color', default: '#efe7d8', live: true, group: 'Color' },
    { key: 'woodLight', label: 'Early wood', type: 'color', default: '#e0a35e', live: true, group: 'Color' },
    { key: 'woodDark', label: 'Late wood', type: 'color', default: '#7a3b1a', live: true, group: 'Color' },
    { key: 'seed', label: 'Seed', type: 'seed', default: 4417, group: 'Seed' },
  ],

  setup(env) {
    const { w, h, params: P, rng, noise } = env;
    const S = env.state;
    const { fbm2, noise2, fbm3 } = noise;
    const minD = Math.min(w, h);

    // ---- outline R(theta) ------------------------------------------------
    const nT = 720;
    const Rraw = new Float32Array(nT);
    const lob = Math.round(P.lobes);
    const phL = rng() * TAU, phL2 = rng() * TAU;
    const eccA = rng() * TAU;
    const nx = rng.range(-20, 20), ny = rng.range(-20, 20);
    const notches = [];
    const nN = P.wobble > 0.15 ? (P.wobble > 0.55 ? 2 : 1) : 0;
    for (let i = 0; i < nN; i++) notches.push({ a: rng() * TAU, wdt: rng.range(0.07, 0.16), d: rng.range(0.14, 0.26) * (0.5 + P.wobble) });
    for (let k = 0; k < nT; k++) {
      const th = (k / nT) * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      let r = 1 + P.wobble * 0.30 * fbm2(c * 1.25 + nx, s * 1.25 + ny, 3, 2, 0.5);
      if (lob > 0) r += (0.05 + 0.09 * P.wobble) * Math.cos(lob * th + phL) + 0.03 * P.wobble * Math.cos((lob + 1) * th + phL2);
      for (const n of notches) {
        let d = Math.abs(((th - n.a + Math.PI) % TAU + TAU) % TAU - Math.PI);
        r -= n.d * Math.exp(-Math.pow(d / n.wdt, 1.6));
      }
      r *= 1 + P.eccentricity * 0.32 * Math.cos(th - eccA);
      Rraw[k] = Math.max(r, 0.4);
    }
    const bkA = 0.02 + 0.115 * P.bark; // bark thickness in age units
    // bbox to centre and fit
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < nT; k++) {
      const th = (k / nT) * TAU, r = Rraw[k] * (1 + bkA * 1.05);
      const x = r * Math.cos(th), y = r * Math.sin(th);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const scale = Math.min((0.465 * w) / ((x1 - x0) / 2), (0.465 * h) / ((y1 - y0) / 2));
    const px0 = w / 2 - ((x0 + x1) / 2) * scale, py0 = h / 2 - ((y0 + y1) / 2) * scale;
    const Rpx = new Float32Array(nT + 1);
    let Rbar = 0;
    for (let k = 0; k < nT; k++) { Rpx[k] = Rraw[k] * scale; Rbar += Rpx[k]; }
    Rpx[nT] = Rpx[0];
    Rbar /= nT;

    // ---- ring table -------------------------------------------------------
    const N = Math.round(P.rings);
    const wid = new Float64Array(N);
    const ringS = new Float32Array(N + 1);
    let ar = 0, tot = 0;
    const irr = P.irregularity;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      ar = 0.82 * ar + 0.6 * rng.gauss();
      let wv = (1.5 - 0.75 * Math.pow(t, 0.85)) * Math.exp(irr * 1.0 * ar);
      let s = 0.8 + 0.4 * rng();
      if (rng() < 0.05 + 0.11 * irr && i > 1) { wv *= rng.range(0.22, 0.5); s = 1.3 + 0.25 * rng(); } // drought year
      else if (rng() < 0.06 * irr) { wv *= 1.5; s *= 0.8; }
      if (i < 3) wv *= 1.25;
      wid[i] = wv; tot += wv;
    }
    const cum = new Float64Array(N + 1);
    let acc = 0;
    for (let i = 0; i < N; i++) { acc += wid[i] / tot; cum[i + 1] = acc; }
    cum[N] = 1;
    const mean = 1 / N;
    {
      const r2 = rng;
      for (let i = 0; i < N; i++) {
        const rel = (cum[i + 1] - cum[i]) / mean;
        let s = 0.82 + 0.3 * r2();
        s *= 1 + 0.45 * clamp(1 - rel, -0.5, 0.75);
        ringS[i] = clamp(s, 0.5, 1.7);
      }
      ringS[N] = ringS[N - 1];
    }
    const U_of = (a) => {
      if (a <= 0) return a * N;
      let lo = 0, hi = N;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= a) lo = m; else hi = m; }
      return lo + (a - cum[lo]) / (cum[lo + 1] - cum[lo]);
    };

    // ---- knots ------------------------------------------------------------
    const knots = [];
    const nK = Math.round(P.knots);
    for (let i = 0; i < nK; i++) {
      const th = rng() * TAU, a = rng.range(0.3, 0.78);
      const Rk = Rpx[Math.floor(((th + TAU) % TAU) / TAU * nT) % nT];
      const kr = Rbar * rng.range(0.035, 0.07);
      knots.push({ x: px0 + Math.cos(th) * a * Rk, y: py0 + Math.sin(th) * a * Rk, r: kr, ca: Math.cos(th), sa: Math.sin(th) });
    }

    // ---- cracks (checks) ----------------------------------------------------
    const cr = [];
    const wk = w / 1200;
    const nEdge = Math.round(P.cracks * 7 * (0.7 + 0.5 * rng()));
    const nPith = Math.round(P.cracks * 2.4 + (P.cracks > 0.15 ? 0.6 : 0));
    for (let i = 0; i < nEdge; i++) {
      cr.push({
        th: rng() * TAU, a0: 1 - (0.08 + 0.85 * P.crackDepth * (0.35 + 0.65 * rng())), a1: 1.2,
        wmax: rng.range(4, 11) * wk * (0.6 + 0.9 * P.cracks), pith: false,
        p1: rng() * 6, p2: rng() * 6, p3: rng() * 6, id: i,
      });
    }
    for (let i = 0; i < nPith; i++) {
      cr.push({
        th: rng() * TAU, a0: 0, a1: 0.25 + 0.7 * P.crackDepth * (0.4 + 0.6 * rng()) + (i === 0 ? 0.15 : 0),
        wmax: rng.range(1.4, 3.4) * wk, pith: true,
        p1: rng() * 6, p2: rng() * 6, p3: rng() * 6, id: 50 + i,
      });
    }

    // ---- fields -------------------------------------------------------------
    const cell = Math.max(2, Math.ceil(Math.max(w, h) / 460));
    const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    const F = new Float32Array(gw * gh * ST);
    const Wamp = P.warp * 0.055 * Rbar, fw = 2.1 / Rbar;
    const Wfine = P.warp * 0.016 * Rbar, fw2 = 7.5 / Rbar;
    const blF = 1 / (0.07 * minD);
    const kfx = rng() * 100, kfy = rng() * 100;
    const rK = Rbar / 55, rKr = Rbar / 6;

    for (let j = 0; j < gh; j++) {
      const y = j * cell;
      for (let i = 0; i < gw; i++) {
        const x = i * cell;
        const o = (j * gw + i) * ST;
        let dx = x - px0, dy = y - py0;
        if (P.warp > 0) {
          dx += Wamp * fbm2(x * fw, y * fw, 3, 2, 0.5) + Wfine * noise2(x * fw2 + 5.1, y * fw2);
          dy += Wamp * fbm2(x * fw + 41.7, y * fw - 13.3, 3, 2, 0.5) + Wfine * noise2(x * fw2, y * fw2 + 9.7);
        }
        // knot deflection
        let kU = 0, kIn = false, kd = 0;
        for (const k of knots) {
          const qx = px0 + dx - k.x, qy = py0 + dy - k.y;
          const d = Math.hypot(qx, qy);
          const s = Math.exp(-Math.pow(d / (2.0 * k.r), 2));
          const f = 1 - 0.5 * s;
          dx = k.x - px0 + qx * f; dy = k.y - py0 + qy * f;
          // elliptical coordinates (elongated along the radial direction)
          const al = qx * k.ca + qy * k.sa, pe = -qx * k.sa + qy * k.ca;
          const de = Math.hypot(al / 1.45, pe);
          if (de < k.r) { kIn = true; kU = (de / k.r) * 3.4 + 0.45; }
          const rim = 1 - ss(0.5, 2.0 * wk + 0.4, Math.abs(de - k.r));
          if (rim > kd) kd = rim;
        }
        const r = Math.hypot(dx, dy);
        const th = Math.atan2(dy, dx);
        let ti = ((((th % TAU) + TAU) % TAU) / TAU) * nT;
        let i0 = Math.floor(ti); const tf = ti - i0; i0 = ((i0 % nT) + nT) % nT;
        const Sx = Rpx[i0] * (1 - tf) + Rpx[i0 + 1 > nT ? 0 : i0 + 1] * tf;
        const ratio = Sx / Rbar, q = r / Rbar;
        let a = r / Sx;
        a = q / Math.pow(ratio, Math.pow(Math.min(a, 1.3), 1.1));
        a = q / Math.pow(ratio, Math.pow(Math.min(a, 1.3), 1.1));
        let U = U_of(a);
        if (kIn) U = kU;
        // bark edge (signed distance in px, positive inside)
        let bd = 999, bt = 0;
        if (a > 0.82) {
          const bn = fbm2(x / (Rbar * 0.35), y / (Rbar * 0.35), 2, 2, 0.5);
          const rag = 3.2 * noise2(x / 6, y / 6) + 6 * noise2(x / 24, y / 24) + 4 * noise2(x / 80, y / 80);
          bd = (bkA * (0.62 + 0.55 * bn) - (a - 1)) * Sx + rag;
          if (a > 0.95 && a < 1.4) {
            const cth = Math.cos(th), sth = Math.sin(th);
            bt = fbm3(cth * rK + kfx, sth * rK + kfy, (a - 1) * rKr, 3, 2.1, 0.55);
          }
        }
        // cracks
        let c = -60;
        if (cr.length && a > 0.02) {
          for (let m = 0; m < cr.length; m++) {
            const k = cr[m];
            const wand = 0.045 * Math.sin(q * 6 + k.p1) + 0.016 * Math.sin(q * 21 + k.p2);
            let dth = th - (k.th + wand);
            dth = ((dth + Math.PI) % TAU + TAU) % TAU - Math.PI;
            const perp = Math.abs(dth) * r;
            if (perp > 40 * wk + 12 || perp > 54) continue;
            let hw;
            if (k.pith) {
              const t = a / k.a1;
              if (t >= 1) continue;
              hw = k.wmax * Math.pow(Math.sin(Math.PI * Math.sqrt(t)), 0.9);
            } else {
              const t = (a - k.a0) / (1.03 - k.a0);
              if (t <= 0) continue;
              hw = k.wmax * Math.pow(Math.min(t, 1.15), 1.35);
            }
            const jag = 0.55 * wk * noise2(r * 0.09, k.id * 7.3) + 0.25 * Math.sin(r * 0.7 + k.p3);
            const cc = hw - perp + jag * Math.min(1, hw);
            if (cc > c) c = cc;
          }
        }
        const bl = 0.5 + 0.5 * fbm2(x * blF + 3.3, y * blF - 7.1, 2, 2, 0.5);
        const bs = 0.5 + 0.5 * fbm2(x * blF * 0.12 + 11, y * blF * 0.9, 2, 2, 0.5);
        F[o] = U; F[o + 2] = a; F[o + 3] = c; F[o + 4] = bd; F[o + 5] = bt;
        F[o + 6] = bl; F[o + 7] = bs; F[o + 8] = kd;
        F[o + 9] = th; F[o + 10] = Math.atan2(-dy, -dx);
      }
    }
    // gradient of U in ring-units per px
    for (let j = 0; j < gh; j++) {
      const jm = Math.max(0, j - 1), jp = Math.min(gh - 1, j + 1);
      for (let i = 0; i < gw; i++) {
        const im = Math.max(0, i - 1), ip = Math.min(gw - 1, i + 1);
        const gx = (F[(j * gw + ip) * ST] - F[(j * gw + im) * ST]) / ((ip - im) * cell);
        const gy = (F[(jp * gw + i) * ST] - F[(jm * gw + i) * ST]) / ((jp - jm) * cell);
        F[(j * gw + i) * ST + 1] = Math.min(Math.hypot(gx, gy), 4);
      }
    }

    // ---- medullary ray table ------------------------------------------------
    const rayS = new Float32Array(RT), rayA = new Float32Array(RT);
    const nR = 260;
    for (let i = 0; i < nR; i++) {
      const c0 = rng() * RT, st = 0.25 + 0.75 * rng() * rng() + 0.15, a0 = rng.range(0.08, 0.85);
      for (let d = -3; d <= 3; d++) {
        const idx = (Math.floor(c0) + d + RT) % RT;
        const v = st * Math.exp(-Math.pow((idx - c0) / 1.25, 2));
        if (v > rayS[idx]) { rayS[idx] = v; rayA[idx] = a0; }
      }
    }

    // ---- paper grain + fibres -------------------------------------------------
    const grain = new Uint8Array(w * h);
    const sd = (P.seed | 0) * 2654435761 >>> 0;
    const hs = (x, y) => {
      let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + sd) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      n ^= n >>> 16;
      return (n & 1023) / 1023;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        grain[y * w + x] = 255 * (0.5 * hs(x, y) + 0.3 * hs(x >> 1, y >> 1) + 0.2 * hs(x >> 2, (y >> 2) + 7919));
      }
    }
    const fiber = new Uint8Array(w * h);
    try {
      const fc = mkCanvas(w, h);
      const fx = fc.getContext('2d', { willReadFrequently: true });
      fx.lineCap = 'round';
      const nF = Math.round((w * h) / 380);
      for (let i = 0; i < nF; i++) {
        const x = rng() * w, y = rng() * h, a = rng() * TAU, L = 5 + rng() * 22, bend = rng.range(-0.6, 0.6);
        fx.strokeStyle = `rgba(0,0,0,${(0.12 + 0.35 * rng()).toFixed(2)})`;
        fx.lineWidth = 0.5 + rng() * 0.6;
        fx.beginPath(); fx.moveTo(x, y);
        fx.quadraticCurveTo(x + Math.cos(a + bend) * L * 0.5, y + Math.sin(a + bend) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L);
        fx.stroke();
      }
      const id = fx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < w * h; i++) fiber[i] = id[i * 4 + 3];
    } catch (e) { /* fibres are optional */ }

    Object.assign(S, {
      F, gw, gh, cell, N, ringS, rayS, rayA, grain, fiber, Rbar, px0, py0,
      cache: null, cacheKey: '', offFull: null, offAnim: null,
    });
  },

  // Loop length in seconds (used by the video dialog's default length).
  cycle: (P) => (Math.round(P.motion) === 0 && P.speed > 0 ? 13 / P.speed : 0),

  draw(env, t) {
    const { ctx, w, h, params: P, state: S, playing } = env;
    if (!S.F) return;
    const motion = Math.round(P.motion), style = Math.round(P.style);
    // env.offline = deterministic export render: animate by t, but at full resolution and never from cache.
    const live = playing || env.offline;
    const moving = live && motion !== 2 && P.speed > 0;
    const animated = moving && !env.offline;
    const sc = animated ? clamp(Math.sqrt((w * h) / 320000), 1, 2.4) : 1;

    const key = [style, P.lineWeight, P.coverage, P.speckle, P.rays, P.ink, P.paper, P.woodLight, P.woodDark].join('|');
    if (!moving && S.cache && S.cacheKey === key) { ctx.drawImage(S.cache, 0, 0); return; }

    const ow = Math.ceil(w / sc), oh = Math.ceil(h / sc);
    const slot = animated ? 'offAnim' : 'offFull';
    let off = S[slot];
    if (!off || off.width !== ow || off.height !== oh) {
      off = mkCanvas(ow, oh);
      S[slot] = off;
      S[slot + 'Ctx'] = off.getContext('2d');
      S[slot + 'Img'] = S[slot + 'Ctx'].createImageData(ow, oh);
    }
    const img = S[slot + 'Img'];
    const out = img.data;
    const { F, gw, gh, cell, N, ringS, rayS, rayA, grain, fiber, Rbar } = S;

    // time -> reveal / breathing
    let reveal = 2, fade = 0, breathe = false, tb = 0;
    if (live && motion === 0) {
      const p = ((t * P.speed) / 13) % 1;
      const g = clamp(p / 0.7);
      reveal = 1.17 * Math.pow(g, 0.85);
      fade = ss(0.94, 1.0, p);
    } else if (live && motion === 1) {
      breathe = true; tb = t * P.speed * 0.7;
    }
    const sheenA = 0.9 + (breathe ? tb * 0.22 : 0);

    const ink = hexToRgb(P.ink), paper = hexToRgb(P.paper), wl = hexToRgb(P.woodLight), wdk = hexToRgb(P.woodDark);
    const lw = P.lineWeight, cov = P.coverage, spk = P.speckle, rayK = P.rays;
    const wdBase = style === 0 ? 0.2 + 0.5 * lw : 0.045 + 0.27 * lw;
    const needTheta = rayK > 0 || style === 2;
    const v = new Float64Array(ST);
    const SHEEN = S.sheen || (S.sheen = new Float32Array(1024));
    if (style === 2) for (let i = 0; i < 1024; i++) { const cs = Math.max(0, Math.cos(2 * ((i / 1024) * TAU - sheenA))); SHEEN[i] = cs * cs * cs * cs * 0.2; }
    const rtScale = RT / TAU;
    const cellInv = 1 / cell;
    const eBd = 0.85 * sc;
    const stride = ST;

    for (let oy = 0; oy < oh; oy++) {
      const cy = (oy + 0.5) * sc;
      let gy = cy * cellInv, gy0 = gy | 0;
      if (gy0 > gh - 2) gy0 = gh - 2;
      const fy = gy - gy0;
      let gi = Math.min(h - 1, cy | 0) * w;
      for (let ox = 0; ox < ow; ox++) {
        const cx = (ox + 0.5) * sc;
        let gx = cx * cellInv, gx0 = gx | 0;
        if (gx0 > gw - 2) gx0 = gw - 2;
        const fx = gx - gx0;
        const o00 = (gy0 * gw + gx0) * stride, o10 = o00 + stride, o01 = o00 + gw * stride, o11 = o01 + stride;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const A = F[o00 + 2] * w00 + F[o10 + 2] * w10 + F[o01 + 2] * w01 + F[o11 + 2] * w11;
        const bd = F[o00 + 4] * w00 + F[o10 + 4] * w10 + F[o01 + 4] * w01 + F[o11 + 4] * w11;
        const bl = F[o00 + 6] * w00 + F[o10 + 6] * w10 + F[o01 + 6] * w01 + F[o11 + 6] * w11;
        const pi = gi + Math.min(w - 1, cx | 0);
        const gr = grain[pi] * (1 / 255);
        const fib = fiber[pi] * (1 / 255);
        const q = (oy * ow + ox) * 4;
        // fast path: clearly outside the log
        if (bd < -26 * sc && A > 1) {
          const pj = 1 + (gr - 0.5) * 0.045 - fib * 0.07 + (bl - 0.5) * 0.035;
          const shd = style === 2 ? Math.exp(-(-bd) / (0.011 * Rbar)) * 0.24 : 0;
          const pk = pj * (1 - shd);
          out[q] = paper[0] * pk; out[q + 1] = paper[1] * pk; out[q + 2] = paper[2] * pk; out[q + 3] = 255;
          continue;
        }
        for (let k = 0; k < 2; k++) v[k] = F[o00 + k] * w00 + F[o10 + k] * w10 + F[o01 + k] * w01 + F[o11 + k] * w11;
        const bs = F[o00 + 7] * w00 + F[o10 + 7] * w10 + F[o01 + 7] * w01 + F[o11 + 7] * w11;
        let cc = -60;
        if (F[o00 + 3] > -55 || F[o10 + 3] > -55 || F[o01 + 3] > -55 || F[o11 + 3] > -55) cc = F[o00 + 3] * w00 + F[o10 + 3] * w10 + F[o01 + 3] * w01 + F[o11 + 3] * w11;
        v[3] = cc;
        v[8] = F[o00 + 8] + F[o10 + 8] + F[o01 + 8] + F[o11 + 8] > 0 ? F[o00 + 8] * w00 + F[o10 + 8] * w10 + F[o01 + 8] * w01 + F[o11 + 8] * w11 : 0;
        v[5] = A > 0.95 ? F[o00 + 5] * w00 + F[o10 + 5] * w10 + F[o01 + 5] * w01 + F[o11 + 5] * w11 : 0;

        // theta (seamless pick)
        let th = 0;
        if (needTheta) {
          const t1 = F[o00 + 9] * w00 + F[o10 + 9] * w10 + F[o01 + 9] * w01 + F[o11 + 9] * w11;
          if (Math.abs(F[o00 + 9]) < 2 && Math.abs(F[o11 + 9]) < 2 && Math.abs(F[o10 + 9]) < 2 && Math.abs(F[o01 + 9]) < 2) th = t1;
          else th = F[o00 + 10] * w00 + F[o10 + 10] * w10 + F[o01 + 10] * w01 + F[o11 + 10] * w11 + Math.PI;
        }

        let U = v[0];
        if (breathe) U += 0.3 * SIN[(((tb + A * 8 + bl * 5.5) * 162.97466) | 0) & 1023] + 0.16 * SIN[(((tb * 0.63 + A * 3.1) * 162.97466) | 0) & 1023];
        const g = v[1];
        const e = 0.62 * sc * g;
        const fl = Math.floor(U);
        const ri = fl < 0 ? 0 : fl >= N ? N - 1 : fl;
        const sR = ringS[ri];
        const eAvg = ss(0.28, 0.7, e);

        // reveal visibility
        let vis = 1;
        if (reveal < 1.5) vis = clamp((reveal - A) * 45 + 0.5);

        // rays
        let rs = 0;
        if (rayK > 0 && A < 1.0) {
          const rp = th * rtScale + RT * 0.5 + RT * 8;
          const ri0 = rp | 0, rf = rp - ri0;
          const i0 = ri0 & (RT - 1), i1 = (ri0 + 1) & (RT - 1);
          const s0 = rayS[i0] * ss(rayA[i0], rayA[i0] + 0.06, A), s1 = rayS[i1] * ss(rayA[i1], rayA[i1] + 0.06, A);
          rs = (s0 * (1 - rf) + s1 * rf) * ss(0.1, 0.24, A) * rayK;
        }

        // cracks / bark / knots common masks
        const c = v[3];
        const eC = 0.8 * sc;
        const gap = ss(-eC, eC, c);
        const mask = ss(-eBd, eBd, bd);
        const eA = (0.9 * sc) / Rbar;
        const woodW = ss(1 + eA, 1 - eA, A);
        const kd = v[8];

        let R, G, B;
        // ---- paper ----
        const pj = 1 + (gr - 0.5) * 0.045 - fib * 0.07 + (bl - 0.5) * 0.035;
        const pR = paper[0] * pj, pG = paper[1] * pj, pB = paper[2] * pj;

        if (style < 2) {
          // ------------- ink styles ------------------
          let wdv = wdBase * sR * (0.6 + 0.85 * bl) * (1 + 0.35 * A * A * A);
          if (wdv > 0.72) wdv = 0.72;
          let f2 = U + 0.2; f2 -= Math.floor(f2);
          const top = 0.8;
          let d = ss(top - wdv - e, top - wdv * (style === 0 ? 0.82 : 0.5) + e, f2) * (1 - ss(top - e, top + e, f2));
          if (style === 1) {
            if (e < 0.25) d = Math.max(d, 0.5 * (1 - ss(0, 0.012 + e, Math.abs(f2 - 0.42))) * (1 - eAvg));
            d *= 0.93;
          }
          d += (wdv * 0.75 - d) * eAvg;
          d *= 1 - rs * 0.85;
          // pith
          d = Math.max(d, 1 - ss(0.004, 0.0085, A));
          // last ring line
          d = Math.max(d, 0.9 * ss(0.975, 0.995, A));
          // bark
          if (A > 0.97) {
            const bt = v[5];
            let bk = style === 0 ? 0.98 - 0.9 * ss(-0.02, 0.2, bt) : 0.85 - 0.75 * ss(-0.05, 0.2, bt);
            bk *= 0.9 + 0.2 * bl;
            if (bd < 5) bk *= 0.6 + 0.4 * ss(-1, 5, bd);
            d = d * woodW + bk * (1 - woodW);
          }
          // knot rim & cracks
          d = Math.max(d, kd * (style === 0 ? 0.95 : 0.8));
          d *= 1 - gap;
          const rim = 1 - ss(0.2, 1.2 * sc + 0.5, Math.abs(c));
          d = Math.max(d, rim * (style === 0 ? 0.9 : 0.75) * (1 - (bd < 0 ? 1 : 0)));
          d *= mask;
          // ink handling: coverage, unevenness, speckle
          const un = 0.55 * bs + 0.45 * bl;
          d *= clamp(cov + (un - 0.5) * (1.15 - cov) * 1.4, 0, 1.15);
          if (spk > 0) {
            const gm = gr * 0.75 + (bl - 0.5) * 0.35 + 0.18;
            const hole = ss(1.02 - spk * 0.55, 1.12 - spk * 0.55 + 0.1, gm);
            d *= 1 - 0.9 * hole * (0.5 + spk * 0.6);
            d *= 1 - 0.12 * spk * (1 - gr);
          }
          d *= vis;
          if (d > 1) d = 1; else if (d < 0) d = 0;
          const ij = 1 + (gr - 0.5) * 0.14;
          R = pR + (ink[0] * ij - pR) * d;
          G = pG + (ink[1] * ij - pG) * d;
          B = pB + (ink[2] * ij - pB) * d;
        } else {
          // ------------- polished slab ----------------
          let f2 = U + 0.2; f2 -= Math.floor(f2);
          const top = 0.8;
          const L = ss(0.1, 0.78, f2);
          let tn = L * L * (1 - ss(top - e, top + e, f2)) * (0.5 + 0.55 * sR * (0.45 + lw));
          tn += (0.36 - tn) * eAvg;
          tn = clamp((tn + (bl - 0.5) * 0.12) * 1.22, 0, 1);
          const heart = 1 - ss(0.1, 0.95, A);
          const hm = 1 - 0.14 * heart;
          let lr = wl[0] * hm, lg = wl[1] * (1 - 0.18 * heart), lb = wl[2] * (1 - 0.26 * heart);
          let r0 = lr + (wdk[0] - lr) * tn, g0 = lg + (wdk[1] - lg) * tn, b0 = lb + (wdk[2] - lb) * tn;
          // fibre texture and rays
          const fv = 0.965 + 0.07 * gr - 0.05 * fib;
          r0 *= fv; g0 *= fv; b0 *= fv;
          if (rs > 0) { const m = rs * 0.5; r0 += (lr * 1.1 + 25 - r0) * m; g0 += (lg * 1.1 + 25 - g0) * m; b0 += (lb * 1.1 + 25 - b0) * m; }
          // sheen
          const sh = SHEEN[((th * 162.97466) | 0) & 1023] * (0.55 + 0.6 * (1 - tn)) * ss(0.02, 0.2, A);
          r0 += (255 - r0) * sh; g0 += (255 - g0) * sh; b0 += (255 - b0) * sh;
          // knot
          const kk = kd * 0.8;
          r0 += (wdk[0] * 0.3 - r0) * kk; g0 += (wdk[1] * 0.3 - g0) * kk; b0 += (wdk[2] * 0.3 - b0) * kk;
          // pith
          const pt = 1 - ss(0.004, 0.012, A);
          r0 += (wdk[0] * 0.35 - r0) * pt; g0 += (wdk[1] * 0.35 - g0) * pt; b0 += (wdk[2] * 0.35 - b0) * pt;
          // bark
          if (A > 0.97) {
            const bt = v[5];
            const kb = clamp(0.5 + 0.55 * bt, 0, 1);
            const kq = kb * kb;
            let br = wdk[0] * (0.2 + 0.55 * kq), bg = wdk[1] * (0.2 + 0.55 * kq), bb = wdk[2] * (0.2 + 0.55 * kq);
            br *= 0.9 + 0.2 * gr; bg *= 0.9 + 0.2 * gr; bb *= 0.9 + 0.2 * gr;
            r0 = r0 * woodW + br * (1 - woodW); g0 = g0 * woodW + bg * (1 - woodW); b0 = b0 * woodW + bb * (1 - woodW);
          }
          // checks
          const lip = (1 - ss(0, 2.2 * sc, Math.abs(c - 1.6 * sc))) * 0.3;
          r0 += (wl[0] + 20 - r0) * lip; g0 += (wl[1] + 20 - g0) * lip; b0 += (wl[2] + 20 - b0) * lip;
          const dark = 0.22;
          r0 += (wdk[0] * dark - r0) * gap; g0 += (wdk[1] * dark - g0) * gap; b0 += (wdk[2] * dark - b0) * gap;
          // backdrop with soft shadow
          const shd = (1 - mask) * Math.exp(-Math.max(0, -bd) / (0.011 * Rbar)) * 0.24;
          const bR = pR * (1 - shd), bG = pG * (1 - shd), bB = pB * (1 - shd);
          const m2 = mask * vis;
          R = bR + (r0 - bR) * m2; G = bG + (g0 - bG) * m2; B = bB + (b0 - bB) * m2;
        }
        if (fade > 0) { R += (pR - R) * fade; G += (pG - G) * fade; B += (pB - B) * fade; }
        out[q] = R; out[q + 1] = G; out[q + 2] = B; out[q + 3] = 255;
      }
    }
    S[slot + 'Ctx'].putImageData(img, 0, 0);
    if (animated) {
      const sm = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, w, h);
      ctx.imageSmoothingEnabled = sm;
    } else {
      ctx.drawImage(off, 0, 0);
      if (!moving) { S.cache = off; S.cacheKey = key; }
    }
  },
};
