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
| `npm run perf` | Frame-rate measurement (headed Chromium, port 5315 or `LVT_PERF_PORT`): the phase-1 stress crowd (60 and 150 units) and the mixed roster (`mix-150`), device scale 1 and 2, plus the time to draw the twenty card portraits; prints the budget verdict (unthrottled frame ≤ 10 ms at scale 1, ≤ 16.6 ms at scale 2, on the MacBook Air M3) and writes `artifacts/perf.json`. `--modes=novsync --scenes=mix-150` for a short run. It measures a Mac, never an iPad (see `?fps` below) |
| `npm run sim:smoke` | Balance report without drawing anything (about a minute): computer against computer, one-card spam and merge-spam, the difficulty stand-ins, merge value. See below |
| `npx tsx tools/tune.ts` | The balance tuner: a scorecard of every balance target, or a search over chosen knobs (`--search spec.json`). See the note at the top of the file |

`?scene=stress&units=<n>` fills the real battle view with `n` fighting units for the performance tool;
add `&mix` for the mixed roster (all 21 kinds, all ten shot kinds, puddles, statuses, rocks, a spell
and a hero power always firing).
`npm run shots -- title battle-busy hud-plants result-win` takes the named screenshots.
`?scene=boot` shows the spinning-cube renderer check.

`window.__lvt` holds test hooks (`await __lvt.ready` resolves after the scene's first frame). It is
there in the dev server, and in a production build only when the address has `?debug`
(`/?debug`, `/?scene=stress&debug&units=60`); every e2e test and tool adds it.

### Checking speed on the iPad (`?fps`)

Nobody has measured the kids' iPad yet: the numbers from `npm run perf` are a MacBook, and the
iPad's speed is unproven. To check it, open the game in Safari on the iPad with `?fps` on the
address (for example `/?fps`, or `/?scene=battle&fps` to go straight into a battle), play a busy
match, and watch the small panel in the bottom-left corner. It refreshes twice a second:

- **fps**: frames per second, smoothed. 60 is the target; it can never go above the screen's 60.
  A steady 55-60 in a crowded late match is fine. Under 45 the game will feel sticky.
- **scale**: the render scale, 0.60 to 1.00. The game lowers it by itself, in steps of 0.1, when
  frames average over 18 ms, and raises it again when there is time to spare. **1.00 with 60 fps
  means the iPad keeps up with room to spare.** 60 fps at a lower scale means it keeps up only by
  drawing fewer pixels (softer picture); fps under 60 at 0.60 means it does not keep up at all.
- **calls**: draw calls per frame. It shows how busy the lawn is (a few hundred early in a
  match, about 900 with 60 units on the lawn, 2,000-3,000 in the stress scenes); it is not a speed by itself. Compare a slow moment
  with this number to see whether it is the crowd.

Write down fps and scale at the start, in a crowded middle, and during a hero power or a Meteor.
`/?scene=stress&mix&units=150&fps` is the worst case on purpose.

## What is in the game

Lukas plays the plants, Toby the zombies. Each side has ten cards (price in energy), a hero power
and spells; any two of the same unit merge into a stronger one, up to level 5.

| Plants | Price | Role | Zombies | Price | Role |
|--|--|--|--|--|--|
| Peashooter | 100 | Basic shooter | Brain Eater | 100 | Basic |
| Sunflower | 50 | Income | Very Fast Walker | 50 | Rush |
| Walnut Bomb | 75 | Wall | Skeleton Warrior | 125 | Tank |
| Potato Mine | 25 | Trap | Desert Zombie | 100 | Control |
| Kernel-pult | 75 | Control | Skeleton Archer | 100 | Sniper |
| Mango-pult | 100 | Area damage | Hot Topic | 75 | Snowball |
| Avocado Bunker | 125 | Fortress | Cowboy Zombie | 125 | Disabler |
| Torchwood | 100 | Support | Necromancer | 150 | Support |
| Cherry Bomber | 150 | Removal | Trident Zombie | 150 | Siege |
| Pumpkin Squash | 175 | Bruiser | Brain Rot | 175 | Area denial |

The Necromancer raises **Bone Minions** (not a card; one look at every level). The names, prices
and roles come from `src/data/units.ts`; all other numbers from `src/data/balance.ts`.

**Statuses** (`src/sim/status.ts`), each with its own mark on the unit:

| Status | From | What it does | Mark |
|--|--|--|--|
| Stun | Kernel-pult butter | Cannot act | Yellow stars round the head |
| Blind | Desert Zombie sand, Fog | Every attack misses | Sand blocks round the eyes |
| Tied | Cowboy Zombie lasso, Vines | Cannot act | Rope rings and a knot |
| Poison | Brain Rot puddles | Loses health every second | Green bubbles, a green pulse |
| Burn | Peas lit by a Torchwood | Loses health every second | Orange flames |
| Haste | Frenzy | Walks and attacks faster | Red streaks behind |

**Hero powers** (one each, recharging): Lukas's **Mega Mower** runs down a lane and hits every
zombie in it; Toby's **Bone Storm** does the same to the plants in a lane.

**Spells** (two of five are dealt each battle): plants **Thunderbolt**, **Vines**, **Sun Shower**,
**Healing Rain**, **Rock Wall**; zombies **Meteor**, **Fog**, **Brain Feast**, **Frenzy**,
**Grave Rise**.

### The demos

With the dev server running (`npm run dev`, port 5273):

| Address | What it shows |
|--|--|
| `/` | The game: title, side pick, battle |
| `/?scene=battle` | Straight into a battle (`&side=zombies`, `&fps`) |
| `/?scene=roster-demo` | A scripted match: every unit, ability, status and shot in the first minute, then both hero powers and all ten spells (`&t=<seconds>` freezes there, `&focus=<lane>,<x>` closes in) |
| `/?scene=gallery` | Every model, level by level (`&model=<key>`, `&clip=walk`) |
| `/?scene=fx-gallery` | The effects, statuses and projectiles |
| `/?scene=hud-gallery` | The HUD in every state |
| `/?scene=stress&units=150` | The phase-1 crowd for the perf tool; `&mix` for the mixed roster |

In a production build (`npm run preview`, port 5274) the same addresses work; add `&debug` for
the test hooks.

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
