import { describe, expect, it } from 'vitest';
import { Match, spawnUnit } from '../../src/sim/match';
import { randomInt } from '../../src/sim/rng';
import { ZOMBIE_SPAWN_X } from '../../src/sim/types';
import type { BeltConfig, CardKey, Command, Faction, MatchConfig } from '../../src/sim/types';
import { classicBalance, classicConfig, eventsOf, merge, place } from './helpers';

/** The numbers these rules tests were written for (see `classicBalance`). */
const B = classicBalance();

const PLANT_BELT: BeltConfig = { side: 'plants', everyTicks: 30, cards: ['peashooter', 'walnutBomb', 'sunflower'], slots: 5 };
const ZOMBIE_BELT: BeltConfig = { side: 'zombies', everyTicks: 30, cards: ['brainEater', 'veryFastWalker'], slots: 5 };

/** A conveyor level of the classic setup: no energy, the zombie base safe, a 5-minute clock. */
function conveyor(belt: BeltConfig = PLANT_BELT, patch: Partial<MatchConfig> = {}): Match {
  return new Match({
    ...classicConfig(11, B), mode: 'conveyor', goalTicks: 9000, belt, noEnergy: true,
    invulnerableBase: belt.side === 'plants' ? 'zombies' : 'plants', ...patch,
  }, B);
}

function play(faction: Faction, slot: number, lane: number, col: number): Command {
  return { type: 'belt', faction, slot, lane, col };
}

/** Puts these cards on the belt as if they had arrived. */
function load(m: Match, cards: CardKey[]): void {
  m.state.belt = [...cards];
}

describe('the belt', () => {
  it('starts empty and gets a card drawn with the state rng on tick 0 and every everyTicks after', () => {
    const m = conveyor();
    expect(m.state.belt).toEqual([]);
    const expected: CardKey[] = [];
    const rng = { rng: m.state.rng };
    const arrivals: number[] = [];
    for (let tick = 0; tick < 91; tick++) {
      if (tick % 30 === 0) expected.push(PLANT_BELT.cards[randomInt(rng, 3)]!);
      const events = m.step();
      for (const e of eventsOf(events, 'beltCard')) {
        arrivals.push(tick);
        expect(e.card).toBe(expected[expected.length - 1]);
      }
    }
    expect(arrivals).toEqual([0, 30, 60, 90]);
    expect(m.state.belt).toEqual(expected);
    expect(m.state.rng).toBe(rng.rng); // the draws are the only thing that used it
  });

  it('pins the first draws of seed 11', () => {
    const m = conveyor();
    for (let i = 0; i < 121; i++) m.step();
    expect(m.state.belt).toEqual(['walnutBomb', 'walnutBomb', 'walnutBomb', 'walnutBomb', 'sunflower']);
  });

  it('skips a draw while slots cards wait, without touching the rng', () => {
    const m = conveyor({ ...PLANT_BELT, slots: 2 });
    load(m, ['peashooter', 'peashooter']);
    const rng = m.state.rng;
    const events = m.step();
    expect(eventsOf(events, 'beltCard')).toEqual([]);
    expect(m.state.rng).toBe(rng);
    expect(m.state.belt).toEqual(['peashooter', 'peashooter']);
  });

  it('draws before the commands: a slot freed on an arrival tick is filled on the next one', () => {
    const m = conveyor({ ...PLANT_BELT, slots: 1 });
    m.step(); // tick 0: one card
    for (let i = 1; i < 30; i++) m.step();
    const events = m.step([play('plants', 0, 0, 0)]); // tick 30: still full when the card would come, then played
    expect(eventsOf(events, 'beltCard')).toEqual([]);
    expect(eventsOf(events, 'beltUsed')).toHaveLength(1);
    expect(m.state.belt).toEqual([]);
    for (let i = 31; i < 60; i++) m.step();
    expect(eventsOf(m.step(), 'beltCard')).toHaveLength(1); // tick 60
    expect(m.state.belt).toHaveLength(1);
  });
});

describe('playing a plant card from the belt', () => {
  it('places it on an empty tile for nothing, with no recharge, and the later cards move down', () => {
    const m = conveyor();
    load(m, ['peashooter', 'walnutBomb', 'sunflower']);
    const events = m.step([play('plants', 1, 2, 4)]); // tick 0 also brings a card
    expect(eventsOf(events, 'beltUsed')).toEqual([{ type: 'beltUsed', slot: 1 }]);
    expect(m.state.units.map((u) => [u.key, u.lane, u.x, u.level, u.spent])).toEqual([['walnutBomb', 2, 4.5, 1, 75]]);
    expect(m.state.belt.slice(0, 2)).toEqual(['peashooter', 'sunflower']);
    expect(m.state.players.plants.energy).toBe(0);
    expect(m.state.players.plants.recharge).toEqual({});
  });

  it('plays the same card twice in a row (belt cards have no recharge)', () => {
    const m = conveyor();
    load(m, ['peashooter', 'peashooter']);
    const events = m.step([play('plants', 0, 0, 0), play('plants', 0, 1, 0)]);
    expect(eventsOf(events, 'unitSpawned')).toHaveLength(2);
    expect(eventsOf(events, 'commandRejected')).toEqual([]);
  });

  it('merges into the plant of the same type on the tile, by the usual rule', () => {
    const m = conveyor();
    load(m, ['peashooter', 'peashooter']);
    m.step([play('plants', 0, 3, 3)]);
    const pea = m.state.units[0]!;
    pea.hp = 150;
    const events = m.step([play('plants', 0, 3, 3)]);
    expect(eventsOf(events, 'unitMerged')).toEqual([{ type: 'unitMerged', unitId: pea.id, level: 2 }]);
    expect(pea).toMatchObject({ level: 2, maxHp: 600, hp: 300, spent: 200 });
    expect(m.state.units).toHaveLength(1);
  });

  it('refuses a plant at the top level, another type, a bad tile, and keeps the card', () => {
    const m = conveyor();
    const top = spawnUnit(m.state, B, 'peashooter', 0, 0.5);
    top.level = 5;
    spawnUnit(m.state, B, 'walnutBomb', 1, 0.5);
    load(m, ['peashooter']);
    const events = m.step([
      play('plants', 0, 0, 0), play('plants', 0, 1, 0), play('plants', 0, 2, 8), play('plants', 0, 2, -1),
      play('plants', 0, 5, 0), play('plants', 0, 2.5, 0),
    ]);
    expect(eventsOf(events, 'commandRejected').map((e) => e.reason)).toEqual([
      'max-level', 'occupied', 'bad-column', 'bad-column', 'bad-lane', 'bad-lane',
    ]);
    expect(eventsOf(events, 'beltUsed')).toEqual([]);
    expect(m.state.belt[0]).toBe('peashooter');
  });
});

describe('playing a zombie card from the belt', () => {
  it('sends a new zombie down the lane whatever the column, for nothing', () => {
    const m = conveyor(ZOMBIE_BELT);
    load(m, ['brainEater']);
    const events = m.step([play('zombies', 0, 3, 2)]);
    expect(eventsOf(events, 'unitSpawned').map((e) => [e.key, e.lane, e.x])).toEqual([['brainEater', 3, ZOMBIE_SPAWN_X]]);
    expect(m.state.players.zombies.energy).toBe(0);
  });

  it('merges into the own zombie of that type nearest the tile\'s middle within 0.75', () => {
    const m = conveyor(ZOMBIE_BELT);
    const far = spawnUnit(m.state, B, 'brainEater', 2, 5.0); // 0.5 from col 5's middle
    const near = spawnUnit(m.state, B, 'brainEater', 2, 5.7); // 0.2
    spawnUnit(m.state, B, 'veryFastWalker', 2, 5.5); // another type
    load(m, ['brainEater']);
    const events = m.step([play('zombies', 0, 2, 5)]);
    expect(eventsOf(events, 'unitMerged')).toEqual([{ type: 'unitMerged', unitId: near.id, level: 2 }]);
    expect(far.level).toBe(1);
  });

  it('sends a new one when the nearest of its type is beyond 0.75 or at the top level', () => {
    const m = conveyor(ZOMBIE_BELT);
    spawnUnit(m.state, B, 'brainEater', 1, 6.3); // 0.8 from col 5's middle
    const top = spawnUnit(m.state, B, 'brainEater', 1, 5.5);
    top.level = 5;
    load(m, ['brainEater']);
    const events = m.step([play('zombies', 0, 1, 5)]);
    expect(eventsOf(events, 'unitMerged')).toEqual([]);
    expect(eventsOf(events, 'unitSpawned').map((e) => e.x)).toEqual([ZOMBIE_SPAWN_X]);
  });

  it('refuses a column off the lawn', () => {
    const m = conveyor(ZOMBIE_BELT);
    load(m, ['brainEater']);
    const events = m.step([play('zombies', 0, 1, 10), play('zombies', 0, 1, 0.5)]);
    expect(eventsOf(events, 'commandRejected').map((e) => e.reason)).toEqual(['bad-column', 'bad-column']);
  });
});

describe('belt commands that cannot be played', () => {
  it('are refused: the other side, no such slot, no belt at all, a finished match', () => {
    const m = conveyor();
    load(m, ['peashooter']);
    expect(m.check(play('zombies', 0, 0, 0))).toBe('no-belt');
    expect(m.check(play('plants', 1, 0, 0))).toBe('bad-slot');
    expect(m.check(play('plants', -1, 0, 0))).toBe('bad-slot');
    expect(m.check(play('plants', 0.5, 0, 0))).toBe('bad-slot');
    expect(m.check(play('plants', 0, 0, 0))).toBeNull();
    expect(new Match(classicConfig(1, B), B).check(play('plants', 0, 0, 0))).toBe('no-belt');
    m.state.winner = 'zombies';
    expect(m.check(play('plants', 0, 0, 0))).toBe('match-over');
  });
});

describe('no energy', () => {
  it('starts both sides at 0 and refuses place and merge with no-energy', () => {
    const m = conveyor(PLANT_BELT, { startEnergy: { plants: 500, zombies: 500 } });
    expect(m.state.players.plants.energy).toBe(0);
    expect(m.state.players.zombies.energy).toBe(0);
    const pea = spawnUnit(m.state, B, 'peashooter', 0, 0.5);
    const events = m.step([place('plants', 'peashooter', 1, 1), merge('plants', 'peashooter', pea.id), place('zombies', 'brainEater', 0, 0)]);
    expect(eventsOf(events, 'commandRejected').map((e) => e.reason)).toEqual(['no-energy', 'no-energy', 'no-energy']);
  });

  it('pays no trickle, no Sun and no bounty: energy stays 0', () => {
    const m = conveyor(PLANT_BELT, { incomeMultiplier: { plants: 50, zombies: 50 } });
    spawnUnit(m.state, B, 'sunflower', 0, 0.5);
    const z = spawnUnit(m.state, B, 'brainEater', 4, 8);
    let gained = 0;
    for (let i = 0; i < 400; i++) {
      if (i === 5) z.hp = 0;
      gained += eventsOf(m.step(), 'energyGained').length;
    }
    expect(gained).toBe(0);
    expect(m.state.players.plants.energy).toBe(0);
    expect(m.state.players.zombies.energy).toBe(0);
    expect(m.state.players.plants.carry).toBe(0);
  });

  it('casts an energy spell for nothing', () => {
    const m = conveyor(PLANT_BELT, { spells: { plants: 1, zombies: 0 } });
    m.state.players.plants.spells = [{ key: 'sunShower', timer: 0 }];
    const events = m.step([{ type: 'spell', faction: 'plants', spell: 'sunShower', lane: 0, col: 0 }]);
    expect(eventsOf(events, 'spellCast')).toHaveLength(1);
    expect(eventsOf(events, 'energyGained')).toEqual([]);
    expect(m.state.players.plants.energy).toBe(0);
  });

  it('leaves the hero working', () => {
    const m = conveyor(PLANT_BELT, { heroes: { plants: true, zombies: true } });
    m.state.players.plants.heroTimer = 0;
    const events = m.step([{ type: 'hero', faction: 'plants', lane: 2 }]);
    expect(eventsOf(events, 'heroUsed')).toHaveLength(1);
  });
});

describe('checking the belt', () => {
  const cases: Array<[string, Partial<MatchConfig>, string]> = [
    ['a belt with no cards', { belt: { ...PLANT_BELT, cards: [] } }, 'cards'],
    ['a card of the other side', { belt: { ...PLANT_BELT, cards: ['peashooter', 'brainEater'] } }, 'brainEater'],
    ['a card the balance table has no numbers for', { belt: { ...PLANT_BELT, cards: ['torchwood'] } }, 'torchwood'],
    ['a unit that is no card', { belt: { ...PLANT_BELT, cards: ['rock' as CardKey] } }, 'rock'],
    ['everyTicks 0', { belt: { ...PLANT_BELT, everyTicks: 0 } }, 'everyTicks'],
    ['everyTicks 1.5', { belt: { ...PLANT_BELT, everyTicks: 1.5 } }, 'everyTicks'],
    ['slots 0', { belt: { ...PLANT_BELT, slots: 0 } }, 'slots'],
    ['a belt with no side', { belt: { ...PLANT_BELT, side: 'robots' as Faction } }, 'side'],
    ['a conveyor with no belt', { belt: null }, 'belt'],
    ['a belt outside a conveyor', { mode: 'survive' }, 'belt'],
  ];
  it.each(cases)('refuses %s', (_name, patch, message) => {
    expect(() => conveyor(PLANT_BELT, patch)).toThrow(message);
  });
});
