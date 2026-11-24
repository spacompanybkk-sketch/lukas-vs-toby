# Campaign steps 3–5 content design: Desert Canyon, Frozen Tundra, Dark Citadel (plants); Desert Canyon, Moonlit Meadow, Backyard (zombies)

Drafted 2026-11-22 from live main 39b6833 (branch `worlds-3-5`). No code is changed by this document. Numbers marked *pilot* were measured for this design (§4.1); every other number is a starting point to tune with `tools/levels.ts`.

Three release steps, each shippable alone, each with its own plan once the step before lands:

- **Step 3**: p3 Desert Canyon + z3 Desert Canyon (rocks; the rocks lesson is new), bosses Sand Pharaoh and Cactus King.
- **Step 4**: p4 Frozen Tundra + z4 Moonlit Meadow (ice and fog exist), bosses Yeti and Glowcap.
- **Step 5**: p5 Dark Citadel (lava) + z5 Backyard (no twist; the treehouse finale), bosses Zombie King and King Sunflower, and each boy's campaign ending.

## 1. The 48 levels

All levels: heroes on, two spells per side, the standard star rule (1 for a win, 2 with the player's base ≥50%, 3 with it ≥80%; Breakthrough: 2 with ≥25% of the clock left, 3 with ≥50%). Plant cards: **P**eashooter, **S**unflower, **W**alnut Bomb, Potato **M**ine, **K**ernel-pult, **Mg** Mango-pult, **Av** Avocado Bunker, **T**orchwood, **C**herry Bomber, **Pu**mpkin Squash. Zombie cards: **BE** Brain Eater, **VFW** Very Fast Walker, **SW** Skeleton Warrior, **DZ** Desert Zombie, **SA** Skeleton Archer, **HT** Hot Topic, **CZ** Cowboy Zombie, **N**ecromancer, **TZ** Trident Zombie, **BR** Brain Rot. Campaign index i = 16 + n (world 3), 24 + n (world 4), 32 + n (world 5). Rock tiles are written `[lane,col]` over the 8 plant columns; lava tiles `[lane,col]` over the 10 lawn columns (the level files convert: rocks `lane*8+col`, lava `lane*10+col`).

**Unlocks** (worlds machinery ruling 7, `UNLOCK_AT` in `tools/probe-gap.ts`): world 3 gives two a side, world 4 one, world 5 none (all ten held; the last unlock lands at i 27, inside spec §6.6's "by level 30").

| world | plants | zombies |
|---|---|---|
| 3 | Torchwood after p3-3 (i 19), Cherry Bomber after p3-6 (i 22) | Necromancer after z3-3, Trident Zombie after z3-6 |
| 4 | Pumpkin Squash after p4-3 (i 27) | Brain Rot after z4-3 |
| 5 | none: the finale levels use all ten | none |

Kinds run S B C B S B S Boss for the plants (as the Meadow) and B B Br B C Br B Boss for the zombies (as the Tundra), so no kind appears three times in a row and every unlock lands on level 3 or 6.

### Step 3: Desert Canyon (rocks)

**Plants, p3 (i 17–24).** Rocks only refuse plants (ruling 4); zombies and shots pass over them. The pilot (§4.1) found that rocks in the middle of the lawn change almost nothing and rocks in the back two columns are what bite, so the twist ramps from a few middle rocks (the lesson) to a rocky back row.

| id | kind | rocks | the one idea | opponent / script | cards | base hp |
|---|---|---|---|---|---|---|
| p3-1 | survive 150 s | [1,4] [2,5] [3,3] | A plant can't stand on a rock (the tap buzzes); zombies walk straight past it | BE trickle lanes 1–3 from 20 s every 7 s; DZ from 50 s; flag BE+DZ at 105 s | P S W M K Mg Av | plants 5000 |
| p3-2 | battle | back row [0,1] [1,0] [2,1] [3,0] [4,1] | The back row is rocky: put Sunflowers where the ground is free | Medium ×0.6; BE VFW SW DZ SA (*pilot*: average 76.0, expert 96.5) | same | zombies 2500 |
| p3-3 | conveyor 150 s | [0,2] [1,4] [3,4] [4,2] | Belt walls fill the gaps the rocks leave. **Unlocks T** | scripted waves in all five lanes, sized so an idle player loses (as p2-3) | belt P W M K Mg | plants 5500 |
| p3-4 | battle | [0,0] [1,1] [3,1] [4,0] [2,5] | A Torchwood in front of a Peashooter makes fire peas (double damage) | Medium ×0.6; + HT. The player's own P stands at [2,1] (head start for the glove) | + T | zombies 2500 |
| p3-5 | survive 160 s | back row + [2,4] | Fire peas beat shields; a Torchwood behind a rock still lights peas that fly over it | SW flags at 70 s and 115 s with SA mixed in; HT trickle | 8 | plants 5500 |
| p3-6 | battle | [0,1] [1,0] [3,0] [4,1] [1,5] [3,5] | One fire lane per pair of lanes. **Unlocks C** | Medium ×0.65; + SA HT CZ | 8 | zombies 3000 |
| p3-7 | survive 170 s | as p3-6 | A Cherry Bomber on a clump | clumps of 3–4 BE/SW in one lane at 40, 80, 120, 150 s; CZ trickle | + C | plants 5500 |
| p3-8 | boss | [2,2] [2,4] [0,1] [4,1] [1,5] [3,5] | Sand Pharaoh (§2) | boss in lane 2; VFW trickle lanes 0, 4, 1, 3 | all 9 | plants 5300, start energy 600 |

**Zombies, z3 (i 17–24). Toby's: short (2–3 min) and forgiving.** On a zombie level the rocks stand in the *computer's* garden, so they help Toby: the rocky lanes hold fewer plants. The lesson is simply "go where the rocks are".

| id | kind | rocks | the one idea | opponent / garden | cards | base hp |
|---|---|---|---|---|---|---|
| z3-1 | battle | [0,1] [0,3] [4,1] [4,3] | Plants can't grow on rocks, so the rocky lanes are thin: send zombies there | no computer; P at [1,3] [2,3] [3,3] [2,4], one P at [0,2] and at [4,2]; regrows every 40 s in lanes 1–3 only | BE VFW SW DZ SA HT CZ | plants 5500, zombies 7000 |
| z3-2 | battle | back row (as p3-2) | The plants' back row is rocky, so they have few Sunflowers | Easy ×2.0; P S W M K (*pilot*: average win 99.5, 3★ 66.5; expert 3★ 89; beginner win 91.5) | same | plants 5000, zombies 3800 |
| z3-3 | breakthrough 240 s | [1,5] [3,5] [1,2] [3,2] | A rock where a wall should stand leaves a hole: push the lane with the hole. **Unlocks N** | W at [0,5] [2,5] [4,5]; P at [0,2] [2,2] [4,2] [1,1] [3,1]; K at [2,0] | 7 | plants 5000, zombies 14000 |
| z3-4 | battle | back row + [2,6] | The Necromancer stays back and mends; its Bone Minions walk in front | Easy ×1.8; P S W M K Mg | + N | plants 5000, zombies 4000 |
| z3-5 | conveyor 270 s | [0,1] [1,3] [2,0] [3,3] [4,1] [2,5] | The belt, and the garden can't grow on rocks | 3 P at the start, one more every 12 s on the next free non-rock tile (as z2-5's `GROWING`) | belt BE VFW SW HT N | plants 7000, zombies 9300 |
| z3-6 | breakthrough 240 s | [0,4] [4,4] [1,1] [3,1] [0,6] [4,6] | Skeleton in front, Necromancer behind: the pair outlasts a Bunker. **Unlocks TZ** | Av at [1,5] [3,5]; P behind each; mines at [0,5] [4,5] (the thin flank is the trap); K at [2,1] | 8 | plants 4000, zombies 14000 |
| z3-7 | battle | as z3-4 | The Trident's throw pierces three plants in a row | Easy ×2.2; P S W M K Mg Av | + TZ | plants 4000, zombies 4000 |
| z3-8 | boss | [0,2] [4,2] [0,5] [4,5] (none under the boss's lanes 1–3, col 0) | Cactus King (§2) | prepared K at [0,1] [4,1], P at [1,4] [3,4] | all 9 | zombies 11000 |

### Step 4: Frozen Tundra for the plants, Moonlit Meadow for the zombies

**Plants, p4 (i 25–32), ice ×1.6.** The plants' view of ice: what slides in arrives early, so the icy lane is defended first and further forward.

| id | kind | ice lanes | the one idea | opponent / script | cards | base hp |
|---|---|---|---|---|---|---|
| p4-1 | survive 150 s | 2 | Zombies slide fast on the shiny lane: guard it first | BE + VFW trickle, two of three in lane 2; flag at 105 s | 9 | plants 5000 |
| p4-2 | battle | 1, 3 | A Potato Mine on the ice catches a slider | Medium ×0.65; BE VFW SW DZ HT | 9 | zombies 2500 |
| p4-3 | conveyor 150 s | 0, 4 | Belt cards to the fast lanes first. **Unlocks Pu** | scripted waves, the iced lanes busier | belt P W M K T | plants 5500 |
| p4-4 | battle | 1, 3 | The Pumpkin Squash leaps on whatever slides in | Medium ×0.7; + CZ N | + Pu | zombies 3000 |
| p4-5 | survive 170 s | 0, 2, 4 | Kernel butter stops a slider in its tracks | HT + VFW rush flags at 60 s and 110 s down the iced lanes | 10 | plants 5500 |
| p4-6 | battle | 0, 2, 4 | A Cherry on the icy rush | Medium ×0.75; + N TZ | 10 | zombies 3000 |
| p4-7 | survive 180 s | 0, 1, 3, 4 | The Trident pierces a row: stagger plants across lanes | TZ + SW flags at 80 s and 140 s; N trickle | 10 | plants 5500 |
| p4-8 | boss | 0, 2, 4 | Yeti (§2), on the iced middle lane | boss in lane 2; VFW "snow pups" in lanes 0 and 4 | 10 | plants 5500, start energy 600 |

**Zombies, z4 (i 25–32), fog 7→5.** The zombies' view of fog: the plants can only shoot `fog` tiles, so a zombie walks safe in the mist until it is close; Archers, Tridents and Brain Rot must walk closer too. Fog reach ramps 7, 7, 6, 6, 5, 5, 5, 5 (the Meadow's ramp).

| id | kind | fog | the one idea | opponent / garden | cards | base hp |
|---|---|---|---|---|---|---|
| z4-1 | battle | 7 | In the mist the plants can't shoot far: your zombies sneak close | no computer; P at [1,1] [2,1] [3,1] [2,2], regrowing every 40 s in columns 0–2 | 9 | plants 5500, zombies 7000 |
| z4-2 | battle | 7 | Archers and Tridents have to walk closer too | Easy ×1.8; P S W M K Mg Av T | 9 | plants 5000, zombies 3800 |
| z4-3 | breakthrough 240 s | 6 | Shooters at the back can't reach the front plants: eat the front first. **Unlocks BR** | W at column 6 in every lane; P/K at columns 0–1 | 9 | plants 5000, zombies 14000 |
| z4-4 | battle | 6 | Brain Rot leaves poison puddles under the plants | Easy ×1.8; + C | + BR | plants 5000, zombies 4000 |
| z4-5 | conveyor 270 s | 5 | The belt in the mist | growing garden as z3-5 (no rocks) | belt BE VFW SW HT N BR | plants 7000, zombies 9300 |
| z4-6 | breakthrough 240 s | 5 | Necromancer heals the pack; Brain Rot melts the Kernel-pults | Av at column 5 in lanes 1–3, K behind; mines in lanes 0 and 4 | 10 | plants 4000, zombies 14000 |
| z4-7 | battle | 5 | Everything at once | Easy ×2.0; all plant cards but Pu | 10 | plants 4000, zombies 4000 |
| z4-8 | boss | 5 | Glowcap (§2) | prepared P at [0,3] [4,3], K at [1,1] [3,1] | 10 | zombies 11000 |

Shipped z4 (2026-11-24, worlds-4 Task 7): under fog only a plant at column 10 − fog − 0.5 or further forward can hit the zombie base, so at the designed bases nobody lost a star (100% three stars on z4-1..z4-8). The zombie bases are small (z4-1 500, z4-2 600, z4-4 550, z4-5 2000, z4-7 520, z4-8 2000), z4-1 regrows in columns 3–4, z4-8's Peashooters stand at [0,5] [4,5], the Easy computers run ×3.6 / ×2.7 / ×3.3, the enemy bases are 4200 / 11000 / 4200 / 16000 / 10000 / 3800 (z4-2 / 3 / 4 / 5 / 6 / 7), and z4-6's clock is 300 s (ruling 6). z4-7's average 3-star share and its expert lead, z4-2's lead on block 1001 and the z4-4 v z4-6 trend are recorded misses (`KNOWN_MISSES`).

### Step 5: Dark Citadel for the plants, the Backyard finale for the zombies

**Plants, p5 (i 33–40), lava 15 dps.** Lava burns whatever stands on it, both sides, bosses too (ruling 6). Two ideas: never plant on lava; let the zombies stand on it.

| id | kind | lava | the one idea | opponent / script | cards | base hp |
|---|---|---|---|---|---|---|
| p5-1 | survive 150 s | [1,5] [2,6] [3,5] | Lava burns: don't plant on it; zombies burn walking over it | BE + DZ trickle lanes 1–3; flag at 105 s | all 10 | plants 5000 |
| p5-2 | battle | [0,5] [1,6] [2,5] [3,6] [4,5] | A wall just behind the lava: zombies stop on it and burn | Medium ×0.8; BE VFW SW DZ SA HT CZ | 10 | zombies 3000 |
| p5-3 | conveyor 160 s | the p5-2 five + [2,2] | Belt walls behind the lava, never on it | scripted waves; HT + N | belt P W K Mg T Av | plants 6000 |
| p5-4 | battle | p5-2 + [1,1] [3,1] [2,7] | Fewer safe tiles: choose them | Medium ×0.85; + N TZ | 10 | zombies 3000 |
| p5-5 | survive 180 s | as p5-4 | Necromancers heal faster than lava burns: Cherry them | N + SW flags at 70 s and 130 s; BR trickle | 10 | plants 6000 |
| p5-6 | battle | as p5-4 | The crypt's whole army | Medium ×0.9; all ten zombie cards | 10 | zombies 3500 |
| p5-7 | survive 200 s | p5-4 + [0,3] [4,3] | The last stand: Tridents and Brain Rot besiege | TZ + BR flags at 60, 120, 170 s | 10 | plants 6500 |
| p5-8 | boss | [2,4] [2,5] [0,6] [4,6] [1,3] [3,3] | Zombie King (§2), the plant campaign's finale | boss in lane 2 over its own lava; BE trickle | 10 | plants 6000, start energy 700 |

**Zombies, z5 (i 33–40), the Backyard, no twist.** The road home to Lukas's treehouse: world 1's lawn, every card, every kind. The level card's picture is the treehouse growing nearer.

| id | kind | the one idea | opponent / garden | cards | base hp |
|---|---|---|---|---|---|
| z5-1 | battle | All ten zombies: the road to the treehouse | no computer; P, T and Av garden regrowing every 40 s | all 10 | plants 6000, zombies 8000 |
| z5-2 | battle | A Pumpkin Squash leaps on the first zombie: send a cheap Walker ahead | Easy ×1.5; P S W M K Pu | 10 | plants 5000, zombies 4000 |
| z5-3 | breakthrough 240 s | Mines and Squashes: Walkers first, then the big ones | mines at column 6 every lane, Pu at [1,4] [3,4], P behind | 10 | plants 4500, zombies 14000 |
| z5-4 | battle | Torchwood fire lanes: lasso the Torchwood | Easy ×1.6; all ten plant cards | 10 | plants 5000, zombies 4000 |
| z5-5 | conveyor 270 s | The belt with all ten | growing garden | belt all 10 | plants 7500, zombies 9300 |
| z5-6 | breakthrough 240 s | The treehouse wall: Bunkers and fire peas; the Trident pierces, the Brain Rot melts | Av at column 5 in every lane, T + P behind in lanes 1–3 | 10 | plants 4500, zombies 14000 |
| z5-7 | battle | The last battle before the treehouse | Easy ×1.8; all ten plant cards (probe: Easy ×1.5 at i 40 gives average 3★ 57, band 31–51) | 10 | plants 5000, zombies 4000 |
| z5-8 | boss | King Sunflower (§2) at the treehouse | prepared P at [0,3] [4,3], T at [0,2] [4,2] | 10 | zombies 12000 |

## 2. The six bosses

All use the existing toolkit (`slam`, `summon`, `barrage`, `shield`, `strike` with `phases`); hp ranges are where tuning may go. Each model ≤6,000 triangles.

| | Sand Pharaoh (p3-8, zombie) | Cactus King (z3-8, plant) |
|---|---|---|
| Built from | `bipedModel` as `brainTitan.ts`: a Desert Zombie wrapped in bandages, a gold-and-blue striped headdress, a scarab staff; `phaseParts`: glowing eyes | plant kit at half resolution as `elderOak.ts`: a saguaro with two arms, a flower crown, `pupils` that follow, spines |
| Size | scale 2.8, half width 0, lane 2, speed 0.1 | scale 4, half width 1, column 0, guardFactor 0.5 |
| hp | 6500, tune 5500–8000 | 11000, tune 9000–13000 (the Melon shipped at 10500); tuned to 6200 (2026-11-23): inside 9000–13000 the fight ran 5.3–5.8 min and the expert fell under 95% |
| Phase 1 | summon 2 DZ every 9 s; staff slam every 11 s, 1.5 s wind-up, 380/160 | barrage of 3 needles every 9 s, 200, splash 0.75; summon 2 K in columns 1–4 every 12 s (summons skip rocks already) |
| Shield at 0.5 | 7 s sand swirl, ×0.5 (new `sand` variant) | 8 s spine armour, ×0.5 (the `bark` plates recoloured) |
| Phase 2 | **sandstorm**: strike 3 tiles with plants, 2 s wind-up, 50, blind 3 s; summon 2 SW at level 2 wrapped as mummies; slam every 7 s | **rockfall**: strike 3 tiles with zombies, 2.5 s wind-up, 220, no status (boulders fall); barrage of 4; summon 2 W in columns 2–5 |
| How the twist shows | Rocks at [2,2] and [2,4] in its lane: the child plants on the free tiles between | Rocks thin its flanks (lanes 0 and 4): its summons can't land there |
| Tell, and the child's answer | Sand swirls round three plants: they'll be blinded, keep others firing. Answer: a Torchwood with Peashooters behind it in its lane | Shadows grow on three tiles: move on, don't bunch. Answer: spread out, push a flank |
| Stand-ins | expert: P at column 1, T at 3 in its lane (`recipe`, §5); average: 3 P; beginner: nothing | expert: the strike dodge (exists); average and beginner unaware |

| | Yeti (p4-8, zombie) | Glowcap (z4-8, plant) |
|---|---|---|
| Built from | `bipedModel`, bulky: white fur blocks, blue face, two horns, an icicle club; `phaseParts`: frost breath | plant kit, half resolution: a giant glowing mushroom with spots that light, a stalk face, `pupils` |
| Size | scale 3, half width 0, lane 2 (iced: it comes ×1.6 as fast), speed 0.1 | scale 4, half width 1, column 0, guardFactor 0.5 |
| hp | 7500, tune 6500–9000; tuned to 10000 (2026-11-24): the expert's fight ran 1.6–1.8 min at 6500–7500 against the 2.5–5 target, and with the plants' base hitting back an idle player beats a weaker Yeti (7500: 1 of 60 seeds wins at a 9000 base), so base and hp go together (p4-8: base 14000) | 12000, tune 10000–14000; tuned to 19000 (2026-11-24): the expert's fight ran 2.2 min at 14000 against the 2.5–5 target and 2.5–2.6 min at 19000 (the average player 2.8, the beginner 3.1) |
| Shields | at 0.66 and 0.33: 6 s snow fort, ×0.5 (the `dome` recoloured) | at 0.5: 8 s the cap closes, ×0.5 (new `cap` variant: the model's `capL`/`capR`) |
| Phase 1 | summon 3 VFW every 8 s (they slide in lanes 0 and 4); slam every 11 s | barrage of 3 spore bombs every 9 s, 180, splash 1.0; summon 2 P in columns 1–4 every 12 s |
| Phase 2 | **avalanche**: strike 1 lane, 2 s wind-up, 80, stun 2 s; summon 2 VFW at level 2; slam every 7 s | **spore cloud**: strike 4 tiles with zombies, 2.5 s wind-up, 40, poison 4 s at 20 dps; barrage of 4; summon 1 Av in columns 2–5 every 14 s |
| Phase 3 | avalanche on 2 lanes; summon 2 SW at level 2; slam every 6 s | — |
| Twist | ice: the Yeti and its pups arrive early | fog 5: its Peashooters reach only 5 tiles, so zombies get close before they're shot; its own attacks ignore fog |
| Tell / answer | Club raised, red tiles: move plants out. Snow pouring over a lane: that lane freezes. Answer: Pumpkin Squash + Mango-pults in its lane, walls in front | Purple puffs on four tiles: walk round them. Answer: Brain Rot from the mist on its Peashooters |
| Stand-ins | expert: W at column 4, Mg at 2, Pu at 3 in its lane (`recipe`); average: 3 P | expert: the strike dodge |

| | Zombie King (p5-8, zombie; the plants' finale) | King Sunflower (z5-8, plant; the zombies' finale) |
|---|---|---|
| Built from | `bipedModel` as the Titan, bigger: a crystal crown matching Toby's crypt, a purple cape, a scepter; `phaseParts`: the crown lights in phase 2, the cape burns in phase 3 | plant kit, half resolution: a giant Sunflower with a crown and a leaf cape, `pupils`, petals that fold shut (`petalsL`/`petalsR`), standing before Lukas's treehouse |
| Size | scale 3.2, half width 0, lane 2, speed 0.1 | scale 4, half width 1, column 0, guardFactor 0.5 |
| hp | 9000, tune 8000–11000 | 13000, tune 11000–15000 |
| Shields | at 0.66 and 0.33: 7 s crystal dome, ×0.5 | at 0.66 and 0.33: 8 s petals close, ×0.5 (new `petals` variant) |
| Phase 1 | summon 2 BE at level 2 every 8 s; scepter slam every 11 s, 400/180 | barrage of 3 seeds every 9 s, 200; summon 2 P every 12 s |
| Phase 2 | **lava pour**: strike 3 tiles with plants, 2 s wind-up, 60, burn 4 s at 20 dps; summon 1 N every 8 s; slam every 8 s | **sunbeam**: strike 1 lane, 2.5 s wind-up, 100, burn 3 s at 15 dps; barrage of 4; summon 2 W |
| Phase 3 | lava pour on a whole lane, 120; summon 1 TZ every 7 s; slam every 6 s | sunbeam on 2 lanes every 6 s; barrage of 4; summon 1 Pu in columns 2–5 every 14 s |
| Twist | its lane has lava at columns 4–5: a wall at column 3 stops it on the lava and it burns (bosses burn too) | none: the finale is everything Toby learned |
| Tell / answer | Crown glows, three tiles bubble: lift nothing there in time, keep shooting. Answer: make it stand on the lava | Sun gathers in its face, a lane glows gold: send down another lane |
| Stand-ins | expert: W at column 3, Mg and K at 1–2 in its lane (`recipe`); average: 3 P | expert: the strike dodge |

**New code per boss** (as step 2): `BossKey` and `BOSS_HALF_WIDTH` (`src/sim/types.ts`), the side (`src/data/units.ts`), the `bosses` row with `phases` (`src/data/balance.ts`), a `BOSS_LOOK` row (`src/data/bossLooks.ts`), the model (`src/render/models/bosses/<key>.ts`) plus `registry.ts` and `roster.ts`, a call and a defeat sound (`src/audio/sfx.ts`, `bindings.ts`), demo scripts (`src/scenes/bossScript.ts`) and `tools/shots.mjs` scenes.

**`BossFx` additions** (the step-2 generalisation already reads each pattern's wind-up, plays strike clips, has `dome`/`moon`/`bark`/`ice` shields and `shards` defeats):
- Step 3: a `sand` shield (a swirling ring of sand pixels); a `boulder` strike blow (a boulder drops on each tile); `summonLook: 'pups' | 'mummies'` in place of `pups: boolean` (bandaged summons); a shield tint for `bark` (the Cactus's green spines).
- Step 4: a `cap` shield (the model's cap halves); the snow-fort `dome` tint.
- Step 5: a `petals` shield; a `pour` strike blow (lava splash on the tiles); three-phase `phaseParts` (a list per phase).

## 3. Teaching the twists and the new cards

**What already exists:** the twist step `{ show: 'twist'; until: 'tapped' }` with fog and ice pans (`TwistShowKind = 'fog' | 'ice'`), the "tap" glove after 3 s, the twist pictures on the level card for all four twists, boulders and lava in `TwistTiles`, the refusal buzz and shake for a tap on a rock (`'rock'` rejection), and two-step card-then-tile gloves.

**What is missing:**
- Step 3: a **rocks pan** (`TwistShowKind` gains `'rocks'`). The camera eases along the boulders; a ghost Peashooter drops onto a boulder, bounces off with the real refusal buzz and red mark, hops to the free tile beside it and shoots; a ghost Brain Eater walks over the boulder. On a zombie level the same pan, ghost order reversed (the zombie walks first). Ends on any tap.
- Step 3: a step that **waits for a foe**: `after: 'foe'` on a `tile` step waits (no glove, no hold) until an enemy stands within 2 tiles in front of the step's tile, then arms and holds the match as any step does. Needed so the Cherry Bomber lesson lands on a clump, not on empty grass. Reused for the Pumpkin Squash.
- Step 4: nothing new for the twists: p4-1 reuses the ice pan, z4-1 the fog pan (with the zombie ghost walking up to the puff point; a one-line change of which ghost leads).
- Step 5: a **lava pan** (`'lava'`): a ghost plant on a lava tile smokes and flashes, a ghost zombie crosses the lava and burns. And a **hot-tile mark**: while a plant card is held, lava tiles show the red place mark (placement stays allowed, ruling 6; the mark warns, nothing refuses).

**Lessons** (`teaches.ts`):

| level | steps |
|---|---|
| p3-1 | `p3-1.rocks` twist pan |
| p3-4 | `p3-4.torch-card`, `p3-4.torch-tile` T at [2,2], in front of the head-start Peashooter at [2,1] |
| p3-7 | `p3-7.cherry-card`, `p3-7.cherry-tile` C at [2,4] with `after: 'foe'` (the 40 s clump walks lane 2) |
| z3-1 | `z3-1.rocks` twist pan |
| z3-4 | `z3-4.necro-card`, `z3-4.necro-lane` N lane 2 |
| z3-7 | `z3-7.trident-card`, `z3-7.trident-lane` TZ lane 1 |
| p4-1 | `p4-1.ice` twist pan |
| p4-4 | `p4-4.squash-card`, `p4-4.squash-tile` Pu at [1,3] with `after: 'foe'` |
| z4-1 | `z4-1.fog` twist pan |
| z4-4 | `z4-4.rot-card`, `z4-4.rot-lane` BR lane 2 |
| p5-1 | `p5-1.lava` twist pan |

The unlock levels (p3-3, p3-6, p4-3, z3-3, z3-6, z4-3) get no steps: the result screen's turntable shows the new unit. World 5 teaches nothing new. Every glove tile is free of rocks and lava; a test checks it with `match.check`.

**The campaign endings (Step 5).** Pictures, music and the boys' portraits; no words needed.
- **Lukas (p5-8 won the first time):** the King falls, Toby's crystal crypt cracks and crumbles into crystal blocks, the ten plants cheer on the island in a row, Lukas's portrait drops in a gold frame with confetti, then a trophy stands on the Citadel island of the map from then on.
- **Toby (z5-8 won the first time):** King Sunflower bows and shrinks to a seed, the ten zombies climb the treehouse ladder, a brain flag with Toby's portrait goes up on the roof, confetti, then a trophy on the map's Backyard island.
- Both: one big HOME button (≥64 px tap target, with its picture); any tap after 4 s also goes on; the scene replays from the trophy. "Won" comes from the save's stars (`stars['p5-8'] > 0`), so no new save key and no database rules publish.

## 4. Balance targets

Average-player target `88 − 48·(i−9)/31`, ±8 (boss 5 lower); zombie star band `75 − 35·(i−9)/31` ±10 (ruling 5, as z2-5..7).

| i | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 (boss) |
|---|---|---|---|---|---|---|---|---|
| plant win band | 67.6–83.6 | 66.1–82.1 | 64.5–80.5 | 63.0–79.0 | 61.4–77.4 | 59.9–75.9 | 58.3–74.3 | 51.8–72.8 |
| zombie 3★ band | 56.0–76.0 | 54.8–74.8 | 53.7–73.7 | 52.6–72.6 | 51.5–71.5 | 50.3–70.3 | 49.2–69.2 | boss 38–58 |

| i | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 (boss) |
|---|---|---|---|---|---|---|---|---|
| plant win band | 55.2–71.2 | 53.7–69.7 | 52.1–68.1 | 50.6–66.6 | 49.0–65.0 | 47.5–63.5 | 45.9–61.9 | 39.4–60.4 |
| zombie 3★ band | 46.9–66.9 | 45.8–65.8 | 44.7–64.7 | 43.5–63.5 | 42.4–62.4 | 41.3–61.3 | 40.2–60.2 | boss 29–49 |

| i | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 (boss) |
|---|---|---|---|---|---|---|---|---|
| plant win band | 42.8–58.8 | 41.3–57.3 | 39.7–55.7 | 38.2–54.2 | 36.6–52.6 | 35.1–51.1 | 33.5–49.5 | 27.0–48.0 |
| zombie 3★ band | 37.9–57.9 | 36.8–56.8 | 35.6–55.6 | 34.5–54.5 | 33.4–53.4 | 32.3–52.3 | 31.1–51.1 | boss 20–40 |

On every level: expert ≥95%, every seed ends, median length 1.5–4 min (boss 5), an idle player loses, no level harder for the average player than the one two after it (the 1-point slack per block).
- **Plants:** held to the win band. There is no beginner floor after world 2 (ruling 11), which frees the world-2 collision: the average can now be pushed into his band. Where the expert floor and the band cannot both hold, keep the expert floor and record the average miss (as ruling 6 did for the beginner).
- **Zombies:** held to the star band on every non-boss level (average still wins ≥85%, expert three-stars ≥10 points more often). Boss 3★ bands fall by world: 38–58, 29–49, 20–40 (world 1/2's 35–60 shifted with the curve). **New floor for Toby:** the beginner on Easy wins ≥60% on z3 and ≥50% on z4–z5 (a tightening, recorded like the others; spec §18's "Toby cannot be left stuck").

### 4.1 Pilots run for this design (2026-11-22, live main 39b6833)

A throwaway battle at i 18 (world 3, n 2; the real p1/p2/z1/z2 levels before it set unlocks and the average player's upgrades), 200 seeds, 3 workers. Plants: 7 cards against Medium with 7 zombie cards, zombie base 2500. Zombies: 7 cards against Easy with 7 plant cards, bases 5000 / 3800. Plant table: average / expert win %. Zombie table: average win % (3★ %) / beginner win %.

| rocks (plants side) | Medium ×0.4 avg / expert | ×0.6 avg / expert | ×0.8 avg / expert |
|---|---|---|---|
| none | 100 / 100 | 92.5 / 100 | 62.0 / 93.0 |
| 4 middle | 100 / 100 | 92.5 / 99.5 | 58.0 / 93.5 |
| 8 middle | 100 / 100 | 93.5 / 99.0 | 54.5 / 91.5 |
| 5 back row (cols 0–1) | 100 / 100 | **76.0 / 96.5** | 40.0 / 72.5 |
| 10 (back row + 5 middle) | 99.5 / 100 | 79.0 / 96.5 | 37.0 / 73.5 |
| 12 spread | 98.5 / 100 | 79.5 / 96.0 | 27.0 / 66.5 |

| rocks (zombies side) | Easy ×1.0 avg win (3★) / beginner win | ×1.5 | ×2.0 |
|---|---|---|---|
| none | 100 (78.5) / 94.5 | 98.5 (64.0) / 86.5 | 93.5 (41.5) / 76.5 |
| 4 middle | 99.5 (78.5) / 94.5 | 98.0 (65.0) / 88.5 | 94.5 (40.5) / 81.5 |
| 5 back row | 100 (86.0) / 96.0 | 99.0 (74.0) / 93.0 | **99.5 (66.5) / 91.5**, expert 3★ 89 |
| 12 spread | 100 (87.0) / 98.0 | 99.5 (76.0) / 95.0 | 99.0 (66.0) / 89.5 |

What decided the defaults:
- **Where, not how many.** Middle rocks move the average ≤4 points at any income; five back-row rocks cost him 16.5 points at ×0.6 and the expert only 3.5. So the lesson level (p3-1) uses three middle rocks (gentle), and from p3-2 on every plant level has a rocky back row; density beyond 5–6 adds little.
- **p3-2 = Medium ×0.6 with the back row** sits inside its band (76.0 in 66.1–82.1) with the expert at 96.5. ×0.8 breaks the expert (72.5).
- **Rocks are a gift to Toby.** On the zombie side the back row raises the average's 3★ by 7.5–25 points, so z3 can run the computer at Easy ×2.0 (z2 ran ×1.0–1.25) and still keep the beginner at 91.5% wins. z3-2 at ×2.0 lands in its star band (66.5 in 54.8–74.8).

The late-campaign probe (`tools/probe-gap.ts`, i 40, all ten cards a side):

| plants, lava, vs Medium | ×0.6 | ×0.7 | ×0.8 | ×0.9 | ×1.0 |
|---|---|---|---|---|---|
| average win (3★) | 93.5 (43.0) | 87.5 (31.5) | 78.5 (20.0) | 69.0 (10.5) | 53.0 (6.0) |
| expert win | 99.5 | 98.5 | 98.5 | 94.5 | 89.0 |

| zombies, no twist, vs Easy | ×0.55 | ×1.0 | ×1.5 |
|---|---|---|---|
| beginner win | 99.0 | 98.0 | 84.0 |
| average win (3★) | 100 (94.0) | 100 (77.0) | 94.0 (57.0) |
| expert win (3★) | 100 (100) | 100 (95.0) | 100 (81.0) |

- **Plants:** with the expert held at ≥95%, the average cannot go below about 69–70% at i 40 (a faster-thinking expert, `--strong '{"table":{"thinkEvery":15}}'`, adds one point). The win band is reachable through about i 27 (p4-3); from p4-4 on the average will sit above his band. The stars carry the difficulty there (his 3★ falls to ~10% while the expert keeps 70%). This is **Needs Michal 1**.
- **Zombies:** Medium breaks the expert (84% at ×0.4), so Toby's computer stays Easy and its income carries the curve; the star band is reachable to the end (Easy ≈×1.8 at i 39–40 for a 3★ share near 40).

## 5. What exists versus what's needed

**Already there:** all five level kinds, `LevelTwist` with rocks, fog (per-level reach), ice lanes and lava tiles; rocks and lava in the sim with `checkLawn`; boulders, mist, ice and lava drawn by `TwistTiles`; the five world looks, weather, music, the map's five islands per side; twist pictures on the level card; twist-aware computer and stand-ins (no plant on a rock or lava); boss `phases`, `strike` with blind/stun/burn/poison and `target: 'tiles' | 'lanes'`; the generalised `BossFx`; `BOSS_ANSWER`, the zombie expert's strike dodge; `levels-w3/4/5.test.ts` (run `curveBandTests`, today `it.todo`); `tools/levels.ts --world N`; `probe-gap.ts --twist rocks|lava`.

**Needed, Step 3:**
1. **Bands for worlds 3–5** (`src/ai/levelChecks.ts`, `tests/ai/long/levelBands.ts`): `worldTwoGate` becomes `levelGate(def)` for worlds 2–5 (plants: win; zombies: stars; bosses: boss band); `bossStarBand(world)` (35–60, 38–58, 29–49, 20–40); `beginnerWinMin(i, side)` adds the zombie floor 60/50; `curveBandTests` gains the star/boss bands, the idle check, the trend check and the record table that world 2 has (one function for worlds 2–5).
2. **Rocks pan and `after: 'foe'`**: `src/adventure/types.ts` (the `after` value), `src/app/tutorial.ts` (`TwistShowKind` `'rocks'`, the foe wait), `src/render/world/TwistTiles.ts` (the ghosts), `src/app/levelSession.ts` if the pan needs the side.
3. **Two bosses** and the step-3 `BossFx` additions (§2).
4. **`BossAnswer.recipe`** (`src/ai/levelStandIns.ts`): an ordered list of `[card, col]` the sensible player plants in the boss's lane, for answers that combine cards (Torchwood in front of Peashooters); Titan and Howler entries unchanged.
5. **Level files** `src/adventure/levels/{p3,z3}.ts`, joined in `index.ts`; lessons in `teaches.ts`; `tests/adventure/{p3,z3,world3}.test.ts`.
6. **Free Play**: a graduate now holds 9 cards a side; re-measure its bands (the parked "survive runs too long with the Avocado line" will grow with the Torchwood).

**Needed, Step 4:** keys `yeti`, `glowcap`; the `cap` shield; p4/z4 files and lessons (no new twist code); the zombie fog pan's ghost order; boss three-phase test for the Yeti (`atHealth` of two marks already drives `phases`).

**Needed, Step 5:** keys `zombieKing`, `kingSunflower`; `petals` shield, `pour` blow, per-phase `phaseParts`; the lava pan and the hot-tile mark (`src/render/world/PlaceMarks.ts`); the two ending scenes (a new `src/scenes/ending.ts` played by `ResultOverlay` on a first win of p5-8 / z5-8; trophy on the map island in `mapModel.ts`/`Map.tsx`); p5/z5 files.

## 6. Tasks

### Step 3 in detail

| # | Task | Files | Produces | Worktree |
|---|---|---|---|---|
| T1 | Foundation | `src/sim/types.ts` (`BossKey` += `sandPharaoh`, `cactusKing`; half widths 0, 1), `src/data/units.ts`, `src/data/balance.ts` (**stub** rows from §2 phase-1 numbers with valid `phases`), `src/data/bossLooks.ts` (stub rows reusing the Titan/Oak looks), `src/render/models/registry.ts` (reuse Titan/Oak models), `src/adventure/types.ts` (`after: 'foe'`), empty `p3.ts`/`z3.ts` joined in `index.ts`, `tests/adventure/world3.test.ts` | keys and types for everyone; golden hash and `noTwistReplay` untouched | base, first |
| T2 | Boss visuals | `bosses/sandPharaoh.ts`, `bosses/cactusKing.ts`, `registry.ts`, `roster.ts`, `bossLooks.ts` rows, `BossFx.ts` (`sand` shield, `boulder` blow, `summonLook`, `bark` tint), `sfx.ts` + `bindings.ts` (`pharaohCall`, `pharaohDefeat`, `cactusCreak`, `cactusDefeat`), `bossScript.ts`, `tools/shots.mjs`, `tests/render/bosses/*` | both models ≤6,000 triangles; entrance, wind-ups, strike, shield, phase 2, defeat | render |
| T3 | Rocks teaching | `tutorial.ts` (`'rocks'`, `after: 'foe'`), `TwistTiles.ts` (rock ghosts), `levelSession.ts`, `teaches.ts` (p3-1, p3-4, p3-7, z3-1, z3-4, z3-7), `tests/app/*`, `e2e/twists.spec.ts` | the pan (ends on any tap, "tap" glove at 3 s) and the foe wait (never freezes: a foe that dies before it arms lets the step wait again; the step lets go after the hold cap) | UI |
| T4 | Boss numbers and stand-ins | `balance.ts` (`bosses.sandPharaoh`, `bosses.cactusKing` only), `levelStandIns.ts` (`recipe`, the Pharaoh's entries), `tests/sim/boss*`, `tests/ai/*` | tunable bosses; world 1–2 boss stand-in results unchanged | sim |
| T5 | Bands | `levelChecks.ts`, `levelBands.ts`, `tests/ai/levelChecks.test.ts` | `levelGate`, `bossStarBand`, zombie beginner floor; worlds 2–5 share one band function; world 2's results and `KNOWN_MISSES` unchanged | measure |
| T6 | Plant levels | `p3.ts`, `tests/adventure/p3.test.ts` | p3-1..8, tuned | levels-p |
| T7 | Zombie levels | `z3.ts`, `tests/adventure/z3.test.ts` | z3-1..8, tuned | levels-z |
| T8 | Three-block measurement | `levelBands.ts` (`KNOWN_MISSES`, Free Play bands) | the honest list of misses; Free Play re-measured with 9 cards | measure |
| T9 | Proof | `e2e/*` (a `desert.spec.ts` as `tundra.spec.ts`), `README.md` | release | merged branch |

**Merge order:** T1; then T2–T5 in parallel (no shared files: T4 touches only the two `bosses` rows, T2 only `bossLooks` rows and render); merge T4 and T5; then T6 and T7 (written in parallel, tuned one at a time: T6's tuning finishes before T7's starts); then T2 and T3; then T8; then T9; then a whole-branch review (Opus or Sonnet). Implementers on the top model (Michal, 2026-11-16: worlds content on Fable), reviewers on Opus/Sonnet.

**Commands:**
- Tuning: `npx tsx tools/levels.ts --world 3 --only 'p3-'` (then `'z3-'`), `--set bosses.sandPharaoh.hp=6500`; never two tuning runs, at most 3 workers.
- Rocks pilot to re-check a layout: `npx tsx tools/probe-gap.ts --twist rocks --skills medium --incomes 0.5,0.6,0.7` (the probe's rocks are middle rocks; for the back row, use a level and `tools/levels.ts`).
- Bands: `LVT_BALANCE=1 LVT_BLOCKS=3 npx vitest run tests/ai/long/levels-w3 --maxWorkers=3`; world 2 again to prove T5 moved nothing: `tests/ai/long/levels-w2`.
- Full checks: `npm run test:balance`, `npm run test:balance:core`, `npx tsc --noEmit`, vitest twice.
- e2e, both projects, lid open on power, under `caffeinate -i`: world 3's islands open after p2-8/z2-8 and not before; p3-1's and z3-1's pans end on a tap; a tap on a rock buzzes and places nothing; the Cherry glove appears only when the clump arrives; both unlock reveals per side; both bosses start, reach phase 2 and end; ten level↔map round trips on one WebGL context.
- Shots: each boss's entrance, wind-up, strike, shield, phase 2 and defeat; the Desert on both sides at the three iPad sizes. A five-year-old walk-through of z3-1..z3-3 and the Cactus King by taps only.
- `npm run perf`: Pharaoh with dust and rocks, Cactus King with dust and rocks, DPR 1 and 2.
- The nine-battle no-twist replay stays identical.

### Step 4 outline (own plan when Step 3 lands)
1. Keys `yeti`, `glowcap` with stubs; `cap` shield, snow `dome` tint; models and sounds.
2. Lessons: p4-1 ice pan (exists), z4-1 fog pan with the zombie ghost leading; gloves p4-4 (Pu, `after: 'foe'`), z4-4 (BR).
3. Boss numbers; `recipe` for the Yeti; a three-phase test (two shield marks).
4. Levels `p4.ts`, `z4.ts`; tuning one side at a time; three-block measurement; Free Play with 10 cards a side.
5. Proof: `tundra-plants.spec.ts`, `meadow-zombies.spec.ts`, perf for the Yeti in snow and Glowcap in fog with fireflies.

### Step 5 outline (own plan when Step 4 lands)
1. Keys `zombieKing`, `kingSunflower`; `petals`, `pour`, per-phase `phaseParts`; models (the King's crown matches the crypt base model's crystals; the Sunflower stands in front of the treehouse base model).
2. Lava pan and the hot-tile mark; p5-1 lesson.
3. The ending scenes and map trophies (no save key: read from stars).
4. Levels `p5.ts`, `z5.ts`; tuning; three blocks; Free Play.
5. Proof: both finales played through to the ending scene and back to the map; the ending replays from the trophy; perf of the King with lava glow and embers (the heaviest scene in the game).

## 7. Risks and open choices (with my default)

1. **Plants' late curve unreachable** (§4.1: ~69–70% at i 40 with the expert at 95%). Default: tune each plant level to the lowest average the expert floor allows; from p4-4 on record the average miss in `KNOWN_MISSES` and also hold his 3★ share to the zombie-style star band so difficulty still rises. Needs Michal (loosening).
2. **Zombie star band for all of worlds 3–5** extends step-2 ruling 5 (already live on z2-5..8). Default: keep it; the win numbers are recorded either way.
3. **Breakthroughs too short / not telling the stand-ins apart** (z1-3, z1-6, z2-3 are known misses). Default: 240 s clocks, a trap lane in each (the mined thin flank on z3-6, the cap-6 wall on z4-3), and record misses rather than lengthen past Toby's 3 minutes.
4. **Toby gets too strong a computer** at Easy ×2.0 on z3 if the rocks are moved. Default: the beginner floor (60% on z3, 50% on z4–z5) is a band, so a rock change that drops him fails a test.
5. **The foe wait misses its clump** (a mine or a pea kills it first). Default: the clump is 3–4 Brain Eaters/Skeletons walking a lane with nothing planted in front of the glove tile at the start; if the step's foe dies before it arms, it keeps waiting for the next one; the 150 s clump is the last chance, after which the step is skipped silently (never a freeze).
6. **Free Play survive runs grow longer** with Torchwood and Pumpkin Squash (already 14–18% of average runs over 20 min). Default: re-measure in each T8 and propose the wave-rule fix from the step-2 Task 9 report; not changed in these steps.
7. **Perf**: three-phase bosses with lava glow and embers are the heaviest scene; headroom at DPR 2 was 0–0.7 ms. Default: ≤6,000 triangles per boss, summons capped by the existing caps, measure on a quiet machine.
8. **Other open choices, decided:**
   - unlocks at i 19, 22, 27 (ruling 7), none in world 5: yes
   - rocks: three middle rocks on the lesson level, a rocky back row from level 2 on (pilot): yes
   - fog for the zombies' Meadow ramps 7→5 as the plants' did: yes
   - the Yeti walks an iced lane: yes; the Zombie King's lane has its own lava: yes
   - Torchwood and Pumpkin Squash get gloves; the Cherry and the Squash use `after: 'foe'`: yes
   - endings from stars, no new save key, no rules publish: yes
   - file names `p3.ts`…`z5.ts`, boss keys `sandPharaoh`, `cactusKing`, `yeti`, `glowcap`, `zombieKing`, `kingSunflower`: yes

### Needs Michal
1. **The plants' last levels.** Measured: with the expert winning 95%, Lukas's stand-in can't be pushed below about 70% wins by the last level (the plan said ~40%). My default: from p4-4 on, accept his win rate where it lands (recorded as misses) and make the stars harder instead (his 3-star share falls toward ~40%). The alternative is letting the expert drop to 90% on world 5. Either loosens a spec §10 threshold, so it is your call.

### Critical Files for Implementation
- /Users/michaglio/Projects/worktrees/lukas-vs-toby-worlds35/src/adventure/levels/p2.ts and z2.ts (format of the new `p3`…`z5` files; `helpers.ts` for `trickle`/`flag`/`garden`/`regrow`)
- /Users/michaglio/Projects/worktrees/lukas-vs-toby-worlds35/src/data/balance.ts (`bosses`, `twists`)
- /Users/michaglio/Projects/worktrees/lukas-vs-toby-worlds35/src/app/tutorial.ts (`TwistShowKind`, the `after` wait)
- /Users/michaglio/Projects/worktrees/lukas-vs-toby-worlds35/src/ai/levelChecks.ts and tests/ai/long/levelBands.ts (`worldTwoGate` → `levelGate`, boss and beginner bands)
- /Users/michaglio/Projects/worktrees/lukas-vs-toby-worlds35/src/ai/levelStandIns.ts (`BOSS_ANSWER`, `recipe`)
- /Users/michaglio/Projects/worktrees/lukas-vs-toby-worlds35/src/render/battle/BossFx.ts and src/data/bossLooks.ts (new shield and blow variants)
