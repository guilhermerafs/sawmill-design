// Minimal example of the generator contract. Copy, don't import.
export default {
  id: 'roots',
  name: 'Roots',
  blurb: 'One sentence shown under the title.',
  restartOnPlay: false,
  params: [
    { key: 'rings', label: 'Rings', type: 'knob', min: 2, max: 80, step: 1, default: 24, group: 'Shape' },
    { key: 'wobble', label: 'Wobble', type: 'knob', min: 0, max: 1, step: 0.01, default: 0.3, live: true, group: 'Shape' },
    { key: 'angle', label: 'Angle', type: 'dial', min: 0, max: 360, step: 1, default: 0, wrap: true, unit: '°', live: true, group: 'Shape' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#2b1d14', live: true, group: 'Color' },
    { key: 'paper', label: 'Paper', type: 'color', default: '#efe7d8', live: true, group: 'Color' },
    { key: 'seed', label: 'Seed', type: 'seed', default: 1234, group: 'Seed' },
  ],
  setup(env) {
    // Heavy, param-dependent precomputation. env.state is a fresh {} each time.
    const { w, h, params, rng } = env;
    env.state.offsets = Array.from({ length: params.rings }, () => rng() * Math.PI * 2);
  },
  draw(env, t) {
    const { ctx, w, h, params, noise, state } = env;
    ctx.fillStyle = params.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = params.ink;
    for (let i = 0; i < params.rings; i++) {
      const r = ((i + 1) / params.rings) * Math.min(w, h) * 0.45;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
        const rr = r * (1 + params.wobble * 0.1 * noise.noise3(Math.cos(a), Math.sin(a), i * 0.3 + t * 0.2));
        ctx.lineTo(w / 2 + rr * Math.cos(a + state.offsets[i] * 0), h / 2 + rr * Math.sin(a));
      }
      ctx.stroke();
    }
  },
};
