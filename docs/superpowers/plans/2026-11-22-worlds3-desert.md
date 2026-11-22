# Campaign Step 3 (Desert Canyon, both sides) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** World 3 of each campaign, playable: plant levels p3-1..8 and zombie levels z3-1..8 in the Desert Canyon (rocks), ending at the Sand Pharaoh (plants fight it) and the Cactus King (zombies fight it), with Torchwood (p3-3), Cherry Bomber (p3-6), Necromancer (z3-3) and Trident Zombie (z3-6) unlocked, a no-text rocks lesson on each side and glove lessons for the four new cards.

**Architecture:** Content on the shipped machinery, as step 2. Levels are data files `p3.ts`/`z3.ts` beside `p2.ts`/`z2.ts`; each boss is a `Balance.bosses` row with `phases` and `strike`, one `BOSS_LOOK` row and one model. The tutorial gains a `'rocks'` twist pan and an `after: 'foe'` wait. The band harness gets one gate function for worlds 2–5 and the zombie beginner floor; the sim rules do not change.

**Tech Stack:** Vite, TypeScript strict, Three.js 0.187, Preact + signals, Vitest 5, Playwright 1.64, tsx.

**Spec:** `docs/superpowers/specs/2026-11-22-worlds-3-5-content.md` — §1 "Step 3" tables (levels), §2 Sand Pharaoh / Cactus King column (bosses), §3 (lessons, rocks pan, `after: 'foe'`), §4 (bands, i 17–24 rows, §4.1 pilots), §5 "Needed, Step 3", §6 "Step 3 in detail" (task basis and commands), §7 (risks and defaults). Authority: `docs/superpowers/specs/2026-11-11-3d-rebuild-design.md` (§6.6, §8, §10, §18). Every implementer reads the sections named in their task first. The content design's tables are this plan's exact values; they are not repeated here.

## Global Constraints

- Players are 8 and almost 5; the younger cannot read. Pictures only, touch-first, iPad Safari landscape, Minecraft look. Do not restyle what is built.
- Kid rules: every tap target ≥ 64 px on a 1024×768 iPad; a picture with every word (no text-only cue); every refusal buzzes (a tap on a rock buzzes, shakes and places nothing).
- The sim rules do not change. Golden hash 3452586360, `tests/sim/determinism.test.ts` and `tests/sim/noTwistReplay.test.ts` stay green and untouched, and every existing Adventure outcome of worlds 1–2 (levels, stand-in results, `KNOWN_MISSES` for p1/z1/p2/z2) stays as it is, unless a task explicitly says so. New `BossKey`s extend tables only.
- No unit, hero, spell, Quick Battle, world-1 or world-2 number changes. Tunable here: the 16 new levels and `Balance.bosses.sandPharaoh|cactusKing` only.
- Zombie levels are Toby's: 2–3 minutes, forgiving; the beginner on Easy wins ≥ 60% on z3 (content design §4).
- Each boss model ≤ 6,000 triangles. 16.6 ms p95 at DPR 2 on the M3 for both boss fights with dust and rocks.
- A lesson can never freeze: a twist pan ends on any tap, the "tap" glove shows after `TWIST_HINT_SECONDS` (3); an `after: 'foe'` step holds nothing until it arms; glove tiles are validated with `match.check` and are free of rocks.
- Bands are not loosened; a miss is recorded in `KNOWN_MISSES` (`it.fails`) with its numbers.
- No network requests to Firebase from tests or tools; every e2e/tool URL carries `cloud=fake`. No deploys by agents.
- No database rules change is expected. If one turns out to be needed: rules come from `tools/build-rules.mjs` only, `database.rules.json` regenerated, v2 and v2test stay mirrored, `node tools/build-rules.mjs --check` exits 0.
- Browser work (e2e, screenshots, perf): only with the lid open (`ioreg -r -k AppleClamshellState` says `No`), under `caffeinate -i`, holding `/tmp/lvt-browser.lock` (batches under 5 minutes); look at every screenshot taken. Versus specs run on the `ipad` project only.
- At most one tuning run at a time (`tools/levels.ts`, `tools/probe-gap.ts`, `LVT_BALANCE=1` suites), ≤ 3 workers.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No formatters, no `git stash`, no `pkill`.

## Rulings made while planning

1. **One gate for worlds 2–5.** `worldTwoGate` becomes `levelGate(def: Pick<LevelDef, 'side' | 'world' | 'n' | 'kind'>): LevelGate` (`'win' | 'stars' | 'boss'`). World 2 returns exactly what `worldTwoGate` returns today (z2-1..4 `'win'`). Worlds 3–5: plants `'win'` on all eight (the p3-8 boss on `averageWinBand(i, true)`, 5 lower), zombies `'stars'` on n 1–7 and `'boss'` on n 8. The spec's "bosses: boss band" is read as: plant boss = boss win band, zombie boss = `bossStarBand(world)`.
2. **`bossStarBand(world: 1|2|3|4|5): { lo; hi }`** returns 35–60 for worlds 1–2 (today's `BOSS_THREE_STARS`, kept as an alias), 38–58, 29–49, 20–40.
3. **`beginnerWinMin(i: number, side: Faction): number | null`**: 70 for i ≤ 16 (both sides, as today), then zombies 60 for i 17–24 and 50 for i 25–40, plants `null`. Existing callers pass the side.
4. **Length gate stays 1.5–4 min** (boss 5) in the band tests; Toby's "2–3 min" is the tuning target for z3, recorded, not a gate.
5. **Rock coordinates.** T1 adds `rocks(tiles: [number, number][]): number[]` to `helpers.ts` (`lane * PLANT_COLS + col`), so T6 and T7 never touch `helpers.ts`.
6. **The foe wait** (`after: 'foe'`, plant-side `tile` steps only in this step): the step is met while an enemy unit (not `rock`, not a Bone Minion's corpse; a boss counts) stands in the step's lane with `0 ≤ x − (col + 0.5) ≤ 2` for plants (mirrored, `0 ≤ (col + 0.5) − x ≤ 2`, for zombies). Met, it arms like any step (glove, hold, `MISSING_HOLD_SECONDS` if its action stops being possible). If the foe leaves the window or dies before the step arms, the step waits again. There is no clock-based skip: a foe step that never arms simply never shows and holds nothing, which is the spec's "skipped silently" (§7 risk 5).
7. **`twistShown`** returns `'rocks'` for a twist step on a lawn whose only twist is rocks; fog and ice keep precedence as today.
8. **Rocks pan on a zombie level** shows the same boulders in the computer's garden; the zombie ghost walks over first, then the Peashooter ghost bounces off (spec §3 "ghost order reversed").
9. **`summonLook`.** `BossLook.fx.pups?: boolean` becomes `summonLook?: 'pups' | 'mummies'`; the Moon Howler row becomes `summonLook: 'pups'` and its demo frames stay pixel-identical. The mummies are a view of level-2 Skeleton Warriors; the sim summons plain `skeletonWarrior` level 2.
10. **T3's tests run on injected levels** (as step-2 Task 3 did) until T6/T7 land; the rock-free glove-tile check for the real levels lives in `p3.test.ts`/`z3.test.ts`.

## Review Focus

1. A tap on a rock — during the pan's end, during a glove step, or in free play — buzzes, shakes and places nothing, and no glove ever points at a rock — T6 and T7 tests (`match.check` on every glove tile; rock tap refused), T9 e2e.
2. The Cherry lesson never freezes: the 40 s clump killed early by a mine, the foe dying after the step armed, the match ending before the step arms, Pause and HELP replay during the wait — T3 tests.
3. A save from before this plan with p2-8 / z2-8 done opens world 3 on the map and nothing else changes; a save with p2-7 done does not; the four unlocks land after p3-3, p3-6, z3-3, z3-6 and nowhere else — T1 test (injected lists), T9 e2e.
4. The bosses over rocks: the Cactus King's summoned Kernel-pults and Walnuts never land on a rock; the Pharaoh's sandstorm only targets tiles with plants; the boss dying or a snapshot restore mid wind-up / mid sand shield leaves no warning tiles, no sand ring and no frozen clip — T4 and T2 tests.
5. Fire peas over rocks (p3-5's idea): a Peashooter behind a Torchwood behind a rock still hits the zombie past the rock with doubled damage — T6 test on a scripted match.

---

### Task 1: Foundation

**Files:** Create `src/adventure/levels/p3.ts`, `src/adventure/levels/z3.ts` (empty `P3`/`Z3` arrays), `tests/adventure/world3.test.ts`. Modify `src/sim/types.ts`, `src/data/units.ts`, `src/data/balance.ts`, `src/data/bossLooks.ts`, `src/render/models/registry.ts`, `src/adventure/types.ts`, `src/adventure/levels/helpers.ts`, `src/adventure/levels/index.ts`.

**Interfaces:**
- Produces: `BossKey` += `'sandPharaoh' | 'cactusKing'`; `BOSS_HALF_WIDTH.sandPharaoh = 0`, `.cactusKing = 1`; sides zombies / plants in `units.ts`; **stub** `Balance.bosses.sandPharaoh|cactusKing` from content design §2 phase-1 numbers with valid `phases` (hp 6500 / 11000); stub `BOSS_LOOK` rows and registry entries reusing the Brain Titan / Elder Oak looks and models; `TutorialStep.after?: 'hero' | 'spell' | 'foe'` (doc comment per Ruling 6); `rocks(tiles: [number, number][]): number[]` in `helpers.ts`; `P3`, `Z3` joined in `ALL` in `index.ts`.

- [ ] **Step 1: Write the failing tests** in `tests/adventure/world3.test.ts`: `rocks([[1,4],[2,5],[3,3]])` equals `[12, 21, 27]`; an old save with every p1/p2 level won reports `p3-1` as next (injected list with one stub p3 level), with p2-7 only it does not (Review Focus 3); an injected z3-3 with `unlocks: 'necromancer'` adds it to the hand from z3-4 on. Table-completeness tests already in the suite cover the new keys.
- [ ] **Step 2:** `npx vitest run tests/adventure/world3.test.ts` → FAIL (`rocks` not exported).
- [ ] **Step 3:** Implement the Produces list.
- [ ] **Step 4:** `npx tsc --noEmit`; full `npx vitest run` → PASS, `tests/sim/hash.test.ts` (golden 3452586360) and `noTwistReplay` untouched and green.
- [ ] **Step 5:** Commit `feat(worlds3): keys, stubs and the rocks helper for the Desert Canyon`.

### Task 2: Boss visuals and sounds

**Files:** Create `src/render/models/bosses/sandPharaoh.ts`, `src/render/models/bosses/cactusKing.ts`, `tests/render/bosses/bossWorld3.test.ts`. Modify `src/render/battle/BossFx.ts`, `src/data/bossLooks.ts` (the two new rows, and the Howler's `pups` → `summonLook` only), `src/render/models/registry.ts`, `src/render/models/roster.ts`, `src/audio/sfx.ts`, `src/audio/bindings.ts`, `src/scenes/bossScript.ts`, `src/scenes/bossDemo.tsx`, `tools/shots.mjs`.

**Interfaces:**
- Consumes: Task 1 keys.
- Produces: `sandPharaohModel()` (`bipedModel` as `brainTitan.ts`: bandaged Desert Zombie, gold-and-blue headdress, scarab staff; `phaseParts`: glowing eyes; scale 2.8) and `cactusKingModel()` (plant kit at half resolution as `elderOak.ts`: two-armed saguaro, flower crown, `pupils`, spines, `barkL`/`barkR` plates; scale 4); `BossLook.fx.shield` += `'sand'`; strike blow `'boulder'`; `summonLook?: 'pups' | 'mummies'` (Ruling 9); a `bark` plate tint (green spines for the Cactus); sounds `pharaohCall`, `pharaohDefeat`, `cactusCreak`, `cactusDefeat`; `BOSS_DEMO` entries for both.

- [ ] **Step 1: Write the failing tests:** `triangles(sandPharaohModel()) <= 6000` and the same for the Cactus King; Titan, Oak, Howler and Melon demo frames pixel-identical before/after (snapshot first); `sand` shield ring and `boulder` warning tiles are removed when the boss dies mid wind-up, mid shield, and after a snapshot restore (Review Focus 4); every `BossKey` has a complete `BOSS_LOOK` row and both sounds bound.
- [ ] **Step 2:** `npx vitest run tests/render/bosses tests/render/bossLooks.test.ts` → FAIL.
- [ ] **Step 3:** Build the models and `BossFx` additions; demo and `tools/shots.mjs` scenes (entrance, each wind-up, strike, shield, phase 2, defeat) for both.
- [ ] **Step 4:** Tests PASS; `npx tsc --noEmit`; screenshots at 1024×650 (Global browser rules) — look at each; `npm run perf` on both demo fights at DPR 1 and 2, load noted.
- [ ] **Step 5:** Commit per boss: `feat(worlds3): the Sand Pharaoh`, `feat(worlds3): the Cactus King`.

### Task 3: Rocks teaching and the foe wait

**Files:** Modify `src/app/tutorial.ts`, `src/render/world/TwistTiles.ts`, `src/app/levelSession.ts` (only if the pan needs the side), `src/adventure/levels/teaches.ts`. Tests: `tests/app/tutorial.test.ts`, `tests/app/tutorialFuzz.test.ts`, `tests/app/twistLesson.test.ts`, `tests/render/twistShow.test.ts`, `e2e/twists.spec.ts`.

**Interfaces:**
- Consumes: `TutorialStep.after: 'foe'` (Task 1).
- Produces: `TwistShowKind = 'fog' | 'ice' | 'rocks'`; `twistShown` per Ruling 7; the rocks show in `TwistTiles` (camera eases along the boulders; ghost Peashooter drops on a boulder, bounces off with the real buzz and red mark, hops to the free tile beside it and shoots; ghost Brain Eater walks over; zombie side reversed per Ruling 8); the foe wait per Ruling 6. `TEACHES` rows exactly as content design §3 for p3-1, p3-4 (`torchwood` at [2,2]), p3-7 (`cherryBomber` at [2,4], `after: 'foe'`), z3-1, z3-4 (`necromancer` lane 2), z3-7 (`tridentZombie` lane 1); zombie lane steps use `col: 9` as `z2-4.hot-lane`.

- [ ] **Step 1: Write the failing tests:** `twistShown` gives `'rocks'` for a rocks-only lawn; an unanswered rocks pan shows the glove at 3 s, ends on any tap, and Pause works during it; foe step: unarmed (no glove, match runs) with no enemy in `[col+0.5, col+2.5]`, arms when one enters, re-waits when it dies before arming, lets go after `MISSING_HOLD_SECONDS` when its action stops being possible, never shows if the match ends first (Review Focus 2); fuzz over the new steps (random taps, drags, restarts, reloads, HELP replay mid-step) never leaves the match held with no way on; the rock ghosts are disposed.
- [ ] **Step 2:** `npx vitest run tests/app tests/render/twistShow.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests PASS; `npx tsc --noEmit`; e2e (`ipad` and `desktop`): an injected rocks level's pan ends on a tap and the level plays; a tap on a rock buzzes and places nothing.
- [ ] **Step 5:** Commit `feat(worlds3): the rocks pan and a lesson step that waits for a foe`.

### Task 4: Boss numbers and what the stand-ins know

**Files:** Modify `src/data/balance.ts` (`bosses.sandPharaoh`, `bosses.cactusKing` only), `src/ai/levelStandIns.ts`. Tests: `tests/sim/boss.test.ts`, `tests/sim/bossPhases.test.ts`, new `tests/sim/bossWorld3.test.ts`, `tests/ai/*`.

**Interfaces:**
- Consumes: Task 1 keys.
- Produces: full rows from content design §2 (Pharaoh: hp 6500, lane 2, speed 0.1, phase 1 summon 2 `desertZombie` / 9 s and slam / 11 s, wind-up 1.5 s, 380/160; shield at 0.5, 7 s, ×0.5; phase 2 strike 3 plant tiles, 2 s wind-up, 50, blind 3 s, summon 2 `skeletonWarrior` level 2, slam / 7 s. Cactus: hp 11000, column 0, guardFactor 0.5, barrage 3 / 9 s, 200, splash 0.75, summon 2 `kernelPult` columns 1–4 / 12 s; shield 8 s ×0.5 at 0.5; phase 2 strike 3 zombie tiles, 2.5 s, 220, no status, barrage 4, summon 2 `walnutBomb` columns 2–5); `BossAnswer.recipe?: readonly (readonly [CardKey, number])[]` — ordered `[card, col]` planted in the boss's lane; Pharaoh expert `[['peashooter', 1], ['torchwood', 3]]`, average 3 Peashooters (as the Titan's), beginner nothing; the Cactus King uses the existing strike dodge (expert), average and beginner unaware. Titan and Howler entries unchanged.

- [ ] **Step 1: Write the failing tests:** each boss switches phase at 0.5; the sandstorm picks only tiles with plants and announces before it hits; the rockfall hits only tiles with zombies; Cactus summons never land on a rock (Review Focus 4); a scripted fight for each ends, with snapshot/restore mid wind-up; the expert's recipe plants a Peashooter at [2,1] then a Torchwood at [2,3] on the p3-8 rock layout; world 1–2 boss stand-in results identical (record before).
- [ ] **Step 2:** `npx vitest run tests/sim/boss tests/ai` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests PASS; golden hash and `noTwistReplay` untouched; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(worlds3): boss numbers and the stand-ins' recipe`.

### Task 5: Bands for worlds 3–5

**Files:** Modify `src/ai/levelChecks.ts`, `tests/ai/long/levelBands.ts` (band functions only, not `KNOWN_MISSES`), `tests/ai/levelChecks.test.ts`.

**Interfaces:**
- Produces: `levelGate` (Ruling 1, replaces `worldTwoGate`), `bossStarBand` (Ruling 2), `beginnerWinMin(i, side)` (Ruling 3); `curveBandTests` and `worldTwoBandTests` folded into one function for worlds 2–5 that runs the gate's band, `STAR_LEVEL` on star levels, the expert ≥95%, the beginner floor, the idle check (`IDLE_SEEDS`), "no level harder than the one two after it" (1-point slack per block), every seed ends and the length gate (Ruling 4), and prints the record table.

- [ ] **Step 1: Write the failing tests:** `levelGate` for z2-4 `'win'`, z2-5 `'stars'`, z2-8 `'boss'`, p2-8 `'win'`, p3-8 `'win'`, z3-1 `'stars'`, z3-8 `'boss'`; `bossStarBand(3)` = {38, 58}, `(5)` = {20, 40}, `(1)` = {35, 60}; `beginnerWinMin(16, 'zombies')` 70, `(17, 'zombies')` 60, `(25, 'zombies')` 50, `(17, 'plants')` null; `averageStarBand(17).lo` ≈ 56.0, `averageWinBand(24, true)` ≈ {51.8, 72.8}.
- [ ] **Step 2:** `npx vitest run tests/ai/levelChecks.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests PASS; `LVT_BALANCE=1 npx vitest run tests/ai/long/levels-w2 --maxWorkers=3` gives the same pass / known-miss list as before the change (record both); `levels-w3` is still a todo.
- [ ] **Step 5:** Commit `feat(worlds3): one band gate for worlds 2-5 and Toby's beginner floor`.

### Task 6: Plant levels p3-1..8

**Files:** `src/adventure/levels/p3.ts`, `tests/adventure/p3.test.ts`. After Tasks 1, 4, 5 merged.

**Interfaces:**
- Consumes: `trickle`, `flag`, `garden`, `rocks` (`helpers.ts`); `Balance.bosses.sandPharaoh`; `TEACHES` p3 rows (Task 3; ids only).

- [ ] **Step 1: Write the eight levels** from content design §1 (kind, rocks, opponent / script, cards, base hp, p3-4's prepared Peashooter at [2,1], p3-8 start energy 600). `unlocks`: `torchwood` on p3-3, `cherryBomber` on p3-6.
- [ ] **Step 2: Write the tests:** every level validates (`checkLawn`: no prepared or scripted plant on a rock); every glove tile of p3-4 and p3-7 is rock-free and accepted by `match.check` (Review Focus 1); a tap on a rock is refused with reason `rock`; an idle player loses all eight; unlock order; fire peas over a rock (Review Focus 5).
- [ ] **Step 3:** `npx vitest run tests/adventure/p3.test.ts` → PASS.
- [ ] **Step 4: Tune** (one run at a time): `npx tsx tools/levels.ts --world 3 --only 'p3-'`, `--set bosses.sandPharaoh.hp=…` (5500–8000) until expert ≥95%, average in his win band for i 17–24 (content design §4 table), median 1.5–4 min (Pharaoh fight 2.5–4), every seed ends. Where the expert floor and the band collide, keep the floor and record the miss (§4).
- [ ] **Step 5:** Commit in steps: `feat(worlds3): the plants' Desert Canyon levels`, then one per tuning pass with the table in the message body.

### Task 7: Zombie levels z3-1..8

**Files:** `src/adventure/levels/z3.ts`, `tests/adventure/z3.test.ts`. Written while Task 6 tunes; tuned only after Task 6's tuning has finished.

**Interfaces:**
- Consumes: as Task 6, plus `regrow` and `Balance.bosses.cactusKing`.

- [ ] **Step 1: Write the eight levels** from content design §1 (rocks in the computer's garden, gardens, clocks, z3-5's growing garden on the next free non-rock tile every 12 s, z3-8 rock-free under the boss's lanes 1–3 col 0). `unlocks`: `necromancer` on z3-3, `tridentZombie` on z3-6.
- [ ] **Step 2: Write the tests:** as Task 6 (validation, rock-free glove lanes for z3-4 and z3-7, idle loses, unlock order); z3-5's regrowth never lands on a rock.
- [ ] **Step 3:** `npx vitest run tests/adventure/z3.test.ts` → PASS.
- [ ] **Step 4: Tune:** `npx tsx tools/levels.ts --world 3 --only 'z3-'`, `--set bosses.cactusKing.hp=…` (9000–13000) until beginner on Easy ≥60%, expert ≥95%, average 3★ in the star band (n 1–7, average wins ≥85%, expert 3★ ≥10 points above) and 38–58 on z3-8, levels 2–3 min, Cactus fight 2.5–4 min, breakthroughs rank the three stand-ins.
- [ ] **Step 5:** Commit in steps as Task 6.

### Task 8: Three-block measurement

**Files:** `tests/ai/long/levelBands.ts` (`KNOWN_MISSES` world-3 entries and the Free Play entries only).

- [ ] **Step 1:** `LVT_BALANCE=1 LVT_BLOCKS=3 npx vitest run tests/ai/long/levels-w3 --maxWorkers=3`.
- [ ] **Step 2:** Re-measure Free Play (a graduate now holds 9 cards a side) with `tests/ai/long/freePlay`; re-record honestly; the survive-length entry updated with its new numbers (§7 risk 6: not fixed here).
- [ ] **Step 3:** `npm run test:balance`; `npm run test:balance:core` unchanged; world-2 entries unchanged.
- [ ] **Step 4:** The full table (16 levels × 3 stand-ins: win %, 2★+, 3★, median length) in the task report; every miss listed with its numbers.
- [ ] **Step 5:** Commit `test(worlds3): three-block measurement of the Desert Canyon`.

### Task 9: Proof

**Files:** Create `e2e/desert.spec.ts` (as `e2e/tundra.spec.ts`). Modify `README.md`; `e2e/*` and `tools/*` only where a check needs it.

- [ ] **Step 1: e2e, both projects** (Versus specs `ipad` only): world 3's islands open after p2-8 / z2-8 and not before; p3-1's and z3-1's pans end on a tap and play to a result by taps; a tap on a rock buzzes and places nothing; the Cherry glove appears only when the clump arrives; both unlock reveals per side; both bosses start, reach phase 2 and end (fast-forward); result, stars and next-level button; reload mid-world keeps progress; ten level↔map round trips on one WebGL context with flat geometry counts.
- [ ] **Step 2:** A five-year-old walk-through of z3-1..z3-3 and the Cactus King by taps only, with findings.
- [ ] **Step 3:** Shots: each boss's entrance, wind-up, strike, shield, phase 2 and defeat; the Desert on both sides at the three iPad sizes — looked at. `npm run perf`: Pharaoh with dust and rocks, Cactus King with dust and rocks, DPR 1 and 2 (load under 4), 16.6 ms p95 at DPR 2.
- [ ] **Step 4:** `npx tsc --noEmit`; `npx vitest run` twice; `npm run test:balance`; full e2e both projects; the nine-battle no-twist replay identical.
- [ ] **Step 5:** README: the Desert Canyon, the rocks, the two bosses, the four unlocks. Commit `docs(worlds3): proof and README for the Desert Canyon`.

## Merge order

Task 1 first. Then Tasks 2 (render), 3 (UI), 4 (sim) and 5 (measure) in parallel — no shared files: Task 4 touches only the two `bosses` rows of `balance.ts`, Task 2 only `bossLooks.ts` rows and render/audio/scenes, Task 3 only tutorial/TwistTiles/teaches, Task 5 only band code. Merge 4 and 5. Then Tasks 6 and 7 (written in parallel; Task 6's tuning finishes before Task 7's starts). Merge 2 and 3. Then Task 8, then Task 9, then a whole-branch review (Opus or Sonnet). Implementers on the top model for worlds content (Michal, 2026-11-16).
