import { describe, expect, it } from 'vitest';
import { hashState, restoreState, snapshotState } from '../../src/sim/hash';
import type { SimState } from '../../src/sim/types';

/**
 * Checksum of `makeState()`, cross-checked against a separate implementation of the byte
 * layout documented in src/sim/hash.ts (standard FNV-1a over 769 bytes).
 */
const GOLDEN_HASH = 3495671101;

/** A fresh hand-built state each call, so a test can mutate its copy freely. */
function makeState(): SimState {
  return {
    tick: 120,
    rng: 0xdeadbeef,
    nextId: 5,
    units: [
      {
        id: 1, key: 'peashooter', faction: 'plants', lane: 2, x: 1, level: 2,
        hp: 80, maxHp: 120, spent: 150, meleeTimer: 0, shotTimer: 12, abilityTimer: 0, blocked: false,
      },
      {
        id: 3, key: 'brainEater', faction: 'zombies', lane: 2, x: 6.25, level: 1,
        hp: 90, maxHp: 100, spent: 100, meleeTimer: 4, shotTimer: 9, abilityTimer: 0, blocked: true,
      },
    ],
    projectiles: [
      { id: 4, kind: 'pea', faction: 'plants', lane: 2, x: 3.5, speed: 0.2, damage: 20, ownerId: 1 },
    ],
    players: {
      plants: { energy: 175, carry: 1234, recharge: { peashooter: 60, sunflower: 0 } },
      zombies: { energy: 125, carry: 0, recharge: { brainEater: 15 } },
    },
    baseHp: { plants: 500, zombies: 480 },
    baseMaxHp: { plants: 500, zombies: 500 },
    suddenDeath: false,
    winner: null,
    config: {
      seed: 42,
      startEnergy: { plants: 150, zombies: 150 },
      baseHp: { plants: 500, zombies: 500 },
      cards: {
        plants: ['peashooter', 'sunflower', 'walnutBomb'],
        zombies: ['brainEater', 'veryFastWalker', 'skeletonWarrior'],
      },
      incomeMultiplier: { plants: 1, zombies: 1.25 },
      suddenDeath: true,
    },
  };
}

function unit(s: SimState, index: number) {
  const u = s.units[index];
  if (!u) throw new Error(`no unit ${index}`);
  return u;
}

describe('hashState', () => {
  it('returns an unsigned 32-bit integer', () => {
    const h = hashState(makeState());
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('is stable across calls and between equal states', () => {
    const s = makeState();
    expect(hashState(s)).toBe(hashState(s));
    expect(hashState(makeState())).toBe(hashState(makeState()));
  });

  it('pins the byte layout (a change here invalidates every recorded checksum)', () => {
    expect(hashState(makeState())).toBe(GOLDEN_HASH);
  });

  // The six fields the spec names, then everything else the hash must cover.
  const mutations: Array<[string, (s: SimState) => void]> = [
    ['tick', (s) => { s.tick += 1; }],
    ['a unit x', (s) => { unit(s, 0).x += 0.001; }],
    ['a unit hp', (s) => { unit(s, 0).hp -= 1; }],
    ['a player energy', (s) => { s.players.plants.energy += 1; }],
    ['baseHp.plants', (s) => { s.baseHp.plants -= 1; }],
    ['a projectile x', (s) => { s.projectiles[0]!.x += 0.001; }],
    ['rng', (s) => { s.rng += 1; }],
    ['nextId', (s) => { s.nextId += 1; }],
    ['a unit key', (s) => { unit(s, 0).key = 'sunflower'; }],
    ['a unit faction', (s) => { unit(s, 0).faction = 'zombies'; }],
    ['a unit lane', (s) => { unit(s, 0).lane = 3; }],
    ['a unit level', (s) => { unit(s, 0).level = 3; }],
    ['a unit maxHp', (s) => { unit(s, 0).maxHp += 1; }],
    ['a unit spent', (s) => { unit(s, 0).spent += 1; }],
    ['a unit meleeTimer', (s) => { unit(s, 0).meleeTimer += 1; }],
    ['a unit shotTimer', (s) => { unit(s, 0).shotTimer += 1; }],
    ['a unit abilityTimer', (s) => { unit(s, 0).abilityTimer += 1; }],
    ['a unit blocked flag', (s) => { unit(s, 1).blocked = false; }],
    ['a projectile damage', (s) => { s.projectiles[0]!.damage += 1; }],
    ['a projectile kind', (s) => { s.projectiles[0]!.kind = 'brain'; }],
    ['a projectile owner', (s) => { s.projectiles[0]!.ownerId = 3; }],
    ['a player carry', (s) => { s.players.zombies.carry += 1; }],
    ['a card recharge value', (s) => { s.players.plants.recharge.peashooter = 59; }],
    ['a recharge of 0 versus absent', (s) => { delete s.players.plants.recharge.sunflower; }],
    ['a recharge on another card', (s) => { s.players.zombies.recharge.veryFastWalker = 1; }],
    ['baseHp.zombies', (s) => { s.baseHp.zombies -= 1; }],
    ['baseMaxHp', (s) => { s.baseMaxHp.zombies += 1; }],
    ['suddenDeath', (s) => { s.suddenDeath = true; }],
    ['winner', (s) => { s.winner = 'plants'; }],
    ['winner draw versus plants', (s) => { s.winner = 'draw'; }],
    ['unit count', (s) => { s.units.pop(); }],
    ['projectile count', (s) => { s.projectiles.pop(); }],
    ['config seed', (s) => { s.config.seed += 1; }],
    ['config startEnergy', (s) => { s.config.startEnergy.zombies += 1; }],
    ['config baseHp', (s) => { s.config.baseHp.plants += 1; }],
    ['config cards', (s) => { s.config.cards.plants = ['peashooter', 'sunflower']; }],
    ['config card order', (s) => { s.config.cards.zombies.reverse(); }],
    ['config incomeMultiplier', (s) => { s.config.incomeMultiplier.zombies = 1.5; }],
    ['config suddenDeath', (s) => { s.config.suddenDeath = false; }],
    ['unit array order', (s) => { s.units.reverse(); }],
  ];

  it.each(mutations)('changes when %s changes', (_name, mutate) => {
    const before = hashState(makeState());
    const s = makeState();
    mutate(s);
    expect(hashState(s)).not.toBe(before);
  });

  it('does not depend on the insertion order of object keys', () => {
    const a = makeState();
    const b = makeState();
    b.players = {
      zombies: { recharge: { brainEater: 15 }, carry: 0, energy: 125 },
      plants: { recharge: { sunflower: 0, peashooter: 60 }, carry: 1234, energy: 175 },
    };
    b.baseHp = { zombies: 480, plants: 500 };
    b.config.incomeMultiplier = { zombies: 1.25, plants: 1 };
    expect(hashState(b)).toBe(hashState(a));
  });

  it('treats -0 and 0 alike, as a JSON round trip does', () => {
    const a = makeState();
    const b = makeState();
    unit(a, 0).x = -0;
    unit(b, 0).x = 0;
    expect(hashState(a)).toBe(hashState(b));
  });
});

describe('snapshotState / restoreState', () => {
  it('round-trips to a deep-equal state with the same hash', () => {
    const s = makeState();
    const restored = restoreState(snapshotState(s));
    expect(restored).toEqual(s);
    expect(hashState(restored)).toBe(hashState(s));
  });

  it('round-trips a fractional x exactly, including 0.1 + 0.2', () => {
    const s = makeState();
    unit(s, 0).x = 0.1 + 0.2;
    s.projectiles[0]!.x = 1 / 3;
    const restored = restoreState(snapshotState(s));
    expect(unit(restored, 0).x).toBe(0.1 + 0.2);
    expect(restored.projectiles[0]!.x).toBe(1 / 3);
    expect(hashState(restored)).toBe(hashState(s));
  });

  it('round-trips a finished match', () => {
    const s = makeState();
    s.winner = 'draw';
    s.suddenDeath = true;
    const restored = restoreState(snapshotState(s));
    expect(restored.winner).toBe('draw');
    expect(hashState(restored)).toBe(hashState(s));
  });

  it('returns an independent copy', () => {
    const s = makeState();
    const restored = restoreState(snapshotState(s));
    restored.units.length = 0;
    restored.players.plants.energy = 0;
    expect(s.units).toHaveLength(2);
    expect(s.players.plants.energy).toBe(175);
  });

  it('produces a JSON string', () => {
    expect(typeof snapshotState(makeState())).toBe('string');
    expect(() => JSON.parse(snapshotState(makeState()))).not.toThrow();
  });
});
