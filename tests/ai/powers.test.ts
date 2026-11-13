import { describe, expect, it } from 'vitest';
import { fullConfig } from '../../src/ai/balanceChecks';
import { SKILLS, createBasicBot } from '../../src/ai/basicBot';
import { heroMove, powerMove } from '../../src/ai/powers';
import { BALANCE, cloneBalance } from '../../src/data/balance';
import { Match, spawnUnit } from '../../src/sim/match';
import { spellArea } from '../../src/sim/spells';
import type { SpellKey } from '../../src/sim/types';

/** A fresh match with all ten cards a side, heroes ready, and each side's spells fixed. */
function scene(spells: { plants: SpellKey[]; zombies: SpellKey[] }, heroReady = true): Match {
  const m = new Match(fullConfig(1, BALANCE));
  for (const side of ['plants', 'zombies'] as const) {
    m.state.players[side].heroTimer = heroReady ? 0 : 100;
    m.state.players[side].spells = spells[side].map((key) => ({ key, timer: 0 }));
  }
  return m;
}

describe('hero and spell aim', () => {
  it('reads nothing and fires nothing while every power is charging', () => {
    const m = scene({ plants: [], zombies: [] }, false);
    spawnUnit(m.state, BALANCE, 'brainEater', 2, 3);
    expect(powerMove(m, 'plants')).toBeNull();
    expect(powerMove(m, 'zombies')).toBeNull();
  });

  it('fires the Mega Mower into the lane with the most to mow, and keeps it for a lone zombie', () => {
    const m = scene({ plants: [], zombies: [] });
    spawnUnit(m.state, BALANCE, 'brainEater', 1, 7);
    expect(heroMove(m, 'plants')).toBeNull();
    spawnUnit(m.state, BALANCE, 'brainEater', 3, 6);
    spawnUnit(m.state, BALANCE, 'hotTopic', 3, 7);
    expect(heroMove(m, 'plants')).toEqual({ type: 'hero', faction: 'plants', lane: 3 });
  });

  it('fires Bone Storm where it hits the most plants', () => {
    const m = scene({ plants: [], zombies: [] });
    for (const col of [0, 1, 2]) spawnUnit(m.state, BALANCE, 'sunflower', 4, col + 0.5);
    spawnUnit(m.state, BALANCE, 'peashooter', 0, 1.5);
    expect(heroMove(m, 'zombies')).toEqual({ type: 'hero', faction: 'zombies', lane: 4 });
  });

  it('casts the income spells as soon as they are ready', () => {
    const m = scene({ plants: ['sunShower'], zombies: ['brainFeast'] }, false);
    expect(powerMove(m, 'plants')).toMatchObject({ type: 'spell', spell: 'sunShower' });
    expect(powerMove(m, 'zombies')).toMatchObject({ type: 'spell', spell: 'brainFeast' });
  });

  it('aims a damage spell at the fullest area, and keeps it when nothing is worth it', () => {
    const b = cloneBalance(BALANCE);
    const m = new Match(fullConfig(1, b), b);
    m.state.players.plants.heroTimer = 100;
    m.state.players.plants.spells = [{ key: 'thunderbolt', timer: 0 }];
    expect(powerMove(m, 'plants')).toBeNull();
    for (const [lane, x] of [[1, 5.2], [1, 6.1], [2, 5.5], [2, 6.4]] as const) spawnUnit(m.state, b, 'brainEater', lane, x);
    spawnUnit(m.state, b, 'brainEater', 4, 8.5);
    const cmd = powerMove(m, 'plants');
    expect(cmd).toMatchObject({ type: 'spell', spell: 'thunderbolt', lane: 1, col: 5 });
    expect(m.check(cmd as NonNullable<typeof cmd>)).toBeNull();
  });

  it('heals hurt plants with Healing Rain, and puts a rock in front of a push', () => {
    const m = scene({ plants: ['healingRain', 'rockWall'], zombies: [] }, false);
    const hurt = [spawnUnit(m.state, BALANCE, 'peashooter', 2, 1.5), spawnUnit(m.state, BALANCE, 'peashooter', 2, 2.5)];
    for (const p of hurt) p.hp = 60;
    const heal = powerMove(m, 'plants');
    if (heal?.type !== 'spell') throw new Error('no spell');
    expect(heal.spell).toBe('healingRain');
    const tiles = spellArea('plants', 3, heal.lane, heal.col);
    for (const p of hurt) expect(tiles).toContainEqual({ lane: p.lane, col: Math.floor(p.x) });
    m.state.players.plants.spells = [{ key: 'rockWall', timer: 0 }];
    for (const x of [6.2, 6.6]) spawnUnit(m.state, BALANCE, 'brainEater', 3, x);
    const rock = powerMove(m, 'plants');
    expect(rock).toMatchObject({ type: 'spell', spell: 'rockWall', lane: 3, col: 5 });
  });

  it('raises Grave Rise minions just in front of the lane its zombies push hardest, never left of minCol', () => {
    const m = scene({ plants: [], zombies: ['graveRise'] }, false);
    spawnUnit(m.state, BALANCE, 'peashooter', 2, 3.5);
    spawnUnit(m.state, BALANCE, 'brainEater', 2, 6);
    const cmd = powerMove(m, 'zombies');
    expect(cmd).toMatchObject({ type: 'spell', spell: 'graveRise', lane: 2 });
    expect(cmd?.type === 'spell' && cmd.col).toBeGreaterThanOrEqual(BALANCE.spells.graveRise.minCol ?? 0);
  });

  it('a basic bot uses its hero and spells in a match, never in place of its card play', () => {
    const m = new Match(fullConfig(3, BALANCE));
    const bots = [createBasicBot('plants', 'medium', 3), createBasicBot('zombies', 'medium', 3)];
    let powers = 0;
    while (m.state.winner === null && m.state.tick < 6000) {
      const commands = bots.flatMap((bot) => bot.think(m));
      powers += commands.filter((c) => c.type === 'hero' || c.type === 'spell').length;
      m.step(commands);
    }
    expect(powers).toBeGreaterThan(4);
  });
});

describe('thinking cost', () => {
  it('a Hard bot thinks in well under 0.2 ms per think on average, and under 2 ms in 99 of 100 thinks', () => {
    // The app calls think every tick; a bot only works on one tick of every `thinkEvery` (a seeded
    // phase). That tick is found from the timings: the residue of tick % thinkEvery with the highest
    // mean cost. Only those calls are counted, so a slow think cannot hide among the idle ticks.
    const perThink: number[] = [];
    for (const seed of [5, 6, 7]) {
      const m = new Match(fullConfig(seed, BALANCE));
      const bots = [createBasicBot('plants', 'hard', seed), createBasicBot('zombies', 'hard', seed)];
      const every = [SKILLS.plants.hard.thinkEvery, SKILLS.zombies.hard.thinkEvery];
      const byResidue = bots.map((_, i) => Array.from({ length: every[i] as number }, (): number[] => []));
      while (m.state.winner === null && m.state.tick < 14_400) {
        const commands = [];
        for (let i = 0; i < bots.length; i++) {
          const t = performance.now();
          commands.push(...(bots[i] as (typeof bots)[number]).think(m));
          byResidue[i]?.[m.state.tick % (every[i] as number)]?.push(performance.now() - t);
        }
        m.step(commands);
      }
      for (const residues of byResidue) {
        const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
        const thinks = residues.reduce((best, xs) => (mean(xs) > mean(best) ? xs : best), [] as number[]);
        perThink.push(...thinks);
      }
    }
    perThink.sort((a, b) => a - b);
    const mean = perThink.reduce((a, b) => a + b, 0) / perThink.length;
    const p99 = perThink[Math.ceil(0.99 * perThink.length) - 1] ?? 0;
    expect(perThink.length).toBeGreaterThan(1000);
    expect(mean, `mean ${mean.toFixed(3)} ms per think`).toBeLessThan(0.2);
    expect(p99, `p99 ${p99.toFixed(3)} ms`).toBeLessThan(2);
  });
});
