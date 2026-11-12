# Lukas Plants vs Toby Zombies

A children's lane-defence game in 3D, for desktop Safari and Chromium: Lukas's plants
face Toby's zombies on a toy-diorama lawn. Three.js + Preact + TypeScript on Vite.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server on port 5273 |
| `npm run build` | Typecheck, then production build into `dist/` |
| `npm run preview` | Serve the build on port 5274 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Vitest) |
| `npm run shots -- <scenario...>` | Screenshots into `artifacts/shots/` (add `--headed` to watch) |
| `npm run e2e` | Browser tests (Playwright, Chromium: `desktop` and `ipad` projects). Builds and serves its own copy on port 5314, so a dev server can keep running |
| `npm run perf` | Frame-rate measurement on the stress scene (60 and 150 units, device scale 1 and 2, headed Chromium, port 5315); writes `artifacts/perf.json` |
| `npm run sim:smoke` | Simulation smoke run (arrives with the simulation) |

`?scene=stress&units=<n>` fills the real battle view with `n` fighting units for the performance tool.
`npm run shots -- title battle-busy hud-plants result-win` takes the named screenshots.
`?scene=boot` shows the spinning-cube renderer check. `window.__lvt` holds test hooks;
`await __lvt.ready` resolves after the scene's first frame.

## Design

- Spec: `docs/superpowers/specs/2026-11-11-3d-rebuild-design.md`
- Plan: `docs/superpowers/plans/2026-11-11-phase1-foundation-one-level.md`
- Art bible: `docs/art-bible.md`
