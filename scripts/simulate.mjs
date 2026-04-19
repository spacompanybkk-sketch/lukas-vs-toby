#!/usr/bin/env node
/**
 * Headless AI vs AI battle simulator
 * Uses the same game logic to test balance without Phaser rendering
 * Usage: node scripts/simulate.mjs [numBattles]
 */

// ---- INLINE GAME CONSTANTS (editable per iteration) ----
const GRID_ROWS = 5;
const GRID_COLS = 10;
const BASE_HP = 5000;
const STARTING_ENERGY = 500;
const ENERGY_TICK_INTERVAL = 2000;
const ENERGY_TICK_AMOUNT = 5;
const ENERGY_KILL_REWARD = 10;
const SUNFLOWER_ENERGY_INTERVAL = 5000;
const SUNFLOWER_ENERGY_AMOUNT = 25;

const UNIT_COSTS = {
  peashooter: 100, sunflower: 50, walnutBomb: 125,
  brainEater: 100, veryFastWalker: 50, skeletonWarrior: 125,
};

let UNIT_STATS = {
  peashooter:      { hp: 150, damage: 12, attackSpeed: 2200, range: 9, moveSpeed: 0 },
  sunflower:       { hp: 100, damage: 5,  attackSpeed: 3000, range: 3, moveSpeed: 0 },
  walnutBomb:      { hp: 500, damage: 80, attackSpeed: 0,    range: 0, moveSpeed: 0 },
  brainEater:      { hp: 150, damage: 10, attackSpeed: 3000, range: 4, moveSpeed: 0.3 },
  veryFastWalker:  { hp: 80,  damage: 8,  attackSpeed: 1500, range: 0, moveSpeed: 0.8 },
  skeletonWarrior: { hp: 250, damage: 15, attackSpeed: 2000, range: 0, moveSpeed: 0.4 },
};

let PROJECTILE_DAMAGE = {
  peashooter: 12, sunflower: 5, brainEater: 10,
};

let PROJECTILE_SPEED = {
  peashooter: 200, sunflower: 180, brainEater: 150,
};

const WAVE_INTERVAL_START = 8000;
const WAVE_FIRST_DELAY = 12000;
const SKELETON_BLOCK_COOLDOWN = 4000;
const WALNUT_EXPLOSION_DAMAGE = 80;

// ---- SIMULATION ENGINE ----

class SimUnit {
  constructor(id, key, faction, stats) {
    this.id = id;
    this.key = key;
    this.faction = faction;
    this.hp = stats.hp;
    this.maxHp = stats.hp;
    this.damage = stats.damage;
    this.attackSpeed = stats.attackSpeed;
    this.range = stats.range;
    this.moveSpeed = stats.moveSpeed;
    this.row = 0;
    this.col = 0;
    this.lastAttack = -Infinity;
    this.lastBlock = -Infinity;
    this.lastProducerTick = 0;
  }
  isAlive() { return this.hp > 0; }
  isStationary() { return this.moveSpeed === 0; }
  canAttack(time) { return this.attackSpeed > 0 && time - this.lastAttack >= this.attackSpeed; }
  takeDamage(amount) { this.hp = Math.max(0, this.hp - amount); }
}

class SimProjectile {
  constructor(x, row, damage, speed, faction) {
    this.x = x;
    this.row = row;
    this.damage = damage;
    this.speed = speed;
    this.faction = faction;
    this.alive = true;
  }
}

function runBattle(maxTicks = 60000) {
  let plantBaseHp = BASE_HP;
  let zombieBaseHp = BASE_HP;
  let plantEnergy = STARTING_ENERGY;
  let zombieEnergy = STARTING_ENERGY;
  let units = [];
  let projectiles = [];
  let nextId = 0;
  let lastEnergyTick = 0;
  let lastPlantSunTick = 0;
  let lastZombieSunTick = 0;
  let plantWaveTimer = 0;
  let zombieWaveTimer = 0;
  let plantWaveInterval = WAVE_INTERVAL_START;
  let zombieWaveInterval = WAVE_INTERVAL_START;
  let plantWaveCount = 0;
  let zombieWaveCount = 0;
  let totalPlantDamage = 0;
  let totalZombieDamage = 0;
  let plantUnitsSpawned = 0;
  let zombieUnitsSpawned = 0;
  let plantUnitsKilled = 0;
  let zombieUnitsKilled = 0;

  const TICK = 100; // ms per simulation tick
  const TILE_PX = 80;
  const LEFT_EDGE = 0;
  const RIGHT_EDGE = GRID_COLS;

  const plantUnits = ['peashooter', 'sunflower', 'walnutBomb'];
  const zombieUnits = ['brainEater', 'veryFastWalker', 'skeletonWarrior'];

  function spawnUnit(key, row, col, faction) {
    const stats = UNIT_STATS[key];
    if (!stats) return;
    const unit = new SimUnit(`u${nextId++}`, key, faction, stats);
    unit.row = row;
    unit.col = col;
    units.push(unit);
    if (faction === 'plants') plantUnitsSpawned++;
    else zombieUnitsSpawned++;
  }

  function aiPlaceUnit(faction) {
    const available = faction === 'plants' ? plantUnits : zombieUnits;
    const energy = faction === 'plants' ? plantEnergy : zombieEnergy;

    // Simple AI: prioritize based on energy
    // Try to place the best affordable unit
    const affordable = available.filter(k => UNIT_COSTS[k] <= energy);
    if (affordable.length === 0) return;

    // Weight: prefer damage dealers, then support
    const weights = {
      peashooter: 3, sunflower: 2, walnutBomb: 1,
      brainEater: 3, veryFastWalker: 2, skeletonWarrior: 2,
    };
    const totalWeight = affordable.reduce((s, k) => s + (weights[k] || 1), 0);
    let r = Math.random() * totalWeight;
    let chosen = affordable[0];
    for (const k of affordable) {
      r -= (weights[k] || 1);
      if (r <= 0) { chosen = k; break; }
    }

    const cost = UNIT_COSTS[chosen];
    const row = Math.floor(Math.random() * GRID_ROWS);

    if (faction === 'plants') {
      const col = Math.floor(Math.random() * GRID_COLS);
      plantEnergy -= cost;
      spawnUnit(chosen, row, col, 'plants');
    } else {
      zombieEnergy -= cost;
      spawnUnit(chosen, row, GRID_COLS - 1, 'zombies');
    }
  }

  function findTarget(attacker) {
    const effectiveRange = attacker.range === 0 ? 1 : attacker.range;
    let best = null;
    let bestDist = Infinity;
    for (const u of units) {
      if (u.faction === attacker.faction || !u.isAlive()) continue;
      if (Math.abs(u.row - attacker.row) > 0.5) continue;
      const dist = u.col - attacker.col;
      if (attacker.faction === 'plants' && dist <= 0) continue;
      if (attacker.faction === 'zombies' && dist >= 0) continue;
      const abs = Math.abs(dist);
      if (abs > effectiveRange) continue;
      if (abs < bestDist) { bestDist = abs; best = u; }
    }
    return best;
  }

  for (let time = 0; time < maxTicks; time += TICK) {
    // Energy tick
    if (time - lastEnergyTick >= ENERGY_TICK_INTERVAL) {
      lastEnergyTick = time;
      plantEnergy += ENERGY_TICK_AMOUNT;
      zombieEnergy += ENERGY_TICK_AMOUNT;
    }

    // Sunflower energy
    if (time - lastPlantSunTick >= SUNFLOWER_ENERGY_INTERVAL) {
      lastPlantSunTick = time;
      const count = units.filter(u => u.key === 'sunflower' && u.faction === 'plants' && u.isAlive()).length;
      plantEnergy += SUNFLOWER_ENERGY_AMOUNT * count;
    }
    // Necromancer energy equivalent for zombies (brain eater acts as producer)
    if (time - lastZombieSunTick >= SUNFLOWER_ENERGY_INTERVAL) {
      lastZombieSunTick = time;
      const count = units.filter(u => u.key === 'brainEater' && u.faction === 'zombies' && u.isAlive()).length;
      zombieEnergy += SUNFLOWER_ENERGY_AMOUNT * count;
    }

    // AI wave spawning (both sides)
    if (time >= WAVE_FIRST_DELAY) {
      if (time - plantWaveTimer >= plantWaveInterval) {
        plantWaveTimer = time;
        plantWaveCount++;
        aiPlaceUnit('plants');
        if (plantWaveCount % 15 === 0 && plantWaveInterval > 4000) plantWaveInterval -= 500;
      }
      if (time - zombieWaveTimer >= zombieWaveInterval) {
        zombieWaveTimer = time;
        zombieWaveCount++;
        aiPlaceUnit('zombies');
        if (zombieWaveCount % 15 === 0 && zombieWaveInterval > 4000) zombieWaveInterval -= 500;
      }
    }

    // Player AI placement (spend energy when available)
    if (plantEnergy >= 50 && Math.random() < 0.3) aiPlaceUnit('plants');
    if (zombieEnergy >= 50 && Math.random() < 0.3) aiPlaceUnit('zombies');

    // Movement
    const deltaSec = TICK / 1000;
    for (const u of units) {
      if (!u.isAlive() || u.isStationary()) continue;
      const dir = u.faction === 'zombies' ? -1 : 1;
      const target = findTarget(u);
      if (target && Math.abs(target.col - u.col) <= 1) continue;
      u.col += dir * u.moveSpeed * deltaSec;
    }

    // Combat
    for (const u of units) {
      if (!u.isAlive() || !u.canAttack(time)) continue;
      if (u.key === 'walnutBomb') continue;

      const projKey = u.key;
      const projDmg = PROJECTILE_DAMAGE[projKey];
      const projSpd = PROJECTILE_SPEED[projKey];

      if (projDmg && u.range > 1) {
        // Ranged: always fire
        u.lastAttack = time;
        const dir = u.faction === 'plants' ? 1 : -1;
        projectiles.push(new SimProjectile(u.col, u.row, projDmg, projSpd / 80 * dir, u.faction));
      } else {
        const target = findTarget(u);
        if (target) {
          u.lastAttack = time;
          target.takeDamage(u.damage);
          if (u.faction === 'plants') totalPlantDamage += u.damage;
          else totalZombieDamage += u.damage;
        }
      }
    }

    // Projectile movement & collision
    for (const p of projectiles) {
      if (!p.alive) continue;
      p.x += p.speed * deltaSec;

      // Hit units
      for (const u of units) {
        if (!u.isAlive() || u.faction === p.faction) continue;
        if (Math.abs(u.row - p.row) > 0.5) continue;
        if (Math.abs(u.col - p.x) < 0.5) {
          // Skeleton block
          if (u.key === 'skeletonWarrior' && time - u.lastBlock >= SKELETON_BLOCK_COOLDOWN) {
            u.lastBlock = time;
            p.alive = false;
            break;
          }
          u.takeDamage(p.damage);
          if (p.faction === 'plants') totalPlantDamage += p.damage;
          else totalZombieDamage += p.damage;
          p.alive = false;
          break;
        }
      }

      // Hit base
      if (p.alive && p.faction === 'plants' && p.x >= RIGHT_EDGE) {
        zombieBaseHp -= p.damage;
        totalPlantDamage += p.damage;
        p.alive = false;
      }
      if (p.alive && p.faction === 'zombies' && p.x <= LEFT_EDGE) {
        plantBaseHp -= p.damage;
        totalZombieDamage += p.damage;
        p.alive = false;
      }
    }
    projectiles = projectiles.filter(p => p.alive);

    // Base damage from units at edge
    for (const u of units) {
      if (!u.isAlive() || u.isStationary()) continue;
      if (u.faction === 'zombies' && u.col <= 0) {
        u.col = 0;
        if (u.canAttack(time)) {
          u.lastAttack = time;
          plantBaseHp -= u.damage;
          totalZombieDamage += u.damage;
        }
      }
      if (u.faction === 'plants' && u.col >= GRID_COLS - 1) {
        u.col = GRID_COLS - 1;
        if (u.canAttack(time)) {
          u.lastAttack = time;
          zombieBaseHp -= u.damage;
          totalPlantDamage += u.damage;
        }
      }
    }

    // Cleanup dead
    for (const u of units) {
      if (!u.isAlive()) {
        if (u.key === 'walnutBomb') {
          // Explosion
          for (const target of units) {
            if (!target.isAlive() || target.faction === u.faction) continue;
            if (Math.abs(target.row - u.row) <= 1 && Math.abs(target.col - u.col) <= 1) {
              target.takeDamage(WALNUT_EXPLOSION_DAMAGE);
            }
          }
        }
        if (u.faction === 'plants') plantUnitsKilled++;
        else zombieUnitsKilled++;
      }
    }
    units = units.filter(u => u.isAlive());

    // Win check
    if (plantBaseHp <= 0 || zombieBaseHp <= 0) {
      const winner = plantBaseHp <= 0 ? 'zombies' : 'plants';
      return {
        winner,
        duration: time / 1000,
        plantBaseHp: Math.max(0, plantBaseHp),
        zombieBaseHp: Math.max(0, zombieBaseHp),
        totalPlantDamage,
        totalZombieDamage,
        plantUnitsSpawned,
        zombieUnitsSpawned,
        plantUnitsKilled,
        zombieUnitsKilled,
      };
    }
  }

  // Timeout — draw
  return {
    winner: 'draw',
    duration: maxTicks / 1000,
    plantBaseHp, zombieBaseHp,
    totalPlantDamage, totalZombieDamage,
    plantUnitsSpawned, zombieUnitsSpawned,
    plantUnitsKilled, zombieUnitsKilled,
  };
}

function runBatch(count = 10) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(runBattle(300000)); // 5 min max
  }
  return results;
}

function analyzeResults(results) {
  const plantWins = results.filter(r => r.winner === 'plants').length;
  const zombieWins = results.filter(r => r.winner === 'zombies').length;
  const draws = results.filter(r => r.winner === 'draw').length;
  const avgDuration = results.reduce((s, r) => s + r.duration, 0) / results.length;
  const avgPlantDmg = results.reduce((s, r) => s + r.totalPlantDamage, 0) / results.length;
  const avgZombieDmg = results.reduce((s, r) => s + r.totalZombieDamage, 0) / results.length;
  const avgPlantSpawned = results.reduce((s, r) => s + r.plantUnitsSpawned, 0) / results.length;
  const avgZombieSpawned = results.reduce((s, r) => s + r.zombieUnitsSpawned, 0) / results.length;

  return {
    plantWins, zombieWins, draws,
    avgDuration: Math.round(avgDuration),
    avgPlantDmg: Math.round(avgPlantDmg),
    avgZombieDmg: Math.round(avgZombieDmg),
    avgPlantSpawned: Math.round(avgPlantSpawned),
    avgZombieSpawned: Math.round(avgZombieSpawned),
    winRate: `Plants ${plantWins}/${results.length} | Zombies ${zombieWins}/${results.length} | Draw ${draws}/${results.length}`,
  };
}

// ---- AUTO-BALANCE LOOP ----

function autoBalance(iterations = 15, batchSize = 10) {
  console.log('=== AUTO-BALANCE SIMULATION ===\n');
  console.log('Starting stats:', JSON.stringify(UNIT_STATS, null, 2));
  console.log('Projectile damage:', JSON.stringify(PROJECTILE_DAMAGE));
  console.log('Projectile speed:', JSON.stringify(PROJECTILE_SPEED));
  console.log(`Base HP: ${BASE_HP}\n`);

  for (let i = 1; i <= iterations; i++) {
    console.log(`--- Iteration ${i}/${iterations} ---`);
    const results = runBatch(batchSize);
    const analysis = analyzeResults(results);
    console.log(`  Win rate: ${analysis.winRate}`);
    console.log(`  Avg duration: ${analysis.avgDuration}s`);
    console.log(`  Avg damage: Plants ${analysis.avgPlantDmg} | Zombies ${analysis.avgZombieDmg}`);
    console.log(`  Avg spawned: Plants ${analysis.avgPlantSpawned} | Zombies ${analysis.avgZombieSpawned}`);

    // Auto-adjust based on results
    const plantWinRate = analysis.plantWins / batchSize;
    const zombieWinRate = analysis.zombieWins / batchSize;
    const drawRate = analysis.draws / batchSize;

    // Target: 45-55% win rate for each side, avg duration 90-180s
    let adjusted = false;

    // If plants win too much, nerf plants or buff zombies
    if (plantWinRate > 0.6) {
      UNIT_STATS.peashooter.damage = Math.max(5, UNIT_STATS.peashooter.damage - 1);
      UNIT_STATS.peashooter.attackSpeed += 100;
      UNIT_STATS.veryFastWalker.hp += 10;
      UNIT_STATS.skeletonWarrior.hp += 15;
      PROJECTILE_DAMAGE.peashooter = Math.max(3, PROJECTILE_DAMAGE.peashooter - 1);
      adjusted = true;
      console.log('  ADJUST: Nerfed plants, buffed zombies');
    }

    // If zombies win too much, nerf zombies or buff plants
    if (zombieWinRate > 0.6) {
      UNIT_STATS.veryFastWalker.moveSpeed = Math.max(0.2, UNIT_STATS.veryFastWalker.moveSpeed - 0.05);
      UNIT_STATS.brainEater.damage = Math.max(5, UNIT_STATS.brainEater.damage - 1);
      UNIT_STATS.peashooter.hp += 10;
      UNIT_STATS.walnutBomb.hp += 25;
      PROJECTILE_DAMAGE.brainEater = Math.max(3, PROJECTILE_DAMAGE.brainEater - 1);
      adjusted = true;
      console.log('  ADJUST: Nerfed zombies, buffed plants');
    }

    // If games are too short (< 60s), increase HP and slow everything
    if (analysis.avgDuration < 60) {
      Object.keys(UNIT_STATS).forEach(k => {
        UNIT_STATS[k].hp = Math.round(UNIT_STATS[k].hp * 1.15);
        UNIT_STATS[k].attackSpeed = Math.round(UNIT_STATS[k].attackSpeed * 1.1);
      });
      Object.keys(UNIT_STATS).forEach(k => {
        if (UNIT_STATS[k].moveSpeed > 0) {
          UNIT_STATS[k].moveSpeed = Math.round(UNIT_STATS[k].moveSpeed * 90) / 100;
        }
      });
      Object.keys(PROJECTILE_DAMAGE).forEach(k => {
        PROJECTILE_DAMAGE[k] = Math.max(3, PROJECTILE_DAMAGE[k] - 1);
      });
      adjusted = true;
      console.log('  ADJUST: Games too short — increased HP, slowed attacks');
    }

    // If games are too long (> 200s), decrease HP or speed up
    if (analysis.avgDuration > 200) {
      Object.keys(UNIT_STATS).forEach(k => {
        UNIT_STATS[k].attackSpeed = Math.max(800, Math.round(UNIT_STATS[k].attackSpeed * 0.9));
      });
      Object.keys(PROJECTILE_DAMAGE).forEach(k => {
        PROJECTILE_DAMAGE[k] += 1;
      });
      adjusted = true;
      console.log('  ADJUST: Games too long — sped up attacks');
    }

    // If too many draws, increase damage
    if (drawRate > 0.3) {
      Object.keys(UNIT_STATS).forEach(k => {
        UNIT_STATS[k].damage = Math.round(UNIT_STATS[k].damage * 1.1);
      });
      Object.keys(PROJECTILE_DAMAGE).forEach(k => {
        PROJECTILE_DAMAGE[k] = Math.round(PROJECTILE_DAMAGE[k] * 1.1);
      });
      adjusted = true;
      console.log('  ADJUST: Too many draws — increased damage');
    }

    if (!adjusted) {
      console.log('  BALANCED — no adjustments needed');
    }
    console.log('');
  }

  // Final results
  console.log('=== FINAL BALANCED STATS ===\n');
  console.log('UNIT_STATS:', JSON.stringify(UNIT_STATS, null, 2));
  console.log('\nPROJECTILE_DAMAGE:', JSON.stringify(PROJECTILE_DAMAGE));
  console.log('PROJECTILE_SPEED:', JSON.stringify(PROJECTILE_SPEED));

  // Run final validation batch
  console.log('\n--- Final Validation (10 battles) ---');
  const final = runBatch(10);
  const finalAnalysis = analyzeResults(final);
  console.log(`  Win rate: ${finalAnalysis.winRate}`);
  console.log(`  Avg duration: ${finalAnalysis.avgDuration}s`);
  console.log(`  Avg damage: Plants ${finalAnalysis.avgPlantDmg} | Zombies ${finalAnalysis.avgZombieDmg}`);

  return { UNIT_STATS, PROJECTILE_DAMAGE, PROJECTILE_SPEED };
}

const balanced = autoBalance(15, 10);

// Output for easy copy-paste into constants.ts
console.log('\n=== COPY-PASTE INTO constants.ts ===\n');
console.log('export const UNIT_STATS: Record<string, { hp: number; damage: number; attackSpeed: number; range: number; moveSpeed: number }> = {');
for (const [key, stats] of Object.entries(balanced.UNIT_STATS)) {
  const pad = ' '.repeat(16 - key.length);
  console.log(`  ${key}:${pad}{ hp: ${stats.hp}, damage: ${stats.damage}, attackSpeed: ${stats.attackSpeed}, range: ${stats.range}, moveSpeed: ${stats.moveSpeed} },`);
}
console.log('};');
console.log('\n// Projectile configs:');
for (const [key, dmg] of Object.entries(balanced.PROJECTILE_DAMAGE)) {
  console.log(`//   ${key}: damage ${dmg}, speed ${balanced.PROJECTILE_SPEED[key]}`);
}
