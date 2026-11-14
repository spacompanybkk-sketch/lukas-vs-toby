import { describe, expect, it } from 'vitest';
import { cloneBalance, seconds } from '../../src/data/balance';
import { tickEndgame } from '../../src/sim/endgame';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { Command, CommandRejection, Projectile, SimEvent } from '../../src/sim/types';
import { BASE_STOP_X } from '../../src/sim/types';
import { classicBalance, eventsOf, merge, place, remove } from './helpers';

/** The numbers these rules tests were written for (see `classicBalance`). */
const BALANCE = classicBalance();

/**
 * Income off, plenty of energy, sudden death as given, and bases of 3000 in both the config and
 * the balance table (the sudden-death drain is a share of the table's `baseHp`), which the drain
 * figures below are worked out for.
 */
function fresh(suddenDeath = true): Match {
  const balance = cloneBalance(BALANCE);
  balance.baseHp = 3000;
  const config = defaultConfig(5, balance);
  config.startEnergy = { plants: 1000, zombies: 1000 };
  config.incomeMultiplier = { plants: 0, zombies: 0 };
  config.suddenDeath = suddenDeath;
  return new Match(config, balance);
}

/** A Brain Eater standing at the plant base whose bite is ready during the next step. */
function biterAtBase(m: Match, lane = 2): void {
  const z = spawnUnit(m.state, BALANCE, 'brainEater', lane, BASE_STOP_X);
  z.meleeTimer = 1; // the economy stage counts it to 0, then it bites for 40
}

/** A pea about to reach the zombie base during the next step, for 20 × 0.5 = 10. */
function peaAtZombieBase(m: Match, lane = 0): void {
  const p: Projectile = {
    id: m.state.nextId, kind: 'pea', faction: 'plants', lane, x: 9.9, speed: 0.2, damage: 20,
    ownerId: 0, spawnTick: m.state.tick - 1,
    flight: 'straight', sourceKey: 'peashooter', level: 1, targetId: null, targetX: null, pierceLeft: 0, hitIds: [], burning: false, burnDps: 0, burnTicks: 0, fadeX: null,
  };
  m.state.nextId += 1;
  m.state.projectiles.push(p);
}

const SUDDEN_DEATH_TICK = seconds(BALANCE.suddenDeath.startSeconds);

describe('the winner', () => {
  it("plant base to 0: winner 'zombies' and one matchEnded", () => {
    const m = fresh();
    m.state.baseHp.plants = 40;
    biterAtBase(m);

    const events = m.step();

    expect(m.state.baseHp.plants).toBe(0);
    expect(m.state.winner).toBe('zombies');
    expect(eventsOf(events, 'matchEnded')).toEqual([{ type: 'matchEnded', winner: 'zombies' }]);
    expect(events.at(-1)).toEqual({ type: 'matchEnded', winner: 'zombies' }); // after the damage that decided it
    for (let i = 0; i < 100; i++) expect(eventsOf(m.step(), 'matchEnded')).toEqual([]);
  });

  it("zombie base below 0: winner 'plants'", () => {
    const m = fresh();
    m.state.baseHp.zombies = 5;
    peaAtZombieBase(m);

    const events = m.step();

    expect(m.state.baseHp.zombies).toBe(-5);
    expect(m.state.winner).toBe('plants');
    expect(eventsOf(events, 'matchEnded')).toEqual([{ type: 'matchEnded', winner: 'plants' }]);
  });

  it("both bases to 0 on one tick: 'draw'", () => {
    const m = fresh();
    m.state.baseHp.plants = 40;
    m.state.baseHp.zombies = 10;
    biterAtBase(m);
    peaAtZombieBase(m);

    const events = m.step();

    expect(m.state.baseHp).toEqual({ plants: 0, zombies: 0 });
    expect(m.state.winner).toBe('draw');
    expect(eventsOf(events, 'matchEnded')).toEqual([{ type: 'matchEnded', winner: 'draw' }]);
  });

  it('nobody wins while both bases stand, even at a sliver of health', () => {
    const m = fresh();
    m.state.baseHp.plants = 41;
    biterAtBase(m);
    const events = m.step();
    expect(m.state.baseHp.plants).toBe(1);
    expect(m.state.winner).toBeNull();
    expect(eventsOf(events, 'matchEnded')).toEqual([]);
  });

  it('after the end, step returns [] and the hash stops changing, and check says match-over', () => {
    const m = fresh();
    m.state.baseHp.plants = 40;
    biterAtBase(m);
    spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5); // things that would otherwise keep happening
    spawnUnit(m.state, BALANCE, 'sunflower', 1, 0.5);
    spawnUnit(m.state, BALANCE, 'veryFastWalker', 3, 9);
    m.step();
    expect(m.state.winner).toBe('zombies');

    const hash = m.hash();
    const tick = m.state.tick;
    const commands: Command[] = [
      place('plants', 'peashooter', 4, 4), place('zombies', 'brainEater', 4, 0),
      merge('plants', 'peashooter', 2), remove('plants', 2),
    ];
    for (let i = 0; i < 400; i++) expect(m.step(i % 2 === 0 ? commands : [])).toEqual([]);

    expect(m.hash()).toBe(hash);
    expect(m.state.tick).toBe(tick);
    for (const cmd of commands) expect(m.check(cmd)).toBe('match-over');
  });

  it('tickEndgame does nothing once a winner is set, so a match cannot end twice', () => {
    const m = fresh();
    m.state.winner = 'plants';
    m.state.baseHp.plants = -50;
    m.state.tick = SUDDEN_DEATH_TICK + 100;
    const events: SimEvent[] = [];
    tickEndgame(m.state, m.balance, events);
    expect(events).toEqual([]);
    expect(m.state.winner).toBe('plants');
    expect(m.state.baseHp.plants).toBe(-50);
  });
});

describe('sudden death', () => {
  it('with two idle players suddenDeath is emitted at tick 10,800 and the match ends at or before tick 14,400', () => {
    const m = new Match(defaultConfig(3, BALANCE), BALANCE);
    const sudden: number[] = [];
    const ended: number[] = [];
    let firstDrainTick = -1;
    while (m.state.winner === null && m.state.tick <= 14_400) {
      const tick = m.state.tick;
      const events = m.step();
      if (eventsOf(events, 'suddenDeath').length > 0) sudden.push(tick);
      if (eventsOf(events, 'matchEnded').length > 0) ended.push(tick);
      if (firstDrainTick < 0 && eventsOf(events, 'baseDamaged').length > 0) firstDrainTick = tick;
    }

    expect(SUDDEN_DEATH_TICK).toBe(10_800);
    expect(sudden).toEqual([10_800]);
    expect(firstDrainTick).toBe(10_800); // the drain starts on the same step
    expect(m.state.suddenDeath).toBe(true);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toBeLessThanOrEqual(14_400);
    expect(m.state.winner).toBe('draw'); // both bases drained alike and fell together
  });

  it('is off before its tick: the flag stays false and no base is touched', () => {
    const m = fresh();
    m.state.tick = SUDDEN_DEATH_TICK - 5;
    for (let i = 0; i < 5; i++) {
      const events = m.step();
      expect(events).toEqual([]);
    }
    expect(m.state.suddenDeath).toBe(false);
    expect(m.state.baseHp).toEqual({ plants: 3000, zombies: 3000 });

    const events = m.step(); // the step at tick 10,800
    expect(m.state.suddenDeath).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['suddenDeath', 'baseDamaged', 'baseDamaged']);
  });

  it('drains both bases by the same amount, lane null, growing with the seconds since it began', () => {
    const m = fresh();
    m.state.tick = SUDDEN_DEATH_TICK;

    const first = eventsOf(m.step(), 'baseDamaged');
    // 3000 × (0.005 + 0.0001 × 0) / 30 = 0.5
    expect(first).toEqual([
      { type: 'baseDamaged', faction: 'plants', amount: 0.5, hp: 2999.5, lane: null },
      { type: 'baseDamaged', faction: 'zombies', amount: 0.5, hp: 2999.5, lane: null },
    ]);

    while (m.state.tick < SUDDEN_DEATH_TICK + seconds(10)) m.step();
    const later = eventsOf(m.step(), 'baseDamaged'); // 10 s in: 3000 × (0.005 + 0.001) / 30 = 0.6
    expect(later).toHaveLength(2);
    expect(later[0]!.amount).toBeCloseTo(0.6, 12);
    expect(later[1]!.amount).toBe(later[0]!.amount);
    expect(later.map((e) => e.lane)).toEqual([null, null]);
    expect(m.state.baseHp.plants).toBe(m.state.baseHp.zombies);
  });

  it('is a function of the tick: a state set up past the start emits the event once and drains at its own seconds', () => {
    const m = fresh();
    m.state.tick = SUDDEN_DEATH_TICK + seconds(40);
    const first = m.step();
    expect(eventsOf(first, 'suddenDeath')).toHaveLength(1);
    // 40 s in: 3000 × (0.005 + 0.0001 × 40) / 30 = 0.9
    expect(eventsOf(first, 'baseDamaged').map((e) => e.amount)).toEqual([0.9, 0.9].map((v) => expect.closeTo(v, 12)));
    const second = m.step();
    expect(eventsOf(second, 'suddenDeath')).toEqual([]);
    expect(eventsOf(second, 'baseDamaged')).toHaveLength(2);
  });

  it('drains nothing when the config has it off, whatever the flag says', () => {
    const m = fresh(false);
    m.state.suddenDeath = true;
    m.state.tick = SUDDEN_DEATH_TICK + 300;
    expect(m.step()).toEqual([]);
    expect(m.state.baseHp).toEqual({ plants: 3000, zombies: 3000 });
  });

  it('takes its numbers from the balance table', () => {
    const b = cloneBalance(BALANCE);
    b.suddenDeath = { startSeconds: 10, baseRate: 0.03, growthPerSecond: 0.06 };
    b.baseHp = 600;
    const m = new Match(defaultConfig(1, b), b);
    while (m.state.tick < seconds(10) + seconds(1)) {
      const tick = m.state.tick;
      const events = m.step();
      if (tick < 300) expect(eventsOf(events, 'suddenDeath')).toEqual([]);
      if (tick === 300) expect(eventsOf(events, 'suddenDeath')).toHaveLength(1);
    }
    const last = eventsOf(m.step(), 'baseDamaged'); // 1 s in: 600 × (0.03 + 0.06) / 30 = 1.8
    expect(last[0]!.amount).toBeCloseTo(1.8, 12);
  });

  it('the healthier base wins', () => {
    const m = fresh();
    m.state.baseHp.zombies = 2000;
    m.state.tick = SUDDEN_DEATH_TICK;
    let ended: SimEvent[] = [];
    for (let i = 0; i < 10_000 && m.state.winner === null; i++) ended = eventsOf(m.step(), 'matchEnded');
    expect(m.state.winner).toBe('plants');
    expect(ended).toEqual([{ type: 'matchEnded', winner: 'plants' }]);
    expect(m.state.baseHp.zombies).toBeLessThanOrEqual(0);
    expect(m.state.baseHp.plants).toBeGreaterThan(0);
    // Both lost the same amount every tick, so the 1,000 head start is still there.
    expect(m.state.baseHp.plants - m.state.baseHp.zombies).toBeCloseTo(1000, 6);
  });

  it('with suddenDeath: false an idle match is still running at tick 14,400', () => {
    const config = { ...defaultConfig(3, BALANCE), suddenDeath: false };
    const m = new Match(config, BALANCE);
    let sudden = 0;
    while (m.state.tick < 14_400) sudden += eventsOf(m.step(), 'suddenDeath').length;
    expect(m.state.tick).toBe(14_400);
    expect(sudden).toBe(0);
    expect(m.state.suddenDeath).toBe(false);
    expect(m.state.winner).toBeNull();
    expect(m.state.baseHp).toEqual(config.baseHp);
  });
});

describe('the shovel', () => {
  it("removing a plant emits unitDied with cause 'shovel' and pays nothing", () => {
    const m = fresh();
    const pea = spawnUnit(m.state, BALANCE, 'peashooter', 1, 2.5);
    m.step([merge('plants', 'peashooter', pea.id)]); // level 2, spent 200: nothing of it comes back
    const energy = { plants: m.state.players.plants.energy, zombies: m.state.players.zombies.energy };
    const cmd = remove('plants', pea.id);
    expect(m.check(cmd)).toBeNull();

    const events = m.step([cmd]);

    expect(eventsOf(events, 'unitDied')).toEqual([{
      type: 'unitDied', unitId: pea.id, key: 'peashooter', faction: 'plants', lane: 1, x: 2.5, level: 2, cause: 'shovel',
    }]);
    expect(eventsOf(events, 'energyGained')).toEqual([]);
    expect(eventsOf(events, 'commandRejected')).toEqual([]);
    expect(m.state.units).toEqual([]);
    expect(m.state.players.plants.energy).toBe(energy.plants);
    expect(m.state.players.zombies.energy).toBe(energy.zombies);
  });

  it('removing a Walnut Bomb next to zombies sets off no blast', () => {
    const m = fresh();
    const nut = spawnUnit(m.state, BALANCE, 'walnutBomb', 2, 4.5);
    const near = spawnUnit(m.state, BALANCE, 'veryFastWalker', 2, 5);
    const beside = spawnUnit(m.state, BALANCE, 'veryFastWalker', 3, 4.5);

    const events = m.step([remove('plants', nut.id)]);

    expect(eventsOf(events, 'unitDied').map((e) => [e.unitId, e.cause])).toEqual([[nut.id, 'shovel']]);
    expect(eventsOf(events, 'explosion')).toEqual([]);
    expect(eventsOf(events, 'unitDamaged')).toEqual([]);
    expect(near.hp).toBe(180);
    expect(beside.hp).toBe(180);
    expect(m.state.players.zombies.energy).toBe(1000);
  });

  it('frees the tile for a plant placed later in the same step', () => {
    const m = fresh();
    const sun = spawnUnit(m.state, BALANCE, 'sunflower', 0, 3.5);
    const events = m.step([remove('plants', sun.id), place('plants', 'peashooter', 0, 3)]);
    expect(eventsOf(events, 'commandRejected')).toEqual([]);
    expect(m.state.units.map((u) => [u.key, u.lane, u.x])).toEqual([['peashooter', 0, 3.5]]);
  });

  it('a removed plant no longer holds up the zombie it was blocking', () => {
    const m = fresh();
    const nut = spawnUnit(m.state, BALANCE, 'walnutBomb', 2, 4.5);
    const z = spawnUnit(m.state, BALANCE, 'brainEater', 2, 5);
    m.step();
    expect(z.blocked).toBe(true);
    const x = z.x;
    m.step([remove('plants', nut.id)]);
    expect(z.blocked).toBe(false);
    expect(z.x).toBeLessThan(x);
  });

  const cases: Array<[CommandRejection, string, (m: Match) => Command]> = [
    ['match-over', 'a winner is set', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      m.state.winner = 'draw';
      return remove('plants', pea.id);
    }],
    ['plants-only', 'zombies remove a plant', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      return remove('zombies', pea.id);
    }],
    ['plants-only', 'zombies remove their own zombie', (m) => {
      const z = spawnUnit(m.state, BALANCE, 'brainEater', 0, 7);
      return remove('zombies', z.id);
    }],
    ['no-target', 'an id never handed out', () => remove('plants', 999)],
    ['no-target', 'a unit already at 0 hp', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      pea.hp = 0;
      return remove('plants', pea.id);
    }],
    ['no-target', 'a plant removed one step earlier', (m) => {
      const pea = spawnUnit(m.state, BALANCE, 'peashooter', 0, 0.5);
      m.step([remove('plants', pea.id)]);
      return remove('plants', pea.id);
    }],
    ['not-yours', 'plants dig up a zombie', (m) => {
      const z = spawnUnit(m.state, BALANCE, 'brainEater', 0, 7);
      return remove('plants', z.id);
    }],
  ];

  it.each(cases)('rejects %s: %s', (reason, _name, setup) => {
    const m = fresh();
    const cmd = setup(m);
    // Standing units only: one set to 0 hp by a case is cleared away by the step's deaths stage.
    const ids = m.state.units.filter((u) => u.hp > 0).map((u) => u.id);

    expect(m.check(cmd)).toBe(reason);
    const events = m.step([cmd]);

    if (reason === 'match-over') expect(events).toEqual([]);
    else expect(eventsOf(events, 'commandRejected')).toEqual([{ type: 'commandRejected', command: cmd, reason }]);
    expect(eventsOf(events, 'unitDied').filter((e) => e.cause === 'shovel')).toEqual([]);
    expect(m.state.units.map((u) => u.id)).toEqual(ids);
  });

  it('removing as zombies is rejected with plants-only before anything else is looked at', () => {
    const m = fresh();
    const z = spawnUnit(m.state, BALANCE, 'brainEater', 0, 7);
    expect(m.check(remove('zombies', 999))).toBe('plants-only');
    expect(m.check(remove('zombies', z.id))).toBe('plants-only');
    expect(m.check(remove('plants', 999))).toBe('no-target');
    expect(m.check(remove('plants', z.id))).toBe('not-yours');
    m.state.winner = 'zombies';
    expect(m.check(remove('zombies', 999))).toBe('match-over');
  });
});
