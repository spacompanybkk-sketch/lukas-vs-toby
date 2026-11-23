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
| `npm run test:balance` | The long level checks (`tests/ai/long/levels-w1` … `levels-w5` and `freePlay`, three workers, a few minutes): every Adventure level of every world, and Free Play, played by the level stand-ins on one seed block (seeds 1–200), against its win and star bands |
| `LVT_BLOCKS=3 npm run test:balance` | The same on three seed blocks (1–200, 1001–1200, 2001–2200; about three times as long). Required before a world ships |
| `npm run test:balance:core` | The long checks of the core game, apart from the levels (`tests/ai/long/core`, `humans`, `picks`, `spam*`, `spell*`): Quick Battle difficulty, spam, picks and spells. Run it when a unit, hero, spell or Quick Battle number changes |
| `npx tsx tools/levels.ts` | The level tool: every level with every stand-in, as a table of win and star rates. `--world 2` only world 2's levels (both sides), `--only p1-3,z1-8`, `--who average`, `--free` for Free Play, `--first 1001` for the second seed block, `--set path=value` to try a Balance number. See the note at the top of the file |
| `npm run build:live` / `npm run check:live` | A build for the real cloud, and the check that `dist/` is one (a plain build is the fake cloud and shows a test-tube badge on the title) |
| `npm run shots -- <scenario...>` | Screenshots into `artifacts/shots/` (add `--headed` to watch) |
| `npm run e2e` | Browser tests (Playwright, Chromium: `desktop` and `ipad` projects). Builds and serves its own copy on port 5314, so a dev server can keep running |
| `npm run perf` | Frame-rate measurement (headed Chromium, port 5315 or `LVT_PERF_PORT`): the phase-1 stress crowd (60 and 150 units) and the mixed roster (`mix-150`), device scale 1 and 2, plus the time to draw the twenty card portraits; prints the budget verdict (unthrottled frame ≤ 10 ms at scale 1, ≤ 16.6 ms at scale 2, on the MacBook Air M3) and writes `artifacts/perf.json`. `--modes=novsync --scenes=mix-150` for a short run; `--scenes=mix-150-citadel` (or `-backyard`, `-meadow`, `-desert`, `-tundra`) measures the crowd in a world's look with its weather and twist tiles. Every line prints the machine's load average: a number taken at a load over 4 does not count. It measures a Mac, never an iPad (see `?fps` below) |
| `npm run sim:smoke` | Balance report without drawing anything (about a minute): computer against computer, one-card spam and merge-spam, the difficulty stand-ins, merge value. See below |
| `npx tsx tools/tune.ts` | The balance tuner: a scorecard of every balance target, or a search over chosen knobs (`--search spec.json`). See the note at the top of the file |

`?scene=stress&units=<n>` fills the real battle view with `n` fighting units for the performance tool;
add `&mix` for the mixed roster (all 21 kinds, all ten shot kinds, puddles, statuses, rocks, a spell
and a hero power always firing).
`npm run shots -- title battle-busy hud-plants result-win` takes the named screenshots;
`world-<key>`, `world-<key>-lawn`, `-crowd`, `-game` and `-marks` show each world's look.
`?world=<key>` dresses the lawn, stress and battle-demo scenes as a world (with its sample twist;
`&twist=0` for none).
`?scene=boot` shows the spinning-cube renderer check.

`window.__lvt` holds test hooks (`await __lvt.ready` resolves after the scene's first frame). It is
there in the dev server, and in a production build only when the address has `?debug`
(`/?debug`, `/?scene=stress&debug&units=60`); every e2e test and tool adds it, and `cloud=fake`
as well. Among them: `__lvt.setWorld('desert')` dresses the stage as a world (with its sample
twist, or the lawn config given) until the next screen change, and
`__lvt.previewWorlds(true, [2, 3, 4, 5])` puts stand-in worlds on the Adventure map (copies of
world 1 carrying each arena's twist) on every world that has no real levels yet; a world with
real levels (the Moonlit Meadow, the Frozen Tundra, the Desert Canyon) is never copied over. The twist and map e2e
play the stand-ins.

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

## Adventure

Home → **Play** → **Adventure** → a side opens that side's map: one island per world, with a
path of eight stones across it (Lukas's plant levels `p1-1` … `p1-8`, Toby's zombie levels
`z1-1` … `z1-8`; see **Worlds** below for the other islands). A stone shows the level's kind, its number, the stars won and, when winning
it brings a new unit, that unit's silhouette with a "?". The player's picture hops on the next
stone. A tap on a stone opens the level card: the cards dealt, the enemies, what each star asks,
the reward, a big play button, three skull pictures for the difficulty, and a glove button that plays the
level's tutorial again. Guests get Quick Battle only. Levels are data:
`src/adventure/levels/backyard.ts` (the lessons in `teaches.ts`), the rules in `src/adventure/`.

**Five kinds of level**

| Kind | What the player does |
|--|--|
| Battle | Knock down the other base, against scripted arrivals or a computer player |
| Survive | Plants hold out until the clock runs down; the zombie base cannot fall |
| Breakthrough | Zombies break a prepared garden's base before the clock runs out |
| Conveyor | No energy: cards come along a belt, and whatever it brings is played for free |
| Boss | A boss with its own bar (see below) |

A level's goal shows at the top: a clock bar that drains (with the waves' flags riding on it), or
a wave bar when there is no clock; the boss bar under it in a boss level.

**Stars.** One for winning, a second and a third for keeping the player's base healthy (for
Breakthrough, which has no player base: for time left on the clock). The level card draws what
each star asks. Stars never go down.

**Coins.** Every star pays the first time it is earned on a level; winning a level again pays a
little; a loss pays a consolation. Coins buy upgrades in the Marketplace, which no level needs.
The amounts are in `src/adventure/rewards.ts`. A result is saved exactly once, also across a
reload on the result screen.

**Unlocks.** Each side starts Adventure with its first three cards; level 3 and level 6 of the
Backyard each bring the next card (plants: Potato Mine, Kernel-pult; zombies: Desert Zombie,
Skeleton Archer), level 3 and level 6 of the Moonlit Meadow the next two plants (Mango-pult,
Avocado Bunker), and level 3 and level 6 of the Frozen Tundra the next two zombies (Hot Topic,
Cowboy Zombie). The Desert Canyon brings one more of each at level 3 and level 6: the plants the
Torchwood and the Cherry Bomber, the zombies the Necromancer and the Trident Zombie. Each is shown
turning on a turntable on the result screen. A level deals only the
cards it lists that the player has. Quick Battle always has all ten.

**Difficulty.** One, two or three skulls on the level card (EASY, NORMAL, HARD; kept per player
and side; Toby starts on Easy) change only the player's income. It is Adventure's own
(`adventureDifficulty` in the save, also used by Free Play): changing it never changes Quick
Battle's, and a save from before it existed starts with a copy of Quick Battle's. A Conveyor level
has no energy, so it shows none.

**The tutorial.** No words: a white glove points at one thing at a time (a card, then the tile
or lane to put it on; the hero's button when it is first ready; a spell at level 4; the front belt
card, then a tile, at level 5, the conveyor), the rest of
the screen dims a little and the match waits until the child does it. Taps elsewhere do nothing.
The glove only waits for something that can be done now (a card still recharging is not pointed
at). Levels 1–3 of each side teach this way; each step is remembered for the player. The hero's
button appears only from the level that teaches it (level 2).

**Where a card may go.** While a card is picked (tapped or dragged), every tile it may go on shows
thin pixel corner brackets (zombies: the spawn end of each lane), worked out by the match's own
check; under the glove only the lesson's tile lights. A rock tile never lights. A lava tile may
be planted on, so it lights, but with thick orange brackets inked black: you can, but it burns.

A second tap on the card already in hand puts a plant card down, but on the zombie side it does nothing: Toby's card stays in hand for the next send.

**The bosses.** Level 8 of each side. Lukas meets the **Brain Titan**, who walks the middle lane,
slams the plants in front of him and puts up a shield that peas bounce off (lobbed shots still
hurt). Toby meets the **Elder Oak**, who guards the plant base across the middle lanes, lobs
acorns, grows Peashooters and armours up. The boss bar shows the boss's face and its health in
blocks, with a notch where its shield comes up; a short face card announces the boss beside the
bar (a tap skips it).

## Worlds

The Adventure travels five worlds. Lukas's plants go **Backyard → Meadow → Desert → Tundra →
Citadel**; Toby's zombies come the other way, so his world 1 is the Citadel (`arenaOf` in
`src/data/worlds.ts`). Each side has three worlds of levels so far: the plants the Backyard, the
Moonlit Meadow and the Desert Canyon, the zombies the Citadel, the Frozen Tundra and the Desert
Canyon (all below); world 4 on is a padlocked island. The level ids keep each side's own order
(`p2-…` is the Meadow, `z2-…` the Tundra, `p3-…` and `z3-…` the Desert on either side).

| World | Look | Weather | Twist | Music |
|--|--|--|--|--|
| Backyard | The green toy garden | none | none | The Backyard tune |
| Meadow | Night blues, a moon, mushrooms | Fireflies | Fog | A soft minor lullaby |
| Desert | Orange mesas and cacti | Dust | Rocks | Phrygian |
| Tundra | White and blue, ice crystals | Snow | Ice | Bright, sparse bells |
| Citadel | Dark stone, lava glow, obsidian | Embers | Lava | Low and driving |

A world is data (`WORLDS`); the looks are `src/render/world/looks.ts` (art in
`docs/art-bible.md`), the tunes `src/audio/music.ts`. Zombie world 1 (z1-…) is played on the
Citadel look to the Citadel tune, with its lava off. Quick Battle, Versus and Free Play are always
the Backyard with no twist. All the worlds share the page's one WebGL context; changing world
frees what the old look built.

### Moonlit Meadow (plants, world 2)

Lukas's second world, `p2-1` … `p2-8` (`src/adventure/levels/p2.ts`), opens when he has won p1-8
(the result's next-level button leads straight on to p2-1). It is night: night-blue grass, a moon,
mushrooms, mist over the lawn, fireflies, and the Meadow's own soft minor tune.

**Fog.** In the Meadow every shot reaches only so many tiles, and the mist closes in level by
level: 7, 7, 6, 6, 5, 5, 5, 5 (`twist: { fog: 7 }` on each level; `fog: true` would use
`Balance.twists.fog.reach`). A shot that gives out fades in a puff of mist, so shooters must stand
further forward to reach the zombie base. The level card shows a small fog cloud.

**The fog lesson.** p2-1 opens without a word: the match holds and the camera eases in on one
lane, where a see-through Peashooter shoots a pea that flies into a bank of mist and vanishes in
a white pixel puff at that level's reach; the lane past it is darker. Any tap ends it (it is
remembered; the glove on the level card shows it again). If nobody taps, a glove taps the lawn
after 3 seconds; Pause still works. p2-4 and p2-7 teach their new card as the Backyard does: the
glove points at the card, then at a tile.

| Level | Kind | Fog | What it is about |
|--|--|--|--|
| p2-1 | Survive | 7 | The fog lesson; Brain Eaters trickle in |
| p2-2 | Battle | 7 | A shooter must stand at column 3 or further to hit the base |
| p2-3 | Conveyor | 6 | Walls in front of forward shooters; **unlocks the Mango-pult** |
| p2-4 | Battle | 6 | The Mango-pult's splash (card lesson) |
| p2-5 | Survive | 5 | Shields stop peas, lob over them |
| p2-6 | Battle | 5 | Guard forward shooters with a wall; **unlocks the Avocado Bunker** |
| p2-7 | Survive | 5 | The Avocado Bunker holds the line (card lesson) |
| p2-8 | Boss | 5 | The Moon Howler |

**The Moon Howler** (p2-8) walks the middle lane, a wolf-eared Brain Eater with a moon pendant.
In his first phase he slams the plants in front of him (red warning tiles first) and calls pups,
Very Fast Walkers with little wolf ears. At half health a glowing **moon dome** goes up for a
while: straight shots (peas) bounce off it, lobbed shots from the pults still hurt him. Then his
second phase: a crescent glows over his head and his eyes light up, and he **howls**: one lane
blinks with dark smoke for two seconds, then every plant in it is blinded for four (their shots
miss). He keeps slamming and calls Brain Eaters too. His bar shows his face; a face card announces
him. Numbers: `Balance.bosses.moonHowler`; looks: `src/render/models/bosses/moonHowler.ts` and
`BOSS_LOOK.moonHowler`.

### Frozen Tundra (zombies, world 2)

Toby's second world, `z2-1` … `z2-8` (`src/adventure/levels/z2.ts`), opens when he has won z1-8
(the result's next-level button leads straight on to z2-1). It is white and blue: snow on the
ground and in the air, ice crystals, and the Tundra's bright bells. Short and forgiving: these are
the younger player's levels.

**Ice.** Some lanes of each level are sheets of ice (`twist: { iceLanes: [...] }`): everything
that walks moves ×1.6 as fast there (`Balance.twists.ice.speed`), so a zombie sent down a shiny
lane arrives first and is shot at for less time. The level card shows a small ice crystal.

**The ice lesson.** z2-1 opens without a word: the match holds and the camera eases in on two
lanes, where a see-through Brain Eater slides down the pulsing icy lane with its arms up and
skids to a stop in a puff of snow while another is still walking the plain lane beside it. Any
tap ends it (it is remembered; the glove on the level card shows it again). If nobody taps, a
glove taps the lawn after 3 seconds; Pause still works. z2-4 and z2-7 teach their new card as the
Citadel does: the glove points at the card, then at a lane.

| Level | Kind | Icy lanes | What it is about |
|--|--|--|--|
| z2-1 | Battle | 2 | The ice lesson; no computer, three Peashooters and two more every 40 s |
| z2-2 | Battle | 1, 3 | Pick the icy lanes (Easy computer) |
| z2-3 | Breakthrough 240 s | 2 | The iced middle lane gets there before the peas do their work; **unlocks Hot Topic** |
| z2-4 | Battle | 1, 3 | Hot Topic grows by eating plants (card lesson) |
| z2-5 | Conveyor 270 s | 0, 2, 4 | The belt, and a garden that grows a Peashooter every 12 s |
| z2-6 | Breakthrough 240 s | 0, 2, 4 | Mines under the ice; the lane with the fewest plants is a trap; **unlocks the Cowboy Zombie** |
| z2-7 | Battle | 0, 1, 3, 4 | The Cowboy lassos the big plant (card lesson; Medium computer on low income) |
| z2-8 | Boss | 0, 1, 3, 4 | The Frost Melon |

**The Frost Melon** (z2-8) is a great green watermelon lying across lanes 1 to 3 in front of the
plant base, on the plain middle lane, under a cap of snow and a crown of icicles, a catapult on
its back. In its first phase the catapult lobs **frozen melons** (blue, striped; each has a red
landing mark first) and it grows Peashooters. At half health two **ice plates** clap shut over
it for a while and every hit counts half. Then its second phase: glowing cracks, icicles and
eyes alight, and it **freezes**: its crown lights up and two whole lanes blink deep navy inside
white frames for 2.5 seconds, then every zombie in them is hurt a little and stands frozen for
two. It keeps lobbing and grows Walnut Bombs. Its bar is ice blue with its face; a face card
announces it. Numbers: `Balance.bosses.frostMelon`; looks:
`src/render/models/bosses/frostMelon.ts` and `BOSS_LOOK.frostMelon`.

**Where the levels depart from the content design's starting numbers** (all measured with
`tools/levels.ts --world 2`; the reasons are in the step-2 Task 7 and Task 9b reports):

- Clocks: the breakthroughs 240 s (design 120 / 150), the conveyor 270 s (design 150). The short
  clocks made levels of under a minute.
- z2-5's garden grows instead of regrowing; z2-6's trap is one level-3 Walnut Bomb in each plain lane.
- Base health (plants / zombies; the design's in brackets): z2-1 5500 / 7000 (3500 / 12000),
  z2-2 5000 / 3800 (3500 / default), z2-3 5000 / 14000 (1200 / default), z2-4 5500 / 4000
  (4000 / default), z2-5 7000 / 9300 (4500 / 10000), z2-6 3800 / 14000 (900 / default), z2-7
  3000 / 4000 (3000 / default), z2-8 default / 11000 (default / default); the default is 6000. Why:
  the zombie base is what the stars count on a zombie level, and the plant base is how long the
  level lasts. With the design's bases on the shipped gardens and clocks (seeds 1-60) the average
  player takes three stars on 98-100% of seeds on z2-1 to z2-6 (shipped: 68-95%) and z2-3 lasts
  him under a minute (0.97 min; shipped 1.76); z2-7's default zombie base gives the expert three
  stars on 98% (shipped 92%); and on z2-8 the default zombie base, shot at by the garden all
  through a long fight, leaves the average player three stars on 3% (shipped 50%).
- The Frost Melon: 10500 health (design 5000–7500) and its phase-2 Walnut Bombs every 12 s
  (design 6 s), so walls do not stall a beginner's fight.

### Desert Canyon (both sides, world 3)

The third world, `p3-1` … `p3-8` for Lukas (`src/adventure/levels/p3.ts`) and `z3-1` … `z3-8` for
Toby (`z3.ts`), opens when the side has won p2-8 / z2-8 (the result's next-level button leads
straight on; before that the island is grey with a padlock). Orange mesas, cacti, drifting dust and
a Phrygian tune.

**Rocks.** Some tiles of each level are boulders (`twist: { rocks: [...] }`): a plant cannot stand
on a rock (the tile never lights for a picked card; a tap on it buzzes and plants nothing; the belt,
the Rock Wall and a plant boss's summons keep off it too). Zombies and shots pass over a rock, the
shots of its own lane included, so a Torchwood behind a rock still lights the peas that fly over
it. On a zombie level the rocks stand in the computer's garden, so they help Toby: the rocky lanes
hold fewer plants ("go where the rocks are"). The level card shows a small boulder.

**The rocks lesson.** p3-1 and z3-1 open without a word: the match holds and the camera moves along
the boulders. On the plants' side a see-through Peashooter is refused on one (a buzz) and hops
beside it; on the zombies' side a see-through Brain Eater goes first and walks straight over a
rock. Any tap ends it (it is remembered; the glove on the level card shows it again). If nobody
taps, a glove taps the lawn after 3 seconds; Pause still works. p3-4 / z3-4 and p3-7 / z3-7 teach
their new card by the glove: the card, then the tile (a lane for the zombies). The Cherry Bomber's
tile step waits: its glove, and the pause behind it, come only when the 40 s clump walking lane 2
is in front of the tile, so the blast lands on the clump and not on empty sand.

| Level | Plants (Lukas): kind | What it is about | Zombies (Toby): kind | What it is about |
|--|--|--|--|--|
| 1 | Survive 150 s | The rocks lesson; three middle rocks | Battle | The rocks lesson; the flanks (lanes 0 and 4) are thin, no computer |
| 2 | Battle | The back row is rocky: Sunflowers go where the ground is free | Battle | The plants' back row is rocky, so few Sunflowers (Easy computer) |
| 3 | Conveyor | Belt walls fill the gaps the rocks leave; **unlocks the Torchwood** | Breakthrough 275 s | A rock where a wall should stand leaves a hole; **unlocks the Necromancer** |
| 4 | Battle | A Torchwood in front of a Peashooter makes fire peas (card lesson) | Battle | The Necromancer mends from behind its Bone Minions (card lesson) |
| 5 | Survive 160 s | Fire peas beat shields; a Torchwood behind a rock still lights peas | Conveyor 270 s | The belt, and a garden that cannot grow on rocks |
| 6 | Battle | One fire lane per pair of lanes; **unlocks the Cherry Bomber** | Breakthrough 255 s | A Skeleton in front and a Necromancer behind outlast a Bunker; **unlocks the Trident Zombie** |
| 7 | Survive 170 s | A Cherry Bomber on a clump (card lesson, waits for the foe) | Battle | The Trident's throw pierces three plants in a row (card lesson) |
| 8 | Boss | The Sand Pharaoh | Boss | The Cactus King |

**The Sand Pharaoh** (p3-8) walks the middle lane: a gold-and-blue headdress over a green face in
bandages, a staff in his hand. In his first phase he slams the plants in front of him with the
staff (red warning tiles first) and calls two Desert Zombies. At half health a **swirl of sand**
goes up round his feet for seven seconds and every hit counts half (it is sand, not glass: a
different picture from the Howler's dome). His second phase lights his eyes: he raises a
**sandstorm** over three plants (a whirl of dark brown dust in cream frames for two seconds, then
those plants are blinded for three), and calls Skeleton Warriors wrapped as **mummies**. Numbers:
`Balance.bosses.sandPharaoh`; looks: `src/render/models/bosses/sandPharaoh.ts` and
`BOSS_LOOK.sandPharaoh`.

**The Cactus King** (z3-8) stands across lanes 1 to 3 in front of the plant base under a crown of
pink flowers, no rock under him (the rocks stand in lanes 0 and 4). In his first phase his arms
throw **needles** (long green spikes, each with a red landing mark first) and he grows
Kernel-pults. At half health his **spine plates** clap shut for eight seconds and every hit counts
half. His second phase is the **rockfall**: three zombie tiles blink red in orange rings while red-
orange boulders hang over them, then drop. He keeps throwing needles and grows Walnut Bombs. The
boulders are warm red-orange so that no one takes them for a rock tile. Numbers:
`Balance.bosses.cactusKing`; looks: `src/render/models/bosses/cactusKing.ts` and
`BOSS_LOOK.cactusKing`.

**Where the levels depart from the content design's starting numbers** (measured with
`tools/levels.ts --world 3`): the zombie breakthroughs run 275 s and 255 s (design 240 s: the
average player three-starred 30-48% at 240 s); the bases are tuned per level in `p3.ts` and
`z3.ts`, each with its reason in a comment. What the three-block measurement still misses is
recorded in `KNOWN_MISSES` (`tests/ai/long/levelBands.ts`); `npm run test:balance` expects those
misses.

**The four twists.** A level names its twist tiles (`LevelDef.twist`); how strong each one is
lives in `Balance.twists`. Both sides are affected the same way.

| Twist | What it does | How it looks |
|--|--|--|
| Rocks | A rock tile takes no plant: no card, no belt card, no Rock Wall, no plant boss's summon. Zombies and shots pass it | A boulder on the tile; the tile never lights for a picked card |
| Fog | Straight, piercing and untargeted lobbed shots fade out a few tiles from where they were fired, so a shooter at the back cannot reach the far base. Heroes, spells and boss attacks are not affected | Low mist over the lawn; a puff where a shot fades |
| Ice | Zombies, bosses included, walk faster down an icy lane | A blue checker of ice along the lane |
| Lava | Whatever stands on a lava tile burns, plants and zombies, bosses included. Planting there is allowed | A glowing pool in a basalt crust; orange brackets when a card is picked |

A level file that puts a plant on a rock, lists a lane twice or gives fog no reach is refused when
the level is built. The computer players never place on a rock and keep plants off lava while a
plain tile is free.

**Bosses** may change their attacks at each shield mark (phases) and can use a generic strike:
it announces tiles or lanes with blinking warning tiles, then hits them (Titan and Oak fight as
before; the Moon Howler, the Frost Melon, the Sand Pharaoh and the Cactus King use both). A boss that falls mid wind-up takes its
warning with it.

**The map.** One island per world, in the side's own order, with wooden arrow pictures to step
between them; it opens on the world of the next level. An open island is the world's real look
(the stage's own lawn, with its weather); the other islands float in the sky, earlier worlds on
the left. A world without levels yet (or whose first level is not open) is grey with a padlock:
no stones, and a tap on the padlock only shakes it. A level card shows a small picture of the
level's twist (fog cloud, boulder, ice crystal, lava drop).

## Free Play

Home → **Play** → **Free Play** → a side, straight into an endless run with the player's
Adventure cards and Marketplace upgrades:

- **Plants: survive.** Waves come one after another, each bigger, and the zombie base cannot
  fall. A flag counter counts the waves; a ring fills to the next wave; a banner announces each
  wave and its biggest unit.
- **Zombies: breakthrough.** Break one garden after another against the clock; each broken
  garden adds time. The counter counts the gardens broken.

The run ends when the player's base falls (or the clock runs out); **Quit** in the pause menu
ends it the same way, showing first what it banks. Coins are paid for each wave (or garden)
cleared; the best wave and the best garden are kept, with a crown when beaten, and the best wave
goes on the leaderboard. There is no Restart in a run's pause menu: Quit is its one way out.

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
| `/?scene=boss-demo&boss=brainTitan` | A boss on the real lawn (`elderOak` for the Oak, `moonHowler` for the Howler in the Meadow, `frostMelon` for the Melon on the Tundra's ice, `sandPharaoh` and `cactusKing` in the Desert's rocks and dust; `&table=shipped` plays the shipped numbers) |

In a production build (`npm run preview`, port 5274) the same addresses work; add `&debug` for
the test hooks.

## Versus on two devices

Two children, two devices, one battle: Lukas on the iPad, Toby on the MacBook (or the other way
round). It runs on the same Realtime Database REST calls as the saves, no Cloud Functions, no
Firebase SDK, no sign-in. Spec: `docs/superpowers/specs/2026-11-18-versus-two-devices-design.md`.

### How to play

1. **Play menu, fourth tile** (two tablets and crossed swords). Every player who is logged in may
   play; a guest (nobody logged in) sees the padlock and a buzz.
2. **Who is here**: a row of big faces of the players whose device is on a menu right now.
   A face in a battle is greyed with a swords badge. Tap a face to open the invite card.
3. **Invite card**: both faces, each with the sun (plants) or brain (zombies) of the side he plays,
   a swap button, the head start as 0 to 5 pictures with a minus and a plus, a green swords button
   to send and a red cross to close. The invited boy gets the same card on any menu screen as a
   panel from the top, with a green tick and a red cross. No answer for 60 s closes it.
4. **Getting ready**: both faces and a bar of three blocks (connected, both ready, same game
   version). Two different builds start no match and both show the update picture, which reloads
   once.
5. **Battle**: his side's cards on his tray. A tap sprouts a short puff, then the unit is there on
   both screens at the same game tick (lockstep with an input delay chosen from the measured round
   trips, 12 ticks when there are too few samples). A hash is compared every second; a mismatch
   makes the host write a snapshot and the guest takes it (up to three repairs, then the match is
   called unfinished). A device that stops answering gets an hourglass after 1 s, a dimmed lawn
   with a sleeping face after 3 s, and a white flag after 90 s (the white flag deletes the match, nobody is credited, and the other
   device later shows it as unfinished).
6. **Pause** pauses both screens. The pause menu's door is a white flag (giving up).
7. **Result**: the winner's face with a crown, the scoreboard strip, rematch (sides swapped, same
   head start owner) or home. A rematch is a new match number; it needs both players' ticks.

### Rules and head start

All ten cards of the side at standard strength, no Marketplace upgrades, two spells dealt from the
match seed, heroes on, no twist, Backyard look, sudden death on, no 2X speed. First base to fall
loses. No coins. Each device credits only its own logged-in player, once per match
(`lastBattle` is `vs-<match id>`); a forfeit credits the other player; an unfinished match credits
nobody.

Toby (`p02`) gets a head start against anyone, nobody else does; either boy can change it on the
card. One step is +50 starting energy and +0.1 on the trickle multiplier
(`incomeMultiplier = (10 + step) / 10`). `DEFAULT_HEAD_STEP` (`src/ai/versus.ts`) seeds the card:
the smallest step at which a random-tapping child stand-in wins at least 40% against the adult
stand-in, or 5 if none does (`tests/ai/long/versusHeadStart.test.ts`, `LVT_BALANCE=1`, seeds
1 to 200, child win rate, measured 2026-11-21):

| step | 0 | 1 | 2 | 3 | 4 | 5 | default |
|------|------|-------|-------|-------|-------|-------|---------|
| child as plants | 0.5% | 0.0% | 0.5% | 0.0% | 0.0% | 0.0% | 5 (no step reaches 40%) |
| child as zombies | 7.5% | 15.0% | 28.0% | 42.5% | 58.5% | 74.0% | 3 |

### Who may play

Every player that exists (a `v2/players/<slot>` record) may play Versus; there is no grown-up
tick any more. The rules check exactly that (`allowed(S)` in `tools/build-rules.mjs`), and a
stranger without a player record still cannot appear in "who is here", invite, be invited or
create a match. A guest (nobody logged in) has no pin proof, so the Versus tile stays locked.

### What is stored

Under `v2/vs` (and the same under `v2test/vs`, both made by `tools/build-rules.mjs` from one
function):

- `allowed/<slot>`: unused since every player may play (the node is still granted by the rules).
- `here/<slot>`: `{at, busy}`, a heartbeat every 15 s while on a menu; a device that stops for 40 s
  drops off the list.
- `lobby/<owner>/in/<from>` and `lobby/<owner>/back/<from>`: an invite (public key, side, head
  start, build) and the reply. The writer is always `<from>`.
- `matches/<id>`: `meta` (written once at accept: seed, seats, host, head start, turn, delay,
  build, test), `ready`, `pause`, `turns/<seat>/t<n>` (the commands of one turn, at most 400
  characters), `sync/s1..s3` (repair snapshots), `end/<seat>`, `again/<seat>`. A forfeit is an `end/<seat>`
  record whose winner is `quit` (written by the pause menu's white flag); the rules still define a
  `quit` node but nothing writes or reads it. The match id
  is a hash of the two players' ECDH shared secret, so a third device cannot guess it. A match is
  deleted when it is over; nothing about it stays in the cloud.

Under `v2/proof/<slot>/<pin hash>/touch`: the per-write proof of who is writing. The pin is never
stored or logged, only its hash, as for the saves; every Versus write carries a fresh `touch`
equal to the database clock (`now`).

### Debug parameters

`vsquick`, `vstest` and `vsbuild` work only with `?debug`; `fakedb` needs fake mode but not `?debug`.

| Parameter | Effect |
|-----------|--------|
| `cloud=fake` | The fake cloud (the default for a non-live build; a live build defaults to the real cloud). |
| `fakedb=http://localhost:<port>` | Use the local fake database server below instead of the in-page fake; the `v2test` root is used. Only `http://localhost:<port>` and `http://127.0.0.1:<port>` are accepted. |
| `vsquick` | Divides every Versus timeout by 30, so waits take a second instead of a minute. |
| `vstest=<1..500>` | Sets `meta.test`: both bases get that health, so a match ends in seconds. Allowed by the rules only under `v2test`, so it works only together with `fakedb` or `cloud=test` (the in-page fake uses `v2` and refuses it). |
| `vsbuild=<hex>` | Overrides the build id (7 to 12 hex digits) so two pages can be put on different builds. |

### The fake database server

`npx tsx tools/fake-rtdb-server.ts --port 5316` (default `$LVT_FAKEDB_PORT`, else 5316) is a stand-in
for the Realtime Database REST API: one `FakeDatabase` that checks every request against
`database.rules.json`, behind HTTP with server-sent events, so two browser pages share one
database. There is no Firebase emulator here (no Java). It listens on loopback only, refuses other
origins, and never touches the real database. `GET /__peek?path=...` shows a stored value;
`POST /__reset` empties it. `e2e/versus.spec.ts` starts it on its own and plays two pages
against each other; its screenshot tour goes to `artifacts/shots/`.

### Publish checklist (owner only; no agent runs any of it)

1. Confirm `v2/players` lists only the players who should be able to play Versus (every player may now).
2. Back up the currently deployed rules (Firebase console → Realtime Database → Rules → copy, or the Firebase MCP `firebase_get_security_rules`) to `artifacts/rules-backup-<date>.json`.
3. From an up-to-date checkout of the merged branch: `node tools/build-rules.mjs --check`, then `firebase deploy --only database`.
4. `LVT_TEST_GROWNUP_CODE=<code> node tools/rules-check.mjs --yes-live` against `v2test`: every row passes, the new Versus rows included. Any surprise: deploy the backup at once.
5. One scripted two-window run on `?debug&cloud=test`: note the measured round trips and the chosen delay; confirm the stream event shapes, `startAt`/`endAt` on streams and `cancel` match the fake. Also note (Task 10) how deleting a match reaches a ranged root listener: `gone` fires for a `put` of `null` at `/` and for a removal of `meta`, so either shape works; only a shape that does neither would need a code change.
6. Optional, with go-ahead: install Playwright WebKit; run the determinism golden and `e2e/versus.spec.ts` in a WebKit project.
7. `npm run build:live` then `npm run check:live` (must print `dist/ is live`), then the hosting deploy.
8. Hands-on with the two iPads (Safari, last year's model) and the MacBook: invite, play, sleep one iPad, rematch.

Status on 2026-11-22: step 6 (WebKit) was skipped by the owner. Step 1 was checked read-only: `v2/players` lists `p01` Lukas and `p02` Toby.

## Hosting and old builds

`firebase.json` serves `index.html`, the extensionless app addresses and `cloud-mode.txt` with
`Cache-Control: no-cache`, so an iPad asks for the newest page every time, and the content-hashed
files under `/assets/` for a year, immutable. The card portraits under `/portraits/` are not hashed
and keep the host's default caching.

A build that is still cached somewhere may meet a save written by a newer build (a key it does not
know, such as `adventureDifficulty`) and cannot read it. When that happens at the pin pad, on a
device that has no copy of that player, the page reloads itself once to fetch the current build
(once per browser session, and only while online). Everywhere else such a save is refused as
before; it never reloads mid-play. Update the devices together when the save gains a key.

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
