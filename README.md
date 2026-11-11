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
| `npm run sim:smoke` | Simulation smoke run (arrives with the simulation) |

`?scene=boot` shows the spinning-cube renderer check. `window.__lvt` holds test hooks;
`await __lvt.ready` resolves after the scene's first frame.

## Design

- Spec: `docs/superpowers/specs/2026-11-11-3d-rebuild-design.md`
- Plan: `docs/superpowers/plans/2026-11-11-phase1-foundation-one-level.md`
- Art bible: `docs/art-bible.md`
