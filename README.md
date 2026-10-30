# Sawmill

A browser workbench for wood-born generative images — knobs, dials, live animation, PNG/video export.

| # | Generator | What it makes |
|---|-----------|---------------|
| 1 | **Log interior** | Tree-ring cross-sections in woodcut, engraved or polished-slab styles |
| 2 | **Termite** | Termite mazes, bark-beetle galleries and woodworm holes eaten into weathered wood |
| 3 | **Engrave** | Turns an uploaded image into ring / contour / banknote / stipple line engravings |
| 4 | **Texture** | Volumetric wood-grain boards (species, cut depth, knots, rays) |
| 5 | **Roots** | Botanical root systems grown by space colonization, with optional tree crown |

## Live

https://guilhermerafs.github.io/sawmill-design/ (deployed by `.github/workflows/pages.yml` on every push).

## Run locally

No build step. Serve the folder and open it:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Controls

- Drag a knob up/down (shift = fine), scroll, arrow keys; double-click resets.
- The small pip at a knob's corner makes that knob **drift** while playing.
- Space play/pause · `r` reseed · `s` save PNG · `1`–`5` switch generator.
- **Rec 8s** captures a WebM of the animation.

## Structure

- `js/app.js` — shell: tabs, rack, animation loop, export.
- `js/ui/controls.js` — knob, dial, toggle, select, color, seed, image controls.
- `js/lib/noise.js` — seeded RNG + simplex/fbm noise.
- `js/gen/*.js` — one module per generator; contract in [GENERATORS.md](GENERATORS.md).
- `references/` — the mood-board images the generators were tuned against.
- `tools/shot.cjs` — headless render of a generator to PNG (`node tools/shot.cjs log out.png 2`).
