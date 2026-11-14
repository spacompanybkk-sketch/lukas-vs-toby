import { describe, expect, it } from 'vitest';
import type { Balance, BossStats } from '../../src/data/balance';
import { Match, defaultConfig } from '../../src/sim/match';
import type { BossConfig, Command, MatchConfig } from '../../src/sim/types';
import { classicBalance, place } from './helpers';

/**
 * Boss phases and the `strike` pattern (worlds machinery, Task 3). The Titan and the Oak have no
 * phases and no strike: their fights must play, and hash, exactly as before this task.
 */

/** The Brain Titan and the Elder Oak as shipped when this task began (pinned here, so tuning cannot move these checksums). */
const SHIPPED_TITAN: BossStats = {
  recharge: 0, hp: 3800, armor: 0, speed: 0.1,
  melee: { damage: 40, interval: 1.5, reach: 0.6 },
  maxStunSeconds: 1, stunFalloff: 0.5, stunWindowSeconds: 10, hitCap: 0.1,
  patterns: [
    { kind: 'slam', everySeconds: 12, windupSeconds: 1.5, damage: 400, sideDamage: 200, reach: 0.6 },
    { kind: 'summon', everySeconds: 6, unit: 'veryFastWalker', count: 2, level: 1 },
    { kind: 'shield', everySeconds: 0, atHealth: [0.66, 0.33], seconds: 6, damageFactor: 1, bouncesStraight: true },
  ],
};
const SHIPPED_OAK: BossStats = {
  recharge: 0, hp: 4200, armor: 0, speed: 0,
  maxStunSeconds: 1, stunFalloff: 0.5, stunWindowSeconds: 10, hitCap: 0.1, col: 0, guardFactor: 0.5,
  patterns: [
    { kind: 'barrage', everySeconds: 10, count: 3, damage: 230, splash: 0.75, speed: 5 },
    { kind: 'summon', everySeconds: 10, unit: 'peashooter', count: 2, level: 1, minCol: 1, maxCol: 4 },
    { kind: 'shield', everySeconds: 0, atHealth: [0.5], seconds: 8, damageFactor: 0.5, bouncesStraight: false },
  ],
};

function shippedBosses(): Balance {
  const b = classicBalance();
  b.bosses = { brainTitan: structuredClone(SHIPPED_TITAN), elderOak: structuredClone(SHIPPED_OAK) };
  return b;
}

/** A boss fight with a fixed list of commands (no bot, so no later AI change can move it). */
function scriptedFight(boss: BossConfig, seed: number): { m: Match; mid: number; phases: number } {
  const b = shippedBosses();
  const c: MatchConfig = {
    ...defaultConfig(seed, b), mode: 'boss', boss, spells: { plants: 0, zombies: 0 },
    startEnergy: { plants: 400, zombies: 400 },
  };
  if (boss.faction === 'plants') {
    c.prepared = [
      { unit: 'peashooter', faction: 'plants', lane: 0, x: 3.5, level: 1 },
      { unit: 'peashooter', faction: 'plants', lane: 4, x: 3.5, level: 1 },
    ];
  }
  const m = new Match(c, b);
  const commandsAt = (t: number): Command[] => {
    const out: Command[] = [];
    if (boss.faction === 'zombies') {
      if (t % 150 === 10) out.push(place('plants', 'peashooter', (t / 150 | 0) % 5, (t / 750 | 0) % 4));
      if (t % 450 === 40) out.push(place('plants', 'sunflower', (t / 450 | 0) % 5, 4));
      if (t === 300) out.push(place('plants', 'walnutBomb', 2, 6));
      if (t % 600 === 599) out.push({ type: 'hero', faction: 'plants', lane: 2 });
    } else {
      if (t % 120 === 20) out.push(place('zombies', (t / 120 | 0) % 3 === 0 ? 'skeletonWarrior' : 'brainEater', (t / 120 | 0) % 5, 0));
      if (t % 200 === 77) out.push(place('zombies', 'veryFastWalker', (t / 200 | 0) % 5, 0));
      if (t % 600 === 599) out.push({ type: 'hero', faction: 'zombies', lane: (t / 600 | 0) % 5 });
    }
    return out;
  };
  let mid = 0;
  let phases = 0;
  while (m.state.winner === null && m.state.tick < 14_400) {
    for (const e of m.step(commandsAt(m.state.tick))) if (e.type === 'bossPhase') phases += 1;
    if (m.state.tick === 1500) mid = m.hash();
  }
  return { m, mid, phases };
}

describe('the Titan and the Oak play and hash exactly as before boss phases', () => {
  // Pinned at 5f17dd0 (Task 2 done), before this task touched the boss engine.
  const BEFORE: Array<[string, BossConfig, number, number, number, number, string]> = [
    ['titan', { key: 'brainTitan', faction: 'zombies', lane: 2 }, 1, 5268, 2077792557, 3794934943, 'plants'],
    ['titan', { key: 'brainTitan', faction: 'zombies', lane: 2 }, 2, 5268, 1567914996, 982358164, 'plants'],
    ['oak', { key: 'elderOak', faction: 'plants', lane: 2 }, 1, 4723, 1267053511, 933527899, 'plants'],
    ['oak', { key: 'elderOak', faction: 'plants', lane: 2 }, 2, 5293, 202434642, 4215772169, 'plants'],
  ];
  it.each(BEFORE)('%s fight %#', (_name, boss, seed, tick, mid, end, winner) => {
    const { m, mid: midHash, phases } = scriptedFight(boss, seed);
    expect([seed, m.state.tick, midHash, m.hash(), m.state.winner]).toEqual([seed, tick, mid, end, winner]);
    expect(phases).toBe(boss.key === 'brainTitan' ? 2 : 1); // every shield mark passed, so every pattern of the table played
  });
});
