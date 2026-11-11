# Lukas Plants vs Toby Zombies — 3D Rebuild Design

Date: 2026-11-11. Branch: `rebuild-3d`. Worktree: `~/Projects/worktrees/lukas-vs-toby-rebuild`.

## 1. Intent

Michal wants the boys' game rebuilt to feel close to a real iOS or desktop game: great
graphics, lots of motion, many levels, a Lukas-vs-Toby mode, and unit costs that are
fair for what each unit does. He allowed scrapping the old code as long as the spirit
of the game stays. It is for computers only.

The current game (Astro + Phaser, April 2026) falls short in ways a patch cannot fix:

- Units are static DALL·E pictures with baked dark backgrounds; nothing animates.
- There is no sound.
- Several abilities exist only as constants (Torchwood, Necromancer heal, butter stun,
  sand blind, Hot Topic growth are never applied).
- Merging multiplies HP, damage and attack rate by the level, so a level 5 unit hits
  25 times harder for 5 times the price.
- 155 MB of sprites, a plain HTML lobby, and layout tuned for phones.

## 2. The spirit that stays

Everything in this list is kept, by Michal's instruction to keep the spirit:

- Lukas is the plants (green, garden). Toby is the zombies (purple, graveyard). Either
  boy can still choose to play the other side.
- A 5-lane by 10-column lawn with a base at each end. Plants stand still and shoot;
  zombies walk from right to left. First base to fall loses.
- The same 20 units with the same names and the same prices (section 6.6).
- Drag a card onto the lawn to place it. Drop a card on the same unit to merge it up,
  to a maximum of level 5, and the unit looks more impressive at every level.
- Lukie Coins and Toby Dollars, the Marketplace with permanent unit upgrades, campaign
  progress, unlocking units as you go.
- Modes: Campaign, Play vs AI, Free Play, and challenging your brother.
- The blocky, Minecraft-like look and the two boys' portraits.

## 3. Goals, non-goals, anti-goals

Goals

1. A 3D presentation with fully animated units, effects, camera work and sound that a
   child would take for a shop-bought game.
2. Both sides win about half the time at equal skill, and every unit is worth its price.
3. Many levels: two campaigns of 40 levels each.
4. Lukas vs Toby on one computer and across two computers.
5. Proof, not opinion: automated balance, level, netcode, end-to-end and performance
   checks with committed thresholds.

Non-goals

- Phones, tablets, touch input.
- Gamepads (the input layer must not prevent adding them later).
- Accounts, strangers, chat, leaderboards beyond the two brothers.
- Languages other than English.
- A level editor.
- Paid or AI-generated bitmap art; no paid APIs are called by the game or the build.

Anti-goals (these make it a failure even if it runs)

- One side or one unit that reliably wins. "Toby always wins" is the worst outcome.
- Shop upgrades deciding a Lukas-vs-Toby match.
- Matches that never end.
- Screens a child has to read paragraphs to use.
- Dropped frames, input lag, or effects so busy the lawn cannot be read.
- Gore or anything frightening. Zombies are goofy.

## 4. Constraints

- Runs in desktop Safari and Chromium browsers (the family Mac has Safari and Brave).
  WebGL2 is required.
- Reference machine: MacBook Air M3, 8 GB RAM, 2880×1864 display. 60 fps there.
- Static build, deployable to the existing Firebase Hosting site
  (`lukas-toby-plants-vs-zombies`). Nothing is deployed without Michal saying so.
- Online play uses the existing Realtime Database and only the three paths its rules
  already allow (`presence`, `rooms`, `challenges`), so no rules deploy is needed.
- No Java on this machine, so the Firebase emulator is unavailable; tests use an
  in-memory transport.
- The old game stays untouched on `main`, including Michal's uncommitted spring edits.

## 5. Decisions

Michal decided: computer only; scrap and rebuild is allowed; keep the spirit; many
levels; a Lukas-vs-Toby mode; balance of cost against return matters; it must be tested.

Everything below is my call, made because he asked me to act rather than ask. Each can
be reversed.

| Call | Why |
|------|-----|
| Real-time 3D with Three.js, voxel characters built in code | The only way to get every unit animated, consistent and evolving without an art team. Keeps the blocky look. |
| Vite + TypeScript single-page app; Astro, Phaser, Tailwind removed | A 3D game needs none of them. |
| HUD and menus in HTML/CSS (Preact) over the canvas | Crisp text and proper desktop UI. |
| All art and sound generated in code | No licences, tiny download, everything animatable. Recorded CC0 audio may be added if synthesis falls short. |
| Rules run in a deterministic simulation separate from drawing | The same code plays the game, runs balance tests in bulk, and keeps two computers in sync. |
| Versus built both ways: one keyboard and two computers | Not asked which; both are cheap once the simulation takes commands. |
| Zombie auto-merge removed; both sides merge by dropping a card | Same rule for both boys; merging stays a choice. |
| Zombies earn Brains mainly by destroying plants | Zombies had no Sunflower. Plants grow their income, zombies eat for theirs. |
| One hero power per boy | A comeback tool and a moment each boy owns. |
| Old save data converted, old coins kept | The boys do not lose what they earned. |
| "Video playability" read as smooth, cinematic play plus a replay of the winning blow | Flagged to Michal as a reading, not a fact. |

## 6. Game rules

Numbers in this section are starting values. The balance tuner (section 10) owns the
final values. Prices are the exception: they stay as listed unless a unit cannot reach
the fair band any other way, and then move only in steps of 25.

### 6.1 Lawn and bases

- 5 lanes, 10 columns. Column 0 is next to the plant base (left), column 9 next to the
  zombie base (right). Moving things have a continuous position along the lane.
- Plants are placed on empty tiles in columns 0–7, one per tile.
- Zombies are sent into a lane and rise at the right edge (columns 8–9 are the
  graveyard strip; plants cannot be placed there).
- Each base has one pool of health and four visible damage states, then collapses.

### 6.2 Energy

- Plants spend Sun, zombies spend Brains. Both get a steady trickle; the zombies' is
  the larger one, because they have no Sunflower (phase 1 ships 1.8 a second for plants
  and 6 for zombies; phase 3 revisits the split between trickle and bounty).
- Sunflowers add Sun on a timer.
- Destroying an enemy unit pays a bounty that is a share of everything spent on it,
  merges included. The zombie share is the larger one; it is their main income.
- Each card has a recharge time after use.

### 6.3 Merging and levels

- Dropping a card on your own unit of the same type, below level 5, raises its level
  for the card's price. Health percentage carries over.
- Starting scale: health and damage multiply by the level; attack rate does not change.
  Special values (Sun output, blast damage, heal) scale the same way.
- Target: a level-N unit is worth between 1.00 and 1.15 times N separate units.
- Five looks per unit: base, bigger with more detail, iron-armoured, crystal with glow,
  golden legendary with an aura.

### 6.4 Combat

- Attack kinds: melee, straight shot (stops at the first enemy), lobbed shot (lands on
  a tile, ignores shields), piercing shot (passes through several), none.
- A unit attacks the nearest enemy ahead of it in its lane within range. A zombie in
  range of the plant base attacks the base.
- The plant base fights back. A zombie that has reached the base and is biting it is
  struck by the base on a timer, one zombie per lane at a time. A zombie that slips
  down an empty lane therefore costs some base health and then dies, instead of biting
  for the rest of the match. (Added 2026-11-11: the first computer-vs-computer runs
  showed that plants, which only shoot towards the zombies, could never hit a zombie
  that had got past them, so one early leak decided most matches.)
- Plants hit the zombie base with shots, as in the old game. Every plant whose shot
  reaches the whole lane (Peashooter, Kernel-pult, Mango-pult) keeps firing when its
  lane holds no zombie, and those shots land on the zombie base at a reduced damage
  factor. A straight shot whose target dies in flight carries on the same way.
- Statuses: stun (cannot act), blind (attacks miss), tied (cannot act, visible lasso),
  poison and burn (damage over time), heal.
- Zombies may overlap in a lane; they are drawn slightly offset so a stack reads.

### 6.5 Match end

- A base at zero health loses.
- Sudden death starts at 6:00: both bases lose health at the same rising rate, so the
  healthier base wins. A match cannot last past about 8:00. Same-tick double knockout
  is a draw.

### 6.6 Units

Plants (Lukas)

| Unit | Price | Role | Behaviour |
|------|-------|------|-----------|
| Sunflower | 50 | Income | Makes Sun on a timer. Fragile. No attack. |
| Peashooter | 100 | Basic shooter | Straight pea, whole lane. |
| Walnut Bomb | 75 | Wall | High health. Explodes when destroyed, hurting zombies around it. |
| Potato Mine | 25 | Trap | Arms after a delay, then blows up under the first zombie to touch it. |
| Kernel-pult | 75 | Control | Fast lobbed kernels. 30% are butter: stun for 2 s. |
| Mango-pult | 100 | Area damage | Slow heavy lobbed mango with a small splash. |
| Avocado Bunker | 125 | Fortress | Very high health plus armour that shaves every hit. |
| Torchwood | 100 | Support | Peas passing through it catch fire: double damage and a burn. |
| Cherry Bomber | 150 | Removal | One-second fuse, then a large blast. Gone afterwards. |
| Pumpkin Squash | 175 | Bruiser | Leaps on the nearest zombie within 2 tiles and crushes that tile, then recovers. |

Zombies (Toby)

| Unit | Price | Role | Behaviour |
|------|-------|------|-----------|
| Brain Eater | 100 | Basic | Throws brains at short range, bites hard up close. |
| Very Fast Walker | 50 | Rush | Fast, weak. Sets off mines, pressures empty lanes. |
| Skeleton Warrior | 125 | Tank | Shield blocks one straight shot every 4 s. |
| Desert Zombie | 100 | Control | Throws sand: light damage, blinds the plant for 3 s. |
| Skeleton Archer | 100 | Sniper | Long range, fragile, stops at range. |
| Hot Topic | 75 | Snowball | Fast bites. Grows permanently, and visibly, with each plant it eats. |
| Cowboy Zombie | 125 | Disabler | Pistol at mid range. Lassos the strongest plant within 5 tiles: tied for 3 s. |
| Necromancer | 150 | Support | Hangs back. Heals zombies around it; raises a Bone Minion every 10 s. |
| Trident Zombie | 150 | Siege | Whole-lane heavy throw that pierces up to 3 plants. Slow. |
| Brain Rot | 175 | Area denial | Lobs rot from long range, leaving a poison puddle for 4 s. |

Unlock order is today's order: Peashooter, Sunflower, Walnut Bomb, then Potato Mine,
Kernel-pult, Mango-pult, Avocado Bunker, Torchwood, Cherry Bomber, Pumpkin Squash; and
Brain Eater, Very Fast Walker, Skeleton Warrior, then Desert Zombie, Skeleton Archer,
Hot Topic, Cowboy Zombie, Necromancer, Trident Zombie, Brain Rot. The last unlock lands
by level 30 of 40.

### 6.7 Hero powers

Each charges on a timer and is aimed at one lane, with a full-screen flourish.

- Lukas: Mega Mower. A giant mower tears down the lane and damages every zombie in it.
- Toby: Bone Storm. Bones and lightning rain down the lane and damage every plant in it.

Damage is a fixed amount, not a kill. The two are tuned separately.

## 7. Modes

| Mode | What it is |
|------|------------|
| Adventure | The two campaigns (section 8). |
| Quick Battle | Today's "Play vs AI": either side against the computer on Easy, Medium or Hard. |
| Free Play | Endless escalating waves; best wave count saved per boy. |
| Versus, same computer | Lukas and Toby on one keyboard, or one on the mouse. |
| Versus, two computers | Online challenge, as today, through Firebase. |

Versus rules: standard unit strength (shop upgrades never apply), all ten units each,
a rematch button that swaps sides, a head start for one boy (10 to 50% more income in
steps of 10; on for Toby by default, see section 18), and a brothers' scoreboard that
both computers see.

## 8. Campaigns

- Two campaigns of 5 worlds × 8 levels: 80 levels. Level 8 of each world is a boss.
- The plant campaign travels Backyard → Moonlit Meadow → Desert Canyon → Frozen Tundra
  → Dark Citadel. The zombie campaign travels the same five worlds in reverse, ending
  at Lukas's treehouse.
- Each world has its own colours, props, weather, music, and one lawn twist used by its
  levels: none (Backyard), fog that shortens range (Meadow), rocks blocking tiles
  (Desert), ice lanes where zombies move faster (Tundra), lava tiles that burn whatever
  stands on them (Citadel). Versus arenas use the worlds' looks with twists switched off.
- Level kinds: Battle (both bases, computer opponent), Survive (plants hold out against
  scripted waves) or Breakthrough (zombies crack a prepared garden against the clock),
  Conveyor (cards arrive on a belt, no energy), and Boss.
- Bosses are oversized units built from the regular rigs with extra parts and two or
  three attack patterns from a shared toolkit (lane slam, summon, barrage, shield phase).
- Stars: one for winning, two with the base above half health, three above 80%.
- Coins are paid per star the first time; a small amount on replays and on losses.
- The first levels teach by doing, with a pointing hand and almost no text.

## 9. Progress and saves

- One save per boy in the browser: coins, stars, unlocks, Marketplace upgrades,
  settings, best Free Play wave, and wins against his brother.
- Marketplace as today: ten upgrade steps per unit, each adding health and damage.
  Applies in Adventure, Quick Battle and Free Play. Never in Versus.
- Almanac: every unlocked unit on a 3D turntable with its role, stat bars and five looks.
- Old saves (`lpvtz_save_lukas`, `lpvtz_save_toby`) are read once. Coins carry over.
  Old upgrade levels are refunded as the coins they cost (level n cost 100 × n(n+1)/2)
  rather than kept, so the new levels are not flattened by old +100% units. Campaign
  progress restarts because the levels are new.

## 10. Balance

All tunable numbers live in one data module. A command-line harness plays matches
between computer players without drawing anything, and writes a report.

Computer players: three skill tiers, plus fixed strategies (rush, economy, turtle,
counter-picker, balanced, and one "only this unit" spammer per unit).

Reported per run: side win rates by skill tier; each unit's cost efficiency from
equal-budget lane duels against every enemy unit; the change in win rate when a unit is
removed from a side's hand; spam win rates; match length; comeback rate; merge value.

A tuner adjusts stats inside designer limits until the targets hold. The final numbers
and report are committed, and a reduced fixed-seed version runs as a test.

Thresholds (Versus rules, equal skill):

| Measure | Target |
|---------|--------|
| Plants win rate, each skill tier, 2,000+ matches | 47–53% |
| Any single-unit spam against the balanced player | wins under 55% |
| Removing any one unit from its side | costs that side 1.5 to 8 points of win rate |
| Unit cost efficiency | within 12% of its side's median |
| Level-N merge value against N separate units | 1.00–1.15 |
| Median match length | 3–6 minutes; 95% under 9 |
| Side behind at 2:00 still wins | at least 20% |
| Matches without a winner | 0, apart from true double knockouts |

How the measures apply:

- Cost efficiency from lane duels is measured only for units that fight on their own:
  Peashooter, Kernel-pult, Mango-pult, Pumpkin Squash, and every zombie except
  Necromancer.
- One-use units (Potato Mine, Cherry Bomber, and Walnut Bomb's blast) are measured by
  what they destroy: the average enemy spend removed per use must be 0.9 to 1.5 times
  their own price.
- Sunflower is exempt from the removal band, since it is the plants' income. Its check
  is that the best number of Sunflowers to own is between 2 and 6: players told to
  build none, or ten, lose to players who build three to five.
- Torchwood, Avocado Bunker, Walnut Bomb and Necromancer are judged by the removal band
  alone.

When a threshold and a rule in section 6 cannot both hold, change in this order: the
unit's numbers, then its price, then the detail of its behaviour while keeping its name
and role. Thresholds are not loosened without telling Michal.

Campaign levels are checked the same way with three stand-in players (a beginner, an
average player, an expert), on Normal difficulty. The expert wins at least 95%
everywhere without any Marketplace upgrades. The average player, buying upgrades at the
rate the level rewards allow, sees a win rate that falls smoothly from about 90% in
world 1 to about 40% at the last level. No level is harder than the one two after it.
In Quick Battle the computer beats the average stand-in about 15% of the time on Easy,
45% on Medium and 70% on Hard. (These targets were raised a notch on Michal's
instruction; see section 18, item 4.)
Each boy can set his own Adventure to Easy, Normal or Hard at any time; Easy and Hard
change only income, by 25% either way.

## 11. Look and motion

Direction: a bright toy diorama. Crossy Road-style voxel characters, floating-island
battlefield, soft shadows, saturated colour. Lukas's tree fortress on the left, Toby's
crystal crypt on the right, as in today's base art.

- Characters are rigs of voxel parts defined in code (head, body, limbs, props; plants
  have pot or roots, stem, head, leaves). Each level adds parts and materials.
- Every unit has: idle (breathing, blinking), move, attack with wind-up and release,
  hit flinch with flash, spawn (plants sprout from soil, zombies claw out of a grave),
  merge evolution, death (plants wilt and burst into voxels, zombies crumble), cheer.
- Effects: voxel debris, projectile trails, impact sparks, explosions with shockwave
  rings, fire, poison bubbles, sand clouds, heal motes, status icons, floating damage
  and energy numbers, Sun and Brains flying to the counter.
- Feel: screen shake, brief hit-stop on heavy blows, slow motion on the winning blow.
- Camera: level intro fly-in, slight mouse parallax, punch-in on explosions and hero
  powers, a replay of the winning blow, victory orbit.
- World life: swaying grass, drifting clouds, fireflies, snow, embers, animated water
  and lava, bases that smoke and crumble as they lose health.
- Rendering: shadow-mapped sun, hemisphere fill, ambient occlusion, bloom
  on glowing parts, light depth of field, vignette, per-world colour grade. Resolution
  scales down automatically before the frame rate drops.
- UI: chunky toy-like panels and buttons, bouncy transitions, card portraits rendered
  from the real 3D models, recharge sweeps, hotkey labels, hover tooltips. Fonts are
  bundled, not fetched.
- Readability rules: effects never hide health bars or the card tray; each side keeps
  its colour family; a lane is readable at a glance with 15 units in it.

Budget: 60 fps on the reference machine with 150 units, 200 projectiles and 2,000
particles on screen. First load under 3 seconds locally. No bitmap sprite sheets.

## 12. Audio

Web Audio only. Synthesised effects with pitch variation for every action (place,
shoot, hit, chomp, explode, merge, coin, button, power, win, lose). Music is sequenced
in code: a menu theme and one theme per world that adds layers as the battle heats up,
plus victory and defeat stings. Separate music and effects volume, and mute.

## 13. Architecture

Layers, each depending only on those above it:

1. `sim` — pure rules. Fixed 30 steps per second, seeded random numbers, commands in,
   events out, whole state serialisable. No DOM, no Three.js, no clock, no
   `Math.random`. Only basic arithmetic and `Math.sqrt`/`floor`/`abs`/`min`/`max`, so two
   browsers compute identical results.
2. `data` — unit stats, balance table, worlds, levels.
3. `ai` — computer players that read simulation state and issue commands.
4. `net` — a transport interface with two implementations (Firebase, in-memory) and a
   session that keeps two simulations in step.
5. `render` and `audio` — draw and play what the simulation reports, interpolating
   between steps.
6. `ui` and `app` — screens, HUD, input, saves, settings.
7. `tools` — balance harness, tuner, level checker, screenshot tour.

Online play: the challenger hosts. Both computers run the same simulation. The guest
sends its commands to the host; the host stamps every command (its own included, with
the same fixed delay) with the step it applies on and publishes one ordered list. A
state checksum goes out every few seconds; on a mismatch the guest reloads the host's
snapshot. Leaving the tab pauses the match for both; a dropped connection shows a
waiting screen and resumes from a snapshot.

The old game, if a boy still has it open, listens on `presence/lukas`,
`presence/toby`, `challenges/<name>` and `rooms`. The new game therefore writes only
under `presence/v2`, `challenges/v2` and `rooms/v2`, which the existing rules still
allow. Automated tests use the in-memory transport. The Firebase transport gets one
scripted two-window run against the live database under `rooms/v2/test-*`, cleaned up
afterwards.

## 14. Controls

Solo and online: mouse to drag or click cards onto the lawn; keys 1–0 pick a card;
Space pauses in solo modes; a shovel removes a plant; F toggles full screen.

Same-computer Versus, defaults (either boy may take the mouse instead):

| Action | Lukas (plants) | Toby (zombies) |
|--------|----------------|----------------|
| Move | W A S D moves a tile cursor | ↑ ↓ picks a lane |
| Change card | Q / E | ← / → |
| Place or send | Space (merges if the tile holds the same unit) | Enter |
| Merge | — | `.` levels up the front-most matching zombie in the lane |
| Hero power | Left Shift | Right Shift |

## 15. Proof that it is good

1. Rules: unit tests for every unit, status, merge, economy and end condition; same
   seed and commands give the same checksum; save and reload mid-match gives the same
   result.
2. Balance thresholds from section 10, as a committed report and a test.
3. Level checker over all 80 levels.
4. Netcode: two simulations over a transport with delay, jitter and reordering stay
   identical; a forced mismatch recovers.
5. End to end in a real browser (Playwright): first run, tutorial level played by
   scripted input, results, map, Marketplace purchase, save survives reload, Quick
   Battle, Free Play, same-computer Versus with both key sets, two-window online match,
   pause and resume. No console errors anywhere.
6. Looks: a scripted screenshot tour of every screen, every unit at every level, every
   world and the main effects, reviewed frame by frame; short captured clips of battles.
7. Performance: frame times with 150 units on the reference machine, 95th percentile
   under 16.7 ms; a ten-minute soak with stable memory.
8. A final review of the whole branch.

What this cannot prove: whether two boys find it fun, and how it sounds to a human ear.
The first playable level goes to Michal early for exactly that reason.

## 16. Delivery order

Each phase ends playable and gets its own plan, written when the one before lands.

1. Foundation and one level: simulation core with six units, the renderer, HUD, first
   sounds, one Backyard battle against the computer. Shown to Michal.
2. Full roster: all 20 units at five levels, every ability, statuses, hero powers,
   effects.
3. Balance: computer players, harness, tuner, thresholds met.
4. Adventure and progress: worlds, 80 levels, bosses, map, Marketplace, Almanac, saves,
   tutorial, Quick Battle, Free Play.
5. Versus: one keyboard, then two computers.
6. Polish and proof: cinematics, replay, performance, end-to-end suite, final review.

## 17. Left to the builder

File layout inside each layer, the voxel model format, animation blending, the particle
system, the exact UI component structure, the tuner's search method, level-by-level
content, and all starting numbers not fixed here. Gamepad support and a downloadable
replay clip are welcome later and must not be designed out.

## 18. Questions only Michal can answer

None of these blocks phases 1 or 2.

1. How old are Lukas and Toby? **Answered 2026-11-11: Lukas is 8, Toby is almost 5.**
   What follows from it:
   - Toby cannot be expected to read. Every screen must be usable from pictures, colour
     and sound alone; words are a bonus for Lukas.
   - Adventure starts on Normal for Lukas and on Easy for Toby.
   - The beginner stand-in player models Toby and the average one models Lukas. Toby's
     campaign on Easy must be winnable by the beginner at least 70% of the time through
     its first two worlds.
   - In Versus, a head start for Toby is on by default. Phase 3 measures the beginner
     against the average player at head starts of 0 to 50% in steps of 10 and makes the
     default the smallest one that gives the beginner at least 40% of the wins. Either
     boy can change it or turn it off before a match.
   - On one keyboard Toby keeps the simplest controls (up, down, left, right, Enter).
2. What is the second computer for two-computer Versus? A slower machine needs the low
   graphics setting tested there, and a way to reach the game before it is deployed
   (phase 5).
3. "Video playability" was read as smooth, cinematic play with a replay of the winning
   blow. If he meant whole-match replays or saved clips, phase 6 grows.
4. Difficulty. **Michal, 2026-11-11, after playing the old game on port 4321 (he took
   it for the new one): it felt unbalanced and too easy; make it a notch harder.**
   Applied to the new game as the raised targets in section 10. Toby's Easy setting
   and his Versus head start stay, so the extra difficulty lands on Normal and Hard.
