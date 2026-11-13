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

/** The rules numbers (see `classicBalance`): linear level curves, Peashooter 300 hp / 20 a pea. */
const B = classicBalance();

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
  it('is +5% health and +5% damage a level', () => {
    expect(BALANCE.upgradeStep).toEqual({ hp: 0.05, damage: 0.05 });
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

  it('is exactly 1, 1.05 and 1.5 at levels 0, 1 and 10, for health and damage, both sides', () => {
    for (const unit of [pea, eater]) {
      for (const what of ['hp', 'damage'] as const) {
        expect(upgradeScale(B, config(0), unit, what)).toBe(1);
        expect(upgradeScale(B, config(1), unit, what)).toBe(1.05);
        expect(upgradeScale(B, config(10), unit, what)).toBe(1.5);
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

  it('reads the step from the balance table it is given', () => {
    const b = cloneBalance(B);
    b.upgradeStep = { hp: 0.1, damage: 0.02 };
    expect(upgradeScale(b, config(10), pea, 'hp')).toBe(2);
    expect(upgradeScale(b, config(10), pea, 'damage')).toBe(1.2);
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
  it('a Peashooter at upgrade 10 is placed with 450 of 450 health (300 × 1.5)', () => {
    const m = fresh({ plants: { peashooter: 10 }, zombies: {} });
    m.step([place('plants', 'peashooter', 2, 1)]);
    expect(m.state.units[0]).toMatchObject({ key: 'peashooter', level: 1, hp: 450, maxHp: 450 });
  });

  it('upgrade 0 changes nothing: health and shots are the plain numbers', () => {
    const m = fresh({ plants: { peashooter: 0 }, zombies: {} });
    const pea = spawnUnit(m.state, B, 'peashooter', 2, 1.5);
    expect(pea.maxHp).toBe(300);
    const z = spawnUnit(m.state, B, 'skeletonWarrior', 2, 6);
    expect(firstHit(m, z.id)).toBe(20);
  });

  it('a Peashooter at upgrade 1 shoots peas of 21 (20 × 1.05)', () => {
    const m = fresh({ plants: { peashooter: 1 }, zombies: {} });
    spawnUnit(m.state, B, 'peashooter', 2, 1.5);
    const z = spawnUnit(m.state, B, 'skeletonWarrior', 2, 6);
    expect(firstHit(m, z.id)).toBeCloseTo(21, 10);
  });

  it('a Brain Eater at upgrade 10 bites for 60 (40 × 1.5) and has 600 health', () => {
    const m = fresh({ plants: {}, zombies: { brainEater: 10 } });
    const wall = spawnUnit(m.state, B, 'walnutBomb', 2, 3.5);
    const eater = spawnUnit(m.state, B, 'brainEater', 2, 4.0);
    expect(eater.maxHp).toBe(600);
    let bite: number | undefined;
    for (let i = 0; i < 300 && bite === undefined; i++) {
      const events = m.step();
      const attacked = eventsOf(events, 'unitAttacked').find((e) => e.unitId === eater.id && e.attack === 'melee');
      if (attacked) bite = eventsOf(events, 'unitDamaged').find((e) => e.unitId === wall.id)?.amount;
    }
    expect(bite).toBeCloseTo(60, 10);
  });

  it('upgrades of the other side do not reach this side', () => {
    const m = fresh({ plants: {}, zombies: { brainEater: 10 } });
    const pea = spawnUnit(m.state, B, 'peashooter', 2, 1.5);
    expect(pea.maxHp).toBe(300);
  });

  it('a level-2 Peashooter merged with upgrade 3: 690 health (300 × 2 × 1.15), peas of 46 (20 × 2 × 1.15)', () => {
    const m = fresh({ plants: { peashooter: 3 }, zombies: {} });
    m.step([place('plants', 'peashooter', 2, 1)]);
    const pea = m.state.units[0] as Unit;
    expect(pea.maxHp).toBe(345);
    pea.hp = 345;
    m.state.players.plants.recharge = {};
    m.step([merge('plants', 'peashooter', pea.id)]);
    expect(unitById(m, pea.id)).toMatchObject({ level: 2, maxHp: 690, hp: 690 });
    const z = spawnUnit(m.state, B, 'skeletonWarrior', 2, 6);
    expect(firstHit(m, z.id)).toBeCloseTo(46, 10);
  });

  it('a merge keeps the health share with an upgrade: 230/345 becomes 460/690', () => {
    const m = fresh({ plants: { peashooter: 3 }, zombies: {} });
    const pea = spawnUnit(m.state, B, 'peashooter', 2, 1.5);
    pea.hp = 230;
    m.step([merge('plants', 'peashooter', pea.id)]);
    expect(unitById(m, pea.id)).toMatchObject({ level: 2, maxHp: 690, hp: 460 });
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
    const m = fresh({ plants: {}, zombies: { necromancer: 10 } }, cloneBalance(BALANCE));
    const necro = spawnUnit(m.state, m.balance, 'necromancer', 2, 8);
    const minion = spawnMinion(m.state, m.balance, 2, 8, 1, necro.id, []);
    expect(necro.maxHp).toBe(Math.round(BALANCE.units.necromancer!.hp * 1.5));
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
    expect(ht.maxHp).toBe(450);
    for (let i = 0; i < 120 && ht.stacks === 0; i++) m.step();
    expect(ht.stacks).toBe(1);
    // classic hotTopic: hpShare 0.2 of 300 × 1.5 = 90.
    expect(ht.maxHp).toBe(540);
    const before = ht.hp / ht.maxHp;
    m.step([merge('zombies', 'hotTopic', ht.id)]);
    // 300 × 2 × 1.5 × (1 + 0.2 × 1) = 1080
    expect(ht.maxHp).toBe(1080);
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
    expect(strike).toBeCloseTo(150, 10);
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
  it.each([...ALL_CARDS.plants, ...ALL_CARDS.zombies] as CardKey[])('%s at upgrade 10 has 1.5 × its health', (key) => {
    const faction: Faction = (ALL_CARDS.plants as readonly CardKey[]).includes(key) ? 'plants' : 'zombies';
    const config = defaultConfig(1);
    config.upgrades = { plants: {}, zombies: {} };
    config.upgrades[faction][key] = 10;
    const m = new Match(config);
    const u = spawnUnit(m.state, m.balance, key, 1, faction === 'plants' ? 2.5 : ZOMBIE_SPAWN_X);
    expect(u.maxHp).toBe(Math.round(BALANCE.units[key]!.hp * 1.5));
  });
});
