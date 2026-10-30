import { makeRng, makeNoise } from './lib/noise.js';
import { CONTROL_TYPES } from './ui/controls.js';
import termite from './gen/termite.js';
import log from './gen/log.js';
import engrave from './gen/engrave.js';
import texture from './gen/texture.js';
import roots from './gen/roots.js';

const GENERATORS = [log, termite, engrave, texture, roots];

const SIZES = {
  square: [1200, 1200],
  portrait: [1000, 1250],
  landscape: [1500, 1000],
  story: [900, 1600],
};

const $ = (s) => document.querySelector(s);
const canvas = $('#stage');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const app = {
  gen: null,
  env: null,
  controls: {},
  lfo: new Set(),
  lfoBase: {},
  playing: true,
  t: 0,
  last: 0,
  size: 'square',
  dirty: false, // a setup is pending
  redraw: false, // a still redraw is pending
  values: {}, // remembered params per generator id
};

function withSeed(gen) {
  if (!gen.params.some((p) => p.type === 'seed')) {
    gen.params.push({ key: 'seed', label: 'Seed', type: 'seed', default: 1234, group: 'Seed' });
  }
  return gen;
}
GENERATORS.forEach(withSeed);

function buildTabs() {
  const nav = $('#tabs');
  GENERATORS.forEach((g, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.innerHTML = `<span class="tab-num">${String(i + 1).padStart(2, '0')}</span>${g.name}`;
    b.addEventListener('click', () => select(g.id));
    b.dataset.id = g.id;
    nav.append(b);
  });
}

function buildRack(gen, params) {
  const rack = $('#rack');
  rack.innerHTML = '';
  app.controls = {};
  app.lfo.clear();
  const groups = new Map();
  for (const p of gen.params) {
    const gname = p.group ?? 'Shape';
    if (!groups.has(gname)) {
      const sec = document.createElement('section');
      sec.className = 'panel';
      sec.innerHTML = `<h3>${gname}</h3><div class="panel-body"></div>`;
      rack.append(sec);
      groups.set(gname, sec.querySelector('.panel-body'));
    }
    const make = CONTROL_TYPES[p.type];
    if (!make) { console.warn('Unknown control type', p.type); continue; }
    const c = make(
      p.type === 'image' && params[p.key] ? { ...p, default: null } : p,
      (v) => onParam(p, v),
      (on) => {
        if (on) { app.lfo.add(p.key); app.lfoBase[p.key] = params[p.key]; }
        else { app.lfo.delete(p.key); c.set(app.lfoBase[p.key]); onParam(p, app.lfoBase[p.key]); }
      },
    );
    if (params[p.key] != null) c.set(params[p.key]);
    groups.get(gname).append(c.el);
    app.controls[p.key] = c;
  }
}

function onParam(p, v) {
  app.env.params[p.key] = v;
  if (app.lfo.has(p.key)) app.lfoBase[p.key] = v;
  if (p.live) app.redraw = true;
  else app.dirty = true;
}

function defaults(gen) {
  const o = {};
  for (const p of gen.params) o[p.key] = p.type === 'image' ? null : p.default;
  return o;
}

function select(id) {
  const gen = GENERATORS.find((g) => g.id === id);
  if (app.env && app.gen) app.values[app.gen.id] = app.env.params;
  app.gen = gen;
  const params = app.values[id] ?? defaults(gen);
  app.env = { ctx, canvas, w: canvas.width, h: canvas.height, params, state: {}, playing: app.playing };
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.id === id));
  $('#gen-name').textContent = gen.name;
  $('#gen-blurb').textContent = gen.blurb ?? '';
  buildRack(gen, params);
  history.replaceState(null, '', '#' + id);
  app.dirty = true;
}

function setup() {
  const { env, gen } = app;
  env.w = canvas.width;
  env.h = canvas.height;
  env.state = {};
  env.playing = app.playing;
  env.rng = makeRng(env.params.seed);
  env.noise = makeNoise(env.params.seed);
  app.t = 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const t0 = performance.now();
  try {
    gen.setup(env);
    gen.draw(env, 0, 0);
  } catch (e) {
    console.error(e);
    showError(e);
  }
  $('#stat-setup').textContent = `${Math.round(performance.now() - t0)} ms`;
}

function showError(e) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#2a1712';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f0c9a8';
  ctx.font = '28px ui-monospace, monospace';
  ctx.fillText('Generator error: ' + e.message, 40, 60);
}

function applyLfo(t) {
  for (const key of app.lfo) {
    const p = app.gen.params.find((q) => q.key === key);
    const base = app.lfoBase[key];
    const span = (p.max - p.min) * 0.22;
    const h = key.length * 1.7;
    const w = Math.sin(t * 0.7 + h) * 0.65 + Math.sin(t * 1.9 + h * 2.3) * 0.35;
    const v = Math.min(p.max, Math.max(p.min, base + w * span));
    app.env.params[key] = v;
    app.controls[key].set(v);
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - (app.last || now)) / 1000);
  app.last = now;
  if (app.dirty) {
    app.dirty = false;
    app.redraw = false;
    setup();
  } else if (app.playing) {
    app.t += dt;
    applyLfo(app.t);
    try { app.gen.draw(app.env, app.t, dt); } catch (e) { console.error(e); app.playing = false; syncPlay(); showError(e); }
  } else if (app.redraw) {
    app.redraw = false;
    try { app.gen.draw(app.env, app.t, 0); } catch (e) { console.error(e); showError(e); }
  }
  $('#stat-time').textContent = app.t.toFixed(1) + ' s';
  requestAnimationFrame(frame);
}

function syncPlay() {
  $('#play').classList.toggle('on', app.playing);
  $('#play').innerHTML = app.playing ? '<i class="ico pause"></i>Pause' : '<i class="ico play"></i>Play';
  if (app.env) app.env.playing = app.playing;
}

function setSize(name) {
  app.size = name;
  const [w, h] = SIZES[name];
  canvas.width = w;
  canvas.height = h;
  document.querySelectorAll('#sizes button').forEach((b) => b.classList.toggle('on', b.dataset.size === name));
  app.dirty = true;
}

function exportPng() {
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sawmill-${app.gen.id}-${app.env.params.seed}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}

function record() {
  const btn = $('#record');
  if (!canvas.captureStream || typeof MediaRecorder === 'undefined') { btn.textContent = 'No recorder'; return; }
  const stream = canvas.captureStream(30);
  const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12e6 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type }));
    a.download = `sawmill-${app.gen.id}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    btn.classList.remove('rec');
    btn.innerHTML = '<i class="ico dot"></i>Rec 8s';
  };
  if (!app.playing) { app.playing = true; syncPlay(); }
  app.dirty = true;
  rec.start();
  btn.classList.add('rec');
  let left = 8;
  btn.innerHTML = `<i class="ico dot"></i>${left}s`;
  const iv = setInterval(() => {
    left--;
    btn.innerHTML = `<i class="ico dot"></i>${left}s`;
    if (left <= 0) { clearInterval(iv); rec.stop(); }
  }, 1000);
}

function init() {
  buildTabs();
  $('#play').addEventListener('click', () => {
    app.playing = !app.playing;
    syncPlay();
    if (app.gen.restartOnPlay && app.playing) app.dirty = true;
    else if (!app.playing && app.gen.restartOnPlay) app.dirty = true;
  });
  $('#restart').addEventListener('click', () => { app.dirty = true; });
  $('#reseed').addEventListener('click', () => {
    const v = Math.floor(Math.random() * 999999);
    app.env.params.seed = v;
    app.controls.seed?.set(v);
    app.dirty = true;
  });
  $('#reset').addEventListener('click', () => {
    delete app.values[app.gen.id];
    app.env = null;
    select(app.gen.id);
  });
  $('#export').addEventListener('click', exportPng);
  $('#record').addEventListener('click', record);
  document.querySelectorAll('#sizes button').forEach((b) => b.addEventListener('click', () => setSize(b.dataset.size)));
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input')) return;
    if (e.code === 'Space' && !e.target.closest('[role=slider],button')) { e.preventDefault(); $('#play').click(); }
    if (e.key === 'r' && !e.metaKey && !e.ctrlKey) $('#reseed').click();
    if (e.key === 's' && !e.metaKey && !e.ctrlKey) exportPng();
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= GENERATORS.length) select(GENERATORS[n - 1].id);
  });
  setSize('square');
  syncPlay();
  const hash = location.hash.slice(1);
  select(GENERATORS.some((g) => g.id === hash) ? hash : GENERATORS[0].id);
  requestAnimationFrame(frame);
}

init();

// Debug/automation hook (used by the screenshot script).
window.sawmill = { app, select, setSize, GENERATORS };
