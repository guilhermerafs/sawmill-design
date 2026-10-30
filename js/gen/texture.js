// Planks of sawn timber. A log is a volume of cylindrical growth rings around the
// pith; each board is a planar slice through it at a depth from the pith, tilted by
// the cut angle so the rings bend into cathedral arches. Figure, fibre, pores, rays
// and knots are layered on the slice. Everything is per-pixel into ImageData at a
// reduced resolution while playing.
import { hexToRgb, clamp, smoothstep } from '../lib/noise.js';

const C = 6; // warp-table cell size (px)
const TILE = 512; // fine-texture tile (power of two)

// Species feel: palette (0-255), pore amount, ray amount, ring spacing and fibre strength.
const SPECIES = [
  { early: [214, 176, 122], late: [126, 82, 42], pore: 1.0, ray: 0.9, ringMul: 0.85, fiber: 0.8 }, // Oak
  { early: [128, 92, 62], late: [54, 34, 20], pore: 0.35, ray: 0.5, ringMul: 1.0, fiber: 0.6 }, // Walnut
  { early: [238, 208, 144], late: [186, 130, 64], pore: 0.0, ray: 0.15, ringMul: 0.7, fiber: 1.0 }, // Pine
  { early: [242, 230, 210], late: [206, 178, 138], pore: 0.05, ray: 0.6, ringMul: 1.3, fiber: 0.4 }, // Maple
  { early: [60, 48, 42], late: [20, 14, 12], pore: 0.2, ray: 0.2, ringMul: 1.6, fiber: 0.3 }, // Ebony
  { early: [198, 114, 72], late: [128, 54, 30], pore: 0.3, ray: 0.6, ringMul: 1.0, fiber: 0.55 }, // Cherry
];

// Integer hash -> [0,1). Stable per (seed, a, b).
function hs(seed, a, b) {
  let h = (seed ^ Math.imul(a + 1, 0x27d4eb2d) ^ Math.imul(b + 7, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Wrapped box blur along the second index of a TILE x TILE tile, then normalised to ~[0,1].
function streakTile(rng, len) {
  const n = TILE;
  const src = new Float32Array(n * n);
  for (let k = 0; k < src.length; k++) src[k] = rng();
  const out = new Float32Array(n * n);
  const hh = len >> 1;
  for (let a = 0; a < n; a++) {
    const row = a * n;
    let sum = 0;
    for (let q = 0; q < len; q++) sum += src[row + ((((q - hh) % n) + n) % n)];
    for (let j = 0; j < n; j++) {
      out[row + j] = sum / len;
      sum += src[row + ((((j + len - hh) % n) + n) % n)] - src[row + ((((j - hh) % n) + n) % n)];
    }
  }
  let m = 0;
  for (let k = 0; k < out.length; k++) m += out[k];
  m /= out.length;
  let v = 0;
  for (let k = 0; k < out.length; k++) v += (out[k] - m) * (out[k] - m);
  const sd = Math.sqrt(v / out.length) || 1;
  for (let k = 0; k < out.length; k++) out[k] = clamp(0.5 + (0.18 * (out[k] - m)) / sd);
  return out;
}

// Sparse pore seeds stretched into short dashes along the grain.
function poreTile(rng) {
  const n = TILE, len = 11;
  const out = new Float32Array(n * n);
  for (let a = 0; a < n; a++) {
    for (let j = 0; j < n; j++) {
      if (rng() < 0.012) {
        const row = a * n;
        for (let q = 0; q < len; q++) {
          const idx = row + ((j + q) % n);
          const v = 1 - q / len;
          if (v > out[idx]) out[idx] = v;
        }
      }
    }
  }
  return out;
}

export default {
  id: 'texture',
  name: 'Texture',
  blurb: 'Sawn planks: a log sliced by a tilted cut, with rings, figure, pores and knots.',
  restartOnPlay: false,
  params: [
    { key: 'depth', label: 'Cut depth', type: 'knob', min: 0, max: 2, step: 0.01, default: 0.9, live: true, group: 'Cut' },
    { key: 'angle', label: 'Cut angle', type: 'dial', min: -60, max: 60, step: 1, default: 14, unit: '°', live: true, group: 'Cut' },
    { key: 'figure', label: 'Figure', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.5, live: true, group: 'Cut' },
    { key: 'speed', label: 'Speed', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.25, live: true, group: 'Cut' },

    { key: 'rings', label: 'Ring density', type: 'knob', min: 3, max: 40, step: 1, default: 11, live: true, group: 'Grain' },
    { key: 'wobble', label: 'Ring wobble', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.4, live: true, group: 'Grain' },
    { key: 'fiber', label: 'Fiber', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.35, live: true, group: 'Grain' },
    { key: 'pores', label: 'Pores', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.4, live: true, group: 'Grain' },
    { key: 'rays', label: 'Rays', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.3, live: true, group: 'Grain' },
    { key: 'knots', label: 'Knots', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.3, live: true, group: 'Grain' },

    { key: 'boards', label: 'Boards', type: 'knob', min: 1, max: 12, step: 1, default: 5, live: true, group: 'Boards' },
    { key: 'vertical', label: 'Vertical', type: 'toggle', default: true, live: true, group: 'Boards' },
    { key: 'gap', label: 'Gap width', type: 'knob', min: 0, max: 16, step: 1, default: 5, unit: 'px', live: true, group: 'Boards' },
    { key: 'variation', label: 'Variation', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.35, live: true, group: 'Boards' },

    { key: 'sheen', label: 'Sheen', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.4, live: true, group: 'Finish' },

    {
      key: 'species', label: 'Species', type: 'dial', min: 0, max: 5, step: 1, default: 0,
      options: ['Oak', 'Walnut', 'Pine', 'Maple', 'Ebony', 'Cherry'], live: true, group: 'Color',
    },
    { key: 'early', label: 'Earlywood tint', type: 'color', default: '#ffffff', live: true, group: 'Color' },
    { key: 'late', label: 'Latewood tint', type: 'color', default: '#ffffff', live: true, group: 'Color' },
    { key: 'seed', label: 'Seed', type: 'seed', default: 1234, group: 'Seed' },
  ],

  setup(env) {
    const { w, h, noise, rng, params } = env;
    const st = env.state;
    const M = Math.max(w, h);
    const TN = Math.ceil((2 * M) / C) + 2;
    st.TN = TN;
    st.M = M;
    st.seed = params.seed | 0;

    // Low-frequency warp fields over a domain twice the canvas, so each board can
    // sample its own offset without wrapping. Index [across * TN + along].
    const field = (fa, fl, oct) => {
      const T = new Float32Array(TN * TN);
      for (let i = 0; i < TN; i++) {
        for (let j = 0; j < TN; j++) {
          T[i * TN + j] = 0.5 + 0.5 * noise.fbm2(i * C * fa, j * C * fl, oct, 2, 0.5);
        }
      }
      return T;
    };
    st.wob = field(1 / 150, 1 / 900, 2); // ring wobble: short across, long along the grain
    st.fig = field(1 / 320, 1 / 1400, 2); // figure / curl: slow arches of the cut

    st.fiberT = streakTile(rng, 36);
    st.poreT = poreTile(rng);
    st.bufs = {};
  },

  draw(env, t) {
    const { ctx, w, h, params, state: st, playing } = env;
    const k = playing ? 3 : 1; // reduced resolution while animating
    const rw = Math.ceil(w / k), rh = Math.ceil(h / k);
    if (!st.bufs[k] || st.bufs[k].c.width !== rw || st.bufs[k].c.height !== rh) {
      const c = document.createElement('canvas');
      c.width = rw;
      c.height = rh;
      const g = c.getContext('2d');
      st.bufs[k] = { c, g, img: g.createImageData(rw, rh) };
    }
    const buf = st.bufs[k];
    const img = buf.img.data;

    const vertical = !!params.vertical;
    const A = vertical ? w : h; // across extent (px)
    const Lp = vertical ? h : w; // along the grain (px)
    const U = A / 5; // physical unit: five boards span five units
    const nb = Math.max(1, Math.round(params.boards));
    const pitch = A / nb;
    const gap = Math.min(params.gap, pitch * 0.45);
    const bwPx = pitch - gap;
    const bwU = bwPx / U;
    const Ls = Lp / U;
    const seed = st.seed, TN = st.TN, M = st.M;
    const sp = SPECIES[Math.round(params.species) % SPECIES.length];
    const tanA = Math.tan((params.angle * Math.PI) / 180);
    const swing = 0.3 * Math.sin(t * params.speed * 1.5); // cut plane drifting through the log
    const variation = params.variation;

    // Per-board constants: table offset, depth, tone and up to three knots (flat arrays).
    const bOb = new Float64Array(nb), bDb = new Float64Array(nb), bTone = new Float64Array(nb);
    const kS = new Float64Array(nb * 3), kZ = new Float64Array(nb * 3), kR = new Float64Array(nb * 3);
    for (let b = 0; b < nb; b++) {
      bOb[b] = hs(seed, b, 1) * M;
      bDb[b] = params.depth + swing + (hs(seed, b, 2) - 0.5) * variation * 0.9;
      bTone[b] = 1 + (hs(seed, b, 3) - 0.5) * variation * 0.4;
      for (let q = 0; q < 3; q++) {
        const id = b * 3 + q;
        if (hs(seed, b, 10 + q * 4) < params.knots * 0.7) {
          kS[id] = (hs(seed, b, 11 + q * 4) - 0.5) * bwU * 0.75;
          kZ[id] = (0.1 + hs(seed, b, 12 + q * 4) * 0.8) * Ls;
          kR[id] = 0.05 + hs(seed, b, 13 + q * 4) * 0.09;
        } else {
          kR[id] = 0;
        }
      }
    }

    const Tw = st.wob, Tf = st.fig, FT = st.fiberT, PT = st.poreT;
    const bil = (T, x, y) => {
      const xi = x | 0, yi = y | 0;
      const fx = x - xi, fy = y - yi;
      const p = xi * TN + yi;
      const v00 = T[p], v01 = T[p + 1], v10 = T[p + TN], v11 = T[p + TN + 1];
      return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
    };

    const tintE = hexToRgb(params.early), tintL = hexToRgb(params.late);
    const E = sp.early.map((v, c) => (v * tintE[c]) / 255);
    const L = sp.late.map((v, c) => (v * tintL[c]) / 255);
    const knotR = L[0] * 0.62, knotG = L[1] * 0.62, knotB = L[2] * 0.62;

    const Ntot = params.rings * sp.ringMul;
    const wobAmp = params.wobble * 0.12;
    const figAmp = params.figure * 0.5;
    const tiltK = tanA * 0.3;
    const fibK = params.fiber * sp.fiber * 0.22;
    const poreK = params.pores * sp.pore;
    const rayK = params.rays * sp.ray;
    const sheen = params.sheen;

    let hasKnots = false;
    for (let q = 0; q < kR.length; q++) if (kR[q] > 0) { hasKnots = true; break; }

    let px = 0;
    for (let j = 0; j < rh; j++) {
      const yc = (j + 0.5) * k;
      for (let i = 0; i < rw; i++, px += 4) {
        const xc = (i + 0.5) * k;
        const a = vertical ? xc : yc; // across the boards
        const l = vertical ? yc : xc; // along the grain

        let b = (a / pitch) | 0;
        if (b >= nb) b = nb - 1;
        const rel = a - b * pitch;

        if (rel < gap * 0.5 || rel > pitch - gap * 0.5) {
          const f = 0.8 + 0.4 * FT[(((a | 0) + 41) & 511) * TILE + ((l | 0) & 511)];
          img[px] = 22 * f;
          img[px + 1] = 14 * f;
          img[px + 2] = 9 * f;
          img[px + 3] = 255;
          continue;
        }

        const ob = bOb[b];
        const ap = a + ob;
        const s = (rel - pitch * 0.5) / U; // across the board, physical units, centred
        const zn = l / Lp;
        const edgeU = Math.min(rel - gap * 0.5, pitch - gap * 0.5 - rel) / U;

        const xa = ap / C, yl = l / C;
        const xi = xa | 0, yi = yl | 0;
        const fx = xa - xi, fy = yl - yi;
        const p0 = xi * TN + yi, p1 = p0 + TN;
        const wv = (Tw[p0] * (1 - fx) + Tw[p1] * fx) * (1 - fy) + (Tw[p0 + 1] * (1 - fx) + Tw[p1 + 1] * fx) * fy;
        const fv = Tf[(fx > 0.5 ? xi + 1 : xi) * TN + (fy > 0.5 ? yi + 1 : yi)];
        const dEff = bDb[b] + tiltK * (zn - 0.5) * Ls + figAmp * (fv - 0.5) * 2;
        let r = Math.sqrt(dEff * dEff + s * s) + wobAmp * (wv - 0.5) * 2;

        // Knots: rings deflect around them, and their cores are dark.
        let kc = 0, kq = 0;
        for (let q = 0; hasKnots && q < 3; q++) {
          const id = b * 3 + q;
          const R = kR[id];
          if (R === 0) continue;
          const ds = s - kS[id];
          const dz = (l / U - kZ[id]) / 2.2; // elongated along the grain
          const qq = Math.sqrt(ds * ds + dz * dz) / R;
          if (qq < 3) {
            r += R * 0.6 * Math.exp(-1.5 * Math.max(0, qq - 1));
            const core = 1 - smoothstep(0.8, 1.0, qq);
            if (core > kc) { kc = core; kq = qq; }
          }
        }

        const ph = r * Ntot;
        const g = ph - Math.floor(ph);
        const lw = smoothstep(0.5, 0.85, g) * (1 - smoothstep(0.92, 1.0, g)); // latewood band, soft at the wrap
        const ew0 = 1 - smoothstep(0.2, 0.55, g); // earlywood (pores live here)
        const ew = ew0 * ew0;

        let cr = E[0] + (L[0] - E[0]) * lw;
        let cg = E[1] + (L[1] - E[1]) * lw;
        let cb = E[2] + (L[2] - E[2]) * lw;

        const pIdx = ((ap | 0) & 511) * TILE + ((l | 0) & 511);
        const pv = PT[pIdx] * poreK * ew;
        const fIdx = ((((ap | 0) + 131) & 511)) * TILE + (((l | 0) + 17) & 511);
        const fbv = FT[fIdx];

        // Medullary rays: radial lines at a fixed angle to the pith, broken into flecks.
        let ray = 0;
        if (rayK > 0) {
          const phi = Math.atan2(s, dEff) * 22;
          const fr = phi - Math.floor(phi);
          const line = 1 - smoothstep(0, 0.12, Math.min(fr, 1 - fr));
          const fleck = smoothstep(0.45, 0.75, FT[(((ap | 0) + 301) & 511) * TILE + ((((l / 5) | 0)) & 511)]);
          ray = rayK * line * fleck;
        }

        let m = (1 - 0.55 * pv) * (1 + fibK * (fbv - 0.5) * 2) * (1 - 0.35 * ray) * bTone[b];
        m *= 0.84 + 0.16 * smoothstep(0, 0.04, edgeU);
        cr *= m; cg *= m; cb *= m;

        if (kc > 0) {
          const kf = 0.75 + 0.25 * (kq * 3 - Math.floor(kq * 3));
          cr += (knotR * kf - cr) * kc;
          cg += (knotG * kf - cg) * kc;
          cb += (knotB * kf - cb) * kc;
        }

        // Varnish sheen: a soft band across each board and a gentle vertical gradient.
        const sb = (rel - pitch * 0.5) / bwPx;
        const gq = (sb - 0.15) / 0.12;
        const gl = sheen * (0.2 * Math.exp(-gq * gq) + 0.05 * (1 - zn));
        cr += (255 - cr) * gl;
        cg += (255 - cg) * gl;
        cb += (255 - cb) * gl * 0.92;

        img[px] = cr;
        img[px + 1] = cg;
        img[px + 2] = cb;
        img[px + 3] = 255;
      }
    }

    buf.g.putImageData(buf.img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buf.c, 0, 0, w, h);
  },
};
