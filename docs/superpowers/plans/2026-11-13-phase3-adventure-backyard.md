# Phase 3 — Adventure, part 1: the engine and the Backyard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable Adventure: a map, levels of five kinds, stars and coins, unit unlocks, a tutorial, two bosses and Free Play — with the whole first world (the Backyard: 8 plant levels and 8 zombie levels) finished and measured.

**Architecture:** A level is data (`LevelDef`): its kind, cards, opponent, scripted waves, prepared units and rewards. The simulation gains level modes (scripted waves, a clock goal, a card belt, a boss) as deterministic state driven by `MatchConfig`, so levels replay, test and balance exactly like matches. A pure `adventure` layer turns results into stars, coins and unlocks on the player's save. Screens (map, level card, result) are picture-first Preact over the shared stage. Worlds 2–5 are content plans that follow; nothing here is specific to the Backyard except the level files.

**Tech Stack:** as phases 1–4a. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-11-3d-rebuild-design.md` sections 7, 8, 9, 10 (campaign checks), 18 (ages), 19 (iPad), 20 (players). Naming: Michal counts this as "phase III"; in the spec's delivery list it is phase 4 (Adventure), with the rest of phase 3 (the level-by-level balance checks) folded in.

## Global Constraints

Everything in `.superpowers/sdd/2026-11-12-phase2-full-roster/parallel-rules.md` and `phase1-global-constraints.md` binds (determinism, hash coverage for every state field, all numbers in `Balance` or level data, boxy look, touch-first, no reading needed, browser lock, no formatters). In addition:

- Level ids are `<side letter><world>-<n>`: `p1-1` … `p1-8` (plants, Backyard), `z1-1` … `z1-8` (zombies, Backyard). Ids start with a letter (the save format requires it).
- The plant campaign visits Backyard → Moonlit Meadow → Desert Canyon → Frozen Tundra → Dark Citadel; the zombie campaign the same worlds in reverse, so the zombies' world 1 is the Dark Citadel in story order — **but for this part both sides play their eight levels on the Backyard arena**, and the zombie levels are numbered `z1-*`. Later world plans move them.
- Stars: 1 for winning, 2 with the player's base at or above 50% health, 3 at or above 80%. A level kind with no player base (Breakthrough) uses time left: 2 stars with ≥ 25% of the clock left, 3 with ≥ 50%.
- Coins: 30 per star the first time that star is earned on a level; replaying a level already at that star count pays 10 for a win; a loss pays 5.
- Unit unlocks: each side starts Adventure with its first three cards; level 3 and level 6 of the Backyard each unlock the next card in spec 6.6's order (so four and five cards). Quick Battle keeps all ten cards for everyone (it is the sandbox); Adventure levels deal only what the level lists and the player has unlocked.
- A level never needs Marketplace upgrades: the expert stand-in must win it at upgrade 0.
- Adventure difficulty per player and side (the save's `difficulty`): Easy and Hard change only the player's income, by +25% and −25%; Normal is the level as designed. Toby's saves start on Easy.
- Heroes are on in every level; spells are dealt (two per side) from level 4 on; levels 1–3 have none, so the first screens stay simple.
- Nothing here touches the database rules; the save shape (`SideProgress.stars`, `unlocked`, `bestWave`) already exists.

## Review Focus

1. A level that cannot be finished or cannot be lost (a scripted wave that never arrives, a Survive clock that stops, a boss stuck in a shield phase): every level ends within its time limit plus sudden death, on every seed. Tests in Tasks 2, 3 and 8.
2. Restoring a snapshot mid-level (mid-wave, a card on the belt, a boss mid-pattern) continues to the same hash. Tests in Tasks 2 and 3.
3. A five-year-old on the map: he can find his next level, start it, and understand "won / lost / stars" with no words. Test in Task 4 (and the tutorial in Task 6).
4. Losing progress: a result must be saved exactly once even if the page reloads on the result screen or the connection drops; stars never go down. Tests in Tasks 1 and 5.
5. Difficulty curve: no level is harder than the one two after it; the beginner on Easy wins each Backyard level at least 70% of the time. Test in Task 8.

## File map

- `src/adventure/{types,campaign,rewards,levels/backyard}.ts` — level format, progression, the 16 level files' data.
- `src/sim/{types,match,script,belt,boss,hash}.ts`, `src/data/balance.ts` — level modes in the simulation.
- `src/render/models/bosses/*.ts`, `src/render/battle/*` — boss models and views.
- `src/ui/screens/{Map,LevelCard,PlayMenu,FreePlay}.tsx`, `src/ui/hud/{WaveBar,Belt,BossBar,Hand}.tsx`, `src/app/{levelSession,tutorial}.ts`.
- `src/ai/{levelStandIns,levelChecks}.ts`, `tools/levels.ts`.

---

### Task 1: Level format and campaign progress

**Files:** create `src/adventure/{types,campaign,rewards}.ts`; tests `tests/adventure/*.test.ts`.

**Interfaces — Produces:**

```ts
export type LevelKind = 'battle' | 'survive' | 'breakthrough' | 'conveyor' | 'boss';
export interface Spawn { at: number; unit: UnitKey; lane: number; level?: number; col?: number } // at = seconds; col only for prepared plants
export interface LevelDef {
  id: string; side: Faction; world: 1 | 2 | 3 | 4 | 5; n: number; kind: LevelKind;
  cards: CardKey[];                    // what the player may hold in this level (before unlock filtering)
  opponent: { skill: Skill; cards: CardKey[]; incomeScale: number } | null; // a computer player, or null when the level is scripted only
  waves: Spawn[];                      // scripted enemy arrivals (survive, conveyor, boss adds; may be empty)
  prepared: Spawn[];                   // units standing at the start (the garden to break through; a head start)
  seconds: number | null;              // the clock for survive / breakthrough; null otherwise
  belt: { everySeconds: number; cards: CardKey[] } | null; // conveyor only
  boss: { key: BossKey; lane: number } | null;
  startEnergy: number | null;          // null = the balance default
  spells: boolean; unlocks: CardKey | null; teaches: TutorialStep[] | null;
}
export function levelConfig(def: LevelDef, save: Save, seed: number, b?: Balance): MatchConfig; // applies unlocks, upgrades (player's side), difficulty income
export function starsFor(def: LevelDef, result: { won: boolean; baseHpShare: number; clockShareLeft: number }): 0 | 1 | 2 | 3;
export function applyLevelResult(save: Save, def: LevelDef, stars: 0 | 1 | 2 | 3, now: number): { save: Save; coins: number; newStars: number; unlocked: CardKey | null };
export function nextLevel(save: Save, side: Faction, levels: readonly LevelDef[]): LevelDef | null; // first level without a star; a level is open when the one before has ≥ 1 star
export function isOpen(save: Save, def: LevelDef, levels: readonly LevelDef[]): boolean;
export function unlockedCards(save: Save, side: Faction): CardKey[]; // always includes the first three
```

- [ ] Tests first, exact values: stars at 49.9% / 50% / 79.9% / 80% base health; the Breakthrough clock variant; first-time coins 30/60/90, replay 10, loss 5; stars never decrease; a second 3-star win pays 10 and changes nothing else; unlock granted once; `isOpen` chain; `levelConfig` deals `def.cards ∩ unlocked`, the player's upgrades only on their side, Easy ×1.25 / Hard ×0.75 income; `applyLevelResult` is idempotent for the same battle id (pass `battleId`, remembered in the save's `lastBattle` — add that field to `Save` with `parseSave`, merge = newer) (review-focus 4).
- [ ] Implement; `npx tsc --noEmit && npx vitest run tests/adventure tests/progress`; commit.

### Task 2: Level modes in the simulation

**Files:** modify `src/sim/{types,match,hash,economy}.ts`, `src/data/balance.ts`; create `src/sim/{script,belt}.ts`; tests `tests/sim/{script,belt,modes}.test.ts`.

**Interfaces — Produces:**

```ts
// MatchConfig gains
mode: 'battle' | 'survive' | 'breakthrough' | 'conveyor' | 'boss';   // default 'battle'
script: { tick: number; unit: UnitKey; faction: Faction; lane: number; x: number; level: number }[]; // sorted by tick; default []
prepared: { unit: UnitKey; faction: Faction; lane: number; x: number; level: number }[];              // spawned at tick 0
goalTicks: number | null;        // survive: plants win when tick reaches it; breakthrough: plants win when tick reaches it (the zombies ran out of time)
belt: { everyTicks: number; cards: CardKey[]; slots: number } | null;  // conveyor; cards drawn with the state rng
noEnergy: boolean;               // conveyor: no trickle, no bounty, no Sun; placing a belt card costs nothing
invulnerableBase: Faction | null; // survive and conveyor: the zombie base cannot be hurt
// SimState gains
scriptIndex: number; belt: CardKey[];   // the cards waiting on the belt, oldest first
// Command gains  | { type: 'belt'; faction: Faction; slot: number; lane: number; col: number }
// events  | { type: 'waveSpawned'; index: number; unit: UnitKey; lane: number } | { type: 'beltCard'; card: CardKey } | { type: 'beltUsed'; slot: number } | { type: 'goalReached'; winner: Faction }
```

- [ ] `tickScript` (first stage of a step): spawns every script entry whose tick has come, in order, emitting `waveSpawned`; scripted and prepared units pay bounty like any unit and have `spent` = their card price × level (0 for non-cards).
- [ ] `goalTicks`: at that tick the match ends with the mode's winner (`goalReached`, `matchEnded`); sudden death is off in survive, breakthrough and conveyor; a base at zero still ends the match first.
- [ ] Belt: every `everyTicks` a card drawn with the state rng joins the belt if fewer than `slots` (5) wait; `belt` command places slot `i`'s card for free (plants: on a tile; a wrong tile is rejected and the card stays), merging by the usual rule; with `noEnergy`, `place` and `merge` commands are rejected `'no-energy'`.
- [ ] Every new field in hash/snapshot/restore with mutation rows; one golden re-pin allowed; the classic helper pins `mode: 'battle'` and empties; snapshot mid-wave and with cards on the belt reaches the unbroken hash (review-focus 2).
- [ ] Fuzz: 100 seeds per mode with random legal commands end by a winner within `goalTicks` or, for battle and boss, by sudden death (review-focus 1).
- [ ] Typecheck, full suite, commit.

### Task 3: Bosses

**Files:** create `src/sim/boss.ts`, `src/render/models/bosses/{brainTitan,elderOak}.ts`; modify `src/sim/{types,match,hash,abilities}.ts`, `src/data/balance.ts`, `src/render/battle/{BattleView,UnitView}.ts`, `src/audio/{sfx,bindings}.ts`; tests `tests/sim/boss.test.ts`, `tests/render/bosses.test.ts`.

**Interfaces — Produces:** `BossKey = 'brainTitan' | 'elderOak'` (added to `UnitKey`, never cards); `Balance.bosses: Record<BossKey, { hp: number; speed: number; patterns: BossPattern[] }>`; `BossPattern = { kind: 'slam' | 'summon' | 'barrage' | 'shield'; everySeconds: number; … }`; `Unit.pattern: number`, `Unit.patternTimer: number`, `Unit.shieldLeft: number`; events `bossPattern { unitId, kind, lane }`, `bossPhase { unitId, phase }`.

- [ ] Brain Titan (ends the plants' Backyard, level `p1-8`): an oversized Brain Eater (model: the biped rig at 2.4× with a crown of brains, ≤ 6,000 triangles) that walks its lane slowly; patterns in rotation: **slam** (every 12 s: the plant in front of it and its lane neighbours take heavy damage, with a 1.5 s wind-up the player can see), **summon** (every 18 s: three Very Fast Walkers in random lanes), **shield** (at 66% and 33% health: 6 s during which straight shots bounce off — lobbed shots, blasts, the hero and spells still hurt). It bites the base like any zombie. Killing it wins the level at once.
- [ ] Elder Oak (ends the zombies' Backyard, `z1-8`): an oversized walnut-tree plant standing in front of the plant base across lanes 1–3 (model from the plant kit, ≤ 6,000 triangles); patterns: **barrage** (every 10 s: acorns lobbed into three random lanes, splash), **summon** (every 20 s: two Peashooters on free tiles), **shield** (at 50%: 8 s of bark armour halving all damage). While it stands the plant base cannot be hurt; destroying it wins the level.
- [ ] Sim rules deterministic (pattern order fixed, random lanes from the state rng), all numbers in `Balance.bosses`, hashed, snapshot mid-pattern restores (review-focus 2); a boss can be stunned for at most 1 s per stun and cannot be tied, blinded or lassoed; hero and blast damage to a boss is capped at 10% of its max health per hit.
- [ ] View: boss model with its wind-up tells (the slam arm rises; acorns arc with shadows), a wide boss health bar at the top of the HUD with phase notches (`src/ui/hud/BossBar.tsx`), camera shake on slam, a boss entrance (1.5 s, skippable by tap) and a defeat show; two new sounds per boss. Screenshots: entrance, wind-up, shield, defeat — look at each.
- [ ] No level can soft-lock on a shield (review-focus 1): a test runs each boss level 50 seeds with an idle player and with a strong scripted player and both end.
- [ ] Typecheck, full suite, commit.

### Task 4: Play menu, map and level card

**Files:** create `src/ui/screens/{PlayMenu,Map,LevelCard}.tsx`, CSS, `src/scenes/mapStage.ts`; modify `src/app/store.ts`, `src/ui/screens/Home.tsx`, `src/ui/App.tsx`; tests `tests/ui/{PlayMenu,Map,LevelCard}.test.tsx`, `e2e/adventure.spec.ts`.

- [ ] Home's play button opens the Play menu: three big picture buttons — Adventure (a path with a flag), Quick Battle (crossed swords with a robot), Free Play (a wave) — then, for Adventure and Free Play, the side (the two boys' portraits with their unit behind).
- [ ] Map: the Backyard as a winding stepping-stone path of eight level stones over the shared 3D stage (the island seen from higher up); each stone shows its number, 0–3 stars, a picture for its kind (swords, shield-and-clock, hammer-and-clock, belt, skull-crown), a padlock when closed, and the next level bounces with the player's picture standing on it. The four later worlds appear as greyed islands with padlocks. A stone with an unlock shows the unit's silhouette above it until won.
- [ ] Tapping an open stone shows the level card: the kind's picture, the cards to be dealt (portraits), the enemy's pictures, the stars to win as three empty stars with their conditions drawn (a base at half / nearly full; or a clock), a big play button and a difficulty row (three faces: easy, normal, hard — the player's saved choice ringed; changing it saves).
- [ ] Everything by tap, targets ≥ 44 pt at 1024×650, no text needed (review-focus 3); the logged-in player's frame colour on their marker.
- [ ] Tests for states (closed, open, done with stars, next); e2e on both projects: from Home reach the map, open `p1-1`, see its card, start it.
- [ ] Commit.

### Task 5: Playing a level

**Files:** create `src/app/levelSession.ts`, `src/ui/hud/{WaveBar,Belt,BossBar,ClockGoal}.tsx`; modify `src/app/{BattleController,BattleSession,game}.tsx`, `src/ui/screens/BattleScreen.tsx`, `src/ui/hud/ResultOverlay.tsx`; tests `tests/app/levelSession.test.ts`, `tests/ui/*`, `e2e/adventure.spec.ts`.

- [ ] `BattleController` accepts a `LevelDef` + save (through `levelConfig`): opponent computer or none; HUD additions by mode — Survive/Breakthrough: a clock goal bar (time left, with star marks for Breakthrough); scripted waves: a wave bar with flags for big waves; Conveyor: the belt replaces the card tray (cards slide in from the right, tap a card then a tile, or drag; no prices); Boss: the boss bar.
- [ ] Result: win/lose show, then 0–3 stars popping in one by one with sound, the coins earned, any unlocked unit revealed on a turntable ("new!" as a burst, no words), and buttons by picture: next level, replay, map. `applyLevelResult` runs exactly once per battle through `session.update` with a battle id, also if the page reloads on the result screen (the pending result is kept on the device until applied) (review-focus 4).
- [ ] Pause menu in a level adds "map" (two-tap confirm). Quit counts as nothing (no coins, no loss reward).
- [ ] A guest (no player) can play level `p1-1`/`z1-1` only; the map shows a picture inviting to pick a player.
- [ ] Unit tests; e2e: win `p1-1` by fast-forward with a forced result → stars and coins → map shows the stars and `p1-2` open → reload → still there.
- [ ] Commit.

### Task 6: Tutorial

**Files:** create `src/app/tutorial.ts`, `src/ui/hud/PointingHand.tsx`; modify `src/app/levelSession.ts`; tests `tests/app/tutorial.test.ts`, e2e in `adventure.spec.ts`.

- [ ] `TutorialStep = { show: 'card' | 'tile' | 'unit' | 'hero' | 'spell'; target: …; until: 'selected' | 'placed' | 'merged' | 'fired' }`. A boxy white glove points and taps at the target, the rest of the screen dims slightly, the simulation holds (paused, no enemy progress) while a step waits, and the step ends on the player's own action — never on a timer, never with text.
- [ ] `p1-1`: pick the Peashooter card → place it on the marked tile → a single slow zombie comes; `p1-2`: place a Sunflower, collect the idea of Sun (the counter pulses when it pays), then a Peashooter; `p1-3`: merge a Peashooter (the level-up arrow is pointed at). `z1-1`: pick Brain Eater → tap a lane; `z1-2`: two lanes, a Walker; `z1-3`: merge. The hero is introduced on level 2 of each side (the glove points at the portrait when it first becomes ready), spells on level 4.
- [ ] A step that has been done once for that player is not shown again (kept in the save: `teached: string[]`, added to `Save`/`parseSave`/merge as a union); a replay can be forced from the level card (a small glove button).
- [ ] Tests: the sim does not advance while a step waits; wrong taps are ignored without a buzz; e2e completes `p1-1` by following the glove with taps only (review-focus 3).
- [ ] Commit.

### Task 7: Free Play

**Files:** create `src/adventure/freePlay.ts`, `src/ui/screens/FreePlay.tsx`; modify `src/app/levelSession.ts`, `src/ui/hud/WaveBar.tsx`; tests `tests/adventure/freePlay.test.ts`, e2e.

- [ ] `freePlayWave(side, wave, seed): Spawn[]` — endless escalating waves generated from the seed: wave `w` has a budget of `100 + 60·w` energy of enemy units at levels rising with `w`, drawn from the cards the player has met; 20 s between waves; a boss-size unit every tenth wave. Plants defend (survive rules, no clock); as zombies the player breaks ever-stronger prepared gardens against a clock that refills by 30 s per garden broken.
- [ ] The wave number is shown as a flag count; the best wave is saved (`bestWave`, max) and feeds the leaderboard's wave table; coins: 5 per wave cleared.
- [ ] Deterministic and tested for 50 waves on 20 seeds (no empty wave, budget respected, ends when the base falls).
- [ ] Commit.

### Task 8: The Backyard's sixteen levels, measured

**Files:** create `src/adventure/levels/backyard.ts`, `src/ai/{levelStandIns,levelChecks}.ts`, `tools/levels.ts`; tests `tests/adventure/backyard.test.ts`, `tests/ai/long/levels.test.ts`.

The design brief for each side's eight levels (the implementer writes the data and tunes it with the tool):

| n | Plants (`p1-n`) | Zombies (`z1-n`) |
|--|--|--|
| 1 | Battle, tutorial: Peashooter only, one lane used, a trickle of Brain Eaters | Battle, tutorial: Brain Eater only against two Peashooters |
| 2 | Battle: + Sunflower; teaches Sun; the hero appears | Battle: + Very Fast Walker; the hero appears |
| 3 | Survive 90 s: + Walnut Bomb, three lanes of waves — **unlocks Potato Mine** | Breakthrough 120 s: crack a small prepared garden — **unlocks Desert Zombie** |
| 4 | Battle v Easy computer, four cards, spells start | Battle v Easy computer, four cards, spells start |
| 5 | Conveyor: Peashooters, Walnuts and Mines on the belt against scripted waves | Conveyor: a belt of zombies against a prepared garden that regrows |
| 6 | Survive 150 s with a flag wave of Skeleton Warriors — **unlocks Kernel-pult** | Breakthrough 150 s through Walnut walls — **unlocks Skeleton Archer** |
| 7 | Battle v Medium computer, five cards | Battle v Medium computer, five cards |
| 8 | Boss: the Brain Titan | Boss: the Elder Oak |

- [ ] Stand-ins that play levels: **beginner** (models Toby: slow random taps, presses every glowing button, on Easy), **average** (models Lukas: sensible, a little slow, on Normal, buys upgrades as the level rewards allow), **expert** (a Hard-skill computer on Normal, upgrade 0).
- [ ] `tools/levels.ts` runs every level × stand-in on N seeds (3 workers) and prints win rate, median stars, median length.
- [ ] Bands on 200 seeds, two blocks: expert ≥ 95% on every level; average 80–97% on every level with a falling trend from level 1 to 8 (level 8 at 80–88%); beginner on Easy ≥ 70% on every level; no level harder for the average player than the level two after it (review-focus 5); median length 1.5–4 min (boss up to 5); every level ends on every seed (review-focus 1); 3 stars reachable by the expert on ≥ 50% of seeds, and by the average player on ≥ 20%.
- [ ] Known misses are recorded honestly (`it.fails` with reasons), not hidden. No prices change. Level data is plain and readable; a short comment per level says what it is meant to teach or test.
- [ ] Commit.

### Task 9: Proof

- [ ] e2e on both projects: a new player walks `p1-1` → `p1-3` (forced results), sees an unlock, the map and the level card at 1024×704; a boss level starts and ends; Free Play reaches wave 3; no console error; one WebGL context throughout.
- [ ] Perf: the boss levels and a wave-20 Free Play scene hold phase 2's budget on the M3; say again that the iPad is unmeasured.
- [ ] README: Adventure, level kinds, stars, coins, Free Play.
- [ ] Full unit suite ×2, e2e ×2; commit.

## Order and parallel work

Tasks 1 and 2 are independent (run in parallel worktrees). Task 3 needs 2. Task 4 needs 1. Task 5 needs 1, 2, 4. Tasks 6 and 7 need 5. Task 8 needs 1–3 (not the screens) and can run beside 4–7. Task 9 last, then the whole-branch review (Opus).
