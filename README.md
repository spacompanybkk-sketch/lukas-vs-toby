# Lukas Plants vs Toby Zombies

A children's lane-defence game in 3D, for an iPad (Safari, touch) and a computer (Safari or
Chromium): Lukas's plants face Toby's zombies on a toy-diorama lawn. Three.js + Preact +
TypeScript on Vite.

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
| `npm run sim:smoke` | Balance report without drawing anything (about a minute): computer against computer, one-card spam and merge-spam, the difficulty stand-ins, merge value. See below |
| `npx tsx tools/tune.ts` | The balance tuner: a scorecard of every balance target, or a search over chosen knobs (`--search spec.json`). See the note at the top of the file |

`?fps` adds a small corner readout (fps, render scale, draw calls per frame), for checking a real iPad.
`?scene=stress&units=<n>` fills the real battle view with `n` fighting units for the performance tool.
`npm run shots -- title battle-busy hud-plants result-win` takes the named screenshots.
`?scene=boot` shows the spinning-cube renderer check. `window.__lvt` holds test hooks;
`await __lvt.ready` resolves after the scene's first frame.

## Balance checks

All tunable numbers live in `src/data/balance.ts` (units, level curves, incomes, the plant
base's defence), the computer's skill tables in `src/ai/basicBot.ts` and the difficulty table
(the computer's skill and each side's income per difficulty) in `src/ai/difficulty.ts`.
`npm run sim:smoke` plays the matchups of `src/ai/balanceChecks.ts`, the same ones the tests in
`tests/ai` assert, and prints:

1. **Computer against computer**: Medium v Medium (200 seeds), with start energy ×0.75 and ×1.25,
   and Hard v Easy on each side: wins, match length, sudden-death share, units sent and merges.
2. **Spam** against the Medium computer, 100 seeds: every card played alone into random lanes
   (`createSpamBot`) and every copy merged into one unit (`createMergeSpamBot`), both sides.
   Target: none wins more than 55%.
3. **Difficulty**, each on its own setup, 100 seeds, two stand-in humans (`src/ai/standIns.ts`):
   the **random child** (`createRandomChild`: a random affordable card into a random lane every
   2 s as zombies, every 3 s as plants) should win 55-85% on Easy, 15-45% on Medium and under 15%
   on Hard; the **attentive player** (the Medium computer's play) about 90%, 50% and 25%.
4. **Merge value**: equal-budget lane duels (`src/ai/duels.ts`), how many enemies one level-N unit
   holds off against N level-1 units. Target 1.00-1.15.

`--seeds N` plays fewer seeds for a quick look. The tuner (`tools/tune.ts`) measures all of these
at once as a scorecard with a penalty for every miss, and can search a few knobs given by path
(for example `balance.trickle.zombies` or `difficulty.easy.zombies.income.human`).

## Design

- Spec: `docs/superpowers/specs/2026-11-11-3d-rebuild-design.md`
- Plan: `docs/superpowers/plans/2026-11-11-phase1-foundation-one-level.md`
- Art bible: `docs/art-bible.md`
