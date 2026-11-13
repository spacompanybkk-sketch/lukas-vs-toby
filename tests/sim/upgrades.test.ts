import { describe, expect, it } from 'vitest';
import { BALANCE, cloneBalance } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { MAX_UPGRADE as SAVE_MAX_UPGRADE } from '../../src/progress/upgrades';
import { upgradeScale } from '../../src/sim/lookup';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { spawnMinion } from '../../src/sim/spawn';
import { BASE_STOP_X, MAX_UPGRADE, ZOMBIE_SPAWN_X } from '../../src/sim/types';
import type { CardKey, Command, Faction, MatchConfig, Unit } from '../../src/sim/types';
import { classicBalance, classicConfig, eventsOf, merge, place } from './helpers';

/**
 * The rules tests run on a step of their own, +5% health and +5% damage a level, so they test the
 * mechanics (where a multiplier goes, rounding, merges) whatever step the game is tuned to; the
 * shipped step is checked on its own below.
 */
const RULES_SIDE = Object.freeze({ hp: 0.05, damage: 0.05 });
const RULES_STEP = (): Balance['upgradeStep'] => ({ plants: { ...RULES_SIDE }, zombies: { ...RULES_SIDE } });
/** The rules numbers (see `classicBalance`): linear level curves, Peashooter 300 hp / 20 a pea. */
const B = classicBalance();
B.upgradeStep = RULES_STEP();
/** The shipped step, chosen by measurement (Task 5 follow-up, see the report). */
const SHIPPED = BALANCE.upgradeStep;
/** The rules multiplier at Marketplace `level`, written out from the rules step. */
const up = (level: number, what: 'hp' | 'damage'): number => 1 + RULES_SIDE[what] * level;

/** A quiet match on the classic numbers: no income, plenty of energy, these upgrades. */
function fresh(upgrades: MatchConfig['upgrades'] = { plants: {}, zombies: {} }, balance: Balance = B): Match {
  const config = classicConfig(7, balance);
  config.startEnergy = { plants: 5000, zombies: 5000 };
  config.incomeMultiplier = { plants: 0, zombies: 0 };
  config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
  config.upgrades = upgrades;
  return new Match(config, balance);
}

function unitById(m: Match, id: number): Unit {
  const u = m.state.units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
}

/** Steps until a `unitDamaged` on `targetId` happens; returns its amount. */
function firstHit(m: Match, targetId: number, limit = 600): number {
  for (let i = 0; i < limit; i++) {
    const hit = eventsOf(m.step(), 'unitDamaged').find((e) => e.unitId === targetId);
    if (hit) return hit.amount;
  }
  throw new Error(`no hit on ${targetId} in ${limit} steps`);
}

describe('Balance.upgradeStep', () => {
  it('is per side, as measured (see the Task 5 report); the classic helper keeps it', () => {
    expect(BALANCE.upgradeStep).toEqual({ plants: { hp: 0.005, damage: 0.05 }, zombies: { hp: 0, damage: 0.03 } });
    expect(classicBalance().upgradeStep).toEqual(BALANCE.upgradeStep);
  });

  it('the shipped step: plants 1 / 1.005 / 1.05 health and 1 / 1.05 / 1.5 damage at levels 0 / 1 / 10', () => {
    const c = defaultConfig(1);
    const pea = { key: 'peashooter', faction: 'plants' } as const;
    const at = (level: number, what: 'hp' | 'damage'): number => {
      c.upgrades = { plants: { peashooter: level }, zombies: {} };
      return upgradeScale(BALANCE, c, pea, what);
    };
    expect([at(0, 'hp'), at(1, 'hp'), at(10, 'hp')].map((v) => +v.toFixed(12))).toEqual([1, 1.005, 1.05]);
    expect([at(0, 'damage'), at(1, 'damage'), at(10, 'damage')].map((v) => +v.toFixed(12))).toEqual([1, 1.05, 1.5]);
  });

  it('the shipped step: zombies 1 health at every level and 1 / 1.03 / 1.3 damage at levels 0 / 1 / 10', () => {
    const c = defaultConfig(1);
    const eater = { key: 'brainEater', faction: 'zombies' } as const;
    const at = (level: number, what: 'hp' | 'damage'): number => {
      c.upgrades = { plants: {}, zombies: { brainEater: level } };
      return upgradeScale(BALANCE, c, eater, what);
    };
    expect([at(0, 'hp'), at(1, 'hp'), at(10, 'hp')]).toEqual([1, 1, 1]);
    expect([at(0, 'damage'), at(1, 'damage'), at(10, 'damage')].map((v) => +v.toFixed(12))).toEqual([1, 1.03, 1.3]);
  });

  it('the simulation and the save agree on the top level (10)', () => {
    expect(MAX_UPGRADE).toBe(10);
    expect(SAVE_MAX_UPGRADE).toBe(MAX_UPGRADE);
  });
});

describe('upgradeScale', () => {
  const config = (level: number): MatchConfig => {
    const c = defaultConfig(1, B);
    c.upgrades = { plants: { peashooter: level }, zombies: { brainEater: level } };
    return c;
  };
  const pea = { key: 'peashooter', faction: 'plants' } as const;
  const eater = { key: 'brainEater', faction: 'zombies' } as const;

  it('is exactly 1, 1 + step and 1 + 10 × step at levels 0, 1 and 10, for health and damage, both sides', () => {
    for (const unit of [pea, eater]) {
      for (const what of ['hp', 'damage'] as const) {
        expect(upgradeScale(B, config(0), unit, what)).toBe(1);
        expect(upgradeScale(B, config(1), unit, what)).toBe(1 + RULES_SIDE[what]);
        expect(upgradeScale(B, config(10), unit, what)).toBe(1 + RULES_SIDE[what] * 10);
      }
    }
  });

  it('is 1 for a unit with no entry, for a Bone Minion and for a rock', () => {
    const c = config(10);
    expect(upgradeScale(B, c, { key: 'sunflower', faction: 'plants' }, 'hp')).toBe(1);
    expect(upgradeScale(B, c, { key: 'boneMinion', faction: 'zombies' }, 'hp')).toBe(1);
    expect(upgradeScale(B, c, { key: 'boneMinion', faction: 'zombies' }, 'damage')).toBe(1);
    expect(upgradeScale(B, c, { key: 'rock', faction: 'plants' }, 'hp')).toBe(1);
  });

  it('reads its own side\'s step from the balance table it is given', () => {
    const b = cloneBalance(B);
    b.upgradeStep = { plants: { hp: 0.1, damage: 0.02 }, zombies: { hp: 0, damage: 0.2 } };
    expect(upgradeScale(b, config(10), pea, 'hp')).toBe(2);
    expect(upgradeScale(b, config(10), pea, 'damage')).toBe(1.2);
    expect(upgradeScale(b, config(10), eater, 'hp')).toBe(1);
    expect(upgradeScale(b, config(10), eater, 'damage')).toBe(3);
  });
});

describe('the setup', () => {
  it('a default and a classic setup have no upgrades', () => {
    expect(defaultConfig(3).upgrades).toEqual({ plants: {}, zombies: {} });
    expect(classicConfig(3).upgrades).toEqual({ plants: {}, zombies: {} });
  });

  it('the match keeps its own copy of the upgrades', () => {
    const ups: MatchConfig['upgrades'] = { plants: { peashooter: 2 }, zombies: {} };
    const m = fresh(ups);
    ups.plants.peashooter = 9;
    ups.zombies.brainEater = 4;
    expect(m.state.config.upgrades).toEqual({ plants: { peashooter: 2 }, zombies: {} });
  });

  it.each<[string, MatchConfig['upgrades']]>([
    ['a level above 10', { plants: { peashooter: 11 }, zombies: {} }],
    ['a negative level', { plants: {}, zombies: { brainEater: -1 } }],
    ['a fractional level', { plants: { peashooter: 2.5 }, zombies: {} }],
    ['NaN', { plants: { peashooter: Number.NaN }, zombies: {} }],
    ['the other side\'s card', { plants: { brainEater: 3 } as Partial<Record<CardKey, number>>, zombies: {} }],
    ['a key that is no card', { plants: { rock: 3 } as unknown as Partial<Record<CardKey, number>>, zombies: {} }],
  ])('refuses %s', (_name, upgrades) => {
    expect(() => fresh(upgrades)).toThrow(RangeError);
  });
});

describe('a unit with upgrades', () => {
  it('a Peashooter at upgrade 10 is placed with 300 × (1 + 10 × step) health, rounded', () => {
    const m = fresh({ plants: { peashooter: 10 }, zombies: {} });
    m.step([place('plants', 'peashooter', 2, 1)]);
    const hp = Math.round(300 * up(10, 'hp'));
    expect(hp).toBeGreaterThan(300);
    expect(m.state.units[0]).toMatchObject({ key: 'peashooter', level: 1, hp, maxHp: hp });
  });

  it('upgrade 0 changes nothing: health and shots are the plain numbers', () => {
    const m = fresh({ plants: { peashooter: 0 }, zombies: {} });
    const pea = spawnUnit(m.state, B, 'peashooter', 2, 1.5);
    expect(pea.maxHp).toBe(300);
    const z = spawnUnit(m.state, B, 'skeletonWarrior', 2, 6);
    expect(firstHit(m, z.id)).toBe(20);
  });

  it('a Peashooter at upgrade 1 shoots peas of 20 × (1 + step)', () => {
    const m = fresh({ plants: { peashooter: 1 }, zombies: {} });
    spawnUnit(m.state, B, 'peashooter', 2, 1.5);
    const z = spawnUnit(m.state, B, 'skeletonWarrior', 2, 6);
    expect(firstHit(m, z.id)).toBeCloseTo(20 * up(1, 'damage'), 10);
  });

  it('a Brain Eater at upgrade 10 bites for 40 × (1 + 10 × step), with 400 × (1 + 10 × step) health', () => {
    const m = fresh({ plants: {}, zombies: { brainEater: 10 } });
    const wall = spawnUnit(m.state, B, 'walnutBomb', 2, 3.5);
    const eater = spawnUnit(m.state, B, 'brainEater', 2, 4.0);
    expect(eater.maxHp).toBe(Math.round(400 * up(10, 'hp')));
    let bite: number | undefined;
    for (let i = 0; i < 300 && bite === undefined; i++) {
      const events = m.step();
      const attacked = eventsOf(events, 'unitAttacked').find((e) => e.unitId === eater.id && e.attack === 'melee');
      if (attacked) bite = eventsOf(events, 'unitDamaged').find((e) => e.unitId === wall.id)?.amount;
    }
    expect(bite).toBeCloseTo(40 * up(10, 'damage'), 10);
  });

  it('upgrades of the other side do not reach this side', () => {
    const m = fresh({ plants: {}, zombies: { brainEater: 10 } });
    const pea = spawnUnit(m.state, B, 'peashooter', 2, 1.5);
    expect(pea.maxHp).toBe(300);
  });

  it('a level-2 Peashooter merged with upgrade 3: 300 × 2 × (1 + 3 × step) health, peas of 20 × 2 × (1 + 3 × step)', () => {
    const m = fresh({ plants: { peashooter: 3 }, zombies: {} });
    m.step([place('plants', 'peashooter', 2, 1)]);
    const pea = m.state.units[0] as Unit;
    const one = Math.round(300 * up(3, 'hp'));
    expect(pea.maxHp).toBe(one);
    pea.hp = one;
    m.state.players.plants.recharge = {};
    m.step([merge('plants', 'peashooter', pea.id)]);
    const two = Math.round(600 * up(3, 'hp'));
    expect(unitById(m, pea.id)).toMatchObject({ level: 2, maxHp: two, hp: two });
    const z = spawnUnit(m.state, B, 'skeletonWarrior', 2, 6);
    expect(firstHit(m, z.id)).toBeCloseTo(40 * up(3, 'damage'), 10);
  });

  it('a merge keeps the health share with an upgrade: two thirds stays two thirds, rounded', () => {
    const m = fresh({ plants: { peashooter: 3 }, zombies: {} });
    const pea = spawnUnit(m.state, B, 'peashooter', 2, 1.5);
    const one = pea.maxHp;
    const old = Math.round(one * 2 / 3);
    pea.hp = old;
    m.step([merge('plants', 'peashooter', pea.id)]);
    const two = Math.round(600 * up(3, 'hp'));
    expect(unitById(m, pea.id)).toMatchObject({ level: 2, maxHp: two, hp: Math.round(two * old / one) });
  });

  it('a Pumpkin Squash leap is not unit damage: the same 350 at upgrade 10', () => {
    const m = fresh({ plants: { pumpkinSquash: 10 }, zombies: {} });
    spawnUnit(m.state, B, 'pumpkinSquash', 2, 2.5);
    const z = spawnUnit(m.state, B, 'skeletonWarrior', 2, 3.8);
    z.hp = 5000;
    z.maxHp = 5000;
    expect(firstHit(m, z.id)).toBe(350);
  });

  it('a Necromancer at upgrade 10 raises plain Bone Minions (they take no upgrade)', () => {
    const m = fresh({ plants: {}, zombies: { necromancer: 10 } }, Object.assign(cloneBalance(BALANCE), { upgradeStep: RULES_STEP() }));
    const necro = spawnUnit(m.state, m.balance, 'necromancer', 2, 8);
    const minion = spawnMinion(m.state, m.balance, 2, 8, 1, necro.id, []);
    expect(necro.maxHp).toBe(Math.round(BALANCE.units.necromancer!.hp * up(10, 'hp')));
    expect(minion.maxHp).toBe(BALANCE.units.boneMinion!.hp);
  });

  it('a Rock Wall rock takes no upgrade', () => {
    const m = fresh({ plants: { peashooter: 10, walnutBomb: 10 }, zombies: {} });
    expect(spawnUnit(m.state, B, 'rock', 1, 2.5).maxHp).toBe(B.units.rock!.hp);
  });

  it('a Hot Topic grows by its upgraded health, so a later merge does not jump', () => {
    const m = fresh({ plants: {}, zombies: { hotTopic: 10 } });
    const plant = spawnUnit(m.state, B, 'sunflower', 2, 3.5);
    plant.hp = 1;
    const ht = spawnUnit(m.state, B, 'hotTopic', 2, 4.0);
    const base = Math.round(300 * up(10, 'hp'));
    expect(ht.maxHp).toBe(base);
    for (let i = 0; i < 120 && ht.stacks === 0; i++) m.step();
    expect(ht.stacks).toBe(1);
    // classic hotTopic: a stack adds 0.2 of its upgraded base health.
    expect(ht.maxHp).toBe(base + Math.round(0.2 * 300 * up(10, 'hp')));
    const before = ht.hp / ht.maxHp;
    m.step([merge('zombies', 'hotTopic', ht.id)]);
    // 300 × 2 × upgrade × (1 + 0.2 × 1)
    expect(ht.maxHp).toBe(Math.round(300 * 2 * up(10, 'hp') * 1.2));
    expect(ht.hp / ht.maxHp).toBeCloseTo(before, 2);
  });

  it('the plant base strikes an upgraded zombie in proportion: as many strikes fell it as a plain one', () => {
    const m = fresh({ plants: {}, zombies: { brainEater: 10 } }, (() => {
      const b = cloneBalance(B);
      b.baseDefense = { damage: 100, interval: 2, paysBounty: true };
      return b;
    })());
    const z = spawnUnit(m.state, m.balance, 'brainEater', 2, BASE_STOP_X);
    let strike: number | undefined;
    for (let i = 0; i < 60 && strike === undefined; i++) {
      const events = m.step();
      if (eventsOf(events, 'baseStruck').length > 0) strike = eventsOf(events, 'unitDamaged').find((e) => e.unitId === z.id)?.amount;
    }
    expect(strike).toBeCloseTo(100 * up(10, 'hp'), 10);
  });
});

describe('determinism with upgrades', () => {
  const ups: MatchConfig['upgrades'] = {
    plants: { peashooter: 4, kernelPult: 10, walnutBomb: 1 },
    zombies: { brainEater: 7, hotTopic: 3, necromancer: 10 },
  };
  const script = (tick: number): Command[] => {
    const cmds: Command[] = [];
    if (tick % 90 === 0) cmds.push(place('plants', (['peashooter', 'kernelPult', 'walnutBomb'] as const)[(tick / 90) % 3]!, (tick / 90) % 5, (tick / 450) % 4));
    if (tick % 70 === 0) {
      const z = (['brainEater', 'hotTopic', 'necromancer'] as const)[(tick / 70) % 3]!;
      cmds.push({ type: 'place', faction: 'zombies', unit: z, lane: (tick / 70) % 5, col: 9 });
    }
    return cmds;
  };
  const run = (from?: string, upTo = 1800): Match => {
    const m = from === undefined ? fresh(ups) : Match.restore(from, B);
    while (m.state.tick < upTo && m.state.winner === null) m.step(script(m.state.tick));
    return m;
  };

  it('two runs agree on every checksum, and a snapshot taken half-way finishes the same', () => {
    const a = run();
    const b = run();
    expect(b.hash()).toBe(a.hash());
    const half = run(undefined, 900);
    const resumed = run(half.snapshot());
    expect(resumed.hash()).toBe(a.hash());
    expect(resumed.state.config.upgrades).toEqual(ups);
  });

  it('the upgrades change the match (and its checksum)', () => {
    const plain = fresh();
    const upgraded = fresh(ups);
    expect(upgraded.hash()).not.toBe(plain.hash());
    const units = (m: Match): number => m.state.units.reduce((n, u) => n + u.maxHp, 0);
    const a = fresh();
    const b = fresh(ups);
    for (let t = 0; t < 400; t++) {
      a.step(script(t));
      b.step(script(t));
    }
    expect(units(b)).toBeGreaterThan(units(a));
  });
});

describe('every card scales', () => {
  it.each([...ALL_CARDS.plants, ...ALL_CARDS.zombies] as CardKey[])('%s at upgrade 10 has (1 + 10 × its side\'s shipped hp step) × its health', (key) => {
    const faction: Faction = (ALL_CARDS.plants as readonly CardKey[]).includes(key) ? 'plants' : 'zombies';
    const config = defaultConfig(1);
    config.upgrades = { plants: {}, zombies: {} };
    config.upgrades[faction][key] = 10;
    const m = new Match(config);
    const u = spawnUnit(m.state, m.balance, key, 1, faction === 'plants' ? 2.5 : ZOMBIE_SPAWN_X);
    expect(u.maxHp).toBe(Math.round(BALANCE.units[key]!.hp * (1 + 10 * SHIPPED[faction].hp)));
  });
});
