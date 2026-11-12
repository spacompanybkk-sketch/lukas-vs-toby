# Art Bible — Lukas Plants vs Toby Zombies

The look every model, effect and screen must share. If a choice is not covered here,
pick whatever keeps the lawn readable and the mood bright and goofy.

Direction: a bright toy diorama. Crossy Road-style voxel characters on a floating
island, soft shadows, saturated colour. Nothing frightening, no gore.

Michal, 2026-11-11, on seeing the lawn and the Peashooter: keep the Minecraft look in
everything still to be built: boxy, hard-edged, pixelated. No rounded or smooth shapes,
no bevels, no soft gradients on models, HUD art or effects; curves are stepped in voxels
and interface art is pixel-crisp. What is already built stays as it is.

## 1. Scale

- World unit = one lawn tile. Columns run along +X (column c covers x in [c, c+1]),
  lanes along +Z (lane 0 at the back, lane 4 nearest the camera), up is +Y.
- Lawn is 10 × 5 tiles, top surface at y = 0.
- Character voxel = 1/16 tile. A level-1 character fits a 12 wide × 16 tall × 10 deep
  voxel envelope (0.75 × 1.0 × 0.625 tiles), standing on y = 0, centred on its tile.
- Level scale: L1 1.00, L2 1.08, L3 1.16, L4 1.24, L5 1.34.
- Plants face +X (towards the zombies). Zombies face −X.

## 2. Proportions and faces

- Chunky: head is 40–50% of total height. Limbs short. Hands and feet are one box each.
- Zombies slouch (torso pitched 10° forward), arms held out in front.
- Plants have a base (leaves or pot), a stem, and an expressive head.
- Eyes: black, 2 wide by 3 tall on a vertical face (they come out square through the
  lawn camera, which foreshortens a vertical face to 0.62 of its height), standing half
  a voxel proud of the surface, each with a single white glint voxel in the top corner
  nearest the light. Plants look determined and friendly. Zombies look silly: one eye
  bigger than the other, a tooth or tongue showing.
- Faces turn to the player. The body faces along its lane, but the head is turned towards
  the camera and tipped back, so both eyes and the mouth show from the lawn camera. About
  14° and 6° is enough for the Peashooter; zombies and several plants need 30–60° to show
  their faces (zombies 60° and 12° by default, in a level-1 envelope 12 deep instead of 10, `HEAD_TURN`/`HEAD_TIP` in `biped.ts`); use
  what the camera needs. Where a face sits in shade or on a dark body, put a light plate
  behind the eyes and mouth so they read. The Peashooter (`src/render/models/plants/peashooter.ts`) is the
  reference for how a unit is built and how its five levels escalate.
- Blink: eye height collapses to 10% for 100 ms every 2–5 s, offset per unit.

## 3. Colour

Plants (greens with warm accents)

| Use | Hex |
|-----|-----|
| Leaf | `#58C13B` |
| Leaf dark | `#3E9A2E` |
| Leaf light | `#8BE05A` |
| Stem | `#2F7D32` |
| Pea | `#7ED957` |
| Petal | `#FFC928` |
| Petal dark | `#F59F0B` |
| Sunflower face | `#8A5A2B` |
| Walnut | `#A8703A` |
| Walnut dark | `#7B4A22` |
| Walnut light | `#C98F55` |
| Terracotta | `#C8643C` |

Zombies (purples and bone with sickly green skin)

| Use | Hex |
|-----|-----|
| Skin | `#9ACD8A` |
| Skin dark | `#6FA364` |
| Cloth purple | `#7B4BD6` |
| Cloth dark | `#4B2A8F` |
| Bone | `#EDE6D3` |
| Bone shadow | `#C9BFA5` |
| Brain pink | `#FF8FB1` |
| Iron | `#9AA4B1` |
| Rust | `#B5533C` |
| Speed red | `#E2553F` |

World

| Use | Hex |
|-----|-----|
| Grass light / dark (checker) | `#7FD14B` / `#6BBE3F` |
| Soil / soil dark | `#8B5A2B` / `#6B4423` |
| Island rock | `#7A6A5A` |
| Graveyard strip light / dark | `#5B4B7A` / `#4A3C66` |
| Sky top / horizon | `#5EC8FF` / `#CFF3FF` |
| Cloud | `#FFFFFF` |

Level materials (applied to a model's trim colour slots and added parts)

| Level | Treatment |
|-------|-----------|
| 2 | Same colours, more parts |
| 3 | Iron `#AEB7C2`, metalness 0.6, roughness 0.4 |
| 4 | Crystal `#7DE8FF`, glowing: emissive intensity 1.5 or more so it blooms |
| 5 | Gold `#FFC83D`, metalness 0.8, warm emissive 0.15 (a sheen, not a glow), golden aura motes |

Every level must be visible from the lawn camera, which looks down from above and
behind the plants. A level's additions go on top of the head, in front of the face, or
outside the head's footprint; never only under or behind the head. Each step up must
change the silhouette a child sees during play, level 1 to level 2 included.

Crystal keeps its shading: its glow is multiplied by the surface's own baked tones, so
creases and faces still read and a crystal mouth still shows its dark opening. Iron and
gold reflect a small built-in studio environment so they read as metal; that reflection
is part of the material, not an extra light.

Anything meant to glow (crystal, fuse tips, eyes, fire, tokens) needs an emissive
intensity of 1.5 or more: bloom starts at scene luminance 1.2, and a lit surface with
emissive 0.6 reaches only about 0.8.

Effects

| Use | Hex |
|-----|-----|
| Hit spark | `#FFF4B0` |
| Fire | `#FF7A1A`, `#FFD23F` |
| Poison | `#9BE23B` |
| Heal | `#7CFFB2` |
| Stun stars | `#FFE45C` |
| Sun | `#FFD54A` |
| Brains | `#FF8FB1` |

Each side stays inside its colour family so a lane reads at a glance.

## 4. Light and rendering

- Surfaces: matte toy plastic. Vertex-coloured standard material, roughness 0.85,
  metalness 0, except level materials above.
- Sun: one warm directional light `#FFF1D6` from the upper left, slightly behind the
  lawn (light travels along (0.5, −1, 0.22)), soft shadows (2048 map). Shadows fall to
  the right and slightly towards the camera, so they land on ground the player can see.
- Fill: hemisphere light, sky `#BFE8FF`, ground `#6BBE3F`.
- Bounce: a shadowless directional light from in front and slightly below, `#DCEBFF`,
  so camera-facing sides are not flat or green-tinted.
- These three lights live in `Renderer` (`sun`, `fill`, `bounce`). Every scene uses
  them as they are; models and effects never add lights of their own.
- Screen-space ambient occlusion, subtle. Bloom only on emissive parts and effects.
  Light vignette. Anti-aliased. Filmic tone mapping, sRGB output.
- Camera: perspective, 30° field of view, pitched about 52° down, straight on (no yaw),
  framed so the whole lawn and both bases sit above the card tray with margin.

## 5. Motion

Nothing moves linearly. Spawns overshoot (back-out easing); moves use cubic easing.

| Motion | Timing |
|--------|--------|
| Idle | 1.6 s loop: body bob ±0.5 voxel, head sway ±3°, leaves flutter |
| Walk | 0.5–0.9 s step cycle by speed: legs ±25°, arms ±15° opposite (reaching forward and back so the swing shows from above), bob 1 voxel, zombie roll ±4°; zombies with a cycle of 0.75 s or more bob 1.5 voxels and roll ±6°, since from above the legs are hidden and the bob and roll carry the walk |
| Shot | 120 ms lean back and squash to 0.9, 80 ms snap forward and stretch to 1.1, 200 ms settle. Projectile leaves at the snap. |
| Melee | 150 ms wind-up, 80 ms strike, 250 ms recover |
| Hit | 60 ms white flash, 2 voxel recoil over 80 ms, 120 ms return |
| Plant spawn | 350 ms rise from the soil, scale 0 → 1.15 → 1, dirt burst |
| Zombie spawn | Gravestone bursts, zombie claws up over 500 ms |
| Merge | 600 ms: full spin, scale 1 → 1.35, swap to the new level at the peak with a white flash, shockwave ring and sparkles in the level colour |
| Plant death | 200 ms wilt, then bursts into voxel debris of its own colours (gravity, one bounce, fade over 900 ms) |
| Zombie death | Head pops off, body crumbles to debris, a small puff |
| Cheer | Jump loop |

Heavy blows add screen shake and a 60–90 ms hit-stop. The winning blow plays in slow
motion.

## 6. Readability

- Health bar above each unit, 0.6 tile wide, shown once the unit is damaged; green,
  then yellow under 50%, red under 25%. Level shown as pips beside it.
- Projectiles are at least 0.2 tile across and leave a short trail.
- Tile highlight while placing: white outline with a 30% fill in the player's colour;
  red when the spot is not allowed.
- Effects never cover health bars or the card tray.
- A lane with 15 units in it must still read: zombies in a stack are offset in depth
  and height by a few voxels, never drawn exactly on top of each other.

## 7. Interface

- Chunky rounded panels (18 px radius) with a 3 px dark outline `#2A1B0E`.
  Cream and wood for plants, slate and purple for zombies.
- One rounded display font, bundled with the game, with tabular numbers.
- Buttons squash to 0.94 when pressed and pop to 1.05 on hover. Transitions take
  120–200 ms and overshoot slightly.
- Cards are 88 × 112 px on a 1440 px wide window: portrait rendered from the 3D model,
  price pill, hotkey chip, a radial sweep while recharging, greyed when unaffordable.
- Icons before words. No screen needs more than a short sentence to use.
