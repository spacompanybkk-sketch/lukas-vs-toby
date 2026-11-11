import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { PHASE1_CARDS } from '../../src/data/units';
import { hashState, snapshotState } from '../../src/sim/hash';
import { Match, defaultConfig } from '../../src/sim/match';
import type { SimEvent, SimState } from '../../src/sim/types';
import { place } from './helpers';

// The stage functions are recorded, so the order of `step` is pinned whatever they come to do.
const log = vi.hoisted(() => [] as string[]);

vi.mock('../../src/sim/economy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/sim/economy')>();
  return {
    ...actual,
    tickEconomy: (s: SimState, b: Balance, events: SimEvent[]) => {
      log.push(`economy tick=${s.tick} units=${s.units.length}`);
      actual.tickEconomy(s, b, events);
    },
  };
});
vi.mock('../../src/sim/movement', () => ({
  tickMovement: (s: SimState) => { log.push(`movement tick=${s.tick}`); },
}));
vi.mock('../../src/sim/combat', () => ({
  tickAttacks: (s: SimState) => { log.push(`attacks tick=${s.tick}`); },
  tickProjectiles: (s: SimState) => { log.push(`projectiles tick=${s.tick}`); },
  resolveDeaths: (s: SimState) => { log.push(`deaths tick=${s.tick}`); },
}));
vi.mock('../../src/sim/endgame', () => ({
  tickEndgame: (s: SimState) => { log.push(`endgame tick=${s.tick}`); },
}));

beforeEach(() => {
  log.length = 0;
});

describe('defaultConfig', () => {
  it('takes energy and base health from the balance table, both sides alike', () => {
    expect(defaultConfig(5)).toEqual({
      seed: 5,
      startEnergy: { plants: 200, zombies: 200 },
      baseHp: { plants: 3000, zombies: 3000 },
      cards: PHASE1_CARDS,
      incomeMultiplier: { plants: 1, zombies: 1 },
      suddenDeath: true,
    });
  });

  it('follows a different balance table', () => {
    const b: Balance = { ...BALANCE, startEnergy: 350, baseHp: 1234 };
    const c = defaultConfig(9, b);
    expect(c.startEnergy).toEqual({ plants: 350, zombies: 350 });
    expect(c.baseHp).toEqual({ plants: 1234, zombies: 1234 });
  });

  it('hands out its own card lists, not the shared ones', () => {
    const c = defaultConfig(1);
    c.cards.plants.push('potatoMine');
    expect(PHASE1_CARDS.plants).toEqual(['peashooter', 'sunflower', 'walnutBomb']);
    expect(defaultConfig(1).cards.plants).toHaveLength(3);
  });
});

describe('new Match', () => {
  it('starts from the config', () => {
    const m = new Match(defaultConfig(42));
    expect(m.balance).toBe(BALANCE);
    expect(m.state).toEqual({
      tick: 0, rng: 42, nextId: 1, units: [], projectiles: [],
      players: {
        plants: { energy: 200, carry: 0, recharge: {} },
        zombies: { energy: 200, carry: 0, recharge: {} },
      },
      baseHp: { plants: 3000, zombies: 3000 },
      baseMaxHp: { plants: 3000, zombies: 3000 },
      suddenDeath: false, winner: null,
      config: defaultConfig(42),
    });
  });

  it('keeps its own copy of the config', () => {
    const config = defaultConfig(3);
    const m = new Match(config);
    config.startEnergy.plants = 1;
    config.baseHp.zombies = 1;
    config.cards.plants.length = 0;
    config.incomeMultiplier.zombies = 9;
    config.seed = 99;
    expect(m.state.config).toEqual(defaultConfig(3));
    expect(m.state.config).not.toBe(config);

    m.state.config.cards.zombies.length = 0;
    expect(config.cards.zombies).toHaveLength(3);
  });

  it('uses the balance it is given', () => {
    const b: Balance = { ...BALANCE, trickle: { plants: 6, zombies: 0 } };
    const m = new Match(defaultConfig(1, b), b);
    expect(m.balance).toBe(b);
    for (let i = 0; i < 30; i++) m.step();
    expect(m.state.players.plants.energy).toBe(206);
    expect(m.state.players.zombies.energy).toBe(200);
  });
});

describe('step', () => {
  it('runs commands, economy, movement, attacks, projectiles, deaths, endgame, then the tick', () => {
    const m = new Match(defaultConfig(1));
    m.step([place('plants', 'peashooter', 0, 0)]);
    expect(log).toEqual([
      'economy tick=0 units=1', // the command already ran
      'movement tick=0',
      'attacks tick=0',
      'projectiles tick=0',
      'deaths tick=0',
      'endgame tick=0',
    ]);
    expect(m.state.tick).toBe(1);
  });

  it('adds one to the tick per step, with or without commands', () => {
    const m = new Match(defaultConfig(1));
    m.step();
    m.step([]);
    m.step([place('plants', 'peashooter', 0, 0)]);
    m.step([place('plants', 'peashooter', 0, 0)]); // rejected
    expect(m.state.tick).toBe(4);
    expect(log.filter((l) => l.startsWith('endgame'))).toHaveLength(4);
  });

  it('still ticks after a rejection', () => {
    const m = new Match(defaultConfig(1));
    const events = m.step([place('plants', 'brainEater', 0, 0)]);
    expect(events.map((e) => e.type)).toEqual(['commandRejected']);
    expect(m.state.tick).toBe(1);
  });

  it('returns a fresh events array every step', () => {
    const m = new Match(defaultConfig(1));
    const first = m.step([place('plants', 'peashooter', 0, 0)]);
    const second = m.step();
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });
});

describe('hash, snapshot and restore', () => {
  function play(m: Match, from: number, to: number): void {
    for (let i = from; i < to; i++) {
      if (i === 3) m.step([place('plants', 'sunflower', 1, 2), place('zombies', 'brainEater', 1, 0)]);
      else if (i === 40) m.step([place('plants', 'peashooter', 2, 5)]);
      else m.step();
    }
  }

  it('delegate to hashState and snapshotState', () => {
    const m = new Match(defaultConfig(11));
    play(m, 0, 20);
    expect(m.hash()).toBe(hashState(m.state));
    expect(m.snapshot()).toBe(snapshotState(m.state));
  });

  it('hash changes as the match moves', () => {
    const m = new Match(defaultConfig(11));
    const h0 = m.hash();
    m.step();
    expect(m.hash()).not.toBe(h0);
  });

  it('restore gives the same state, and then the same future', () => {
    const a = new Match(defaultConfig(11));
    play(a, 0, 50);
    const b = Match.restore(a.snapshot());
    expect(b.hash()).toBe(a.hash());
    expect(b.state).toEqual(a.state);
    expect(b.state).not.toBe(a.state);
    expect(b.balance).toBe(BALANCE);

    play(a, 50, 700);
    play(b, 50, 700);
    expect(b.hash()).toBe(a.hash());
    expect(b.snapshot()).toBe(a.snapshot());
  });

  it('restore shares nothing with the match it came from', () => {
    const a = new Match(defaultConfig(11));
    play(a, 0, 10);
    const before = a.hash();
    const b = Match.restore(a.snapshot());
    b.state.units[0]!.hp = 1;
    b.state.config.cards.plants.length = 0;
    b.state.players.plants.energy = 0;
    expect(a.hash()).toBe(before);
  });

  it('restore takes the balance it is given', () => {
    const b: Balance = { ...BALANCE, trickle: { plants: 0, zombies: 0 } };
    const m = Match.restore(new Match(defaultConfig(1)).snapshot(), b);
    expect(m.balance).toBe(b);
  });

  it('is reproducible: the same seed and commands give the same hash', () => {
    const a = new Match(defaultConfig(21));
    const b = new Match(defaultConfig(21));
    play(a, 0, 400);
    play(b, 0, 400);
    expect(a.hash()).toBe(b.hash());
  });
});
