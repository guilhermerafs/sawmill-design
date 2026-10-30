# Writing a Sawmill generator

Each generator is one ES module in `js/gen/<id>.js` exporting a default object. No build step, no dependencies. See `js/gen/_template.js`.

```js
export default {
  id, name, blurb,          // blurb: one evocative sentence shown under the title
  restartOnPlay: false,     // true for growth sims: pressing Play/Pause re-runs setup()
  params: [ ...controls ],  // rendered in the right-hand rack, grouped by `group`
  setup(env) {},            // heavy precomputation; called on load, seed/size change, or any non-live param change
  draw(env, t, dt) {},      // called every frame while playing (t = seconds since setup) and once after setup / live change when paused
};
```

`env` = `{ ctx, canvas, w, h, params, state, rng, noise, playing }`
- `ctx` 2D context, canvas is `w`×`h` pixels (900–1600 px per side). Reset any transform/alpha/composite you change.
- `state` is a fresh `{}` per setup — keep everything you compute there.
- `rng()` seeded uniform [0,1) with `.range(a,b) .int(a,b) .pick(arr) .chance(p) .gauss()`.
- `noise.noise2(x,y) noise3(x,y,z) fbm2(x,y,oct,lac,gain) fbm3(x,y,z,oct,lac,gain)` simplex, ≈[-1,1].
- `playing` false means paused: `draw` must still produce a complete, good-looking still frame.
  Growth sims: when `!env.playing`, run the simulation to completion inside `setup` so the still is finished.
- Helpers in `js/lib/noise.js`: `clamp lerp smoothstep hexToRgb mixRgb`.

## Control types (`params` entries)
Common keys: `key, label, type, default, group, live`.
`live: true` = changing it only calls `draw` (no re-setup). Live knobs get an LFO "drift" pip — so make the visual respond smoothly.
- `knob`  `min max step unit` — the main control. Prefer 4, 8 or 12 knobs per group (rack rows are 4 wide).
- `dial`  `min max step wrap unit options` — for angles (`wrap:true`, 0–360) or stepped modes (`options: ['A','B','C']`, min 0, max n-1, step 1; value is the index).
- `toggle` boolean. `select` `options: [{value,label}]` segmented buttons. `color` hex string. `image` value is an HTMLImageElement (default = URL string, e.g. `'assets/sample.jpg'`); value may be null while loading — draw a placeholder.
- `seed` (one per generator, key `seed`).

## Performance
Must stay interactive: `draw` ≲ 30 ms per frame at 1200×1200 while playing. Use `ImageData` for per-pixel work, render pixel fields at reduced resolution and upscale if needed, cache static layers on an offscreen canvas in `state` and composite per frame. `setup` ≲ 1.5 s.

## Look
Reference images live in `references/` (woodcut tree-ring prints, engraved portraits, termite/beetle galleries in wood, root systems, wood grain). Aim for print-quality, tactile, art-object results — not generic demo graphics. Default palettes: warm paper `#efe7d8`-ish with dark sepia ink, plus at least one alternate palette reachable via color controls.

## Checking your work
`node tools/shot.cjs <id> out.png [secondsToRun] ['{"param":value}'] [--ui]` renders the canvas to PNG and prints `ok` or page errors. Look at the PNGs. Check paused (`'{}'` then set `app.playing`) isn't needed — but do check a couple of param extremes.
