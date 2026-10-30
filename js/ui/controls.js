// Hardware-style controls: Knob, Dial, Toggle, Select, Color, Seed, Image.
// Each factory returns { el, set(value), get() } and calls onChange(value) on user input.

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

const quantize = (v, p) => {
  const step = p.step ?? (p.max - p.min) / 200;
  const q = Math.round((v - p.min) / step) * step + p.min;
  return Math.min(p.max, Math.max(p.min, +q.toFixed(6)));
};

export const fmt = (v, p) => {
  if (p.format) return p.format(v);
  const step = p.step ?? 0.01;
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return v.toFixed(decimals) + (p.unit ?? '');
};

// Drag vertically (or horizontally), wheel, arrow keys, double-click resets.
function bindDrag(el, p, getV, setV) {
  let startY = 0, startX = 0, startV = 0;
  const range = p.max - p.min;
  const onMove = (e) => {
    const fine = e.shiftKey ? 0.2 : 1;
    const d = (startY - e.clientY + (e.clientX - startX)) / 180;
    setV(quantize(startV + d * range * fine, p));
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus();
    startY = e.clientY;
    startX = e.clientX;
    startV = getV();
    el.classList.add('dragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = p.step ?? range / 200;
    const n = Math.max(step, range / 100);
    setV(quantize(getV() - Math.sign(e.deltaY) * n * (e.shiftKey ? 0.2 : 1), p));
  }, { passive: false });
  el.addEventListener('dblclick', () => setV(p.default));
  el.addEventListener('keydown', (e) => {
    const step = p.step ?? range / 100;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { setV(quantize(getV() + step, p)); e.preventDefault(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { setV(quantize(getV() - step, p)); e.preventDefault(); }
  });
}

// Rotary knob, 270° sweep. Optional LFO "drift" pip when p.live is true.
export function Knob(p, onChange, onLfo) {
  let v = p.default;
  const el = document.createElement('div');
  el.className = 'ctl knob';
  el.innerHTML = `<div class="knob-face" tabindex="0" role="slider" aria-label="${p.label}"></div>
    <div class="ctl-label">${p.label}</div><div class="ctl-value"></div>`;
  const face = el.querySelector('.knob-face');
  const valueEl = el.querySelector('.ctl-value');
  const svg = svgEl('svg', { viewBox: '0 0 64 64' });
  const r = 26, A0 = 135, SWEEP = 270;
  const arcPath = (a0, a1) => {
    const p0 = [32 + r * Math.cos(a0 * Math.PI / 180), 32 + r * Math.sin(a0 * Math.PI / 180)];
    const p1 = [32 + r * Math.cos(a1 * Math.PI / 180), 32 + r * Math.sin(a1 * Math.PI / 180)];
    return `M${p0[0]} ${p0[1]} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1[0]} ${p1[1]}`;
  };
  svg.append(svgEl('path', { d: arcPath(A0, A0 + SWEEP), class: 'knob-track' }));
  const fill = svgEl('path', { class: 'knob-fill' });
  svg.append(fill);
  for (let i = 0; i <= 10; i++) {
    const a = (A0 + (SWEEP * i) / 10) * Math.PI / 180;
    svg.append(svgEl('line', {
      x1: 32 + 29.5 * Math.cos(a), y1: 32 + 29.5 * Math.sin(a),
      x2: 32 + 31.5 * Math.cos(a), y2: 32 + 31.5 * Math.sin(a), class: 'knob-tick',
    }));
  }
  svg.append(svgEl('circle', { cx: 32, cy: 32, r: 20, class: 'knob-cap' }));
  svg.append(svgEl('circle', { cx: 32, cy: 32, r: 16, class: 'knob-cap-inner' }));
  const pointer = svgEl('line', { x1: 32, y1: 32, x2: 32, y2: 15, class: 'knob-pointer' });
  svg.append(pointer);
  face.append(svg);

  let lfoOn = false;
  if (p.live && onLfo) {
    const pip = document.createElement('button');
    pip.className = 'lfo-pip';
    pip.title = 'Drift: let this knob wander while playing';
    pip.addEventListener('click', () => {
      lfoOn = !lfoOn;
      pip.classList.toggle('on', lfoOn);
      onLfo(lfoOn);
    });
    el.append(pip);
  }

  const render = () => {
    const t = (v - p.min) / (p.max - p.min);
    const a = A0 + SWEEP * t;
    fill.setAttribute('d', t > 0.001 ? arcPath(A0, a) : '');
    pointer.setAttribute('transform', `rotate(${a + 90} 32 32)`);
    valueEl.textContent = fmt(v, p);
    face.setAttribute('aria-valuenow', v);
  };
  const setV = (nv) => { if (nv !== v) { v = nv; render(); onChange(v); } };
  bindDrag(face, p, () => v, setV);
  render();
  return { el, get: () => v, set: (nv) => { v = nv; render(); } };
}

// Dial: a notched ring for angles or stepped choices. Full 360° when p.wrap.
export function Dial(p, onChange) {
  let v = p.default;
  const el = document.createElement('div');
  el.className = 'ctl dial';
  el.innerHTML = `<div class="dial-face" tabindex="0" role="slider" aria-label="${p.label}"></div>
    <div class="ctl-label">${p.label}</div><div class="ctl-value"></div>`;
  const face = el.querySelector('.dial-face');
  const valueEl = el.querySelector('.ctl-value');
  const svg = svgEl('svg', { viewBox: '0 0 64 64' });
  const sweep = p.wrap ? 360 : 300;
  const a0 = p.wrap ? -90 : 120;
  const steps = p.step ? Math.min(48, Math.round((p.max - p.min) / p.step)) : 24;
  svg.append(svgEl('circle', { cx: 32, cy: 32, r: 30, class: 'dial-rim' }));
  for (let i = 0; i <= steps; i++) {
    if (p.wrap && i === steps) break;
    const a = (a0 + (sweep * i) / steps) * Math.PI / 180;
    const major = i % Math.max(1, Math.round(steps / 8)) === 0;
    svg.append(svgEl('line', {
      x1: 32 + (major ? 22 : 24.5) * Math.cos(a), y1: 32 + (major ? 22 : 24.5) * Math.sin(a),
      x2: 32 + 28 * Math.cos(a), y2: 32 + 28 * Math.sin(a), class: major ? 'dial-tick major' : 'dial-tick',
    }));
  }
  const rotor = svgEl('g');
  rotor.append(svgEl('circle', { cx: 32, cy: 32, r: 17, class: 'dial-rotor' }));
  for (let i = 0; i < 12; i++) {
    const a = (i * 30) * Math.PI / 180;
    rotor.append(svgEl('line', {
      x1: 32 + 14 * Math.cos(a), y1: 32 + 14 * Math.sin(a),
      x2: 32 + 17 * Math.cos(a), y2: 32 + 17 * Math.sin(a), class: 'dial-knurl',
    }));
  }
  rotor.append(svgEl('path', { d: 'M32 13 L35 21 L29 21 Z', class: 'dial-notch' }));
  svg.append(rotor);
  face.append(svg);

  const render = () => {
    const t = (v - p.min) / (p.max - p.min);
    rotor.setAttribute('transform', `rotate(${a0 + 90 + sweep * t} 32 32)`);
    valueEl.textContent = p.options ? p.options[Math.round(v)] : fmt(v, p);
  };
  const setV = (nv) => {
    if (p.wrap && (nv >= p.max || nv <= p.min)) nv = nv >= p.max ? p.min : p.max;
    if (nv !== v) { v = nv; render(); onChange(v); }
  };
  bindDrag(face, p, () => v, setV);
  render();
  return { el, get: () => v, set: (nv) => { v = nv; render(); } };
}

export function Toggle(p, onChange) {
  let v = p.default;
  const el = document.createElement('div');
  el.className = 'ctl toggle';
  el.innerHTML = `<button class="toggle-sw" role="switch"><span class="toggle-lever"></span></button>
    <div class="ctl-label">${p.label}</div>`;
  const btn = el.querySelector('button');
  const render = () => { btn.classList.toggle('on', v); btn.setAttribute('aria-checked', v); };
  btn.addEventListener('click', () => { v = !v; render(); onChange(v); });
  render();
  return { el, get: () => v, set: (nv) => { v = nv; render(); } };
}

export function Select(p, onChange) {
  let v = p.default;
  const el = document.createElement('div');
  el.className = 'ctl select wide';
  el.innerHTML = `<div class="ctl-label">${p.label}</div><div class="seg"></div>`;
  const seg = el.querySelector('.seg');
  const buttons = p.options.map((o) => {
    const val = typeof o === 'object' ? o.value : o;
    const b = document.createElement('button');
    b.textContent = typeof o === 'object' ? o.label : o;
    b.addEventListener('click', () => { v = val; render(); onChange(v); });
    seg.append(b);
    return [val, b];
  });
  const render = () => buttons.forEach(([val, b]) => b.classList.toggle('on', val === v));
  render();
  return { el, get: () => v, set: (nv) => { v = nv; render(); } };
}

export function Color(p, onChange) {
  let v = p.default;
  const el = document.createElement('label');
  el.className = 'ctl color';
  el.innerHTML = `<input type="color"><span class="swatch"></span><div class="ctl-label">${p.label}</div>`;
  const input = el.querySelector('input');
  const sw = el.querySelector('.swatch');
  const render = () => { input.value = v; sw.style.background = v; };
  input.addEventListener('input', () => { v = input.value; render(); onChange(v); });
  render();
  return { el, get: () => v, set: (nv) => { v = nv; render(); } };
}

export function Seed(p, onChange) {
  let v = p.default;
  const el = document.createElement('div');
  el.className = 'ctl seed wide';
  el.innerHTML = `<div class="ctl-label">${p.label}</div>
    <div class="seed-row"><span class="seed-num"></span><button class="btn small">Reseed</button></div>`;
  const num = el.querySelector('.seed-num');
  const render = () => { num.textContent = String(v).padStart(6, '0'); };
  el.querySelector('button').addEventListener('click', () => {
    v = Math.floor(Math.random() * 999999);
    render();
    onChange(v);
  });
  render();
  return { el, get: () => v, set: (nv) => { v = nv; render(); } };
}

// Image drop/upload. Value is an HTMLImageElement (or null). p.default is a URL.
export function ImageInput(p, onChange) {
  let v = null;
  const el = document.createElement('div');
  el.className = 'ctl image wide';
  el.innerHTML = `<div class="ctl-label">${p.label}</div>
    <label class="drop"><input type="file" accept="image/*" hidden>
      <img alt=""><span>Drop or click to upload</span></label>`;
  const input = el.querySelector('input');
  const drop = el.querySelector('.drop');
  const thumb = el.querySelector('img');
  const load = (src) => {
    const img = new Image();
    img.onload = () => { v = img; thumb.src = src; drop.classList.add('has'); onChange(v); };
    img.src = src;
  };
  const readFile = (f) => { if (f && f.type.startsWith('image/')) load(URL.createObjectURL(f)); };
  input.addEventListener('change', () => readFile(input.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    readFile(e.dataTransfer.files[0]);
  });
  if (p.default) load(p.default);
  const set = (img) => { v = img; if (img) { thumb.src = img.src; drop.classList.add('has'); } };
  return { el, get: () => v, set, load };
}

export const CONTROL_TYPES = { knob: Knob, dial: Dial, toggle: Toggle, select: Select, color: Color, seed: Seed, image: ImageInput };
