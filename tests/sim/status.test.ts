import { describe, expect, it } from 'vitest';
import { cloneBalance, seconds } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { applyStatus, canAct } from '../../src/sim/status';
import type { SimEvent, StatusKind, Unit } from '../../src/sim/types';
import { classicBalance, eventsOf } from './helpers';

/**
 * The ability model's statuses (phase 2, Task 1), on the classic numbers (see `classicBalance`)
 * plus whatever synthetic rows a test adds. Income is off so energy only moves through bounties
 * and Sun.
 */
function fresh(balance: Balance = classicBalance()): Match {
  const config = defaultConfig(1, balance);
  config.startEnergy = { plants: 1000, zombies: 1000 };
  config.baseHp = { plants: 3000, zombies: 3000 };
  config.incomeMultiplier = { plants: 0, zombies: 0 };
  return new Match(config, balance);
}

function steps(m: Match, n: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...m.step());
  return all;
}

describe('applyStatus', () => {
  it('keeps the longer duration and the larger dps, and reports only a start or a lengthening', () => {
    const m = fresh();
    const z = spawnUnit(m.state, m.balance, 'brainEater', 2, 6);
    const events: SimEvent[] = [];

    applyStatus(m.state, z, 'poison', 60, 5, 7, events);
    expect([z.poison, z.poisonDps]).toEqual([60, 5]);
    expect(events).toEqual([{ type: 'statusApplied', unitId: z.id, status: 'poison', ticks: 60, sourceId: 7 }]);

    events.length = 0;
    applyStatus(m.state, z, 'poison', 30, 8, 7, events); // shorter but stronger
    expect([z.poison, z.poisonDps]).toEqual([60, 8]);
    expect(events).toEqual([]);

    applyStatus(m.state, z, 'poison', 60, 8, null, events); // the same again
    expect(events).toEqual([]);

    applyStatus(m.state, z, 'poison', 90, 2, null, events); // longer but weaker
    expect([z.poison, z.poisonDps]).toEqual([90, 8]);
    expect(events).toEqual([{ type: 'statusApplied', unitId: z.id, status: 'poison', ticks: 90, sourceId: null }]);

    events.length = 0;
    applyStatus(m.state, z, 'stun', 45, 0, null, events);
    applyStatus(m.state, z, 'stun', 20, 0, null, events);
    expect(z.stun).toBe(45);
    expect(eventsOf(events, 'statusApplied').map((e) => [e.status, e.ticks])).toEqual([['stun', 45]]);
  });

  it('with quietRefresh reports the start only, and still lengthens and strengthens', () => {
    const m = fresh();
    const z = spawnUnit(m.state, m.balance, 'brainEater', 2, 6);
    const events: SimEvent[] = [];
    applyStatus(m.state, z, 'poison', 30, 5, null, events, true);
    expect(events).toEqual([{ type: 'statusApplied', unitId: z.id, status: 'poison', ticks: 30, sourceId: null }]);
    events.length = 0;
    z.poison = 10;
    applyStatus(m.state, z, 'poison', 30, 9, null, events, true);
    expect([z.poison, z.poisonDps]).toEqual([30, 9]);
    expect(events).toEqual([]);
  });
});

describe('a unit that cannot act', () => {
  it.each(['stun', 'tied'] as const)('%s: does not walk, bite, shoot or pay Sun, and its timers stand still until it ends', (kind) => {
    const m = fresh();
    const shooter = spawnUnit(m.state, m.balance, 'peashooter', 0, 0.5);
    const sun = spawnUnit(m.state, m.balance, 'sunflower', 1, 0.5);
    const walker = spawnUnit(m.state, m.balance, 'brainEater', 2, 9);
    const wall = spawnUnit(m.state, m.balance, 'walnutBomb', 3, 4.5);
    const biter = spawnUnit(m.state, m.balance, 'veryFastWalker', 3, 5);
    const skeleton = spawnUnit(m.state, m.balance, 'skeletonWarrior', 4, 9);
    m.step(); // the biter halts at the wall
    expect(biter.blocked).toBe(true);
    // Everything ready the moment the status ends (the walker's brain and the shield part way).
    shooter.shotTimer = 0;
    sun.abilityTimer = 0;
    biter.meleeTimer = 0;
    walker.shotTimer = 5;
    skeleton.abilityTimer = 50; // its shield recharging
    const units = [shooter, sun, walker, biter, skeleton];
    const ticks = 60;
    const applied: SimEvent[] = [];
    for (const u of units) applyStatus(m.state, u, kind, ticks, 0, null, applied);
    for (const u of units) expect(canAct(u)).toBe(false);
    const timers = (u: Unit): number[] => [u.meleeTimer, u.shotTimer, u.abilityTimer];
    const before = units.map(timers);
    const walkerX = walker.x;
    const skeletonX = skeleton.x;
    const energy = m.state.players.plants.energy;
    const wallHp = wall.hp;

    const held = steps(m, ticks);

    expect(eventsOf(held, 'unitAttacked')).toEqual([]);
    expect(eventsOf(held, 'projectileSpawned')).toEqual([]);
    expect(eventsOf(held, 'energyGained')).toEqual([]);
    expect(eventsOf(held, 'attackMissed')).toEqual([]);
    expect(wall.hp).toBe(wallHp);
    expect(m.state.players.plants.energy).toBe(energy);
    expect([walker.x, skeleton.x]).toEqual([walkerX, skeletonX]);
    expect(units.map(timers)).toEqual(before);
    expect(eventsOf(held, 'statusEnded')).toEqual(units.map((u) => ({ type: 'statusEnded', unitId: u.id, status: kind })));
    for (const u of units) expect(canAct(u)).toBe(true);

    const free = m.step();
    expect(eventsOf(free, 'projectileSpawned').map((e) => e.ownerId)).toEqual([shooter.id]);
    expect(eventsOf(free, 'energyGained').map((e) => e.unitId)).toEqual([sun.id]);
    expect(eventsOf(free, 'unitAttacked').filter((e) => e.attack === 'melee').map((e) => e.unitId)).toEqual([biter.id]);
    expect(walker.x).toBeLessThan(walkerX);
    expect(walker.shotTimer).toBe(4);
    expect(skeleton.abilityTimer).toBe(49);
  });

  it('is only stunned or tied: blind, poison and burn leave it free to act', () => {
    const m = fresh();
    const z = spawnUnit(m.state, m.balance, 'brainEater', 2, 6);
    for (const kind of ['blind', 'poison', 'burn'] as const) applyStatus(m.state, z, kind, 30, 1, null, []);
    expect(canAct(z)).toBe(true);
  });
});

describe('blindness', () => {
  it('a blind Peashooter shoots on schedule, but every shot is an attackMissed with no projectile', () => {
    const m = fresh();
    const shooter = spawnUnit(m.state, m.balance, 'peashooter', 2, 0.5);
    const z = spawnUnit(m.state, m.balance, 'skeletonWarrior', 2, 9);
    shooter.shotTimer = 0;
    applyStatus(m.state, shooter, 'blind', 100, 0, z.id, []);

    const events = steps(m, 99);

    // Ready at once, then every 45 ticks: on the 1st, 46th and 91st steps.
    expect(eventsOf(events, 'attackMissed')).toEqual(Array(3).fill({ type: 'attackMissed', unitId: shooter.id }));
    expect(eventsOf(events, 'projectileSpawned')).toEqual([]);
    expect(eventsOf(events, 'unitAttacked')).toEqual([]);
    expect(m.state.projectiles).toEqual([]);
    expect(z.hp).toBe(700);
    expect(shooter.shotTimer).toBe(seconds(1.5) - 8); // reset on step 91, counted down on 92..99
  });

  it('a blind zombie bites on schedule, but each bite misses and the plant keeps its health', () => {
    const m = fresh();
    const wall = spawnUnit(m.state, m.balance, 'walnutBomb', 1, 4.5);
    const z = spawnUnit(m.state, m.balance, 'veryFastWalker', 1, 5);
    m.step();
    expect(z.blocked).toBe(true);
    z.meleeTimer = 0;
    applyStatus(m.state, z, 'blind', 60, 0, null, []);

    const events = steps(m, 30);

    expect(eventsOf(events, 'attackMissed')).toEqual([
      { type: 'attackMissed', unitId: z.id }, { type: 'attackMissed', unitId: z.id },
    ]); // ready at once, then 21 ticks later (steps 1 and 22)
    expect(eventsOf(events, 'unitAttacked')).toEqual([]);
    expect(wall.hp).toBe(1200);
    expect(z.meleeTimer).toBe(seconds(0.7) - 8); // reset on step 22, counted down on 23..30
  });
});

describe('poison and burn', () => {
  /** The classic table with an armored Brain Eater, so a test can see armor play no part. */
  function armored(): Balance {
    const b = cloneBalance(classicBalance());
    b.units.brainEater = { ...b.units.brainEater!, armor: 5, speed: 0 };
    delete b.units.brainEater.shot;
    return b;
  }

  it.each(['poison', 'burn'] as const)('%s deals its dps once every 30 ticks, whole seconds, armor or not', (kind: StatusKind) => {
    const m = fresh(armored());
    const z = spawnUnit(m.state, m.balance, 'brainEater', 2, 6);
    m.step(); // tick 0 done: the next whole second is tick 30
    applyStatus(m.state, z, kind, 90, 7, null, []);

    const damage: Array<[number, number]> = [];
    let ended: number | null = null;
    for (let i = 0; i < 120; i++) {
      const tick = m.state.tick;
      const events = m.step();
      for (const e of eventsOf(events, 'unitDamaged')) damage.push([tick, e.amount]);
      if (eventsOf(events, 'statusEnded').some((e) => e.unitId === z.id && e.status === kind)) ended = tick;
    }

    // Three seconds of it: ticks 30, 60 and 90, 7 each, the armor of 5 taking nothing off.
    expect(damage).toEqual([[30, 7], [60, 7], [90, 7]]);
    expect(z.hp).toBe(400 - 21);
    expect(ended).toBe(90);
    expect(z[kind]).toBe(0);
    expect(kind === 'poison' ? z.poisonDps : z.burnDps).toBe(0);
  });

  it('a unit poison kills dies with cause damage and pays its bounty', () => {
    const m = fresh();
    const z = spawnUnit(m.state, m.balance, 'brainEater', 2, 9.5);
    z.hp = 10;
    applyStatus(m.state, z, 'poison', 60, 20, null, []);

    const events = m.step(); // tick 0 is a whole second

    expect(eventsOf(events, 'unitDamaged')).toEqual([{ type: 'unitDamaged', unitId: z.id, amount: 20, hp: -10 }]);
    expect(eventsOf(events, 'unitDied')).toEqual([expect.objectContaining({ unitId: z.id, cause: 'damage' })]);
    expect(eventsOf(events, 'energyGained')).toEqual([
      expect.objectContaining({ faction: 'plants', source: 'bounty', amount: 20 }), // 20% of 100
    ]);
    expect(m.state.units).toEqual([]);
  });

  it('a burning plant dies the same way, and the zombies get the bounty', () => {
    const m = fresh();
    const p = spawnUnit(m.state, m.balance, 'sunflower', 0, 0.5);
    p.hp = 5;
    applyStatus(m.state, p, 'burn', 30, 10, null, []);

    const events = m.step();

    expect(eventsOf(events, 'unitDied')).toEqual([expect.objectContaining({ unitId: p.id, cause: 'damage' })]);
    expect(eventsOf(events, 'energyGained')).toEqual([
      expect.objectContaining({ faction: 'zombies', source: 'bounty', amount: 25 }), // 50% of 50
    ]);
  });
});
