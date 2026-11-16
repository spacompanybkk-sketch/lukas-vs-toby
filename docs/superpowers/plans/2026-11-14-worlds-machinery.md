# Worlds Machinery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything worlds 2–5 need that is not a level: world data, the four lawn twists in the sim, boss phases, per-world looks and music, a multi-world map, Adventure's own difficulty, and measurement that scales to 80 levels. Ships on its own; world content follows in one plan per campaign step.

**Architecture:** A world is data (`src/data/worlds.ts`): look, weather, music theme, twist kind. A level names its world; the arena is derived from side and world (zombies travel the worlds in reverse). Twists are one composable `MatchConfig.lawn` field applied inside existing sim stages. Bosses gain optional per-phase pattern lists and one generic `strike` pattern. Render, audio and map read the world table instead of Backyard constants.

**Tech Stack:** Vite, TypeScript strict, Three.js 0.187, Preact + signals, Vitest 5, Playwright 1.64, tsx.

**Spec:** `docs/superpowers/specs/2026-11-11-3d-rebuild-design.md` (§8, §10 campaign paragraph, §11, §12). Recon with file:line references for every place named below: `.superpowers/sdd/worlds-recon.md` — every implementer reads its sections for their task first.

## Global Constraints

- Players are 8 and almost 5; the younger cannot read. Pictures only, touch-first, iPad Safari landscape. Minecraft look (boxy, hard-edged, pixelated), HUD and menus included. Do not restyle what is built.
- The sim stays deterministic: no `Math.random`, no clock, only basic arithmetic and `Math.sqrt/floor/abs/min/max`. New state goes in the hash field tables and snapshot/restore. An old snapshot without `lawn` restores as `NO_TWIST`.
- With `lawn = NO_TWIST` and no boss `phases`, every existing match replays bit-identically. The golden hash may be re-pinned once (Task 2, config table grows); the nine-battle replay comparison against the previous commit must show identical results.
- No unit, hero, spell or Quick Battle number changes in this plan. Only `Balance.twists`, boss tables, and Backyard level p1-5.
- All tunable numbers live in `src/data/balance.ts`.
- Versus, Quick Battle and Free Play: Backyard look, `NO_TWIST`.
- One WebGL context for the whole page. Budget 16.6 ms p95 at DPR 2 on the M3 for every look with its weather.
- No network requests to Firebase from tests or tools; every e2e/tool URL carries `cloud=fake`. No deploys by agents.
- One browser at a time (`/tmp/lvt-browser.lock`, held under 5 minutes). At most 3 worker processes for measurement. Never two tuning runs at once.
- Commits end with `Co-Authored-By: Claude <noreply@anthropic.com>`. No formatters. No `git stash`, no `pkill`.

## Rulings made while planning (spec silent; recon §8)

1. Level ids keep each side's own campaign order (`zN` = the zombies' N-th world). Arena = `arenaOf(side, world)`: plants `backyard, meadow, desert, tundra, citadel`; zombies the reverse. No save migration.
2. z1 keeps its levels and the Elder Oak but takes the Citadel look with lava off. The zombie finale (z5-8, a later plan) is a new boss at the treehouse.
3. Fog: both sides; a shot's reach is `min(range, fog)` and straight, piercing and untargeted lobbed projectiles fade at that distance, before reaching a base. Heroes, spells and boss attacks unaffected. Default 5 tiles.
4. Rocks: block plant placement only (cards, belt, Rock Wall spell, plant-boss summons); indestructible; zombies and shots ignore them.
5. Ice: zombies (bosses included) move ×1.6 in listed lanes.
6. Lava: burns whatever stands on the tile, both sides, bosses included; placement allowed; 15 dps, 2 s refreshing burn.
7. Unlocks land at campaign levels 11, 14, 19, 22, 27 (w2-3, w2-6, w3-3, w3-6, w4-3).
8. Coins stay 30 per star / 10 replay / 5 loss.
9. Adventure difficulty: new save key `adventureDifficulty`, seeded from `difficulty` when absent; merge keeps the newer.
10. Map: one island per world, arrow pictures to switch, opens on the world of the next level; locked islands grey with a padlock.
11. Average-player band for campaign level i (9..40): `88 − 48·(i−9)/31`, ±8; bosses may sit 5 below. Expert ≥95%. Beginner on Easy ≥70% through world 2. If Task 8 shows average 40% and expert 95% cannot both hold, record the measured gap and stop for Michal (spec §10: thresholds are not loosened without telling him).
12. Titan and Oak fights stay as shipped. Phases are for new bosses.

## Review Focus

1. A snapshot taken mid-burn on lava, or with a projectile mid-fade, restores to the same hash — Task 2 fuzz test.
2. A level file that puts a prepared or scripted plant on a rock, lists a lane twice, or gives fog ≤ 0 is refused at construction with a clear message — Task 2 `checkLawn` tests.
3. Leaving a Citadel level for a Backyard Quick Battle and back ten times leaks no geometry, keeps one WebGL context, and the Backyard is pixel-identical to today — Task 4 screenshot diff, Task 9 round-trip e2e.
4. A save written before this plan (no `adventureDifficulty`) loads, plays, syncs and merges with a device that has the key — Task 7 save tests.
5. The level's own computer and the stand-ins never place on a rock (no command refusals) and do not walk plants into lava by default — Task 8b tests.

---

### Task 1: World data

**Files:** Create `src/data/worlds.ts`, `tests/data/worlds.test.ts`. Modify `src/adventure/levels/index.ts`, `src/adventure/types.ts`.

**Produces:**
```ts
export type WorldKey = 'backyard' | 'meadow' | 'desert' | 'tundra' | 'citadel';
export type TwistKind = 'none' | 'fog' | 'rocks' | 'ice' | 'lava';
export const WORLD_ORDER: readonly WorldKey[];            // plants' order
export function arenaOf(side: Side, world: 1|2|3|4|5): WorldKey;
export const WORLDS: Record<WorldKey, { twist: TwistKind; theme: WorldKey; weather: 'none'|'fireflies'|'dust'|'snow'|'embers' }>;
```
`LevelDef` gains `twist?: LevelTwist` where `LevelTwist = { rocks?: number[]; fog?: true; iceLanes?: number[]; lavaTiles?: number[] }` (which tiles; numbers come from `Balance.twists`). `LEVELS` becomes a concatenation of per-world files (`backyard.ts` only, for now).

- [ ] Tests: `arenaOf('plants',2)==='meadow'`, `arenaOf('zombies',1)==='citadel'`, `arenaOf('zombies',5)==='backyard'`; every `WorldKey` has a table row; `LEVELS` unchanged in length and ids.
- [ ] Implement; `npx tsc --noEmit`; `npx vitest run tests/data tests/adventure`; commit.

### Task 2: Four twists in the sim

**Files:** Create `src/sim/lawn.ts`, `tests/sim/lawn.test.ts`. Modify `src/sim/{types,match,combat,movement,spells,belt,boss,script,hash}.ts`, `src/data/balance.ts`, `src/adventure/campaign.ts` (`levelConfig` builds `lawn` from `def.twist` + `Balance.twists`), `tests/sim/hash.test.ts` (one re-pin).

**Produces:**
```ts
interface LawnConfig {
  rocks: number[];                                   // lane*PLANT_COLS+col
  fog: number | null;                                // tiles a shot reaches
  ice: { lanes: number[]; speed: number } | null;
  lava: { tiles: number[]; dps: number; burnTicks: number } | null; // lane*COLS+col
}
export const NO_TWIST: LawnConfig;
MatchConfig.lawn: LawnConfig;                        // default NO_TWIST
Balance.twists = { fog: { reach: 5 }, ice: { speed: 1.6 }, lava: { dps: 15, burnSeconds: 2 } };
// new placement rejection reason 'rock'; new event { type: 'projectileFaded', id, x, lane }
// Projectile.fadeX: number | null (hashed)
export function checkLawn(config: MatchConfig): void;   // called from checkLevel
```
Where each applies: recon §2 table. Lava uses the rot puddle's quiet-refresh `inflictStatus` pattern in a new `tickLava` stage after `tickHazards`.

- [ ] Tests first, per twist: rock tile refuses card, belt card, Rock Wall, boss summon, and `match.check` says so; fog — a peashooter at column 0 never damages the zombie base, at column ≥ 10−fog it does, a zombie beyond reach is not hit, `projectileFaded` fires once; ice — a walker in an ice lane covers 1.6× the distance of one in a plain lane over 90 ticks; lava — plant and zombie on lava both burn, burn stops 2 s after leaving/dying, a boss burns.
- [ ] `checkLawn` refusals (Review Focus 2).
- [ ] Fuzz: 200 random matches with random twists, snapshot at a random tick, restore, same final hash (Review Focus 1). Old snapshot without `lawn` restores.
- [ ] `NO_TWIST` replay: the nine-battle comparison tool against the previous commit — identical results. Re-pin the golden hash once and say so in the commit.
- [ ] `npx tsc --noEmit`; full `npx vitest run`; commit in steps (one twist per commit).

### Task 3: Boss phases and the `strike` pattern

**Files:** Modify `src/sim/{boss,types,hash}.ts`, `src/data/balance.ts`, `src/render/battle/BossFx.ts` (reads the current phase's list only — no new visuals), `tests/sim/boss*.test.ts`. Same worktree as Task 2, after it.

**Produces:**
```ts
BossStats.phases?: readonly (readonly BossPattern[])[];   // phase i (after i shield marks) uses phases[i] ?? patterns
type BossPattern = … | { kind: 'strike'; everySeconds: number; windupSeconds: number;
  target: 'lanes' | 'tiles'; count: number; damage: number;
  status?: { kind: StatusKind; seconds: number; dps?: number } };
// event { type: 'bossStrike', unitId, tiles: {lane, col}[], windup }
export function patternsOf(stats: BossStats, phase: number): readonly BossPattern[];
```
Passing a shield mark resets the pattern cursor to the new phase's first timed pattern. Strike targets are chosen with the seeded rng at wind-up start and stored so a snapshot mid-wind-up restores (hashed).

- [ ] Tests: a test-only boss with two phases switches lists at its mark; strike hits exactly the announced tiles after the wind-up and applies its status; snapshot mid-wind-up; Titan and Oak matches hash exactly as before this task.
- [ ] `npx tsc --noEmit`; full vitest; commit.

### Task 4: Per-world looks

**Files:** Modify `src/render/world/*`, `src/render/Renderer.ts`, `src/render/palette.ts`, `src/app/{Stage,BattleSession}.ts`, `src/render/battle/BattleView.ts`. Create `src/render/world/looks.ts`, `src/render/world/Weather.ts`, `src/render/world/TwistTiles.ts`, tests beside existing render tests. Add scenes to the screenshot tool.

**Produces:** `Stage.setWorld(world: WorldKey, lawn: LawnConfig): void` (rebuilds island colours, props, sky, lights, colour grade, weather; disposes what it replaces); `LOOKS: Record<WorldKey, Look>`; twist visuals: boulders on rock tiles, mist plus a fade puff on `projectileFaded`, icy lane tiles, glowing lava tiles. `BattleSession` calls `setWorld(arenaOf(side, def.world), config.lawn)` for levels (z1 → citadel look, lava off) and `('backyard', NO_TWIST)` elsewhere, and `startMusic(WORLDS[arena].theme)`.

All five looks are built here, following `docs/art-bible.md`: Meadow night blues with fireflies and a moon; Desert orange mesas with dust; Tundra white-blue with snowfall; Citadel dark stone, lava glow, embers.

- [ ] Backyard screenshot before/after: pixel-identical at the fixed tool seed.
- [ ] Unit tests: `setWorld` twice leaves geometry/material/texture counts flat (`renderer.info.memory`); every `WorldKey` builds.
- [ ] Perf tool: each look with weather and its twist tiles, mix-150 scene, DPR 1 and 2, inside budget; report the table.
- [ ] Screenshots of all five looks at iPad size into the scratchpad; look at them; commit per look.

### Task 5: Boss effects, bar and sounds as data tables

**Files:** Modify `src/render/battle/BossFx.ts`, `src/ui/hud/BossBar.tsx`, `bossBar.css`, `src/audio/{bindings,sfx}.ts`, `src/render/models/registry.ts`, `src/scenes/bossDemo.tsx`. No visible or audible change.

**Produces:** `BOSS_LOOK: Record<BossKey, { scale; face; call; defeat; fx: … }>` in one file that later plans add a row to; `bossStrike` drawn as tile warning markers during wind-up and an impact (generic, coloured by status).

- [ ] Existing boss e2e and unit tests stay green untouched; boss demo screenshots identical; a table-completeness test (every `BossKey` has a row).
- [ ] Commit.

### Task 6: Music per world

**Files:** Modify `src/audio/{music,AudioEngine}.ts`, tests beside them.

**Produces:** `type Theme = 'menu' | WorldKey`; `startMusic(theme: Theme)`; four new 8-bar themes (own key and scale, shared 112 bpm, same layering rule as Backyard): Meadow soft minor lullaby, Desert Phrygian, Tundra bright sparse bells, Citadel low and driving.

- [ ] Tests: every theme sequences without error for 32 bars in the offline context, has the three intensity layers, and switching themes stops the old one.
- [ ] Commit.

### Task 7: Multi-world map and Adventure's own difficulty

**Files:** Modify `src/ui/screens/{Map,mapModel,LevelCard}.tsx`, `src/scenes/mapStage.ts`, `src/progress/{save,merge}.ts`, `src/adventure/{campaign,freePlay}.ts`, `src/app/session.ts`, tests beside each, `e2e/map*.spec.ts`. Starts from the branch that holds the usability fixes.

**Produces:** `mapStones(side, world)`; the map shows one island per world in the side's arena order with that world's look colours, left/right arrow pictures, opens on the next level's world; worlds without levels yet stay grey with a padlock and cannot be entered. `Save.adventureDifficulty` (ruling 9) read by `levelConfig` and Free Play; Quick Battle keeps `difficulty`. Level card shows a twist picture when the level has one.

- [ ] Save tests (Review Focus 4): old save loads with the seeded value; merge of old+new; cloud save string stays under 20,000.
- [ ] e2e (ipad): arrows move between islands, locked island refuses, changing difficulty on the level card does not change Quick Battle's.
- [ ] Commit.

### Task 8: Measurement that scales

Three parts, one worktree, in order.

**8a — plumbing.** Modify `src/ai/levelChecks.ts`, `tools/levels.ts`, `tests/ai/long/*`, `package.json`. `LEVELS` passed through everywhere `BACKYARD` was assumed (recon §1 items 2–4); the average stand-in buys upgrades at real Marketplace prices from coins actually earned at its star rate, favourites grow with unlocks; one long test file per world plus one for Free Play; default `npm run test:balance` runs one seed block for levels, `LVT_BLOCKS=3` runs three; phase-2 bands move to `npm run test:balance:core`; `tools/levels.ts --world N`; curve bands from ruling 11 as a function. Backyard results must not move except where the upgrade model changes them — report the before/after table.
- [ ] Probe (ruling 11): build one throwaway late-campaign battle and report the largest gap achievable between the average and expert stand-ins. If average ≤48% with expert ≥95% is unreachable, stop and report numbers.

**8b — twist-aware AI.** Modify `src/ai/{lawn,plantStrategy,laneModel,zombieStrategy,powers,standIns,levelStandIns}.ts`. `readLawn` exposes `blocked[]`; one `freeTile(view, lane, col)` helper replaces the direct tile tests (recon §2); lane model knows ice walk time, fog reach and lava cost; the level computer avoids lava and rocks.
- [ ] Tests (Review Focus 5): 100 seeded matches per twist, zero refused commands from any bot; plant bots place no plant on lava while a free plain tile exists in the lane.

**8c — Backyard leftovers.** Breakthrough stand-in that ranks by skill (expert reads the weakest lane); p1-5 no longer won by an idle player (`WAITING_WINS` loses p1-5); re-measure the Backyard on three blocks; update known misses.
- [ ] `npm run test:balance` and the three-block Backyard run green; commit.

### Task 9: Proof and release notes

**Files:** `e2e/*`, `tools/*`, `README.md`.

- [ ] e2e, both projects: a debug-built level per twist is playable by taps (rock tile refuses and highlights as invalid; fog fades a pea; ice lane zombie arrives first; lava burns); world round trip ×10 on one WebGL context (Review Focus 3); z1 shows the Citadel look; map arrows.
- [ ] `tsc`, full vitest ×2, `npm run test:balance`, `npm run test:balance:core`, full e2e both projects with the machine awake (`caffeinate -i`).
- [ ] Perf table for every look; screenshots of every look and the map at the three iPad sizes.
- [ ] README: worlds, twists, the new scripts.

## Parallel streams

Task 1 first on the base branch. Then at once, each in its own worktree: sim (2 → 3), render (4), effects+audio (5, 6), UI (7, after the usability fixes land), measurement (8a now; 8b and 8c after Task 2 merges). Task 9 last on the merged branch.
