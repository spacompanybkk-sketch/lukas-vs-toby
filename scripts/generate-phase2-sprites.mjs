#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPRITES_DIR = path.join(__dirname, '..', 'public', 'assets', 'sprites');
const API_KEY = process.env.OPENAI_API_KEY;

const SPRITES = {
  // New plants
  potatoMine: 'A potato mine buried in dirt, Minecraft pixel art style, blocky voxel look, brown potato with angry eyes peeking from underground, fuse visible, game sprite, solid dark background, no text, centered',
  cherryBomber: 'Twin cherry bomb characters, Minecraft pixel art style, blocky voxel look, two red angry cherries connected by a stem, both with lit fuses, about to explode, game sprite, solid dark background, no text, centered',
  avocadoBunker: 'A giant avocado fortress shield, Minecraft pixel art style, blocky voxel look, large green avocado cut in half used as a shield wall, very thick and sturdy looking, game sprite, solid dark background, no text, centered',
  mangoPult: 'A mango catapult plant, Minecraft pixel art style, blocky voxel look, green plant base with a wooden catapult arm holding a ripe orange mango, ready to launch, game sprite, solid dark background, no text, centered',
  kernelPult: 'A corn kernel catapult plant, Minecraft pixel art style, blocky voxel look, corn cob shaped plant with a catapult arm holding golden corn kernels, sometimes butter, game sprite, solid dark background, no text, centered',
  pumpkinSquash: 'A pumpkin squash warrior, Minecraft pixel art style, blocky voxel look, large orange pumpkin with fierce determined face, muscular vine legs ready to leap and crush enemies, game sprite, solid dark background, no text, centered',
  torchwood: 'A burning torch tree stump, Minecraft pixel art style, blocky voxel look, wooden tree stump with flames burning on top, glowing orange fire, enhances projectiles passing through, game sprite, solid dark background, no text, centered',

  // New zombies
  skeletonArcher: 'A skeleton archer zombie, Minecraft pixel art style, blocky voxel look, white bone skeleton with a bow and bone arrows, aiming pose, undead archer, game sprite, solid dark background, no text, centered',
  necromancer: 'A necromancer zombie wizard, Minecraft pixel art style, blocky voxel look, dark robed undead with glowing purple staff, magic aura, healer of zombies, game sprite, solid dark background, no text, centered',
  hotTopic: 'A hungry devouring zombie, Minecraft pixel art style, blocky voxel look, large green zombie with massive open mouth, drooling, gets stronger by eating, game sprite, solid dark background, no text, centered',
  tridentZombie: 'A trident wielding zombie warrior, Minecraft pixel art style, blocky voxel look, muscular blue-grey zombie holding a golden trident, powerful stance, game sprite, solid dark background, no text, centered',
  desertZombie: 'A desert mummy zombie, Minecraft pixel art style, blocky voxel look, sandy brown zombie wrapped in bandages, throwing sand to blind enemies, game sprite, solid dark background, no text, centered',
  cowboyZombie: 'A cowboy zombie with lasso, Minecraft pixel art style, blocky voxel look, undead cowboy with hat, holding a lasso rope in one hand and a pistol in the other, game sprite, solid dark background, no text, centered',
  brainRot: 'A rotting brain zombie, Minecraft pixel art style, blocky voxel look, decaying green zombie with exposed brain, throwing rotting brain pieces that infect plants, toxic aura, game sprite, solid dark background, no text, centered',

  // New projectiles
  mango: 'A flying mango projectile, Minecraft pixel art style, small orange ripe mango with motion blur, game sprite, solid dark background, no text, very simple',
  butter: 'A pat of butter projectile, Minecraft pixel art style, small yellow butter square, game sprite, solid dark background, no text, very simple',
  boneArrow: 'A bone arrow projectile, Minecraft pixel art style, small white bone arrow flying, game sprite, solid dark background, no text, very simple',
  trident: 'A golden trident projectile, Minecraft pixel art style, small golden trident flying, game sprite, solid dark background, no text, very simple',
  rotBrain: 'A rotting brain projectile, Minecraft pixel art style, small green rotting brain blob, toxic, game sprite, solid dark background, no text, very simple',
  sand: 'A sand cloud projectile, Minecraft pixel art style, small sandy brown dust cloud, game sprite, solid dark background, no text, very simple',
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
  const entries = Object.entries(SPRITES);
  console.log(`Generating ${entries.length} Phase 2 sprites...\n`);
  let ok = 0, fail = 0;
  for (let i = 0; i < entries.length; i++) {
    console.log(`[${i+1}/${entries.length}]`);
    const [name, prompt] = entries[i];
    (await generate(name, prompt)) ? ok++ : fail++;
    if (i < entries.length - 1) await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`\nDone! ${ok} generated, ${fail} failed.`);
}

main();
