# Campaign step 2 content design: Moonlit Meadow (plants) and Frozen Tundra (zombies)

Drafted 2026-11-14 from the live code at main 6329775. Level numbers are starting points for tuning.

I've made no edits. This design is built on live main 6329775. The level numbers are starting points to tune with `tools/levels.ts`.

## 1. The 16 levels

All levels: heroes on, two spells per side, the standard star rule (1 for a win, 2 with the player's base ≥50%, 3 with it ≥80%; Breakthrough: 2 with ≥25% of the clock left, 3 with ≥50%). Plant cards: **P**eashooter, **S**unflower, **W**alnut Bomb, Potato **M**ine, **K**ernel-pult, **Mg** Mango-pult, **Av** Avocado Bunker. Zombie cards: **BE** Brain Eater, **VFW** Very Fast Walker, **SW** Skeleton Warrior, **DZ** Desert Zombie, **SA** Skeleton Archer, **HT** Hot Topic, **CZ** Cowboy Zombie. Campaign index i = 8 + n.

**Plants, Moonlit Meadow (fog)**

| id | kind | fog reach | the one idea | opponent / script | cards | base hp |
|---|---|---|---|---|---|---|
| p2-1 | survive 100 s | 7 | Peas only fly so far in the mist, so plant shooters further forward | BE trickle in lanes 1–3 from 20 s; flag of BE+DZ at 85 s | P S W M K | plants 5000 |
| p2-2 | battle | 7 | To hit the zombie base you need a shooter at column 3 or further | easy ×0.5; BE VFW SW DZ | P S W M K | zombies 2500 |
| p2-3 | conveyor 120 s | 6 | Belt cards: walls in front of forward shooters. **Unlocks Mg** | scripted waves in all 5 lanes; base sized so an idle player loses (as p1-5) | belt P W M K | plants ~4500 |
| p2-4 | battle | 6 | Mango splash on clumps of zombies | medium ×0.3; + SA | + Mg | zombies 3000 |
| p2-5 | survive 150 s | 5 | Shields stop peas; lob over them | flags of SW at 70 s and 130 s, SA mixed in (their range is also capped at 5) | P S W M K Mg | plants 4000 |
| p2-6 | battle | 5 | Guard your forward shooters with a wall. **Unlocks Av** | medium ×0.35; + HT | P S W M K Mg | zombies 3500 |
| p2-7 | survive 170 s | 5 | A bunker holds the line while the lassos fly | DZ and CZ trickle; flag at 150 s | + Av | plants 4000 |
| p2-8 | boss | 5 | Moon Howler (§2) | boss in lane 2; VFW "pups" trickle in lanes 0, 4, 1, 3 | all 7 | plants 5000 |

Kinds run S B C B S B S Boss, so no kind appears three times in a row. Fog battles drag in the probe (fog medium ×0.5 gave an expert of only 88.5%), so battles here use a small zombie base and a low computer income, and Survive and Conveyor carry most of the fog.

**Zombies, Frozen Tundra (ice ×1.6). Short and forgiving.**

| id | kind | ice lanes | the one idea | opponent / garden | cards | base hp |
|---|---|---|---|---|---|---|
| z2-1 | battle | 2 | The shiny lane is fast: zombies sent there arrive first | no computer; prepared P at [1,3] [3,3] [2,4]; regrows every 40 s | BE VFW SW DZ SA | plants 3500, zombies 12000 |
| z2-2 | battle | 1, 3 | Pick the icy lanes | easy ×1.0; P S W | same | plants 3500 |
| z2-3 | breakthrough 120 s | 2 | The icy lane gets you there before the peas do their work. **Unlocks HT** | walnut walls in lanes 0, 1, 3, 4; lane 2 has P+P+W but is iced | same | plants 1200 |
| z2-4 | battle | 1, 3 | Hot Topic grows by eating plants; send it where the plants are weak | easy ×1.25; P S W M | + HT | plants 4000 |
| z2-5 | conveyor 150 s | 0, 2, 4 | The belt plus choosing a fast lane | regrowing P garden as in z1-5 | belt BE VFW SW DZ HT | plants 4500, zombies 10000 |
| z2-6 | breakthrough 150 s | 0, 2, 4 | A cheap Walker first sets off the mines under the ice. **Unlocks CZ** | mines and a K in the fast lanes; the lane with the fewest plants is a trap | BE VFW SW DZ SA HT | plants 900 |
| z2-7 | battle | 0, 1, 3, 4 | The Cowboy lassos the big plant; a Skeleton walks behind | medium ×0.45; P S W M K | + CZ | plants 3000 |
| z2-8 | boss | 0, 1, 3, 4 | Frost Melon (§2) | P at [0,3] [4,3] [1,4] [3,4]; K at [0,1] [4,1] | all 7 | default |

At the boss the middle lane stays plain because the boss stands on it. Icing all five lanes would take away the lane choice.

## 2. The two bosses

| | Moon Howler (p2-8, zombie side) | Frost Melon (z2-8, plant side) |
|---|---|---|
| Built from | `bipedModel`, the way `brainTitan.ts` is: a wolf-eared Brain Eater with a snout, a tail, a fur ruff and a glowing moon pendant. In phase 2 a `glow` part lights up. | Plant kit, half resolution like `elderOak.ts`: the Mango-pult's arm and basket holding a giant frosted melon, an icicle crown, `pupils` that follow, and hidden `iceL`/`iceR` plates for the shield |
| Size | scale 2.6, half width 0, walks lane 2 at speed 0.1 | scale 3.5–4, half width 1, column 0, guardFactor 0.5 (like the Oak) |
| hp | start 5500, tune 4800–7000 (Titan 3800 lasts about 2.2 min) | start 6000, tune 5000–7500 (Oak 4200 lasts about 1.7 min) |
| Phase 1 (100–50%) | slam (claw) every 11 s, 1.5 s wind-up, 350/150; summon 2 VFW every 8 s | barrage of 3 frozen melons every 9 s, 200 dmg, splash 0.75; summon 2 P in columns 1–4 every 12 s |
| Shield at 0.5 | 7 s moon dome; straight shots bounce off (pults still hit) | 8 s ice plates, ×0.5 damage |
| Phase 2 | strike: 1 whole lane, 2 s wind-up, 60 dmg, **blind 4 s** (the howl); slam every 10 s; summon 2 BE at level 2 | strike: 2 whole lanes, 2.5 s wind-up, 80 dmg, **stun 2 s** (the freeze); barrage of 4; summon 2 W in columns 2–5 |
| How the twist shows | Fog caps every shot at 5 tiles, so only shooters planted forward reach it as it walks. Its own attacks ignore fog. | Ice lanes bring zombies in fast; the freeze punishes a crowd standing in one lane |
| Tell, and the child's answer | Arm rises with red tiles: don't keep plants just in front of it. Head thrown back, grey lane blinking: it is about to blind that lane, so rely on walls (Av, W) and the hero. Dome: switch to pults (Mg, K). | Basket cranks back with red landing rings. Crown flashes and two lanes blink icy blue for 2.5 s: **send zombies down a lane that is not blue**. |
| Stand-ins | expert: 2 Mg/K within column 3–4 of its lane. average: 3 P at the usual columns. beginner: none. | expert: never sends into a lane whose strike is winding up (reads `strikeTiles`). average and beginner: unaware. |

**New code per boss:**
- `src/sim/types.ts`: `BossKey` and `BOSS_HALF_WIDTH`.
- `src/data/units.ts`: which side each boss is on.
- `src/data/balance.ts`: the `bosses` rows, using `phases`.
- `src/data/bossLooks.ts`: one row each.
- `src/render/models/bosses/{moonHowler,frostMelon}.ts`, plus `registry.ts` and `roster.ts`.
- `src/audio/sfx.ts`: four sounds (`howlerHowl`, `howlerDefeat`, `melonCrack`, `melonDefeat`).
- `src/scenes/bossScript.ts`: demo levels; `tools/shots.mjs`: scenes.

**Generalising `BossFx.ts`, needed for both:**
- The slam tiles currently use the Titan's `SLAM_WINDUP` constant; read each pattern's own `windupSeconds` instead.
- A strike wind-up plays no boss animation today; add `BossShows.strike: 'cheer' | 'ability' | 'shoot'`.
- Add an `ice` shield variant (the bark plates, recoloured).
- Add a `shards` defeat with colours.
- Optional: `phaseParts`, a model part shown from phase 2 on.

## 3. Teaching the twists

**What already exists:**
- The twist picture on the level card.
- The fade puff when a shot dies in the fog.
- The icy lane tiles.

**What is missing:** a lesson step type `{ show: 'twist'; until: 'tapped' }`. During it the simulation holds and the camera pans over the twist (`CameraRig.frameSubject`). Fog: a ghost pea flies and puffs out at its reach. Ice: the icy lanes pulse and a ghost walker slides along them. The step ends on any tap, never on a timer. It is remembered in `teached` like the other steps. Neither twist refuses a tap, so there is no glove for either.

**Lesson steps:**
- p2-1: `[{ id: 'p2-1.fog', show: 'twist', until: 'tapped' }]`
- z2-1: `[{ id: 'z2-1.ice', show: 'twist', until: 'tapped' }]`
- p2-5: optionally the twist step again when the fog closes in to 5.
- The unlock levels (p2-3, p2-6, z2-3, z2-6) get no steps; the result screen's turntable shows the new unit.
- My recommendation, following p1-2: a two-step card-then-tile glove on the first level that deals each new card:
  - p2-4: Mg at lane 2, column 2
  - p2-7: Av at lane 2, column 4
  - z2-4: HT at lane 0, column 9
  - z2-7: CZ at lane 2, column 9

  This is your call (§7).

## 4. Balance targets

Average-player target `88 − 48·(i−9)/31`, ±8:

| i | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 (boss) |
|---|---|---|---|---|---|---|---|---|
| target | 88.0 | 86.5 | 84.9 | 83.4 | 81.8 | 80.3 | 78.7 | 77.2 |
| band | 80–96 | 78.5–94.5 | 76.9–92.9 | 75.4–91.4 | 73.8–89.8 | 72.3–88.3 | 70.7–86.7 | 64.2–85.2 |

On every level: expert ≥95%, beginner on Easy ≥70%, the 1-point slack per block.

- **Plants:** reachable. At the probed level 40 the plants side can hold an average of about 60% with the expert at 95%. The tension is between the beginner floor and the band top on p2-6 to p2-8 (see §7).
- **Zombies:** the probe found the average at ≥91% wherever the expert is ≥95%.
  - z2-1 and z2-2 can meet the win band (it tops out at 96 / 94.5).
  - z2-3 only if the "fastest lane versus fewest plants" garden splits the two stand-ins.
  - z2-4 is borderline (92.4 with slack).
  - **z2-5 to z2-8 cannot.** They need a star band in place of the win band, and that needs Michal's OK under spec §10.
- **Proposed zombie star band, from i=13 on, for the rest of the campaign:**
  - Average 3-star share `75 − 35·(i−9)/31` ±10: z2-5 60.5–80.5, z2-6 59.4–79.4, z2-7 58.2–78.2.
  - The boss keeps world 1's 35–60.
  - The expert three-stars at least 10 points more often than the average.
  - The average still wins ≥85%.
  - The probe's level-40 frontier (average 3-star 47.5–59.5 with the expert ≥95%) fits the band's end at 40 ±10.

The bands for world 2 should also bring over from world 1 "no level harder than the one two after it" and the boss 3-star band, which `curveBandTests` lacks today.

## 5. What exists versus what's needed

**Already there:** all five level kinds, `LevelTwist`, `lawnOf`, fog/ice in the sim, phases and strike, the `BOSS_LOOK` table, the Meadow and Tundra looks, weather and music, the map's islands, the twist pictures, twist-aware bots, `--world 2`, and the curve bands.

**Needed:**
1. **Per-level fog reach:** `LevelTwist.fog?: true | number` in `src/adventure/types.ts`, plus `lawnOf` in `src/adventure/campaign.ts` and `twistKinds` in `src/ui/screens/mapModel.ts`. `twistKinds` currently tests `fog === true`, so it must change too.
2. **The twist lesson step:** `src/adventure/types.ts`, `src/app/tutorial.ts`, `src/app/levelSession.ts`, `src/render/CameraRig.ts`, and a highlight and ghost in `src/render/world/TwistTiles.ts`.
3. **The two bosses and the BossFx changes** (§2).
4. **Stand-ins:** turn `TITAN_ANSWER` into a per-boss `BOSS_ANSWER` table, and add the strike-dodge for the zombie expert (`src/ai/levelStandIns.ts`).
5. **Bands:** `averageStarBand` in `src/ai/levelChecks.ts`; star, trend and boss bands in `tests/ai/long/levelBands.ts`.
6. **Level files:**
   - `src/adventure/levels/helpers.ts`: `trickle`/`flag`/`garden`/`regrow` moved out of `backyard.ts`, with no change to its data.
   - `p2.ts`, `z2.ts`, `index.ts` and `teaches.ts`.
   - `tests/adventure/world2.test.ts`.
7. **Free Play:** a graduate now holds 7 cards, so Free Play's bands will move and need re-measuring.

## 6. Tasks

| # | Task | Files | Produces | Worktree |
|---|---|---|---|---|
| T1 | Foundation | helpers.ts (moved from backyard.ts), types.ts (fog number, twist step type), campaign.ts, mapModel.ts, boss keys with **stub** numbers/looks/models (reusing the Titan/Oak models), empty `p2.ts`/`z2.ts` joined in index.ts | types and keys for everyone | base, first |
| T2 | Boss visuals | BossFx.ts, bossLooks.ts rows, moonHowler.ts, frostMelon.ts, registry, roster, sfx, bossDemo, shots.mjs, tests/render/bosses | the models (≤6,000 triangles each) and shows | render |
| T3 | Twist teaching | tutorial.ts, levelSession.ts, CameraRig.ts, TwistTiles.ts, teaches.ts (all six world-2 lessons), tests/app, e2e/twists.spec | the pan and lessons | UI |
| T4 | Boss numbers and stand-in knowledge | balance.ts (`bosses` only), levelStandIns.ts, tests/sim/boss*, tests/ai | tunable bosses | sim |
| T5 | Bands | levelChecks.ts, levelBands.ts | star and trend bands | measure |
| T6 | Plant levels | p2.ts, tests/adventure/p2.test.ts | p2-1 to p2-8, tuned | levels-p |
| T7 | Zombie levels | z2.ts, tests/adventure/z2.test.ts | z2-1 to z2-8, tuned | levels-z |
| T8 | Three-block measurement | levelBands.ts (`KNOWN_MISSES`, Free Play bands) | the honest list of misses | measure |
| T9 | Proof | e2e/*, README | release | merged branch |

**Merge order:** T1, then T2 to T5 in parallel (no shared files), then merge T4 and T5, then T6 and T7, then T2 and T3, then T8, then T9, then a whole-branch review. T6 and T7 can be written in parallel, but their tuning runs one at a time (never two tuning runs, at most 3 workers).

**Commands:**
- Tuning: `npx tsx tools/levels.ts --world 2 --only 'p2-'` (or `'z2-'`), `--set bosses.moonHowler.hp=5500`
- Fog pilot first: `npx tsx tools/probe-gap.ts --twist fog --base 3000 --skills easy,medium --incomes 0.3,0.5`
- Bands: `LVT_BALANCE=1 LVT_BLOCKS=3 npx vitest run tests/ai/long/levels-w2 --maxWorkers=3`
- Full checks: `npm run test:balance`, `npm run test:balance:core`, `npx tsc --noEmit`, vitest twice
- e2e, both projects, under `caffeinate -i`:
  - the w2 islands open after level 8
  - p2-1's pan finished by a tap
  - both bosses start and end
  - the unlock reveals
- Shots: the entrance, wind-up, strike, shield and defeat of each boss; both worlds at the three iPad sizes.
- `npm run perf`: Howler with fog and fireflies, Melon with ice and snow, at DPR 2.
- The nine-battle no-twist replay must stay identical.

## 7. Risks and open choices (with my default)

1. **The zombie win curve can't be reached.** Default: star band from z2-5 on; ask Michal (his late-curve decision is still open).
2. **Fog battles drag past 4 minutes.** Default: zombie base ≤3500, computer income ≤×0.35, reach ramp 7→6→5; run the fog pilot first.
3. **Survive and Conveyor may not beat the average** (100% in world 1). Default levers: flag waves timed against a slow player, a tighter base. Record a miss rather than go past the band.
4. **Beginner ≥70% conflicts with the average under the band top on p2-6 to p2-8.** Default: keep the beginner floor and record the average miss for Michal.
5. **Breakthroughs too short and not telling skill apart** (ice makes them faster). Default: 120–150 s clocks, a bigger plant base, a trap lane.
6. **Free Play bands drift** with 7 cards. Re-measure in T8.
7. **Perf headroom is only 0–0.7 ms at DPR 2.** Keep each boss ≤6,000 triangles and measure on a quiet machine.
8. **Open choices:**
   - fog reach per level: yes
   - new-card glove lessons: yes, two steps
   - ice at the boss: four lanes
   - file names: `p2.ts`/`z2.ts`
   - Howler's dome bounces straight shots, so pults are the answer: yes
   - the Oak gets no stand-in answer (ruling 12)
   - the Melon's shield: the new `ice` variant

### Critical Files for Implementation
- /Users/michaglio/Projects/worktrees/lukas-vs-toby-rebuild-art/src/adventure/levels/backyard.ts (format and helpers to move into helpers.ts; new p2.ts/z2.ts beside it)
- /Users/michaglio/Projects/worktrees/lukas-vs-toby-rebuild-art/src/data/balance.ts (`bosses`, `twists`)
- /Users/michaglio/Projects/worktrees/lukas-vs-toby-rebuild-art/src/render/battle/BossFx.ts (the `SLAM_WINDUP` coupling, strike clip, shield and defeat variants)
- /Users/michaglio/Projects/worktrees/lukas-vs-toby-rebuild-art/src/ai/levelStandIns.ts (`TITAN_ANSWER` becomes `BOSS_ANSWER`, strike dodge)
- /Users/michaglio/Projects/worktrees/lukas-vs-toby-rebuild-art/tests/ai/long/levelBands.ts (star and trend bands, `KNOWN_MISSES`)