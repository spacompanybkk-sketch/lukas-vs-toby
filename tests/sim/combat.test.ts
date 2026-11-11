import { describe, expect, it } from 'vitest';
import { BALANCE, cloneBalance, seconds } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { damageBase, damageUnit, resolveDeaths, tickProjectiles } from '../../src/sim/combat';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { Projectile, SimEvent, Unit } from '../../src/sim/types';
import { eventsOf, withBaseDefense } from './helpers';

/**
 * Units are set with `spawnUnit`. Income is switched off so energy only moves through bounties,
 * the start energy is large so nothing ever waits for it, and each base has 3000 health.
 */
function fresh(balance: Balance = BALANCE): Match {
  const config = defaultConfig(1, balance);
  config.startEnergy = { plants: 9999, zombies: 9999 };
  config.baseHp = { plants: 3000, zombies: 3000 };
  config.incomeMultiplier = { plants: 0, zombies: 0 };
  return new Match(config, balance);
}

/** Steps until a step's events pass `done`, and returns that step's events. */
function stepUntil(m: Match, done: (events: SimEvent[]) => boolean, limit = 1000): SimEvent[] {
  for (let n = 0; n < limit; n++) {
    const events = m.step();
    if (done(events)) return events;
  }
  throw new Error(`still waiting after ${limit} steps`);
}

const anyHit = (events: SimEvent[]): boolean => eventsOf(events, 'projectileHit').length > 0;

function hitsOn(events: SimEvent[], u: Unit) {
  return eventsOf(events, 'projectileHit').filter((e) => e.targetId === u.id);
}

type Flight = Pick<Projectile, 'faction' | 'kind' | 'lane' | 'x' | 'speed' | 'damage'>;

/** Puts a projectile in flight as if fired on the previous tick, so it moves on the next one. */
function launch(m: Match, flight: Flight): Projectile {
  const p: Projectile = { ...flight, id: m.state.nextId, ownerId: 0, spawnTick: m.state.tick - 1 };
  m.state.nextId += 1;
  m.state.projectiles.push(p);
  return p;
}

/** A pea exactly as a level-1 Peashooter fires it. */
function pea(lane: number, x: number): Flight {
  const shot = BALANCE.units.peashooter?.shot;
  if (!shot) throw new Error('no peashooter shot');
  return { faction: 'plants', kind: shot.kind, lane, x, speed: shot.speed / 30, damage: shot.damage };
}

describe('shots and projectiles', () => {
  it("a Peashooter's pea hits the nearer of two zombies in its lane for 20", () => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'peashooter', 2, 0.5);
    const far = spawnUnit(m.state, BALANCE, 'brainEater', 2, 8);
    const near = spawnUnit(m.state, BALANCE, 'brainEater', 2, 6); // the higher id: array order is not why it is hit

    const events = stepUntil(m, anyHit);

    expect(eventsOf(events, 'projectileHit')).toEqual([
      expect.objectContaining({ lane: 2, targetId: near.id, targetBase: null, blocked: false }),
    ]);
    expect(eventsOf(events, 'unitDamaged')).toEqual([
      { type: 'unitDamaged', unitId: near.id, amount: 20, hp: 380 },
    ]);
    expect(far.hp).toBe(400);
    expect(m.state.projectiles).toEqual([]);
  });

  it('a pea ignores zombies in other lanes', () => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'peashooter', 2, 0.5);
    const above = spawnUnit(m.state, BALANCE, 'veryFastWalker', 1, 5);
    const below = spawnUnit(m.state, BALANCE, 'veryFastWalker', 3, 5);

    const events = stepUntil(m, anyHit);

    expect(eventsOf(events, 'projectileHit')).toEqual([
      expect.objectContaining({ lane: 2, targetId: null, targetBase: 'zombies' }),
    ]);
    expect(above.hp).toBe(180);
    expect(below.hp).toBe(180);
  });

  it('a projectile appears at its shooter and first moves on the next step', () => {
    const m = fresh();
    const shooter = spawnUnit(m.state, BALANCE, 'peashooter', 1, 2.5);

    const events = stepUntil(m, (e) => eventsOf(e, 'projectileSpawned').length > 0);

    expect(events.map((e) => e.type)).toEqual(['unitAttacked', 'projectileSpawned']);
    expect(events[0]).toEqual({
      type: 'unitAttacked', unitId: shooter.id, attack: 'shot', targetId: null, targetBase: 'zombies',
    });
    const p = m.state.projectiles[0];
    if (!p) throw new Error('no projectile');
    expect(events[1]).toEqual({
      type: 'projectileSpawned', projectileId: p.id, kind: 'pea', faction: 'plants', lane: 1, x: 2.5, ownerId: shooter.id,
    });
    expect(p.x).toBe(2.5);
    expect(shooter.shotTimer).toBe(seconds(1.5));

    m.step();
    expect(p.x).toBeCloseTo(2.5 + 6 / 30, 12);
  });

  it('a Brain Eater keeps moving while its brain flies, and the brain deals 15 to the first plant', () => {
    const m = fresh();
    const behind = spawnUnit(m.state, BALANCE, 'sunflower', 1, 1.5);
    const first = spawnUnit(m.state, BALANCE, 'walnutBomb', 1, 2.5);
    const z = spawnUnit(m.state, BALANCE, 'brainEater', 1, 5.5); // the Walnut Bomb is within its 3.5 range

    stepUntil(m, (e) => eventsOf(e, 'projectileSpawned').length > 0);
    const brain = m.state.projectiles[0];
    if (!brain) throw new Error('no brain');
    expect(brain.kind).toBe('brain');

    let last = z.x;
    const events = stepUntil(m, (e) => {
      expect(z.blocked).toBe(false);
      expect(z.x).toBeLessThan(last); // walked this step too
      last = z.x;
      return anyHit(e);
    });

    expect(eventsOf(events, 'projectileHit')).toEqual([
      { type: 'projectileHit', projectileId: brain.id, lane: 1, x: 2.5, targetId: first.id, targetBase: null, blocked: false },
    ]);
    expect(eventsOf(events, 'unitDamaged')).toEqual([
      { type: 'unitDamaged', unitId: first.id, amount: 15, hp: 1185 },
    ]);
    expect(behind.hp).toBe(200);
  });

  it('an unblocked pea hits the zombie base for 10', () => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'peashooter', 3, 0.5);

    const events = stepUntil(m, anyHit);

    const [hit] = eventsOf(events, 'projectileHit');
    expect(events.slice(-2)).toEqual([
      { type: 'projectileHit', projectileId: hit?.projectileId, lane: 3, x: 10, targetId: null, targetBase: 'zombies', blocked: false },
      { type: 'baseDamaged', faction: 'zombies', amount: 10, hp: 2990, lane: 3 },
    ]);
    expect(m.state.baseHp.zombies).toBe(2990);
    expect(m.state.projectiles.map((p) => p.id)).not.toContain(hit?.projectileId); // the next pea is already out
  });

  it('a brain passing x <= 0 deals 15 to the plant base', () => {
    const m = fresh();
    const z = spawnUnit(m.state, BALANCE, 'brainEater', 3, 3); // the base (x <= 3.5) is within range

    const events = stepUntil(m, anyHit);

    expect(events.slice(-2)).toEqual([
      { type: 'projectileHit', projectileId: expect.any(Number), lane: 3, x: 0, targetId: null, targetBase: 'plants', blocked: false },
      { type: 'baseDamaged', faction: 'plants', amount: 15, hp: 2985, lane: 3 },
    ]);
    expect(z.x).toBeGreaterThan(0.3); // a thrown brain, not a bite
    expect(m.state.projectiles).toEqual([]);
  });

  it.each([
    ['the next zombie', true],
    ['the base', false],
  ] as const)('a pea whose target died mid-flight carries on to %s', (_name, withSecond) => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
    const target = spawnUnit(m.state, BALANCE, 'brainEater', 0, 6);
    const second = withSecond ? spawnUnit(m.state, BALANCE, 'brainEater', 0, 8) : null;

    const fired = stepUntil(m, (e) => eventsOf(e, 'projectileSpawned').length > 0);
    expect(eventsOf(fired, 'unitAttacked')[0]?.targetId).toBe(target.id);
    const pea = eventsOf(fired, 'projectileSpawned')[0]!.projectileId;

    m.step(); // in flight
    damageUnit(m.state, target, 9999, []); // killed by something else
    const death = m.step();
    expect(eventsOf(death, 'unitDied').map((e) => e.unitId)).toEqual([target.id]);
    expect(m.state.projectiles.map((p) => p.id)).toEqual([pea]);

    const events = stepUntil(m, anyHit);
    if (second) {
      expect(eventsOf(events, 'projectileHit')).toEqual([
        expect.objectContaining({ projectileId: pea, targetId: second.id, targetBase: null }),
      ]);
      expect(second.hp).toBe(380);
    } else {
      expect(eventsOf(events, 'projectileHit')).toEqual([
        expect.objectContaining({ projectileId: pea, targetId: null, targetBase: 'zombies' }),
      ]);
      expect(m.state.baseHp.zombies).toBe(2990);
    }
  });

  it('a zombie already at 0 hp is no target: a second pea on the same step flies on', () => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'peashooter', 3, 0.5);
    spawnUnit(m.state, BALANCE, 'peashooter', 3, 0.5); // same spot, same timer: the two peas fly together
    const z = spawnUnit(m.state, BALANCE, 'brainEater', 3, 6);
    z.hp = 20;

    const events = stepUntil(m, anyHit);
    expect(hitsOn(events, z)).toHaveLength(1);
    expect(eventsOf(events, 'unitDied').map((e) => e.unitId)).toEqual([z.id]);
    expect(m.state.projectiles).toHaveLength(1);

    const later = stepUntil(m, anyHit);
    expect(eventsOf(later, 'projectileHit')).toEqual([
      expect.objectContaining({ targetId: null, targetBase: 'zombies' }),
    ]);
  });

  it('a plant bitten to 0 on the tick its shot is ready still fires, and the pea outlives it', () => {
    const m = fresh();
    const z = spawnUnit(m.state, BALANCE, 'veryFastWalker', 0, 1.0); // the lower id: it acts first
    const plant = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
    plant.hp = 15; // one bite
    plant.shotTimer = z.meleeTimer; // both ready on the same tick

    const events = stepUntil(m, (e) => eventsOf(e, 'unitDied').length > 0);
    expect(events.map((e) => e.type)).toEqual([
      'unitAttacked', 'unitDamaged', // the bite
      'unitAttacked', 'projectileSpawned', // the shot, fired on the same tick
      'unitDied', 'energyGained',
    ]);
    expect(m.state.units).toEqual([z]);

    const hit = m.step();
    expect(eventsOf(hit, 'unitDamaged')).toEqual([{ type: 'unitDamaged', unitId: z.id, amount: 20, hp: 160 }]);
  });

  it('a level-3 Peashooter fires 60-damage peas', () => {
    const m = fresh();
    const shooter = spawnUnit(m.state, BALANCE, 'peashooter', 4, 0.5);
    shooter.level = 3;
    const z = spawnUnit(m.state, BALANCE, 'brainEater', 4, 6);

    const events = stepUntil(m, anyHit);

    expect(eventsOf(events, 'unitDamaged')).toEqual([
      { type: 'unitDamaged', unitId: z.id, amount: 60, hp: 340 },
    ]);
  });

  it('a zombie holds its shot while no plant ahead and not the base is within range', () => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'sunflower', 1, 0.5);
    spawnUnit(m.state, BALANCE, 'peashooter', 1, 9.0); // behind the zombie: not ahead of it
    const z = spawnUnit(m.state, BALANCE, 'brainEater', 1, 8.5);
    for (let n = 0; n < 100; n++) {
      const events = m.step();
      expect(eventsOf(events, 'unitAttacked').filter((e) => e.unitId === z.id)).toEqual([]);
    }
    expect(z.shotTimer).toBe(0); // ready, holding
    expect(m.state.projectiles.filter((p) => p.ownerId === z.id)).toEqual([]);
  });
});

describe('projectile hit edges', () => {
  it("a zombie just behind a pea's starting point is not hit", () => {
    const m = fresh();
    const behind = spawnUnit(m.state, BALANCE, 'brainEater', 1, 4.999);
    const p = launch(m, pea(1, 5));
    const events: SimEvent[] = [];

    tickProjectiles(m.state, m.balance, events);

    expect(events).toEqual([]);
    expect(behind.hp).toBe(400);
    expect(m.state.projectiles).toEqual([p]);
    expect(p.x).toBeCloseTo(5 + 6 / 30, 12);
  });

  it.each([
    ['a pea', 'plants', 'pea', 'brainEater', 5.75, 5.76],
    ['a brain', 'zombies', 'brain', 'sunflower', 4.25, 4.24],
  ] as const)('%s hits a unit exactly speed + hitRadius from its start, and not one past it', (_name, faction, kind, key, edge, past) => {
    const b = cloneBalance(BALANCE);
    b.hitRadius = 0.5; // with a speed of 0.25 the edge, 0.75 from the start, is exact in binary
    for (const [x, hit] of [[edge, true], [past, false]] as const) {
      const m = fresh(b);
      const u = spawnUnit(m.state, b, key, 2, x);
      launch(m, { faction, kind, lane: 2, x: 5, speed: 0.25, damage: 20 });
      const events: SimEvent[] = [];
      tickProjectiles(m.state, b, events);
      expect([x, hitsOn(events, u).length]).toEqual([x, hit ? 1 : 0]);
    }
  });

  it('two zombies at the same x: the lower id is hit', () => {
    const m = fresh();
    const first = spawnUnit(m.state, BALANCE, 'brainEater', 3, 5.3);
    const second = spawnUnit(m.state, BALANCE, 'brainEater', 3, 5.3);
    launch(m, pea(3, 5));
    const events: SimEvent[] = [];

    tickProjectiles(m.state, m.balance, events);

    expect(eventsOf(events, 'projectileHit').map((e) => e.targetId)).toEqual([first.id]);
    expect([first.hp, second.hp]).toEqual([380, 400]);
  });
});

describe('the Skeleton Warrior shield', () => {
  it('takes 0 from the first pea, 20 from the second, and blocks again 120 ticks after the first block', () => {
    const m = fresh();
    const skel = spawnUnit(m.state, BALANCE, 'skeletonWarrior', 0, 5);
    /** One pea just in front of it, so it lands on this step, whatever the pea speed. */
    const peaNow = (): SimEvent[] => {
      launch(m, pea(0, skel.x - 0.1));
      return m.step();
    };

    const first = peaNow();
    const blockedOn = m.state.tick; // the tick count after the blocking step
    expect(hitsOn(first, skel)).toEqual([
      expect.objectContaining({ x: skel.x, targetBase: null, blocked: true }),
    ]);
    expect(eventsOf(first, 'unitDamaged')).toEqual([]);
    expect(skel.hp).toBe(700);
    expect(skel.abilityTimer).toBe(seconds(4));

    const second = peaNow();
    expect(hitsOn(second, skel)).toEqual([expect.objectContaining({ blocked: false })]);
    expect(eventsOf(second, 'unitDamaged')).toEqual([
      { type: 'unitDamaged', unitId: skel.id, amount: 20, hp: 680 },
    ]);

    while (m.state.tick < blockedOn + 118) m.step();
    const at119 = peaNow();
    expect(m.state.tick - blockedOn).toBe(119);
    expect(hitsOn(at119, skel)).toEqual([expect.objectContaining({ blocked: false })]);
    expect(skel.hp).toBe(660);

    const at120 = peaNow();
    expect(hitsOn(at120, skel)).toEqual([expect.objectContaining({ blocked: true })]);
    expect(skel.hp).toBe(660);
    expect(skel.abilityTimer).toBe(seconds(4));
  });
});

describe('melee', () => {
  it.each(['veryFastWalker', 'skeletonWarrior'] as const)(
    'a zombie (%s) blocked by a plant deals melee.damage every seconds(interval)',
    (key) => {
      const melee = BALANCE.units[key]?.melee;
      if (!melee) throw new Error(`${key} has no melee`);
      const interval = seconds(melee.interval);
      const m = fresh();
      const plant = spawnUnit(m.state, BALANCE, 'walnutBomb', 0, 0.5);
      const z = spawnUnit(m.state, BALANCE, key, 0, 1.0); // within reach from the start

      const bitesOn: number[] = [];
      for (let n = 1; n <= interval * 5; n++) {
        const events = m.step();
        const bites = eventsOf(events, 'unitAttacked');
        for (const bite of bites) {
          expect(bite).toEqual({ type: 'unitAttacked', unitId: z.id, attack: 'melee', targetId: plant.id, targetBase: null });
          bitesOn.push(n);
        }
        expect(eventsOf(events, 'unitDamaged')).toEqual(
          bites.map(() => ({ type: 'unitDamaged', unitId: plant.id, amount: melee.damage, hp: plant.hp })),
        );
      }
      expect(bitesOn).toEqual([1, 2, 3, 4, 5].map((k) => k * interval));
      expect(plant.hp).toBe(1200 - 5 * melee.damage);
      expect(z.x).toBe(1.0);
    },
  );

  it('a zombie at the base deals 40 per second to the plant base', () => {
    const m = fresh(withBaseDefense(0)); // the base does not strike back here (baseDefense.test.ts covers that)
    const z = spawnUnit(m.state, BALANCE, 'brainEater', 4, 0.3); // at the base: blocked from its first step
    const baseHits: Array<[number, Extract<SimEvent, { type: 'baseDamaged' }>]> = [];
    const throwsOn: number[] = [];

    for (let n = 1; n <= 300; n++) { // 10 seconds from the moment it is first blocked
      const events = m.step();
      expect(z.blocked).toBe(true);
      for (const hit of eventsOf(events, 'baseDamaged')) baseHits.push([n, hit]);
      for (const shot of eventsOf(events, 'projectileSpawned')) if (shot.ownerId === z.id) throwsOn.push(n);
    }

    expect(baseHits).toEqual([30, 60, 90, 120, 150, 180, 210, 240, 270, 300].map((n, i) => [
      n, { type: 'baseDamaged', faction: 'plants', amount: 40, hp: 3000 - 40 * (i + 1), lane: 4 },
    ]));
    expect(m.state.baseHp.plants).toBe(2600);
    // The base is within its brain range, but a blocked zombie only bites.
    expect(throwsOn).toEqual([]);
  });

  it('a blocked zombie holds its shot: a Brain Eater throws on the approach, then only bites', () => {
    const m = fresh();
    const walnut = spawnUnit(m.state, BALANCE, 'walnutBomb', 2, 2.5);
    const z = spawnUnit(m.state, BALANCE, 'brainEater', 2, 5.5); // the Walnut Bomb is within its 3.5 range
    let thrownWalking = 0;
    let thrownBlocked = 0;
    let bites = 0;

    for (let n = 0; n < 600; n++) {
      const events = m.step();
      const throws = eventsOf(events, 'projectileSpawned').filter((e) => e.ownerId === z.id).length;
      // `blocked` was set in this step's movement stage, before anyone attacked.
      if (z.blocked) thrownBlocked += throws;
      else thrownWalking += throws;
      bites += eventsOf(events, 'unitAttacked').filter((e) => e.unitId === z.id && e.attack === 'melee').length;
    }

    expect(thrownWalking).toBeGreaterThan(0);
    expect(z.blocked).toBe(true);
    expect(bites).toBeGreaterThan(0);
    expect(thrownBlocked).toBe(0);
    expect(z.shotTimer).toBe(0); // ready, and held
    expect(walnut.hp).toBeGreaterThan(0);
  });
});

describe('deaths and bounties', () => {
  it('killing a Brain Eater pays plants exactly 20 with an energyGained bounty event', () => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
    const z = spawnUnit(m.state, BALANCE, 'brainEater', 0, 6);
    z.hp = 20; // one pea
    const before = m.state.players.plants.energy;

    const events = stepUntil(m, anyHit);

    expect(events.map((e) => e.type)).toEqual(['projectileHit', 'unitDamaged', 'unitDied', 'energyGained']);
    const died = eventsOf(events, 'unitDied')[0];
    expect(died).toEqual({
      type: 'unitDied', unitId: z.id, key: 'brainEater', faction: 'zombies', lane: 0, x: z.x, level: 1, cause: 'damage',
    });
    expect(eventsOf(events, 'energyGained')).toEqual([
      { type: 'energyGained', faction: 'plants', amount: 20, source: 'bounty', unitId: null, lane: 0, x: z.x },
    ]);
    expect(m.state.players.plants.energy).toBe(before + 20);
    expect(m.state.units.map((u) => u.id)).not.toContain(z.id);
  });

  it('killing a Peashooter that had spent = 300 pays zombies 150', () => {
    const m = fresh();
    const plant = spawnUnit(m.state, BALANCE, 'peashooter', 2, 0.5);
    plant.spent = 300;
    plant.hp = 15; // one bite
    spawnUnit(m.state, BALANCE, 'veryFastWalker', 2, 1.0);
    const before = m.state.players.zombies.energy;

    const events = stepUntil(m, (e) => eventsOf(e, 'unitDied').length > 0);

    expect(eventsOf(events, 'unitDied')).toEqual([expect.objectContaining({ unitId: plant.id, cause: 'damage' })]);
    expect(eventsOf(events, 'energyGained')).toEqual([
      { type: 'energyGained', faction: 'zombies', amount: 150, source: 'bounty', unitId: null, lane: 2, x: 0.5 },
    ]);
    expect(m.state.players.zombies.energy).toBe(before + 150);
  });

  it("a Walnut Bomb's death damages zombies at distance 1.0 in its lane and the adjacent lane by 150, not one two lanes away", () => {
    const m = fresh();
    const walnut = spawnUnit(m.state, BALANCE, 'walnutBomb', 2, 3.5);
    const friend = spawnUnit(m.state, BALANCE, 'sunflower', 2, 2.5);
    const sameLane = spawnUnit(m.state, BALANCE, 'brainEater', 2, 4.5); // distance 1.0
    const nextLane = spawnUnit(m.state, BALANCE, 'brainEater', 1, 3.5); // distance 1.0
    const diagonal = spawnUnit(m.state, BALANCE, 'brainEater', 3, 4.5); // distance 1.41, radius 1.5
    const twoAway = spawnUnit(m.state, BALANCE, 'brainEater', 0, 3.5); // distance 2.0
    walnut.hp = 0;
    const events: SimEvent[] = [];

    resolveDeaths(m.state, BALANCE, events);

    expect(events).toEqual([
      { type: 'unitDied', unitId: walnut.id, key: 'walnutBomb', faction: 'plants', lane: 2, x: 3.5, level: 1, cause: 'damage' },
      { type: 'energyGained', faction: 'zombies', amount: 37, source: 'bounty', unitId: null, lane: 2, x: 3.5 },
      { type: 'explosion', lane: 2, x: 3.5, radius: 1.5, sourceKey: 'walnutBomb' },
      { type: 'unitDamaged', unitId: sameLane.id, amount: 150, hp: 250 },
      { type: 'unitDamaged', unitId: nextLane.id, amount: 150, hp: 250 },
      { type: 'unitDamaged', unitId: diagonal.id, amount: 150, hp: 250 },
    ]);
    expect(twoAway.hp).toBe(400);
    expect(friend.hp).toBe(200); // a blast hurts only the other side
    // The dead are removed; everyone else keeps their order.
    expect(m.state.units.map((u) => u.id)).toEqual([friend.id, sameLane.id, nextLane.id, diagonal.id, twoAway.id]);
  });

  it('counts a unit whose hp is not a number as dead, and leaves the unit list alone when nobody falls', () => {
    const m = fresh();
    const broken = spawnUnit(m.state, BALANCE, 'brainEater', 0, 5);
    const fine = spawnUnit(m.state, BALANCE, 'brainEater', 1, 5);
    const list = m.state.units;
    resolveDeaths(m.state, BALANCE, []);
    expect(m.state.units).toBe(list); // nobody down: the very same array

    broken.hp = NaN;
    const events: SimEvent[] = [];
    resolveDeaths(m.state, BALANCE, events);
    expect(eventsOf(events, 'unitDied')).toEqual([expect.objectContaining({ unitId: broken.id, cause: 'damage' })]);
    expect(m.state.units).toEqual([fine]);
  });

  it("a level-2 Walnut Bomb's blast deals 300", () => {
    const m = fresh();
    const walnut = spawnUnit(m.state, BALANCE, 'walnutBomb', 2, 3.5);
    walnut.level = 2;
    const z = spawnUnit(m.state, BALANCE, 'skeletonWarrior', 2, 4.5);
    walnut.hp = 0;
    const events: SimEvent[] = [];
    resolveDeaths(m.state, BALANCE, events);
    expect(eventsOf(events, 'unitDamaged')).toEqual([{ type: 'unitDamaged', unitId: z.id, amount: 300, hp: 400 }]);
  });

  it('a blast that kills a second Walnut Bomb sets off its blast in the same step', () => {
    // The shipped table gives no zombie a death blast, so this test gives one to the Very Fast Walker.
    const b = cloneBalance(BALANCE);
    const walker = b.units.veryFastWalker;
    if (!walker) throw new Error('no veryFastWalker numbers');
    b.units.veryFastWalker = { ...walker, deathBlast: { damage: 1200, radius: 1.5 } };
    const m = fresh(b);
    const firstBomb = spawnUnit(m.state, b, 'walnutBomb', 2, 3.5);
    const bomber = spawnUnit(m.state, b, 'veryFastWalker', 2, 4.5);
    const secondBomb = spawnUnit(m.state, b, 'walnutBomb', 2, 5.5);
    const victim = spawnUnit(m.state, b, 'brainEater', 2, 6.5);
    bomber.hp = 150; // exactly what the first blast deals
    firstBomb.hp = 0;

    const events = m.step();

    expect(eventsOf(events, 'unitDied').map((e) => [e.unitId, e.cause])).toEqual([
      [firstBomb.id, 'damage'],
      [bomber.id, 'blast'],
      [secondBomb.id, 'blast'],
    ]);
    expect(eventsOf(events, 'explosion').map((e) => e.sourceKey)).toEqual(['walnutBomb', 'veryFastWalker', 'walnutBomb']);
    expect(events.map((e) => e.type)).toEqual([
      'unitDied', 'energyGained', 'explosion', 'unitDamaged', // the first bomb takes the walker to 0
      'unitDied', 'energyGained', 'explosion', 'unitDamaged', // the walker's blast takes the second bomb to 0
      'unitDied', 'energyGained', 'explosion', 'unitDamaged', // the second bomb hits the Brain Eater
    ]);
    expect(victim.hp).toBe(250);
    expect(m.state.units).toEqual([victim]);
  });
});

describe('damageUnit and damageBase', () => {
  it('armor takes its value off each hit, but at least 1 always lands', () => {
    const b = cloneBalance(BALANCE);
    const stats = b.units.brainEater;
    if (!stats) throw new Error('no brainEater numbers');
    b.units.brainEater = { ...stats, armor: 15 };
    const m = fresh(b);
    const z = spawnUnit(m.state, b, 'brainEater', 0, 5);
    const events: SimEvent[] = [];

    damageUnit(m.state, z, 20, events);
    damageUnit(m.state, z, 10, events);

    expect(events).toEqual([
      { type: 'unitDamaged', unitId: z.id, amount: 5, hp: 395 },
      { type: 'unitDamaged', unitId: z.id, amount: 1, hp: 394 },
    ]);
  });

  it('a pea against an armored zombie lands its damage less the armor', () => {
    const b = cloneBalance(BALANCE);
    const stats = b.units.brainEater;
    if (!stats) throw new Error('no brainEater numbers');
    b.units.brainEater = { ...stats, armor: 15 };
    const m = fresh(b);
    spawnUnit(m.state, b, 'peashooter', 1, 0.5);
    const z = spawnUnit(m.state, b, 'brainEater', 1, 6);

    const events = stepUntil(m, anyHit);

    expect(eventsOf(events, 'unitDamaged')).toEqual([{ type: 'unitDamaged', unitId: z.id, amount: 5, hp: 395 }]);
  });

  it('damageBase lowers the base, may take it below zero, and reports the lane', () => {
    const m = fresh();
    const events: SimEvent[] = [];
    damageBase(m.state, 'zombies', 99999, null, events);
    damageBase(m.state, 'plants', 12, 3, events);
    expect(m.state.baseHp).toEqual({ plants: 2988, zombies: 3000 - 99999 });
    expect(events).toEqual([
      { type: 'baseDamaged', faction: 'zombies', amount: 99999, hp: 3000 - 99999, lane: null },
      { type: 'baseDamaged', faction: 'plants', amount: 12, hp: 2988, lane: 3 },
    ]);
  });
});
