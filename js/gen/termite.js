// Termite — wood eaten from within. Insect agents tunnel through a weathered plank;
// the carved depth field is lit as relief (bright cut wall, cast shadow, frass plugs).
import { clamp, lerp, smoothstep, hexToRgb } from '../lib/noise.js';

const S = 2;            // carve grid is half resolution of the canvas
const TS = 16;          // shading tile (grid cells)
const AXIS = Math.PI / 2; // grain runs vertically
const MODES = ['Termite', 'Engraver beetle', 'Woodworm'];

export default {
  id: 'termite',
  name: 'Termite',
  blurb: 'Wood eaten from within: meandering galleries, pupal chambers and frass plugs cut into silvered grain.',
  restartOnPlay: true,
  params: [
    // Colony
    { key: 'mode', label: 'Insect', type: 'dial', min: 0, max: 2, step: 1, default: 0, options: MODES, group: 'Colony' },
    { key: 'population', label: 'Colony', type: 'knob', min: 1, max: 30, step: 1, default: 12, group: 'Colony' },
    { key: 'appetite', label: 'Appetite', type: 'knob', min: 0.05, max: 1, step: 0.01, default: 0.55, group: 'Colony' },
    { key: 'speed', label: 'Speed', type: 'knob', min: 0.25, max: 14, step: 0.05, default: 2, group: 'Colony', live: true },
    // Tunnels
    { key: 'width', label: 'Width', type: 'knob', min: 8, max: 80, step: 1, default: 54, unit: 'px', group: 'Tunnels' },
    { key: 'growth', label: 'Widening', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.35, group: 'Tunnels' },
    { key: 'wander', label: 'Wander', type: 'knob', min: 0, max: 2, step: 0.01, default: 0.6, group: 'Tunnels' },
    { key: 'grainBias', label: 'Grain bias', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Tunnels' },
    { key: 'branching', label: 'Branching', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.35, group: 'Tunnels' },
    { key: 'avoid', label: 'Avoidance', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.8, group: 'Tunnels' },
    { key: 'chambers', label: 'Chambers', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Tunnels' },
    { key: 'frass', label: 'Frass', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.3, group: 'Tunnels' },
    // Wood
    { key: 'grainScale', label: 'Grain scale', type: 'knob', min: 0.4, max: 3, step: 0.01, default: 1, group: 'Wood' },
    { key: 'weathering', label: 'Weathering', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.7, group: 'Wood' },
    { key: 'cracks', label: 'Cracks', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Wood' },
    { key: 'ragged', label: 'Ragged edge', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.3, group: 'Wood' },
    // Light
    { key: 'lightAngle', label: 'Light', type: 'dial', min: 0, max: 360, step: 1, default: 305, wrap: true, unit: '°', group: 'Light', live: true },
    { key: 'relief', label: 'Relief', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.7, group: 'Light', live: true },
    { key: 'elevation', label: 'Elevation', type: 'knob', min: 20, max: 75, step: 1, default: 38, unit: '°', group: 'Light', live: true },
    { key: 'shadow', label: 'Shadow', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.88, group: 'Light', live: true },
    // Color
    { key: 'palette', label: 'Palette', type: 'select', options: [{ value: 'wood', label: 'Wood' }, { value: 'print', label: 'Print' }], default: 'wood', group: 'Color', live: true },
    { key: 'surfLight', label: 'Surface', type: 'color', default: '#a99a86', group: 'Color', live: true },
    { key: 'surfDark', label: 'Grain', type: 'color', default: '#4a3d33', group: 'Color', live: true },
    { key: 'cut', label: 'Cut wood', type: 'color', default: '#d4c4a4', group: 'Color', live: true },
    { key: 'frassCol', label: 'Frass', type: 'color', default: '#9a7650', group: 'Color', live: true },
    { key: 'shadowCol', label: 'Shadow', type: 'color', default: '#17120e', group: 'Color', live: true },
    { key: 'paper', label: 'Paper', type: 'color', default: '#efe7d8', group: 'Color', live: true },
    { key: 'ink', label: 'Ink', type: 'color', default: '#2b1d14', group: 'Color', live: true },
    { key: 'seed', label: 'Seed', type: 'seed', default: 1234, group: 'Seed' },
  ],

  setup(env) {
    const { w, h, params, rng, noise, ctx } = env;
    const st = env.state;
    st.gw = Math.ceil(w / S);
    st.gh = Math.ceil(h / S);
    const gw = st.gw, gh = st.gh, N = gw * gh;
    st.D = new Float32Array(N);
    st.E = new Float32Array(N);
    st.F = new Float32Array(N);
    st.LIT = new Float32Array(N).fill(1);
    st.NF = new Uint8Array(N);
    st.FD = new Uint8Array(N);
    st.G = new Float32Array(N);
    const ox = rng() * 100, oy = rng() * 100;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      st.G[y * gw + x] = noise.fbm2(x * 0.06 + ox, y * 0.06 + oy, 3, 2.3, 0.45);
    }
    buildWood(env, st);
    st.img = ctx.createImageData(w, h);
    const d32 = new Uint32Array(st.img.data.buffer);
    d32.fill(0xff000000);
    // interpolation tables (full-res pixel -> grid cells)
    const mk = (n, g) => {
      const i0 = new Int32Array(n), i1 = new Int32Array(n), f = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / S - 0.5;
        const a = Math.floor(u);
        f[k] = u - a;
        i0[k] = clamp(a, 0, g - 1);
        i1[k] = clamp(a + 1, 0, g - 1);
      }
      return [i0, i1, f];
    };
    [st.xi0, st.xi1, st.xf] = mk(w, gw);
    [st.yi0, st.yi1, st.yf] = mk(h, gh);
    st.tw = Math.ceil(gw / TS);
    st.th = Math.ceil(gh / TS);
    st.dirty = new Uint8Array(st.tw * st.th);
    st.queue = new Int32Array(st.tw * st.th + 1);
    st.qh = 0; st.qt = 0; st.qn = 0;
    st.tileMs = 0.05;
    st.lk = null; st.ck = null; st.painted = false;
    st.rng = rng; st.noise = noise;
    initSim(env, st);
    if (!env.playing) {
      let guard = 0;
      while (!st.sim.done && guard++ < 400000) stepSim(st, params, env);
      st.sim.done = true;
    }
  },

  draw(env, t, dt) {
    const st = env.state, p = env.params, ctx = env.ctx;
    if (!st.T) return;
    const lk = [p.lightAngle, p.relief, p.elevation, p.shadow].join('|');
    const ck = [p.palette, p.surfLight, p.surfDark, p.cut, p.frassCol, p.shadowCol, p.paper, p.ink].join('|');
    if (lk !== st.lk) {
      st.lk = lk; st.ck = ck;
      setLight(st, p);
      prepColors(st, p);
      markAll(st, 3);
    } else if (ck !== st.ck) {
      st.ck = ck;
      prepColors(st, p);
      markAll(st, 1);
    }
    if (env.playing && !st.sim.done) {
      st.sim.acc += p.speed;
      const n = Math.floor(st.sim.acc);
      st.sim.acc -= n;
      for (let i = 0; i < n && !st.sim.done; i++) stepSim(st, p, env);
      if (st.sim.done) markAll(st, 3); // final consistent pass
    }
    const throttled = env.playing && !st.sim.done && st.painted;
    processQueue(env, st, p, throttled ? 13 : Infinity);
    st.painted = true;
    ctx.globalAlpha = 1;
  },
};

// ---------------------------------------------------------------- wood plank
function buildWood(env, st) {
  const { w, h, params, noise, rng } = env;
  const hw = (w + 1) >> 1, hh = (h + 1) >> 1;
  const gs = params.grainScale, we = params.weathering;
  const s0 = 1200 / Math.min(w, h);
  const half = new Float32Array(hw * hh);
  const fm = new Float32Array(hw * hh);
  const o = rng() * 50;
  for (let y = 0; y < hh; y++) {
    const Y = y * 2 * s0;
    for (let x = 0; x < hw; x++) {
      const X = x * 2 * s0;
      const warp = noise.fbm2(X * 0.0013 + o, Y * 0.0004, 3, 2, 0.5);
      const s1 = noise.fbm2(X * 0.011 * gs, Y * 0.0011 + o, 4, 2.1, 0.55);
      const s2 = noise.fbm2(X * 0.05 * gs + 7, Y * 0.003, 3, 2, 0.5);
      const s3 = noise.noise2(X * 0.09 * gs, Y * 0.006 + o);
      const tb = noise.fbm2(X * 0.0035 + 90, Y * 0.0004, 2, 2, 0.5);
      const ph = X * 0.0065 * gs + warp * 2.6;
      let rn = ph - Math.floor(ph);
      const band = rn * rn * rn;
      const blot = noise.noise2(X * 0.0016 + 31, Y * 0.0013);
      const T = 0.5 + 0.2 * s1 + 0.17 * s2 + (0.09 + 0.09 * we) * s3 - (0.06 + 0.1 * we) * band + 0.05 * we * blot + 0.2 * tb;
      half[y * hw + x] = T;
      fm[y * hw + x] = 0.5 + 0.5 * s2;
    }
  }
  // fibre columns (1D noise at several scales -> fine long streaks)
  const col = new Float32Array(w + 8);
  const r1 = new Float32Array(w + 8), r2 = new Float32Array(w + 8), r3 = new Float32Array(w + 8);
  for (let i = 0; i < w + 8; i++) { r1[i] = rng() - 0.5; r2[i] = rng() - 0.5; r3[i] = rng() - 0.5; }
  for (let x = 0; x < w; x++) {
    const q3 = x / 4, q9 = x / 14;
    const ia = Math.floor(q3), ib = Math.floor(q9);
    const sm = (f) => f * f * (3 - 2 * f);
    col[x] = (r2[ia] * (1 - sm(q3 - ia)) + r2[ia + 1] * sm(q3 - ia)) * 0.9 + (r3[ib] * (1 - sm(q9 - ib)) + r3[ib + 1] * sm(q9 - ib)) * 1.2 + r1[x] * 0.12;
  }
  const cf = new Float32Array(w), cp = new Float32Array(w);
  for (let x = 0; x < w; x++) { cf[x] = 0.002 + rng() * 0.008; cp[x] = rng() * 100; }
  const T = new Uint8Array(w * h);
  const amp = 0.05 + 0.1 * we;
  for (let y = 0; y < h; y++) {
    const u = y / 2 - 0.25, a = Math.max(0, Math.floor(u)), fy = u - a, a1 = Math.min(hh - 1, a + 1), ac = Math.min(hh - 1, a);
    for (let x = 0; x < w; x++) {
      const v = x / 2 - 0.25, b = Math.max(0, Math.floor(v)), fx = v - b, b1 = Math.min(hw - 1, b + 1), bc = Math.min(hw - 1, b);
      const base = (half[ac * hw + bc] * (1 - fx) + half[ac * hw + b1] * fx) * (1 - fy) + (half[a1 * hw + bc] * (1 - fx) + half[a1 * hw + b1] * fx) * fy;
      const m = fm[ac * hw + bc];
      let q = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
      q = Math.imul(q ^ (q >>> 15), 0x2c1b3c6d); q ^= q >>> 12;
      const sp = ((q & 255) / 255 - 0.5) * 0.02;
      const fade = 0.25 + 0.75 * Math.max(0, Math.sin(y * cf[x] + cp[x]) * 0.8 + 0.35);
      const v2 = base + col[x] * amp * (0.2 + m) * fade + sp;
      T[y * w + x] = clamp(v2, 0, 1) * 255;
    }
  }
  // cracks along the grain
  const nCr = Math.round(params.cracks * 7);
  for (let k = 0; k < nCr; k++) {
    let cx = rng() * w;
    const y0 = rng() < 0.5 ? 0 : rng() * h * 0.6;
    const len = h * rng.range(0.25, 1.1);
    const wmax = rng.range(1.4, 4.5) * (w / 1200) + 0.3;
    for (let yy = 0; yy < len; yy++) {
      const y = Math.floor(y0 + yy);
      if (y >= h) break;
      cx += noise.noise2(yy * 0.006, k * 17.3) * 0.9 + noise.noise2(yy * 0.05, k) * 0.35;
      const prog = yy / len;
      const taper = Math.pow(Math.sin(Math.PI * clamp(prog)), 0.45);
      const wd = wmax * taper * (0.6 + 0.6 * Math.abs(noise.noise2(yy * 0.03, k * 3.1)));
      const xi = Math.round(cx);
      for (let dx = -6; dx <= 6; dx++) {
        const x = xi + dx;
        if (x < 0 || x >= w) continue;
        const d = Math.abs(x - cx);
        const dark = smoothstep(wd + 0.8, 0, d);
        if (dark > 0) T[y * w + x] *= 1 - 0.85 * dark;
      }
    }
  }
  const GX = new Int8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      GX[i] = clamp((T[i + 1] - T[i - 1]) * 0.5, -127, 127);
    }
  }
  st.T = T; st.GX = GX;
}

// ---------------------------------------------------------------- lighting & colour setup
function setLight(st, p) {
  const a = (p.lightAngle * Math.PI) / 180;
  const el = (p.elevation * Math.PI) / 180;
  // angle 0 = light from top, clockwise; direction *towards* the light in screen coords
  st.Lxu = Math.sin(a);
  st.Lyu = -Math.cos(a);
  st.Lz = Math.sin(el);
  const cxy = Math.cos(el);
  st.Lx = st.Lxu * cxy;
  st.Ly = st.Lyu * cxy;
  st.tanE = Math.tan(el);
  const bt = Math.round(p.mode) === 1;
  st.hs = (5 + 24 * p.relief) * (bt ? 0.3 : 1);
  st.shStrength = p.shadow * (bt ? 0.45 : 1);
  st.hsS = st.hs * 0.55; // cast-shadow depth (shorter than wall slope so floors stay lit)
  st.R = Math.min(34, Math.ceil(st.hsS / st.tanE) + 2);
}

function prepColors(st, p) {
  const print = p.palette === 'print';
  let sl, sd, cut, fr, sh;
  if (print) {
    const paper = hexToRgb(p.paper), ink = hexToRgb(p.ink);
    const mx = (t) => [lerp(paper[0], ink[0], t), lerp(paper[1], ink[1], t), lerp(paper[2], ink[2], t)];
    sl = mx(0.04); sd = mx(0.42); cut = mx(0.0); fr = mx(0.55); sh = ink;
    st.paperC = paper; st.inkC = ink;
  } else {
    sl = hexToRgb(p.surfLight); sd = hexToRgb(p.surfDark); cut = hexToRgb(p.cut);
    fr = hexToRgb(p.frassCol); sh = hexToRgb(p.shadowCol);
  }
  if (!print && Math.round(p.mode) === 1) {
    const mx = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    sl = mx(sl, [128, 92, 66], 0.6); sd = mx(sd, [58, 38, 26], 0.6); cut = mx(cut, [240, 230, 212], 0.45);
  }
  if (!print && Math.round(p.mode) !== 1) {
    cut = [lerp(cut[0], sl[0], 0.55) * 0.82, lerp(cut[1], sl[1], 0.55) * 0.82, lerp(cut[2], sl[2], 0.55) * 0.82];
  }
  const lut = new Float32Array(768);
  for (let i = 0; i < 256; i++) {
    const u = smoothstep(0.1, 0.92, i / 255);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = lerp(sd[c], sl[c], u);
  }
  st.col = { print, lut, cut, fr, sh };
}

// ---------------------------------------------------------------- tile queue
function markAll(st, bits) {
  for (let i = 0; i < st.dirty.length; i++) markTile(st, i, bits);
}
function markTile(st, i, bits) {
  const d = st.dirty[i];
  if (d === 0) { st.queue[st.qt] = i; st.qt = (st.qt + 1) % st.queue.length; st.qn++; }
  st.dirty[i] = d | bits;
}
function markBBox(st, x0, y0, x1, y1) {
  const R = st.R || 34, Lx = st.Lxu || 0, Ly = st.Lyu || 0;
  const m = 3;
  const a0 = x0 - m - R * Math.max(Lx, 0), a1 = x1 + m + R * Math.max(-Lx, 0);
  const b0 = y0 - m - R * Math.max(Ly, 0), b1 = y1 + m + R * Math.max(-Ly, 0);
  const tx0 = clamp(Math.floor(a0 / TS), 0, st.tw - 1), tx1 = clamp(Math.floor(a1 / TS), 0, st.tw - 1);
  const ty0 = clamp(Math.floor(b0 / TS), 0, st.th - 1), ty1 = clamp(Math.floor(b1 / TS), 0, st.th - 1);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) markTile(st, ty * st.tw + tx, 3);
}

function processQueue(env, st, p, budgetMs) {
  if (st.qn === 0) return;
  const t0 = performance.now();
  let n = st.qn;
  if (budgetMs !== Infinity) n = Math.min(n, Math.max(6, Math.floor(budgetMs / st.tileMs)));
  const batch = [];
  for (let i = 0; i < n; i++) {
    const id = st.queue[st.qh];
    st.qh = (st.qh + 1) % st.queue.length;
    st.qn--;
    batch.push(id, st.dirty[id]);
    st.dirty[id] = 0;
  }
  for (let i = 0; i < batch.length; i += 2) if (batch[i + 1] & 2) litTile(st, batch[i] % st.tw, (batch[i] / st.tw) | 0);
  for (let i = 0; i < batch.length; i += 2) {
    const id = batch[i];
    flagTile(st, id % st.tw, (id / st.tw) | 0);
  }
  for (let i = 0; i < batch.length; i += 2) composeTile(env, st, batch[i] % st.tw, (batch[i] / st.tw) | 0);
  const per = (performance.now() - t0) / (batch.length / 2);
  st.tileMs = lerp(st.tileMs, clamp(per, 0.01, 1), 0.3);
}

// LIT: relief shading + cast shadow, per grid cell
function litTile(st, tx, ty) {
  const { gw, gh, E, F, LIT, NF, hs, hsS, Lx, Ly, Lz, Lxu, Lyu, tanE, shStrength } = st;
  const x0 = tx * TS, y0 = ty * TS, x1 = Math.min(gw, x0 + TS), y1 = Math.min(gh, y0 + TS);
  const amb = 0.24;
  const kmax = Math.min(18, Math.ceil(hsS / (tanE * 2)) + 1);
  const dx = Lxu * 2, dy = Lyu * 2;
  for (let y = y0; y < y1; y++) {
    const ym = y > 0 ? gw : 0, yp = y < gh - 1 ? gw : 0;
    for (let x = x0; x < x1; x++) {
      const i = y * gw + x;
      const e = E[i];
      const xm = x > 0 ? 1 : 0, xp = x < gw - 1 ? 1 : 0;
      const x2p = x + 2 < gw ? 2 : xp, x2m = x - 2 >= 0 ? 2 : xm, y2p = y + 2 < gh ? 2 * gw : yp, y2m = y - 2 >= 0 ? 2 * gw : ym;
      const gxv = ((E[i + xp] - E[i - xm]) * 0.5 + (E[i + x2p] - E[i - x2m]) * 0.25) * 0.5 * hs;
      const gyv = ((E[i + yp] - E[i - ym]) * 0.5 + (E[i + y2p] - E[i - y2m]) * 0.25) * 0.5 * hs;
      let lit = 1;
      if (e > 0 || gxv !== 0 || gyv !== 0) {
        const lamb = (gxv * Lx + gyv * Ly + Lz) / Math.sqrt(gxv * gxv + gyv * gyv + 1);
        let norm = lamb / Lz;
        norm = norm < 0 ? 0 : norm > 1.55 ? 1.55 : norm;
        let sh = 0;
        if (e > 0.02) {
          let ms = -1e9;
          for (let k = 1; k <= kmax; k++) {
            const qx = Math.round(x + dx * k), qy = Math.round(y + dy * k);
            if (qx < 0 || qy < 0 || qx >= gw || qy >= gh) break;
            const s = (e - E[qy * gw + qx]) * hsS - k * 2 * tanE;
            if (s > ms) ms = s;
          }
          sh = smoothstep(-0.9, 1.8, ms);
        }
        lit = amb + (1 - amb) * norm * (1 - shStrength * sh);
      }
      LIT[i] = lit;
      NF[i] = e > 0 || F[i] > 0.02 || lit < 0.999 || lit > 1.001 ? 1 : 0;
    }
  }
}

function flagTile(st, tx, ty) {
  const { gw, gh, NF, FD } = st;
  const x0 = tx * TS, y0 = ty * TS, x1 = Math.min(gw, x0 + TS), y1 = Math.min(gh, y0 + TS);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let f = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(gh - 1, y + 1) && !f; yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(gw - 1, x + 1); xx++) if (NF[yy * gw + xx]) { f = 1; break; }
      FD[y * gw + x] = f;
    }
  }
}

function composeTile(env, st, tx, ty) {
  const { w, h, ctx } = env;
  const { gw, E, F, LIT, FD, T, GX, xi0, xi1, xf, yi0, yi1, yf, col, Lxu } = st;
  const p = env.params;
  const data = st.img.data;
  const px0 = tx * TS * S, py0 = ty * TS * S;
  const px1 = Math.min(w, px0 + TS * S), py1 = Math.min(h, py0 + TS * S);
  if (px0 >= px1 || py0 >= py1) return;
  const lut = col.lut, cut = col.cut, fr = col.fr, shc = col.sh, print = col.print;
  const gk = 0.006 * (0.4 + p.relief) * Lxu;
  const pap = st.paperC, ink = st.inkC;
  for (let y = py0; y < py1; y++) {
    const ya = yi0[y] * gw, yb = yi1[y] * gw, fy = yf[y], cyy = y >> 1;
    for (let x = px0; x < px1; x++) {
      const pi = y * w + x;
      const t = T[pi];
      let r, g, b;
      if (FD[cyy * gw + (x >> 1)] === 0) {
        const sh = 1 - GX[pi] * gk;
        r = lut[t * 3] * sh; g = lut[t * 3 + 1] * sh; b = lut[t * 3 + 2] * sh;
      } else {
        const xa = xi0[x], xb = xi1[x], fx = xf[x];
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const i00 = ya + xa, i10 = ya + xb, i01 = yb + xa, i11 = yb + xb;
        const e = E[i00] * w00 + E[i10] * w10 + E[i01] * w01 + E[i11] * w11;
        const lit = LIT[i00] * w00 + LIT[i10] * w10 + LIT[i01] * w01 + LIT[i11] * w11;
        const f = F[i00] * w00 + F[i10] * w10 + F[i01] * w01 + F[i11] * w11;
        let q = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
        q = Math.imul(q ^ (q >>> 15), 0x2c1b3c6d); q ^= q >>> 12;
        const hh = (q & 255) / 255;
        const tn = 0.72 + 0.5 * (t / 255);
        const dm = e <= 0.02 ? 0 : smoothstep(0.02, 0.4, e);
        const ao = 1 - 0.3 * (1 - smoothstep(0.3, 0.95, e)) * smoothstep(0.02, 0.3, e) - 0.08 * smoothstep(0.5, 1, e);
        r = lerp(lut[t * 3], cut[0] * tn, dm) * ao;
        g = lerp(lut[t * 3 + 1], cut[1] * tn, dm) * ao;
        b = lerp(lut[t * 3 + 2], cut[2] * tn, dm) * ao;
        const fa = smoothstep(0.2, 0.8, f);
        if (fa > 0) {
          const cr = 0.55 + 0.75 * hh * (0.6 + 0.4 * (t / 255) * 2);
          const k = fa * 0.96;
          r = lerp(r, fr[0] * cr, k); g = lerp(g, fr[1] * cr, k); b = lerp(b, fr[2] * cr, k);
        }
        const sh = 1 - GX[pi] * gk * (1 - dm);
        const lm = lit * sh;
        const dk = (1 - Math.min(lit, 1)) * 0.5;
        r = r * lm + shc[0] * dk; g = g * lm + shc[1] * dk; b = b * lm + shc[2] * dk;
      }
      if (print) {
        let q = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
        q = Math.imul(q ^ (q >>> 15), 0x2c1b3c6d); q ^= q >>> 12;
        const hh = (q & 255) / 255;
        let v = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
        // luminance came from paper/ink ramps: renormalise against them
        const lp = (pap[0] * 0.3 + pap[1] * 0.59 + pap[2] * 0.11) / 255;
        const li = (ink[0] * 0.3 + ink[1] * 0.59 + ink[2] * 0.11) / 255;
        v = (v - li) / Math.max(0.05, lp - li);
        const m = smoothstep(0.3, 0.7, (v - 0.55) * 1.5 + 0.55 + (hh - 0.5) * 0.3);
        r = lerp(ink[0], pap[0], m); g = lerp(ink[1], pap[1], m); b = lerp(ink[2], pap[2], m);
      }
      const di = pi * 4;
      data[di] = r; data[di + 1] = g; data[di + 2] = b;
    }
  }
  ctx.putImageData(st.img, 0, 0, px0, py0, px1 - px0, py1 - py0);
}

// ---------------------------------------------------------------- carving
function updateE(st, i) {
  const f = st.F[i];
  st.E[i] = st.D[i] * (1 - 0.72 * smoothstep(0.55, 0.95, f));
}

// carve a soft-walled disc into the depth field
function stamp(st, cx, cy, r, rag) {
  const { gw, gh, D, G, F } = st;
  const ew = Math.min(clamp(0.45 * r, 2, 5), r * 0.85);
  const pad = r + 4;
  const x0 = Math.max(0, Math.floor(cx - pad)), x1 = Math.min(gw - 1, Math.ceil(cx + pad));
  const y0 = Math.max(0, Math.floor(cy - pad)), y1 = Math.min(gh - 1, Math.ceil(cy + pad));
  if (x0 > x1 || y0 > y1) return;
  const rg = rag * (0.5 + 0.07 * r);
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const i = y * gw + x;
      const d = Math.sqrt(dx * dx + dy * dy) + G[i] * rg * 2.6;
      if (d >= r) continue;
      let u = (r - d) / ew;
      if (u > 1) u = 1;
      const v = u * u * (3 - 2 * u);
      if (v > D[i]) { D[i] = v; updateE(st, i); }
    }
  }
  markBBox(st, x0, y0, x1, y1);
}

// frass fill (raised, crumbly) over already-carved cells
function stampPlug(st, cx, cy, r, rag) {
  const { gw, gh, D, G, F } = st;
  const x0 = Math.max(0, Math.floor(cx - r - 2)), x1 = Math.min(gw - 1, Math.ceil(cx + r + 2));
  const y0 = Math.max(0, Math.floor(cy - r - 2)), y1 = Math.min(gh - 1, Math.ceil(cy + r + 2));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * gw + x;
    if (D[i] < 0.5) continue;
    const d = Math.hypot(x - cx, y - cy) + G[i] * (0.8 + rag) * 1.6;
    const v = smoothstep(r, r * 0.7, d);
    if (v > F[i]) { F[i] = v; updateE(st, i); }
  }
  markBBox(st, x0, y0, x1, y1);
}

function speck(st, x, y, v) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= st.gw || yi >= st.gh) return;
  const i = yi * st.gw + xi;
  if (st.D[i] > 0.05 && v < 0.6) return;
  if (v > st.F[i]) { st.F[i] = v; if (st.D[i] > 0) updateE(st, i); }
  markBBox(st, xi, yi, xi, yi);
}

function chamber(st, ag, rr) {
  const ca = Math.cos(ag.a), sa = Math.sin(ag.a);
  const rng = st.rng;
  const fwd = rr * 0.55;
  for (let k = -2; k <= 2; k++) {
    const rk = rr * (1 - 0.1 * Math.abs(k)) * (0.9 + 0.2 * rng());
    stamp(st, ag.x + ca * (fwd + k * rr * 0.4) + (rng() - 0.5) * rr * 0.25, ag.y + sa * (fwd + k * rr * 0.4) + (rng() - 0.5) * rr * 0.25, rk, st.rag);
  }
  ag.x += ca * fwd * 1.1; ag.y += sa * fwd * 1.1;
}

function plug(st, ag, len) {
  const tr = ag.trail;
  const n = Math.min(tr.length / 3, len);
  for (let j = 0; j < n; j += 2) {
    const o = tr.length - 3 * (j + 1);
    stampPlug(st, tr[o], tr[o + 1], tr[o + 2] * 1.05, st.rag);
  }
}

function hole(st, x, y, rh) {
  const rng = st.rng;
  stamp(st, x, y, rh, st.rag * 0.4);
  const n = 40 + Math.floor(rng() * 70);
  for (let i = 0; i < n; i++) {
    const sx = x + rng.gauss() * rh * 1.1;
    const sy = y + rh * 0.8 + Math.abs(rng.gauss()) * rh * 3.6;
    speck(st, sx, sy, 0.6 + rng() * 0.4);
    speck(st, sx + 1, sy, 0.6 + rng() * 0.4);
    if (rng() < 0.6) speck(st, sx, sy + 1, 0.6 + rng() * 0.4);
  }
}

// ---------------------------------------------------------------- simulation
function newAgent(st, o) {
  return Object.assign({
    x: 0, y: 0, a: 0, tr: 0, r0: 6, life: 300, age: 0, grow: 0, wander: 1, bias: 0.4, avoid: 0.7,
    wv: 0.15, kind: 't', noff: st.rng() * 100, pref: st.rng() < 0.5 ? -1 : 1, blocked: 0,
    trail: [], spawnCnt: 0, side: 1, canBranch: false, gap: 20, ids: 0,
  }, o);
}

function initSim(env, st) {
  const { params: p, rng, w, h } = env;
  const mode = Math.round(p.mode);
  const gw = st.gw, gh = st.gh;
  const sim = st.sim = { agents: [], acc: 0, done: false, steps: 0, pts: [], pending: [], mode, started: false };
  st.rag = p.ragged;
  st.sz = Math.min(w, h) / 1200;
  st.baseR = (p.width * st.sz) / (2 * S);
  st.len = gw / 600;
  sim.cap = Math.ceil(p.population * 4 + 6);
  sim.maxSteps = 260000;
  sim.budget = mode === 0 ? p.appetite * 1.5 * gw * gh : Infinity;
  const lifeScale = 0.45 + 1.1 * p.appetite;
  st.lifeScale = lifeScale;
  if (mode === 1) {
    const n = p.population > 20 ? 3 : p.population > 9 ? 2 : 1;
    const centers = [];
    for (let k = 0; k < n; k++) {
      let best = null, bd = -1;
      for (let tries = 0; tries < 30; tries++) {
        const c = n === 1 ? [gw * rng.range(0.42, 0.58), gh * rng.range(0.46, 0.54)] : [rng.range(0.2, 0.8) * gw, rng.range(0.38, 0.62) * gh];
        let md = 1e9;
        for (const o of centers) md = Math.min(md, Math.hypot(o[0] - c[0], o[1] - c[1]));
        if (md > bd) { bd = md; best = c; }
      }
      centers.push(best);
    }
    sim.pending = centers.map((c) => ({ c, lm: n === 1 ? 1 : n === 2 ? 0.78 : 0.62 }));
  } else if (mode === 2) {
    const n = Math.round(p.population * 5 * (0.3 + 1.4 * p.appetite));
    for (let k = 0; k < n; k++) {
      let x, y, tries = 0;
      do {
        x = rng.range(0.04, 0.96) * gw; y = rng.range(0.04, 0.96) * gh;
        tries++;
      } while (env.noise.fbm2(x * 0.006 + 3, y * 0.004, 2) < -0.12 && tries < 12);
      sim.pending.push({ c: [x, y] });
    }
  }
}

function spawnTermite(st, p, env) {
  const { rng } = st, sim = st.sim;
  let x, y, a;
  if (sim.pts.length > 5 && rng() < 0.6) {
    const q = sim.pts[(rng() * sim.pts.length) | 0];
    x = q[0]; y = q[1];
    a = q[2] + (rng() < 0.5 ? 1 : -1) * rng.range(0.6, 1.7);
  } else {
    x = rng.range(0.05, 0.95) * st.gw; y = rng.range(0.05, 0.95) * st.gh;
    a = AXIS + (rng() < 0.5 ? 0 : Math.PI) + rng.gauss() * (1 - p.grainBias) * 1.4;
  }
  sim.agents.push(newAgent(st, {
    x, y, a, r0: st.baseR * rng.range(0.7, 1.2), life: rng.range(300, 900) * st.len,
    grow: p.growth * 0.8, wander: p.wander, bias: p.grainBias, avoid: p.avoid, wv: 0.2, kind: 't', canBranch: true,
  }));
}

function spawnSystem(st, p, sys) {
  const { rng } = st, sim = st.sim;
  const [cx, cy] = sys.c;
  const rm = st.baseR * 0.2;
  const lm = sys.lm;
  const life = st.gh * 0.36 * lm * st.lifeScale * rng.range(0.9, 1.05);
  const jit = 0.02 + (1 - p.grainBias) * 0.12;
  const a0 = AXIS + rng.gauss() * jit;
  chamberAt(st, cx, cy, rm * 1.8);
  for (const dir of [0, Math.PI]) {
    sim.agents.push(newAgent(st, {
      x: cx, y: cy, a: a0 + dir, r0: rm, life, grow: 0, wander: 0.1, bias: 1, avoid: 0.9, wv: 0.05, kind: 'mother',
      armDir: a0 + dir, lm, spawnCnt: 3, side: rng() < 0.5 ? 1 : -1,
    }));
  }
}

function chamberAt(st, x, y, rr) {
  const ag = { x, y, a: st.rng() * Math.PI };
  chamber(st, ag, rr);
}

function spawnWorm(st, p, sys) {
  const { rng } = st, sim = st.sim;
  const [x, y] = sys.c;
  const r0 = Math.max(1.8, st.baseR * 0.26);
  hole(st, x, y, r0 * 1.5 + 1.6);
  sim.agents.push(newAgent(st, {
    x, y, a: rng() * Math.PI * 2, r0, life: rng.range(30, 120) * st.len * st.lifeScale,
    grow: 0, wander: p.wander * 1.4 + 0.2, bias: p.grainBias * 0.4, avoid: p.avoid, wv: 0.1, kind: 'worm',
  }));
}

function sampleD(st, x, y) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= st.gw || yi >= st.gh) return 0;
  return st.D[yi * st.gw + xi];
}

function stepSim(st, p, env) {
  const sim = st.sim, rng = st.rng, noise = st.noise;
  sim.steps++;
  if (sim.steps > sim.maxSteps) { sim.done = true; return; }
  // spawning
  if (sim.mode === 0) {
    if (sim.budget > 0) {
      while (sim.agents.length < p.population) spawnTermite(st, p, env);
    }
  } else if (sim.mode === 1) {
    if (sim.pending.length && sim.agents.length === 0) spawnSystem(st, p, sim.pending.shift());
  } else {
    if (sim.pending.length && sim.agents.length < 22 && rng() < 0.5) spawnWorm(st, p, sim.pending.shift());
  }
  if (sim.agents.length === 0 && !sim.pending.length) { sim.done = true; return; }

  const agents = sim.agents;
  for (let ai = agents.length - 1; ai >= 0; ai--) {
    const ag = agents[ai];
    const prog = ag.age / ag.life;
    let r = ag.r0 * (1 + ag.grow * (2.2 * prog - 0.9));
    r *= 1 + ag.wv * noise.noise3(ag.x * 0.03, ag.y * 0.03, ag.noff);
    if (r < 1.0) r = 1.0;
    const turnScale = 6 / (r + 3);
    ag.tr += rng.gauss() * 0.015 * ag.wander - ag.tr * 0.07;
    let da = (ag.tr + noise.noise3(ag.x * 0.012, ag.y * 0.012, ag.noff) * 0.035 * ag.wander) * turnScale;
    if (ag.bias > 0) da -= ag.bias * 0.05 * Math.sin(2 * (ag.a - AXIS));
    if (ag.fan) da -= 0.03 * Math.min(1, ag.age / 25) * Math.sin(ag.a - ag.armDir) * (0.4 + prog);
    // avoidance of already-carved wood
    const L1 = r * 1.5 + 3 + (ag.look || r * 0.5);
    const pl = sampleD(st, ag.x + Math.cos(ag.a - 0.8) * L1, ag.y + Math.sin(ag.a - 0.8) * L1);
    const pr = sampleD(st, ag.x + Math.cos(ag.a + 0.8) * L1, ag.y + Math.sin(ag.a + 0.8) * L1);
    const pc = sampleD(st, ag.x + Math.cos(ag.a) * L1 * 1.2, ag.y + Math.sin(ag.a) * L1 * 1.2);
    const pf = sampleD(st, ag.x + Math.cos(ag.a) * L1 * 2.4, ag.y + Math.sin(ag.a) * L1 * 2.4);
    da += ag.avoid * 0.13 * (pl - pr);
    if (pf > 0.4) da += ag.avoid * ag.pref * 0.03;
    if (pc > 0.4) {
      ag.blocked++;
      da += ag.avoid * ag.pref * 0.1;
    } else if (ag.blocked > 0) ag.blocked--;
    const lim = 0.16;
    da = da < -lim ? -lim : da > lim ? lim : da;
    ag.a += da;
    ag.x += Math.cos(ag.a);
    ag.y += Math.sin(ag.a);
    stamp(st, ag.x, ag.y, r, st.rag);
    ag.trail.push(ag.x, ag.y, r);
    if (ag.trail.length > 240) ag.trail.splice(0, 60);
    ag.age++;
    sim.budget -= 1.7 * r;
    if (ag.age % 6 === 0 && sim.pts.length < 5000 && ag.kind === 't') sim.pts.push([ag.x, ag.y, ag.a]);
    // frass dust inside the tunnel and specks at the head
    if (p.frass > 0) {
      if (rng() < 0.35 * p.frass) {
        const ang = rng() * 6.283, rr = rng() * r * 0.8;
        speck(st, ag.x - Math.cos(ag.a) * r * 0.6 + Math.cos(ang) * rr, ag.y - Math.sin(ag.a) * r * 0.6 + Math.sin(ang) * rr, 0.3 + rng() * 0.3);
      }
      if (rng() < 0.05 * p.frass && ag.kind !== 'worm') {
        const ang = rng() * 6.283, rr = r * (1.3 + rng() * 2);
        speck(st, ag.x + Math.cos(ang) * rr, ag.y + Math.sin(ang) * rr, 0.6 + rng() * 0.4);
      }
    }
    // events
    let dead = false;
    if (ag.kind === 't') {
      if (ag.canBranch && rng() < p.branching * 0.0048 && agents.length < sim.cap && sim.budget > 0) {
        agents.push(newAgent(st, {
          x: ag.x, y: ag.y, a: ag.a + (rng() < 0.5 ? 1 : -1) * rng.range(0.7, 1.5), r0: ag.r0 * rng.range(0.6, 0.95),
          life: rng.range(100, 360) * st.len, grow: ag.grow, wander: ag.wander, bias: ag.bias, avoid: ag.avoid, wv: ag.wv, kind: 't', canBranch: true,
        }));
      }
      if (ag.age > 25 && rng() < p.chambers * 0.0035) {
        chamber(st, ag, r * rng.range(1.5, 2.2));
        if (rng() < p.frass * 0.5) plug(st, ag, 12 + rng() * 22);
      }
    } else if (ag.kind === 'mother') {
      ag.spawnCnt--;
      if (ag.spawnCnt <= 0 && ag.age > 4) {
        ag.side = -ag.side;
        const rc = st.baseR * 0.15;
        const rEnd = rc * 2.1;
        ag.spawnCnt = rEnd * 1.15 * lerp(1.35, 0.85, p.branching) * rng.range(0.9, 1.15);
        const ca = Math.cos(ag.a), sa = Math.sin(ag.a);
        const ha = ag.a + ag.side * (Math.PI / 2) + rng.gauss() * 0.04;
        agents.push(newAgent(st, {
          x: ag.x - sa * ag.side * r * 0.8, y: ag.y + ca * ag.side * r * 0.8, a: ha, r0: rc,
          life: st.gw * rng.range(0.28, 0.5) * ag.lm * st.lifeScale, grow: 0.92, wander: p.wander * 0.35 + 0.05,
          bias: 0, fan: 1, armDir: ag.armDir, look: 5, avoid: 1, wv: 0.1, kind: 'larva',
        }));
      }
    }
    if (ag.x < -r - 4 || ag.y < -r - 4 || ag.x > st.gw + r + 4 || ag.y > st.gh + r + 4) dead = true;
    const blockLimit = 6 + (1 - ag.avoid) * 220;
    if (ag.blocked > blockLimit) dead = true;
    if (ag.age >= ag.life) dead = true;
    if (sim.budget <= 0 && ag.kind === 't') dead = true;
    if (dead) {
      endAgent(st, p, ag, r);
      agents.splice(ai, 1);
    }
  }
  if (agents.length === 0 && !sim.pending.length && (sim.mode !== 0 || sim.budget <= 0)) sim.done = true;
}

function endAgent(st, p, ag, r) {
  const rng = st.rng;
  const inside = ag.x > 0 && ag.y > 0 && ag.x < st.gw && ag.y < st.gh;
  if (!inside) return;
  if (ag.kind === 't') {
    if (rng() < 0.25 + p.chambers * 0.5) chamber(st, ag, r * rng.range(1.4, 2.0));
    if (rng() < p.frass * 0.6) plug(st, ag, 10 + rng() * 24);
  } else if (ag.kind === 'larva') {
    if (rng() < 0.3 + 0.5 * p.chambers) chamber(st, ag, r * rng.range(1.2, 1.5));
  } else if (ag.kind === 'mother') {
    chamber(st, ag, r * 1.3);
  } else if (ag.kind === 'worm') {
    if (rng() < 0.55) hole(st, ag.x, ag.y, ag.r0 * 1.5 + 1.6);
  }
}
