import { describe, expect, it } from 'vitest';
import { cloneBalance, seconds } from '../../src/data/balance';
import type { Balance, ShotStats, UnitStats } from '../../src/data/balance';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { nextRandom } from '../../src/sim/rng';
import type { Projectile, SimEvent, Unit } from '../../src/sim/types';
import { classicBalance, eventsOf, remove } from './helpers';

/**
 * Lobbed and piercing flights, shot statuses, holding zombies and the zombies' base-shot range
 * (phase 2, Task 1). The new units' real numbers arrive in Tasks 2 and 3, so every row here is
 * synthetic: the classic table (see `classicBalance`) plus the rows a test sets.
 */

/** A Kernel-pult row that lobs `shot` (merged over a plain 12-damage lob, range 10, speed 6). */
function lobber(shot: Partial<ShotStats> = {}): UnitStats {
  return {
    recharge: 5, hp: 300, armor: 0, speed: 0,
    shot: { kind: 'kernel', damage: 12, interval: 1, range: 10, speed: 6, flight: 'lobbed', ...shot },
  };
}

/** A zombie that stands still and does nothing, unless a test gives it more. */
function dummy(extra: Partial<UnitStats> = {}): UnitStats {
  return { recharge: 5, hp: 500, armor: 0, speed: 0, ...extra };
}

function table(rows: Balance['units']): Balance {
  const b = cloneBalance(classicBalance());
  b.units = { ...b.units, ...rows };
  return b;
}

function fresh(balance: Balance, seed = 1): Match {
  const config = defaultConfig(seed, balance);
  config.startEnergy = { plants: 1000, zombies: 1000 };
  config.baseHp = { plants: 3000, zombies: 3000 };
  config.incomeMultiplier = { plants: 0, zombies: 0 };
  config.spells = { plants: 0, zombies: 0 }; // phase 2: no deal, so the shots are the only thing drawing the rng
  return new Match(config, balance);
}

function stepUntil(m: Match, done: (events: SimEvent[]) => boolean, limit = 1000): SimEvent[] {
  for (let n = 0; n < limit; n++) {
    const events = m.step();
    if (done(events)) return events;
  }
  throw new Error(`still waiting after ${limit} steps`);
}

const hit = (events: SimEvent[]): boolean => eventsOf(events, 'projectileHit').length > 0;

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

describe('a lobbed shot', () => {
  it('is aimed at the nearest enemy ahead in range, follows it while it walks, and lands on it', () => {
    const b = table({ kernelPult: lobber({ interval: 10 }), brainEater: dummy({ speed: 0.9 }), veryFastWalker: dummy() });
    const m = fresh(b);
    const pult = spawnUnit(m.state, b, 'kernelPult', 2, 0.5);
    const near = spawnUnit(m.state, b, 'brainEater', 2, 8);
    spawnUnit(m.state, b, 'veryFastWalker', 2, 9); // further: not the target
    pult.shotTimer = 0;

    const fired = m.step();
    const spawned = only(eventsOf(fired, 'projectileSpawned'));
    // Movement runs before attacks: it is aimed at where the walker stands after this step's walk.
    expect(near.x).toBeLessThan(8);
    expect(spawned).toMatchObject({ flight: 'lobbed', targetX: near.x, kind: 'kernel' });
    const p = only(m.state.projectiles);
    expect(p).toMatchObject({ flight: 'lobbed', targetId: near.id, targetX: near.x, sourceKey: 'kernelPult', level: 1 });

    let landing: SimEvent[] = [];
    for (let i = 0; i < 100; i++) {
      landing = m.step();
      if (hit(landing)) break;
      expect(p.targetX).toBe(near.x); // follows the walker every tick
      expect(p.x).toBeLessThan(near.x);
    }
    expect(only(eventsOf(landing, 'projectileHit'))).toEqual({
      type: 'projectileHit', projectileId: p.id, lane: 2, x: near.x, targetId: near.id,
      targetBase: null, blocked: false, burning: false,
    });
    expect(eventsOf(landing, 'unitDamaged')).toEqual([{ type: 'unitDamaged', unitId: near.id, amount: 12, hp: 488 }]);
    expect(m.state.projectiles).toEqual([]);
  });

  it('splashes every other enemy in the lane within splash of where it lands, and nobody else', () => {
    const b = table({ mangoPult: { ...lobber({ kind: 'mango', damage: 45, splash: 0.75 }) }, brainEater: dummy() });
    const m = fresh(b);
    const pult = spawnUnit(m.state, b, 'mangoPult', 1, 0.5);
    const target = spawnUnit(m.state, b, 'brainEater', 1, 5);
    const behind = spawnUnit(m.state, b, 'brainEater', 1, 5.75);
    const before = spawnUnit(m.state, b, 'brainEater', 1, 4.5); // the nearest: it becomes the target
    const out = spawnUnit(m.state, b, 'brainEater', 1, 4.5 + 0.8);
    const otherLane = spawnUnit(m.state, b, 'brainEater', 2, 4.5);
    pult.shotTimer = 0;

    const landing = stepUntil(m, hit);

    expect(only(eventsOf(landing, 'projectileHit'))).toMatchObject({ targetId: before.id, x: 4.5 });
    const damaged = eventsOf(landing, 'unitDamaged').map((e) => [e.unitId, e.amount]);
    expect(damaged).toEqual([[before.id, 45], [target.id, 45]]); // the target first, then the splash in id order
    for (const u of [behind, out, otherLane]) expect(u.hp).toBe(500);
  });

  it('when its target falls in flight, lands where the target stood and hits an enemy within hitRadius of it', () => {
    const b = table({ kernelPult: lobber(), brainEater: dummy() });
    const m = fresh(b);
    const pult = spawnUnit(m.state, b, 'kernelPult', 0, 0.5);
    const target = spawnUnit(m.state, b, 'brainEater', 0, 6);
    const close = spawnUnit(m.state, b, 'brainEater', 0, 6 + 0.3); // within hitRadius 0.35
    pult.shotTimer = 0;
    m.step();
    m.step();
    target.hp = 0; // falls; it is removed at the end of the next step
    m.step();
    expect(m.state.units).not.toContain(target);

    const landing = stepUntil(m, hit);

    expect(only(eventsOf(landing, 'projectileHit'))).toMatchObject({ x: 6, targetId: close.id });
    expect(close.hp).toBe(488);
  });

  it('with its target gone and no enemy within hitRadius, lands on nobody', () => {
    const b = table({ kernelPult: lobber(), brainEater: dummy() });
    const m = fresh(b);
    const pult = spawnUnit(m.state, b, 'kernelPult', 0, 0.5);
    const target = spawnUnit(m.state, b, 'brainEater', 0, 6);
    const far = spawnUnit(m.state, b, 'brainEater', 0, 6.4); // just past hitRadius
    pult.shotTimer = 0;
    m.step();
    target.hp = 0;

    const landing = stepUntil(m, hit);

    expect(only(eventsOf(landing, 'projectileHit'))).toMatchObject({ x: 6, targetId: null, targetBase: null });
    expect(eventsOf(landing, 'unitDamaged')).toEqual([]);
    expect(far.hp).toBe(500);
    expect(m.state.projectiles).toEqual([]);
  });

  it('ignores a ready shield, even as a pea', () => {
    const b = table({ peashooter: lobber({ kind: 'pea', damage: 20 }) });
    const m = fresh(b);
    const pult = spawnUnit(m.state, b, 'peashooter', 3, 0.5);
    const skeleton = spawnUnit(m.state, b, 'skeletonWarrior', 3, 7);
    pult.shotTimer = 0;
    expect(skeleton.abilityTimer).toBe(0); // shield ready

    const landing = stepUntil(m, hit);

    expect(only(eventsOf(landing, 'projectileHit'))).toMatchObject({ targetId: skeleton.id, blocked: false });
    expect(skeleton.hp).toBe(700 - 20);
    expect(skeleton.abilityTimer).toBeLessThanOrEqual(0); // the shield was not used
  });

  it("with no target, a plant's lobbed shot flies on to the zombie base like a pea", () => {
    const b = table({ kernelPult: lobber() });
    const m = fresh(b);
    const pult = spawnUnit(m.state, b, 'kernelPult', 4, 0.5);
    pult.shotTimer = 0;

    const fired = m.step();
    expect(only(eventsOf(fired, 'projectileSpawned'))).toMatchObject({ flight: 'lobbed', targetX: null });
    expect(only(m.state.projectiles)).toMatchObject({ targetId: null, targetX: null });
    const landing = stepUntil(m, hit);

    expect(only(eventsOf(landing, 'projectileHit'))).toMatchObject({ targetBase: 'zombies', x: 10 });
    expect(only(eventsOf(landing, 'baseDamaged'))).toMatchObject({ faction: 'zombies', amount: 12 * 0.5 });
  });

  it('fired with no target, it comes down where the enemy it meets stands, and its x says so', () => {
    const b = table({ kernelPult: lobber({ interval: 10 }), brainEater: dummy() });
    const m = fresh(b);
    const pult = spawnUnit(m.state, b, 'kernelPult', 3, 0.5);
    pult.shotTimer = 0;
    m.step();
    const p = only(m.state.projectiles);
    expect(p.targetId).toBeNull();
    const z = spawnUnit(m.state, b, 'brainEater', 3, 4.1); // appears after the shot was fired

    const landing = stepUntil(m, hit);

    expect(only(eventsOf(landing, 'projectileHit'))).toMatchObject({ targetId: z.id, x: 4.1 });
    expect(p.x).toBe(4.1);
  });
});

describe('a piercing shot', () => {
  /** A Trident Zombie that stands at x 6 and throws a 70-damage trident through 3 units. */
  function tridentTable(): Balance {
    return table({
      tridentZombie: dummy({
        shot: { kind: 'trident', damage: 70, interval: 3.5, range: 10, speed: 6, flight: 'piercing', pierce: 3 },
      }),
    });
  }

  it('damages each of the first three plants it meets once, not the fourth, then vanishes', () => {
    const b = tridentTable();
    const m = fresh(b);
    const plants = [4.5, 3.5, 2.5, 1.5].map((x) => spawnUnit(m.state, b, 'walnutBomb', 2, x));
    const z = spawnUnit(m.state, b, 'tridentZombie', 2, 6);
    z.shotTimer = 0;

    const events: SimEvent[] = [];
    for (let i = 0; i < 60; i++) events.push(...m.step());

    expect(only(eventsOf(events, 'projectileSpawned'))).toMatchObject({ flight: 'piercing', kind: 'trident' });
    expect(eventsOf(events, 'projectileHit').map((e) => e.targetId)).toEqual(plants.slice(0, 3).map((u) => u.id));
    expect(eventsOf(events, 'unitDamaged').map((e) => [e.unitId, e.amount])).toEqual(
      plants.slice(0, 3).map((u) => [u.id, 70]),
    );
    expect(plants.map((u) => u.hp)).toEqual([1130, 1130, 1130, 1200]);
    expect(m.state.projectiles).toEqual([]);
    expect(eventsOf(events, 'baseDamaged')).toEqual([]);
  });

  it('never hits a unit in its hitIds twice', () => {
    const b = tridentTable();
    const m = fresh(b);
    const already = spawnUnit(m.state, b, 'walnutBomb', 1, 5.5);
    const next = spawnUnit(m.state, b, 'walnutBomb', 1, 5.6);
    const p: Projectile = {
      id: m.state.nextId, kind: 'trident', faction: 'zombies', lane: 1, x: 5.8, speed: 0.2, damage: 70,
      ownerId: 0, spawnTick: m.state.tick - 1, flight: 'piercing', sourceKey: 'tridentZombie', level: 1,
      targetId: null, targetX: null, pierceLeft: 2, hitIds: [already.id], burning: false, burnDps: 0, burnTicks: 0,
    };
    m.state.nextId += 1;
    m.state.projectiles.push(p);

    const events = m.step();

    expect(eventsOf(events, 'projectileHit').map((e) => e.targetId)).toEqual([next.id]);
    expect([already.hp, next.hp]).toEqual([1200, 1130]);
    expect(p).toMatchObject({ pierceLeft: 1, hitIds: [already.id, next.id] });
  });

  it('with hits left at the far edge, hits the base', () => {
    const b = tridentTable();
    const m = fresh(b);
    const z = spawnUnit(m.state, b, 'tridentZombie', 0, 3);
    z.shotTimer = 0;

    const events = stepUntil(m, hit);

    expect(only(eventsOf(events, 'projectileHit'))).toMatchObject({ targetBase: 'plants' });
    expect(only(eventsOf(events, 'baseDamaged'))).toMatchObject({ faction: 'plants', amount: 70 });
  });
});

describe('a shot status with a chance', () => {
  /** Kernel-pult as phase 2 plans it: kernels, and 30% butter that stuns for 2 s. */
  const butterPult = (): Balance => table({
    kernelPult: lobber({ status: { kind: 'stun', seconds: 2, chance: 0.3, altKind: 'butter' } }),
    brainEater: dummy({ hp: 100_000 }),
  });

  it('is rolled on the state rng once per shot at firing; a success is fired as the altKind', () => {
    const b = butterPult();
    const seed = 1234;
    const m = fresh(b, seed);
    spawnUnit(m.state, b, 'kernelPult', 2, 0.5);
    spawnUnit(m.state, b, 'brainEater', 2, 9);

    const kinds: string[] = [];
    for (let i = 0; i < 30 * 200; i++) for (const e of eventsOf(m.step(), 'projectileSpawned')) kinds.push(e.kind);

    const own = { rng: seed >>> 0 };
    expect(kinds.length).toBeGreaterThan(150);
    expect(kinds).toEqual(kinds.map(() => (nextRandom(own) < 0.3 ? 'butter' : 'kernel')));
    expect(m.state.rng).toBe(own.rng); // nothing else drew from it
    const butter = kinds.filter((k) => k === 'butter').length;
    expect(butter).toBeGreaterThan(0);
    expect(butter).toBeLessThan(kinds.length);
  });

  it('butter stuns whoever it hits for seconds(2); a kernel does not', () => {
    const b = butterPult();
    const m = fresh(b);
    const pult = spawnUnit(m.state, b, 'kernelPult', 2, 0.5);
    const z = spawnUnit(m.state, b, 'brainEater', 2, 9);

    const kindOf = new Map<number, string>();
    const checked = new Set<string>();
    for (let i = 0; i < 30 * 60 && checked.size < 2; i++) {
      const events = m.step();
      for (const e of eventsOf(events, 'projectileSpawned')) kindOf.set(e.projectileId, e.kind);
      for (const h of eventsOf(events, 'projectileHit')) {
        const kind = kindOf.get(h.projectileId) ?? '';
        if (checked.has(kind)) continue;
        const applied = eventsOf(events, 'statusApplied');
        if (kind === 'butter') {
          expect(applied).toEqual([{ type: 'statusApplied', unitId: z.id, status: 'stun', ticks: seconds(2), sourceId: pult.id }]);
          expect(z.stun).toBe(seconds(2) - 1); // statuses count down once at the end of the step
          checked.add(kind);
        } else if (kind === 'kernel' && z.stun === 0) {
          expect(applied).toEqual([]);
          expect(z.stun).toBe(0);
          checked.add(kind);
        }
      }
    }
    expect([...checked].sort()).toEqual(['butter', 'kernel']);
  });
});

describe('a zombie that holds', () => {
  it('stops with a standing plant within its shot range ahead, is not blocked, keeps shooting, and walks on when the plant goes', () => {
    const b = table({
      skeletonArcher: {
        recharge: 6, hp: 220, armor: 0, speed: 0.4, holds: true,
        melee: { damage: 15, interval: 1, reach: 0.6 },
        shot: { kind: 'arrow', damage: 28, interval: 1.6, range: 6, speed: 8 },
      },
    });
    const m = fresh(b);
    const plant = spawnUnit(m.state, b, 'walnutBomb', 3, 1.5);
    const archer = spawnUnit(m.state, b, 'skeletonArcher', 3, 9.5);

    const events: SimEvent[] = [];
    for (let i = 0; i < 400; i++) events.push(...m.step());

    expect(archer.x - plant.x).toBeLessThanOrEqual(6);
    expect(archer.x - plant.x).toBeGreaterThan(6 - 0.4 / 30 - 1e-9); // stopped on the first tick in range
    expect(archer.blocked).toBe(false);
    expect(eventsOf(events, 'unitAttacked').filter((e) => e.unitId === archer.id && e.attack === 'shot').length).toBeGreaterThan(5);
    expect(plant.hp).toBeLessThan(1200);

    const heldAt = archer.x;
    m.step([remove('plants', plant.id)]);
    m.step();
    expect(archer.x).toBeLessThan(heldAt);
  });

  it('uses holdRange when it has one, instead of its shot range', () => {
    const b = table({
      necromancer: {
        recharge: 15, hp: 400, armor: 0, speed: 0.3, holds: true, holdRange: 4,
        shot: { kind: 'brain', damage: 1, interval: 10, range: 6, speed: 4 }, // a longer range it does not hold at
      },
    });
    const m = fresh(b);
    const plant = spawnUnit(m.state, b, 'walnutBomb', 0, 0.5);
    const necro = spawnUnit(m.state, b, 'necromancer', 0, 9.5);

    for (let i = 0; i < 1000; i++) m.step();

    expect(necro.x - plant.x).toBeLessThanOrEqual(4);
    expect(necro.x - plant.x).toBeGreaterThan(4 - 0.3 / 30 - 1e-9);
    expect(necro.blocked).toBe(false);
  });
});

describe("a zombie's shot at the plant base", () => {
  /** A zombie with a long shot, standing still at `x`. */
  function sniperAt(x: number, range: number, baseRange = 3.5): { m: Match; z: Unit } {
    const b = table({
      skeletonArcher: dummy({ shot: { kind: 'arrow', damage: 28, interval: 1, range, speed: 8 } }),
    });
    b.zombieBaseShotRange = baseRange;
    const m = fresh(b);
    const z = spawnUnit(m.state, b, 'skeletonArcher', 2, x);
    z.shotTimer = 0;
    return { m, z };
  }

  it.each([
    [3.5, 6, 3.5, true],
    [3.6, 6, 3.5, false], // in its range of 6, but past zombieBaseShotRange
    [5, 6, 5, true],
    [4.1, 4, 5, false], // within zombieBaseShotRange, but past its own range
    [4, 4, 5, true],
  ])('at x %s with range %s and zombieBaseShotRange %s, it shoots the base: %s', (x, range, baseRange, shoots) => {
    const { m, z } = sniperAt(x, range, baseRange);
    const events = m.step();
    const shots = eventsOf(events, 'unitAttacked').filter((e) => e.unitId === z.id);
    expect(shots).toEqual(shoots ? [expect.objectContaining({ attack: 'shot', targetBase: 'plants' })] : []);
  });

  it('ships zombieBaseShotRange 3.5, the classic table keeps it', () => {
    expect(classicBalance().zombieBaseShotRange).toBe(3.5);
  });
});
