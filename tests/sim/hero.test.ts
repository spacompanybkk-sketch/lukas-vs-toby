import { describe, expect, it } from 'vitest';
import { BALANCE, cloneBalance, seconds } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { Command, Faction, SimEvent, Unit, UnitKey } from '../../src/sim/types';
import { classicBalance, classicConfig, eventsOf } from './helpers';

/**
 * Hero powers (phase 2, Task 4): Lukas's Mega Mower and Toby's Bone Storm. Each charges on a timer
 * and, aimed at one lane, damages every standing enemy unit in it by a fixed amount.
 */

function table(): Balance {
  const b = classicBalance();
  const shipped = cloneBalance(BALANCE);
  b.units.avocadoBunker = shipped.units.avocadoBunker;
  return b;
}

/** The classic setup with both heroes on, no income and bases that cannot fall. */
function fresh(b: Balance = table(), seed = 1): Match {
  const config = classicConfig(seed, b);
  config.heroes = { plants: true, zombies: true };
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

/** A match whose heroes are both ready now. */
function charged(b?: Balance): Match {
  const m = fresh(b);
  m.state.players.plants.heroTimer = 0;
  m.state.players.zombies.heroTimer = 0;
  return m;
}

const hero = (faction: Faction, lane: number): Command => ({ type: 'hero', faction, lane });
const spawn = (m: Match, key: UnitKey, lane: number, x: number): Unit => spawnUnit(m.state, m.balance, key, lane, x);

describe('the hero numbers', () => {
  it('are Mega Mower 400 / 60 s / 45 s and Bone Storm 250 / 60 s / 45 s', () => {
    expect(BALANCE.hero).toEqual({
      plants: { damage: 400, chargeSeconds: 60, firstChargeSeconds: 45 },
      zombies: { damage: 250, chargeSeconds: 60, firstChargeSeconds: 45 },
    });
  });

  it('are on in the default setup and off in the classic one the rules tests use', () => {
    expect(defaultConfig(1).heroes).toEqual({ plants: true, zombies: true });
    expect(classicConfig(1).heroes).toEqual({ plants: false, zombies: false });
  });
});

describe('the hero timer', () => {
  it('starts at seconds(45) for both sides', () => {
    const m = fresh();
    expect(m.state.players.plants.heroTimer).toBe(seconds(45));
    expect(m.state.players.zombies.heroTimer).toBe(seconds(45));
  });

  it('counts down in the economy and says heroReady once, on the step it reaches 0', () => {
    const m = fresh();
    const before = steps(m, seconds(45) - 1);
    expect(eventsOf(before, 'heroReady')).toEqual([]);
    expect(m.state.players.plants.heroTimer).toBe(1);
    const ready = m.step();
    expect(eventsOf(ready, 'heroReady')).toEqual([
      { type: 'heroReady', faction: 'plants' }, { type: 'heroReady', faction: 'zombies' },
    ]);
    expect(m.state.players.plants.heroTimer).toBe(0);
    expect(eventsOf(steps(m, 200), 'heroReady')).toEqual([]);
    expect(m.state.players.zombies.heroTimer).toBe(0);
  });

  it('resets to seconds(60) on use (the step of use counts as the first tick) and is ready again 60 s later', () => {
    const m = charged();
    const used = m.step([hero('plants', 2)]);
    expect(eventsOf(used, 'heroUsed')).toEqual([{ type: 'heroUsed', faction: 'plants', lane: 2 }]);
    expect(m.state.players.plants.heroTimer).toBe(seconds(60) - 1);
    expect(m.state.players.zombies.heroTimer).toBe(0);
    expect(eventsOf(steps(m, seconds(60) - 2), 'heroReady')).toEqual([]);
    expect(eventsOf(m.step(), 'heroReady')).toEqual([{ type: 'heroReady', faction: 'plants' }]);
  });

  it('stands still and says nothing on a side whose hero is off', () => {
    const m = fresh();
    m.state.config.heroes.zombies = false;
    const events = steps(m, seconds(45));
    expect(eventsOf(events, 'heroReady')).toEqual([{ type: 'heroReady', faction: 'plants' }]);
    expect(m.state.players.zombies.heroTimer).toBe(seconds(45));
  });
});

describe('Mega Mower', () => {
  it('takes 400 off every standing zombie in the lane, armor ignored, and nothing elsewhere', () => {
    const m = charged();
    const near = spawn(m, 'brainEater', 2, 3);
    const far = spawn(m, 'skeletonWarrior', 2, 8.5); // shield ready: a hero is no shot
    const big = spawn(m, 'brainEater', 2, 6);
    big.hp = 2000; big.maxHp = 2000; big.armor = 5;
    const otherLane = spawn(m, 'brainEater', 1, 3);
    const plant = spawn(m, 'peashooter', 2, 1.5);
    const events = m.step([hero('plants', 2)]);
    expect(far.abilityTimer).toBe(0);
    expect(big.hp).toBe(1600);
    expect(eventsOf(events, 'unitDamaged').slice(0, 3)).toEqual([
      { type: 'unitDamaged', unitId: near.id, amount: 400, hp: 0 },
      { type: 'unitDamaged', unitId: far.id, amount: 400, hp: 300 },
      { type: 'unitDamaged', unitId: big.id, amount: 400, hp: 1600 },
    ]);
    expect(events.findIndex((e) => e.type === 'heroUsed')).toBeLessThan(events.findIndex((e) => e.type === 'unitDamaged'));
    expect(otherLane.hp).toBe(400);
    expect(plant.hp).toBe(300);
  });

  it('kills a 300-hp zombie: cause damage, bounty paid', () => {
    const m = charged();
    const z = spawn(m, 'brainEater', 0, 5);
    z.hp = 300;
    const energy = m.state.players.plants.energy;
    const events = m.step([hero('plants', 0)]);
    expect(eventsOf(events, 'unitDied')).toEqual([expect.objectContaining({ unitId: z.id, cause: 'damage' })]);
    expect(eventsOf(events, 'energyGained')).toEqual([expect.objectContaining({ faction: 'plants', source: 'bounty', amount: 20 })]);
    expect(m.state.players.plants.energy).toBe(energy + 20);
    expect(m.state.units).not.toContain(z);
  });

  it('leaves the base, projectiles and hazards alone', () => {
    const m = charged();
    m.state.hazards.push({ id: 99, kind: 'rot', faction: 'zombies', lane: 3, x: 4.5, radius: 0.75, ticksLeft: 100, dps: 15, poisonTicks: 30 });
    const shooter = spawn(m, 'brainEater', 3, 4);
    m.state.units = m.state.units.filter((u) => u !== shooter);
    m.state.projectiles.push({
      id: 98, kind: 'brain', faction: 'zombies', lane: 3, x: 6, speed: 0.1, damage: 15, ownerId: shooter.id, spawnTick: 0,
      flight: 'straight', sourceKey: 'brainEater', level: 1, targetId: null, targetX: null, pierceLeft: 0, hitIds: [],
      burning: false, burnDps: 0, burnTicks: 0, fadeX: null,
    });
    const base = { ...m.state.baseHp };
    const events = m.step([hero('plants', 3)]);
    expect(eventsOf(events, 'baseDamaged')).toEqual([]);
    expect(m.state.baseHp).toEqual(base);
    expect(m.state.projectiles.map((p) => p.id)).toEqual([98]);
    expect(m.state.hazards.map((h) => h.id)).toEqual([99]);
    expect(eventsOf(events, 'unitDamaged')).toEqual([]);
  });
});

describe('Bone Storm', () => {
  it('takes 250 off every standing plant in the lane: a 2000-hp Avocado (armor 8) keeps 1750', () => {
    const m = charged();
    const avocado = spawn(m, 'avocadoBunker', 4, 2.5);
    expect(avocado.hp).toBe(2000);
    expect(avocado.armor).toBe(8);
    const pea = spawn(m, 'peashooter', 4, 0.5);
    const zombie = spawn(m, 'brainEater', 4, 6);
    m.step([hero('zombies', 4)]);
    expect(avocado.hp).toBe(1750);
    expect(pea.hp).toBe(50);
    expect(zombie.hp).toBe(400);
  });
});

describe('hero rejections', () => {
  const rejected = (events: SimEvent[]) => eventsOf(events, 'commandRejected').map((e) => e.reason);

  it('hero-charging before it is ready', () => {
    const m = fresh();
    expect(m.check(hero('plants', 2))).toBe('hero-charging');
    expect(rejected(m.step([hero('zombies', 2)]))).toEqual(['hero-charging']);
  });

  it.each([-1, 5, 2.5, Number.NaN])('bad-lane for lane %s', (lane) => {
    const m = charged();
    expect(m.check(hero('plants', lane))).toBe('bad-lane');
  });

  it('hero-off when the setup turns it off', () => {
    const m = charged();
    m.state.config.heroes.plants = false;
    expect(m.check(hero('plants', 2))).toBe('hero-off');
    expect(m.check(hero('zombies', 2))).toBeNull();
  });

  it('match-over after the end', () => {
    const m = charged();
    m.state.winner = 'zombies';
    expect(m.check(hero('plants', 2))).toBe('match-over');
  });

  it('a refused hero changes nothing', () => {
    const m = fresh();
    const z = spawn(m, 'brainEater', 2, 5);
    m.step([hero('plants', 2)]);
    expect(z.hp).toBe(400);
    expect(m.state.players.plants.heroTimer).toBe(seconds(45) - 1);
  });
});

describe('hero state in hash, snapshot and restore', () => {
  it('heroTimer and config.heroes change the hash', () => {
    const a = fresh();
    const b = fresh();
    b.state.players.zombies.heroTimer -= 1;
    expect(b.hash()).not.toBe(a.hash());
    const c = fresh();
    c.state.config.heroes.plants = false;
    expect(c.hash()).not.toBe(a.hash());
  });

  it('a restored match keeps the timers and the setup and plays on the same', () => {
    const m = fresh();
    m.state.config.heroes.zombies = false;
    spawn(m, 'brainEater', 2, 6);
    steps(m, 100);
    const copy = Match.restore(m.snapshot(), m.balance);
    expect(copy.state.players.plants.heroTimer).toBe(seconds(45) - 100);
    expect(copy.state.config.heroes).toEqual({ plants: true, zombies: false });
    expect(copy.hash()).toBe(m.hash());
    const a = steps(m, seconds(45));
    const b = steps(copy, seconds(45));
    expect(b).toEqual(a);
    expect(copy.hash()).toBe(m.hash());
  });
});
