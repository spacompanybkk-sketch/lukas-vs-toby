import { describe, expect, it } from 'vitest';
import { BALANCE, seconds } from '../../src/data/balance';
import { UNIT_INFO } from '../../src/data/units';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { Command, CommandRejection, SimEvent, UnitKey } from '../../src/sim/types';
import { ZOMBIE_SPAWN_X } from '../../src/sim/types';
import { eventsOf, place } from './helpers';

function fresh(): Match {
  return new Match(defaultConfig(7));
}

describe('placing a plant', () => {
  it('spends the price, charges the card, and puts the plant on the tile', () => {
    const m = fresh();
    const cmd = place('plants', 'peashooter', 2, 3);
    expect(m.check(cmd)).toBeNull();

    const events = m.step([cmd]);

    expect(m.state.players.plants.energy).toBe(100);
    expect(m.state.units).toHaveLength(1);
    const u = m.state.units[0];
    expect(u).toMatchObject({
      id: 1, key: 'peashooter', faction: 'plants', lane: 2, x: 3.5, level: 1,
      hp: 300, maxHp: 300, spent: 100, blocked: false,
    });
    expect(eventsOf(events, 'unitSpawned')).toEqual([
      { type: 'unitSpawned', unitId: 1, key: 'peashooter', faction: 'plants', lane: 2, x: 3.5 },
    ]);
    expect(eventsOf(events, 'commandRejected')).toEqual([]);
  });

  it('starts every timer at its full interval (minus the placing step\'s own tick)', () => {
    const m = fresh();
    m.state.players.plants.energy = 999;
    m.step([place('plants', 'peashooter', 0, 0), place('plants', 'sunflower', 1, 0), place('plants', 'walnutBomb', 2, 0)]);
    const [pea, sun, nut] = m.state.units;
    expect([pea?.meleeTimer, pea?.shotTimer, pea?.abilityTimer]).toEqual([0, seconds(1.5) - 1, 0]);
    expect([sun?.meleeTimer, sun?.shotTimer, sun?.abilityTimer]).toEqual([0, 0, seconds(10) - 1]);
    expect([nut?.meleeTimer, nut?.shotTimer, nut?.abilityTimer]).toEqual([0, 0, 0]);
    expect(nut).toMatchObject({ hp: 1200, maxHp: 1200, spent: 75 });
  });

  it('may be placed on a tile where a zombie stands', () => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'brainEater', 2, 3.5);
    const cmd = place('plants', 'peashooter', 2, 3);
    expect(m.check(cmd)).toBeNull();
    const events = m.step([cmd]);
    expect(eventsOf(events, 'unitSpawned')).toHaveLength(1);
    expect(m.state.units.filter((u) => u.faction === 'plants')).toHaveLength(1);
  });

  it('takes commands in the order given, each seeing the one before', () => {
    const m = fresh();
    const events = m.step([
      place('plants', 'peashooter', 0, 0), // 200 -> 100
      place('plants', 'walnutBomb', 1, 1), // 100 -> 25
      place('plants', 'sunflower', 2, 2), // 25 < 50
    ]);
    expect(m.state.units.map((u) => u.key)).toEqual(['peashooter', 'walnutBomb']);
    expect(m.state.players.plants.energy).toBe(25);
    expect(eventsOf(events, 'commandRejected').map((e) => e.reason)).toEqual(['no-energy']);
  });

  it('gives each unit the next id', () => {
    const m = fresh();
    m.step([place('plants', 'sunflower', 0, 0), place('plants', 'walnutBomb', 1, 0)]);
    expect(m.state.units.map((u) => u.id)).toEqual([1, 2]);
    expect(m.state.nextId).toBe(3);
  });
});

describe('placing a zombie', () => {
  it('appears at the spawn edge whatever the column says', () => {
    for (const col of [0, 3, 7, 9, -4, 99, 2.5]) {
      const m = fresh();
      const cmd = place('zombies', 'brainEater', 4, col);
      expect(m.check(cmd)).toBeNull();
      const events = m.step([cmd]);
      const u = m.state.units[0];
      expect(u).toMatchObject({
        key: 'brainEater', faction: 'zombies', lane: 4, x: 9.5, level: 1,
        hp: 400, maxHp: 400, spent: 100, blocked: false,
      });
      expect(ZOMBIE_SPAWN_X).toBe(9.5);
      expect(m.state.players.zombies.energy).toBe(100);
      expect(eventsOf(events, 'unitSpawned')).toEqual([
        { type: 'unitSpawned', unitId: 1, key: 'brainEater', faction: 'zombies', lane: 4, x: 9.5 },
      ]);
    }
  });

  it('may share a lane and a spawn point with another zombie', () => {
    const m = fresh();
    m.step([place('zombies', 'veryFastWalker', 1, 0), place('zombies', 'skeletonWarrior', 1, 0)]);
    expect(m.state.units).toHaveLength(2);
    expect(m.state.players.zombies.energy).toBe(25); // 200 - 50 - 125
  });
});

describe('spawnUnit', () => {
  it('creates a level-1 unit and charges nobody', () => {
    const m = fresh();
    const events: SimEvent[] = [];
    const u = spawnUnit(m.state, BALANCE, 'skeletonWarrior', 3, 5.5, events);
    expect(m.state.units).toEqual([u]);
    expect(u).toEqual({
      id: 1, key: 'skeletonWarrior', faction: 'zombies', lane: 3, x: 5.5, level: 1,
      hp: 700, maxHp: 700, spent: 125,
      meleeTimer: seconds(1.2), shotTimer: 0, abilityTimer: seconds(4), blocked: false,
    });
    expect(m.state.nextId).toBe(2);
    expect(m.state.players.zombies.energy).toBe(200);
    expect(m.state.players.zombies.recharge).toEqual({});
    expect(events).toEqual([
      { type: 'unitSpawned', unitId: 1, key: 'skeletonWarrior', faction: 'zombies', lane: 3, x: 5.5 },
    ]);
  });

  it('works without an events array and does not check placement', () => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'peashooter', 2, 3.5);
    const again = spawnUnit(m.state, BALANCE, 'peashooter', 2, 3.5); // same tile, no questions asked
    expect(again.id).toBe(2);
    expect(m.state.units).toHaveLength(2);
  });

  it('starts every Phase 1 unit at its full intervals', () => {
    const expected: Record<string, [number, number, number]> = {
      // meleeTimer, shotTimer, abilityTimer
      peashooter: [0, 45, 0],
      sunflower: [0, 0, 300],
      walnutBomb: [0, 0, 0],
      brainEater: [30, 60, 0],
      veryFastWalker: [21, 0, 0],
      skeletonWarrior: [36, 0, 120],
    };
    for (const [key, [melee, shot, ability]] of Object.entries(expected)) {
      const m = fresh();
      const u = spawnUnit(m.state, BALANCE, key as UnitKey, 0, 1.5);
      expect([key, u.meleeTimer, u.shotTimer, u.abilityTimer]).toEqual([key, melee, shot, ability]);
      expect(u.hp).toBe(BALANCE.units[key as UnitKey]?.hp);
      expect(u.spent).toBe(UNIT_INFO[key as UnitKey].price);
    }
  });

  it('refuses a unit the balance table has no numbers for', () => {
    const m = fresh();
    expect(() => spawnUnit(m.state, BALANCE, 'potatoMine', 0, 1.5)).toThrow(/potatoMine/);
    expect(m.state.units).toHaveLength(0);
    expect(m.state.nextId).toBe(1);
  });
});

describe('rejections', () => {
  /**
   * Each case: make a match, name the command, and expect `check` to name the reason, `step`
   * to emit the same reason in a `commandRejected` event, and nothing to change.
   */
  const cases: Array<[CommandRejection, string, (m: Match) => Command]> = [
    ['match-over', 'a winner is set', (m) => {
      m.state.winner = 'zombies';
      return place('plants', 'peashooter', 2, 3);
    }],
    ['match-over', 'a draw is set', (m) => {
      m.state.winner = 'draw';
      return place('zombies', 'brainEater', 2, 0);
    }],
    ['wrong-side', 'plants ask for a zombie', () => place('plants', 'brainEater', 2, 3)],
    ['wrong-side', 'zombies ask for a plant', () => place('zombies', 'peashooter', 2, 3)],
    ['not-in-hand', 'a plant outside the three cards', () => place('plants', 'potatoMine', 2, 3)],
    ['not-in-hand', 'a zombie outside the three cards', () => place('zombies', 'desertZombie', 2, 0)],
    ['not-in-hand', 'a card taken out of the hand', (m) => {
      m.state.config.cards.plants = ['sunflower'];
      return place('plants', 'peashooter', 2, 3);
    }],
    ['bad-lane', 'lane 5', () => place('plants', 'peashooter', 5, 3)],
    ['bad-lane', 'lane -1', () => place('plants', 'peashooter', -1, 3)],
    ['bad-lane', 'lane 1.5', () => place('plants', 'peashooter', 1.5, 3)],
    ['bad-lane', 'lane NaN', () => place('plants', 'peashooter', Number.NaN, 3)],
    ['bad-lane', 'a zombie in lane 5', () => place('zombies', 'brainEater', 5, 0)],
    ['bad-lane', 'a zombie in lane 0.5', () => place('zombies', 'brainEater', 0.5, 0)],
    ['bad-column', 'column 8', () => place('plants', 'peashooter', 2, 8)],
    ['bad-column', 'column -1', () => place('plants', 'peashooter', 2, -1)],
    ['bad-column', 'column 2.5', () => place('plants', 'peashooter', 2, 2.5)],
    ['bad-column', 'column NaN', () => place('plants', 'peashooter', 2, Number.NaN)],
    ['occupied', 'a plant already on the tile', (m) => {
      spawnUnit(m.state, BALANCE, 'sunflower', 2, 3.5);
      return place('plants', 'peashooter', 2, 3);
    }],
    ['occupied', 'a plant placed one step earlier', (m) => {
      m.step([place('plants', 'sunflower', 0, 0)]);
      return place('plants', 'peashooter', 0, 0);
    }],
    ['recharging', 'the same card straight after', (m) => {
      m.step([place('plants', 'peashooter', 0, 0)]);
      m.state.players.plants.energy = 200;
      return place('plants', 'peashooter', 1, 1);
    }],
    ['recharging', 'a zombie card straight after', (m) => {
      m.step([place('zombies', 'brainEater', 0, 0)]);
      m.state.players.zombies.energy = 200;
      return place('zombies', 'brainEater', 1, 0);
    }],
    ['no-energy', 'one short for a plant', (m) => {
      m.state.players.plants.energy = 99;
      return place('plants', 'peashooter', 2, 3);
    }],
    ['no-energy', 'one short for a zombie', (m) => {
      m.state.players.zombies.energy = 124;
      return place('zombies', 'skeletonWarrior', 2, 0);
    }],
    ['no-target', 'a merge (not built yet)', () => ({ type: 'merge', faction: 'plants', unit: 'peashooter', targetId: 1 })],
    ['no-target', 'a remove (not built yet)', () => ({ type: 'remove', faction: 'plants', targetId: 1 })],
  ];

  it.each(cases)('%s: %s', (reason, _name, setup) => {
    const m = fresh();
    const cmd = setup(m);
    const energy = { plants: m.state.players.plants.energy, zombies: m.state.players.zombies.energy };
    const units = m.state.units.length;

    expect(m.check(cmd)).toBe(reason);
    const events = m.step([cmd]);

    expect(eventsOf(events, 'commandRejected')).toEqual([{ type: 'commandRejected', command: cmd, reason }]);
    expect(eventsOf(events, 'unitSpawned')).toEqual([]);
    expect(m.state.units).toHaveLength(units);
    expect(m.state.players.plants.energy).toBe(energy.plants);
    expect(m.state.players.zombies.energy).toBe(energy.zombies);
  });

  it('does not charge a card or start a recharge when it rejects', () => {
    const m = fresh();
    m.step([place('plants', 'peashooter', 9, 3)]);
    expect(m.state.players.plants.recharge).toEqual({});
  });

  it('checks the rules in the documented order', () => {
    const m = fresh();
    m.state.players.plants.energy = 0;
    // Wrong side beats everything after it.
    expect(m.check(place('plants', 'brainEater', 9, 99))).toBe('wrong-side');
    // Not in hand beats a bad lane.
    expect(m.check(place('plants', 'potatoMine', 9, 99))).toBe('not-in-hand');
    // Bad lane beats a bad column; bad column beats no energy.
    expect(m.check(place('plants', 'peashooter', 9, 99))).toBe('bad-lane');
    expect(m.check(place('plants', 'peashooter', 2, 99))).toBe('bad-column');
    expect(m.check(place('plants', 'peashooter', 2, 3))).toBe('no-energy');
    // Match over beats all of them.
    m.state.winner = 'plants';
    expect(m.check(place('plants', 'brainEater', 9, 99))).toBe('match-over');
  });

  it('is not fooled by a zombie standing on the column when checking occupied', () => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'brainEater', 2, 3.5);
    expect(m.check(place('plants', 'peashooter', 2, 3))).toBeNull();
    // ...but a plant on a different lane or column does not block it either.
    spawnUnit(m.state, BALANCE, 'sunflower', 1, 3.5);
    spawnUnit(m.state, BALANCE, 'sunflower', 2, 4.5);
    expect(m.check(place('plants', 'peashooter', 2, 3))).toBeNull();
  });
});
