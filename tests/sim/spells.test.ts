import { describe, expect, it } from 'vitest';
import { BALANCE, cloneBalance, seconds } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { ALL_CARDS, factionOf, isCard, priceOf } from '../../src/data/units';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { randomInt } from '../../src/sim/rng';
import { SPELLS, spellArea } from '../../src/sim/spells';
import type { Command, Faction, SimEvent, SpellKey, Unit, UnitKey } from '../../src/sim/types';
import { classicBalance, classicConfig, eventsOf, merge, place, remove } from './helpers';

/**
 * Spells (phase 2, Task 4b, spec 21): five per side, two dealt per match from the state rng, each
 * cast once and back after its cooldown. On the classic numbers (see `classicBalance`).
 */

/** The classic setup with two spells a side, no income, bases that cannot fall, every card. */
function fresh(b: Balance = classicBalance(), seed = 1): Match {
  const config = classicConfig(seed, b);
  config.spells = { plants: 2, zombies: 2 };
  config.baseHp = { plants: 1_000_000, zombies: 1_000_000 };
  config.incomeMultiplier = { plants: 0, zombies: 0 };
  config.startEnergy = { plants: 1000, zombies: 1000 };
  config.suddenDeath = false;
  config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
  return new Match(config, b);
}

/** A match where `spell` is dealt to its side and ready now. */
function ready(spell: SpellKey, b?: Balance): Match {
  const m = fresh(b);
  m.state.players[sideOf(spell)].spells = [{ key: spell, timer: 0 }];
  return m;
}

const sideOf = (spell: SpellKey): Faction => (SPELLS.plants.includes(spell) ? 'plants' : 'zombies');
const cast = (spell: SpellKey, lane = 0, col = 0): Command => ({ type: 'spell', faction: sideOf(spell), spell, lane, col });
const spawn = (m: Match, key: UnitKey, lane: number, x: number): Unit => spawnUnit(m.state, m.balance, key, lane, x);

function steps(m: Match, n: number, commands: Command[] = []): SimEvent[] {
  const all: SimEvent[] = [...m.step(commands)];
  for (let i = 1; i < n; i++) all.push(...m.step());
  return all;
}

/** A unit that stands and does nothing, on either side, so a spell's effect is all that happens. */
function idle(m: Match, faction: Faction, lane: number, x: number, hp = 1000, armor = 0): Unit {
  const u = spawn(m, faction === 'plants' ? 'walnutBomb' : 'skeletonWarrior', lane, x);
  u.hp = hp; u.maxHp = hp; u.armor = armor;
  u.meleeTimer = 99999; u.shotTimer = 99999; u.abilityTimer = 0; // a ready shield, for the shield rule
  return u;
}

describe('the spell table', () => {
  it('has five spells a side in the order of spec 21', () => {
    expect(SPELLS).toEqual({
      plants: ['thunderbolt', 'vines', 'sunShower', 'healingRain', 'rockWall'],
      zombies: ['meteor', 'fog', 'brainFeast', 'frenzy', 'graveRise'],
    });
  });

  it('has the starting values of spec 21 and the plan\'s cooldowns, first ready at 20 s', () => {
    // Task 8b tuned these (felt, and each worth about +12 points of Medium v Medium on its own);
    // the rules tests below use spec 21's starting values through classicBalance().
    expect(BALANCE.spells).toEqual({
      thunderbolt: { cooldown: 120, firstReady: 45, size: 2, damage: 200 },
      vines: { cooldown: 60, firstReady: 45, size: 2, seconds: 10 },
      sunShower: { cooldown: 90, firstReady: 45, size: 0, amount: 50 },
      healingRain: { cooldown: 90, firstReady: 45, size: 3, amount: 150 },
      rockWall: { cooldown: 60, firstReady: 45, size: 1, seconds: 15 },
      meteor: { cooldown: 120, firstReady: 45, size: 2, damage: 60 },
      fog: { cooldown: 90, firstReady: 45, size: 2, seconds: 7 },
      brainFeast: { cooldown: 90, firstReady: 45, size: 0, amount: 100 },
      frenzy: { cooldown: 75, firstReady: 45, size: 3, seconds: 10, factor: 2.5 },
      graveRise: { cooldown: 120, firstReady: 45, size: 1, count: 2, minCol: 4 },
    });
    expect(BALANCE.units.rock?.hp).toBe(2500); // Rock Wall's rock
    expect(classicBalance().spells.thunderbolt.damage).toBe(300); // spec 21's starting values, for the rules tests
  });

  it('deals two a side in the default setup and none in the classic one', () => {
    expect(defaultConfig(1).spells).toEqual({ plants: 2, zombies: 2 });
    expect(classicConfig(1).spells).toEqual({ plants: 0, zombies: 0 });
    expect(new Match(classicConfig(1)).state.players.plants.spells).toEqual([]);
  });
});

describe('the deal', () => {
  it('draws config.spells distinct spells of each side from the state rng, plants first', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const m = new Match(defaultConfig(seed));
      const rng = { rng: seed };
      for (const side of ['plants', 'zombies'] as const) {
        const pool = [...SPELLS[side]];
        const expected = [pool.splice(randomInt(rng, pool.length), 1)[0], pool.splice(randomInt(rng, pool.length), 1)[0]];
        expect(m.state.players[side].spells.map((x) => x.key)).toEqual(expected);
        expect(m.state.players[side].spells.every((x) => x.timer === seconds(BALANCE.spells[x.key].firstReady))).toBe(true);
      }
      expect(m.state.rng).toBe(rng.rng);
    }
  });

  it('same seed, same deal; the deal differs across seeds', () => {
    const deal = (seed: number) => JSON.stringify(new Match(defaultConfig(seed)).state.players);
    expect(deal(9)).toBe(deal(9));
    const deals = new Set(Array.from({ length: 30 }, (_, i) => deal(i + 1)));
    expect(deals.size).toBeGreaterThan(5);
  });

  it('deals all five when asked for five, and none draws the rng when asked for none', () => {
    const config = defaultConfig(3);
    config.spells = { plants: 5, zombies: 0 };
    const m = new Match(config);
    expect([...m.state.players.plants.spells.map((x) => x.key)].sort()).toEqual([...SPELLS.plants].sort());
    expect(m.state.players.zombies.spells).toEqual([]);
    const none = defaultConfig(3);
    none.spells = { plants: 0, zombies: 0 };
    expect(new Match(none).state.rng).toBe(3);
  });

  it('the deal and its timers are in the hash, the snapshot and the restore', () => {
    const m = fresh();
    const other = fresh();
    other.state.players.zombies.spells[0]!.timer -= 1;
    expect(other.hash()).not.toBe(m.hash());
    const swapped = fresh();
    swapped.state.players.plants.spells.reverse();
    expect(swapped.hash()).not.toBe(m.hash());
    const fewer = fresh();
    fewer.state.config.spells.plants = 1;
    expect(fewer.hash()).not.toBe(m.hash());
    steps(m, 50);
    const copy = Match.restore(m.snapshot(), m.balance);
    expect(copy.state.players).toEqual(m.state.players);
    expect(copy.state.config.spells).toEqual({ plants: 2, zombies: 2 });
    expect(copy.hash()).toBe(m.hash());
  });
});

describe('the area', () => {
  const tiles = (faction: Faction, size: 0 | 1 | 2 | 3, lane: number, col: number) =>
    spellArea(faction, size, lane, col).map((t) => `${t.lane}:${t.col}`).sort();

  it('2×2: the tile, the next column towards the enemy and the next lane down', () => {
    expect(tiles('plants', 2, 1, 4)).toEqual(['1:4', '1:5', '2:4', '2:5']);
    expect(tiles('zombies', 2, 1, 4)).toEqual(['1:3', '1:4', '2:3', '2:4']);
  });

  it('2×2 is pushed back onto the lawn at an edge, always four tiles', () => {
    expect(tiles('plants', 2, 4, 9)).toEqual(['3:8', '3:9', '4:8', '4:9']);
    expect(tiles('zombies', 2, 4, 0)).toEqual(['3:0', '3:1', '4:0', '4:1']);
  });

  it('3×3 is centred and clipped', () => {
    expect(tiles('plants', 3, 2, 5)).toHaveLength(9);
    expect(tiles('zombies', 3, 0, 0)).toEqual(['0:0', '0:1', '1:0', '1:1']);
  });

  it('a unit is in it when its lane and floor(x) are', () => {
    const m = ready('thunderbolt');
    const inside = idle(m, 'zombies', 2, 5.99);
    const edge = idle(m, 'zombies', 2, 6);
    const below = idle(m, 'zombies', 3, 4);
    const above = idle(m, 'zombies', 1, 4.5);
    m.step([cast('thunderbolt', 2, 4)]);
    expect([inside.hp, edge.hp, below.hp, above.hp]).toEqual([700, 1000, 700, 1000]);
  });
});

describe('the plants\' spells', () => {
  it('Thunderbolt: 300 to each zombie in the area, armor and shields ignored; plants untouched', () => {
    const m = ready('thunderbolt');
    const shielded = idle(m, 'zombies', 0, 1.5, 1000, 5); // shield ready, armor 5
    const weak = idle(m, 'zombies', 1, 0.5, 250);
    const plant = idle(m, 'plants', 0, 0.5);
    const events = m.step([cast('thunderbolt', 0, 0)]);
    expect(eventsOf(events, 'spellCast')).toEqual([
      { type: 'spellCast', faction: 'plants', spell: 'thunderbolt', lane: 0, col: 0, size: 2 },
    ]);
    expect(shielded.hp).toBe(700);
    expect(shielded.abilityTimer).toBe(0);
    expect(plant.hp).toBe(1000);
    expect(eventsOf(events, 'unitDied')).toEqual([expect.objectContaining({ unitId: weak.id, cause: 'damage' })]);
    expect(eventsOf(events, 'energyGained')).toEqual([expect.objectContaining({ source: 'bounty', faction: 'plants' })]);
  });

  it('Vines: ties each zombie in the area for 120 ticks', () => {
    const m = ready('vines');
    const z = spawn(m, 'brainEater', 3, 7.2);
    const out = spawn(m, 'brainEater', 3, 9.2);
    const x = z.x;
    const events = m.step([cast('vines', 3, 6)]);
    expect(eventsOf(events, 'statusApplied')).toEqual([
      { type: 'statusApplied', unitId: z.id, status: 'tied', ticks: 120, sourceId: null },
    ]);
    steps(m, 119);
    expect(z.x).toBe(x);
    expect(out.x).toBeLessThan(9.2);
    m.step();
    expect(z.x).toBeLessThan(x);
  });

  it('Sun Shower: +150 Sun at once, lane and column ignored', () => {
    const m = ready('sunShower');
    const before = m.state.players.plants.energy;
    const events = m.step([cast('sunShower', 99, -4)]);
    expect(m.state.players.plants.energy).toBe(before + 150);
    expect(eventsOf(events, 'energyGained')).toEqual([
      { type: 'energyGained', faction: 'plants', amount: 150, source: 'spell', unitId: null, lane: 2, x: 0 },
    ]);
    expect(eventsOf(events, 'spellCast')).toEqual([
      { type: 'spellCast', faction: 'plants', spell: 'sunShower', lane: 99, col: -4, size: 0 },
    ]);
  });

  it('Healing Rain: +400 to each plant in the 3×3, capped at maxHp; zombies untouched', () => {
    const m = ready('healingRain');
    const hurt = idle(m, 'plants', 2, 3.5, 1000);
    hurt.hp = 100;
    const nearly = idle(m, 'plants', 1, 2.5, 1000);
    nearly.hp = 900;
    const far = idle(m, 'plants', 4, 3.5, 1000);
    far.hp = 100;
    const z = idle(m, 'zombies', 2, 4.5);
    z.hp = 100;
    const events = m.step([cast('healingRain', 2, 3)]);
    expect([hurt.hp, nearly.hp, far.hp, z.hp]).toEqual([500, 1000, 100, 100]);
    expect(eventsOf(events, 'unitHealed')).toEqual([
      { type: 'unitHealed', unitId: hurt.id, amount: 400, hp: 500 },
      { type: 'unitHealed', unitId: nearly.id, amount: 100, hp: 1000 },
    ]);
  });

  it('Healing Rain never heals a Rock Wall rock (it is no plant that grows back)', () => {
    const m = ready('healingRain');
    m.state.players.plants.spells.push({ key: 'rockWall', timer: 0 });
    m.step([cast('rockWall', 2, 3)]);
    const rock = m.state.units.find((u) => u.key === 'rock');
    if (!rock) throw new Error('no rock');
    rock.hp = 100;
    const events = m.step([cast('healingRain', 2, 3)]);
    expect(rock.hp).toBe(100);
    expect(eventsOf(events, 'unitHealed')).toEqual([]);
  });

  it('Rock Wall: a tile whose plant is already down this tick counts as free', () => {
    const m = ready('rockWall');
    const p = idle(m, 'plants', 1, 6.5, 1000);
    p.hp = 0; // down, removed at the end of the tick
    expect(m.check(cast('rockWall', 1, 6))).toBeNull();
  });

  it('Rock Wall: an 800-hp rock on an empty plant tile that leaves after 360 ticks, spent', () => {
    const m = ready('rockWall');
    const events = m.step([cast('rockWall', 1, 6)]);
    const rock = m.state.units.find((u) => u.key === 'rock');
    if (!rock) throw new Error('no rock');
    expect(rock).toMatchObject({ faction: 'plants', lane: 1, x: 6.5, hp: 800, maxHp: 800, spent: 0, expires: 359 });
    expect(eventsOf(events, 'unitSpawned')).toEqual([
      { type: 'unitSpawned', unitId: rock.id, key: 'rock', faction: 'plants', lane: 1, x: 6.5 },
    ]);
    expect(eventsOf(steps(m, 358), 'unitDied')).toEqual([]);
    expect(m.state.units).toContain(rock);
    expect(eventsOf(m.step(), 'unitDied')).toEqual([
      { type: 'unitDied', unitId: rock.id, key: 'rock', faction: 'plants', lane: 1, x: 6.5, level: 1, cause: 'spent' },
    ]);
    expect(m.state.units).not.toContain(rock);
  });

  it('Rock Wall: occupied on a planted tile, bad-column on the graveyard strip', () => {
    const m = ready('rockWall');
    spawn(m, 'peashooter', 1, 6.5);
    expect(m.check(cast('rockWall', 1, 6))).toBe('occupied');
    expect(m.check(cast('rockWall', 1, 8))).toBe('bad-column');
    expect(m.check(cast('rockWall', 1, 7))).toBeNull();
  });

  it('the rock holds zombies, which bite it, and pays no bounty when it falls', () => {
    const m = ready('rockWall');
    m.step([cast('rockWall', 0, 2)]);
    const rock = m.state.units.find((u) => u.key === 'rock');
    if (!rock) throw new Error('no rock');
    const z = spawn(m, 'brainEater', 0, 2.9);
    z.meleeTimer = 0;
    rock.hp = 30;
    const events = steps(m, 3);
    expect(eventsOf(events, 'unitAttacked')).toContainEqual(expect.objectContaining({ unitId: z.id, targetId: rock.id, attack: 'melee' }));
    expect(eventsOf(events, 'unitDied')).toEqual([expect.objectContaining({ unitId: rock.id, cause: 'damage' })]);
    expect(eventsOf(events, 'energyGained')).toEqual([]);
  });

  it('the rock is the plants\' own, no card: shovelled yes, merged into no, never in a hand', () => {
    expect(factionOf('rock')).toBe('plants');
    expect(priceOf('rock')).toBe(0);
    expect(isCard('rock')).toBe(false);
    const m = ready('rockWall');
    m.step([cast('rockWall', 0, 2)]);
    const rock = m.state.units.find((u) => u.key === 'rock');
    if (!rock) throw new Error('no rock');
    expect(m.check(merge('plants', 'peashooter', rock.id))).toBe('wrong-type');
    expect(m.check(place('plants', 'peashooter', 0, 2))).toBe('occupied');
    expect(m.check({ type: 'place', faction: 'plants', unit: 'rock' as never, lane: 0, col: 3 })).toBe('not-in-hand');
    expect(m.check(remove('plants', rock.id))).toBeNull();
    const events = m.step([remove('plants', rock.id)]);
    expect(eventsOf(events, 'unitDied')).toEqual([expect.objectContaining({ unitId: rock.id, cause: 'shovel' })]);
  });
});

describe('the zombies\' spells', () => {
  it('Meteor: 220 to each plant in the area, armor ignored', () => {
    const m = ready('meteor');
    const armored = idle(m, 'plants', 2, 4.5, 1000, 8);
    const next = idle(m, 'plants', 3, 3.5);
    const out = idle(m, 'plants', 2, 5.5);
    const z = idle(m, 'zombies', 2, 4.5);
    m.step([cast('meteor', 2, 4)]);
    expect([armored.hp, next.hp, out.hp, z.hp]).toEqual([780, 780, 1000, 1000]);
  });

  it('Fog: blinds each plant in the area for 150 ticks', () => {
    const m = ready('fog');
    const p = idle(m, 'plants', 0, 0.5);
    const events = m.step([cast('fog', 0, 1)]);
    expect(eventsOf(events, 'statusApplied')).toEqual([
      { type: 'statusApplied', unitId: p.id, status: 'blind', ticks: 150, sourceId: null },
    ]);
    expect(p.blind).toBe(149);
  });

  it('Brain Feast: +200 Brains at once, lane and column ignored', () => {
    const m = ready('brainFeast');
    const before = m.state.players.zombies.energy;
    const events = m.step([cast('brainFeast', -1, 42)]);
    expect(m.state.players.zombies.energy).toBe(before + 200);
    expect(eventsOf(events, 'energyGained')).toEqual([
      { type: 'energyGained', faction: 'zombies', amount: 200, source: 'spell', unitId: null, lane: 2, x: 9.5 },
    ]);
  });

  it('Frenzy: haste for 180 ticks on each zombie in the 3×3: it walks 1.5× as far', () => {
    const m = ready('frenzy');
    const z = spawn(m, 'skeletonWarrior', 2, 8.2); // speed 0.3
    const out = spawn(m, 'skeletonWarrior', 4, 8.2);
    const events = m.step([cast('frenzy', 2, 8)]);
    expect(eventsOf(events, 'statusApplied')).toEqual([
      { type: 'statusApplied', unitId: z.id, status: 'haste', ticks: 180, sourceId: null },
    ]);
    const step = 0.3 / 30;
    expect(z.x).toBeCloseTo(8.2 - step * 1.5, 12);
    expect(out.x).toBeCloseTo(8.2 - step, 12);
    const x = z.x;
    const rest = steps(m, 179);
    expect(z.x).toBeCloseTo(x - 179 * step * 1.5, 9);
    expect(eventsOf(rest, 'statusEnded')).toEqual([{ type: 'statusEnded', unitId: z.id, status: 'haste' }]);
    expect(z.haste).toBe(0);
    const y = z.x;
    m.step();
    expect(z.x).toBeCloseTo(y - step, 12);
  });

  it('Frenzy: melee and shot timers count down 1.5× as fast, as a whole-number carry', () => {
    const m = ready('frenzy');
    const z = spawn(m, 'brainEater', 2, 9.2);
    z.meleeTimer = 30; z.shotTimer = 31;
    m.step([cast('frenzy', 2, 9)]);
    const seen: number[] = [z.meleeTimer];
    for (let i = 0; i < 3; i++) {
      m.step();
      seen.push(z.meleeTimer);
    }
    expect(seen).toEqual([29, 27, 26, 24]); // 1, then 2, 1, 2 ...: an extra tick every other tick
    expect(Number.isInteger(z.hasteCarry)).toBe(true);
    steps(m, 16);
    expect(z.meleeTimer).toBe(0); // 30 ticks of countdown in 20 steps
    expect(z.shotTimer).toBe(1);
  });

  it('Frenzy reads its factor from the balance table', () => {
    const b = classicBalance();
    b.spells.frenzy.factor = 2;
    const m = ready('frenzy', b);
    const z = spawn(m, 'skeletonWarrior', 2, 9.2);
    z.meleeTimer = 30;
    m.step([cast('frenzy', 2, 9)]);
    expect(z.meleeTimer).toBe(28);
    expect(z.x).toBeCloseTo(9.2 - 2 * 0.3 / 30, 12);
  });

  it('Frenzy: a stunned hasted zombie keeps its timers frozen but its haste runs out', () => {
    const m = ready('frenzy');
    const z = spawn(m, 'brainEater', 2, 9.2);
    z.meleeTimer = 30;
    z.stun = 400;
    m.step([cast('frenzy', 2, 9)]);
    steps(m, 179);
    expect(z.meleeTimer).toBe(30);
    expect(z.haste).toBe(0);
  });

  it('Frenzy: the haste carry is cleared on the tick the haste ends, even while the zombie is stunned', () => {
    const m = ready('frenzy');
    const z = spawn(m, 'brainEater', 2, 9.2);
    z.meleeTimer = 30;
    m.step([cast('frenzy', 2, 9)]); // the cast step is hasted: half a tick of carry
    expect(z.hasteCarry).toBe(500);
    z.stun = 400; // stunned: the carry is no longer counted down
    steps(m, 179);
    expect(z.haste).toBe(0);
    expect(z.hasteCarry).toBe(0);
  });

  it('Grave Rise: three level-1 Bone Minions in the tapped lane at the column\'s centre, unowned, spent 0', () => {
    const b = classicBalance();
    b.units.boneMinion = cloneBalance(BALANCE).units.boneMinion;
    const m = ready('graveRise', b);
    const events = m.step([cast('graveRise', 3, 5)]);
    const minions = m.state.units.filter((u) => u.key === 'boneMinion');
    expect(minions).toHaveLength(3);
    for (const u of minions) expect(u).toMatchObject({ faction: 'zombies', lane: 3, level: 1, spent: 0, ownerId: null, hp: 150 });
    expect(eventsOf(events, 'unitSpawned')).toEqual(minions.map((u) => (
      { type: 'unitSpawned', unitId: u.id, key: 'boneMinion', faction: 'zombies', lane: 3, x: 5.5 }
    )));
    expect(eventsOf(events, 'spellCast')[0]).toMatchObject({ spell: 'graveRise', size: 1 });
  });
});

describe('Grave Rise is kept away from the plant base', () => {
  it('minCol 4: column 3 is bad-column, column 4 is fine', () => {
    const b = classicBalance();
    b.units.boneMinion = cloneBalance(BALANCE).units.boneMinion;
    const m = ready('graveRise', b);
    expect(m.check(cast('graveRise', 1, 3))).toBe('bad-column');
    expect(m.check(cast('graveRise', 1, 4))).toBeNull();
    expect(m.check(cast('graveRise', 1, 9))).toBeNull();
  });
});

describe('spell timers', () => {
  it('start at seconds(20), count down in the economy and say spellReady once', () => {
    const m = fresh();
    const dealt = m.state.players.plants.spells.map((x) => x.key);
    const before = steps(m, seconds(20) - 1);
    expect(eventsOf(before, 'spellReady')).toEqual([]);
    const at = m.step();
    expect(eventsOf(at, 'spellReady')).toEqual([
      ...dealt.map((spell) => ({ type: 'spellReady', faction: 'plants', spell })),
      ...m.state.players.zombies.spells.map((x) => ({ type: 'spellReady', faction: 'zombies', spell: x.key })),
    ]);
    expect(eventsOf(steps(m, 100), 'spellReady')).toEqual([]);
  });

  it('reset to seconds(cooldown) on cast, the cast step counting as the first', () => {
    const m = ready('vines');
    m.step([cast('vines', 0, 0)]);
    expect(m.state.players.plants.spells).toEqual([{ key: 'vines', timer: seconds(45) - 1 }]);
    const plantsReady = (events: SimEvent[]) => eventsOf(events, 'spellReady').filter((e) => e.faction === 'plants');
    expect(plantsReady(steps(m, seconds(45) - 2))).toEqual([]);
    expect(plantsReady(m.step())).toEqual([{ type: 'spellReady', faction: 'plants', spell: 'vines' }]);
  });
});

describe('spell rejections', () => {
  it('spell-not-dealt: a spell of the side not dealt, or the other side\'s', () => {
    const m = ready('vines');
    expect(m.check(cast('thunderbolt', 0, 0))).toBe('spell-not-dealt');
    expect(m.check({ type: 'spell', faction: 'plants', spell: 'meteor', lane: 0, col: 0 })).toBe('spell-not-dealt');
  });

  it('spell-charging before it is ready', () => {
    const m = fresh();
    const key = m.state.players.zombies.spells[0]!.key;
    expect(m.check(cast(key, 1, 5))).toBe('spell-charging');
  });

  it('spells-off when the setup deals none', () => {
    const m = new Match(classicConfig(1));
    expect(m.check(cast('meteor', 1, 5))).toBe('spells-off');
  });

  it.each([[-1, 0, 'bad-lane'], [5, 0, 'bad-lane'], [1.5, 0, 'bad-lane'], [0, -1, 'bad-column'], [0, 10, 'bad-column'], [0, 0.5, 'bad-column']] as const)(
    'lane %s col %s: %s', (lane, col, reason) => {
      const m = ready('meteor');
      expect(m.check(cast('meteor', lane, col))).toBe(reason);
    },
  );

  it('match-over after the end', () => {
    const m = ready('brainFeast');
    m.state.winner = 'plants';
    expect(m.check(cast('brainFeast'))).toBe('match-over');
  });

  it('a refused spell does nothing', () => {
    const m = fresh();
    const key = m.state.players.plants.spells[0]!.key;
    const energy = m.state.players.plants.energy;
    const events = m.step([cast(key, 1, 1)]);
    expect(eventsOf(events, 'commandRejected')).toHaveLength(1);
    expect(eventsOf(events, 'spellCast')).toEqual([]);
    expect(m.state.players.plants.energy).toBe(energy);
  });
});

describe('the deal does not disturb the rest of the match', () => {
  it('a match that deals spells and never casts plays the same as one that deals none, past the rng', () => {
    const a = fresh();
    const b = new Match({ ...a.state.config, spells: { plants: 0, zombies: 0 } }, a.balance);
    b.state.rng = a.state.rng;
    for (const m of [a, b]) {
      spawn(m, 'peashooter', 2, 0.5);
      spawn(m, 'brainEater', 2, 9.5);
    }
    const ea = steps(a, 400).filter((e) => e.type !== 'spellReady');
    const eb = steps(b, 400);
    expect(ea).toEqual(eb);
  });
});
