import { describe, expect, it } from 'vitest';
import { isOpen, levelConfig, nextLevel, unlockedCards } from '../../src/adventure/campaign';
import type { LevelDef } from '../../src/adventure/types';
import { BALANCE } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { newSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { Match } from '../../src/sim/match';
import { checkLevel } from '../../src/sim/script';
import type { Faction } from '../../src/sim/types';
import { SAMPLE_BATTLE, SAMPLE_SURVIVE } from './sampleLevels';

const T0 = 1_762_900_000_000;
const fresh = (): Save => newSave('p01', 'Lukas', 'peashooter', T0);
const withStars = (plants: Save['plants']['stars'], s = fresh()): Save => ({ ...s, plants: { ...s.plants, stars: plants } });

const P3: LevelDef = { ...SAMPLE_BATTLE, id: 'p1-3', n: 3 };
const Z1: LevelDef = {
  ...SAMPLE_BATTLE, id: 'z1-1', side: 'zombies', cards: ['brainEater', 'veryFastWalker', 'hotTopic'],
  opponent: { skill: 'medium', cards: ['peashooter'], incomeScale: 1.1 },
};
/** Deliberately out of order: the chain follows world and number, not the list. */
const LEVELS: readonly LevelDef[] = [P3, Z1, SAMPLE_SURVIVE, SAMPLE_BATTLE];

describe('unlockedCards', () => {
  it.each<[Faction, string[]]>([
    ['plants', ['peashooter', 'sunflower', 'walnutBomb']],
    ['zombies', ['brainEater', 'veryFastWalker', 'skeletonWarrior']],
  ])('a new %s side has its first three cards', (side, cards) => {
    expect(unlockedCards(fresh(), side)).toEqual(cards);
  });

  it('adds the unlocked cards, in unlock order', () => {
    const s: Save = { ...fresh(), plants: { stars: {}, unlocked: ['kernelPult', 'potatoMine'] } };
    expect(unlockedCards(s, 'plants')).toEqual(['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult']);
    expect(unlockedCards(s, 'zombies')).toEqual(['brainEater', 'veryFastWalker', 'skeletonWarrior']);
  });
});

describe('isOpen and nextLevel', () => {
  it.each<[string, Save['plants']['stars'], boolean[]]>([
    // stars, open: p1-1, p1-2, p1-3
    ['a new save', {}, [true, false, false]],
    ['p1-1 at 0 stars', { 'p1-1': 0 }, [true, false, false]],
    ['p1-1 won', { 'p1-1': 1 }, [true, true, false]],
    ['p1-1 and p1-2 won', { 'p1-1': 3, 'p1-2': 1 }, [true, true, true]],
    ['only p1-2 won (merged)', { 'p1-2': 2 }, [true, false, true]],
  ])('%s', (_what, stars, open) => {
    const s = withStars(stars);
    expect([SAMPLE_BATTLE, SAMPLE_SURVIVE, P3].map((d) => isOpen(s, d, LEVELS))).toEqual(open);
  });

  it('opens each side\'s first level on its own, by that side\'s stars', () => {
    expect(isOpen(fresh(), Z1, LEVELS)).toBe(true);
    expect(isOpen(fresh(), { ...Z1, id: 'z1-2', n: 2 }, [...LEVELS, { ...Z1, id: 'z1-2', n: 2 }])).toBe(false);
    const zombieWon: Save = { ...fresh(), zombies: { stars: { 'z1-1': 1 }, unlocked: [] } };
    expect(isOpen(zombieWon, SAMPLE_SURVIVE, LEVELS)).toBe(false);
  });

  it('a level that is not in the list is not open', () => {
    expect(isOpen(fresh(), { ...SAMPLE_BATTLE, id: 'p9-9' }, LEVELS)).toBe(false);
  });

  it.each<[string, Save['plants']['stars'], string | null]>([
    ['a new save', {}, 'p1-1'],
    ['p1-1 won', { 'p1-1': 2 }, 'p1-2'],
    ['p1-1 lost only', { 'p1-1': 0 }, 'p1-1'],
    ['two won', { 'p1-1': 1, 'p1-2': 3 }, 'p1-3'],
    ['all won', { 'p1-1': 1, 'p1-2': 1, 'p1-3': 1 }, null],
  ])('nextLevel for plants: %s → %s', (_what, stars, id) => {
    expect(nextLevel(withStars(stars), 'plants', LEVELS)?.id ?? null).toBe(id);
  });

  it('nextLevel for zombies looks at zombie levels only', () => {
    expect(nextLevel(withStars({ 'p1-1': 1 }), 'zombies', LEVELS)?.id).toBe('z1-1');
    expect(nextLevel({ ...fresh(), zombies: { stars: { 'z1-1': 1 }, unlocked: [] } }, 'zombies', LEVELS)).toBeNull();
  });
});

describe('levelConfig', () => {
  it('deals the level\'s cards the player has unlocked, in the level\'s order, and the opponent its own', () => {
    const c = levelConfig(SAMPLE_BATTLE, fresh(), 7);
    expect(c.seed).toBe(7);
    expect(c.cards).toEqual({ plants: ['peashooter', 'sunflower', 'walnutBomb'], zombies: ['brainEater', 'veryFastWalker'] });
    const unlocked: Save = { ...fresh(), plants: { stars: {}, unlocked: ['potatoMine'] } };
    expect(levelConfig(SAMPLE_BATTLE, unlocked, 7).cards.plants).toEqual(['peashooter', 'sunflower', 'walnutBomb', 'potatoMine']);
    expect(levelConfig(SAMPLE_SURVIVE, unlocked, 7).cards).toEqual({ plants: ['peashooter', 'sunflower'], zombies: [] });
  });

  it('gives the player\'s Marketplace upgrades to the player\'s side only', () => {
    const s: Save = { ...fresh(), upgrades: { peashooter: 3, sunflower: 0, brainEater: 5, hotTopic: 2 } };
    expect(levelConfig(SAMPLE_BATTLE, s, 1).upgrades).toEqual({ plants: { peashooter: 3, sunflower: 0 }, zombies: {} });
    expect(levelConfig(Z1, s, 1).upgrades).toEqual({ plants: {}, zombies: { brainEater: 5, hotTopic: 2 } });
  });

  it.each<[Save['difficulty']['plants'], number]>([['easy', 1.25], ['medium', 1], ['hard', 0.75]])(
    'Adventure difficulty %s multiplies only the player\'s income, by %f', (skill, mult) => {
      const s: Save = { ...fresh(), difficulty: { plants: skill, zombies: 'medium' } };
      expect(levelConfig(SAMPLE_BATTLE, s, 1).incomeMultiplier).toEqual({ plants: mult, zombies: 0.8 });
      expect(levelConfig(SAMPLE_SURVIVE, s, 1).incomeMultiplier).toEqual({ plants: mult, zombies: 1 });
      const z: Save = { ...fresh(), difficulty: { plants: 'medium', zombies: skill } };
      expect(levelConfig(Z1, z, 1).incomeMultiplier).toEqual({ plants: 1.1, zombies: mult });
    },
  );

  it('heroes are always on; spells (two a side) only when the level deals them', () => {
    const battle = levelConfig(SAMPLE_BATTLE, fresh(), 1);
    expect(battle.heroes).toEqual({ plants: true, zombies: true });
    expect(battle.spells).toEqual({ plants: 0, zombies: 0 });
    const survive = levelConfig(SAMPLE_SURVIVE, fresh(), 1);
    expect(survive.heroes).toEqual({ plants: true, zombies: true });
    expect(survive.spells).toEqual({ plants: 2, zombies: 2 });
  });

  it('sets the player\'s start energy from the level, or the balance default', () => {
    expect(levelConfig(SAMPLE_BATTLE, fresh(), 1).startEnergy).toEqual({ plants: BALANCE.startEnergy, zombies: BALANCE.startEnergy });
    expect(levelConfig(SAMPLE_SURVIVE, fresh(), 1).startEnergy).toEqual({ plants: 250, zombies: BALANCE.startEnergy });
    const b = { ...BALANCE, startEnergy: 999 } as Balance;
    expect(levelConfig(SAMPLE_BATTLE, fresh(), 1, b).startEnergy).toEqual({ plants: 999, zombies: 999 });
  });

  it('a Battle: no script, no clock, no belt, sudden death on', () => {
    const c = levelConfig(SAMPLE_BATTLE, fresh(), 1);
    expect(c).toMatchObject({
      mode: 'battle', script: [], prepared: [], goalTicks: null, belt: null,
      noEnergy: false, invulnerableBase: null, suddenDeath: true,
    });
  });

  it('a Survive: waves in seconds become a script sorted by tick, prepared plants stand on their tiles', () => {
    const c = levelConfig(SAMPLE_SURVIVE, fresh(), 1);
    expect(c.mode).toBe('survive');
    expect(c.script).toEqual([
      { tick: 135, unit: 'veryFastWalker', faction: 'zombies', lane: 0, x: 9.5, level: 2 },
      { tick: 300, unit: 'brainEater', faction: 'zombies', lane: 2, x: 9.5, level: 1 },
    ]);
    expect(c.prepared).toEqual([{ unit: 'peashooter', faction: 'plants', lane: 1, x: 2.5, level: 1 }]);
    expect(c.goalTicks).toBe(2700);
    expect(c).toMatchObject({ belt: null, noEnergy: false, invulnerableBase: 'zombies', suddenDeath: false });
  });

  it('a Conveyor: the belt in ticks with five slots, no energy, the zombie base cannot be hurt', () => {
    const def: LevelDef = { ...SAMPLE_SURVIVE, id: 'p1-5', n: 5, kind: 'conveyor', seconds: null, belt: { everySeconds: 7.5, cards: ['peashooter', 'walnutBomb'] } };
    const c = levelConfig(def, fresh(), 1);
    expect(c).toMatchObject({
      mode: 'conveyor', goalTicks: null, noEnergy: true, invulnerableBase: 'zombies', suddenDeath: false,
      belt: { everyTicks: 225, cards: ['peashooter', 'walnutBomb'], slots: 5 },
    });
  });

  it.each<[LevelDef['kind'], number]>([['survive', 120], ['conveyor', 150]])(
    'a zombie-side %s is a race: no unhittable base, the clock is the plants\' goal', (kind, secs) => {
      const def: LevelDef = {
        ...Z1, id: 'z1-5', n: 5, kind, opponent: null, seconds: secs,
        belt: kind === 'conveyor' ? { everySeconds: 5, cards: ['brainEater'] } : null,
      };
      const c = levelConfig(def, fresh(), 1);
      expect(c.mode).toBe(kind);
      expect(c.invulnerableBase).toBeNull();
      expect(c.goalTicks).toBe(secs * 30);
      expect(c.suddenDeath).toBe(false);
      expect(c.noEnergy).toBe(kind === 'conveyor');
    },
  );

  it.each<[LevelDef['kind'], boolean]>([['breakthrough', false], ['boss', true]])('a %s: sudden death %s', (kind, sd) => {
    const c = levelConfig({ ...SAMPLE_BATTLE, kind }, fresh(), 1);
    expect(c.mode).toBe(kind);
    expect(c.suddenDeath).toBe(sd);
    expect(c.invulnerableBase).toBeNull();
    expect(c.noEnergy).toBe(false);
  });

  it.each([['plants', 'brainTitan', 'zombies', 2], ['zombies', 'elderOak', 'plants', 2]] as const)(
    'a %s boss level puts the %s on the %s side, in its lane; the simulation accepts it', (side, key, faction, lane) => {
      const def: LevelDef = { ...SAMPLE_BATTLE, side, kind: 'boss', cards: side === 'plants' ? ['peashooter'] : ['brainEater'], boss: { key, lane } };
      const c = levelConfig(def, fresh(), 1);
      expect(c.mode).toBe('boss');
      expect(c.boss).toEqual({ key, faction, lane });
      expect(() => checkLevel(c, BALANCE)).not.toThrow();
      expect(() => new Match(c)).not.toThrow();
    },
  );

  it('a boss level without its boss is refused by the simulation (no plain-battle fallback)', () => {
    const c = levelConfig({ ...SAMPLE_BATTLE, kind: 'boss' }, fresh(), 1);
    expect(c.boss).toBeNull();
    expect(() => checkLevel(c, BALANCE)).toThrow(/boss/);
  });

  it.each([0, -5, Number.NaN, 1500.5, Infinity])('refuses a level base of %s health (a level data error)', (hp) => {
    expect(() => levelConfig({ ...SAMPLE_BATTLE, baseHp: { zombies: hp } }, fresh(), 1)).toThrow(RangeError);
  });

  it('takes a level\'s own base health, whole numbers from 1; the other side keeps the balance\'s', () => {
    const c = levelConfig({ ...SAMPLE_BATTLE, baseHp: { zombies: 1 } }, fresh(), 1);
    expect(c.baseHp).toEqual({ plants: BALANCE.baseHp, zombies: 1 });
  });

  it('refuses a plant spawn without a column (a level data error)', () => {
    const bad: LevelDef = { ...SAMPLE_SURVIVE, prepared: [{ at: 0, unit: 'peashooter', lane: 1 }] };
    expect(() => levelConfig(bad, fresh(), 1)).toThrow(RangeError);
  });

  it('is the same for the same inputs, shares nothing with the level, and a Match accepts it', () => {
    const a = levelConfig(SAMPLE_SURVIVE, fresh(), 3);
    expect(levelConfig(SAMPLE_SURVIVE, fresh(), 3)).toEqual(a);
    a.cards.plants.push('torchwood');
    expect(SAMPLE_SURVIVE.cards).toEqual(['peashooter', 'sunflower']);
    const s: Save = { ...fresh(), upgrades: { peashooter: 4 } };
    expect(() => new Match(levelConfig(SAMPLE_BATTLE, s, 3))).not.toThrow();
  });
});
