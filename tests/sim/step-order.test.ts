import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Match } from '../../src/sim/match';
import type { SimState } from '../../src/sim/types';
import { classicConfig, place } from './helpers';

/**
 * This file alone replaces the stage functions with recorders, to pin the order of `Match.step`
 * whatever the stages come to do. Every other test file runs the real stages. Each mock keeps
 * the module's other exports (spread of the real module) and overrides only the stage functions.
 */
const log = vi.hoisted(() => [] as string[]);

vi.mock('../../src/sim/script', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sim/script')>()),
  tickScript: (s: SimState) => { log.push(`script tick=${s.tick} units=${s.units.length}`); },
}));
vi.mock('../../src/sim/belt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sim/belt')>()),
  tickBelt: (s: SimState) => { log.push(`belt tick=${s.tick} units=${s.units.length}`); },
}));
vi.mock('../../src/sim/economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sim/economy')>()),
  tickEconomy: (s: SimState) => { log.push(`economy tick=${s.tick} units=${s.units.length}`); },
}));
vi.mock('../../src/sim/movement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sim/movement')>()),
  tickMovement: (s: SimState) => { log.push(`movement tick=${s.tick}`); },
}));
vi.mock('../../src/sim/combat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sim/combat')>()),
  tickAttacks: (s: SimState) => { log.push(`attacks tick=${s.tick}`); },
  tickBaseDefense: (s: SimState) => { log.push(`base defense tick=${s.tick}`); },
  tickProjectiles: (s: SimState) => { log.push(`projectiles tick=${s.tick}`); },
  tickHazards: (s: SimState) => { log.push(`hazards tick=${s.tick}`); },
  resolveDeaths: (s: SimState) => { log.push(`deaths tick=${s.tick}`); },
}));
vi.mock('../../src/sim/abilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sim/abilities')>()),
  tickAbilities: (s: SimState) => { log.push(`abilities tick=${s.tick}`); },
}));
vi.mock('../../src/sim/endgame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sim/endgame')>()),
  tickEndgame: (s: SimState) => { log.push(`endgame tick=${s.tick}`); },
}));

beforeEach(() => {
  log.length = 0;
});

describe('step order', () => {
  it('runs script, belt, commands, economy, movement, attacks, base defense, abilities, projectiles, hazards, deaths, endgame, then the tick', () => {
    const m = new Match(classicConfig(1));
    m.step([place('plants', 'peashooter', 0, 0)]);
    expect(log).toEqual([
      'script tick=0 units=0', // before the command
      'belt tick=0 units=0',
      'economy tick=0 units=1', // the command already ran
      'movement tick=0',
      'attacks tick=0',
      'base defense tick=0',
      'abilities tick=0',
      'projectiles tick=0',
      'hazards tick=0',
      'deaths tick=0',
      'endgame tick=0',
    ]);
    expect(m.state.tick).toBe(1);
  });

  it('runs the whole sequence once per step, with or without commands, and adds one to the tick', () => {
    const m = new Match(classicConfig(1));
    m.step();
    m.step([]);
    m.step([place('plants', 'peashooter', 0, 0)]);
    m.step([place('plants', 'peashooter', 0, 0)]); // rejected
    expect(m.state.tick).toBe(4);
    expect(log.filter((l) => l.startsWith('economy'))).toEqual([
      'economy tick=0 units=0',
      'economy tick=1 units=0',
      'economy tick=2 units=1',
      'economy tick=3 units=1',
    ]);
    expect(log).toHaveLength(4 * 11);
  });
});
