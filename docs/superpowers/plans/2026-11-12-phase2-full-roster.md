# Phase 2 — Full Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All 20 units playable with every ability, the six statuses, both hero powers, and the look, sound and HUD that make them readable, in the one Backyard battle against the computer.

**Architecture:** The simulation grows a general ability model (shot flights, statuses, hazards, timed abilities, summons, hero powers) driven entirely by the balance table; the 14 new units are rows in that table plus small rule functions. The view, audio and HUD stay event-driven: every new rule emits events and they draw and sound from those alone. The computer players learn the new cards well enough to keep the game fair; exact balance is phase 3.

**Tech Stack:** as phase 1 — Vite, TypeScript strict, Three.js 0.187, Preact + signals, Vitest 5, Playwright 1.64 (cached Chromium only), tsx.

**Spec:** `docs/superpowers/specs/2026-11-11-3d-rebuild-design.md` (sections 6.3–6.7, 10, 11, 12, 14, 19). Art rules: `docs/art-bible.md`.

## Global Constraints

Everything in `.superpowers/sdd/2026-11-11-phase1-foundation-one-level/global-constraints.md` still binds (read it first). In addition:

- Names and prices of the 20 units are spec 6.6 verbatim and do not change.
- `src/sim`, `src/ai`, `src/data` stay deterministic: no `Math.random`, `Date`, or float-order dependence; all randomness through the state's seeded rng. Every new state field is covered by `hash`, `snapshot` and `restore`, with a hash-mutation test row.
- Every number lives in `Balance`; rule code has no literals except 0, 1 and geometry constants already in `types.ts`.
- The view, audio and HUD read events and state only; they never decide a rule.
- Look: boxy, hard-edged, pixelated (Minecraft) for every new effect, prop, icon and HUD element. Glow needs emissive ≥ 1.5. No new lights. Models ≤ 5,000 triangles at every level.
- Touch first: every new control works by tap alone, target ≥ 44 pt, no hover or keyboard needed. Toby (almost 5) cannot read: icons and sound, not words.
- Phase-1 tests keep passing unchanged, except where a task below names the change. The pinned "classic" numbers in `tests/sim/helpers.ts` stay as they are.
- One browser at a time; never `playwright install`; never kill a process you did not start; no bare `git stash`; no formatters; commit trailer `Co-Authored-By: Claude <noreply@anthropic.com>`; no push, no deploy.

## Review Focus

1. Two abilities meeting in one tick (a stunned mine touched by a zombie, a burning pea hitting a shield, a tied Cherry Bomber mid-fuse, a minion raised as its Necromancer dies): one defined outcome each, same on every run. Tests in Tasks 2–3.
2. A match restored from a snapshot taken mid-ability (mid-fuse, mid-flight lobbed shot, live puddle, charged hero) continues to the same hash as the unbroken match. Test in Task 1 and extended in Tasks 2–4.
3. Ten cards plus a hero button on a 1024×768 iPad in landscape: all reachable, none under the home indicator, a five-year-old's tap lands on one card. Test in Task 7.
4. 150 units with statuses, puddles and projectiles of every kind on screen: frame cost stays within phase 1's budget (DPR 1 ≤ 10 ms, DPR 2 ≤ 16.6 ms unthrottled on the M3). Test in Task 9.
5. A child who only ever taps the newest, most expensive card must not win or lose every time. Test in Task 8.

## File map

- `src/sim/types.ts`, `src/data/balance.ts`, `src/data/units.ts` — model, numbers, card lists.
- `src/sim/status.ts` (new) — statuses. `src/sim/abilities.ts` (new) — timed abilities, summons, hazards. `src/sim/hero.ts` (new) — hero powers. `src/sim/combat.ts` — flights, on-hit effects. `src/sim/movement.ts` — holding, stun. `src/sim/match.ts`, `src/sim/hash.ts` — commands, stage order, coverage.
- `src/render/models/props.ts`, `src/render/battle/{BattleView,UnitView,StatusMarks(new),Hazards(new),HeroFx(new)}.ts`, `src/render/fx/Effects.ts`.
- `src/audio/{sfx,bindings}.ts`.
- `src/app/BattleController.ts`, `src/ui/hud/{CardTray,HeroButton(new)}.tsx`, `src/ui/screens/BattleScreen.tsx`.
- `src/ai/*` — strategies, stand-ins, checks.
- `tools/shots.mjs`, `tools/perf.mjs`, `e2e/*`.

---

### Task 1: Ability model in the simulation

**Files:** modify `src/sim/types.ts`, `src/data/balance.ts`, `src/data/units.ts`, `src/sim/{combat,movement,match,hash,lookup,economy}.ts`; create `src/sim/status.ts`; tests `tests/sim/{status,flights,hash,determinism}.test.ts`, `tests/data/*.test.ts`.

**Interfaces — Produces (exact):**

```ts
// types.ts
export type CardKey = PlantKey | ZombieKey;
export type UnitKey = CardKey | 'boneMinion';          // boneMinion is never a card
export type ProjectileKind = 'pea' | 'brain' | 'kernel' | 'butter' | 'mango' | 'sand' | 'arrow' | 'bullet' | 'trident' | 'rot';
export type Flight = 'straight' | 'lobbed' | 'piercing';
export type StatusKind = 'stun' | 'blind' | 'tied' | 'poison' | 'burn';
export interface Unit { /* existing fields plus: */
  stun: number; blind: number; tied: number;           // ticks left
  poison: number; poisonDps: number; burn: number; burnDps: number; // ticks left, damage per second
  stacks: number;                                      // Hot Topic growth; 0 for everyone else
  ownerId: number | null;                              // the Necromancer that raised a minion
}
export interface Projectile { /* existing plus: */
  flight: Flight; sourceKey: UnitKey; level: number;
  targetId: number | null; targetX: number | null;     // lobbed only
  pierceLeft: number; hitIds: number[];                // piercing only
  burning: boolean;
}
export interface Hazard { id: number; kind: 'rot'; faction: Faction; lane: number; x: number; radius: number; ticksLeft: number; dps: number }
export interface SimState { /* plus */ hazards: Hazard[] }
// new events
| { type: 'statusApplied'; unitId: number; status: StatusKind; ticks: number; sourceId: number | null }
| { type: 'statusEnded'; unitId: number; status: StatusKind }
| { type: 'attackMissed'; unitId: number }
| { type: 'unitHealed'; unitId: number; amount: number; hp: number }
| { type: 'hazardSpawned'; hazardId: number; kind: 'rot'; lane: number; x: number; radius: number; ticks: number }
| { type: 'hazardEnded'; hazardId: number }
| { type: 'abilityUsed'; unitId: number; ability: AbilityName; lane: number; x: number; targetId: number | null }
export type AbilityName = 'arm' | 'trigger' | 'fuse' | 'leap' | 'ignite' | 'grow' | 'lasso' | 'heal' | 'raise';
// unitDied.cause gains 'spent' (a mine or cherry that went off; pays no bounty)
// projectileHit gains `burning: boolean`; projectileSpawned gains `flight: Flight`, `targetX: number | null`

// balance.ts
export interface ShotStats { kind; damage; interval; range; speed;
  flight?: Flight;            // default 'straight'
  splash?: number;            // lobbed: radius hit at landing (0 = the target only)
  pierce?: number;            // piercing: units passed through
  status?: { kind: StatusKind; seconds: number; dps?: number; chance?: number; altKind?: ProjectileKind };
  puddle?: { seconds: number; radius: number; dps: number };
}
export interface UnitStats { /* plus */ holds?: boolean; holdRange?: number; }
export interface Balance { /* plus */ zombieBaseShotRange: number; } // 3.5: a zombie shoots the plant base only from this close, whatever its range

// status.ts
export function applyStatus(s: SimState, u: Unit, kind: StatusKind, ticks: number, dps: number, sourceId: number | null, events: SimEvent[]): void;
export function tickStatuses(s: SimState, b: Balance, events: SimEvent[]): void; // counts down, deals poison/burn once a second, emits statusEnded
export function canAct(u: Unit): boolean; // false while stunned or tied
```

**Rules to implement (each is one test):**

- [ ] `applyStatus` keeps the longer of the old and new duration and the larger dps; it emits `statusApplied` only when the status starts or is lengthened.
- [ ] A unit that cannot act does not move, bite, shoot, pay Sun or use an ability; its timers do not count down while it cannot act.
- [ ] A blind unit attacks on schedule but each attack emits `attackMissed` and deals nothing (no projectile).
- [ ] Poison and burn deal `dps` once every 30 ticks through `damageUnit`; armor does not reduce them; a unit killed by them dies with cause `'damage'` and pays bounty.
- [ ] Lobbed shot: aimed at the nearest enemy ahead in range; each tick `targetX` follows the target while it stands; it lands when its x reaches `targetX`, damaging the target (or, if it fell, any enemy within `hitRadius`) and every other enemy in the lane within `splash`. It ignores shields. With no target a plant's lobbed shot flies on to the zombie base like a pea.
- [ ] Piercing shot: damages each enemy it meets once, up to `pierce` units, then vanishes; `hitIds` prevents double hits.
- [ ] `status.chance` is rolled on the state rng at firing; on success the projectile's kind is `altKind` and it carries the status (Kernel-pult butter).
- [ ] `holds`: a zombie with a standing plant within `holdRange ?? shot.range` ahead does not advance (it is not `blocked`, so it still shoots).
- [ ] A zombie's shot targets the plant base only when `u.x <= min(shot.range, zombieBaseShotRange)`.
- [ ] `UNIT_INFO` is keyed by `CardKey`; `statsFor` accepts `UnitKey`. `PHASE1_CARDS` stays; add `ALL_CARDS: Record<Faction, CardKey[]>` (ten each, unlock order).
- [ ] Hash, snapshot and restore cover every new field and `hazards`; extend the hash-mutation table with them **and** the phase-1 gaps (`unit.id`, `projectile.id/faction/lane/speed`, `players.zombies.energy`, `baseMaxHp.plants`, `config.baseHp.zombies`, `config.startEnergy.plants`, `config.incomeMultiplier.plants`); make the key lists exhaustive at compile time (`satisfies Record<...>`); `restore` throws on a snapshot missing a top-level key.
- [ ] Review-focus 2: a 3-unit match with a lobbed shot in flight and a poisoned unit, snapshotted and restored at tick 40, reaches the same hash at tick 400 as the unbroken run.
- [ ] The golden hash of the phase-1 determinism test may change (new fields); re-pin it once, in this task only, and say so in the report.
- [ ] `npx tsc --noEmit && npx vitest run`; commit.

### Task 2: The seven new plants

**Files:** create `src/sim/abilities.ts`; modify `src/data/balance.ts`, `src/sim/{combat,match}.ts`; tests `tests/sim/plants.test.ts`.

**Interfaces — Produces:** `tickAbilities(s, b, events)` step stage, run after `tickAttacks` and before `tickProjectiles`. `UnitStats` gains:

```ts
mine?: { armSeconds: number; reach: number; damage: number; radius: number };
ignite?: { factor: number; burnDps: number; burnSeconds: number };
fuse?: { seconds: number; damage: number; radius: number };
leap?: { range: number; damage: number; radius: number; recoverSeconds: number };
```

**Starting numbers** (phase 3 tunes them; prices fixed):

| Unit | recharge s | hp | armor | Attack / ability |
|--|--|--|--|--|
| potatoMine | 20 | 150 | 0 | mine: arm 12 s, reach 0.6, damage 450, radius 0.75 |
| kernelPult | 5 | 300 | 0 | shot kernel lobbed: 12 dmg / 1.0 s, range 10, speed 7; status stun 2 s, chance 0.3, altKind butter |
| mangoPult | 7 | 300 | 0 | shot mango lobbed: 45 dmg / 3.0 s, range 10, speed 5, splash 0.75 |
| avocadoBunker | 20 | 2000 | 8 | none |
| torchwood | 10 | 500 | 0 | ignite: factor 2, burn 10 dps for 3 s |
| cherryBomber | 30 | 300 | 0 | fuse 1 s, damage 600, radius 1.6 |
| pumpkinSquash | 20 | 900 | 0 | leap: range 2, damage 350, radius 0.5, recover 6 s |

**Rules (one test each, exact values from the table):**

- [ ] Potato Mine: spawns with `abilityTimer = seconds(12)`; `abilityUsed 'arm'` when it reaches 0. Unarmed it is an ordinary plant zombies bite. Armed, the first tick a standing zombie is within 0.6 ahead in its lane it emits `abilityUsed 'trigger'` and `explosion`, deals 450 × special curve to every zombie within 0.75 (straight-line, lanes one apart), and dies with cause `'spent'`: no bounty to the zombies.
- [ ] A stunned or tied mine does not trigger; it triggers on the first tick it can act again (review-focus 1).
- [ ] Kernel-pult: over 1,000 shots with seed 1 between 270 and 330 are butter; butter stuns for 60 ticks; a kernel does not.
- [ ] Mango-pult: a mango landing on a zombie with two more within 0.75 damages all three; one at 0.8 is untouched.
- [ ] Avocado Bunker: a 40-damage bite takes 32; a 5-damage hit takes 1.
- [ ] Torchwood: a pea (kind `pea`, `straight`) whose x crosses a standing Torchwood's x in its lane becomes `burning`: its damage ×2 and on hit it applies burn 10 dps × special curve of the Torchwood's level for 90 ticks; emits `abilityUsed 'ignite'` once per pea. Lobbed shots and zombie shots are unaffected. A pea fired from in front of the Torchwood is unaffected. A burning pea blocked by a shield does nothing more than a plain one.
- [ ] Cherry Bomber: spawns with `abilityTimer = seconds(1)` and `abilityUsed 'fuse'`; at 0 it explodes for 600 × special curve within 1.6 and dies `'spent'`. Killed during the fuse it does not explode. Tied or stunned mid-fuse, the fuse pauses (review-focus 1).
- [ ] Pumpkin Squash: when ready and a zombie stands within 2 ahead, `abilityUsed 'leap'` with that target; every zombie within 0.5 of the target's x in the lane takes 350 × damage curve; `abilityTimer = seconds(6)`. The Pumpkin's own x does not change.
- [ ] Merging: mine, cherry and pumpkin merge like any plant; merging a Cherry mid-fuse does not restart the fuse.
- [ ] Snapshot/restore mid-fuse and with an armed mine reach the unbroken hash.
- [ ] Typecheck, full suite, commit.

### Task 3: The seven new zombies and the Bone Minion

**Files:** modify `src/sim/abilities.ts`, `src/data/balance.ts`, `src/sim/{combat,movement,match,economy}.ts`; tests `tests/sim/zombies.test.ts`.

**Interfaces — Produces:** `UnitStats` gains:

```ts
grow?: { hpShare: number; damageShare: number; maxStacks: number };
lasso?: { interval: number; range: number; seconds: number };
healAura?: { amount: number; interval: number; radius: number };
raise?: { key: 'boneMinion'; interval: number };
```

**Starting numbers:**

| Unit | recharge | hp | speed | melee dmg/interval | Shot / ability |
|--|--|--|--|--|--|
| desertZombie | 6 | 380 | 0.35 | 30 / 1.0 | sand straight: 10 / 2.5 s, range 4, speed 5; blind 3 s |
| skeletonArcher | 6 | 220 | 0.4 | 15 / 1.0 | arrow straight: 28 / 1.6 s, range 6, speed 8; holds |
| hotTopic | 6 | 300 | 0.5 | 25 / 0.5 | grow: hpShare 0.2, damageShare 0.2, maxStacks 5 |
| cowboyZombie | 10 | 450 | 0.35 | 30 / 1.0 | bullet straight: 22 / 1.5 s, range 4.5, speed 10; lasso every 9 s, range 5, tied 3 s |
| necromancer | 15 | 400 | 0.3 | 15 / 1.2 | holds, holdRange 4; healAura 40 every 2 s, radius 1.5; raise boneMinion every 10 s |
| tridentZombie | 12 | 500 | 0.2 | 40 / 1.2 | trident piercing: 70 / 3.5 s, range 10, speed 6, pierce 3 |
| brainRot | 15 | 450 | 0.25 | 20 / 1.2 | holds; rot lobbed: 30 / 4 s, range 6, speed 4; puddle 4 s, radius 0.75, 15 dps |
| boneMinion | – | 150 | 0.6 | 20 / 0.8 | none |

All melee reach 0.6. R18 stands: a `blocked` zombie bites and does not shoot.

**Rules (one test each):**

- [ ] Desert Zombie's sand blinds the plant it hits for 90 ticks; the blinded Peashooter's next shots are `attackMissed`.
- [ ] Skeleton Archer stops 6 tiles from the nearest plant ahead and shoots; when that plant falls it walks on.
- [ ] Hot Topic: each time its bite brings a plant to 0 hp it gains a stack (to 5): `maxHp` and `hp` rise by 20% of its level-scaled base hp, its bite by 20% of base; `abilityUsed 'grow'`. Stacks survive a merge.
- [ ] Cowboy: every 9 s, if a plant stands within 5 ahead, it ties the strongest (highest level, then highest `maxHp`, then lowest id) for 90 ticks; `abilityUsed 'lasso'` with `targetId`. With no plant in reach the timer stays at 0.
- [ ] Necromancer: holds 4 tiles from the nearest plant; every 2 s heals each other standing zombie within 1.5 (straight-line, lanes one apart) by 40 × special curve, never above `maxHp`, emitting `unitHealed` only for an actual gain; every 10 s raises a Bone Minion at its own x and lane, at its own level, `spent = 0`, `ownerId` set; `abilityUsed 'raise'`. At most 3 living minions per Necromancer (`Balance.minionCap = 3`).
- [ ] Bone Minion: pays no bounty, cannot be merged into (`'wrong-type'`), is not a card (`place` → `'not-in-hand'`). A minion outlives its Necromancer. A Necromancer that dies on the tick its raise is due raises nothing (review-focus 1).
- [ ] Trident: one throw damages the first three plants in the lane and not the fourth; from x > 3.5 it never targets the base.
- [ ] Brain Rot: the rot lands on its target, deals 30, and leaves a `Hazard` for 120 ticks; each tick a plant within 0.75 of it (same lane) has poison set to at least 30 ticks at 15 dps × special curve of the thrower's level. `hazardSpawned` / `hazardEnded`. A snapshot with a live puddle restores to the unbroken hash.
- [ ] Statuses cross sides: butter stuns a Necromancer (no heal, no raise, timers frozen); burn ticks on a Skeleton Warrior whose shield blocked nothing.
- [ ] Fuzz: 200 seeded matches with all 20 cards and random legal commands end without an exception, with whole-number energy, no unit above `maxHp`, no status below 0.
- [ ] Typecheck, full suite, commit.

### Task 4: Hero powers

**Files:** create `src/sim/hero.ts`; modify `src/sim/{types,match,hash,economy}.ts`, `src/data/balance.ts`, `src/app/BattleController.ts`; tests `tests/sim/hero.test.ts`, `tests/app/BattleController.test.ts`.

**Interfaces — Produces:**

```ts
// Command gains
| { type: 'hero'; faction: Faction; lane: number }
// CommandRejection gains 'hero-charging' | 'hero-off'
// PlayerState gains heroTimer: number  (ticks until ready)
// MatchConfig gains heroes: Record<Faction, boolean>   (defaultConfig: both true; the pinned classic helper: both false)
// Balance gains hero: Record<Faction, { damage: number; chargeSeconds: number; firstChargeSeconds: number }>
//   plants (Mega Mower): 400, 60, 45     zombies (Bone Storm): 250, 60, 45
// events
| { type: 'heroUsed'; faction: Faction; lane: number }
| { type: 'heroReady'; faction: Faction }
// BattleController
heroLane(lane: number): CommandRejection | 'ignored' | null;   // queues the command like click()
// HudSignals gains hero: Signal<{ ready: boolean; fraction: number }>   // fraction 0..1 charged
```

- [ ] The timer starts at `seconds(45)`, counts down in `tickEconomy`, emits `heroReady` once at 0, and resets to `seconds(60)` on use.
- [ ] Using it damages every standing enemy unit in the lane by the fixed amount through `damageUnit` with armor and shields ignored; it does not touch the base, projectiles or hazards. A 300-hp unit dies (cause `'damage'`, bounty paid); a 2000-hp Avocado survives with 1600.
- [ ] Rejections: `'hero-charging'` before ready, `'bad-lane'` outside 0–4, `'hero-off'` when the config disables it, `'match-over'` after the end.
- [ ] `heroTimer` and `config.heroes` are in hash, snapshot, restore.
- [ ] Controller: `heroLane` obeys pause/over like `click`; `hud.hero` updates only on change.
- [ ] Typecheck, full suite, commit.

### Task 5: Seeing it — projectiles, statuses, hazards, abilities

**Files:** modify `src/render/models/props.ts`, `src/render/battle/{BattleView,UnitView}.ts`, `src/render/fx/{Effects,fxPalette}.ts`, `src/render/voxel/types.ts`, the unit model files where a clip is missing, `tools/shots.mjs`, `src/scenes/*` (a `?scene=roster-demo`); create `src/render/battle/{StatusMarks,Hazards}.ts`; tests `tests/render/{BattleView,statusMarks,hazards,props}.test.ts`.

**Interfaces — Consumes:** every event from Tasks 1–3. **Produces:** `makeProjectile(kind)` for all ten kinds; `PROJECTILE_SIZE` for all ten (each ≥ 0.2); `ClipName` gains `'ability'`; `StatusMarks` (`set(unitId, status, on)`, `update(dt)`, `dispose()`) and `Hazards` (`add(event)`, `remove(id)`, `update(dt)`, `dispose()`), both owned by `BattleView`.

What a child must be able to read from the lawn camera (art bible §3 effects palette, §5 motion, §6 readability):

- [ ] Each projectile kind has its own boxy shape and colour: kernel (small yellow cube), butter (pale yellow slab), mango (large orange, tumbling), sand (tan puff trail), arrow (bone shaft), bullet (short iron streak), trident (three-pronged, purple), rot (green-black blob). Lobbed shots fly a stepped arc from muzzle to `targetX` whose height scales with distance; a burning pea turns orange with a fire trail and glows.
- [ ] Statuses: stun = three yellow voxel stars circling the head; blind = a tan sand block over the eyes; tied = a brown stepped rope ring round the body; poison = green bubbles rising and a green tint pulse; burn = orange flame voxels on the body. All from `statusApplied`/`statusEnded` and from state on late join; pooled, no per-frame allocation; none covers the health bar.
- [ ] `attackMissed`: a small grey "✕" block pops above the unit. `unitHealed`: green plus-blocks rise (`floatText` kept pixel-hard).
- [ ] Hazard: a stepped green puddle decal on the tile with slow bubbles, fading out over its last 0.5 s.
- [ ] Abilities play the model's `ability` clip where one exists (map the existing `leapSlam`, `mineTrigger`, `fuseSwell`, `lassoThrow`, `staffRaise`, `flameIdle`, `pultFling`, `bowDraw`, `pistolPop`, `shieldRaise` clips; add what is missing): mine pops up when armed and bursts with dirt; Cherry swells through its fuse then a big explosion with screen shake and 80 ms hit-stop; Pumpkin visibly leaps to the target tile and back; the lasso is a rope from Cowboy to plant for the tie's length; the Necromancer's raise bursts a gravestone and the minion claws up; heal shows a ring.
- [ ] Hot Topic grows visibly: +6% scale per stack and a brighter flame.
- [ ] `?scene=roster-demo&seed=N` runs a scripted match that shows every unit and ability within 60 s; `tools/shots.mjs` gains `roster-plants`, `roster-zombies`, `statuses`, `puddle`, `cherry-blast`. The implementer looks at every shot and fixes what does not read.
- [ ] Unit tests assert objects appear/disappear per event and pools return to size; typecheck; full suite; commit.

### Task 6: Hero power flourishes and sound for everything new

**Files:** create `src/render/battle/HeroFx.ts`, model(s) in `src/render/models/props.ts` (Mega Mower); modify `src/render/battle/BattleView.ts`, `src/app/BattleSession.ts`, `src/audio/{sfx,bindings}.ts`; tests `tests/render/heroFx.test.ts`, `tests/audio/audio.test.ts`.

**Interfaces — Consumes:** `heroUsed`, `heroReady`, all Task 1–3 events. **Produces:** `HeroFx.play(faction, lane): Promise<void>`; `SfxName` gains `'kernel' | 'butter' | 'mango' | 'sand' | 'arrow' | 'bullet' | 'trident' | 'rot' | 'stun' | 'blind' | 'lasso' | 'poison' | 'burn' | 'heal' | 'raise' | 'mineArm' | 'mineBoom' | 'fuse' | 'cherryBoom' | 'squash' | 'grow' | 'miss' | 'heroReady' | 'megaMower' | 'boneStorm'`.

- [ ] Mega Mower: a giant voxel mower (≤ 3,000 triangles) drives the lane left to right in 0.9 s throwing grass debris; zombies it passes flash as their damage shows; camera push-in on the lane, 90 ms hit-stop at the first hit, full-width boxy banner with Lukas's portrait for 0.6 s. Bone Storm: bones fall the length of the lane with stepped lightning bolts (emissive ≥ 1.5), Toby's portrait banner. The simulation's damage is instant; the view only staggers how it is shown and never delays input.
- [ ] Every new sound is synthesised in code like the existing recipes, short (< 0.6 s except the two hero sounds, < 1.5 s), panned by x, and rate-limited so 20 kernels a second do not stack into noise (reuse the existing voice cap). Poison/burn tick sounds play at most once a second in total.
- [ ] `heroReady` plays a clear two-note call for the owning player only.
- [ ] Tests: each new `SfxName` renders without throwing in the fake context and maps from its event; `HeroFx.play` resolves and leaves the scene as it found it.
- [ ] Typecheck, full suite, commit.

### Task 7: Ten cards and the hero button

**Files:** modify `src/ui/hud/CardTray.tsx`, `src/ui/screens/BattleScreen.tsx`, `src/app/{BattleController,BattleSession,input}.ts`, `src/render/portraits.ts`, CSS; create `src/ui/hud/HeroButton.tsx`; tests `tests/ui/{CardTray,HeroButton,BattleScreen}.test.tsx`, `tests/app/*`, `e2e/roster.spec.ts`.

- [ ] A battle deals all ten cards of the player's side (`ALL_CARDS`); the computer gets all ten of its side.
- [ ] Tray: ten cards in one row at ≥ 1280 px wide; at 1024×768 two rows of five, each card ≥ 64×80 CSS px with ≥ 44 pt hit area, inside the safe area, never covering lanes 0–4. Portraits come from the 3D models as now. Hotkeys 1–0 unchanged.
- [ ] Hero button: a large square with the boy's portrait, a stepped (not smooth) radial fill while charging, a pulsing boxy frame and the `heroReady` sound when ready. Tap it, then tap any tile of a lane: the lane highlights on hover/touch and the power fires on release; tapping the button again cancels. Key `H` is an extra. Selecting the hero clears the card and shovel, and the other way round.
- [ ] `BattleInput`/`InputTarget` route a lawn tap to `heroLane` while the hero is selected.
- [ ] e2e (desktop and ipad projects): all ten cards visible and tappable; place one of each plant by tap; fire the hero by tap after fast-forwarding 45 s and see `heroUsed`; no card or button overlaps another (bounding boxes) at 1024×768, 1180×820, 1440×900.
- [ ] Typecheck, unit suite, e2e, commit.

### Task 8: Computer players and fairness with 20 units

**Files:** modify `src/ai/*`, `src/data/balance.ts`, `tools/{tune,sim-smoke}.ts`; tests `tests/ai/*`.

The aim is a fair, playable game, not final balance (phase 3). Change numbers in `Balance` and the strategies; never prices.

- [ ] Both strategies use every card and the hero power for a reason: plants wall lanes under pressure (Walnut/Avocado), mine and cherry the heaviest stack, put a Torchwood ahead of Peashooters, squash/pult where zombies cluster; zombies answer what they see (Archer/Brain Rot/Trident against deep rows, Hot Topic against thin lanes, Cowboy against a high-level plant, Necromancer behind a tank), and each fires its hero at the lane where it does most damage. Skill tables still scale mistakes and reaction time.
- [ ] Stand-ins extended: random child and attentive player use all ten cards; a new "newest-card child" always buys the most expensive affordable card (review-focus 5).
- [ ] Bands, 200 seeds unless stated, measured with the full roster and heroes on:

| Check | Band |
|--|--|
| Medium v Medium, plants win | 40–60% |
| Hard beats Easy, either side | ≥ 80% |
| Any single card spammed (or merge-spammed) v Medium, all 20 | ≤ 60% |
| Each card's pick share by the Hard computer across matches | ≥ 3% (no dead card) |
| Random child, Easy / Medium / Hard, each side | 55–85 / 15–45 / < 15% |
| Newest-card child v Easy, each side | 25–85% |
| Median match length; share reaching sudden death | 3–6 min; < 25% |
| Merge value (level N v N singles), every unit that fights | 0.95–1.25 |

- [ ] Toby's Easy with a slow tapper (parked R50): the random child tapping once every 6 s wins ≥ 45% on Easy as either side. Reach it by making Easy more forgiving (the computer's idle time, the child's income), not by breaking the bands above.
- [ ] Tests assert these bands on seeds 1..N with no cherry-picking; report the numbers on a second seed block (1001–1200) too.
- [ ] Typecheck, full suite (the long balance tests may be tagged and run with `npx vitest run tests/ai`), commit.

### Task 9: Proof

**Files:** modify `e2e/*`, `tools/{perf,shots}.mjs`, `src/render/voxel/{build,rig}.ts`, `src/app/debug.ts`, `README.md`.

- [ ] Perf (review-focus 4): `tools/perf.mjs` gains a mixed-roster stress scene — 150 units of all 21 kinds, 40 projectiles, 6 puddles, statuses on a third of units — and prints the unthrottled frame cost; it must hold DPR 1 ≤ 10 ms and DPR 2 ≤ 16.6 ms on the M3. If not, fix the cause (pool, merge static parts) in this task.
- [ ] e2e: a full match as each side on both projects ends with a result screen and no console error; the roster demo runs 60 s with no error and one WebGL context.
- [ ] `singleLevel` is enforced in `build.ts`/`rig.ts` (parked from phase 1) with a test.
- [ ] `window.__lvt` is present only in dev builds or with `?debug` (parked); e2e uses `?debug`.
- [ ] README lists the 20 units, statuses, hero powers and how to run the demos.
- [ ] Full unit suite ×2 and e2e ×2 clean; commit.

## Order and parallel work

Tasks 1 → 2 → 3 → 4 are sequential (same files). Once Task 4 is reviewed, Tasks 5+6 (render/audio, one worktree `…-rebuild-art`) and Task 7 (UI, main worktree) may run in parallel and are merged before Task 8. Task 8 then Task 9, then the whole-branch review (Opus).
