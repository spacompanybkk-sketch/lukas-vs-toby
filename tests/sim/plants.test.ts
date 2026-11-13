import { describe, expect, it } from 'vitest';
import { BALANCE, cloneBalance, seconds } from '../../src/data/balance';
import type { Balance, UnitStats } from '../../src/data/balance';
import { isArmed } from '../../src/sim/abilities';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { PlantKey, SimEvent, Unit } from '../../src/sim/types';
import { classicBalance, eventsOf, merge, place } from './helpers';

/**
 * The seven phase-2 plants (phase 2, Task 2), with their starting numbers from `BALANCE` on top
 * of the classic table (see `classicBalance`), so the zombies they meet keep the numbers the rules
 * tests were written for. Every level curve there is linear. Income is off, so energy only moves
 * through bounties.
 */

const NEW_PLANTS: readonly PlantKey[] = [
  'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber', 'pumpkinSquash',
];

/** A zombie that stands still and does nothing: 1000 hp, speed 0, no attack. */
const DUMMY: UnitStats = { recharge: 5, hp: 1000, armor: 0, speed: 0 };

function table(): Balance {
  const b = classicBalance();
  const shipped = cloneBalance(BALANCE);
  for (const key of NEW_PLANTS) b.units[key] = b.units[key] ?? shipped.units[key]; // retuned rows: as first set (classicBalance)
  b.units.desertZombie = { ...DUMMY };
  return b;
}

function fresh(b: Balance = table(), seed = 1): Match {
  const config = defaultConfig(seed, b);
  config.startEnergy = { plants: 2000, zombies: 2000 };
  config.baseHp = { plants: 1_000_000, zombies: 1_000_000 };
  config.incomeMultiplier = { plants: 0, zombies: 0 };
  config.suddenDeath = false;
  config.cards.plants = [...config.cards.plants, ...NEW_PLANTS];
  return new Match(config, b);
}

function steps(m: Match, n: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...m.step());
  return all;
}

function stepUntil(m: Match, done: (events: SimEvent[]) => boolean, limit = 2000): SimEvent[] {
  for (let n = 0; n < limit; n++) {
    const events = m.step();
    if (done(events)) return events;
  }
  throw new Error(`still waiting after ${limit} steps`);
}

const abilities = (events: readonly SimEvent[], ability?: string) =>
  eventsOf(events, 'abilityUsed').filter((e) => ability === undefined || e.ability === ability);

const dummy = (m: Match, lane: number, x: number): Unit => spawnUnit(m.state, m.balance, 'desertZombie', lane, x);

describe('the shipped starting numbers', () => {
  it('are the table of the phase-2 plan', () => {
    const u = BALANCE.units;
    expect(u.potatoMine).toEqual({
      recharge: 20, hp: 150, armor: 0, speed: 0, mine: { armSeconds: 12, reach: 0.6, damage: 450, radius: 0.75 },
    });
    expect(u.kernelPult).toEqual({
      recharge: 5, hp: 300, armor: 0, speed: 0,
      shot: {
        kind: 'kernel', damage: 13, interval: 1, range: 10, // Task 8: 12 -> 13 (merge value)
        speed: 7, flight: 'lobbed',
        status: { kind: 'stun', seconds: 2, chance: 0.3, altKind: 'butter' },
      },
    });
    expect(u.mangoPult).toEqual({
      recharge: 7, hp: 300, armor: 0, speed: 0,
      shot: { kind: 'mango', damage: 45, interval: 3, range: 10, speed: 5, flight: 'lobbed', splash: 0.75 },
    });
    expect(u.avocadoBunker).toEqual({ recharge: 20, hp: 2000, armor: 8, speed: 0 });
    expect(u.torchwood).toEqual({
      recharge: 10, hp: 500, armor: 0, speed: 0, ignite: { factor: 2, burnDps: 10, burnSeconds: 3 },
    });
    expect(u.cherryBomber).toEqual({
      recharge: 30, hp: 300, armor: 0, speed: 0, fuse: { seconds: 1, damage: 600, radius: 1.6 },
    });
    expect(u.pumpkinSquash).toEqual({
      // Task 8: recharge 20 -> 15 (pick share), leap range 2 -> 3 (merge value)
      recharge: 15, hp: 900, armor: 0, speed: 0, leap: { range: 3, damage: 350, radius: 0.5, recoverSeconds: 6 },
    });
  });
});

describe('Potato Mine', () => {
  it('arms 12 s after it is planted, then goes off under the first zombie within 0.6 ahead: 450 within 0.75, and is spent', () => {
    const m = fresh();
    const mine = spawnUnit(m.state, m.balance, 'potatoMine', 2, 3.5);
    expect(mine.abilityTimer).toBe(seconds(12));
    expect(abilities(steps(m, seconds(12) - 1))).toEqual([]);
    const armed = m.step();
    expect(abilities(armed)).toEqual([
      { type: 'abilityUsed', unitId: mine.id, ability: 'arm', lane: 2, x: 3.5, targetId: null },
    ]);
    expect(abilities(steps(m, 30))).toEqual([]); // nobody near: it waits, armed, and arms only once

    const trigger = dummy(m, 2, 4.0); // 0.5 ahead
    const close = dummy(m, 2, 4.2); // 0.7 from the mine
    const behind = dummy(m, 2, 3.0); // 0.5 behind it, still within the blast
    const far = dummy(m, 2, 4.3); // 0.8: out
    const nextLane = dummy(m, 3, 3.5); // one lane over: 1 away
    const zombieEnergy = m.state.players.zombies.energy;

    const boom = m.step();

    expect(abilities(boom)).toEqual([
      { type: 'abilityUsed', unitId: mine.id, ability: 'trigger', lane: 2, x: 3.5, targetId: trigger.id },
    ]);
    expect(eventsOf(boom, 'explosion')).toEqual([
      { type: 'explosion', lane: 2, x: 3.5, radius: 0.75, sourceKey: 'potatoMine' },
    ]);
    expect(eventsOf(boom, 'unitDamaged').map((e) => [e.unitId, e.amount])).toEqual(
      [trigger, close, behind].sort((a, c) => a.id - c.id).map((u) => [u.id, 450]),
    );
    for (const u of [far, nextLane]) expect(u.hp).toBe(1000);
    expect(eventsOf(boom, 'unitDied')).toEqual([{
      type: 'unitDied', unitId: mine.id, key: 'potatoMine', faction: 'plants', lane: 2, x: 3.5, level: 1, cause: 'spent',
    }]);
    expect(m.state.units).not.toContain(mine);
    expect(m.state.players.zombies.energy).toBe(zombieEnergy); // spent: no bounty
    expect(eventsOf(boom, 'energyGained')).toEqual([]);
  });

  it('unarmed, it is an ordinary plant that zombies bite', () => {
    const m = fresh();
    const mine = spawnUnit(m.state, m.balance, 'potatoMine', 1, 3.5);
    spawnUnit(m.state, m.balance, 'brainEater', 1, 3.9); // within its reach of 0.6
    const events = steps(m, 100);
    expect(abilities(events)).toEqual([]);
    expect(eventsOf(events, 'explosion')).toEqual([]);
    expect(mine.hp).toBeLessThan(150);
    expect(mine.hp).toBe(150 - 40 * eventsOf(events, 'unitAttacked').filter((e) => e.targetId === mine.id).length);
  });

  it('armed, it goes off under a lone zombie exactly 0.6 ahead, and not under one 0.7 ahead', () => {
    const m = fresh();
    const mine = spawnUnit(m.state, m.balance, 'potatoMine', 0, 0.4); // 1.0 - 0.4 is exactly 0.6 in floating point
    mine.abilityTimer = 1;
    expect(isArmed(mine)).toBe(false);
    m.step();
    expect(isArmed(mine)).toBe(true);
    const far = dummy(m, 0, 1.1); // 0.7 ahead
    expect(abilities(steps(m, 30))).toEqual([]);
    expect(far.hp).toBe(1000);
    m.state.units = m.state.units.filter((u) => u !== far);
    const near = dummy(m, 0, 1.0); // 0.6 ahead
    expect(abilities(m.step())).toEqual([
      { type: 'abilityUsed', unitId: mine.id, ability: 'trigger', lane: 0, x: 0.4, targetId: near.id },
    ]);
  });

  it.each(['stun', 'tied'] as const)('%s, it does not go off; it does on the first tick it can act again', (kind) => {
    const m = fresh();
    const mine = spawnUnit(m.state, m.balance, 'potatoMine', 0, 2.5);
    mine.abilityTimer = 1;
    expect(abilities(m.step(), 'arm')).toHaveLength(1);
    mine[kind] = 5;
    dummy(m, 0, 2.9);
    for (let i = 0; i < 5; i++) {
      const events = m.step();
      expect(abilities(events)).toEqual([]);
      expect(eventsOf(events, 'explosion')).toEqual([]);
    }
    expect(mine[kind]).toBe(0);
    expect(abilities(m.step(), 'trigger')).toHaveLength(1);
  });
});

describe('Kernel-pult', () => {
  it('lobs butter with about three shots in ten: 1,000 shots on seed 1 give between 270 and 330', () => {
    const m = fresh(table(), 1);
    const pult = spawnUnit(m.state, m.balance, 'kernelPult', 2, 0.5);
    const kinds: string[] = [];
    for (let i = 0; i < 1000; i++) {
      pult.shotTimer = 0;
      for (const e of eventsOf(m.step(), 'projectileSpawned')) kinds.push(e.kind);
    }
    expect(kinds).toHaveLength(1000);
    expect(kinds.every((k) => k === 'kernel' || k === 'butter')).toBe(true);
    const butter = kinds.filter((k) => k === 'butter').length;
    expect(butter).toBeGreaterThanOrEqual(270);
    expect(butter).toBeLessThanOrEqual(330);
  });

  it('butter: the hit sets stun to 60 ticks, and the zombie acts again on tick T+60; a kernel stuns nobody', () => {
    const m = fresh(table(), 1);
    const pult = spawnUnit(m.state, m.balance, 'kernelPult', 2, 0.5);
    const walker = spawnUnit(m.state, m.balance, 'brainEater', 2, 8);
    const kindOf = new Map<number, string>();
    let butterHit = -1;
    let sawKernelHit = false;
    for (let n = 0; n < 3000 && butterHit < 0; n++) {
      if (walker.stun > 0) throw new Error('stunned before a butter hit was seen');
      const tick = m.state.tick;
      const events = m.step();
      for (const e of eventsOf(events, 'projectileSpawned')) kindOf.set(e.projectileId, e.kind);
      for (const hit of eventsOf(events, 'projectileHit')) {
        if (hit.targetId !== walker.id) continue;
        if (kindOf.get(hit.projectileId) === 'kernel') {
          sawKernelHit = true;
          expect(eventsOf(events, 'statusApplied')).toEqual([]);
        } else {
          butterHit = tick;
          expect(eventsOf(events, 'statusApplied')).toEqual([
            { type: 'statusApplied', unitId: walker.id, status: 'stun', ticks: 60, sourceId: pult.id },
          ]);
        }
      }
    }
    expect(sawKernelHit).toBe(true);
    expect(butterHit).toBeGreaterThan(0);
    expect(walker.stun).toBe(59); // set to 60 by the hit on tick T; that tick counts as its first
    // Nothing else may lengthen it: the pult and its shots in flight leave.
    m.state.units = m.state.units.filter((u) => u !== pult);
    m.state.projectiles = [];
    const x = walker.x;
    while (m.state.tick < butterHit + 60) {
      m.step();
      expect(walker.x).toBe(x);
    }
    m.step(); // tick T+60
    expect(walker.x).toBeLessThan(x);
  });
});

describe('Mango-pult', () => {
  it('a mango landing on a zombie damages the two more within 0.75 as well, and not one at 0.8', () => {
    const m = fresh();
    const pult = spawnUnit(m.state, m.balance, 'mangoPult', 1, 0.5);
    const target = dummy(m, 1, 5);
    const a = dummy(m, 1, 5.5);
    const c = dummy(m, 1, 5.75);
    const out = dummy(m, 1, 5.8);
    pult.shotTimer = 0;
    const landing = stepUntil(m, (events) => eventsOf(events, 'projectileHit').length > 0);
    expect(eventsOf(landing, 'projectileHit')).toMatchObject([{ targetId: target.id, x: 5 }]);
    expect(eventsOf(landing, 'unitDamaged').map((e) => [e.unitId, e.amount])).toEqual([
      [target.id, 45], [a.id, 45], [c.id, 45],
    ]);
    expect(out.hp).toBe(1000);
  });
});

describe('Avocado Bunker', () => {
  it('takes 8 off every hit: a 40-damage bite takes 32, a 5-damage hit takes 1', () => {
    const b = table();
    b.units.veryFastWalker = { ...DUMMY, melee: { damage: 5, interval: 1, reach: 0.6 } };
    const m = fresh(b);
    const big = spawnUnit(m.state, b, 'avocadoBunker', 0, 3.5);
    const small = spawnUnit(m.state, b, 'avocadoBunker', 1, 3.5);
    const eater = spawnUnit(m.state, b, 'brainEater', 0, 3.9);
    const nibbler = spawnUnit(m.state, b, 'veryFastWalker', 1, 3.9);
    const events = steps(m, 40);
    const dealt = (attacker: Unit, plant: Unit) => {
      const bites = eventsOf(events, 'unitAttacked').filter((e) => e.unitId === attacker.id).length;
      expect(bites).toBeGreaterThan(0);
      return eventsOf(events, 'unitDamaged').filter((e) => e.unitId === plant.id).map((e) => e.amount);
    };
    expect(dealt(eater, big)).toEqual([32]);
    expect(dealt(nibbler, small)).toEqual([1]);
  });
});

describe('Torchwood', () => {
  /** A Peashooter at x 0.5 and a Torchwood at 2.5 in lane 0, a dummy zombie at 6.5. */
  function scene(level = 1) {
    const m = fresh();
    const shooter = spawnUnit(m.state, m.balance, 'peashooter', 0, 0.5);
    const torch = spawnUnit(m.state, m.balance, 'torchwood', 0, 2.5);
    torch.level = level;
    const z = dummy(m, 0, 6.5);
    shooter.shotTimer = 0;
    return { m, shooter, torch, z };
  }
  const hit = (events: SimEvent[]): boolean => eventsOf(events, 'projectileHit').length > 0;

  it('sets a pea that passes it burning: double damage, and a burn of 10 dps for 90 ticks on whom it hits', () => {
    const { m, shooter, torch, z } = scene();
    const fired = m.step();
    const pea = m.state.projectiles[0];
    expect(eventsOf(fired, 'projectileSpawned')).toHaveLength(1);
    const flight: SimEvent[] = [];
    let landing: SimEvent[] = [];
    for (let i = 0; i < 100; i++) {
      landing = m.step();
      flight.push(...landing);
      if (hit(landing)) break;
    }
    expect(abilities(flight)).toEqual([
      { type: 'abilityUsed', unitId: torch.id, ability: 'ignite', lane: 0, x: 2.5, targetId: null },
    ]);
    expect(pea).toMatchObject({ burning: true, damage: 40, burnDps: 10, burnTicks: 90 });
    expect(eventsOf(landing, 'projectileHit')).toMatchObject([{ targetId: z.id, burning: true, blocked: false }]);
    expect(eventsOf(landing, 'unitDamaged')[0]).toMatchObject({ unitId: z.id, amount: 40 });
    expect(eventsOf(landing, 'statusApplied')).toEqual([
      { type: 'statusApplied', unitId: z.id, status: 'burn', ticks: 90, sourceId: shooter.id },
    ]);
    expect(z.burnDps).toBe(10);
  });

  it("burns by the special curve of the Torchwood's level", () => {
    const { m, z } = scene(3);
    const landing = stepUntil(m, hit);
    expect(z.burnDps).toBe(30);
    expect(eventsOf(landing, 'unitDamaged')[0]).toMatchObject({ amount: 40 }); // the factor does not grow with the level
  });

  it('stunned, it still sets a pea alight (igniting is passive, like a ready shield)', () => {
    const { m, torch, z } = scene();
    torch.stun = 200;
    const landing = stepUntil(m, hit);
    expect(torch.stun).toBeGreaterThan(0);
    expect(eventsOf(landing, 'projectileHit')).toMatchObject([{ targetId: z.id, burning: true }]);
    expect(eventsOf(landing, 'unitDamaged')[0]).toMatchObject({ unitId: z.id, amount: 40 });
  });

  it('sets a pea alight once, however many Torchwoods it passes', () => {
    const { m, z } = scene();
    spawnUnit(m.state, m.balance, 'torchwood', 0, 3.5);
    const events: SimEvent[] = [];
    for (let i = 0; i < 100 && !hit(events); i++) events.push(...m.step());
    expect(abilities(events, 'ignite')).toHaveLength(1);
    expect(eventsOf(events, 'unitDamaged')[0]).toMatchObject({ unitId: z.id, amount: 40 });
  });

  it('leaves alone a pea fired from in front of it', () => {
    const m = fresh();
    const shooter = spawnUnit(m.state, m.balance, 'peashooter', 0, 3.5);
    spawnUnit(m.state, m.balance, 'torchwood', 0, 2.5);
    const z = dummy(m, 0, 6.5);
    shooter.shotTimer = 0;
    const events: SimEvent[] = [];
    for (let i = 0; i < 100 && !hit(events); i++) events.push(...m.step());
    expect(abilities(events)).toEqual([]);
    expect(eventsOf(events, 'projectileHit')).toMatchObject([{ targetId: z.id, burning: false }]);
    expect(z.hp).toBe(1000 - 20);
    expect(z.burn).toBe(0);
  });

  it('leaves alone lobbed shots and zombie shots', () => {
    const m = fresh();
    const pult = spawnUnit(m.state, m.balance, 'mangoPult', 0, 0.5);
    spawnUnit(m.state, m.balance, 'torchwood', 0, 2.5);
    const z = dummy(m, 0, 6.5);
    pult.shotTimer = 0;
    const lob: SimEvent[] = [];
    for (let i = 0; i < 100 && !hit(lob); i++) lob.push(...m.step());
    expect(abilities(lob)).toEqual([]);
    expect(eventsOf(lob, 'projectileHit')).toMatchObject([{ targetId: z.id, burning: false }]);
    expect(z.hp).toBe(1000 - 45);

    const n = fresh();
    const torch = spawnUnit(n.state, n.balance, 'torchwood', 4, 0.5);
    spawnUnit(n.state, n.balance, 'torchwood', 4, 1.5);
    const thrower = spawnUnit(n.state, n.balance, 'brainEater', 4, 4.9);
    thrower.shotTimer = 0;
    const brain: SimEvent[] = [];
    for (let i = 0; i < 100 && !hit(brain); i++) brain.push(...n.step());
    expect(abilities(brain)).toEqual([]);
    expect(eventsOf(brain, 'projectileHit')).toMatchObject([{ burning: false }]);
    expect(n.state.units.filter((u) => u.key === 'torchwood').map((u) => u.burn)).toEqual([0, 0]);
    expect(torch.hp + n.state.units[1]!.hp).toBe(1000 - 15);
  });

  it('a burning pea blocked by a shield does nothing more than a plain one', () => {
    const m = fresh();
    const shooter = spawnUnit(m.state, m.balance, 'peashooter', 0, 0.5);
    spawnUnit(m.state, m.balance, 'torchwood', 0, 2.5);
    const skeleton = spawnUnit(m.state, m.balance, 'skeletonWarrior', 0, 6.5);
    m.step(); // the skeleton walks a step; its shield is ready
    shooter.shotTimer = 0;
    const events: SimEvent[] = [];
    for (let i = 0; i < 100 && !hit(events); i++) events.push(...m.step());
    expect(eventsOf(events, 'projectileHit')).toMatchObject([{ targetId: skeleton.id, burning: true, blocked: true }]);
    expect(eventsOf(events, 'unitDamaged')).toEqual([]);
    expect(eventsOf(events, 'statusApplied')).toEqual([]);
    expect(skeleton.hp).toBe(700);
    expect(skeleton.burn).toBe(0);
    expect(skeleton.abilityTimer).toBe(seconds(4)); // the shield went, as it does for a plain pea
  });
});

describe('Cherry Bomber', () => {
  it('lights its 1 s fuse when planted, then goes off: 600 within 1.6, and is spent', () => {
    const m = fresh();
    const events: SimEvent[] = [];
    const cherry = spawnUnit(m.state, m.balance, 'cherryBomber', 2, 4.5, events);
    expect(cherry.abilityTimer).toBe(seconds(1));
    expect(events).toEqual([
      { type: 'unitSpawned', unitId: cherry.id, key: 'cherryBomber', faction: 'plants', lane: 2, x: 4.5 },
      { type: 'abilityUsed', unitId: cherry.id, ability: 'fuse', lane: 2, x: 4.5, targetId: null },
    ]);
    const near = dummy(m, 2, 5.9); // 1.4
    const diagonal = dummy(m, 3, 5.5); // sqrt(2) = 1.41
    const out = dummy(m, 2, 6.2); // 1.7
    const twoLanes = dummy(m, 4, 4.5); // 2
    const zombieEnergy = m.state.players.zombies.energy;

    expect(eventsOf(steps(m, seconds(1) - 1), 'explosion')).toEqual([]);
    const boom = m.step();

    expect(eventsOf(boom, 'explosion')).toEqual([
      { type: 'explosion', lane: 2, x: 4.5, radius: 1.6, sourceKey: 'cherryBomber' },
    ]);
    expect(eventsOf(boom, 'unitDamaged').map((e) => [e.unitId, e.amount])).toEqual([[near.id, 600], [diagonal.id, 600]]);
    for (const u of [out, twoLanes]) expect(u.hp).toBe(1000);
    expect(eventsOf(boom, 'unitDied')).toMatchObject([{ unitId: cherry.id, cause: 'spent' }]);
    expect(m.state.units).not.toContain(cherry);
    expect(m.state.players.zombies.energy).toBe(zombieEnergy);
  });

  it('planted from the hand, it shows its fuse straight after it appears', () => {
    const m = fresh();
    const events = m.step([place('plants', 'cherryBomber', 1, 3)]);
    expect(events.map((e) => e.type)).toEqual(['unitSpawned', 'abilityUsed']);
    expect(abilities(events)).toMatchObject([{ ability: 'fuse', lane: 1, x: 3.5 }]);
  });

  it('killed during the fuse, it does not go off', () => {
    const m = fresh();
    const cherry = spawnUnit(m.state, m.balance, 'cherryBomber', 2, 4.5);
    const z = dummy(m, 2, 5);
    steps(m, 10);
    cherry.hp = 0;
    const events = steps(m, 60);
    expect(eventsOf(events, 'unitDied')).toMatchObject([{ unitId: cherry.id, cause: 'damage' }]);
    expect(eventsOf(events, 'explosion')).toEqual([]);
    expect(z.hp).toBe(1000);
  });

  it('killed on the very tick its fuse reaches 0, it does not go off (review-focus 1)', () => {
    const m = fresh();
    const cherry = spawnUnit(m.state, m.balance, 'cherryBomber', 2, 4.5);
    const eater = spawnUnit(m.state, m.balance, 'brainEater', 2, 4.9);
    cherry.abilityTimer = 1;
    cherry.hp = 1;
    eater.meleeTimer = 1; // its bite comes on the same tick, and bites come before abilities
    eater.shotTimer = 99;
    const events = m.step();
    expect(cherry.abilityTimer).toBe(0);
    expect(eventsOf(events, 'unitAttacked')).toMatchObject([{ unitId: eater.id, targetId: cherry.id }]);
    expect(eventsOf(events, 'unitDied')).toMatchObject([{ unitId: cherry.id, cause: 'damage' }]);
    expect(eventsOf(events, 'explosion')).toEqual([]);
    expect(eater.hp).toBe(400);
  });

  it.each(['stun', 'tied'] as const)('%s mid-fuse, the fuse stands still until it can act again', (kind) => {
    const m = fresh();
    const cherry = spawnUnit(m.state, m.balance, 'cherryBomber', 2, 4.5);
    steps(m, 10);
    expect(cherry.abilityTimer).toBe(20);
    cherry[kind] = 20;
    const held = steps(m, 20);
    expect(cherry.abilityTimer).toBe(20);
    expect(eventsOf(held, 'explosion')).toEqual([]);
    expect(eventsOf(steps(m, 19), 'explosion')).toEqual([]);
    expect(eventsOf(m.step(), 'explosion')).toHaveLength(1);
  });
});

describe('Pumpkin Squash', () => {
  it('crushes the zombie it sees within 2 ahead: 350 to every zombie within 0.5 of it, then 6 s to recover; it stays put', () => {
    const m = fresh();
    const pumpkin = spawnUnit(m.state, m.balance, 'pumpkinSquash', 1, 2.5);
    const far = dummy(m, 1, 4.6); // 2.1 ahead: out of its range
    const half = dummy(m, 1, 4.0); // 0.5 from the target: crushed with it
    const beyond = dummy(m, 1, 4.4); // 0.9 from the target: untouched
    const target = dummy(m, 1, 3.5); // 1 ahead, the nearest: the one it leaps on
    const otherLane = dummy(m, 2, 4.0);

    const first = m.step();

    expect(abilities(first)).toEqual([
      { type: 'abilityUsed', unitId: pumpkin.id, ability: 'leap', lane: 1, x: 2.5, targetId: target.id },
    ]);
    expect(eventsOf(first, 'unitDamaged').map((e) => [e.unitId, e.amount])).toEqual([
      [half.id, 350], [target.id, 350],
    ]);
    for (const u of [far, beyond, otherLane]) expect(u.hp).toBe(1000);
    expect(pumpkin.x).toBe(2.5);
    expect(pumpkin.abilityTimer).toBe(seconds(6));

    expect(abilities(steps(m, seconds(6) - 1))).toEqual([]);
    expect(abilities(m.step(), 'leap')).toHaveLength(1);
    expect(pumpkin.x).toBe(2.5);
  });

  it('with nothing within 2 ahead it waits, ready', () => {
    const m = fresh();
    const pumpkin = spawnUnit(m.state, m.balance, 'pumpkinSquash', 0, 2.5);
    dummy(m, 0, 4.6);
    dummy(m, 0, 2.0); // behind it
    expect(abilities(steps(m, 60))).toEqual([]);
    expect(pumpkin.abilityTimer).toBe(0);
  });

  it('hits by the damage curve of its level', () => {
    const m = fresh();
    const pumpkin = spawnUnit(m.state, m.balance, 'pumpkinSquash', 0, 2.5);
    m.step([merge('plants', 'pumpkinSquash', pumpkin.id)]);
    const z = dummy(m, 0, 3.0);
    pumpkin.abilityTimer = 0;
    expect(eventsOf(m.step(), 'unitDamaged')).toMatchObject([{ unitId: z.id, amount: 700 }]);
  });
});

describe('merging the ability plants', () => {
  it.each(['potatoMine', 'cherryBomber', 'pumpkinSquash'] as const)('%s merges like any plant', (key) => {
    const m = fresh();
    const u = spawnUnit(m.state, m.balance, key, 3, 1.5);
    const hp = u.maxHp;
    const timer = u.abilityTimer;
    const events = m.step([merge('plants', key, u.id)]);
    expect(eventsOf(events, 'unitMerged')).toEqual([{ type: 'unitMerged', unitId: u.id, level: 2 }]);
    expect(u.maxHp).toBe(hp * 2);
    expect(u.abilityTimer).toBe(Math.max(0, timer - 1)); // the timer runs on
  });

  it('merging a Cherry mid-fuse does not restart the fuse, and it goes off by its new level', () => {
    const m = fresh();
    const cherry = spawnUnit(m.state, m.balance, 'cherryBomber', 2, 4.5);
    const z = dummy(m, 2, 5);
    z.hp = 5000;
    steps(m, 10);
    const merged = m.step([merge('plants', 'cherryBomber', cherry.id)]);
    expect(abilities(merged)).toEqual([]);
    expect(cherry.abilityTimer).toBe(19);
    expect(eventsOf(steps(m, 18), 'explosion')).toEqual([]);
    const boom = m.step();
    expect(eventsOf(boom, 'explosion')).toHaveLength(1);
    expect(eventsOf(boom, 'unitDamaged')).toMatchObject([{ unitId: z.id, amount: 1200 }]);
  });
});

describe('snapshot and restore', () => {
  function continued(m: Match, n: number): { hash: number; events: SimEvent[] } {
    const events = steps(m, n);
    return { hash: m.hash(), events };
  }

  it('mid-fuse, the restored match reaches the hash of the unbroken one', () => {
    const m = fresh();
    spawnUnit(m.state, m.balance, 'cherryBomber', 2, 4.5);
    spawnUnit(m.state, m.balance, 'brainEater', 2, 6);
    steps(m, 12);
    const restored = Match.restore(m.snapshot(), m.balance);
    const a = continued(m, 60);
    const b = continued(restored, 60);
    expect(eventsOf(a.events, 'explosion')).toHaveLength(1);
    expect(b.events).toEqual(a.events);
    expect(b.hash).toBe(a.hash);
  });

  it('with an armed mine, the restored match reaches the hash of the unbroken one', () => {
    const m = fresh();
    const mine = spawnUnit(m.state, m.balance, 'potatoMine', 2, 2.5);
    mine.abilityTimer = 1;
    spawnUnit(m.state, m.balance, 'brainEater', 2, 5);
    expect(abilities(m.step(), 'arm')).toHaveLength(1);
    const restored = Match.restore(m.snapshot(), m.balance);
    const a = continued(m, 400);
    const b = continued(restored, 400);
    expect(abilities(a.events).map((e) => e.ability)).toEqual(['trigger']); // armed once, not again
    expect(b.events).toEqual(a.events);
    expect(b.hash).toBe(a.hash);
  });
});
