#!/usr/bin/env node
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

const SUFFIX = ', Minecraft pixel art style, blocky voxel look, game sprite, solid dark background, no text, centered';

// Evolution prompts: unitKey -> [L2, L3, L4, L5]
const EVOLUTION_PROMPTS = {
  peashooter: [
    'A bigger peashooter plant with a small leaf shield and double-barrel mouth' + SUFFIX,
    'An armored peashooter with iron plating, glowing green eyes, triple barrels' + SUFFIX,
    'A battle-mech peashooter with cannon barrels, electric aura, crystal armor' + SUFFIX,
    'A massive legendary golden peashooter mech, quad cannons, radiant energy field, epic final form' + SUFFIX,
  ],
  sunflower: [
    'A bigger sunflower with extra petals and a glowing golden center' + SUFFIX,
    'An armored sunflower with metallic petals, radiating warm light beams' + SUFFIX,
    'A crystal sunflower with diamond petals, solar flare aura, prismatic light' + SUFFIX,
    'A legendary cosmic sunflower, massive radiant star core, galaxy petal ring, divine glow' + SUFFIX,
  ],
  walnutBomb: [
    'A bigger walnut bomb with iron reinforced shell, larger fuse, angrier face' + SUFFIX,
    'An armored walnut bomb with steel plating, glowing red fuse, spikes on shell' + SUFFIX,
    'A crystal walnut bomb encased in volcanic rock, lava cracks, massive fuse, fire aura' + SUFFIX,
    'A legendary nuclear walnut bomb, golden shell, atomic glow, devastating final form' + SUFFIX,
  ],
  potatoMine: [
    'A bigger potato mine with metal casing, double fuses, sharper angry eyes' + SUFFIX,
    'An armored potato mine with steel shell, proximity sensor antenna, red warning glow' + SUFFIX,
    'A high-tech potato mine with circuit board patterns, electric sparks, ticking timer' + SUFFIX,
    'A legendary nuclear potato mine, golden casing, radiation glow, ultimate explosive' + SUFFIX,
  ],
  cherryBomber: [
    'Bigger twin cherry bombs with iron stems, larger fuses, fiercer angry faces' + SUFFIX,
    'Armored twin cherry bombs with steel casings, fire trail, glowing red aura' + SUFFIX,
    'Crystal twin cherry bombs encased in magma, volcanic fuses, explosive energy waves' + SUFFIX,
    'Legendary twin cherry bombs, golden shells, nuclear glow, devastating final form' + SUFFIX,
  ],
  avocadoBunker: [
    'A bigger avocado bunker with reinforced rind, metal studs, thicker walls' + SUFFIX,
    'An iron-plated avocado fortress with turret slots, fortress walls, steel reinforcement' + SUFFIX,
    'A crystal avocado citadel with diamond-hard shell, energy shield bubble, glowing core' + SUFFIX,
    'A legendary avocado mega-fortress, golden walls, impenetrable force field, divine shield' + SUFFIX,
  ],
  mangoPult: [
    'A bigger mango catapult with reinforced wooden arm, two mangoes loaded' + SUFFIX,
    'An armored mango catapult with iron frame, triple mango payload, fire-tipped' + SUFFIX,
    'A crystal mango siege engine with golden frame, explosive magma mangoes' + SUFFIX,
    'A legendary mango artillery cannon, golden barrel, nuclear mango payload, epic form' + SUFFIX,
  ],
  kernelPult: [
    'A bigger corn kernel catapult with double arm, butter-coated kernels' + SUFFIX,
    'An armored kernel catapult with steel frame, rapid-fire mechanism, golden kernels' + SUFFIX,
    'A crystal kernel gatling gun with diamond barrel, electric butter rounds' + SUFFIX,
    'A legendary kernel artillery, golden corn cannon, nuclear butter payload, epic form' + SUFFIX,
  ],
  pumpkinSquash: [
    'A bigger pumpkin squash warrior with iron vine legs, fiercer face, larger body' + SUFFIX,
    'An armored pumpkin knight with steel helmet, shield vines, battle-scarred' + SUFFIX,
    'A crystal pumpkin berserker with flaming body, magma veins, devastating stomp power' + SUFFIX,
    'A legendary pumpkin titan, golden armor, colossal size, seismic slam power, epic form' + SUFFIX,
  ],
  torchwood: [
    'A bigger burning torch stump with taller flames, reinforced bark' + SUFFIX,
    'An iron-banded torchwood with blue-hot flames, molten core visible' + SUFFIX,
    'A crystal torchwood with white-hot plasma flames, diamond bark, energy rings' + SUFFIX,
    'A legendary torchwood inferno, golden trunk, solar flare flames, epic final form' + SUFFIX,
  ],
  brainEater: [
    'A bigger zombie brain eater with armored shoulders, holding two brains' + SUFFIX,
    'An armored zombie brain eater with iron helmet, glowing purple eyes, chain mail' + SUFFIX,
    'A mutant brain eater with crystal skull, psychic aura, telekinetic floating brains' + SUFFIX,
    'A legendary brain eater overlord, golden armor, massive psychic crown, epic form' + SUFFIX,
  ],
  veryFastWalker: [
    'A bigger fast zombie with spiked boots, wind trails, more muscular' + SUFFIX,
    'An armored speed zombie with jet-pack exhaust, lightning streaks, chrome plating' + SUFFIX,
    'A crystal speed demon zombie with electric aura, afterimage trails, sonic speed' + SUFFIX,
    'A legendary speed phantom zombie, golden blur, light-speed trails, epic final form' + SUFFIX,
  ],
  skeletonWarrior: [
    'A bigger skeleton warrior with larger sword, iron shield, reinforced bones' + SUFFIX,
    'An armored skeleton knight with full plate armor, flaming sword, tower shield' + SUFFIX,
    'A crystal skeleton champion with diamond bones, energy blade, force shield' + SUFFIX,
    'A legendary skeleton death knight, golden armor, soul-fire greatsword, epic form' + SUFFIX,
  ],
  skeletonArcher: [
    'A bigger skeleton archer with reinforced bow, quiver of iron arrows' + SUFFIX,
    'An armored skeleton marksman with crossbow, scope, steel-tipped bolts' + SUFFIX,
    'A crystal skeleton sniper with energy bow, homing arrows, glowing targeting eye' + SUFFIX,
    'A legendary skeleton arch-ranger, golden bow, explosive star arrows, epic form' + SUFFIX,
  ],
  necromancer: [
    'A bigger necromancer zombie with taller staff, darker robes, stronger aura' + SUFFIX,
    'An armored necromancer with iron-bound tome, double staff, swirling spirits' + SUFFIX,
    'A crystal lich necromancer with phylactery, soul storm, diamond staff' + SUFFIX,
    'A legendary arch-lich, golden robes, reality-warping power, army of spirits, epic form' + SUFFIX,
  ],
  hotTopic: [
    'A bigger hungry zombie with wider jaw, drool puddle, thicker body' + SUFFIX,
    'An armored glutton zombie with iron jaw brace, chain stomach, acid drool' + SUFFIX,
    'A crystal abomination zombie with mutated jaws, bio-acid spray, grotesque power' + SUFFIX,
    'A legendary devourer zombie, golden teeth, void stomach, all-consuming, epic form' + SUFFIX,
  ],
  tridentZombie: [
    'A bigger trident zombie with reinforced trident, shoulder armor, stronger stance' + SUFFIX,
    'An armored trident warrior zombie with full battle gear, electric trident' + SUFFIX,
    'A crystal poseidon zombie with diamond trident, water vortex, storm aura' + SUFFIX,
    'A legendary trident god zombie, golden trident, tsunami power, divine form' + SUFFIX,
  ],
  desertZombie: [
    'A bigger desert mummy zombie with thicker bandages, sand cloud, reinforced wraps' + SUFFIX,
    'An armored pharaoh zombie with golden headpiece, sandstorm aura, ancient power' + SUFFIX,
    'A crystal sphinx zombie with diamond wraps, tornado sand attacks, ancient magic' + SUFFIX,
    'A legendary desert emperor zombie, golden sarcophagus armor, apocalypse sandstorm, epic form' + SUFFIX,
  ],
  cowboyZombie: [
    'A bigger cowboy zombie with reinforced hat, double revolvers, leather armor' + SUFFIX,
    'An armored sheriff zombie with metal badge, shotgun, steel-plated hat' + SUFFIX,
    'A crystal gunslinger zombie with diamond revolvers, bullet-time aura, glowing eyes' + SUFFIX,
    'A legendary outlaw king zombie, golden guns, explosive rounds, epic western form' + SUFFIX,
  ],
  brainRot: [
    'A bigger rotting brain zombie with more toxic aura, double brain throws' + SUFFIX,
    'An armored plague zombie with gas mask, toxic barrel backpack, acid spray' + SUFFIX,
    'A crystal bio-hazard zombie with nuclear brain, radiation rings, mutation aura' + SUFFIX,
    'A legendary plague lord zombie, golden hazmat, nuclear meltdown aura, epic form' + SUFFIX,
  ],
};

fs.mkdirSync(SPRITES_DIR, { recursive: true });

async function generate(name, prompt) {
  const filePath = path.join(SPRITES_DIR, `${name}.png`);
  if (fs.existsSync(filePath)) { console.log(`  Skip: ${name}`); return true; }
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
  const entries = [];
  for (const [unitKey, prompts] of Object.entries(EVOLUTION_PROMPTS)) {
    for (let lvl = 0; lvl < prompts.length; lvl++) {
      entries.push([`${unitKey}-L${lvl + 2}`, prompts[lvl]]);
    }
  }

  // Allow filtering by unit key: node scripts/generate-level-sprites.mjs peashooter sunflower
  const filterKeys = process.argv.slice(2);
  const filtered = filterKeys.length > 0
    ? entries.filter(([name]) => filterKeys.some(k => name.startsWith(k)))
    : entries;

  console.log(`Generating ${filtered.length} level sprites...\n`);
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
