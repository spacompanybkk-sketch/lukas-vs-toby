#!/usr/bin/env node
/**
 * Regenerate ALL game sprites with clean prompts.
 * Deletes existing sprites first, then generates fresh ones.
 * Usage: OPENAI_API_KEY=sk-... node scripts/regenerate-all-sprites.mjs [filter...]
 *   e.g. node scripts/regenerate-all-sprites.mjs peashooter  (only peashooter + its L2-L5)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPRITES_DIR = path.join(__dirname, '..', 'public', 'assets', 'sprites');
const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

const CLEAN = ', 3D render, cute blocky low-poly style, studio lighting, solid black background, product photography composition, single subject centered, clean empty background';

// ── Base sprites (L1) ─────────────────────────────────────────────
const BASE_SPRITES = {
  // Plants
  peashooter: 'A cute green pea shooter plant character, green stem body with a round green head, tube-shaped mouth that shoots peas, simple cartoon eyes' + CLEAN,
  sunflower: 'A happy sunflower character, yellow petals around a brown center face with smile, green stem' + CLEAN,
  walnutBomb: 'An angry walnut bomb character, brown walnut shell body with angry face, a lit fuse on top' + CLEAN,
  potatoMine: 'A potato mine buried in dirt, brown potato with angry eyes peeking from underground, fuse visible' + CLEAN,
  cherryBomber: 'Twin cherry bomb characters, two red angry cherries connected by a stem, both with lit fuses, about to explode' + CLEAN,
  avocadoBunker: 'A giant avocado fortress shield, large green avocado cut in half used as a shield wall, very thick and sturdy looking' + CLEAN,
  mangoPult: 'A mango catapult plant, green plant base with a wooden catapult arm holding a ripe orange mango, ready to launch' + CLEAN,
  kernelPult: 'A corn kernel catapult plant, corn cob shaped plant with a catapult arm holding golden corn kernels' + CLEAN,
  pumpkinSquash: 'A pumpkin squash warrior, large orange pumpkin with fierce determined face, muscular vine legs ready to leap and crush enemies' + CLEAN,
  torchwood: 'A burning torch tree stump, wooden tree stump with flames burning on top, glowing orange fire' + CLEAN,

  // Zombies
  brainEater: 'A zombie holding a brain, pale purple-green skin, tattered clothes, holding a pink brain in one hand, undead' + CLEAN,
  veryFastWalker: 'A fast running zombie, red-tinted skin, wild eyes, running pose with arms forward, speed lines, skinny' + CLEAN,
  skeletonWarrior: 'A skeleton warrior with sword and shield, white bone skull with red glowing eyes, grey armor, holding a silver sword and small shield' + CLEAN,
  skeletonArcher: 'A skeleton archer zombie, white bone skeleton with a bow and bone arrows, aiming pose, undead archer' + CLEAN,
  necromancer: 'A necromancer zombie wizard, dark robed undead with glowing purple staff, magic aura, healer of zombies' + CLEAN,
  hotTopic: 'A hungry devouring zombie, large green zombie with massive open mouth, drooling, gets stronger by eating' + CLEAN,
  tridentZombie: 'A trident wielding zombie warrior, muscular blue-grey zombie holding a golden trident, powerful stance' + CLEAN,
  desertZombie: 'A desert mummy zombie, sandy brown zombie wrapped in bandages, throwing sand to blind enemies' + CLEAN,
  cowboyZombie: 'A cowboy zombie with lasso, undead cowboy with hat, holding a lasso rope in one hand and a pistol in the other' + CLEAN,
  brainRot: 'A rotting brain zombie, decaying green zombie with exposed brain, throwing rotting brain pieces, toxic aura' + CLEAN,

  // Projectiles
  pea: 'A single green pea projectile, small round bright green sphere with a highlight, very simple' + CLEAN,
  kernel: 'A single yellow corn kernel projectile, small yellow oval with highlight, very simple' + CLEAN,
  brain: 'A small pink brain projectile, small pink brain blob with wrinkle lines, very simple' + CLEAN,
  mango: 'A flying mango projectile, small orange ripe mango, very simple' + CLEAN,
  butter: 'A pat of butter projectile, small yellow butter square, very simple' + CLEAN,
  boneArrow: 'A bone arrow projectile, small white bone arrow flying, very simple' + CLEAN,
  trident: 'A golden trident projectile, small golden trident flying, very simple' + CLEAN,
  rotBrain: 'A rotting brain projectile, small green rotting brain blob, toxic, very simple' + CLEAN,
  sand: 'A sand cloud projectile, small sandy brown dust cloud, very simple' + CLEAN,
};

// ── Evolution sprites (L2-L5) ─────────────────────────────────────
const EVOLUTION_PROMPTS = {
  peashooter: [
    'A bigger peashooter plant with a small leaf shield and double-barrel mouth' + CLEAN,
    'An armored peashooter with iron plating, glowing green eyes, triple barrels' + CLEAN,
    'A battle-mech peashooter with cannon barrels, electric aura, crystal armor' + CLEAN,
    'A massive legendary golden peashooter mech, quad cannons, radiant energy field, epic final form' + CLEAN,
  ],
  sunflower: [
    'A bigger sunflower with extra petals and a glowing golden center' + CLEAN,
    'An armored sunflower with metallic petals, radiating warm light beams' + CLEAN,
    'A crystal sunflower with diamond petals, solar flare aura, prismatic light' + CLEAN,
    'A legendary cosmic sunflower, massive radiant star core, galaxy petal ring, divine glow' + CLEAN,
  ],
  walnutBomb: [
    'A bigger walnut bomb with iron reinforced shell, larger fuse, angrier face' + CLEAN,
    'An armored walnut bomb with steel plating, glowing red fuse, spikes on shell' + CLEAN,
    'A crystal walnut bomb encased in volcanic rock, lava cracks, massive fuse, fire aura' + CLEAN,
    'A legendary nuclear walnut bomb, golden shell, atomic glow, devastating final form' + CLEAN,
  ],
  potatoMine: [
    'A bigger potato mine with metal casing, double fuses, sharper angry eyes' + CLEAN,
    'An armored potato mine with steel shell, proximity sensor antenna, red warning glow' + CLEAN,
    'A high-tech potato mine with circuit board patterns, electric sparks, ticking timer' + CLEAN,
    'A legendary nuclear potato mine, golden casing, radiation glow, ultimate explosive' + CLEAN,
  ],
  cherryBomber: [
    'Bigger twin cherry bombs with iron stems, larger fuses, fiercer angry faces' + CLEAN,
    'Armored twin cherry bombs with steel casings, fire trail, glowing red aura' + CLEAN,
    'Crystal twin cherry bombs encased in magma, volcanic fuses, explosive energy waves' + CLEAN,
    'Legendary twin cherry bombs, golden shells, nuclear glow, devastating final form' + CLEAN,
  ],
  avocadoBunker: [
    'A bigger avocado bunker with reinforced rind, metal studs, thicker walls' + CLEAN,
    'An iron-plated avocado fortress with turret slots, fortress walls, steel reinforcement' + CLEAN,
    'A crystal avocado citadel with diamond-hard shell, energy shield bubble, glowing core' + CLEAN,
    'A legendary avocado mega-fortress, golden walls, impenetrable force field, divine shield' + CLEAN,
  ],
  mangoPult: [
    'A bigger mango catapult with reinforced wooden arm, two mangoes loaded' + CLEAN,
    'An armored mango catapult with iron frame, triple mango payload, fire-tipped' + CLEAN,
    'A crystal mango siege engine with golden frame, explosive magma mangoes' + CLEAN,
    'A legendary mango artillery cannon, golden barrel, nuclear mango payload, epic form' + CLEAN,
  ],
  kernelPult: [
    'A bigger corn kernel catapult with double arm, butter-coated kernels' + CLEAN,
    'An armored kernel catapult with steel frame, rapid-fire mechanism, golden kernels' + CLEAN,
    'A crystal kernel gatling gun with diamond barrel, electric butter rounds' + CLEAN,
    'A legendary kernel artillery, golden corn cannon, nuclear butter payload, epic form' + CLEAN,
  ],
  pumpkinSquash: [
    'A bigger pumpkin squash warrior with iron vine legs, fiercer face, larger body' + CLEAN,
    'An armored pumpkin knight with steel helmet, shield vines, battle-scarred' + CLEAN,
    'A crystal pumpkin berserker with flaming body, magma veins, devastating stomp power' + CLEAN,
    'A legendary pumpkin titan, golden armor, colossal size, seismic slam power, epic form' + CLEAN,
  ],
  torchwood: [
    'A bigger burning torch stump with taller flames, reinforced bark' + CLEAN,
    'An iron-banded torchwood with blue-hot flames, molten core visible' + CLEAN,
    'A crystal torchwood with white-hot plasma flames, diamond bark, energy rings' + CLEAN,
    'A legendary torchwood inferno, golden trunk, solar flare flames, epic final form' + CLEAN,
  ],
  brainEater: [
    'A bigger zombie brain eater with armored shoulders, holding two brains' + CLEAN,
    'An armored zombie brain eater with iron helmet, glowing purple eyes, chain mail' + CLEAN,
    'A mutant brain eater with crystal skull, psychic aura, telekinetic floating brains' + CLEAN,
    'A legendary brain eater overlord, golden armor, massive psychic crown, epic form' + CLEAN,
  ],
  veryFastWalker: [
    'A bigger fast zombie with spiked boots, wind trails, more muscular' + CLEAN,
    'An armored speed zombie with jet-pack exhaust, lightning streaks, chrome plating' + CLEAN,
    'A crystal speed demon zombie with electric aura, afterimage trails, sonic speed' + CLEAN,
    'A legendary speed phantom zombie, golden blur, light-speed trails, epic final form' + CLEAN,
  ],
  skeletonWarrior: [
    'A bigger skeleton warrior with larger sword, iron shield, reinforced bones' + CLEAN,
    'An armored skeleton knight with full plate armor, flaming sword, tower shield' + CLEAN,
    'A crystal skeleton champion with diamond bones, energy blade, force shield' + CLEAN,
    'A legendary skeleton death knight, golden armor, soul-fire greatsword, epic form' + CLEAN,
  ],
  skeletonArcher: [
    'A bigger skeleton archer with reinforced bow, quiver of iron arrows' + CLEAN,
    'An armored skeleton marksman with crossbow, scope, steel-tipped bolts' + CLEAN,
    'A crystal skeleton sniper with energy bow, homing arrows, glowing targeting eye' + CLEAN,
    'A legendary skeleton arch-ranger, golden bow, explosive star arrows, epic form' + CLEAN,
  ],
  necromancer: [
    'A bigger necromancer zombie with taller staff, darker robes, stronger aura' + CLEAN,
    'An armored necromancer with iron-bound tome, double staff, swirling spirits' + CLEAN,
    'A crystal lich necromancer with phylactery, soul storm, diamond staff' + CLEAN,
    'A legendary arch-lich, golden robes, reality-warping power, army of spirits, epic form' + CLEAN,
  ],
  hotTopic: [
    'A bigger hungry zombie with wider jaw, drool puddle, thicker body' + CLEAN,
    'An armored glutton zombie with iron jaw brace, chain stomach, acid drool' + CLEAN,
    'A crystal abomination zombie with mutated jaws, bio-acid spray, grotesque power' + CLEAN,
    'A legendary devourer zombie, golden teeth, void stomach, all-consuming, epic form' + CLEAN,
  ],
  tridentZombie: [
    'A bigger trident zombie with reinforced trident, shoulder armor, stronger stance' + CLEAN,
    'An armored trident warrior zombie with full battle gear, electric trident' + CLEAN,
    'A crystal poseidon zombie with diamond trident, water vortex, storm aura' + CLEAN,
    'A legendary trident god zombie, golden trident, tsunami power, divine form' + CLEAN,
  ],
  desertZombie: [
    'A bigger desert mummy zombie with thicker bandages, sand cloud, reinforced wraps' + CLEAN,
    'An armored pharaoh zombie with golden headpiece, sandstorm aura, ancient power' + CLEAN,
    'A crystal sphinx zombie with diamond wraps, tornado sand attacks, ancient magic' + CLEAN,
    'A legendary desert emperor zombie, golden sarcophagus armor, apocalypse sandstorm, epic form' + CLEAN,
  ],
  cowboyZombie: [
    'A bigger cowboy zombie with reinforced hat, double revolvers, leather armor' + CLEAN,
    'An armored sheriff zombie with metal badge, shotgun, steel-plated hat' + CLEAN,
    'A crystal gunslinger zombie with diamond revolvers, bullet-time aura, glowing eyes' + CLEAN,
    'A legendary outlaw king zombie, golden guns, explosive rounds, epic western form' + CLEAN,
  ],
  brainRot: [
    'A bigger rotting brain zombie with more toxic aura, double brain throws' + CLEAN,
    'An armored plague zombie with gas mask, toxic barrel backpack, acid spray' + CLEAN,
    'A crystal bio-hazard zombie with nuclear brain, radiation rings, mutation aura' + CLEAN,
    'A legendary plague lord zombie, golden hazmat, nuclear meltdown aura, epic form' + CLEAN,
  ],
};

// ── Generator ─────────────────────────────────────────────────────
fs.mkdirSync(SPRITES_DIR, { recursive: true });

async function generate(name, prompt) {
  const filePath = path.join(SPRITES_DIR, `${name}.png`);
  // Delete existing sprite so we regenerate fresh
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  console.log(`  Generating: ${name}...`);
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'standard', response_format: 'b64_json' }),
    });
    if (!res.ok) { const e = await res.json(); console.error(`  ERROR: ${e.error?.message}`); return false; }
    const data = await res.json();
    fs.writeFileSync(filePath, Buffer.from(data.data[0].b64_json, 'base64'));
    console.log(`  Saved: ${name}`);
    return true;
  } catch (e) { console.error(`  ERROR: ${e.message}`); return false; }
}

async function main() {
  // Build full sprite list: base + evolutions
  const entries = [];

  // Base sprites
  for (const [name, prompt] of Object.entries(BASE_SPRITES)) {
    entries.push([name, prompt]);
  }

  // Evolution sprites (L2-L5)
  for (const [unitKey, prompts] of Object.entries(EVOLUTION_PROMPTS)) {
    for (let lvl = 0; lvl < prompts.length; lvl++) {
      entries.push([`${unitKey}-L${lvl + 2}`, prompts[lvl]]);
    }
  }

  // Filter by unit key if args provided
  const filterKeys = process.argv.slice(2);
  const filtered = filterKeys.length > 0
    ? entries.filter(([name]) => filterKeys.some(k => name === k || name.startsWith(k + '-') || name === k))
    : entries;

  console.log(`\nRegenerating ${filtered.length} sprites with clean prompts...\n`);
  let ok = 0, fail = 0;
  for (let i = 0; i < filtered.length; i++) {
    console.log(`[${i + 1}/${filtered.length}]`);
    const [name, prompt] = filtered[i];
    (await generate(name, prompt)) ? ok++ : fail++;
    if (i < filtered.length - 1) await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`\nDone! ${ok} generated, ${fail} failed.`);
}

main();
