// Engrave: any image rendered as tree-ring / banknote line engraving.
import { clamp, hexToRgb } from '../lib/noise.js';

const MODES = ['Rings', 'Contour', 'Banknote', 'Stipple'];
const TAU = Math.PI * 2;

// Separable box blur (radius r px, `passes` iterations ~ gaussian) on a Float32 field.
function boxBlur(src, w, h, r, passes = 3) {
  r = Math.round(r);
  if (r < 1) return Float32Array.from(src);
  let a = Float32Array.from(src);
  const b = new Float32Array(a.length);
  const line = new Float32Array(Math.max(w, h) + 2 * r + 2);
  const run = (inp, out, n, stride, count, sstride) => {
    for (let k = 0; k < count; k++) {
      const o = k * sstride;
      // pad with edge replicate
      for (let i = 0; i < n + 2 * r; i++) {
        const j = clamp(i - r, 0, n - 1);
        line[i] = inp[o + j * stride];
      }
      let s = 0;
      for (let i = 0; i < 2 * r + 1; i++) s += line[i];
      const inv = 1 / (2 * r + 1);
      for (let i = 0; i < n; i++) {
        out[o + i * stride] = s * inv;
        s += line[i + 2 * r + 1] - line[i];
      }
    }
  };
  for (let p = 0; p < passes; p++) {
    run(a, b, w, 1, h, w);
    run(b, a, h, w, w, 1);
  }
  return a;
}

export default {
  id: 'engrave',
  name: 'Engrave',
  blurb: 'A photograph cut into the heartwood: rings that bend with the form and swell with the dark.',
  restartOnPlay: false,
  params: [
    { key: 'image', label: 'Image', type: 'image', default: 'assets/sample.jpg', group: 'Source' },
    { key: 'mode', label: 'Mode', type: 'dial', min: 0, max: 3, step: 1, default: 0, options: MODES, live: true, group: 'Source' },
    { key: 'contrast', label: 'Contrast', type: 'knob', min: 0.3, max: 3, step: 0.01, default: 1.35, live: true, group: 'Source' },
    { key: 'gamma', label: 'Gamma', type: 'knob', min: 0.3, max: 3, step: 0.01, default: 1.0, live: true, group: 'Source' },
    { key: 'blur', label: 'Blur', type: 'knob', min: 0, max: 60, step: 1, default: 22, unit: 'px', group: 'Source' },
    { key: 'invert', label: 'Invert', type: 'toggle', default: false, live: true, group: 'Source' },

    { key: 'density', label: 'Density', type: 'knob', min: 12, max: 220, step: 1, default: 105, live: true, group: 'Lines' },
    { key: 'minW', label: 'Min weight', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.07, live: true, group: 'Lines' },
    { key: 'maxW', label: 'Max weight', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.88, live: true, group: 'Lines' },
    { key: 'relief', label: 'Relief', type: 'knob', min: 0, max: 14, step: 0.1, default: 2.4, live: true, group: 'Lines' },
    { key: 'angle', label: 'Angle', type: 'dial', min: 0, max: 360, step: 1, default: 28, wrap: true, unit: '°', live: true, group: 'Lines' },
    { key: 'hatch', label: 'Cross-hatch', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.55, live: true, group: 'Lines' },
    { key: 'speed', label: 'Speed', type: 'knob', min: -2, max: 2, step: 0.01, default: 0.25, live: true, group: 'Lines' },

    { key: 'warp', label: 'Warp', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.18, live: true, group: 'Wood' },
    { key: 'warpScale', label: 'Warp scale', type: 'knob', min: 40, max: 600, step: 1, default: 260, live: true, group: 'Wood' },
    { key: 'cx', label: 'Center X', type: 'knob', min: 0, max: 1, step: 0.005, default: 0.5, group: 'Wood' },
    { key: 'cy', label: 'Center Y', type: 'knob', min: 0, max: 1, step: 0.005, default: 0.5, group: 'Wood' },
    { key: 'logMask', label: 'Log mask', type: 'toggle', default: false, group: 'Wood' },
    { key: 'cracks', label: 'Cracks', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.0, live: true, group: 'Wood' },
    { key: 'grain', label: 'Paper grain', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.45, live: true, group: 'Wood' },
    { key: 'speckle', label: 'Ink speckle', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.3, live: true, group: 'Wood' },

    { key: 'ink', label: 'Ink', type: 'color', default: '#241810', live: true, group: 'Color' },
    { key: 'paper', label: 'Paper', type: 'color', default: '#efe7d8', live: true, group: 'Color' },
    { key: 'seed', label: 'Seed', type: 'seed', default: 4242, group: 'Seed' },
  ],

  setup(env) {
    const { w, h, params, rng, noise, state } = env;
    const img = params.image;
    const n = w * h;
    state.ready = false;
    if (!img) return;

    // --- luminance, cover-fit ---
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const o = off.getContext('2d', { willReadFrequently: true });
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    o.fillStyle = '#808080'; o.fillRect(0, 0, w, h);
    o.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const px = o.getImageData(0, 0, w, h).data;
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    // auto-levels (1%..99%)
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[(L[i] * 255) | 0]++;
    let acc = 0, lo = 0, hi = 255;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.01) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.01) { hi = i; break; } }
    const span = Math.max(20, hi - lo) / 255, l0 = lo / 255;
    for (let i = 0; i < n; i++) L[i] = clamp((L[i] - l0) / span);

    const k = Math.min(w, h) / 1200;
    state.Ls = boxBlur(L, w, h, Math.min(6, 2 + params.blur * 0.12) * k, 2);   // detail (line weight)
    state.Lb = boxBlur(L, w, h, params.blur * k, 3);                            // smoothed (line displacement)

    // --- geometry from the center ---
    const cx = params.cx * w, cy = params.cy * h;
    const R = new Float32Array(n), TH = new Float32Array(n);
    for (let y = 0, i = 0; y < h; y++) {
      const dy = y - cy;
      for (let x = 0; x < w; x++, i++) {
        const dx = x - cx;
        R[i] = Math.sqrt(dx * dx + dy * dy);
        TH[i] = Math.atan2(dy, dx);
      }
    }
    state.R = R; state.TH = TH;

    // random grain/speckle, a touch of clumping
    const rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) rnd[i] = rng();
    const soft = boxBlur(rnd, w, h, 1, 1);
    for (let i = 0; i < n; i++) rnd[i] = clamp(0.5 + (soft[i] - 0.5) * 2.2 + (rnd[i] - 0.5) * 0.3);
    state.rnd = rnd;

    // radial cracks (distance in px to nearest crack, tapered)
    const nc = 4 + rng.int(0, 2);
    const cr = [];
    for (let c = 0; c < nc; c++) cr.push({ a: rng.range(-Math.PI, Math.PI), r0: rng.range(0.03, 0.2) * Math.min(w, h), len: rng.range(0.3, 0.46) * Math.min(w, h), ph: rng.range(0, 50) });
    const CK = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = R[i], th = TH[i];
      let best = 1e4;
      for (let c = 0; c < nc; c++) {
        const q = cr[c];
        const t = (r - q.r0) / q.len;
        if (t < 0 || t > 1) continue;
        let da = th - q.a - 0.05 * noise.noise2(r * 0.006, q.ph) - 0.02 * noise.noise2(r * 0.03, q.ph + 3);
        da = Math.abs(da - TAU * Math.round(da / TAU));
        const taper = 1 - t * t;
        const d = da * r + (1 - taper) * 14;
        if (d < best) best = d;
      }
      CK[i] = best;
    }
    state.CK = CK;

    // log silhouette + bark
    if (params.logMask) {
      const E = new Float32Array(n), BK = new Float32Array(n);
      const base = 0.455 * Math.min(w, h);
      for (let i = 0; i < n; i++) {
        const c = Math.cos(TH[i]), sn = Math.sin(TH[i]);
        const Rt = base * (1 + 0.035 * noise.noise2(c * 1.2 + 9, sn * 1.2) + 0.012 * noise.noise2(c * 2.8 + 2, sn * 2.8 + 5) + 0.004 * noise.noise2(c * 7, sn * 7));
        const e = Rt - R[i];
        E[i] = e;
        BK[i] = clamp(0.88 + 0.4 * noise.noise3(c * 22, sn * 22, e * 0.035) + 0.15 * noise.noise2(c * 90, sn * 90), 0.4, 1);
      }
      state.E = E; state.BK = BK;
    }
    state.small = null;
    state.ready = true;
  },

  draw(env, t) {
    const { ctx, w, h, params: P, noise, state, playing } = env;
    const paperRgb = hexToRgb(P.paper), inkRgb = hexToRgb(P.ink);
    if (!state.ready) {
      ctx.fillStyle = P.paper; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = P.ink; ctx.font = '16px monospace'; ctx.textAlign = 'center';
      ctx.fillText('loading image…', w / 2, h / 2);
      return;
    }
    const step = playing && !env.offline ? 2 : 1;
    const W = Math.ceil(w / step), H = Math.ceil(h / step);
    const mode = P.mode | 0;
    const period = Math.min(w, h) / P.density;
    const invP = 1 / period;

    // tone LUT: luminance -> darkness
    const LN = 1024, lut = new Float32Array(LN + 1);
    for (let i = 0; i <= LN; i++) {
      let v = clamp((i / LN - 0.5) * P.contrast + 0.5);
      v = Math.pow(v, P.gamma);
      lut[i] = P.invert ? v : 1 - v;
    }

    // coarse warp grid (scalar offset in px), evolves with t
    const G = 8, gw = Math.ceil(w / G) + 2, gh = Math.ceil(h / G) + 2;
    let grid = state.grid;
    if (!grid || grid.length !== gw * gh) grid = state.grid = new Float32Array(gw * gh);
    const warpPx = P.warp * 0.07 * Math.min(w, h);
    if (warpPx > 0) {
      const sc = 1 / P.warpScale, tz = t * 0.06;
      for (let gy = 0, i = 0; gy < gh; gy++)
        for (let gx = 0; gx < gw; gx++, i++)
          grid[i] = warpPx * noise.fbm3(gx * G * sc, gy * G * sc, tz, 3, 2, 0.5);
    } else grid.fill(0);

    const out = state.imgd && state.imgd.width === W && state.imgd.height === H ? state.imgd : (state.imgd = new ImageData(W, H));
    const d32 = new Uint32Array(out.data.buffer);
    const { Ls, Lb, R, TH, rnd, CK, E, BK } = state;

    const ang = P.angle * Math.PI / 180;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ang2 = ang + 0.95, ca2 = Math.cos(ang2), sa2 = Math.sin(ang2);
    const drift = P.speed * t * 0.5;
    const minW = Math.min(P.minW, P.maxW), maxW = Math.max(P.minW, P.maxW);
    const relief = P.relief;
    const hatch = P.hatch;
    const grainA = P.grain * 0.16, spk = P.speckle;
    const cracks = P.cracks, gapW = cracks * 3.2;
    const logMask = !!E;
    const barkW = 0.024 * Math.min(w, h);
    const contourK = P.density * 0.1 * (0.6 + relief / 7);
    const minGrad = 0.5 / period * step;
    const stippleSp = period * 1.05;
    const prev = state.prevRow && state.prevRow.length === W ? state.prevRow : (state.prevRow = new Float32Array(W));
    prev.fill(1e6);
    const pr = paperRgb[0], pg = paperRgb[1], pb = paperRgb[2];
    const ir = inkRgb[0], ig = inkRgb[1], ib = inkRgb[2];

    for (let y = 0; y < H; y++) {
      const fy = y * step;
      const gyf = fy / G, giy = gyf | 0, gay = gyf - giy;
      const row0 = giy * gw, row1 = row0 + gw;
      let pPrev = 1e6;
      for (let x = 0; x < W; x++) {
        const fx = x * step;
        const i = fy * w + fx;
        const gxf = fx / G, gix = gxf | 0, gax = gxf - gix;
        const wv = grid[row0 + gix] * (1 - gax) * (1 - gay) + grid[row0 + gix + 1] * gax * (1 - gay)
          + grid[row1 + gix] * (1 - gax) * gay + grid[row1 + gix + 1] * gax * gay;
        const dispL = lut[(Lb[i] * LN) | 0];     // smoothed darkness
        const dark = lut[(Ls[i] * LN) | 0];      // detail darkness
        let cov = 0;
        let phase;
        if (mode === 0 || mode === 3) {
          phase = (R[i] + wv) * invP + relief * (dispL - 0.5) - drift;
        } else if (mode === 1) {
          phase = dispL * contourK + (R[i] + wv) * invP * 0.22 - drift * 0.3;
        } else {
          phase = (fx * ca + fy * sa + wv) * invP + relief * (dispL - 0.5) - drift;
        }
        // screen-space gradient of phase (backward differences) for antialiasing
        const gxd = pPrev > 1e5 ? 0 : phase - pPrev;
        const gyd = prev[x] > 1e5 ? 0 : phase - prev[x];
        pPrev = phase; prev[x] = phase;
        let g = Math.sqrt(gxd * gxd + gyd * gyd);
        if (g < minGrad) g = minGrad;

        if (mode !== 3) {
          const hw = 0.5 * (minW + (maxW - minW) * dark);
          const f = phase - ((phase + 4096) | 0) + 4096;
          const c = Math.abs(f - 0.5);          // distance to line gap center
          const cd = 0.5 - c;                   // distance from line center (periods)
          cov = clamp((hw - cd) / g + 0.5);
          if (g > 0.4) { const m = clamp((g - 0.4) / 0.4); cov += (clamp(hw * 2) - cov) * m; }
          if (mode === 2 && hatch > 0.01) {
            const dh = dark - 0.42;
            if (dh > 0) {
              const hw2 = 0.5 * maxW * 0.62 * clamp(dh * 1.8) * hatch;
              const p2 = (fx * ca2 + fy * sa2 + wv * 0.6) * invP * 0.9 + relief * 0.7 * (dispL - 0.5);
              const f2 = p2 - ((p2 + 4096) | 0) + 4096;
              const cd2 = 0.5 - Math.abs(f2 - 0.5);
              let c2 = clamp((hw2 - cd2) / (g * 0.9) + 0.5);
              if (g > 0.4) { const m = clamp((g - 0.4) / 0.4); c2 += (clamp(hw2 * 2) - c2) * m; }
              cov = 1 - (1 - cov) * (1 - c2);
            }
          } else if (hatch > 0.01 && dark > 0.62 && mode !== 1) {
            // rings: short radial ticks in the deepest shadows
            const dh = (dark - 0.62) / 0.38;
            const a = TH[i] * (R[i] * 0.045 + 10);
            const f2 = a / TAU - Math.floor(a / TAU);
            const hw2 = 0.5 * 0.5 * dh * hatch;
            const c2 = clamp((hw2 - (0.5 - Math.abs(f2 - 0.5))) / 0.18 + 0.5);
            cov = 1 - (1 - cov) * (1 - c2 * 0.9);
          }
        } else {
          // stippled rings: dots along each ring, size ~ darkness
          const kk = ((phase + 4096) | 0) - 4096;
          const u = (phase - kk - 0.5) * period;                       // radial offset px
          const rk = Math.max(period * 1.5, (kk + 0.5) * period);
          const m = Math.max(6, Math.round(TAU * rk / stippleSp));
          let a = TH[i] / TAU * m + ((kk * 0.381966) % 1);
          const v = (a - Math.floor(a) - 0.5) * (TAU * Math.max(R[i], 1) / m);
          const dd = Math.sqrt(u * u + v * v);
          const rad = (stippleSp * 0.62) * Math.sqrt(clamp((dark - minW * 0.4) / (1 - minW * 0.4))) * (0.35 + 0.65 * maxW);
          cov = clamp((rad - dd) / (0.9 * step) + 0.5);
        }

        const rv = rnd[i];
        if (spk > 0) cov *= 1 - spk * clamp((rv - 0.62) * 3.5);
        if (cracks > 0.01) {
          const d = CK[i];
          if (d < gapW) cov *= clamp((d - gapW * 0.45) / (gapW * 0.55 + 0.001));
          else if (d < gapW + 1.7) cov = Math.max(cov, cracks * 0.85 * (1 - (d - gapW) / 1.7));
        }
        if (logMask) {
          const e = E[i];
          if (e < 0) cov = 0;
          else if (e < barkW) {
            const bk = BK[i] * (e < 1.5 ? e / 1.5 : 1) * (e > barkW - 3 ? (barkW - e) / 3 : 1);
            cov = Math.max(cov * 0.4, clamp(bk));
          } else if (e < barkW + 5) {
            cov = Math.max(cov, 0.8 * (1 - (e - barkW) / 5));   // thin inner line
          }
        }

        const sh = 1 + (rv - 0.5) * grainA;
        const rr = (pr * sh) * (1 - cov) + ir * cov;
        const gg = (pg * sh) * (1 - cov) + ig * cov;
        const bb = (pb * sh) * (1 - cov) + ib * cov;
        d32[y * W + x] = 0xff000000 | ((bb > 255 ? 255 : bb) << 16) | ((gg > 255 ? 255 : gg) << 8) | (rr > 255 ? 255 : rr);
      }
    }

    if (step === 1) {
      ctx.putImageData(out, 0, 0);
    } else {
      let sm = state.small;
      if (!sm || sm.width !== W) { sm = state.small = document.createElement('canvas'); sm.width = W; sm.height = H; }
      sm.getContext('2d').putImageData(out, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sm, 0, 0, w, h);
    }
  },
};
