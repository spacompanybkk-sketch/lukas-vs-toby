# Phase 1 — Foundation and One Playable Level: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old Astro/Phaser game with a new 3D game shell in which one Backyard battle (six units, either side, against a computer player) is fully playable, animated and audible.

**Architecture:** A deterministic simulation (`src/sim`) owns all rules and emits events. A Three.js view (`src/render`) and a Web Audio engine (`src/audio`) only present what the simulation reports. A Preact HUD (`src/ui`) sits over the canvas; `src/app` wires them together. Voxel models are defined as data in code and built into geometry at load.

**Tech Stack:** Vite, TypeScript (strict), Three.js, `postprocessing`, Preact + `@preact/signals`, Vitest, Playwright 1.64.0, `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-11-3d-rebuild-design.md`. Look and motion rules: `docs/art-bible.md`. Read both before any task.

## Global Constraints

- Work only in this worktree (`~/Projects/worktrees/lukas-vs-toby-rebuild`, branch `rebuild-3d`). Never modify `~/Projects/lukas-vs-toby`.
- Nothing is deployed. No Firebase commands. No pushes.
- Desktop Safari and Chromium only; WebGL2 required. No touch or phone layout.
- Reference machine: MacBook Air M3, 8 GB RAM. Target 60 fps. Run at most one browser at a time and close it when done.
- No bitmap sprite sheets, no downloaded art or audio. The only images kept are the two portraits.
- Playwright is pinned to `1.64.0` (matches the Chromium build already cached). Never run `playwright install`.
- Dev server port `5273`, preview port `5274` (the old game occupies 4321).
- Simulation code (`src/sim`, `src/data`, `src/ai`) must not import from `three`, the DOM, `src/render`, `src/ui`, `src/audio` or `src/app`, and must not call `Date`, `performance`, `Math.random` or any `Math` function other than `sqrt`, `floor`, `ceil`, `round`, `trunc`, `abs`, `min`, `max`, `imul`.
- Unit names and prices are exactly those in spec section 6.6.
- Colours, proportions and timings come from `docs/art-bible.md`.
- UI text is English, icons before words, no paragraph a child must read.
- End every commit message with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Visual tasks end with a screenshot step: run the named `npm run shots` scenario, open the PNG, compare against the task's checklist and the art bible, and iterate at least three times before committing. Report the final PNG paths.

## Review Focus

1. **Window shape.** At 1280×720, 1440×900, 2560×1080 and after a live resize, the whole lawn, both bases and the whole HUD stay on screen and nothing overlaps the card tray. (Tests in Task 7 and Task 16.)
2. **Tab hidden or laptop asleep mid-battle.** On return the game must not fast-forward; solo battles pause themselves. (Tests in Task 7 and Task 15.)
3. **Input spam.** Rapid clicks, drags and hotkeys while paused, while a card recharges, without energy, on an occupied tile or off the lawn change nothing and never throw. (Test in Task 14.)
4. **Browser refuses.** No WebGL2, a lost WebGL context, or audio blocked until the first click: the player sees a friendly message or silence, never a blank page or an exception. (Tests in Task 13 and Task 15.)
5. **Crowded and simultaneous moments.** Many zombies in one lane, several deaths in one tick, a merge aimed at a unit that just died, both bases falling together: no NaN, no negative energy, no orphaned projectile. (Test in Task 5.)

---

## File Map

```
index.html                         entry page, one <canvas id="game"> and <div id="ui">
src/main.tsx                       boots the app
src/sim/types.ts                   constants, state, command and event types
src/sim/rng.ts                     seeded random numbers kept in state
src/sim/hash.ts                    state checksum, snapshot, restore
src/sim/match.ts                   Match class: commands and the step order
src/sim/economy.ts                 trickle, Sunflowers, card recharge, bounty
src/sim/movement.ts                zombie advance and blocking
src/sim/combat.ts                  targeting, melee, shots, projectiles, deaths, blasts
src/sim/endgame.ts                 base damage, sudden death, winner
src/data/units.ts                  the 20 units: key, side, name, price, role, unlock order
src/data/balance.ts                every tunable number
src/ai/bot.ts                      Bot interface
src/ai/basicBot.ts                 the phase-1 computer player
src/ai/runMatch.ts                 headless match runner
src/game/GameLoop.ts               fixed-step loop with interpolation
src/render/coords.ts               simulation ↔ world ↔ screen mapping
src/render/Renderer.ts             WebGL renderer, post-processing, dynamic resolution
src/render/CameraRig.ts            framing, parallax, shake, intro, victory orbit
src/render/world/Lawn.ts           island, tiles, graveyard strip, grass, props
src/render/world/Sky.ts            sky dome and clouds
src/render/voxel/types.ts          model, part, pose and clip types
src/render/voxel/palette.ts        art-bible colours and level materials
src/render/voxel/build.ts          model definition → Three.js parts
src/render/voxel/rig.ts            ModelInstance: clips, blending, flash, blink
src/render/voxel/clips.ts          reusable clip builders
src/render/models/registry.ts      key → ModelDef
src/render/models/plants/*.ts      one file per plant
src/render/models/zombies/*.ts     biped helper and one file per zombie
src/render/models/bases.ts         tree fortress and crystal crypt
src/render/models/props.ts         projectiles, tokens, gravestone
src/render/fx/Particles.ts         pooled voxel particles
src/render/fx/Effects.ts           bursts, explosions, rings, floating numbers
src/render/battle/BattleView.ts    simulation events and state → scene
src/render/battle/UnitView.ts      one unit on the lawn
src/render/battle/HealthBars.ts    health bars and level pips
src/render/portraits.ts            card portraits rendered from models
src/render/gallery.ts              model gallery scene (development)
src/audio/AudioEngine.ts           context, buses, voices, unlock
src/audio/sfx.ts                   synthesised effects
src/audio/music.ts                 sequenced music with intensity layers
src/audio/bindings.ts              simulation events → sounds
src/app/BattleController.ts        match + bot + player commands + HUD signals (no DOM)
src/app/BattleSession.ts           controller + renderer + view + audio + loop
src/app/store.ts                   screen state
src/app/settings.ts                saved volume and quality
src/app/debug.ts                   window.__lvt test hooks
src/ui/theme.css                   tokens and shared styles
src/ui/App.tsx                     screen switch
src/ui/screens/*.tsx               Title, SidePick, BattleScreen
src/ui/hud/*.tsx                   CardTray, EnergyCounter, BaseBars, TopBar, PauseMenu, ResultOverlay
tools/shots.mjs                    screenshot scenarios
tools/sim-smoke.ts                 headless win-rate check
tools/perf.mjs                     frame-time measurement
e2e/phase1.spec.ts                 browser test
tests/**                           unit tests mirroring src
```

---

### Task 1: New project shell

**Files:**
- Delete: `src/`, `tests/`, `scripts/`, `astro.config.mjs`, `package-lock.json`, `.firebase/`, everything under `public/assets/` (after moving the portraits)
- Move: `public/assets/landing/lukas-portrait.png` → `public/portraits/lukas.png`, `public/assets/landing/toby-portrait.png` → `public/portraits/toby.png`, each resized to 512×512 with `sips -Z 512`
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `src/ui/theme.css`, `src/app/debug.ts`, `tools/shots.mjs`, `tests/smoke.test.ts`, `README.md`
- Modify: `.gitignore` (add `node_modules`, `dist`, `artifacts`, `.firebase`, `.env`)
- Keep untouched: `firebase.json`, `.firebaserc`, `database.rules.json`, `docs/`

**Interfaces:**
- Produces: npm scripts `dev` (`vite --port 5273 --strictPort`), `build` (`tsc --noEmit && vite build`), `preview` (`vite preview --port 5274 --strictPort`), `typecheck`, `test` (`vitest run`), `shots` (`node tools/shots.mjs`), `sim:smoke` (`tsx tools/sim-smoke.ts`).
- Produces: `window.__lvt: { ready: Promise<void>; [k: string]: unknown }` created by `installDebug()` in `src/app/debug.ts`; later tasks add fields to it. `ready` resolves when the current scene has drawn its first frame.
- Produces: URL parameter `scene` read in `src/main.tsx` to choose what to mount (`boot` now; later `lawn`, `gallery`, `battle`, `stress`, default = the app).
- Produces: `node tools/shots.mjs <scenario...> [--headed]`. It starts the dev server if port 5273 is closed, opens each scenario URL at 1440×900 in Playwright Chromium, awaits `window.__lvt.ready`, saves `artifacts/shots/<scenario>.png`, prints the WebGL renderer string, and exits non-zero on any page error or if the canvas is a single flat colour. Scenarios are a table at the top of the file: `{ name, url, steps?: (page) => Promise<void> }`. It first tries `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`, and falls back to `--use-angle=swiftshader --enable-unsafe-swiftshader` if no WebGL2 context appears.

- [ ] **Step 1:** Move and resize the two portraits, then delete the old sources and assets listed above. `git status` shows only those deletions and two renames.
- [ ] **Step 2:** Create `package.json` (`"type": "module"`, private) with dependencies `three`, `preact`, `@preact/signals`, `postprocessing`, `@fontsource/lilita-one`, `@fontsource-variable/fredoka`, and dev dependencies `vite`, `@preact/preset-vite`, `typescript`, `vitest`, `happy-dom`, `@types/three`, `tsx`, `playwright@1.64.0`, `@playwright/test@1.64.0`. Run `npm install`. If `@preact/preset-vite` rejects the installed Vite, drop it and set `jsx: "react-jsx"`, `jsxImportSource: "preact"` in both `tsconfig.json` and the Vite transform options instead.
- [ ] **Step 3:** `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`, `target: "ES2022"`, `jsx: "react-jsx"`, `jsxImportSource: "preact"`, include `src`, `tests`, `tools`, `e2e`.
- [ ] **Step 4:** Write `tests/smoke.test.ts` with one test, `it('runs', () => expect(1 + 1).toBe(2))`. Vitest's default environment is `node`; test files that need a DOM start with `// @vitest-environment happy-dom`. Run `npm test`. Expected: 1 passed.
- [ ] **Step 5:** `index.html` + `src/main.tsx` + `src/ui/App.tsx`: full-window black page, a `<canvas id="game">` filling it, a `<div id="ui">` over it. With `?scene=boot`, draw a lit, slowly spinning green cube with Three.js and resolve `__lvt.ready` after the first frame; the UI layer shows the text `Lukas Plants vs Toby Zombies` in Lilita One. Import both fonts from the `@fontsource` packages in `theme.css`.
- [ ] **Step 6:** Write `tools/shots.mjs` as specified, with the single scenario `boot` → `/?scene=boot`.
- [ ] **Step 7:** Run `npm run typecheck && npm run build && npm run shots -- boot`. Expected: all exit 0; `artifacts/shots/boot.png` shows the cube and the title text. Open the PNG and confirm.
- [ ] **Step 8:** `README.md`: what the game is in two lines, the npm scripts, and a pointer to the spec, plan and art bible.
- [ ] **Step 9:** Commit: `chore: replace Astro/Phaser shell with Vite + Three.js + Preact`.

---

### Task 2: Simulation foundation

**Files:**
- Create: `src/sim/types.ts`, `src/sim/rng.ts`, `src/sim/hash.ts`, `src/data/units.ts`
- Test: `tests/sim/rng.test.ts`, `tests/sim/hash.test.ts`, `tests/data/units.test.ts`

**Interfaces:**
- Produces, `src/sim/types.ts`:

```ts
export const TICKS_PER_SECOND = 30;
export const LANES = 5;
export const COLS = 10;
export const PLANT_COLS = 8;        // plants occupy columns 0..7
export const ZOMBIE_SPAWN_X = 9.5;
export const BASE_STOP_X = 0.3;     // a zombie at or left of this attacks the plant base
export const MAX_LEVEL = 5;
export type Faction = 'plants' | 'zombies';
export type PlantKey = 'peashooter' | 'sunflower' | 'walnutBomb' | 'potatoMine' | 'kernelPult'
  | 'mangoPult' | 'avocadoBunker' | 'torchwood' | 'cherryBomber' | 'pumpkinSquash';
export type ZombieKey = 'brainEater' | 'veryFastWalker' | 'skeletonWarrior' | 'desertZombie'
  | 'skeletonArcher' | 'hotTopic' | 'cowboyZombie' | 'necromancer' | 'tridentZombie' | 'brainRot';
export type UnitKey = PlantKey | ZombieKey;
export type ProjectileKind = 'pea' | 'brain';
export interface Unit {
  id: number; key: UnitKey; faction: Faction; lane: number; x: number; level: number;
  hp: number; maxHp: number; spent: number;
  meleeTimer: number; shotTimer: number; abilityTimer: number;   // ticks until ready
  blocked: boolean;                                              // zombie halted by a plant or the base
}
export interface Projectile {
  id: number; kind: ProjectileKind; faction: Faction; lane: number; x: number;
  speed: number; damage: number; ownerId: number;                // speed in tiles per tick
}
export interface PlayerState {
  energy: number;                                 // always a whole number
  carry: number;                                  // income not yet paid out, in 1/30000 of an energy
  recharge: Partial<Record<UnitKey, number>>;     // ticks left per card
}
export interface MatchConfig {
  seed: number;
  startEnergy: Record<Faction, number>;
  baseHp: Record<Faction, number>;
  cards: Record<Faction, UnitKey[]>;
  incomeMultiplier: Record<Faction, number>;
  suddenDeath: boolean;
}
export interface SimState {
  tick: number; rng: number; nextId: number;
  units: Unit[]; projectiles: Projectile[];
  players: Record<Faction, PlayerState>;
  baseHp: Record<Faction, number>; baseMaxHp: Record<Faction, number>;
  suddenDeath: boolean; winner: Faction | 'draw' | null;
  config: MatchConfig;
}
export type Command =
  | { type: 'place'; faction: Faction; unit: UnitKey; lane: number; col: number }
  | { type: 'merge'; faction: Faction; unit: UnitKey; targetId: number }
  | { type: 'remove'; faction: Faction; targetId: number };
export type CommandRejection = 'match-over' | 'not-in-hand' | 'wrong-side' | 'no-energy'
  | 'recharging' | 'bad-lane' | 'bad-column' | 'occupied' | 'no-target' | 'wrong-type'
  | 'max-level' | 'not-yours' | 'plants-only';
export type SimEvent =
  | { type: 'commandRejected'; command: Command; reason: CommandRejection }
  | { type: 'unitSpawned'; unitId: number; key: UnitKey; faction: Faction; lane: number; x: number }
  | { type: 'unitMerged'; unitId: number; level: number }
  | { type: 'unitAttacked'; unitId: number; attack: 'melee' | 'shot'; targetId: number | null; targetBase: Faction | null }
  | { type: 'projectileSpawned'; projectileId: number; kind: ProjectileKind; faction: Faction; lane: number; x: number; ownerId: number }
  | { type: 'projectileHit'; projectileId: number; lane: number; x: number; targetId: number | null; targetBase: Faction | null; blocked: boolean }
  | { type: 'unitDamaged'; unitId: number; amount: number; hp: number }
  | { type: 'unitDied'; unitId: number; key: UnitKey; faction: Faction; lane: number; x: number; level: number; cause: 'damage' | 'blast' | 'shovel' }
  | { type: 'explosion'; lane: number; x: number; radius: number; sourceKey: UnitKey }
  | { type: 'baseDamaged'; faction: Faction; amount: number; hp: number; lane: number | null }
  | { type: 'energyGained'; faction: Faction; amount: number; source: 'sunflower' | 'bounty'; unitId: number | null; lane: number; x: number } // unitId = the paying Sunflower, null for bounties
  | { type: 'suddenDeath' }
  | { type: 'matchEnded'; winner: Faction | 'draw' };
```

- Produces, `src/sim/rng.ts`: `nextRandom(s: { rng: number }): number` (mulberry32; returns [0, 1), stores the new 32-bit state in `s.rng`) and `randomInt(s: { rng: number }, n: number): number` (0..n−1).
- Produces, `src/sim/hash.ts`: `hashState(s: SimState): number` (unsigned 32-bit FNV-1a over every numeric field in a fixed order, each number fed as its 8 IEEE-754 bytes; strings fed as char codes; units and projectiles in array order), `snapshotState(s: SimState): string` (JSON), `restoreState(json: string): SimState`.
- Produces, `src/data/units.ts`:

```ts
export interface UnitInfo { key: UnitKey; faction: Faction; name: string; price: number; role: string; unlockOrder: number }
export const UNIT_INFO: Record<UnitKey, UnitInfo>;
export const PLANT_KEYS: PlantKey[];    // unlock order, Peashooter first
export const ZOMBIE_KEYS: ZombieKey[];  // unlock order, Brain Eater first
export const PHASE1_CARDS: Record<Faction, UnitKey[]>;
// = { plants: ['peashooter','sunflower','walnutBomb'], zombies: ['brainEater','veryFastWalker','skeletonWarrior'] }
```

- [ ] **Step 1:** Write `tests/data/units.test.ts`: 10 keys per side; names and prices equal spec 6.6 exactly (Sunflower 50, Peashooter 100, Walnut Bomb 75, Potato Mine 25, Kernel-pult 75, Mango-pult 100, Avocado Bunker 125, Torchwood 100, Cherry Bomber 150, Pumpkin Squash 175; Brain Eater 100, Very Fast Walker 50, Skeleton Warrior 125, Desert Zombie 100, Skeleton Archer 100, Hot Topic 75, Cowboy Zombie 125, Necromancer 150, Trident Zombie 150, Brain Rot 175); `PLANT_KEYS` and `ZOMBIE_KEYS` follow the spec's unlock order; every `role` is the Role column text.
- [ ] **Step 2:** Write `tests/sim/rng.test.ts`: same seed gives the same first 1,000 values; two seeds differ; all values in [0, 1); `randomInt(s, 5)` over 10,000 draws hits each of 0..4 between 1,700 and 2,300 times; state stays an unsigned 32-bit integer.
- [ ] **Step 3:** Write `tests/sim/hash.test.ts` using a hand-built `SimState` literal: hash is stable across calls; changing any one of `tick`, a unit's `x`, a unit's `hp`, a player's `energy`, `baseHp.plants`, a projectile's `x` changes the hash; `restoreState(snapshotState(s))` deep-equals `s` and hashes the same, including for `x = 0.1 + 0.2`.
- [ ] **Step 4:** Run `npm test`. Expected: the three new files fail on missing modules.
- [ ] **Step 5:** Implement the four source files.
- [ ] **Step 6:** Run `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 7:** Commit: `feat(sim): types, seeded rng, state checksum, unit roster`.

---

### Task 3: Balance table, economy and placing cards

**Files:**
- Create: `src/data/balance.ts`, `src/sim/match.ts`, `src/sim/economy.ts`
- Test: `tests/sim/economy.test.ts`, `tests/sim/place.test.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces, `src/data/balance.ts`:

```ts
export interface MeleeStats { damage: number; interval: number; reach: number }          // seconds, tiles
export interface ShotStats { kind: ProjectileKind; damage: number; interval: number; range: number; speed: number } // tiles, tiles/s
export interface UnitStats {
  recharge: number; hp: number; armor: number; speed: number;  // seconds, tiles/s
  melee?: MeleeStats; shot?: ShotStats;
  sun?: { amount: number; interval: number };
  deathBlast?: { damage: number; radius: number };
  shield?: { interval: number };
}
export interface Balance {
  units: Partial<Record<UnitKey, UnitStats>>;
  trickle: Record<Faction, number>;        // energy per second
  bountyShare: Record<Faction, number>;    // share of the victim's `spent` paid to this side
  baseShotFactor: number;                  // plant shots reaching the zombie base
  hitRadius: number;                       // projectile vs unit, tiles
  levelScale: number[];                    // index = level
  suddenDeath: { startSeconds: number; baseRate: number; growthPerSecond: number };
  startEnergy: number; baseHp: number;
}
export const BALANCE: Balance;
export function seconds(s: number): number;   // Math.round(s * TICKS_PER_SECOND)
```

Starting values:

| Field | Value |
|-------|-------|
| `trickle` | plants 2, zombies 5 |
| `bountyShare` | plants 0.2, zombies 0.5 |
| `baseShotFactor` | 0.5 |
| `hitRadius` | 0.35 |
| `levelScale` | `[0, 1, 2, 3, 4, 5]` |
| `suddenDeath` | startSeconds 360, baseRate 0.005, growthPerSecond 0.0001 |
| `startEnergy` / `baseHp` | 200 / 3000 |

| Unit | recharge | hp | armor | speed | Other |
|------|----------|----|-------|-------|-------|
| peashooter | 5 | 300 | 0 | 0 | shot pea: damage 20, interval 1.5, range 10, speed 6 |
| sunflower | 5 | 200 | 0 | 0 | sun: amount 25, interval 10 |
| walnutBomb | 15 | 1200 | 0 | 0 | deathBlast: damage 150, radius 1.5 |
| brainEater | 5 | 400 | 0 | 0.35 | melee: 40 / 1.0 s / reach 0.6; shot brain: 15 / 2.0 s / range 3.5 / speed 4 |
| veryFastWalker | 3 | 180 | 0 | 0.9 | melee: 15 / 0.7 s / reach 0.6 |
| skeletonWarrior | 10 | 700 | 0 | 0.3 | melee: 45 / 1.2 s / reach 0.6; shield interval 4 |

- Produces, `src/sim/match.ts`:

```ts
export function defaultConfig(seed: number, balance?: Balance): MatchConfig;
// startEnergy and baseHp from balance for both sides, cards = PHASE1_CARDS, incomeMultiplier 1/1, suddenDeath true
export function spawnUnit(s: SimState, b: Balance, key: UnitKey, lane: number, x: number, events?: SimEvent[]): Unit;
// creates a level-1 unit without charging anyone; `place` uses it, and so do tests
export class Match {
  readonly state: SimState;
  readonly balance: Balance;
  constructor(config: MatchConfig, balance?: Balance);
  static restore(snapshot: string, balance?: Balance): Match;
  check(cmd: Command): CommandRejection | null;
  step(commands?: readonly Command[]): SimEvent[];
  hash(): number;
  snapshot(): string;
}
```

`step` order, fixed: (1) commands in the order given, a rejected one emitting `commandRejected`; (2) economy; (3) movement; (4) attacks, units in ascending id; (5) projectiles, ascending id; (6) deaths, bounties and blasts, repeated until no unit is at or below zero; (7) sudden death and winner; (8) `tick += 1`. Tasks 4 and 5 fill stages 3–7; this task leaves them as empty calls.

- Produces, `src/sim/economy.ts`: `tickEconomy(s: SimState, b: Balance, events: SimEvent[]): void` and `payBounty(s, b, victim: Unit, events): void`.

`tickEconomy`, in this order: (a) every unit's `meleeTimer`, `shotTimer` and `abilityTimer` and every card `recharge` entry drop by 1, never below 0. This is the only place timers count down. (b) Each player's `carry` grows by `Math.round(trickle[side] × incomeMultiplier[side] × 1000)`; while `carry ≥ 30000`, `energy += 1` and `carry −= 30000`. Energy is therefore always a whole number. (c) Each Sunflower whose `abilityTimer` is 0 pays `sun.amount × levelScale[level]`, resets the timer to `seconds(sun.interval)` and emits `energyGained` with its own `unitId`.

`payBounty`: the other side gains `Math.floor(bountyShare[side] × victim.spent)` and an `energyGained` event (`source: 'bounty'`, `unitId: null`) at the victim's position; nothing if the amount is 0.

Placement rules for `check`/`place`: `match-over` if a winner is set; `wrong-side` if the unit's side differs from `faction`; `not-in-hand` if absent from `config.cards[faction]`; `bad-lane` unless lane is an integer 0..4; plants need an integer `col` 0..7 (`bad-column`) and no plant already on that tile (`occupied`); `recharging` if the card's timer > 0; `no-energy` if energy < price. On success: energy −= price, recharge = `seconds(stats.recharge)`, a `Unit` at `x = col + 0.5` for plants or `ZOMBIE_SPAWN_X` for zombies with `level 1`, `hp = maxHp = stats.hp`, `spent = price`, timers at their full interval (Sunflower's `abilityTimer` = its sun interval), and a `unitSpawned` event.

- [ ] **Step 1:** Write `tests/sim/economy.test.ts`: after 30 steps from `defaultConfig`, plants have exactly 202 and zombies 205, and energy is a whole number after every step; with `incomeMultiplier.zombies = 1.2` zombies have 206; a Sunflower placed by a command in the first step emits one `energyGained` of 25 during the 300th step (counting the placing step as the first) and again during the 600th; a card's recharge is 0 after exactly `seconds(recharge)` steps counted the same way and not before.
- [ ] **Step 2:** Write `tests/sim/place.test.ts`: a valid Peashooter at lane 2 col 3 leaves energy 100, sits at `x = 3.5`, `spent 100`, emits `unitSpawned`; a Brain Eater appears at `x = 9.5` regardless of `col`; one test per rejection reason above, each asserting `check` returns it, `step` emits `commandRejected` with it, and energy and unit count are unchanged; a plant may be placed on a tile where a zombie stands.
- [ ] **Step 3:** Run `npm test`. Expected: new tests fail.
- [ ] **Step 4:** Implement `balance.ts`, `economy.ts`, `match.ts` (with empty stage functions imported from `movement.ts`, `combat.ts`, `endgame.ts` stubs you create now and Tasks 4–5 fill).
- [ ] **Step 5:** Run `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 6:** Commit: `feat(sim): balance table, economy, card placement`.

---

### Task 4: Combat

**Files:**
- Modify: `src/sim/movement.ts`, `src/sim/combat.ts` (stubs from Task 3)
- Test: `tests/sim/movement.test.ts`, `tests/sim/combat.test.ts`

**Interfaces:**
- Consumes: `Match`, `Balance`, `seconds`, `payBounty`.
- Produces: `tickMovement(s, b): void`, `tickAttacks(s, b, events): void`, `tickProjectiles(s, b, events): void`, `resolveDeaths(s, b, events): void`, `damageUnit(s, u: Unit, amount: number, events): void` (applies `Math.max(1, amount − armor)`, emits `unitDamaged`), `damageBase(s, side: Faction, amount: number, lane: number | null, events): void` (emits `baseDamaged`; base health may go below zero; Task 5 reads it). All exported from `combat.ts` except `tickMovement`.

Rules:

- A zombie is `blocked` when a plant in its lane lies ahead (plant.x ≤ zombie.x) within `melee.reach`, or when `x ≤ BASE_STOP_X`. Otherwise it moves `speed / 30` left per tick and never passes `BASE_STOP_X`. If several plants qualify, the target is the nearest.
- Timers are counted down by `tickEconomy` (Task 3), never here. Tests place units with `spawnUnit` and a large `startEnergy` rather than waiting for income.
- Melee: a blocked zombie whose `meleeTimer` is 0 hits its plant, or the plant base when blocked by the base, for `melee.damage × levelScale[level]`; timer resets to `seconds(interval)`. Emits `unitAttacked`.
- Shots: a unit with `shot` fires when `shotTimer` is 0 and it has something to shoot. Plants always have something to shoot (they fire down an empty lane). A zombie needs a plant ahead within `range`, or the plant base within `range` (`x ≤ range`). Firing spawns a projectile at the shooter's `x`, resets the timer, emits `unitAttacked` and `projectileSpawned`. Shooting never stops a zombie from walking.
- Projectiles move `speed / 30` per tick, plants' to the right, zombies' to the left. Using the segment travelled this tick widened by `hitRadius`, the first enemy unit in the lane (nearest to where the projectile started the tick) is hit. A Skeleton Warrior with `abilityTimer` 0 blocks a `pea`: no damage, `abilityTimer = seconds(shield.interval)`, `projectileHit` with `blocked: true`. Otherwise `damageUnit` and `projectileHit`. A plant projectile reaching `x ≥ COLS` hits the zombie base for `damage × baseShotFactor`; a zombie projectile reaching `x ≤ 0` hits the plant base for full damage. The projectile is removed in every case.
- Deaths: every unit at or below 0 hp is removed with `unitDied` (`cause: 'damage'`, or `'blast'` if a blast dealt the last damage), then `payBounty`. A dying unit with `deathBlast` emits `explosion` and damages every enemy unit whose distance `sqrt(dx² + dLane²)` is ≤ `radius` for `damage × levelScale[level]`. Repeat until no unit is at or below 0.

- [ ] **Step 1:** Write `tests/sim/movement.test.ts`: a Very Fast Walker alone reaches `x ≤ 0.3` after 307 ± 1 steps and never goes below 0.3; a zombie stops with `0 < zombie.x − plant.x ≤ 0.6` in front of a plant and resumes the step after the plant dies; a plant behind the zombie (larger x) does not block it; zombies in other lanes are unaffected.
- [ ] **Step 2:** Write `tests/sim/combat.test.ts`, one test each: a Peashooter's pea hits the nearer of two zombies in its lane for 20; a pea ignores zombies in other lanes; killing a Brain Eater pays plants exactly 20 with an `energyGained` bounty event; a Skeleton Warrior takes 0 from the first pea, 20 from the second, and blocks again 120 ticks after the first block; a Walnut Bomb's death damages zombies at distance 1.0 in the same lane and in the adjacent lane by 150, and not one two lanes away; a blast that kills a second Walnut Bomb triggers its blast in the same step; a Brain Eater keeps moving while its brain flies and the brain deals 15 to the first plant; a zombie blocked by a plant deals `melee.damage` every `seconds(interval)`; an unblocked pea hits the zombie base for 10; a zombie at the base deals 40 per second to the plant base; a brain passing `x ≤ 0` deals 15 to the plant base; a pea whose target died mid-flight carries on to the next zombie or the base; a level-3 Peashooter (set `level = 3` in the test) fires 60-damage peas; killing a Peashooter that had `spent = 300` pays zombies 150.
- [ ] **Step 3:** Run `npm test`. Expected: new tests fail.
- [ ] **Step 4:** Implement the rules.
- [ ] **Step 5:** Run `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 6:** Commit: `feat(sim): movement, melee, shots, projectiles, deaths and blasts`.

---

### Task 5: Merging, removal, endings and a fuzz test

**Files:**
- Modify: `src/sim/match.ts`, `src/sim/endgame.ts`
- Test: `tests/sim/merge.test.ts`, `tests/sim/endgame.test.ts`, `tests/sim/determinism.test.ts`

**Interfaces:**
- Produces: `tickEndgame(s, b, events): void` in `endgame.ts`; `merge` and `remove` handling in `Match`.

Rules:

- Merge: `no-target` if `targetId` is not alive; `not-yours` if the target is the other side's; `wrong-type` if its key differs from `unit`; `max-level` at level 5; then `recharging`, `no-energy` as for placing. On success: energy −= price, card recharge starts, `level += 1`, `maxHp = stats.hp × levelScale[level]`, `hp = Math.max(1, Math.round(maxHp × oldHp / oldMaxHp))`, `spent += price`, event `unitMerged`.
- Remove: `plants-only` unless `faction` is `'plants'`; `no-target`; `not-yours`. The plant is removed with `unitDied` cause `'shovel'`, no bounty, no blast, no refund.
- Winner: after deaths each tick, a base at or below 0 loses; both at once is `'draw'`. Emit `matchEnded` once. After that `step` changes nothing and returns `[]`, and `check` returns `'match-over'`.
- Sudden death: if `config.suddenDeath`, on the tick equal to `seconds(startSeconds)` set `suddenDeath = true` and emit `suddenDeath`. From then on each base loses `balance.baseHp × (baseRate + growthPerSecond × secondsSinceStart) / 30` per tick (the same absolute amount for both, `lane: null`).

- [ ] **Step 1:** Write `tests/sim/merge.test.ts`: merging a Peashooter at 150/300 hp gives level 2, 300/600 hp, `spent 200`, energy down by 100 and the card recharging; one test per rejection reason; merging a zombie mid-walk keeps its `x`; a level-2 Sunflower pays 50 per interval; a level-5 unit rejects with `max-level`.
- [ ] **Step 2:** Write `tests/sim/endgame.test.ts`: plant base to 0 → `winner 'zombies'` and one `matchEnded`; both bases to 0 on one tick → `'draw'`; after the end, `step` returns `[]` and the hash stops changing; with two idle players `suddenDeath` is emitted at tick 10,800 and the match ends at or before tick 14,400; with `suddenDeath: false` an idle match is still running at tick 14,400; removing a plant emits `unitDied` with cause `'shovel'` and pays nothing; removing as zombies is rejected with `plants-only`.
- [ ] **Step 3:** Write `tests/sim/determinism.test.ts` (Review Focus 5). A helper `randomCommands(seed, tick)` produces 0–2 commands per tick, a mix of valid and invalid ones for both sides (random lanes, columns, units, target ids including dead and never-existing ones). For 50 seeds run 3,000 ticks and after every step assert: no `NaN` or `Infinity` in any numeric field of the state; both energies ≥ 0; every unit has `0 < hp ≤ maxHp`, lane 0..4, `0.3 ≤ x ≤ 9.5` for zombies; unit ids unique; every projectile's lane 0..4. Then: running the same seed twice gives the same hash at ticks 500, 1,000, 2,000 and 3,000; snapshotting at tick 1,500, restoring with `Match.restore` and continuing gives the same hash at tick 3,000 as the uninterrupted run. Add one crafted case: 30 Very Fast Walkers in one lane against one Walnut Bomb, and a merge command aimed at a unit that died on the previous tick.
- [ ] **Step 4:** Run `npm test`. Expected: new tests fail.
- [ ] **Step 5:** Implement.
- [ ] **Step 6:** Run `npm test && npm run typecheck`. Expected: pass; the determinism file finishes in under 20 s.
- [ ] **Step 7:** Commit: `feat(sim): merging, shovel, match end, sudden death, fuzz and determinism tests`.

---

### Task 6: Computer player and headless matches

**Files:**
- Create: `src/ai/bot.ts`, `src/ai/basicBot.ts`, `src/ai/runMatch.ts`, `tools/sim-smoke.ts`
- Test: `tests/ai/basicBot.test.ts`
- Modify (only if Step 5 requires): `src/data/balance.ts`

**Interfaces:**
- Consumes: `Match`, `MatchConfig`, `Command`, `Balance`.
- Produces:

```ts
// bot.ts
export type Skill = 'easy' | 'medium' | 'hard';
export interface Bot { readonly faction: Faction; think(match: Match): Command[] }
// basicBot.ts
export function createBasicBot(faction: Faction, skill: Skill, seed: number): Bot;
// runMatch.ts
export interface MatchResult { winner: Faction | 'draw'; ticks: number; baseHp: Record<Faction, number> }
export function runMatch(config: MatchConfig, bots: readonly Bot[], maxTicks?: number, balance?: Balance): MatchResult; // maxTicks default 14,400
```

Behaviour: `think` is called every tick and acts only every 60 (easy), 30 (medium) or 15 (hard) ticks. It uses its own seeded random numbers (never the match's) and only issues commands that `match.check` accepts. As plants: keep Sunflowers in columns 0–1 up to 2 / 4 / 5 of them, put Peashooters in columns 2–4 of the lane whose nearest zombie is closest to the plant base (an empty lawn: spread evenly), put a Walnut Bomb in column 5–6 of a lane that has a shooter and an approaching zombie, and once a lane's shooter columns are full merge the lowest-level shooter there. As zombies: send a Skeleton Warrior first into the lane with the least plant health, follow with Brain Eaters, send Very Fast Walkers down lanes with no plant, and on hard merge a walking zombie when energy exceeds 300. Easy picks a random legal action 40% of the time.

- `tools/sim-smoke.ts`: runs 100 medium-vs-medium matches (seeds 1..100) and 40 hard-vs-easy matches per side, prints win counts, median and 95th-percentile length in minutes.

- [ ] **Step 1:** Write `tests/ai/basicBot.test.ts`: every command either bot returns over a 3,000-tick match passes `match.check` at the moment it is returned; the bot is deterministic for a given seed (same commands on a replay); over 40 medium-vs-medium matches (seeds 1..40) each side wins at least 8 and all end by tick 14,400; hard beats easy in at least 28 of 40 as plants and in at least 28 of 40 as zombies.
- [ ] **Step 2:** Run `npm test`. Expected: fails on missing modules.
- [ ] **Step 3:** Implement the bot, the runner and the tool.
- [ ] **Step 4:** Run `npm run sim:smoke`. Read the win counts.
- [ ] **Step 5:** If a side wins fewer than 8 of 40 at medium, adjust only `trickle`, `bountyShare`, `startEnergy`, `baseHp` and `baseShotFactor` in `BALANCE`, then update the exact-value tests in `tests/sim/economy.test.ts` to match. Do not touch unit stats or prices. If those five knobs cannot reach 8 of 40 for both sides, stop and report the win counts instead of changing anything else. Record the before and after win counts in the commit body.
- [ ] **Step 6:** Run `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 7:** Commit: `feat(ai): basic computer player, headless match runner, smoke tool`.

---

### Task 6a: The plant base defends itself

> Added 2026-11-11 during execution, after Task 6's first matches. Runs after Task 6's first commit and before Task 6's fix round, which switches the defence on and re-tunes.

**Why:** the first computer-vs-computer runs showed a hole in the rules. Plants only shoot to the right, so a zombie that reaches the plant base can never be hit again and bites it for the rest of the match. One early leak decided most matches. The fix: the base strikes zombies that are biting it.

**Files:**
- Modify: `src/sim/types.ts`, `src/sim/hash.ts`, `src/data/balance.ts`, `src/sim/economy.ts`, `src/sim/combat.ts`, `src/sim/match.ts`
- Test: `tests/sim/baseDefense.test.ts` (new), and updates to `tests/sim/step-order.test.ts`, `tests/sim/hash.test.ts`, `tests/sim/determinism.test.ts`, `tests/sim/helpers.ts`, `tests/data/balance.test.ts`

**Interfaces:**
- Consumes: `Match`, `spawnUnit`, `damageUnit`, `seconds`, `cloneBalance`, `BASE_STOP_X`, `LANES`, `isStanding`.
- Produces:

```ts
// src/data/balance.ts — added to Balance
baseDefense: { damage: number; interval: number };   // seconds; damage 0 switches it off
// src/sim/types.ts — added to SimState
baseDefenseTimers: number[];                          // one per lane, ticks until the base can strike there again
// src/sim/types.ts — added to SimEvent
| { type: 'baseStruck'; lane: number; targetId: number }   // the plant base hit a zombie that was biting it
// src/sim/combat.ts
export function tickBaseDefense(s: SimState, b: Balance, events: SimEvent[]): void;
```

Shipped values in `BALANCE`: `baseDefense: { damage: 0, interval: 1 }`. The mechanism ships switched off so every existing test and the computer players keep their current behaviour; the next step turns it on while re-tuning. Tests in this task use `cloneBalance(BALANCE)` with `baseDefense.damage = 60`.

Rules:

- `baseDefenseTimers` has `LANES` entries, all 0 at the start of a match. `tickEconomy` counts each down by 1 per tick, never below 0, in the same place as the other timers (still the only place timers count down).
- `Match.step` calls `tickBaseDefense` after `tickAttacks` and before `tickProjectiles`.
- `tickBaseDefense`, for lanes 0 to 4 in order: if that lane's timer is 0 and `baseDefense.damage > 0`, find the zombie in that lane with the lowest id that is standing (hp above 0), has `blocked` true and `x <= BASE_STOP_X`. If there is one: emit `baseStruck`, call `damageUnit` for `baseDefense.damage` (armour applies as for any damage), and set the lane's timer to `seconds(baseDefense.interval)`. If there is none, the timer stays 0.
- A zombie killed this way is removed by `resolveDeaths` like any other death: cause `'damage'`, bounty to the plants.
- The zombie base has no such defence.
- `hashState` covers `baseDefenseTimers` (length-prefixed, in lane order) and `snapshotState`/`restoreState` round-trip it. A snapshot made before this field existed has no timers: `restoreState` fills in zeros.

- [ ] **Step 1:** Write `tests/sim/baseDefense.test.ts` (all with a cloned balance, damage 60, interval 1, unless stated):
  - a Very Fast Walker (180 hp) placed at the base with `spawnUnit` and left alone is struck for 60 on the first step it is blocked by the base, again 30 ticks later and again 30 ticks after that, and dies on the third strike with `unitDied` cause `'damage'`; the plants receive its bounty once; exactly three `baseStruck` events name it
  - the plant base only loses what the walker bit before it died (sum of `baseDamaged` amounts equals the base's lost health, and no `baseDamaged` follows its death)
  - two zombies at the base in one lane: only the lower id is struck until it dies; the next strike, one interval after the previous one, lands on the other
  - zombies at the base in lanes 1 and 3 are both struck on the same step, lane 1's event first
  - a zombie blocked by a plant (not at the base) is never struck; it is struck only once it has eaten through and reached the base
  - a zombie still walking (not yet at `BASE_STOP_X`) is never struck
  - with `damage: 0` (the shipped value) 600 steps with a zombie at the base emit no `baseStruck` and the timers stay 0
  - a zombie with `armor` 10 loses 50 per strike
  - a lane's timer reads `seconds(1)` right after a strike and counts down by 1 per step to 0
  - `baseStruck` comes after that zombie's own `unitAttacked` on the same step (the base strikes after units attack)
- [ ] **Step 2:** Update `tests/sim/step-order.test.ts` to expect `tickBaseDefense` between `tickAttacks` and `tickProjectiles`; `tests/sim/hash.test.ts`: changing `baseDefenseTimers[2]` changes the hash, the round trip keeps it, a snapshot without the field restores to five zeros, and the golden checksum is recomputed (say in the report how you cross-checked it); `tests/sim/determinism.test.ts`: the invariant checker also requires every `baseDefenseTimers` entry to be a whole number from 0 to `seconds(interval)` and the array to have `LANES` entries, and the rich sweep runs with the defence on (damage 60) so the fuzz exercises it, with `baseStruck` added to the coverage guard; `tests/data/balance.test.ts`: `baseDefense.damage >= 0` and `interval` at least one tick.
- [ ] **Step 3:** Run `npm test`. Expected: the new and updated tests fail.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run `npm test && npm run typecheck`. Expected: every test passes, including `tests/ai/**` untouched (the shipped value is 0, so nothing about computer-player matches changes; if an `ai` test fails, the mechanism is leaking into the switched-off case — fix that, do not edit `src/ai` or `tests/ai`).
- [ ] **Step 6:** Commit: `feat(sim): the plant base strikes zombies that reach it (switched off by default)`.

---

### Task 7: Renderer, camera, game loop and the lawn

**Files:**
- Create: `src/render/coords.ts`, `src/render/Renderer.ts`, `src/render/CameraRig.ts`, `src/render/world/Lawn.ts`, `src/render/world/Sky.ts`, `src/game/GameLoop.ts`
- Modify: `src/main.tsx` (scene `lawn`), `src/app/debug.ts`, `tools/shots.mjs` (scenarios `lawn`, `lawn-wide`, `lawn-small`)
- Test: `tests/game/GameLoop.test.ts`, `tests/render/coords.test.ts`, `tests/render/CameraRig.test.ts`

**Interfaces:**
- Produces:

```ts
// coords.ts — world: x = sim x, y up, z = lane + 0.5
export const PLANT_BASE_X: [number, number];   // [-1.7, -0.1]
export const ZOMBIE_BASE_X: [number, number];  // [10.1, 11.7]
export function tileCenter(lane: number, col: number, out?: THREE.Vector3): THREE.Vector3;
export function simToWorld(lane: number, x: number, out?: THREE.Vector3): THREE.Vector3;
export function pickTile(ndcX: number, ndcY: number, camera: THREE.Camera): { lane: number; col: number } | null; // null off the lawn
export function worldToClient(p: THREE.Vector3, camera: THREE.Camera, viewport: { width: number; height: number }): { x: number; y: number };
// GameLoop.ts
export interface LoopHost { step(): void; frame(alpha: number, dtSeconds: number): void }
export class GameLoop {
  paused: boolean; timeScale: number;
  constructor(host: LoopHost);
  start(): void; stop(): void;
  advance(nowMs: number): void;   // one animation frame; public for tests
}
// CameraRig.ts
export class CameraRig {
  constructor(camera: THREE.PerspectiveCamera);
  frameLawn(aspect: number): void;
  setParallax(nx: number, ny: number): void;           // -1..1 from the mouse
  shake(strength: number, seconds: number): void;
  punch(amount: number, seconds: number): void;        // brief zoom
  playIntro(seconds: number): Promise<void>;           // wide establishing shot easing into the frame
  orbitVictory(side: Faction): void;
  update(dtSeconds: number): void;
}
// Renderer.ts
export type Quality = 'low' | 'medium' | 'high';
export class Renderer {
  readonly scene: THREE.Scene; readonly camera: THREE.PerspectiveCamera; readonly rig: CameraRig;
  readonly stats: { fps: number; scale: number };
  constructor(canvas: HTMLCanvasElement, quality: Quality);   // throws Error('webgl2-unavailable') without WebGL2
  resize(): void; render(dtSeconds: number): void; setQuality(q: Quality): void; dispose(): void;
  onContextLost?: () => void; onContextRestored?: () => void;
}
// world
export class Lawn { readonly group: THREE.Group; constructor(); update(timeSeconds: number): void; highlightTile(lane: number, col: number, state: 'ok' | 'bad' | null): void; highlightLane(lane: number | null, state: 'ok' | 'bad'): void }
export class Sky { readonly group: THREE.Group; constructor(); update(timeSeconds: number): void }
```

Decisions:

- `GameLoop`: fixed 30 steps per second with an accumulator scaled by `timeScale`; at most 5 steps per `advance`, after which the remainder is dropped; a gap over 250 ms counts as 250 ms; `paused` runs `frame` with alpha 0 and no steps; `alpha` is always in [0, 1).
- `frameLawn` keeps the field of view at 30° and the pitch at 52° and moves the camera back until the box x ∈ [−1.9, 11.9], z ∈ [−0.3, 5.3], y ∈ [0, 2.4] fits inside the screen rectangle that excludes the bottom 22% (card tray) and top 9% (top bar), with 3% side margins.
- `Renderer`: device pixel ratio capped at 2; render scale starts at 1 and steps between 0.6 and 1 in 0.1 moves to hold 60 fps (lower after 30 consecutive frames over 18 ms, raise after 300 under 14 ms). Post chain per art bible section 4 using `postprocessing`; if it will not work with the installed Three.js, use Three's own `EffectComposer` from `three/addons`. `low` = no ambient occlusion, no bloom, 1024 shadows; `medium` = bloom, 2048 shadows; `high` = everything.
- `Lawn`: floating island with rock underside and soil rim; 10 × 5 checker tiles, columns 0–7 in grass colours and 8–9 in graveyard-strip colours; faint lane edges; instanced grass tufts that sway in a vertex shader; small flowers near the plant end, bones and tiny gravestones near the zombie end; nothing taller than 0.25 tiles on playable tiles. `Sky`: gradient dome and six drifting voxel clouds.
- `?scene=lawn` shows the lawn alone; `&t=<seconds>` freezes time for stable screenshots. `__lvt.renderer` is exposed.

- [ ] **Step 1:** Write `tests/game/GameLoop.test.ts` (Review Focus 2): feeding `advance` timestamps 0, 100 gives 3 steps; a jump of 60,000 ms gives at most 5 steps and the next 33 ms frame gives exactly 1; `timeScale = 0.5` over 1,000 ms of 16 ms frames gives 15 ± 1 steps; `paused` gives 0 steps but still calls `frame`; every `alpha` is ≥ 0 and < 1.
- [ ] **Step 2:** Write `tests/render/coords.test.ts`: `tileCenter(2, 3)` is (3.5, 0, 2.5); `simToWorld(4, 9.5)` is (9.5, 0, 4.5); with a camera framed by `CameraRig`, projecting each tile centre to NDC and passing it to `pickTile` returns that tile for all 50 tiles; a point over the sky returns null.
- [ ] **Step 3:** Write `tests/render/CameraRig.test.ts` (Review Focus 1): for aspects 4:3, 16:10, 16:9 and 21:9, after `frameLawn`, the eight corners of the box above project to NDC x within ±0.94 and NDC y within [−0.56, 0.82].
- [ ] **Step 4:** Run `npm test`. Expected: new tests fail.
- [ ] **Step 5:** Implement `coords.ts`, `GameLoop.ts`, `CameraRig.ts`; run the tests until they pass.
- [ ] **Step 6:** Implement `Renderer.ts`, `Lawn.ts`, `Sky.ts`, the `lawn` scene and the three shot scenarios (`lawn` at 1440×900, `lawn-wide` at 2560×1080, `lawn-small` at 1280×720).
- [ ] **Step 7:** Screenshot loop: `npm run shots -- lawn lawn-wide lawn-small`. Checklist: reads as a toy island floating in a bright sky; soft shadows visible; the checker is gentle, not harsh; the graveyard strip is clearly Toby's end; whole lawn and both base areas on screen at all three sizes with room below for the tray; no aliasing shimmer on tile edges.
- [ ] **Step 8:** Run `npm test && npm run typecheck && npm run build`. Expected: pass.
- [ ] **Step 9:** Commit: `feat(render): renderer, camera rig, fixed-step loop, lawn and sky`.

---

### Task 8: Voxel model system, gallery and the Peashooter

**Files:**
- Create: `src/render/voxel/types.ts`, `src/render/voxel/palette.ts`, `src/render/voxel/build.ts`, `src/render/voxel/rig.ts`, `src/render/voxel/clips.ts`, `src/render/models/registry.ts`, `src/render/models/plants/peashooter.ts`, `src/render/gallery.ts`
- Modify: `src/main.tsx` (scene `gallery`), `tools/shots.mjs` (scenarios `gallery`, `gallery-peashooter-shoot`)
- Test: `tests/render/voxel.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export type ColorRef = string;   // a palette name such as 'leaf', or '#RRGGBB'
export interface Box {
  at: [number, number, number];      // min corner, voxels, relative to the model origin (feet centre)
  size: [number, number, number];    // voxels
  color: ColorRef;
  emissive?: number;                 // 0..1
  minLevel?: number; maxLevel?: number;
}
export interface PartDef { name: string; parent?: string; pivot: [number, number, number]; boxes: Box[] }
export type ClipName = 'idle' | 'walk' | 'shoot' | 'melee' | 'hit' | 'spawn' | 'die' | 'cheer';
export interface PartPose { rx: number; ry: number; rz: number; px: number; py: number; pz: number; s: number } // radians, voxels, scale
export type Pose = Record<string, PartPose>;
export interface Clip { duration: number; loop: boolean; sample(t: number, pose: Pose): void } // writes offsets from rest
export interface ModelDef {
  key: string; parts: PartDef[];
  trim: ColorRef[];                  // palette names replaced by the level material at levels 3–5
  eyes?: string[];                   // part names that blink
  muzzle?: [number, number, number]; // where projectiles leave, voxels
  clips: Partial<Record<ClipName, Clip>>;
}
// palette.ts
export const PALETTE: Record<string, string>;            // every art-bible colour by name
export const LEVEL_SCALE: number[];                      // [0, 1, 1.08, 1.16, 1.24, 1.34]
export function levelMaterial(level: number): 'none' | 'iron' | 'crystal' | 'gold';
// build.ts
export const VOXEL: number;                              // 1 / 16
export function buildParts(def: ModelDef, level: number): THREE.Group; // one mesh per part and material, nested by parent, named by part
export function modelColors(def: ModelDef, level: number): number[];   // distinct colours, for debris
// rig.ts
export class ModelInstance {
  readonly root: THREE.Group; readonly def: ModelDef; readonly level: number;
  constructor(def: ModelDef, level: number);
  play(clip: ClipName, opts?: { speed?: number; onDone?: () => void }): void; // one-shots return to the last looping clip
  update(dtSeconds: number): void;
  setFlash(amount: number): void;          // 0..1 white
  setLevel(level: number): ModelInstance;  // returns a new instance at the same transform and clip
  muzzleWorld(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}
// registry.ts
export function getModelDef(key: string): ModelDef;      // throws on an unknown key
export function registerModel(def: ModelDef): void;
export function hasModel(key: string): boolean;
// clips.ts — builders shared by all models
export function idleBob(parts: { body: string; head?: string; sway?: string[] }): Clip;      // 1.6 s loop
export function shootSnap(parts: { body: string; head: string }): Clip;                      // 0.4 s, release at 0.12 s
export function hitRecoil(body: string, direction: 1 | -1): Clip;                            // 0.2 s
export function spawnRise(body: string): Clip;                                               // 0.35 s, overshoot
export function wilt(parts: { body: string; head?: string }): Clip;                          // 0.2 s
export function cheerJump(body: string): Clip;                                               // 0.6 s loop
```

Decisions:

- Geometry: each part's boxes merge into one buffer geometry per material class (plain, iron, crystal, gold, emissive) with vertex colours; faces hidden between touching boxes need not be removed. Geometry is cached by model key, part and level. All meshes cast and receive shadows.
- Level looks come from two things: boxes gated by `minLevel`/`maxLevel`, and `trim` colours swapped for the level material. The root scale is `LEVEL_SCALE[level]`. Level 5 models also carry a child group named `aura` that Task 11's effects fill.
- `ModelInstance` cross-fades clips over 100 ms and blinks per art bible section 2.
- Peashooter: leaf base, segmented stem with a slight forward lean, round head with a tube mouth pointing +X, a leaf sprout at the back of the head. Level 2 adds a second leaf pair and a bigger mouth rim; level 3 an iron mouth band and helmet plate; level 4 crystal spikes down the back and a glowing mouth; level 5 a gold crown-like leaf crest, gold mouth and glowing eyes. `trim` covers the mouth rim and bands. Clips: `idle`, `shoot`, `hit`, `spawn`, `die` (wilt), `cheer`.
- Gallery: `?scene=gallery` lays every registered model in rows, levels 1–5 left to right, each on a small grass pad with the lawn lighting, labels in the UI layer. `&model=<key>` shows one row larger. `&clip=<name>&t=<seconds>` freezes every model at that clip time. Scenario `gallery-peashooter-shoot` captures `t` = 0.06, 0.12, 0.16 and 0.3 as four PNGs.

- [ ] **Step 1:** Write `tests/render/voxel.test.ts`: `buildParts(peashooter, 1)` has a named object for every part and its bounding box lies inside 12 × 16 × 10 voxels × `VOXEL`; level 5's box is larger by 1.34 ± 0.01 in height; level 5 has more boxes than level 1; a `trim` colour appears in `modelColors(def, 1)` and is replaced by gold `#FFC83D` in `modelColors(def, 5)`; every looping clip samples the same pose at `t = 0` and `t = duration` (within 1e-6); `shoot` lasts 0.4 s; after `play('shoot')` and 0.5 s of `update`, the instance is back on `idle` and `onDone` fired once; `getModelDef('nope')` throws.
- [ ] **Step 2:** Run `npm test`. Expected: fails on missing modules.
- [ ] **Step 3:** Implement the voxel system, clip builders, registry and gallery.
- [ ] **Step 4:** Model the Peashooter and register it.
- [ ] **Step 5:** Screenshot loop: `npm run shots -- gallery gallery-peashooter-shoot`. Checklist: recognisable as a peashooter at a glance and when the PNG is viewed at a quarter of its size; face reads (eyes, glint, mouth); the five levels escalate clearly without changing silhouette identity; the shoot frames show lean-back, snap, settle; no z-fighting, no floating parts, feet on the ground.
- [ ] **Step 6:** Run `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 7:** Commit: `feat(render): voxel model system, clip builders, gallery, Peashooter`.

---

### Task 9: Sunflower and Walnut Bomb

**Files:**
- Create: `src/render/models/plants/sunflower.ts`, `src/render/models/plants/walnutBomb.ts`
- Modify: `src/render/models/registry.ts`, `tools/shots.mjs` (scenario `gallery-plants`)
- Test: `tests/render/models.test.ts`

**Interfaces:**
- Consumes: Task 8's types, `PALETTE`, clip builders, `registerModel`.
- Produces: registered models `sunflower` and `walnutBomb`, and in `clips.ts` a new builder `sunPulse(head: string): Clip` (0.5 s one-shot: petals flare, head nods).

Decisions:

- Sunflower: leaf base, tall stem, big round face ringed by 12 petals, wide smile. Clips: `idle` (gentle sway, petals ripple), `shoot` = `sunPulse` (played when it pays out), `hit`, `spawn`, `die`, `cheer`. Levels: 2 a second petal ring; 3 iron petal tips and a stem brace; 4 crystal petals that glow; 5 gold petals, a halo ring part and glowing face.
- Walnut Bomb: a fat walnut half-buried in soil, angry brow, gritted teeth, a short fuse on top with an emissive tip. Clips: `idle` (heavy breathing), `hit` (wobble), `spawn`, `die` (swell to 1.3 over 0.2 s before the blast), `cheer`. Levels: 2 iron bands; 3 riveted iron shell plates; 4 crystal spikes and a glowing crack pattern; 5 gold shell, twin fuses. Visible damage: boxes named in a `cracks` part appear when the view asks for them (the part exists and is hidden at rest; Task 12 toggles it below 50% health).

- [ ] **Step 1:** Extend `tests/render/models.test.ts` with a table test run for every registered model: fits the level-1 envelope; has `idle`, `hit`, `spawn`, `die`, `cheer`; all looping clips are seamless; levels 2–5 each differ from the previous level in box count or colours; plants' muzzle or head lies at x ≥ 0. Add: Walnut Bomb has a part named `cracks`.
- [ ] **Step 2:** Run `npm test`. Expected: fails for the two new keys.
- [ ] **Step 3:** Model both and register them.
- [ ] **Step 4:** Screenshot loop: `npm run shots -- gallery-plants`. Checklist: each reads at a quarter size; the three plants look like one family; Sunflower is the friendliest thing on the lawn; Walnut Bomb looks tough and slightly cross; levels escalate.
- [ ] **Step 5:** Run `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 6:** Commit: `feat(models): Sunflower and Walnut Bomb`.

---

### Task 10: Zombie rig and three zombies

**Files:**
- Create: `src/render/models/zombies/biped.ts`, `src/render/models/zombies/brainEater.ts`, `src/render/models/zombies/veryFastWalker.ts`, `src/render/models/zombies/skeletonWarrior.ts`
- Modify: `src/render/models/registry.ts`, `src/render/voxel/clips.ts`, `tools/shots.mjs` (scenarios `gallery-zombies`, `gallery-zombie-walk`)
- Test: `tests/render/models.test.ts`

**Interfaces:**
- Produces, `biped.ts`:

```ts
export interface BipedSpec {
  key: string;
  skin: ColorRef; cloth: ColorRef; clothDark: ColorRef;
  head: Box[]; torso: Box[]; armL: Box[]; armR: Box[]; legL: Box[]; legR: Box[];
  extra?: PartDef[];                 // hats, weapons, shields; parent is one of the six parts
  trim: ColorRef[]; eyes: string[];
  stepSeconds: number;               // walk cycle length
  muzzle?: [number, number, number];
}
export function bipedModel(spec: BipedSpec): ModelDef;   // parts: root, torso, head, armL, armR, legL, legR (+ extra), facing −X
```

- Produces, in `clips.ts`: `zombieWalk(stepSeconds: number): Clip`, `zombieBite(): Clip` (0.48 s, strike at 0.15 s), `zombieThrow(): Clip` (0.4 s, release at 0.12 s), `zombieRise(): Clip` (0.5 s, from below ground), `zombieCrumble(): Clip` (0.35 s: head pops up and off, body slumps).
- Produces: registered models `brainEater`, `veryFastWalker`, `skeletonWarrior`.

Decisions:

- All zombies slouch 10° and hold their arms forward; walk per art bible section 5.
- Brain Eater: purple torn shirt, one big eye and one small, a pink brain held in the right hand (the throw releases it; a new one appears on the next idle frame). Clips: `idle`, `walk` (0.8 s), `melee` = bite, `shoot` = throw, `hit`, `spawn` = rise, `die` = crumble, `cheer`. Levels: 2 shoulder pads; 3 iron helmet; 4 crystal skull cap with floating brain; 5 gold crown and glowing eyes.
- Very Fast Walker: skinny, red-tinted skin (`Speed red` accents), sweatband, running pose leaning 25° forward, arms pumping. `walk` 0.45 s. Levels: 2 spiked shoes; 3 chrome visor; 4 crystal lightning fins; 5 gold with a glowing trail part.
- Skeleton Warrior: bone body, red emissive eye dots, grey breastplate, sword in the right hand, round shield on the left arm as an `extra` part named `shield`. `walk` 0.9 s. Extra one-shot clip mapped to `shoot`: shield raise (0.3 s) played when it blocks. Levels: 2 bigger sword; 3 full iron plate and tower shield; 4 crystal blade and glowing shield rim; 5 gold armour and flaming sword tip (emissive).

- [ ] **Step 1:** Extend the table test: zombies also need `walk` and `melee`; zombies' heads lie at x ≤ 0 (facing −X); Skeleton Warrior has a part named `shield`; `bipedModel` output always has the seven core parts.
- [ ] **Step 2:** Run `npm test`. Expected: fails for the new keys.
- [ ] **Step 3:** Implement `biped.ts` and the five clips, then the three zombies.
- [ ] **Step 4:** Screenshot loop: `npm run shots -- gallery-zombies gallery-zombie-walk` (the second captures four evenly spaced walk frames of each zombie). Checklist: goofy, not scary; each reads at a quarter size and the three are told apart by silhouette alone; walk frames show opposite arm and leg swing and a body bob; the walker looks fast standing still; the skeleton looks like the tough one.
- [ ] **Step 5:** Run `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 6:** Commit: `feat(models): zombie rig, Brain Eater, Very Fast Walker, Skeleton Warrior`.

---

### Task 11: Bases, projectiles, tokens, particles and effects

**Files:**
- Create: `src/render/models/bases.ts`, `src/render/models/props.ts`, `src/render/fx/Particles.ts`, `src/render/fx/Effects.ts`
- Modify: `src/main.tsx` (scene `fx`), `tools/shots.mjs` (scenarios `bases`, `fx`)
- Test: `tests/render/particles.test.ts`, `tests/render/bases.test.ts`

**Interfaces:**
- Produces:

```ts
// bases.ts
export class BaseView {
  readonly group: THREE.Group;
  constructor(side: Faction);                 // tree fortress for plants, crystal crypt for zombies, placed on its coords range across all five lanes
  setHealth(fraction: number): void;          // 4 damage states at ≥0.75, ≥0.5, ≥0.25, <0.25: missing chunks, cracks, smoke anchors
  hit(lane: number | null): void;             // short shudder
  collapse(): Promise<void>;                  // 1.6 s, breaks into debris
  smokeAnchors(): THREE.Vector3[];            // world positions that should smoke at the current state
  update(dtSeconds: number, timeSeconds: number): void;
}
// props.ts
export function makeProjectile(kind: ProjectileKind): THREE.Object3D;   // pea 0.22 tile, brain 0.26 tile
export function makeToken(kind: 'sun' | 'brain'): THREE.Object3D;       // emissive, spins
export function makeGravestone(): THREE.Object3D;
// Particles.ts
export interface ParticleSpec { position: THREE.Vector3; velocity: THREE.Vector3; color: number; size: number; life: number; gravity?: number; bounce?: number; emissive?: boolean }
export class Particles {
  readonly object: THREE.Object3D;            // one instanced mesh of cubes
  readonly capacity: number;                  // 2000
  constructor(capacity?: number);
  emit(p: ParticleSpec): void;                // when full, the oldest particle is replaced
  update(dtSeconds: number): void;
  get alive(): number;
}
// Effects.ts
export class Effects {
  readonly group: THREE.Group;
  constructor(particles: Particles, random?: () => number);
  burst(at: THREE.Vector3, colors: number[], count: number, speed: number): void;
  debris(at: THREE.Vector3, colors: number[], level: number): void;   // unit death
  dirt(at: THREE.Vector3): void;
  puff(at: THREE.Vector3, color?: number): void;
  spark(at: THREE.Vector3): void;                                     // projectile impact
  blockFlash(at: THREE.Vector3): void;                                // shield block
  explosion(at: THREE.Vector3, radius: number): void;                 // flash, shockwave ring, debris, smoke
  ring(at: THREE.Vector3, color: number, radius: number): void;
  sparkles(at: THREE.Vector3, color: number): void;                   // merge
  aura(target: THREE.Object3D, color: number): void;                  // level-5 motes, call each frame
  smoke(at: THREE.Vector3): void;
  trail(obj: THREE.Object3D, color: number): void;                    // call each frame for a projectile
  floatText(at: THREE.Vector3, text: string, color: string): void;    // rises 0.6 tile over 0.8 s and fades
  update(dtSeconds: number, camera: THREE.Camera): void;
}
```

Decisions:

- Tree fortress: a broad voxel tree on the island's left lobe with a wooden door, round window, a lookout platform and a small green flag; leaves in plant greens. Crystal crypt: a dark stone crypt with purple crystal spires, a glowing doorway and a crooked gravestone fence. Each is 1.6 tiles deep, spans the five lanes, and stands at most 2.4 tiles high (the camera frames that height).
- Floating text is drawn with canvas-textured sprites pooled inside `Effects` (20 max), not DOM. `floatText` does nothing when no 2D canvas context is available, so tests can run without one.
- `?scene=fx&t=<seconds>` shows both bases at health 1, 0.6, 0.3 (three copies side by side are fine) and fires one of each effect on a timeline so that `t = 0.15` catches the explosion flash and ring.

- [ ] **Step 1:** Write `tests/render/particles.test.ts`: emitting 2,500 particles leaves `alive` at 2,000; a particle with life 0.5 is gone after 0.6 s of updates; with gravity 9 and bounce 0.4 a particle dropped from y = 1 never goes below y = 0; `Effects.explosion` emits at least 20 particles; with a fixed `random` two runs produce identical particle positions.
- [ ] **Step 2:** Write `tests/render/bases.test.ts`: each base's bounding box lies inside its `coords` x range and z ∈ [0, 5]; `setHealth` at 1, 0.6, 0.3, 0.1 yields four different visible-box counts, decreasing; `smokeAnchors()` is empty at 1 and non-empty at 0.3; `collapse()` resolves.
- [ ] **Step 3:** Run `npm test`. Expected: fails on missing modules.
- [ ] **Step 4:** Implement everything.
- [ ] **Step 5:** Screenshot loop: `npm run shots -- bases fx`. Checklist: the two bases are unmistakably Lukas's and Toby's and sit naturally on the island; damage states are obvious; explosion frame has a bright core, a ring and flying cubes; effects use the art-bible colours; nothing looks like flat white squares.
- [ ] **Step 6:** Run `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 7:** Commit: `feat(render): bases, projectiles, tokens, particle pool and effects`.

---

### Task 12: Battle view

**Files:**
- Create: `src/render/battle/types.ts` (the `Feel` and `PlacementPreview` types only; it must not import Three.js, so `src/app` can use it), `src/render/battle/BattleView.ts`, `src/render/battle/UnitView.ts`, `src/render/battle/HealthBars.ts`
- Modify: `src/main.tsx` (scene `battle-demo`), `tools/shots.mjs` (scenarios `battle-early`, `battle-busy`)
- Test: `tests/render/BattleView.test.ts`

**Interfaces:**
- Consumes: `SimState`, `SimEvent`, `Match`, `createBasicBot`, `ModelInstance`, `getModelDef`, `Effects`, `Particles`, `BaseView`, `Lawn`, `makeProjectile`, `makeToken`, `makeGravestone`, `simToWorld`.
- Produces:

```ts
export interface Feel { shake?: number; hitStop?: number; slowMo?: number; punch?: number }
export interface PlacementPreview { unit: UnitKey; lane: number; col: number; ok: boolean; mergeTargetId: number | null }
export class BattleView {
  constructor(scene: THREE.Scene, camera: THREE.Camera, lawn: Lawn, fx: Effects, playerFaction: Faction);
  onFeel: (f: Feel) => void;                                   // the session forwards to camera and loop
  onEnergyToken: (side: Faction, from: THREE.Vector3, amount: number) => void; // the HUD animates the fly-in
  applyEvents(events: readonly SimEvent[], state: SimState): void;   // call once per simulation step
  frame(state: SimState, alpha: number, dtSeconds: number, timeSeconds: number): void;
  setPreview(p: PlacementPreview | null): void;
  unitAtRay(ndcX: number, ndcY: number): number | null;       // unit id under the pointer
  celebrate(winner: Faction | 'draw'): Promise<void>;         // loser's base collapses, winners cheer
  readonly unitCount: number;
  dispose(): void;
}
```

Decisions:

- `BattleView` creates and owns the two `BaseView`s, the projectile objects and the energy tokens, and adds them to the scene it is given.
- Each unit view keeps its previous and current simulation `x` and draws at the interpolation of the two. Zombies within 0.4 tiles of another zombie in the same lane are nudged ±0.12 in z and drawn in id order so stacks read.
- Event → presentation: `unitSpawned` plays `spawn` with dirt (plants) or a gravestone burst (zombies); `unitAttacked` plays `shoot` or `melee`; `projectileSpawned` creates the projectile at the shooter's muzzle and it then follows the simulation's `x`; `projectileHit` makes a spark, or a block flash and the Skeleton's shield raise; `unitDamaged` flashes and recoils the unit and shows its health bar; `unitMerged` runs the merge motion from the art bible and swaps the level; `unitDied` plays `die`, then debris in the model's colours, and removes the view after 0.5 s; `explosion` calls `fx.explosion` and `onFeel({ shake: 0.5, hitStop: 0.08, punch: 0.04 })`; `energyGained` pops a token and calls `onEnergyToken` when the side is the player's, shows a floating `+N`, and plays the paying Sunflower's `shoot` clip when `unitId` is set; `baseDamaged` shudders the base and updates its damage state; `suddenDeath` tints the light towards orange; `matchEnded` calls `onFeel({ slowMo: 1.5 })`.
- A zombie whose `blocked` flag is false plays `walk`, otherwise `idle` between bites. A Walnut Bomb below 50% health shows its `cracks` part.
- Health bars per art bible section 6, drawn as camera-facing quads in one instanced mesh; level pips to the left of the bar for levels 2–5.
- `setPreview` shows a translucent model of the unit on the tile with `lawn.highlightTile`, or `lawn.highlightLane` for zombies; a merge target pulses instead.
- `?scene=battle-demo&seed=7&t=<seconds>` runs medium bot against medium bot through `BattleView` with no HUD, fast-forwarding the simulation to `t` before the first frame. `battle-early` is `t = 25`, `battle-busy` is `t = 150`.

- [ ] **Step 1:** Write `tests/render/BattleView.test.ts` with a plain `THREE.Scene` and camera (no WebGL): a `unitSpawned` event raises `unitCount` to 1 and adds an object named `unit-<id>` to the scene; `unitDied` removes it once 0.6 s of `frame` calls have passed; `unitMerged` to level 3 makes that object's scale 1.16 ± 0.01 after the 0.6 s motion; a view's drawn x at `alpha = 0.5` is the midpoint of its last two simulation positions; `projectileSpawned` then `projectileHit` leaves no projectile object; replaying a full 3,000-tick bot match through `applyEvents` and `frame` never throws and ends with `unitCount` equal to the state's unit count (after 1 s of extra frames).
- [ ] **Step 2:** Run `npm test`. Expected: fails on missing modules.
- [ ] **Step 3:** Implement the view and the demo scene.
- [ ] **Step 4:** Screenshot loop: `npm run shots -- battle-early battle-busy`. Checklist: it looks like a game in progress; every unit, projectile and health bar is readable; stacked zombies are distinguishable; shadows ground the units; nothing clips through the lawn or the bases; the busy frame is lively but the lanes still read.
- [ ] **Step 5:** Run `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 6:** Commit: `feat(render): battle view binding the simulation to the scene`.

---

### Task 13: Sound and music

**Files:**
- Create: `src/audio/AudioEngine.ts`, `src/audio/sfx.ts`, `src/audio/music.ts`, `src/audio/bindings.ts`
- Test: `tests/audio/audio.test.ts`

**Interfaces:**
- Produces:

```ts
export type SfxName = 'place' | 'spawnZombie' | 'pea' | 'brainThrow' | 'hit' | 'chomp' | 'block' | 'explode'
  | 'merge' | 'sun' | 'bounty' | 'baseHit' | 'click' | 'deny' | 'suddenDeath' | 'win' | 'lose' | 'collapse';
export class AudioEngine {
  constructor(createContext?: () => AudioContext);     // injectable for tests
  readonly unlocked: boolean;
  unlock(): Promise<void>;                             // call from the first pointer or key event; safe to call repeatedly
  setVolume(bus: 'music' | 'sfx', volume: number): void;   // 0..1
  setMuted(muted: boolean): void;
  play(name: SfxName, opts?: { pitch?: number; pan?: number; volume?: number }): void; // no-op until unlocked
  startMusic(theme: 'menu' | 'backyard'): void;
  setIntensity(v: number): void;                       // 0..1, eased over 2 s
  stopMusic(fadeSeconds?: number): void;
}
// music.ts — pure scheduling, testable without audio
export interface NoteEvent { time: number; layer: 0 | 1 | 2; midi: number; length: number; velocity: number }
export function scheduleBar(theme: 'menu' | 'backyard', barIndex: number, barStart: number): NoteEvent[];
// bindings.ts
export function playEventSounds(audio: AudioEngine, events: readonly SimEvent[], playerFaction: Faction): void;
export function battleIntensity(state: SimState): number;  // 0..1 from unit count and the lower base's health
```

Decisions:

- Every effect is synthesised from oscillators, noise buffers, filters and envelopes; each call varies pitch by ±6% unless `pitch` is given. The same effect plays at most once per 40 ms; at most 24 voices; a compressor on the master bus.
- Character: plants sound round and poppy (sine and triangle), zombies sound gritty (saw, noise). `explode` has a low thump under filtered noise. `merge` is a rising three-note arpeggio. `win` and `lose` are short four-bar stings.
- Music: 112 bpm, 4/4, C major for `backyard`, A minor for `menu`. Three layers: 0 bass and pad (always), 1 melody (intensity ≥ 0.35), 2 percussion and a counter line (≥ 0.7). An eight-bar loop; `scheduleBar` is deterministic. The engine schedules one bar ahead.
- `battleIntensity` = `min(1, units / 24) × 0.6 + (1 − lowerBaseFraction) × 0.4`.

- [ ] **Step 1:** Write `tests/audio/audio.test.ts` with a fake `AudioContext` that records node creation (Review Focus 4): `play` before `unlock` creates no nodes and does not throw; after `unlock` one `play('pea')` creates at least one source node; 10 `play('pea')` calls at the same fake time create sources for only one; `setMuted(true)` sets the master gain to 0; `scheduleBar('backyard', 3, 10)` returns the same events on every call, all with `time` in [10, 10 + 2.143), layer 0 present in every bar; bar 8 equals bar 0 shifted in time; `battleIntensity` is 0 for an empty healthy match and 1 for 24 units with a base at 0; `playEventSounds` maps `explosion` → `explode`, `unitMerged` → `merge`, and a `commandRejected` for the player's side → `deny`.
- [ ] **Step 2:** Run `npm test`. Expected: fails on missing modules.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(audio): synthesised effects, layered music, event bindings`.

---

### Task 14: Battle controller, HUD and input

**Files:**
- Create: `src/app/BattleController.ts`, `src/app/BattleSession.ts`, `src/render/portraits.ts`, `src/ui/hud/CardTray.tsx`, `src/ui/hud/EnergyCounter.tsx`, `src/ui/hud/BaseBars.tsx`, `src/ui/hud/TopBar.tsx`, `src/ui/screens/BattleScreen.tsx`
- Modify: `src/ui/theme.css`, `src/main.tsx` (scene `battle`), `src/app/debug.ts`, `tools/shots.mjs` (scenarios `hud-plants`, `hud-zombies`)
- Test: `tests/app/BattleController.test.ts`, `tests/ui/CardTray.test.tsx`

**Interfaces:**
- Produces:

```ts
// BattleController.ts — no DOM, no Three.js
export interface BattleOptions { playerFaction: Faction; skill: Skill; seed: number }
export interface CardVM { unit: UnitKey; name: string; price: number; hotkey: string; affordable: boolean; rechargeFraction: number }
export interface HudSignals {
  energy: Signal<number>; cards: Signal<CardVM[]>;
  base: Signal<Record<Faction, { hp: number; max: number }>>;
  seconds: Signal<number>; suddenDeath: Signal<boolean>; paused: Signal<boolean>;
  selected: Signal<UnitKey | null>; shovel: Signal<boolean>;
  result: Signal<null | { winner: Faction | 'draw'; playerWon: boolean }>;
  denied: Signal<number>;                       // increments on each refused action, for the shake
}
export class BattleController {
  readonly match: Match; readonly hud: HudSignals; readonly playerFaction: Faction;
  constructor(opts: BattleOptions, balance?: Balance);
  step(): SimEvent[];                           // bot commands + queued player commands, one tick
  select(unit: UnitKey | null): void;           // selecting a card clears the shovel
  toggleShovel(): void;                         // plants only
  hover(tile: { lane: number; col: number } | null, unitId: number | null): PlacementPreview | null;
  click(tile: { lane: number; col: number } | null, unitId: number | null): CommandRejection | null; // null = accepted
  hotkey(key: string): void;                    // '1'..'9','0' select cards; 'Escape' clears; ' ' toggles pause
  setPaused(paused: boolean): void;
}
// BattleSession.ts
export class BattleSession {
  readonly controller: BattleController;
  constructor(canvas: HTMLCanvasElement, audio: AudioEngine, quality: Quality, opts: BattleOptions); // throws Error('webgl2-unavailable')
  start(): Promise<void>;                       // intro camera, then the loop runs
  pointerMove(clientX: number, clientY: number): void;
  pointerDown(clientX: number, clientY: number, button: number): void;   // button 2 clears the selection
  energyAnchor: () => DOMRect | null;           // set by the HUD
  dispose(): void;
}
// portraits.ts
export function renderPortraits(keys: readonly UnitKey[], size: number): Promise<Record<string, string>>; // data URLs, transparent background
```

Decisions:

- `click` logic: with the shovel on, a click on the player's own plant issues `remove`. With a card selected: if `unitId` is the player's own unit of the same key below level 5, issue `merge`; otherwise for plants issue `place` on the tile, for zombies `place` in the tile's lane. The command is first passed to `match.check`; a rejection increments `denied`, issues nothing and returns the reason. At most one accepted command is queued per tick; further clicks in the same tick are dropped silently. Nothing is accepted while paused or after the result is set. The selection stays after a successful place so a child can place several.
- `hover` returns the preview the view should draw, with `ok` from `match.check`.
- `CardTray` props: `{ cards: CardVM[]; selected: UnitKey | null; portraits: Record<string, string>; side: Faction; denied: number; onSelect(unit: UnitKey): void }`. Its root element carries class `is-denied` for 300 ms each time `denied` changes.
- `step` updates the signals; `cards` is rebuilt only when a value in it changes.
- Dragging works too: pointer down on a card selects it; pointer up over the lawn acts as a click there.
- HUD layout at 1440×900: energy counter top left (Sun icon for plants, Brain icon for zombies, big number, the counter bumps when a token lands); top bar centre with the clock (`m:ss`) and a `SUDDEN DEATH` banner when active; base health bars top left and top right under portrait chips of Lukas and Toby; card tray bottom centre per art bible section 7 with a shovel button at its right for plants; pause button top right. Everything scales with `clamp()` so it fits at 1280×720 and 2560×1080.
- The battle scene reads `?scene=battle&side=plants|zombies&skill=medium&seed=7`. `__lvt.session` is exposed, with `__lvt.tileToClient(lane, col)` returning screen coordinates and `__lvt.fastForward(ticks)` stepping the controller without drawing.

- [ ] **Step 1:** Write `tests/app/BattleController.test.ts` (Review Focus 3): selecting Peashooter and clicking tile (2, 3) queues a place and the unit exists after `step`; clicking the same tile again returns `'occupied'`, increments `denied` and leaves energy unchanged; 100 clicks on a free tile within one tick place exactly one unit; with energy 0 a click returns `'no-energy'`; clicking with `tile = null` returns a rejection and does not throw; while paused, clicks and hotkeys other than space do nothing; after `result` is set nothing is accepted; as zombies a click on any tile of lane 4 spawns at `x = 9.5` in lane 4; clicking the player's own Peashooter with Peashooter selected issues a merge; hotkey `'2'` selects the second card and `'Escape'` clears it; shovel then click on own plant removes it; `hover` on an occupied tile returns `ok: false`; `cards[i].rechargeFraction` falls from 1 to 0 over the recharge time.
- [ ] **Step 2:** Write `tests/ui/CardTray.test.tsx` (happy-dom): renders one card per `CardVM` with name, price and hotkey; an unaffordable card has class `is-disabled`; clicking a card calls `onSelect` with its unit; the selected card has class `is-selected`.
- [ ] **Step 3:** Run `npm test`. Expected: fails on missing modules.
- [ ] **Step 4:** Implement the controller, then the HUD components, portraits and the session.
- [ ] **Step 5:** Screenshot loop: `npm run shots -- hud-plants hud-zombies` (each fast-forwards 40 s with a card selected and the pointer over a tile). Checklist: HUD looks like one designed set, chunky and friendly; portraits are crisp and match the models; numbers are easy to read; the placement preview and tile highlight are obvious; nothing in the HUD covers a lane; zombie HUD uses the purple family.
- [ ] **Step 6:** Run `npm test && npm run typecheck && npm run build`. Expected: pass.
- [ ] **Step 7:** Commit: `feat: battle controller, HUD and pointer and keyboard input`.

---

### Task 15: Title, side pick, pause, result and settings

**Files:**
- Create: `src/app/store.ts`, `src/app/settings.ts`, `src/ui/screens/Title.tsx`, `src/ui/screens/SidePick.tsx`, `src/ui/hud/PauseMenu.tsx`, `src/ui/hud/ResultOverlay.tsx`, `src/ui/SettingsPanel.tsx`, `src/ui/Unsupported.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/screens/BattleScreen.tsx`, `src/main.tsx`, `tools/shots.mjs` (scenarios `title`, `sidepick`, `pause`, `result-win`, `result-lose`)
- Test: `tests/app/settings.test.ts`, `tests/ui/App.test.tsx`

**Interfaces:**
- Produces:

```ts
// store.ts
export type Screen = { name: 'title' } | { name: 'sidepick' } | { name: 'battle'; options: BattleOptions } | { name: 'unsupported'; reason: 'webgl2' | 'context-lost' };
export const screen: Signal<Screen>;
export function go(s: Screen): void;
// settings.ts
export interface Settings { music: number; sfx: number; muted: boolean; quality: Quality }
export const DEFAULT_SETTINGS: Settings;       // music 0.6, sfx 0.8, muted false, quality 'high'
export function loadSettings(storage?: Storage): Settings;   // key 'lvt2_settings'; bad or missing data → defaults
export function saveSettings(s: Settings, storage?: Storage): void;
```

Decisions:

- Title: the lawn with a medium-vs-medium bot battle playing behind a slight blur and darkening, the game name as styled text in two colours (green `LUKAS PLANTS`, a small `vs`, purple `TOBY ZOMBIES`) that drops in with a bounce, one big `PLAY` button, a gear for settings. Menu music starts on the first click.
- Side pick: two large cards with the boys' portraits, `LUKAS` / `Plants` and `TOBY` / `Zombies`, three difficulty buttons (Easy, Medium, Hard; Medium preselected), and `START`. A back arrow returns to the title.
- Battle: camera intro 1.8 s, then `READY…` and `FIGHT!` banners (0.7 s each), then input unlocks. The simulation does not advance until `FIGHT!` has gone. Backyard music follows `battleIntensity`.
- Pause (button, space, or the tab becoming hidden): dim overlay with `Resume`, `Restart`, `Settings`, `Quit`. Tab hidden always pauses; returning does not auto-resume.
- Result: after `BattleView.celebrate`, a panel with `VICTORY!` or `DEFEAT` (or `DRAW`), the winner's portrait, match time, `Play again` and `Menu`. Win and lose stings play.
- Settings: music and effects sliders, mute, quality (Low, Medium, High). Applied live and saved.
- `Renderer` throwing `webgl2-unavailable` shows `Unsupported`: "This game needs a newer browser. Try Safari or Chrome on a computer." A lost context shows "Graphics stopped. Reload to continue." with a reload button.

- [ ] **Step 1:** Write `tests/app/settings.test.ts`: defaults when storage is empty; round trip; malformed JSON and out-of-range numbers fall back to defaults field by field.
- [ ] **Step 2:** Write `tests/ui/App.test.tsx` (happy-dom; `BattleSession` mocked) (Review Focus 2 and 4): the title shows `PLAY`; clicking it shows the side pick; choosing Toby and Hard then `START` moves to `battle` with `{ playerFaction: 'zombies', skill: 'hard' }`; when the mocked session constructor throws `webgl2-unavailable` the unsupported message is shown and nothing else throws; dispatching `visibilitychange` with `document.hidden = true` during a battle calls `setPaused(true)` and showing the tab again does not call `setPaused(false)`.
- [ ] **Step 3:** Run `npm test`. Expected: new tests fail.
- [ ] **Step 4:** Implement the screens and wiring. Without a `scene` parameter the app starts at the title.
- [ ] **Step 5:** Screenshot loop: `npm run shots -- title sidepick pause result-win result-lose`. Checklist: the title would make a child want to press PLAY; the two boys' cards are balanced, neither looks like the default; pause and result panels match the HUD style; text is large and short.
- [ ] **Step 6:** Run `npm test && npm run typecheck && npm run build`. Expected: pass.
- [ ] **Step 7:** Commit: `feat: title, side pick, pause, result and settings`.

---

### Task 16: Browser proof for phase 1

**Files:**
- Create: `playwright.config.ts`, `e2e/phase1.spec.ts`, `tools/perf.mjs`
- Modify: `package.json` (scripts `e2e`: `playwright test`, `perf`: `node tools/perf.mjs`), `src/main.tsx` (scene `stress`), `src/app/debug.ts`, `README.md`

**Interfaces:**
- Consumes: `window.__lvt` (`ready`, `session`, `tileToClient`, `fastForward`), all screens.
- Produces: `__lvt.damageBase(side: Faction, amount: number): void` (debug only; applies damage through the simulation's own `damageBase` on the next step), `?scene=stress&units=<n>` (a battle view filled with `n` units, half per side, all attacking, bots off), `npm run e2e`, `npm run perf`.

Decisions:

- `playwright.config.ts`: Chromium only, one worker, `webServer` runs `npm run build && npm run preview`, base URL `http://localhost:5274`, viewport 1440×900, the same GPU launch arguments and fallback as `tools/shots.mjs`, a 60 s test timeout.
- Every test collects console errors and page errors and fails if any occurred.
- `tools/perf.mjs`: opens `?scene=stress&units=60` and then `units=150` headed at 1440×900, records 600 animation-frame intervals each after a 3 s warm-up, prints median and 95th percentile and the final render scale, and writes `artifacts/perf.json`. It does not fail the build in this phase.

- [ ] **Step 1:** Write `e2e/phase1.spec.ts`:
  - `boots to the title without errors`
  - `plays as Lukas`: PLAY → Lukas → Medium → START; wait for `FIGHT!` to go; click the Sunflower card then the tile at `tileToClient(2, 0)`; expect `session.controller.match.state.units` to contain a sunflower in lane 2 at `x = 0.5` and plant energy below 165; press `1`, click `tileToClient(2, 3)`; expect a peashooter at `x = 3.5`.
  - `refuses what it should`: click an occupied tile and expect the unit count unchanged and the tray to get class `is-denied` briefly.
  - `pauses and resumes`: press space, expect the pause menu and that `state.tick` does not advance over 500 ms; `Resume`; expect it to advance.
  - `pauses when the tab is hidden`: dispatch `visibilitychange` with `document.hidden` stubbed true; expect the pause menu.
  - `wins`: call `__lvt.damageBase('zombies', 99999)`; expect `VICTORY!` within 10 s; click `Play again`; expect a fresh battle at tick < 300.
  - `loses as Toby`: start as Toby on Easy; `__lvt.damageBase('zombies', 99999)`; expect `DEFEAT`.
  - `fits other window sizes` (Review Focus 1): at 1280×720 and 2560×1080 every element with `data-hud` has a bounding box fully inside the viewport, the card tray's top edge is below the on-screen position of `tileToClient(4, 0)` plus 40 px, and no two `data-hud` boxes intersect.
  - `plays a whole match`: start as Lukas on Easy and call `__lvt.fastForward(14400)`; expect a result panel.
- [ ] **Step 2:** Run `npm run e2e`. Expected: tests fail where hooks are missing.
- [ ] **Step 3:** Add the debug hook, `data-hud` attributes, the `stress` scene and the perf tool; fix whatever the tests expose.
- [ ] **Step 4:** Run `npm run e2e`. Expected: 9 passed.
- [ ] **Step 5:** Run `npm run perf`. Record the numbers in the commit body. If the 95th percentile at 60 units exceeds 20 ms, find the cause (draw calls, shadow map, post chain, per-frame allocation) and fix it before committing.
- [ ] **Step 6:** Run `npm test && npm run typecheck && npm run build && npm run shots -- title battle-busy hud-plants result-win`. Expected: all pass; open the four PNGs one last time.
- [ ] **Step 7:** Update `README.md` with the e2e, perf and shots commands.
- [ ] **Step 8:** Commit: `test: browser proof for phase 1, stress scene and perf tool`.
