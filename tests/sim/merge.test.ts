import { describe, expect, it } from 'vitest';
import { cloneBalance, seconds } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { UNIT_INFO } from '../../src/data/units';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { ZOMBIE_SPAWN_X } from '../../src/sim/types';
import type { Command, CommandRejection, Unit, UnitKey, CardKey } from '../../src/sim/types';
import { classicBalance, eventsOf, merge, place, remove } from './helpers';

/** The numbers these rules tests were written for (see `classicBalance`). */
const BALANCE = classicBalance();

/**
 * Units are set with `spawnUnit`. Income is switched off so energy moves only by what the
 * commands spend, and the start energy is the given amount for both sides.
 */
function fresh(energy = 1000): Match {
  const config = defaultConfig(7, BALANCE);
  config.startEnergy = { plants: energy, zombies: energy };
  config.incomeMultiplier = { plants: 0, zombies: 0 };
  return new Match(config, BALANCE);
}

function unitById(m: Match, id: number): Unit {
  const u = m.state.units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
}

describe('merging', () => {
  it('a Peashooter at 150/300 hp becomes level 2 at 300/600 hp, spent 200, for 100 energy and a card recharge', () => {
    const m = fresh(1000);
    const pea = spawnUnit(m.state, BALANCE, 'peashooter', 2, 3.5);
    pea.hp = 150;
    const cmd = merge('plants', 'peashooter', pea.id);
    expect(m.check(cmd)).toBeNull();

    const events = m.step([cmd]);

    expect(m.state.units).toHaveLength(1);
    expect(unitById(m, pea.id)).toMatchObject({
      key: 'peashooter', faction: 'plants', lane: 2, x: 3.5, level: 2, hp: 300, maxHp: 600, spent: 200,
    });
    expect(m.state.players.plants.energy).toBe(900);
    expect(m.state.players.zombies.energy).toBe(1000);
    // The card recharges as after placing it (the step's own economy stage already took one tick off).
    expect(m.state.players.plants.recharge.peashooter).toBe(seconds(5) - 1);
    expect(m.check(merge('plants', 'peashooter', pea.id))).toBe('recharging');
    expect(eventsOf(events, 'unitMerged')).toEqual([{ type: 'unitMerged', unitId: pea.id, level: 2 }]);
    expect(eventsOf(events, 'commandRejected')).toEqual([]);
    expect(eventsOf(events, 'unitSpawned')).toEqual([]);
  });

  it('carries the health share over, rounded: 301/600 at level 2 becomes 452/900 at level 3', () => {
    const m = fresh();
    const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
    pea.level = 2;
    pea.maxHp = 600;
    pea.hp = 301; // 900 × 301 / 600 = 451.5
    m.step([merge('plants', 'peashooter', pea.id)]);
    expect(unitById(m, pea.id)).toMatchObject({ level: 3, hp: 452, maxHp: 900 });
  });

  it('never leaves a merged unit below 1 hp', () => {
    const m = fresh();
    const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
    pea.hp = 0.2; // 600 × 0.2 / 300 = 0.4, which rounds to 0
    m.step([merge('plants', 'peashooter', pea.id)]);
    expect(unitById(m, pea.id)).toMatchObject({ level: 2, hp: 1, maxHp: 600 });
  });

  describe('with fractional level multipliers [0, 1, 1.9, 2.7, 3.4, 4]', () => {
    function tuned(): Balance {
      const b = cloneBalance(BALANCE);
      b.levelCurves.hp = { plants: [0, 1, 1.9, 2.7, 3.4, 4], zombies: [0, 1, 1.9, 2.7, 3.4, 4] };
      b.units.peashooter!.hp = 175; // 175 × 1.9 = 332.5, 175 × 2.7 = 472.50000000000006
      return b;
    }

    /** Merges `key` from level 1 to 5, setting its health with `hpBefore` before each merge. */
    function climb(key: CardKey, hpBefore: (u: Unit) => number): Array<[number, number, number]> {
      const b = tuned();
      const config = defaultConfig(7, b);
      config.startEnergy = { plants: 10_000, zombies: 10_000 };
      const m = new Match(config, b);
      // Alone on the lawn: nothing can hurt it, so its health is only what the merges make it.
      const u = spawnUnit(m.state, b, key, 2, UNIT_INFO[key].faction === 'plants' ? 0.5 : ZOMBIE_SPAWN_X);
      const seen: Array<[number, number, number]> = [];
      for (let level = 2; level <= 5; level++) {
        const cmd = merge(UNIT_INFO[key].faction, key, u.id);
        while (m.check(cmd) === 'recharging') m.step();
        u.hp = hpBefore(u);
        expect(eventsOf(m.step([cmd]), 'unitMerged')).toEqual([{ type: 'unitMerged', unitId: u.id, level }]);
        seen.push([u.level, u.hp, u.maxHp]);
      }
      return seen;
    }

    function expectWholeAndInRange(seen: Array<[number, number, number]>): void {
      for (const [level, hp, maxHp] of seen) {
        expect(Number.isInteger(maxHp), `level ${level} maxHp ${maxHp}`).toBe(true);
        expect(Number.isInteger(hp), `level ${level} hp ${hp}`).toBe(true);
        expect(hp, `level ${level}`).toBeGreaterThan(0);
        expect(hp, `level ${level}`).toBeLessThanOrEqual(maxHp);
      }
    }

    it('rounds max health and keeps a unit merged at full health exactly full', () => {
      const seen = climb('peashooter', (u) => u.maxHp);
      expect(seen).toEqual([[2, 333, 333], [3, 473, 473], [4, 595, 595], [5, 700, 700]]);
      expectWholeAndInRange(seen);
    });

    it('keeps a unit merged at 1 hp at a whole, positive health', () => {
      const seen = climb('peashooter', () => 1);
      // round(333 × 1 / 175) = 2, round(473 / 333) = 1, round(595 / 473) = 1, round(700 / 595) = 1
      expect(seen).toEqual([[2, 2, 333], [3, 1, 473], [4, 1, 595], [5, 1, 700]]);
      expectWholeAndInRange(seen);
    });

    it.each(['peashooter', 'sunflower', 'walnutBomb', 'brainEater', 'veryFastWalker', 'skeletonWarrior'] as CardKey[])(
      '%s stays whole and within its max at full health, at 1 hp and in between',
      (key) => {
        expectWholeAndInRange(climb(key, (u) => u.maxHp));
        expectWholeAndInRange(climb(key, () => 1));
        expectWholeAndInRange(climb(key, (u) => Math.max(1, u.maxHp - 0.5)));
      },
    );
  });

  it('merging a zombie mid-walk keeps its x: only level, health, spent, energy and the card change', () => {
    const merged = fresh();
    const twin = fresh();
    for (const m of [merged, twin]) {
      spawnUnit(m.state, BALANCE, 'brainEater', 1, 9.5);
      for (let i = 0; i < 40; i++) m.step();
    }
    const z = merged.state.units[0]!;
    const xBefore = z.x;
    expect(xBefore).toBeLessThan(9.5);

    const events = merged.step([merge('zombies', 'brainEater', z.id)]);
    twin.step();

    expect(eventsOf(events, 'unitMerged')).toEqual([{ type: 'unitMerged', unitId: z.id, level: 2 }]);
    const after = merged.state.units[0]!;
    const twinAfter = twin.state.units[0]!;
    expect(after.x).toBe(twinAfter.x); // it walked on exactly as if nothing had happened
    expect(after.x).toBeCloseTo(xBefore - 0.35 / 30, 12);
    expect(after).toEqual({ ...twinAfter, level: 2, hp: 800, maxHp: 800, spent: 200 });
    expect(merged.state.players.zombies.energy).toBe(900);
    expect(merged.state.players.zombies.recharge.brainEater).toBe(seconds(5) - 1);
  });

  it('a level-2 Sunflower pays 50 per interval', () => {
    const m = fresh(1000);
    const sun = spawnUnit(m.state, BALANCE, 'sunflower', 0, 0.5); // its sun timer starts at 300
    m.step([merge('plants', 'sunflower', sun.id)]); // 1000 - 50

    const pays: Array<{ tick: number; amount: number }> = [];
    for (let i = 0; i < 600; i++) {
      const tick = m.state.tick;
      for (const e of eventsOf(m.step(), 'energyGained')) pays.push({ tick, amount: e.amount });
    }

    expect(pays).toEqual([{ tick: 299, amount: 50 }, { tick: 599, amount: 50 }]);
    expect(m.state.players.plants.energy).toBe(950 + 100);
  });

  it('goes up one level per merge to level 5, and a level-5 unit rejects with max-level', () => {
    const m = fresh(10_000);
    const nut = spawnUnit(m.state, BALANCE, 'walnutBomb', 2, 4.5);
    const cmd = merge('plants', 'walnutBomb', nut.id);
    for (let level = 2; level <= 5; level++) {
      while (m.check(cmd) === 'recharging') m.step();
      const events = m.step([cmd]);
      expect(eventsOf(events, 'unitMerged')).toEqual([{ type: 'unitMerged', unitId: nut.id, level }]);
      expect(unitById(m, nut.id)).toMatchObject({ level, hp: 1200 * level, maxHp: 1200 * level, spent: 75 * level });
    }
    while ((m.state.players.plants.recharge.walnutBomb ?? 0) > 0) m.step();

    expect(m.check(cmd)).toBe('max-level');
    const energy = m.state.players.plants.energy;
    const events = m.step([cmd]);
    expect(eventsOf(events, 'commandRejected')).toEqual([{ type: 'commandRejected', command: cmd, reason: 'max-level' }]);
    expect(unitById(m, nut.id)).toMatchObject({ level: 5, maxHp: 6000, spent: 375 });
    expect(m.state.players.plants.energy).toBe(energy);
  });

  it('takes commands in order: a merge after placing the same card waits for the recharge', () => {
    const m = fresh();
    const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
    const events = m.step([place('plants', 'peashooter', 1, 1), merge('plants', 'peashooter', pea.id)]);
    expect(eventsOf(events, 'commandRejected').map((e) => e.reason)).toEqual(['recharging']);
    expect(unitById(m, pea.id).level).toBe(1);
  });

  it('a merged unit pays a bounty on what both cards cost', () => {
    const m = fresh();
    const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
    m.step([merge('plants', 'peashooter', pea.id)]);
    unitById(m, pea.id).hp = 0;
    const events = m.step();
    expect(eventsOf(events, 'energyGained')).toEqual([
      expect.objectContaining({ faction: 'zombies', amount: 100, source: 'bounty' }), // 50% of 200
    ]);
  });
});

describe('merge rejections', () => {
  /**
   * Each case: make a match, name the command, and expect `check` to name the reason, `step` to
   * emit the same reason in a `commandRejected` event, and no unit, energy or card to change.
   */
  const cases: Array<[CommandRejection, string, (m: Match) => Command]> = [
    ['match-over', 'a winner is set', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      m.state.winner = 'plants';
      return merge('plants', 'peashooter', pea.id);
    }],
    ['wrong-side', 'plants name a zombie card', (m) => {
      const z = spawnUnit(m.state, BALANCE, 'brainEater', 0, 6);
      return merge('plants', 'brainEater', z.id);
    }],
    ['wrong-side', 'zombies name a plant card', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      return merge('zombies', 'peashooter', pea.id);
    }],
    ['not-in-hand', 'a plant card outside the three', () => merge('plants', 'potatoMine', 999)],
    ['not-in-hand', 'a card taken out of the hand', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      m.state.config.cards.plants = ['sunflower'];
      return merge('plants', 'peashooter', pea.id);
    }],
    ['no-target', 'an id never handed out', () => merge('plants', 'peashooter', 999)],
    ['no-target', 'id 0', () => merge('plants', 'peashooter', 0)],
    ['no-target', 'id NaN', () => merge('plants', 'peashooter', Number.NaN)],
    ['no-target', 'a unit already at 0 hp', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      pea.hp = 0;
      pea.spent = 0; // the step's deaths stage clears it away; with nothing spent it pays no bounty
      return merge('plants', 'peashooter', pea.id);
    }],
    ['no-target', 'a unit removed one step earlier', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      m.step([remove('plants', pea.id)]);
      return merge('plants', 'peashooter', pea.id);
    }],
    ['no-target', 'the id of a projectile', (m) => {
      spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      while (m.state.projectiles.length === 0) m.step();
      return merge('plants', 'peashooter', m.state.projectiles[0]!.id);
    }],
    ['not-yours', 'plants aim at a zombie', (m) => {
      const z = spawnUnit(m.state, BALANCE, 'brainEater', 0, 6);
      return merge('plants', 'peashooter', z.id);
    }],
    ['not-yours', 'zombies aim at a plant', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      return merge('zombies', 'brainEater', pea.id);
    }],
    ['wrong-type', 'a Sunflower card on a Peashooter', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      return merge('plants', 'sunflower', pea.id);
    }],
    ['wrong-type', 'a Very Fast Walker card on a Brain Eater', (m) => {
      const z = spawnUnit(m.state, BALANCE, 'brainEater', 0, 6);
      return merge('zombies', 'veryFastWalker', z.id);
    }],
    ['max-level', 'a level-5 Peashooter', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      pea.level = 5;
      return merge('plants', 'peashooter', pea.id);
    }],
    ['recharging', 'the card was just placed', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      m.step([place('plants', 'peashooter', 1, 1)]);
      return merge('plants', 'peashooter', pea.id);
    }],
    ['recharging', 'the card was just merged', (m) => {
      const z = spawnUnit(m.state, BALANCE, 'skeletonWarrior', 3, 9);
      m.step([merge('zombies', 'skeletonWarrior', z.id)]);
      return merge('zombies', 'skeletonWarrior', z.id);
    }],
    ['no-energy', 'one short for a Peashooter', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      m.state.players.plants.energy = 99;
      return merge('plants', 'peashooter', pea.id);
    }],
    ['no-energy', 'one short for a Skeleton Warrior', (m) => {
      const z = spawnUnit(m.state, BALANCE, 'skeletonWarrior', 3, 9);
      m.state.players.zombies.energy = 124;
      return merge('zombies', 'skeletonWarrior', z.id);
    }],
  ];

  it.each(cases)('%s: %s', (reason, _name, setup) => {
    const m = fresh();
    const cmd = setup(m);
    // Standing units only: one set to 0 hp by a case is cleared away by the step's deaths stage.
    const levels = (): unknown[] => m.state.units
      .filter((u) => u.hp > 0)
      .map((u) => ({ id: u.id, level: u.level, hp: u.hp, maxHp: u.maxHp, spent: u.spent }));
    const before = levels();
    const energy = { plants: m.state.players.plants.energy, zombies: m.state.players.zombies.energy };
    const recharging = {
      plants: Object.keys(m.state.players.plants.recharge).sort(),
      zombies: Object.keys(m.state.players.zombies.recharge).sort(),
    };

    expect(m.check(cmd)).toBe(reason);
    const events = m.step([cmd]);

    if (reason === 'match-over') {
      expect(events).toEqual([]); // a finished match ignores commands altogether
    } else {
      expect(eventsOf(events, 'commandRejected')).toEqual([{ type: 'commandRejected', command: cmd, reason }]);
    }
    expect(eventsOf(events, 'unitMerged')).toEqual([]);
    expect(levels()).toEqual(before);
    expect(m.state.players.plants.energy).toBe(energy.plants);
    expect(m.state.players.zombies.energy).toBe(energy.zombies);
    // A rejected merge starts no recharge on any card.
    expect(Object.keys(m.state.players.plants.recharge).sort()).toEqual(recharging.plants);
    expect(Object.keys(m.state.players.zombies.recharge).sort()).toEqual(recharging.zombies);
  });

  it('checks the merge rules in the documented order', () => {
    const m = fresh();
    const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
    const z = spawnUnit(m.state, BALANCE, 'brainEater', 4, 6);
    m.state.players.plants.energy = 0;
    m.state.players.plants.recharge.peashooter = 10;

    // Wrong side beats not in hand, and both beat a missing target.
    expect(m.check(merge('plants', 'brainEater', 999))).toBe('wrong-side');
    expect(m.check(merge('plants', 'potatoMine', 999))).toBe('not-in-hand');
    // No target beats everything about the target and the payment.
    expect(m.check(merge('plants', 'peashooter', 999))).toBe('no-target');
    // Not yours beats wrong type.
    expect(m.check(merge('plants', 'sunflower', z.id))).toBe('not-yours');
    expect(m.check(merge('plants', 'sunflower', pea.id))).toBe('wrong-type');
    // Max level beats the card's recharge, which beats energy.
    pea.level = 5;
    expect(m.check(merge('plants', 'peashooter', pea.id))).toBe('max-level');
    pea.level = 4;
    expect(m.check(merge('plants', 'peashooter', pea.id))).toBe('recharging');
    m.state.players.plants.recharge.peashooter = 0;
    expect(m.check(merge('plants', 'peashooter', pea.id))).toBe('no-energy');
    m.state.players.plants.energy = 100;
    expect(m.check(merge('plants', 'peashooter', pea.id))).toBeNull();
    // Match over beats all of them.
    m.state.winner = 'zombies';
    expect(m.check(merge('plants', 'brainEater', 999))).toBe('match-over');
  });
});
