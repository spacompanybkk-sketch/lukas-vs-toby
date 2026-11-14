import { describe, expect, it } from 'vitest';
import { lawnOf, levelConfig } from '../../src/adventure/campaign';
import { freePlayConfig } from '../../src/adventure/freePlay';
import type { LevelDef } from '../../src/adventure/types';
import { BALANCE } from '../../src/data/balance';
import { newSave } from '../../src/progress/save';
import { cloneLawn, NO_TWIST } from '../../src/sim/lawn';
import { Match, defaultConfig } from '../../src/sim/match';
import { PLANT_COLS } from '../../src/sim/types';
import type { LawnConfig, MatchConfig } from '../../src/sim/types';
import { SAMPLE_BATTLE } from '../adventure/sampleLevels';

/** The default setup with `lawn` merged into NO_TWIST. */
function lawnConfig(seed: number, lawn: Partial<LawnConfig>, more: Partial<MatchConfig> = {}): MatchConfig {
  return { ...defaultConfig(seed), ...more, lawn: { ...cloneLawn(NO_TWIST), ...lawn } };
}

const tile = (lane: number, col: number): number => lane * PLANT_COLS + col;

describe('NO_TWIST and the setup', () => {
  it('a default setup has no twist, and its own copy of it', () => {
    const a = defaultConfig(1);
    const b = defaultConfig(1);
    expect(a.lawn).toEqual({ rocks: [], fog: null, ice: null, lava: null });
    a.lawn.rocks.push(3);
    expect(b.lawn.rocks).toEqual([]);
    expect(NO_TWIST.rocks).toEqual([]);
    expect(Object.isFrozen(NO_TWIST)).toBe(true);
  });

  it('a match shares no part of the lawn with the setup it was made from', () => {
    const c = lawnConfig(1, { rocks: [tile(1, 3)], ice: { lanes: [2], speed: 1.6 }, lava: { tiles: [12], dps: 15, burnTicks: 60 } });
    const m = new Match(c);
    c.lawn.rocks.push(tile(2, 2));
    c.lawn.ice!.lanes.push(3);
    c.lawn.lava!.tiles.push(13);
    expect(m.state.config.lawn).toEqual({ rocks: [tile(1, 3)], fog: null, ice: { lanes: [2], speed: 1.6 }, lava: { tiles: [12], dps: 15, burnTicks: 60 } });
  });

  it('a setup made before the twists (no lawn) plays as NO_TWIST', () => {
    const c = defaultConfig(1) as Partial<MatchConfig>;
    delete c.lawn;
    const m = new Match(c as MatchConfig);
    expect(m.state.config.lawn).toEqual({ rocks: [], fog: null, ice: null, lava: null });
  });

  it('an old snapshot without lawn or fadeX restores as NO_TWIST, with the same checksum as a fresh one', () => {
    const m = new Match(defaultConfig(3));
    m.step([{ type: 'place', faction: 'plants', unit: 'peashooter', lane: 2, col: 0 }]);
    while (m.state.projectiles.length === 0 && m.state.tick < 300) m.step();
    expect(m.state.projectiles.length).toBeGreaterThan(0);
    const old = JSON.parse(m.snapshot()) as { config: Record<string, unknown>; projectiles: Record<string, unknown>[] };
    delete old.config.lawn;
    for (const p of old.projectiles) delete p.fadeX;
    const snapshot = JSON.stringify(old);
    expect(snapshot).not.toContain('lawn');
    expect(snapshot).not.toContain('fadeX');
    const restored = Match.restore(snapshot);
    expect(restored.state.config.lawn).toEqual({ rocks: [], fog: null, ice: null, lava: null });
    expect(restored.state.projectiles.every((p) => p.fadeX === null)).toBe(true);
    expect(restored.hash()).toBe(m.hash());
    for (let i = 0; i < 200; i++) {
      m.step();
      restored.step();
    }
    expect(restored.hash()).toBe(m.hash());
  });
});

describe('levelConfig builds the lawn from the level twist and Balance.twists', () => {
  const save = newSave('p01', 'Lukas', 'peashooter', 0);

  it('no twist: NO_TWIST', () => {
    expect(levelConfig(SAMPLE_BATTLE, save, 1).lawn).toEqual({ rocks: [], fog: null, ice: null, lava: null });
  });

  it('every twist at once, numbers from the balance table', () => {
    const def: LevelDef = { ...SAMPLE_BATTLE, twist: { rocks: [tile(0, 5), tile(4, 6)], fog: true, iceLanes: [1, 3], lavaTiles: [7, 48] } };
    expect(levelConfig(def, save, 1).lawn).toEqual({
      rocks: [tile(0, 5), tile(4, 6)],
      fog: 5,
      ice: { lanes: [1, 3], speed: 1.6 },
      lava: { tiles: [7, 48], dps: 15, burnTicks: 60 },
    });
    expect(() => new Match(levelConfig(def, save, 1))).not.toThrow();
  });

  it('follows a different balance table, and copies the lists', () => {
    const b = { ...BALANCE, twists: { fog: { reach: 3 }, ice: { speed: 2 }, lava: { dps: 9, burnSeconds: 1.5 } } };
    const twist = { fog: true as const, iceLanes: [0], lavaTiles: [3], rocks: [1] };
    const lawn = lawnOf(twist, b);
    expect(lawn).toEqual({ rocks: [1], fog: 3, ice: { lanes: [0], speed: 2 }, lava: { tiles: [3], dps: 9, burnTicks: 45 } });
    twist.rocks.push(2);
    twist.iceLanes.push(1);
    expect(lawn.rocks).toEqual([1]);
    expect(lawn.ice!.lanes).toEqual([0]);
  });

  it('empty lists switch a twist off', () => {
    expect(lawnOf({ iceLanes: [], lavaTiles: [], rocks: [] })).toEqual({ rocks: [], fog: null, ice: null, lava: null });
  });
});

describe('checkLawn (Review Focus 2): a level that makes no sense is refused at construction', () => {
  const refused: Array<[string, Partial<LawnConfig>, Partial<MatchConfig>, RegExp]> = [
    ['a rock off the lawn', { rocks: [40] }, {}, /rock tile 40 is not a whole number 0\.\.39/],
    ['a rock at a fraction', { rocks: [2.5] }, {}, /rock tile 2.5 is not a whole number/],
    ['a rock listed twice', { rocks: [3, 3] }, {}, /rock tile 3 \(lane 0, col 3\) is listed twice/],
    ['fog of 0', { fog: 0 }, {}, /fog 0 must be a number of tiles above 0/],
    ['fog below 0', { fog: -2 }, {}, /fog -2 must be a number of tiles above 0/],
    ['fog that is no number', { fog: Number.NaN }, {}, /fog NaN must be a number of tiles above 0/],
    ['an ice lane listed twice', { ice: { lanes: [1, 1], speed: 1.6 } }, {}, /ice lane 1 is listed twice/],
    ['an ice lane off the lawn', { ice: { lanes: [5], speed: 1.6 } }, {}, /ice lane 5 is not a whole number 0\.\.4/],
    ['ice speed of 0', { ice: { lanes: [1], speed: 0 } }, {}, /ice speed 0 must be above 0/],
    ['a lava tile off the lawn', { lava: { tiles: [50], dps: 15, burnTicks: 60 } }, {}, /lava tile 50 is not a whole number 0\.\.49/],
    ['a lava tile listed twice', { lava: { tiles: [12, 12], dps: 15, burnTicks: 60 } }, {}, /lava tile 12 \(lane 1, col 2\) is listed twice/],
    ['lava with a negative dps', { lava: { tiles: [12], dps: -1, burnTicks: 60 } }, {}, /lava dps -1 must be a number from 0/],
    ['lava with no burn time', { lava: { tiles: [12], dps: 15, burnTicks: 0 } }, {}, /lava burnTicks 0 must be a whole number from 1/],
    [
      'a prepared plant on a rock', { rocks: [tile(2, 3)] },
      { prepared: [{ unit: 'peashooter', faction: 'plants', lane: 2, x: 3.5, level: 1 }] },
      /prepared unit 0 \(peashooter\) stands on a rock \(lane 2, col 3\)/,
    ],
    [
      'a scripted plant on a rock', { rocks: [tile(4, 7)] },
      { script: [{ tick: 30, unit: 'walnutBomb', faction: 'plants', lane: 4, x: 7.5, level: 1 }] },
      /script entry 0 \(walnutBomb\) stands on a rock \(lane 4, col 7\)/,
    ],
    [
      'the Elder Oak on a rock', { rocks: [tile(3, 0)] },
      { mode: 'boss', boss: { key: 'elderOak', faction: 'plants', lane: 2 } },
      /boss elderOak stands on a rock \(lane 3, col 0\)/,
    ],
  ];

  it.each(refused)('refuses %s', (_name, lawn, more, message) => {
    expect(() => new Match(lawnConfig(1, lawn, more))).toThrow(message);
  });

  it('allows a zombie on a rock tile, a plant next to a rock, a walking boss over rocks, and lava under plants', () => {
    expect(() => new Match(lawnConfig(1, { rocks: [tile(2, 3)], lava: { tiles: [2 * 10 + 4], dps: 15, burnTicks: 60 } }, {
      prepared: [
        { unit: 'peashooter', faction: 'plants', lane: 2, x: 4.5, level: 1 },
        { unit: 'brainEater', faction: 'zombies', lane: 2, x: 3.5, level: 1 },
      ],
    }))).not.toThrow();
    expect(() => new Match(lawnConfig(1, { rocks: [tile(2, 7)] }, { mode: 'boss', boss: { key: 'brainTitan', faction: 'zombies', lane: 2 } }))).not.toThrow();
  });

  it.each(['plants', 'zombies'] as const)('refuses rocks in Free Play (%s), whose gardens are laid on any tile', (side) => {
    const c = freePlayConfig(newSave('p01', 'Lukas', 'peashooter', 0), side, 1);
    expect(c.lawn).toEqual({ rocks: [], fog: null, ice: null, lava: null });
    expect(() => new Match(c)).not.toThrow();
    c.lawn = { ...cloneLawn(NO_TWIST), rocks: [tile(1, 1)] };
    expect(() => new Match(c)).toThrow(/Free Play has no rocks/);
  });

  it('a setup with lawn null is refused with a clear message', () => {
    expect(() => new Match({ ...defaultConfig(1), lawn: null as unknown as LawnConfig })).toThrow(/no lawn/);
  });
});
