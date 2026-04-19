#!/usr/bin/env node
/**
 * Generate game sprites using OpenAI DALL-E 3
 * Usage: OPENAI_API_KEY=sk-... node scripts/generate-sprites.mjs
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

// Sprite definitions: name → prompt
const SPRITES = {
  // Plants
  peashooter: 'A cute green pea shooter plant character, Minecraft pixel art style, blocky voxel look, green stem body with a round green head, tube-shaped mouth that shoots peas, simple cartoon eyes, game sprite, solid dark background, no text, centered',
  sunflower: 'A happy sunflower character, Minecraft pixel art style, blocky voxel look, yellow petals around a brown center face with smile, green stem, game sprite, solid dark background, no text, centered',
  walnutBomb: 'An angry walnut bomb character, Minecraft pixel art style, blocky voxel look, brown walnut shell body with angry face, a lit fuse on top, game sprite, solid dark background, no text, centered',

  // Zombies
  brainEater: 'A zombie holding a brain, Minecraft pixel art style, blocky voxel look, pale purple-green skin, tattered clothes, holding a pink brain in one hand, undead, game sprite, solid dark background, no text, centered',
  veryFastWalker: 'A fast running zombie, Minecraft pixel art style, blocky voxel look, red-tinted skin, wild eyes, running pose with arms forward, speed lines, skinny, game sprite, solid dark background, no text, centered',
  skeletonWarrior: 'A skeleton warrior with sword and shield, Minecraft pixel art style, blocky voxel look, white bone skull with red glowing eyes, grey armor, holding a silver sword and small shield, game sprite, solid dark background, no text, centered',

  // Projectiles
  pea: 'A single green pea projectile, Minecraft pixel art style, small round bright green sphere with a highlight, game sprite, solid dark background, no text, very simple',
  kernel: 'A single yellow corn kernel projectile, Minecraft pixel art style, small yellow oval with highlight, game sprite, solid dark background, no text, very simple',
  brain: 'A small pink brain projectile, Minecraft pixel art style, small pink brain blob with wrinkle lines, game sprite, solid dark background, no text, very simple',
};

async function generateSprite(name, prompt) {
  console.log(`Generating: ${name}...`);

  const isProjectile = ['pea', 'kernel', 'brain'].includes(name);
  const size = '1024x1024';

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size,
      quality: 'standard',
      response_format: 'b64_json',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error(`  Error for ${name}:`, error.error?.message || JSON.stringify(error));
    return false;
  }

  const data = await response.json();
  const b64 = data.data[0].b64_json;
  const buffer = Buffer.from(b64, 'base64');

  const filePath = path.join(SPRITES_DIR, `${name}.png`);
  fs.writeFileSync(filePath, buffer);
  console.log(`  Saved: ${filePath}`);

  // Log the revised prompt DALL-E used
  if (data.data[0].revised_prompt) {
    console.log(`  Revised prompt: ${data.data[0].revised_prompt.substring(0, 100)}...`);
  }

  return true;
}

async function main() {
  // Ensure output directory exists
  fs.mkdirSync(SPRITES_DIR, { recursive: true });

  const names = process.argv.slice(2);
  const spritesToGenerate = names.length > 0
    ? Object.entries(SPRITES).filter(([name]) => names.includes(name))
    : Object.entries(SPRITES);

  if (spritesToGenerate.length === 0) {
    console.log('No sprites to generate. Available:', Object.keys(SPRITES).join(', '));
    process.exit(0);
  }

  console.log(`\nGenerating ${spritesToGenerate.length} sprites...\n`);
  let success = 0;
  let failed = 0;

  for (const [name, prompt] of spritesToGenerate) {
    const ok = await generateSprite(name, prompt);
    if (ok) success++;
    else failed++;

    // Small delay to avoid rate limiting
    if (spritesToGenerate.indexOf([name, prompt]) < spritesToGenerate.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\nDone! ${success} generated, ${failed} failed.`);
  console.log(`Sprites saved to: ${SPRITES_DIR}`);
  console.log('\nNext: Update BootScene to load these PNGs instead of procedural graphics.');
}

main().catch(console.error);
