# Campaign Step 2 (Moonlit Meadow + Frozen Tundra) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The second world of each campaign, playable and deployed: plant levels p2-1..8 in the Moonlit Meadow (fog) ending at the Moon Howler, zombie levels z2-1..8 in the Frozen Tundra (ice) ending at the Frost Melon, with the two unlocks per side and a no-text lesson for each twist.

**Architecture:** Content on the shipped machinery. Levels are data files beside `backyard.ts`; the two bosses are `Balance.bosses` rows using `phases` and `strike`, one `BOSS_LOOK` row and one model each; a new lesson step type shows a twist by a camera pan that ends on a tap. Balance is measured per world with the existing harness.

**Tech Stack:** Vite, TypeScript strict, Three.js 0.187, Preact + signals, Vitest 5, Playwright 1.64, tsx.

**Spec:** `docs/superpowers/specs/2026-11-11-3d-rebuild-design.md` (§6.6, §8, §10) and the content design `docs/superpowers/specs/2026-11-14-step2-meadow-tundra-content.md` — the level tables (§1), boss table (§2), lessons (§3), bands (§4) and file lists (§5) there are this plan's exact values. Every implementer reads the sections named in their task first.

## Global Constraints

- Players are 8 and almost 5; the younger cannot read. Pictures only, touch-first, iPad Safari landscape, Minecraft look. Do not restyle what is built.
- Zombie levels are Toby's: 2–3 minutes, forgiving, beginner on Easy wins at least 70%.
- The sim rules do not change. Golden hash 3452586360 and `tests/sim/noTwistReplay.test.ts` stay green untouched. New `BossKey`s extend tables only.
- No unit, hero, spell, Quick Battle or world-1 number changes. Tunable here: the 16 new levels, `Balance.bosses.moonHowler|frostMelon`.
- Each boss model at most 6,000 triangles. 16.6 ms p95 at DPR 2 on the M3 for both boss fights with weather.
- A lesson can never freeze: the twist step ends on any tap and holds nothing a tap cannot release; glove targets are validated with `match.check`; the tutorial fuzz tests cover every new step.
- Bands are not loosened; a miss is recorded as `it.fails` with its numbers.
- No network requests to Firebase from tests or tools; every e2e/tool URL carries `cloud=fake`. No deploys by agents.
- One browser at a time (`/tmp/lvt-browser.lock`, batches under 5 minutes). At most 3 worker processes; never two tuning runs at once.
- Commits end with `Co-Authored-By: Claude <noreply@anthropic.com>`. No formatters, no `git stash`, no `pkill`.

## Rulings made while planning

1. Fog reach is per level: `LevelTwist.fog?: true | number` (`true` = `Balance.twists.fog.reach`). Ramp 7, 7, 6, 6, 5, 5, 5, 5.
2. New-card levels (p2-4 Mango-pult, p2-7 Avocado Bunker, z2-4 Hot Topic, z2-7 Cowboy Zombie) get a two-step glove lesson, card then tile, as p1-2 does.
3. Tundra boss fight ices lanes 0, 1, 3, 4; the Frost Melon stands on the plain middle lane.
4. Moon Howler's shield bounces straight shots (pults answer it). Frost Melon's shield is a new `ice` variant of the Oak's plates.
5. Zombie bands — provisional, Michal's late-curve decision is open: z2-1..4 are held to the win band; z2-5..7 are held to the star band (average 3-star share `75 − 35·(i−9)/31` ±10, expert at least 10 points above, average still wins ≥85%); z2-8 keeps world 1's boss band (average 3-star 35–60%). Win numbers are recorded for every level either way. If Michal chooses to hold the win curve, only z2-5..8 need re-tuning.
6. Plant levels are held to the win band on all eight. Where beginner ≥70% and the band top cannot both hold (expected p2-6..8), keep the beginner floor and record the average miss.
7. The Oak and Titan get no changes.

## Review Focus

1. A child who never taps during the twist pan is not stuck forever with a hidden HUD: the pan loops, the "tap" hint (the glove) shows after 3 s, and Pause still works — Task 3 tests.
2. A save from before this plan, mid-campaign at p1-8/z1-8 done, opens world 2 on the map and nothing else changes — Task 1 test.
3. An idle player loses every world-2 level except where waiting is the lesson (none planned) — Tasks 6 and 7 tests, as `backyard.test.ts` does.
4. A boss dying, the match ending, or a snapshot restore during a strike wind-up or a phase change leaves no warning tiles, no stuck shield plates and no frozen boss clip — Task 2 tests.
5. Fog with reach 7 versus 5 in one session: the mist and fade puff follow the level's reach, and the level card picture shows for a numeric fog — Task 1 and Task 3 tests.

---

### Task 1: Foundation

**Files:** Create `src/adventure/levels/helpers.ts`, `src/adventure/levels/p2.ts`, `src/adventure/levels/z2.ts` (empty arrays), `tests/adventure/world2.test.ts`. Modify `src/adventure/levels/backyard.ts` (helpers moved out, data identical), `src/adventure/levels/index.ts`, `src/adventure/types.ts`, `src/adventure/campaign.ts`, `src/ui/screens/mapModel.ts`, `src/sim/types.ts`, `src/data/units.ts`, `src/data/balance.ts`, `src/data/bossLooks.ts`, `src/render/models/registry.ts`.

**Produces:** `trickle`, `flag`, `garden`, `regrow` exported from `helpers.ts`; `LevelTwist.fog?: true | number`; `TutorialStep` gains `{ id: string; show: 'twist'; until: 'tapped' }`; `BossKey` gains `'moonHowler' | 'frostMelon'` with `BOSS_HALF_WIDTH` 0 and 1, sides zombies and plants, **stub** `Balance.bosses` rows (content design §2 phase-1 numbers, valid `phases`), stub `BOSS_LOOK` rows and registry entries that reuse the Titan and Oak models so everything compiles and renders.

- [ ] Tests: `LEVELS` for world 1 deep-equal to before the move (snapshot the JSON first); `lawnOf` gives `fog: 7` for `fog: 7` and the balance reach for `true`; map twist picture shows for numeric fog (Review Focus 5); an old save with all of world 1 done reports world 2's first level as next once `p2`/`z2` hold levels (use an injected list) (Review Focus 2); table-completeness tests pass for the new keys; golden hash and `noTwistReplay` untouched.
- [ ] `npx tsc --noEmit`; full `npx vitest run`; commit.

### Task 2: Boss visuals and sounds

**Files:** Create `src/render/models/bosses/moonHowler.ts`, `frostMelon.ts`, tests under `tests/render/bosses`. Modify `src/render/battle/BossFx.ts`, `src/data/bossLooks.ts`, `src/render/models/registry.ts`, `roster.ts`, `src/audio/sfx.ts`, `src/audio/bindings.ts`, `src/scenes/bossDemo.tsx`, `src/scenes/bossScript.ts`, `tools/shots.mjs`.

**Produces:** the two models per content design §2 (built from, parts, scale); `BossFx` reads each pattern's own `windupSeconds` (no Titan constant), plays a boss clip during a strike wind-up (`BossShows.strike`), an `ice` shield variant, a `shards` defeat, optional `phaseParts` shown from phase 2; sounds `howlerHowl`, `howlerDefeat`, `melonCrack`, `melonDefeat`; boss demo and screenshot scenes for both.

- [ ] Tests: triangle count ≤ 6,000 each; Titan and Oak demo frames pixel-identical before/after; Review Focus 4 cases; every `BossKey` row complete.
- [ ] Screenshots of entrance, each wind-up, strike, shield, phase 2 and defeat for both, at 1024×650 — look at them; perf of each fight scene at DPR 1 and 2 with load noted.
- [ ] Commit per boss.

### Task 3: Twist lesson

**Files:** Modify `src/app/tutorial.ts`, `src/app/levelSession.ts`, `src/render/CameraRig.ts`, `src/render/world/TwistTiles.ts`, `src/adventure/levels/teaches.ts`, tests under `tests/app`, `e2e/twists.spec.ts`.

**Produces:** the `show: 'twist'` step: sim held, camera pans over the twist (fog: a ghost pea flies and puffs out at the level's reach; ice: the icy lanes pulse and a ghost walker slides), ends on any tap, remembered in `teached`. Lessons: `p2-1.fog`, `z2-1.ice`, and the four two-step glove lessons of Ruling 2 with the tiles in content design §3.

- [ ] Tests: Review Focus 1; fuzz over the new steps (random taps, drags, restarts, reloads mid-step) never leaves the match held with no way on; the ghost objects are disposed; replay through HELP shows the pan again.
- [ ] e2e (ipad): p2-1's pan ends on a tap and the level then plays; z2-1 likewise. (Uses the map preview hook until Tasks 6–7 land.)
- [ ] Commit.

### Task 4: Boss numbers and what the stand-ins know

**Files:** Modify `src/data/balance.ts` (`bosses.moonHowler`, `bosses.frostMelon` only), `src/ai/levelStandIns.ts`, tests under `tests/sim/boss*`, `tests/ai`.

**Produces:** full boss rows per content design §2 (two phases, shield at 0.5, strike with blind 4 s / stun 2 s); `TITAN_ANSWER` generalised to a per-boss `BOSS_ANSWER` table (Titan's entry unchanged; Howler: expert plants two pults within reach of its lane, average three peashooters at the usual columns, beginner nothing); the zombie expert never sends into a lane whose strike is winding up (`strikeTiles`), average and beginner unaware.

- [ ] Tests: each boss's phases switch at the mark; strike lanes are announced then hit; the Howler's dome bounces straight shots and not lobbed ones; a scripted fight for each boss ends, with snapshot/restore mid-fight; world-1 boss stand-in results unchanged.
- [ ] Commit.

### Task 5: Bands

**Files:** Modify `src/ai/levelChecks.ts`, `tests/ai/long/levelBands.ts`, `tests/ai/long/levels-w2.test.ts`.

**Produces:** `averageStarBand(i)` (Ruling 5); for world 2: win band or star band per Rulings 5–6, "no level harder than the one two after it", boss 3-star band, idle-player check hook, all on one block by default and three with `LVT_BLOCKS=3`.

- [ ] Unit tests of the band functions at i = 9, 13, 16; the world-2 file runs green on an empty level list (todo) and is ready for Tasks 6–7.
- [ ] Commit.

### Task 6: Plant levels p2-1..8

**Files:** `src/adventure/levels/p2.ts`, `tests/adventure/p2.test.ts`. After Tasks 1, 4, 5.

- [ ] Write the eight levels from content design §1 (kinds, fog reach, idea, opponent, cards, base). Unlocks: Mango-pult at p2-3, Avocado Bunker at p2-6.
- [ ] Fog pilot first: `npx tsx tools/probe-gap.ts --twist fog --base 3000 --skills easy,medium --incomes 0.3,0.5`; then tune with `npx tsx tools/levels.ts --world 2 --only 'p2-'` and `--set bosses.moonHowler.hp=…` until: expert ≥95%, beginner on Easy ≥70%, average inside the win band (Ruling 6 where they collide), median length 2.5–4.5 min, Howler fight 2.5–4 min.
- [ ] Tests: validation of every level; idle player loses all eight (Review Focus 3); unlock order; the report table committed in the test's comment or the task report.
- [ ] Commit in steps (levels, then each tuning pass).

### Task 7: Zombie levels z2-1..8

**Files:** `src/adventure/levels/z2.ts`, `tests/adventure/z2.test.ts`. After Task 6's tuning has finished (one tuning run at a time).

- [ ] Write the eight levels from content design §1 (ice lanes, gardens, clocks). Unlocks: Hot Topic at z2-3, Cowboy Zombie at z2-6.
- [ ] Tune with `npx tsx tools/levels.ts --world 2 --only 'z2-'` and `--set bosses.frostMelon.hp=…` until: beginner on Easy ≥70%, expert ≥95%, Ruling 5's bands, levels 2–3 min, Melon fight 2.5–4 min, breakthroughs rank the three stand-ins.
- [ ] Tests as Task 6.
- [ ] Commit in steps.

### Task 8: Three-block measurement

**Files:** `tests/ai/long/levelBands.ts` (`KNOWN_MISSES`, Free Play bands).

- [ ] `LVT_BALANCE=1 LVT_BLOCKS=3 npx vitest run tests/ai/long/levels-w2 --maxWorkers=3`; re-measure Free Play (a graduate now holds seven cards) and re-record honestly; `npm run test:balance`; `npm run test:balance:core` unchanged.
- [ ] The full table (16 levels × 3 stand-ins: win %, 2★+, 3★, length) in the task report; every miss listed with its numbers.

### Task 9: Proof

**Files:** `e2e/*`, `tools/*`, `README.md`.

- [ ] e2e, both projects: world 2's island opens after level 8 of world 1 and not before; p2-1 and z2-1 walk from the pan to a result by taps; both unlock reveals on each side; both boss levels start, reach phase 2 and end (fast-forward); result, stars and next-level button; reload mid-world keeps progress; ten level↔map round trips on one WebGL context.
- [ ] A five-year-old walk-through of z2-1..z2-3 and the Melon by taps only, with findings.
- [ ] `tsc`; vitest ×2; `npm run test:balance`; full e2e both projects; perf for both boss fights and both worlds at DPR 1 and 2 (load under 4); screenshots at the three iPad sizes — looked at.
- [ ] README: the two worlds, their twists, the bosses.

## Parallel streams

Task 1 first. Then Tasks 2 (render), 3 (UI), 4 then 5 (sim/measure worktree) in parallel. Merge 4 and 5, then Task 6, then Task 7 (tuning one at a time; Task 7's level file may be written while Task 6 tunes). Merge 2 and 3. Then 8, 9, whole-branch review, deploy.
