import { describe, expect, it } from 'vitest';
import { BALANCE, cloneBalance, seconds } from '../../src/data/balance';
import type { Balance, UnitStats } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { spawnMinion } from '../../src/sim/spawn';
import type { CardKey, SimEvent, Unit, UnitKey } from '../../src/sim/types';
import { randomLegal } from '../../src/ai/lawn';
import { randomInt } from '../../src/sim/rng';
import { classicBalance, eventsOf, merge, place } from './helpers';

/**
 * The seven phase-2 zombies and the Bone Minion (phase 2, Task 3), with their starting numbers
 * from `BALANCE` on top of the classic table (see `classicBalance`), so the plants they meet keep
 * the numbers the rules tests were written for. Every level curve there is linear.
 */

const NEW_UNITS: readonly UnitKey[] = [
  'desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie', 'necromancer', 'tridentZombie', 'brainRot', 'boneMinion',
  'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber', 'pumpkinSquash',
];

/** A plant that stands and does nothing: 1000 hp, no armor, no attack (it borrows the Avocado Bunker's key). */
const WALL: UnitStats = { recharge: 5, hp: 1000, armor: 0, speed: 0 };
/** A zombie that stands and does nothing (it borrows the Very Fast Walker's key). */
const STILL: UnitStats = { recharge: 3, hp: 1000, armor: 0, speed: 0 };

function table(): Balance {
  const b = classicBalance();
  const shipped = cloneBalance(BALANCE);
  for (const key of NEW_UNITS) b.units[key] = shipped.units[key];
  b.units.avocadoBunker = { ...WALL };
  b.units.veryFastWalker = { ...STILL };
  return b;
}

function fresh(b: Balance = table(), seed = 1): Match {
  const config = defaultConfig(seed, b);
  config.startEnergy = { plants: 5000, zombies: 5000 };
  config.baseHp = { plants: 1_000_000, zombies: 1_000_000 };
  config.incomeMultiplier = { plants: 0, zombies: 0 };
  config.suddenDeath = false;
  config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
  return new Match(config, b);
}

function steps(m: Match, n: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...m.step());
  return all;
}

function stepUntil(m: Match, done: (events: SimEvent[]) => boolean, limit = 3000): SimEvent[] {
  for (let n = 0; n < limit; n++) {
    const events = m.step();
    if (done(events)) return events;
  }
  throw new Error(`still waiting after ${limit} steps`);
}

const abilities = (events: readonly SimEvent[], ability?: string) =>
  eventsOf(events, 'abilityUsed').filter((e) => ability === undefined || e.ability === ability);

const spawn = (m: Match, key: UnitKey, lane: number, x: number): Unit => spawnUnit(m.state, m.balance, key, lane, x);
const wall = (m: Match, lane: number, x: number): Unit => spawn(m, 'avocadoBunker', lane, x);
const still = (m: Match, lane: number, x: number): Unit => spawn(m, 'veryFastWalker', lane, x);

/** Takes a unit off the lawn without a trace, with every projectile in flight, so nothing it started goes on. */
function lift(m: Match, ...units: Unit[]): void {
  m.state.units = m.state.units.filter((u) => !units.includes(u));
  m.state.projectiles = [];
}

describe('the shipped starting numbers', () => {
  it('are the table of the phase-2 plan', () => {
    const u = BALANCE.units;
    const melee = (damage: number, interval: number) => ({ damage, interval, reach: 0.6 });
    expect(u.desertZombie).toEqual({
      recharge: 6, hp: 380, armor: 0, speed: 0.35, melee: melee(30, 1),
      shot: { kind: 'sand', damage: 10, interval: 2.5, range: 4, speed: 5, status: { kind: 'blind', seconds: 3 } },
    });
    expect(u.skeletonArcher).toEqual({
      recharge: 6, hp: 220, armor: 0, speed: 0.4, melee: melee(15, 1),
      shot: { kind: 'arrow', damage: 28, interval: 1.6, range: 6, speed: 8 }, holds: true,
    });
    expect(u.hotTopic).toEqual({
      recharge: 6, hp: 300, armor: 0, speed: 0.5, melee: melee(25, 0.5),
      grow: { hpShare: 0.2, damageShare: 0.2, maxStacks: 5 },
    });
    expect(u.cowboyZombie).toEqual({
      recharge: 10, hp: 450, armor: 0, speed: 0.35, melee: melee(30, 1),
      shot: { kind: 'bullet', damage: 22, interval: 1.5, range: 4.5, speed: 10 },
      lasso: { interval: 9, range: 5, seconds: 3 },
    });
    expect(u.necromancer).toEqual({
      recharge: 15, hp: 400, armor: 0, speed: 0.3, melee: melee(15, 1.2), holds: true, holdRange: 4,
      healAura: { amount: 40, interval: 2, radius: 1.5 }, raise: { key: 'boneMinion', interval: 10 },
    });
    expect(u.tridentZombie).toEqual({
      recharge: 12, hp: 500, armor: 0, speed: 0.2, melee: melee(40, 1.2),
      shot: { kind: 'trident', damage: 70, interval: 3.5, range: 10, speed: 6, flight: 'piercing', pierce: 3 },
    });
    expect(u.brainRot).toEqual({
      recharge: 15, hp: 450, armor: 0, speed: 0.25, melee: melee(20, 1.2), holds: true,
      shot: {
        kind: 'rot', damage: 30, interval: 4, range: 6, speed: 4, flight: 'lobbed',
        puddle: { seconds: 4, radius: 0.75, dps: 15, poisonSeconds: 1 },
      },
    });
    expect(u.boneMinion).toEqual({ recharge: 1, hp: 150, armor: 0, speed: 0.6, melee: melee(20, 0.8) });
    expect(BALANCE.minionCap).toBe(3);
  });
});

describe('Desert Zombie', () => {
  it('its sand sets blind to 90 ticks on the plant it hits; the Peashooter misses on every shot until tick T+90', () => {
    const m = fresh();
    const pea = spawn(m, 'peashooter', 2, 0.5);
    const desert = spawn(m, 'desertZombie', 2, 4.4); // 3.9 ahead: within range 4
    pea.shotTimer = 999;
    desert.shotTimer = 0;
    const hitTick = { t: -1 };
    const landing = stepUntil(m, (events) => {
      hitTick.t = m.state.tick - 1;
      return eventsOf(events, 'projectileHit').some((e) => e.targetId === pea.id);
    });
    const T = hitTick.t;
    expect(eventsOf(landing, 'unitDamaged')).toEqual([{ type: 'unitDamaged', unitId: pea.id, amount: 10, hp: 290 }]);
    expect(eventsOf(landing, 'statusApplied')).toEqual([
      { type: 'statusApplied', unitId: pea.id, status: 'blind', ticks: 90, sourceId: desert.id },
    ]);
    expect(pea.blind).toBe(89); // the tick it was struck counts as its first
    lift(m, desert);
    while (m.state.tick < T + 90) {
      pea.shotTimer = 0;
      const events = m.step();
      expect(eventsOf(events, 'attackMissed')).toEqual([{ type: 'attackMissed', unitId: pea.id }]);
      expect(eventsOf(events, 'projectileSpawned')).toEqual([]);
    }
    expect(pea.blind).toBe(0);
    pea.shotTimer = 0;
    const again = m.step(); // tick T+90
    expect(eventsOf(again, 'attackMissed')).toEqual([]);
    expect(eventsOf(again, 'projectileSpawned')).toHaveLength(1);
  });
});

describe('Skeleton Archer', () => {
  it('stops 6 tiles from the nearest plant ahead and shoots it; when that plant falls it walks on', () => {
    const m = fresh();
    const target = wall(m, 1, 0.5);
    const archer = spawn(m, 'skeletonArcher', 1, 9.5);
    const step = 0.4 / 30;
    const walking = steps(m, 300);
    expect(archer.x).toBeLessThanOrEqual(6.5);
    expect(archer.x).toBeGreaterThan(6.5 - step);
    expect(archer.blocked).toBe(false);
    const x = archer.x;
    const shooting = steps(m, 100);
    expect(archer.x).toBe(x);
    const shots = eventsOf([...walking, ...shooting], 'unitAttacked').filter((e) => e.unitId === archer.id);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((e) => e.attack === 'shot' && e.targetId === target.id)).toBe(true);
    expect(eventsOf(shooting, 'unitDamaged').filter((e) => e.unitId === target.id).map((e) => e.amount)).toContain(28);

    target.hp = 28; // the next arrow fells it
    stepUntil(m, (events) => eventsOf(events, 'unitDied').some((e) => e.unitId === target.id));
    m.step();
    expect(archer.x).toBeCloseTo(x - step, 10);
  });
});

describe('Hot Topic', () => {
  /** A Hot Topic biting a wall in lane 0, its bite ready. */
  function scene() {
    const m = fresh();
    const prey = wall(m, 0, 2.5);
    const hot = spawn(m, 'hotTopic', 0, 2.9);
    hot.meleeTimer = 1;
    return { m, prey, hot };
  }

  it('each plant its bite brings to 0 gives it a stack: +20% of its base health to health and max, +20% to its bite', () => {
    const { m, prey, hot } = scene();
    prey.hp = 25;
    const kill = m.step();
    expect(eventsOf(kill, 'unitDamaged')).toEqual([{ type: 'unitDamaged', unitId: prey.id, amount: 25, hp: 0 }]);
    expect(abilities(kill)).toEqual([
      { type: 'abilityUsed', unitId: hot.id, ability: 'grow', lane: 0, x: 2.9, targetId: null },
    ]);
    expect(hot).toMatchObject({ stacks: 1, maxHp: 360, hp: 360 });

    const next = wall(m, 0, 2.5);
    hot.meleeTimer = 1;
    const bite = m.step();
    expect(eventsOf(bite, 'unitDamaged')).toEqual([{ type: 'unitDamaged', unitId: next.id, amount: 30, hp: 970 }]);
    expect(abilities(bite)).toEqual([]); // the plant still stands: no stack
    hot.hp = 100;
    next.hp = 1;
    hot.meleeTimer = 1;
    m.step();
    expect(hot).toMatchObject({ stacks: 2, maxHp: 420, hp: 160 }); // the hurt Hot Topic gains the same 60
  });

  it('stops at 5 stacks', () => {
    const { m, prey, hot } = scene();
    hot.stacks = 5;
    hot.maxHp = 900;
    hot.hp = 900;
    prey.hp = 1;
    const kill = m.step();
    expect(eventsOf(kill, 'unitDied')).toMatchObject([{ unitId: prey.id }]);
    expect(abilities(kill)).toEqual([]);
    expect(hot).toMatchObject({ stacks: 5, maxHp: 900, hp: 900 });
    const next = wall(m, 0, 2.5);
    hot.meleeTimer = 1;
    expect(eventsOf(m.step(), 'unitDamaged')).toEqual([{ type: 'unitDamaged', unitId: next.id, amount: 50, hp: 950 }]);
  });

  it('a bite on the plant base or a blind bite gives no stack', () => {
    const m = fresh();
    const hot = spawn(m, 'hotTopic', 3, 0.3);
    m.state.baseHp.plants = 10;
    hot.meleeTimer = 1;
    m.step();
    expect(hot.stacks).toBe(0);
    const n = fresh();
    const prey = wall(n, 0, 2.5);
    const blind = spawn(n, 'hotTopic', 0, 2.9);
    prey.hp = 1;
    blind.blind = 10;
    blind.meleeTimer = 1;
    expect(eventsOf(n.step(), 'attackMissed')).toHaveLength(1);
    expect(blind.stacks).toBe(0);
  });

  it('keeps its stacks through a merge: max health and bite grow by its level', () => {
    const { m, prey, hot } = scene();
    prey.hp = 25;
    m.step();
    expect(hot).toMatchObject({ stacks: 1, maxHp: 360, hp: 360 });
    const merged = m.step([merge('zombies', 'hotTopic', hot.id)]);
    expect(eventsOf(merged, 'unitMerged')).toEqual([{ type: 'unitMerged', unitId: hot.id, level: 2 }]);
    expect(hot).toMatchObject({ level: 2, stacks: 1, maxHp: 720, hp: 720 }); // 300 x 2 x 1.2
    const next = wall(m, 0, 2.5);
    next.hp = 60;
    hot.meleeTimer = 1;
    const kill = m.step();
    expect(eventsOf(kill, 'unitDamaged')).toEqual([{ type: 'unitDamaged', unitId: next.id, amount: 60, hp: 0 }]); // 25 x 2 x 1.2
    expect(hot).toMatchObject({ stacks: 2, maxHp: 840, hp: 840 }); // + 20% of 300 x 2
  });
});

describe('Cowboy Zombie', () => {
  it('every 9 s ties the strongest plant within 5 ahead for 90 ticks: highest level, then highest max health, then lowest id', () => {
    const m = fresh();
    const cowboy = spawn(m, 'cowboyZombie', 3, 6);
    const set = (u: Unit, level: number, maxHp: number) => { u.level = level; u.maxHp = maxHp; u.hp = maxHp; return u; };
    set(wall(m, 3, 1.5), 2, 1000); // weaker: same level, less health
    const strongest = set(wall(m, 3, 2.5), 2, 1200);
    set(wall(m, 3, 3.5), 1, 2000); // lower level
    set(wall(m, 3, 4.5), 2, 1200); // a tie with the strongest: the higher id loses
    set(wall(m, 3, 0.5), 5, 5000); // 5.5 away: out of reach
    set(wall(m, 4, 4.5), 5, 5000); // the next lane
    cowboy.shotTimer = 999;

    const first = m.step();

    expect(abilities(first)).toEqual([
      { type: 'abilityUsed', unitId: cowboy.id, ability: 'lasso', lane: 3, x: cowboy.x, targetId: strongest.id },
    ]);
    expect(eventsOf(first, 'statusApplied')).toEqual([
      { type: 'statusApplied', unitId: strongest.id, status: 'tied', ticks: 90, sourceId: cowboy.id },
    ]);
    expect(strongest.tied).toBe(89);
    expect(cowboy.abilityTimer).toBe(seconds(9));
    expect(abilities(steps(m, seconds(9) - 1))).toEqual([]);
    expect(abilities(m.step(), 'lasso')).toHaveLength(1); // ready again 9 s later (it has walked on, so whom it ties may differ)
  });

  it('with no plant within 5 ahead its timer stays at 0', () => {
    const m = fresh();
    const cowboy = spawn(m, 'cowboyZombie', 0, 9);
    wall(m, 0, 0.5);
    expect(abilities(steps(m, 30))).toEqual([]);
    expect(cowboy.abilityTimer).toBe(0);
  });

  it('a tied Peashooter does not shoot until the tie runs out', () => {
    const m = fresh();
    const cowboy = spawn(m, 'cowboyZombie', 2, 5);
    const pea = spawn(m, 'peashooter', 2, 0.5);
    cowboy.shotTimer = 999;
    pea.shotTimer = 999;
    m.step();
    expect(pea.tied).toBe(89);
    lift(m, cowboy);
    pea.shotTimer = 0;
    for (let i = 0; i < 89; i++) expect(eventsOf(m.step(), 'projectileSpawned')).toEqual([]);
    expect(eventsOf(m.step(), 'projectileSpawned')).toHaveLength(1);
  });
});

describe('Necromancer', () => {
  it('holds 4 tiles from the nearest plant ahead', () => {
    const m = fresh();
    wall(m, 2, 0.5);
    const necro = spawn(m, 'necromancer', 2, 9.5);
    steps(m, 600);
    expect(necro.x).toBeLessThanOrEqual(4.5);
    expect(necro.x).toBeGreaterThan(4.5 - 0.3 / 30);
    expect(necro.blocked).toBe(false);
  });

  it('every 2 s heals each other standing zombie within 1.5 by 40, never above its max, reporting only what it gained', () => {
    const m = fresh();
    wall(m, 2, 2); // 4 ahead: the Necromancer holds where it is
    const necro = spawn(m, 'necromancer', 2, 6);
    necro.abilityTimer = 9999;
    necro.hp = 100; // it never heals itself
    const near = still(m, 2, 7); // 1 away
    const diagonal = still(m, 3, 7); // sqrt(2) = 1.41
    const off = still(m, 3, 7.2); // 1.56: out
    const full = still(m, 2, 6.5); // not hurt: no event
    const twoLanes = still(m, 4, 6); // 2 away
    near.hp = 100;
    diagonal.hp = 980;
    off.hp = 100;
    twoLanes.hp = 100;

    const first = m.step();

    expect(abilities(first)).toEqual([
      { type: 'abilityUsed', unitId: necro.id, ability: 'heal', lane: 2, x: necro.x, targetId: null },
    ]);
    expect(eventsOf(first, 'unitHealed')).toEqual([
      { type: 'unitHealed', unitId: near.id, amount: 40, hp: 140 },
      { type: 'unitHealed', unitId: diagonal.id, amount: 20, hp: 1000 },
    ]);
    expect([necro.hp, off.hp, full.hp, twoLanes.hp]).toEqual([100, 100, 1000, 100]);
    expect(necro.auraTimer).toBe(seconds(2));
    expect(eventsOf(steps(m, seconds(2) - 1), 'unitHealed')).toEqual([]);
    expect(eventsOf(m.step(), 'unitHealed')).toEqual([{ type: 'unitHealed', unitId: near.id, amount: 40, hp: 180 }]);
  });

  it('heals by the special curve of its level', () => {
    const m = fresh();
    const necro = spawn(m, 'necromancer', 2, 6);
    necro.level = 3;
    const near = still(m, 2, 6.5);
    near.hp = 100;
    expect(eventsOf(m.step(), 'unitHealed')).toEqual([{ type: 'unitHealed', unitId: near.id, amount: 120, hp: 220 }]);
  });

  it('every 10 s raises a Bone Minion at its own x, lane and level, spent 0, owned by it', () => {
    const m = fresh();
    const necro = spawn(m, 'necromancer', 1, 6);
    expect(necro.abilityTimer).toBe(seconds(10));
    expect(abilities(steps(m, seconds(10) - 1), 'raise')).toEqual([]);
    m.step([merge('zombies', 'necromancer', necro.id)]); // level 2 before it raises
    necro.abilityTimer = 1;
    const id = m.state.nextId;
    const raised = m.step();
    expect(raised.filter((e) => e.type === 'abilityUsed' || e.type === 'unitSpawned')).toEqual([
      { type: 'abilityUsed', unitId: necro.id, ability: 'raise', lane: 1, x: necro.x, targetId: id },
      { type: 'unitSpawned', unitId: id, key: 'boneMinion', faction: 'zombies', lane: 1, x: necro.x },
    ]);
    const minion = m.state.units.find((u) => u.id === id);
    expect(minion).toMatchObject({
      key: 'boneMinion', faction: 'zombies', lane: 1, x: necro.x, level: 2, hp: 300, maxHp: 300, spent: 0, ownerId: necro.id,
    });
    expect(necro.abilityTimer).toBe(seconds(10));
  });

  it('keeps at most 3 of its minions standing; it raises again when one falls', () => {
    const m = fresh();
    const necro = spawn(m, 'necromancer', 1, 6);
    const others = spawn(m, 'necromancer', 3, 6);
    others.abilityTimer = 9999;
    spawnMinion(m.state, m.balance, 1, 6, 1, others.id, []); // another Necromancer's: not counted
    spawnMinion(m.state, m.balance, 1, 6, 1, null, []); // nobody's: not counted
    const raisedIds: number[] = [];
    for (let i = 0; i < 4; i++) {
      necro.abilityTimer = 0;
      for (const e of abilities(m.step(), 'raise')) raisedIds.push(e.targetId ?? -1);
    }
    expect(raisedIds).toHaveLength(3);
    expect(m.balance.minionCap).toBe(3);
    expect(necro.abilityTimer).toBe(0); // at the cap it waits, ready
    const fallen = m.state.units.find((u) => u.id === raisedIds[0]);
    if (!fallen) throw new Error('no minion');
    fallen.hp = 0; // down: no longer counted, so it raises on this very step
    const refill = m.step();
    expect(abilities(refill, 'raise')).toHaveLength(1);
    expect(eventsOf(refill, 'unitDied')).toMatchObject([{ unitId: fallen.id }]);
  });
});

describe('Bone Minion', () => {
  it('pays no bounty, cannot be merged into, and is not a card', () => {
    const m = fresh();
    const necro = spawn(m, 'necromancer', 0, 8);
    necro.abilityTimer = 9999;
    const minion = spawnMinion(m.state, m.balance, 0, 8, 1, necro.id, []);
    const rejected = m.step([
      merge('zombies', 'necromancer', minion.id),
      place('zombies', 'boneMinion' as CardKey, 0, 9),
      merge('zombies', 'boneMinion' as CardKey, minion.id),
    ]);
    expect(eventsOf(rejected, 'commandRejected').map((e) => e.reason)).toEqual(['wrong-type', 'not-in-hand', 'not-in-hand']);
    const plants = m.state.players.plants.energy;
    minion.hp = 0;
    const died = m.step();
    expect(eventsOf(died, 'unitDied')).toMatchObject([{ unitId: minion.id, key: 'boneMinion', cause: 'damage' }]);
    expect(eventsOf(died, 'energyGained')).toEqual([]);
    expect(m.state.players.plants.energy).toBe(plants);
  });

  it('outlives its Necromancer and goes on walking', () => {
    const m = fresh();
    const necro = spawn(m, 'necromancer', 0, 8);
    necro.abilityTimer = 1;
    m.step();
    const minion = m.state.units.find((u) => u.key === 'boneMinion');
    if (!minion) throw new Error('no minion');
    necro.hp = 0;
    const died = m.step();
    expect(eventsOf(died, 'unitDied')).toMatchObject([{ unitId: necro.id }]);
    expect(m.state.units).toContain(minion);
    const x = minion.x;
    m.step();
    expect(minion.x).toBeCloseTo(x - 0.6 / 30, 10);
    expect(minion.ownerId).toBe(necro.id);
  });

  it('a Necromancer down when the abilities stage runs raises nothing; one a projectile fells later that tick has raised (review-focus 1)', () => {
    // Down first: the plant base's defence strikes it before abilities, on the tick its raise is due.
    const m = fresh();
    const necro = spawn(m, 'necromancer', 0, 0.3);
    necro.abilityTimer = 1;
    necro.hp = 50;
    necro.meleeTimer = 99;
    const first = m.step();
    expect(eventsOf(first, 'baseStruck')).toEqual([{ type: 'baseStruck', lane: 0, targetId: necro.id }]);
    expect(abilities(first)).toEqual([]);
    expect(eventsOf(first, 'unitSpawned')).toEqual([]);
    expect(eventsOf(first, 'unitDied')).toMatchObject([{ unitId: necro.id }]);
    expect(m.state.units.some((u) => u.key === 'boneMinion')).toBe(false);

    // Felled later: a pea hits it in the projectile stage, after it raised.
    const n = fresh();
    const pea = spawn(n, 'peashooter', 0, 1.5);
    const late = spawn(n, 'necromancer', 0, 1.9);
    late.abilityTimer = 2;
    late.meleeTimer = 99;
    pea.shotTimer = 0;
    expect(eventsOf(n.step(), 'projectileSpawned')).toHaveLength(1);
    late.hp = 1;
    const second = n.step();
    expect(second.map((e) => e.type).filter((t) => ['abilityUsed', 'unitSpawned', 'projectileHit', 'unitDied'].includes(t))).toEqual([
      'abilityUsed', 'unitSpawned', 'projectileHit', 'unitDied',
    ]);
    expect(abilities(second, 'raise')).toHaveLength(1);
    expect(n.state.units.filter((u) => u.key === 'boneMinion')).toMatchObject([{ ownerId: late.id }]);
  });
});

describe('Trident Zombie', () => {
  it('one throw damages the first three plants in the lane and not the fourth', () => {
    const m = fresh();
    const walls = [1.5, 2.5, 3.5, 4.5].map((x) => wall(m, 2, x));
    const trident = spawn(m, 'tridentZombie', 2, 8);
    trident.shotTimer = 0;
    const thrown = m.step();
    expect(eventsOf(thrown, 'projectileSpawned')).toMatchObject([{ kind: 'trident', flight: 'piercing' }]);
    trident.shotTimer = 9999;
    const flight = steps(m, 120);
    expect(m.state.projectiles).toEqual([]);
    expect(eventsOf(flight, 'unitDamaged').map((e) => [e.unitId, e.amount])).toEqual(
      [walls[3]!, walls[2]!, walls[1]!].map((w) => [w.id, 70]),
    );
    expect(walls[0]!.hp).toBe(1000);
  });

  it('from x > 3.5 it never throws at the plant base; from 3.5 it does', () => {
    const m = fresh();
    const far = spawn(m, 'tridentZombie', 0, 3.8);
    far.shotTimer = 0;
    const events = steps(m, 30); // walks 0.2 tiles: still beyond 3.5
    expect(far.x).toBeGreaterThan(3.5);
    expect(eventsOf(events, 'unitAttacked')).toEqual([]);
    expect(eventsOf(events, 'projectileSpawned')).toEqual([]);
    const n = fresh();
    const near = spawn(n, 'tridentZombie', 0, 3.5);
    near.shotTimer = 0;
    expect(eventsOf(n.step(), 'unitAttacked')).toEqual([
      { type: 'unitAttacked', unitId: near.id, attack: 'shot', targetId: null, targetBase: 'plants' },
    ]);
  });
});

describe('Brain Rot', () => {
  /** A Brain Rot at 7.5 in lane 2 aimed at a wall at 3.5, with walls 0.7 and 0.8 behind it and one in the next lane. */
  function scene(level = 1) {
    const m = fresh();
    const target = wall(m, 2, 3.5);
    const inside = wall(m, 2, 2.8); // 0.7 from the landing point
    const outside = wall(m, 2, 2.7); // 0.8
    const nextLane = wall(m, 3, 3.5);
    const rot = spawn(m, 'brainRot', 2, 7.5);
    rot.level = level;
    rot.shotTimer = 0;
    m.step();
    rot.shotTimer = 99_999; // one throw only
    return { m, rot, target, inside, outside, nextLane };
  }
  const landed = (events: SimEvent[]) => eventsOf(events, 'projectileHit').length > 0;

  it('lands on its target for 30 and leaves a puddle for 120 ticks that poisons plants within 0.75 at 15 dps', () => {
    const { m, target, inside, outside, nextLane } = scene();
    const landing = stepUntil(m, landed);
    expect(eventsOf(landing, 'projectileHit')).toMatchObject([{ targetId: target.id, x: 3.5 }]);
    const [hit, ...poison] = eventsOf(landing, 'unitDamaged');
    expect(hit).toEqual({ type: 'unitDamaged', unitId: target.id, amount: 30, hp: 970 });
    expect(poison.every((e) => e.amount === 15)).toBe(true); // a whole second: the new poison deals at once
    const hazard = m.state.hazards[0];
    if (!hazard) throw new Error('no puddle');
    expect(eventsOf(landing, 'hazardSpawned')).toEqual([
      { type: 'hazardSpawned', hazardId: hazard.id, kind: 'rot', lane: 2, x: 3.5, radius: 0.75, ticks: 120 },
    ]);
    expect(hazard).toMatchObject({ kind: 'rot', faction: 'zombies', lane: 2, x: 3.5, radius: 0.75, dps: 15, ticksLeft: 119, poisonTicks: 30 });
    expect(eventsOf(landing, 'statusApplied')).toEqual([
      { type: 'statusApplied', unitId: target.id, status: 'poison', ticks: 30, sourceId: null },
      { type: 'statusApplied', unitId: inside.id, status: 'poison', ticks: 30, sourceId: null },
    ]);
    for (const u of [outside, nextLane]) expect(u.poison).toBe(0);

    const during: SimEvent[] = [];
    for (let i = 0; i < 118; i++) {
      during.push(...m.step());
      for (const u of [target, inside]) {
        expect(u.poison).toBeGreaterThanOrEqual(29); // topped up to 30 each tick, then counted down
        expect(u.poisonDps).toBe(15);
      }
    }
    expect(eventsOf(during, 'statusApplied')).toEqual([]); // topping it up is silent
    expect(eventsOf(during, 'hazardEnded')).toEqual([]);
    const damage = eventsOf(during, 'unitDamaged').filter((e) => e.unitId === inside.id);
    expect(damage.length).toBeGreaterThanOrEqual(3);
    expect(damage.every((e) => e.amount === 15)).toBe(true);
    expect(outside.hp).toBe(1000);
    const ended = m.step(); // the 120th tick of the puddle
    expect(eventsOf(ended, 'hazardEnded')).toEqual([{ type: 'hazardEnded', hazardId: hazard.id }]);
    expect(m.state.hazards).toEqual([]);
    const after = steps(m, 30);
    expect(eventsOf(after, 'statusEnded').map((e) => e.unitId)).toEqual([target.id, inside.id]);
  });

  it('whose target fell in flight still lands where it was aimed and leaves its puddle', () => {
    const { m, target, inside } = scene();
    target.hp = 0;
    const landing = stepUntil(m, landed);
    expect(eventsOf(landing, 'projectileHit')).toMatchObject([{ targetId: null, x: 3.5 }]);
    expect(eventsOf(landing, 'hazardSpawned')).toMatchObject([{ x: 3.5, ticks: 120 }]);
    expect(inside.poison).toBe(29);
  });

  it('poisons by the special curve of the thrower\'s level', () => {
    const { m, inside } = scene(2);
    stepUntil(m, landed);
    expect(m.state.hazards[0]?.dps).toBe(30);
    expect(inside.poisonDps).toBe(30);
  });

  it('a snapshot with a live puddle restores to the hash of the unbroken match', () => {
    const { m } = scene();
    stepUntil(m, landed);
    steps(m, 20);
    expect(m.state.hazards).toHaveLength(1);
    const restored = Match.restore(m.snapshot(), m.balance);
    const a = steps(m, 200);
    const b = steps(restored, 200);
    expect(eventsOf(a, 'hazardEnded')).toHaveLength(1);
    expect(b).toEqual(a);
    expect(restored.hash()).toBe(m.hash());
  });
});

describe('statuses cross sides', () => {
  it('butter stuns a Necromancer: no heal, no raise, its timers stand still', () => {
    const b = table();
    const kernel = b.units.kernelPult?.shot?.status;
    if (!kernel) throw new Error('no butter');
    kernel.chance = 1; // every shot is butter
    const m = fresh(b);
    const pult = spawn(m, 'kernelPult', 2, 0.5);
    const necro = spawn(m, 'necromancer', 2, 4.4); // holding already
    const ally = still(m, 3, 4.4);
    pult.shotTimer = 0;
    stepUntil(m, (events) => eventsOf(events, 'statusApplied').some((e) => e.unitId === necro.id && e.status === 'stun'));
    expect(necro.stun).toBe(59);
    lift(m, pult);
    necro.auraTimer = 1;
    necro.abilityTimer = 1;
    ally.hp = 100;
    for (let i = 0; i < 59; i++) {
      const events = m.step();
      expect(abilities(events)).toEqual([]);
      expect(eventsOf(events, 'unitHealed')).toEqual([]);
      expect([necro.auraTimer, necro.abilityTimer]).toEqual([1, 1]);
    }
    const free = m.step();
    expect(abilities(free).map((e) => e.ability)).toEqual(['heal', 'raise']);
  });

  it('burn ticks on a Skeleton Warrior whose shield blocked nothing', () => {
    const m = fresh();
    const shooter = spawn(m, 'peashooter', 0, 0.5);
    spawn(m, 'torchwood', 0, 2.5);
    const skeleton = spawn(m, 'skeletonWarrior', 0, 6.5);
    skeleton.abilityTimer = 9999; // its shield is down
    shooter.shotTimer = 0;
    const landing = stepUntil(m, (events) => eventsOf(events, 'projectileHit').length > 0);
    expect(eventsOf(landing, 'projectileHit')).toMatchObject([{ targetId: skeleton.id, burning: true, blocked: false }]);
    expect(eventsOf(landing, 'statusApplied')).toEqual([
      { type: 'statusApplied', unitId: skeleton.id, status: 'burn', ticks: 90, sourceId: shooter.id },
    ]);
    shooter.shotTimer = 9999;
    const hp = skeleton.hp;
    const burning = stepUntil(m, (events) => eventsOf(events, 'unitDamaged').length > 0);
    expect(m.state.tick % 30).toBe(1); // dealt on the whole second, then the tick count moved on
    expect(eventsOf(burning, 'unitDamaged')).toEqual([{ type: 'unitDamaged', unitId: skeleton.id, amount: 10, hp: hp - 10 }]);
  });
});

describe('fuzz: the whole roster', () => {
  const SEEDS = 200;
  const STEPS = 1200;
  const STATUSES = ['stun', 'blind', 'tied', 'poison', 'burn'] as const;

  it(`${SEEDS} seeded matches with all 20 cards and random legal commands keep every invariant, and minions come and go`, () => {
    const seen = new Map<string, number>();
    const count = (key: string, n = 1) => seen.set(key, (seen.get(key) ?? 0) + n);
    for (let seed = 1; seed <= SEEDS; seed++) {
      const config = defaultConfig(seed);
      config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
      config.startEnergy = { plants: 600, zombies: 600 };
      const m = new Match(config); // the shipped numbers
      const rng = { rng: (Math.imul(seed, 0x9e3779b1) ^ 0x5bd1e995) >>> 0 };
      for (let n = 0; n < STEPS && m.state.winner === null; n++) {
        const commands = [];
        for (const faction of ['plants', 'zombies'] as const) {
          if (randomInt(rng, 12) !== 0) continue;
          const cmd = randomLegal(m, faction, rng);
          if (cmd) commands.push(cmd);
        }
        const events = m.step(commands);
        for (const e of events) {
          if (e.type === 'abilityUsed') count(e.ability);
          else if (e.type === 'commandRejected') throw new Error(`seed ${seed}: a legal command was refused (${e.reason})`);
          else if (e.type === 'unitDied' && e.key === 'boneMinion') count('minion died');
          else count(e.type);
        }
        const s = m.state;
        for (const faction of ['plants', 'zombies'] as const) {
          if (!Number.isInteger(s.players[faction].energy)) throw new Error(`seed ${seed} tick ${s.tick}: ${faction} energy ${s.players[faction].energy}`);
        }
        for (const u of s.units) {
          if (!(u.hp <= u.maxHp)) throw new Error(`seed ${seed} tick ${s.tick}: ${u.key} ${u.id} hp ${u.hp} above max ${u.maxHp}`);
          for (const k of STATUSES) if (!(u[k] >= 0)) throw new Error(`seed ${seed} tick ${s.tick}: ${u.key} ${u.id} ${k} ${u[k]}`);
          if (!(u.poisonDps >= 0 && u.burnDps >= 0)) throw new Error(`seed ${seed}: negative dps on ${u.id}`);
        }
        for (const h of s.hazards) if (!(h.ticksLeft > 0)) throw new Error(`seed ${seed}: a spent hazard stayed`);
      }
    }
    // Coverage: every new ability, minions raised and fallen, puddles, statuses and misses all came up.
    for (const key of ['raise', 'heal', 'lasso', 'grow', 'minion died', 'hazardSpawned', 'hazardEnded', 'attackMissed', 'unitHealed', 'unitMerged']) {
      expect(seen.get(key) ?? 0, key).toBeGreaterThan(0);
    }
  });
});
