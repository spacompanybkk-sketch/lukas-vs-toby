#!/usr/bin/env node
/**
 * Generate ALL game assets using OpenAI DALL-E 3
 * Usage: OPENAI_API_KEY=sk-... node scripts/generate-all-assets.mjs [category]
 * Categories: landing, ui, backgrounds, tiles, bases, portraits
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'public', 'assets');
const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

const ASSETS = {
  // ---- LANDING PAGE ----
  landing: {
    'landing/logo.png': 'Game logo text "LUKAS PLANTS vs TOBY ZOMBIES" in Minecraft pixel art blocky font style, green letters for PLANTS and purple letters for ZOMBIES, dramatic VS in the middle, dark background with subtle green and purple glow, game title screen style, no other text',
    'landing/lukas-portrait.png': 'Portrait of a young boy hero character named Lukas, Minecraft pixel art style, blocky voxel look, wearing green armor and leaf crown, friendly determined expression, surrounded by small plants, green glowing background, game character select portrait, no text',
    'landing/toby-portrait.png': 'Portrait of a mischievous boy villain character named Toby, Minecraft pixel art style, blocky voxel look, wearing purple dark armor with skull emblem, confident smirk, surrounded by small zombies, purple glowing background, game character select portrait, no text',
    'landing/bg-plants.png': 'Left half of a game background, lush green garden with sunflowers and vines, Minecraft pixel art style, blocky voxel look, peaceful green nature scene, no characters, no text, tileable edge on right side',
    'landing/bg-zombies.png': 'Right half of a game background, dark graveyard with tombstones and purple fog, Minecraft pixel art style, blocky voxel look, spooky undead atmosphere, no characters, no text, tileable edge on left side',
  },

  // ---- UI ELEMENTS ----
  ui: {
    'ui/btn-play.png': 'A large green PLAY button, Minecraft pixel art style, blocky 3D stone button with green glow and carved text PLAY, game UI element, transparent background, no other text',
    'ui/btn-battle.png': 'A large red BATTLE button, Minecraft pixel art style, blocky 3D stone button with red glow and carved text BATTLE, game UI element, transparent background, no other text',
    'ui/coin-lukie.png': 'A gold coin with letter L on it, Minecraft pixel art style, shiny golden game coin, LukieCoin currency, simple, transparent background, no other text',
    'ui/coin-toby.png': 'A purple coin with letter T on it, Minecraft pixel art style, dark purple game coin with silver T, Toby Dollar currency, simple, transparent background, no other text',
    'ui/card-frame-plant.png': 'A unit card frame border, Minecraft pixel art style, green wooden frame with leaf decorations, empty center for unit portrait, game UI card border, transparent background, no text',
    'ui/card-frame-zombie.png': 'A unit card frame border, Minecraft pixel art style, dark purple stone frame with bone decorations, empty center for unit portrait, game UI card border, transparent background, no text',
  },

  // ---- BATTLEFIELD ----
  backgrounds: {
    'bg/battlefield.png': 'Top-down view of a grassy battlefield, Minecraft pixel art style, green grass field with subtle grid lines, simple flat game background, 5 lanes visible, no characters, no text, no UI',
  },

  tiles: {
    'tiles/grass-light.png': 'A single grass tile, top-down view, Minecraft pixel art style, light green grass with subtle texture, flat square game tile, seamless, no shadows, simple, 64x64 pixels feel',
    'tiles/grass-dark.png': 'A single grass tile, top-down view, Minecraft pixel art style, slightly darker green grass with subtle texture, flat square game tile, seamless, no shadows, simple, 64x64 pixels feel',
  },

  bases: {
    'bases/plant-base.png': 'A plant fortress base, Minecraft pixel art style, green wooden treehouse fort with vines and flowers, small tower with leaf flag, game building, dark background, no text',
    'bases/zombie-base.png': 'A zombie fortress base, Minecraft pixel art style, dark purple stone crypt with skulls and bones, cracked walls, eerie purple glow, game building, dark background, no text',
  },

  // ---- LOBBY ----
  portraits: {
    'portraits/lukas-lobby.png': 'Full body character Lukas standing heroically, Minecraft pixel art style, young boy in green plant armor with leaf cape, holding a seed pouch, confident pose, game lobby character art, dark background, no text',
    'portraits/toby-lobby.png': 'Full body character Toby standing menacingly, Minecraft pixel art style, young boy in purple zombie armor with bone cape, holding a skull staff, mischievous pose, game lobby character art, dark background, no text',
    'portraits/vs-splash.png': 'Epic VS battle splash screen, Minecraft pixel art style, large blocky VS letters with green energy on left and purple energy on right, dramatic clash effect, explosions, game versus screen, dark background, no other text',
  },

  // ---- EFFECTS ----
  effects: {
    'effects/explosion.png': 'A cartoon explosion effect, Minecraft pixel art style, orange and yellow blocky explosion burst with debris, game effect sprite, transparent dark background, no text',
    'effects/heal.png': 'A green healing sparkle effect, Minecraft pixel art style, green sparkles and plus signs floating upward, game heal effect sprite, transparent dark background, no text',
    'effects/shield-block.png': 'A shield block effect, Minecraft pixel art style, metallic grey shield bash impact with sparks, game defense effect sprite, transparent dark background, no text',
    'effects/speed-lines.png': 'Horizontal speed lines effect, Minecraft pixel art style, yellow-orange motion blur lines, game speed effect, transparent dark background, no text',
  },

  // ---- GAME OVER ----
  gameover: {
    'gameover/plants-win.png': 'Victory celebration scene, plants have won, Minecraft pixel art style, green fireworks and confetti, sunflowers cheering, bright happy atmosphere, game victory screen background, no text',
    'gameover/zombies-win.png': 'Victory celebration scene, zombies have won, Minecraft pixel art style, purple lightning and dark confetti, zombies celebrating, ominous triumphant atmosphere, game victory screen background, no text',
  },
};

async function generateAsset(filename, prompt) {
  const filePath = path.join(ASSETS_DIR, filename);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Skip if already exists
  if (fs.existsSync(filePath)) {
    console.log(`  Skipping (exists): ${filename}`);
    return true;
  }

  console.log(`  Generating: ${filename}...`);

  try {
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
        size: '1024x1024',
        quality: 'standard',
        response_format: 'b64_json',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error(`  ERROR: ${error.error?.message || JSON.stringify(error)}`);
      return false;
    }

    const data = await response.json();
    const buffer = Buffer.from(data.data[0].b64_json, 'base64');
    fs.writeFileSync(filePath, buffer);
    console.log(`  Saved: ${filename}`);
    return true;
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    return false;
  }
}

async function main() {
  const category = process.argv[2];
  let allAssets = [];

  if (category && ASSETS[category]) {
    allAssets = Object.entries(ASSETS[category]);
    console.log(`\nGenerating category: ${category} (${allAssets.length} images)\n`);
  } else if (category) {
    console.log(`Unknown category: ${category}`);
    console.log('Available:', Object.keys(ASSETS).join(', '));
    process.exit(1);
  } else {
    // Generate all
    for (const [cat, assets] of Object.entries(ASSETS)) {
      for (const [file, prompt] of Object.entries(assets)) {
        allAssets.push([file, prompt]);
      }
    }
    console.log(`\nGenerating ALL assets (${allAssets.length} images)\n`);
  }

  // Cap at 50
  if (allAssets.length > 50) {
    console.log(`Capping at 50 images (${allAssets.length} requested)`);
    allAssets = allAssets.slice(0, 50);
  }

  let success = 0, failed = 0;
  for (let i = 0; i < allAssets.length; i++) {
    const [file, prompt] = allAssets[i];
    console.log(`[${i + 1}/${allAssets.length}]`);
    const ok = await generateAsset(file, prompt);
    if (ok) success++; else failed++;

    // Rate limit pause (except for skipped/last)
    if (i < allAssets.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log(`\nDone! ${success} generated, ${failed} failed.`);
  console.log(`Assets saved to: ${ASSETS_DIR}/`);
}

main().catch(console.error);
