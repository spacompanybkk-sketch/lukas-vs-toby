import { describe, expect, it } from 'vitest';
import { lawnOf, levelConfig } from '../../src/adventure/campaign';
import { freePlayConfig } from '../../src/adventure/freePlay';
import type { LevelDef } from '../../src/adventure/types';
import { BALANCE } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { newSave } from '../../src/progress/save';
import { cloneLawn, NO_TWIST } from '../../src/sim/lawn';
import { Match, defaultConfig } from '../../src/sim/match';
import { randomInt } from '../../src/sim/rng';
import { SPELLS } from '../../src/sim/spells';
import { COLS, LANES, PLANT_COLS } from '../../src/sim/types';
import type { Command, Faction, LawnConfig, MatchConfig } from '../../src/sim/types';
import { SAMPLE_BATTLE } from '../adventure/sampleLevels';

/** The default setup with `lawn` merged into NO_TWIST. */
function lawnConfig(seed: number, lawn: Partial<LawnConfig>, more: Partial<MatchConfig> = {}): MatchConfig {
  return { ...defaultConfig(seed), ...more, lawn: { ...cloneLawn(NO_TWIST), ...lawn } };
}

const tile = (lane: number, col: number): number => lane * PLANT_COLS + col;

/** Nobody plays: no hands, heroes, spells or sudden death; only what a test puts on the lawn acts. */
const quiet = (): Partial<MatchConfig> => ({
  cards: { plants: [], zombies: [] }, heroes: { plants: false, zombies: false }, spells: { plants: 0, zombies: 0 }, suddenDeath: false,
});

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

describe('rocks: no plant can be put on a rock tile', () => {
  const ROCK = tile(2, 3);
  const rocky = (more: Partial<MatchConfig> = {}): MatchConfig => lawnConfig(1, { rocks: [ROCK] }, { startEnergy: { plants: 1000, zombies: 1000 }, ...more });

  it('a card: match.check says rock, the step refuses it, the tile next to it is fine', () => {
    const m = new Match(rocky());
    const onRock = { type: 'place', faction: 'plants', unit: 'peashooter', lane: 2, col: 3 } as const;
    expect(m.check(onRock)).toBe('rock');
    const events = m.step([onRock, { type: 'place', faction: 'plants', unit: 'sunflower', lane: 2, col: 4 }]);
    expect(events).toContainEqual({ type: 'commandRejected', command: onRock, reason: 'rock' });
    expect(m.state.units.map((u) => [u.key, u.lane, u.x])).toEqual([['sunflower', 2, 4.5]]);
    expect(m.state.players.plants.energy).toBe(1000 - 50); // nothing paid for the refused one
  });

  it('zombies walk over rocks and are placed in a lane with rocks', () => {
    const m = new Match(rocky());
    const z = { type: 'place', faction: 'zombies', unit: 'veryFastWalker', lane: 2, col: 0 } as const;
    expect(m.check(z)).toBeNull();
    m.step([z]);
    while (m.state.tick < 400 && m.state.units[0]!.x > 3) m.step();
    expect(m.state.units[0]!.x).toBeLessThan(3); // it passed column 3
  });

  it('a belt card: refused rock, the rest of the belt rules unchanged', () => {
    const m = new Match(rocky({ mode: 'conveyor', goalTicks: 900, noEnergy: true, invulnerableBase: 'zombies', belt: { side: 'plants', everyTicks: 30, cards: ['peashooter'], slots: 5 } }));
    m.step();
    const cmd = { type: 'belt', faction: 'plants', slot: 0, lane: 2, col: 3 } as const;
    expect(m.check(cmd)).toBe('rock');
    expect(m.check({ ...cmd, col: 2 })).toBeNull();
  });

  it('the Rock Wall spell: refused rock', () => {
    const m = new Match(rocky());
    m.state.players.plants.spells = [{ key: 'rockWall', timer: 0 }];
    const cmd = { type: 'spell', faction: 'plants', spell: 'rockWall', lane: 2, col: 3 } as const;
    expect(m.check(cmd)).toBe('rock');
    expect(m.check({ ...cmd, col: 4 })).toBeNull();
  });

  it("a plant boss's summon leaves rock tiles out", () => {
    // The Elder Oak summons Peashooters on free tiles in columns 1..4: rocks on all but two of them.
    const open = [tile(0, 2), tile(3, 4)];
    const rocks: number[] = [];
    for (let lane = 0; lane < 5; lane++) for (let col = 1; col <= 4; col++) if (!open.includes(tile(lane, col))) rocks.push(tile(lane, col));
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = new Match(lawnConfig(seed, { rocks }, { mode: 'boss', boss: { key: 'elderOak', faction: 'plants', lane: 2 }, cards: { plants: [], zombies: [] } }));
      while (m.state.tick < 30 * 25) m.step();
      const summoned = m.state.units.filter((u) => u.key === 'peashooter').map((u) => tile(u.lane, Math.floor(u.x))).sort((a, b) => a - b);
      expect(summoned).toEqual(open);
    }
  });

  it('without rocks nothing is refused rock', () => {
    const m = new Match(defaultConfig(1));
    expect(m.check({ type: 'place', faction: 'plants', unit: 'peashooter', lane: 2, col: 3 })).toBeNull();
  });
});

describe('fog: a shot reaches min(range, fog) and fades out past it', () => {
  const FOG = 5;
  /** A plant setup: one Peashooter prepared on (2, col); nobody else plays. */
  function peashooterAt(col: number, fog: number | null = FOG, more: Partial<MatchConfig> = {}): Match {
    return new Match(lawnConfig(1, { fog }, {
      ...quiet(),
      prepared: [{ unit: 'peashooter', faction: 'plants', lane: 2, x: col + 0.5, level: 1 }], ...more,
    }));
  }
  const run = (m: Match, ticks: number) => {
    const events = [];
    for (let i = 0; i < ticks; i++) events.push(...m.step());
    return events;
  };

  it.each([0, 1, 2, 3, 4])('a Peashooter on column %i never hurts the zombie base', (col) => {
    const m = peashooterAt(col);
    const events = run(m, 600);
    expect(events.filter((e) => e.type === 'projectileSpawned').length).toBeGreaterThan(5); // it keeps firing at the base
    expect(events.some((e) => e.type === 'baseDamaged')).toBe(false);
    expect(m.state.baseHp.zombies).toBe(m.state.baseMaxHp.zombies);
  });

  it.each([5, 6, 7])('a Peashooter on column %i (>= 10 − fog) does', (col) => {
    const m = peashooterAt(col);
    const events = run(m, 600);
    expect(events.some((e) => e.type === 'baseDamaged' && e.faction === 'zombies')).toBe(true);
    expect(events.some((e) => e.type === 'projectileFaded')).toBe(false);
  });

  it('every pea that fades says so exactly once, at fadeX, and leaves the lawn', () => {
    const m = peashooterAt(0);
    const fired = new Map<number, number>();
    const faded = new Map<number, number>();
    for (let i = 0; i < 400; i++) {
      for (const e of m.step()) {
        if (e.type === 'projectileSpawned') fired.set(e.projectileId, e.x);
        if (e.type === 'projectileFaded') {
          expect(faded.has(e.id)).toBe(false);
          faded.set(e.id, e.x);
          expect(e.lane).toBe(2);
          expect(m.state.projectiles.some((p) => p.id === e.id)).toBe(false);
        }
      }
      for (const p of m.state.projectiles) expect(p.fadeX).toBe(fired.get(p.id)! + FOG);
    }
    expect(faded.size).toBeGreaterThan(5);
    for (const [id, x] of faded) expect(x).toBe(fired.get(id)! + FOG);
    for (const id of fired.keys()) if (!m.state.projectiles.some((p) => p.id === id)) expect(faded.has(id)).toBe(true);
  });

  it('a zombie beyond reach is not hit; one within reach is', () => {
    for (const [x, hit] of [[6.2, false], [5.6, false], [5.2, true], [3.5, true]] as const) {
      const m = peashooterAt(0, FOG, { prepared: [
        { unit: 'peashooter', faction: 'plants', lane: 2, x: 0.5, level: 1 },
        { unit: 'skeletonWarrior', faction: 'zombies', lane: 2, x, level: 1 },
      ] });
      m.step();
      const z = m.state.units.find((u) => u.faction === 'zombies')!;
      z.stun = 10_000; // it stands where it is
      z.abilityTimer = 10_000; // and its shield never blocks
      run(m, 300);
      expect([x, z.hp < z.maxHp]).toEqual([x, hit]);
    }
  });

  it('without fog the same Peashooter on column 0 hits the base, and its peas carry no fadeX', () => {
    const m = peashooterAt(0, null);
    let sawPea = false;
    for (let i = 0; i < 600; i++) {
      m.step();
      for (const p of m.state.projectiles) {
        sawPea = true;
        expect(p.fadeX).toBeNull();
      }
    }
    expect(sawPea).toBe(true);
    expect(m.state.baseHp.zombies).toBeLessThan(m.state.baseMaxHp.zombies);
  });

  it('a zombie shooter holds its shot until a plant is within fog, and walks on until then', () => {
    // The Skeleton Archer (range 6) stops to shoot a plant in range; in fog 5 it walks to 5 first.
    const m = new Match(lawnConfig(1, { fog: 3 }, {
      ...quiet(),
      prepared: [
        { unit: 'walnutBomb', faction: 'plants', lane: 1, x: 0.5, level: 1 },
        { unit: 'skeletonArcher', faction: 'zombies', lane: 1, x: 9.5, level: 1 },
      ],
    }));
    let firstShotFrom: number | null = null;
    for (let i = 0; i < 1500 && firstShotFrom === null; i++) {
      for (const e of m.step()) if (e.type === 'projectileSpawned' && e.faction === 'zombies') firstShotFrom = e.x;
    }
    expect(firstShotFrom).not.toBeNull();
    expect(firstShotFrom! - 0.5).toBeLessThanOrEqual(3);
    expect(firstShotFrom! - 0.5).toBeGreaterThan(2.9);
  });

  it.each([[FOG, true], [null, false]] as const)('fog %s: a trident pierces the plant in reach, then fades (%s) instead of hitting the base', (fog, fades) => {
    const m = new Match(lawnConfig(1, { fog }, {
      ...quiet(),
      prepared: [
        { unit: 'walnutBomb', faction: 'plants', lane: 0, x: 2.5, level: 1 },
        { unit: 'tridentZombie', faction: 'zombies', lane: 0, x: 7.4, level: 1 },
      ],
    }));
    let trident: number | null = null;
    let fadedAt: number | null = null;
    let baseHit = false;
    let plantHit = false;
    for (let i = 0; i < 300 && fadedAt === null && !baseHit; i++) {
      for (const e of m.step()) {
        if (e.type === 'projectileSpawned' && e.kind === 'trident' && trident === null) trident = e.projectileId;
        if (e.type === 'projectileHit' && e.projectileId === trident && e.targetId !== null) plantHit = true;
        if (e.type === 'projectileHit' && e.projectileId === trident && e.targetBase === 'plants') baseHit = true;
        if (e.type === 'projectileFaded' && e.id === trident) fadedAt = e.x;
      }
    }
    expect(trident).not.toBeNull();
    expect(plantHit).toBe(true);
    expect([fadedAt !== null, baseHit]).toEqual([fades, !fades]);
    if (fades) expect(fadedAt! > 1.5 && fadedAt! < 2.5).toBe(true); // past the plant, short of the base
  });

  it('a lobbed shot aimed at a unit has no fadeX and lands; an unaimed one fades', () => {
    const m = new Match(lawnConfig(1, { fog: FOG }, {
      ...quiet(),
      prepared: [
        { unit: 'kernelPult', faction: 'plants', lane: 3, x: 0.5, level: 1 },
        { unit: 'skeletonWarrior', faction: 'zombies', lane: 3, x: 4.5, level: 1 },
        { unit: 'kernelPult', faction: 'plants', lane: 1, x: 0.5, level: 1 },
      ],
    }));
    const lane = new Map<number, number>();
    const fadedLanes: number[] = [];
    for (let i = 0; i < 200; i++) {
      for (const e of m.step()) {
        if (e.type === 'projectileSpawned') lane.set(e.projectileId, e.lane);
        if (e.type === 'projectileFaded') fadedLanes.push(lane.get(e.id)!);
      }
      for (const p of m.state.projectiles) {
        if (p.targetId !== null) expect(p.fadeX).toBeNull();
        else expect(p.fadeX).toBe(0.5 + FOG);
      }
      const z = m.state.units.find((u) => u.key === 'skeletonWarrior');
      if (z) z.x = 4.5; // it stays in reach
    }
    expect(fadedLanes.length).toBeGreaterThan(3);
    expect(new Set(fadedLanes)).toEqual(new Set([1])); // only the lane with nobody to aim at
  });
});

describe('ice: zombies in the listed lanes walk ×speed', () => {

  it('a walker in an ice lane covers 1.6× the distance of one in a plain lane over 90 ticks', () => {
    const m = new Match(lawnConfig(1, { ice: { lanes: [1, 3], speed: 1.6 } }, {
      ...quiet(),
      prepared: [
        { unit: 'brainEater', faction: 'zombies', lane: 1, x: 9.5, level: 1 },
        { unit: 'brainEater', faction: 'zombies', lane: 2, x: 9.5, level: 1 },
        { unit: 'veryFastWalker', faction: 'zombies', lane: 3, x: 9.5, level: 1 },
        { unit: 'veryFastWalker', faction: 'zombies', lane: 4, x: 9.5, level: 1 },
      ],
    }));
    m.step(); // they come on
    const start = m.state.units.map((u) => u.x);
    for (let i = 0; i < 90; i++) m.step();
    const walked = m.state.units.map((u, i) => start[i]! - u.x);
    expect(walked[1]!).toBeGreaterThan(0);
    expect(walked[0]! / walked[1]!).toBeCloseTo(1.6, 9);
    expect(walked[2]! / walked[3]!).toBeCloseTo(1.6, 9);
  });

  it('a boss on ice walks faster too; plants are not moved', () => {
    const titan = (ice: boolean) => {
      const m = new Match(lawnConfig(1, { ice: ice ? { lanes: [2], speed: 1.6 } : null }, {
        ...quiet(), mode: 'boss', boss: { key: 'brainTitan', faction: 'zombies', lane: 2 },
        prepared: [{ unit: 'peashooter', faction: 'plants', lane: 2, x: 0.5, level: 1 }],
      }));
      for (let i = 0; i < 120; i++) m.step();
      const boss = m.state.units.find((u) => u.key === 'brainTitan')!;
      expect(m.state.units.find((u) => u.key === 'peashooter')!.x).toBe(0.5);
      return 9.5 - boss.x;
    };
    expect(titan(true) / titan(false)).toBeCloseTo(1.6, 9);
  });

  it('haste and ice multiply', () => {
    const m = new Match(lawnConfig(1, { ice: { lanes: [0], speed: 1.6 } }, {
      ...quiet(), prepared: [
        { unit: 'brainEater', faction: 'zombies', lane: 0, x: 9.5, level: 1 },
        { unit: 'brainEater', faction: 'zombies', lane: 1, x: 9.5, level: 1 },
      ],
    }));
    m.step();
    for (const u of m.state.units) u.haste = 1000;
    const start = m.state.units.map((u) => u.x);
    for (let i = 0; i < 30; i++) m.step();
    const walked = m.state.units.map((u, i) => start[i]! - u.x);
    expect(walked[0]! / walked[1]!).toBeCloseTo(1.6, 9);
  });
});

describe('lava: whoever stands on a lava tile burns, either side, bosses too', () => {
  const LAVA = (tiles: number[]) => ({ tiles, dps: 15, burnTicks: 60 });
  const lavaTile = (lane: number, col: number): number => lane * 10 + col;

  it('a plant on lava burns 15 a second, reported once, topped up while it stands there', () => {
    const m = new Match(lawnConfig(1, { lava: LAVA([lavaTile(2, 3)]) }, {
      ...quiet(), prepared: [
        { unit: 'walnutBomb', faction: 'plants', lane: 2, x: 3.5, level: 1 },
        { unit: 'walnutBomb', faction: 'plants', lane: 2, x: 4.5, level: 1 },
      ],
    }));
    const applied: number[] = [];
    for (let i = 0; i < 301; i++) for (const e of m.step()) if (e.type === 'statusApplied') applied.push(e.unitId);
    const [onLava, beside] = m.state.units;
    expect(applied).toEqual([onLava!.id]);
    expect(onLava!.maxHp - onLava!.hp).toBe(15 * 11); // ticks 0, 30, …, 300: eleven whole seconds
    expect(onLava!.burn).toBe(59);
    expect(beside!.hp).toBe(beside!.maxHp);
  });

  it('a zombie walking over lava burns, and the burn stops burnTicks after it steps off', () => {
    const m = new Match(lawnConfig(1, { lava: LAVA([lavaTile(1, 7)]) }, {
      ...quiet(), prepared: [{ unit: 'veryFastWalker', faction: 'zombies', lane: 1, x: 8.2, level: 1 }],
    }));
    let lastOnLava = -1;
    let ended = -1;
    while (m.state.tick < 600 && ended < 0) {
      const tick = m.state.tick;
      const events = m.step();
      const z = m.state.units[0]!;
      if (Math.floor(z.x) === 7) lastOnLava = tick;
      if (events.some((e) => e.type === 'statusEnded' && e.status === 'burn')) ended = tick;
    }
    expect(lastOnLava).toBeGreaterThan(0);
    expect(ended - lastOnLava).toBe(60 - 1); // put on at 60 on its last tick there, then 59 ticks to run out
    expect(m.state.units[0]!.hp).toBeLessThan(m.state.units[0]!.maxHp);
  });

  it('a unit that dies on lava leaves the lawn and nothing more is said of its burn', () => {
    const m = new Match(lawnConfig(1, { lava: { tiles: [lavaTile(0, 2)], dps: 1000, burnTicks: 60 } }, {
      ...quiet(), prepared: [{ unit: 'peashooter', faction: 'plants', lane: 0, x: 2.5, level: 1 }],
    }));
    const id = m.state.nextId;
    const about: string[] = [];
    for (let i = 0; i < 200; i++) {
      for (const e of m.step()) if ('unitId' in e && e.unitId === id) about.push(e.type);
    }
    expect(about.slice(-1)).toEqual(['unitDied']);
    expect(about.filter((t) => t === 'statusApplied')).toEqual(['statusApplied']);
    expect(m.state.units).toEqual([]);
  });

  it('the Brain Titan burns walking over lava; the Elder Oak burns in any lane it stands in', () => {
    const titan = new Match(lawnConfig(1, { lava: LAVA([lavaTile(2, 9)]) }, { ...quiet(), mode: 'boss', boss: { key: 'brainTitan', faction: 'zombies', lane: 2 } }));
    for (let i = 0; i < 90; i++) titan.step();
    expect(titan.state.units[0]!.burn).toBeGreaterThan(0);
    expect(titan.state.units[0]!.hp).toBeLessThan(titan.state.units[0]!.maxHp);

    const oak = new Match(lawnConfig(1, { lava: LAVA([lavaTile(3, 0)]) }, { ...quiet(), mode: 'boss', boss: { key: 'elderOak', faction: 'plants', lane: 2 } }));
    for (let i = 0; i < 90; i++) oak.step();
    expect(oak.state.units[0]!.key).toBe('elderOak');
    expect(oak.state.units[0]!.burn).toBe(59);
    expect(oak.state.units[0]!.maxHp - oak.state.units[0]!.hp).toBe(15 * 3);
  });

  it('plants may be put on lava', () => {
    const m = new Match(lawnConfig(1, { lava: LAVA([lavaTile(2, 3)]) }));
    expect(m.check({ type: 'place', faction: 'plants', unit: 'peashooter', lane: 2, col: 3 })).toBeNull();
  });
});

describe('fuzz (Review Focus 1): random twists, a snapshot at a random tick restores to the same final checksum', () => {
  type Rng = { rng: number };
  const MATCHES = 200;
  const TICKS = 900;

  /** `n` distinct whole numbers drawn from 0..max-1. */
  function distinct(r: Rng, n: number, max: number): number[] {
    const pool = Array.from({ length: max }, (_, i) => i);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(pool.splice(randomInt(r, pool.length), 1)[0]!);
    return out;
  }

  function randomSetup(seed: number, r: Rng): MatchConfig {
    const c = defaultConfig(seed);
    c.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
    c.startEnergy = { plants: 400, zombies: 400 };
    c.incomeMultiplier = { plants: 2, zombies: 2 };
    const lawn = cloneLawn(NO_TWIST);
    if (randomInt(r, 2) === 0) lawn.rocks = distinct(r, 1 + randomInt(r, 6), LANES * PLANT_COLS);
    if (randomInt(r, 2) === 0) lawn.fog = [2, 3, 3.5, 5, 6][randomInt(r, 5)]!;
    if (randomInt(r, 2) === 0) lawn.ice = { lanes: distinct(r, 1 + randomInt(r, 3), LANES), speed: [1.3, 1.6, 2][randomInt(r, 3)]! };
    if (randomInt(r, 2) === 0) lawn.lava = { tiles: distinct(r, 2 + randomInt(r, 8), LANES * COLS), dps: 15, burnTicks: 60 };
    const roll = randomInt(r, 5);
    if (roll === 0) {
      c.mode = 'boss';
      c.boss = { key: 'brainTitan', faction: 'zombies', lane: randomInt(r, LANES) };
    } else if (roll === 1) {
      c.mode = 'boss';
      c.boss = { key: 'elderOak', faction: 'plants', lane: 1 + randomInt(r, 3) };
      const oakTiles = [0, 1, 2].map((d) => (c.boss!.lane - 1 + d) * PLANT_COLS + 0);
      lawn.rocks = lawn.rocks.filter((t) => !oakTiles.includes(t));
    }
    c.lawn = lawn;
    return c;
  }

  function randomCommands(r: Rng, tick: number): Command[] {
    const out: Command[] = [];
    for (const faction of ['plants', 'zombies'] as const satisfies readonly Faction[]) {
      if (randomInt(r, 6) === 0) {
        const unit = ALL_CARDS[faction][randomInt(r, ALL_CARDS[faction].length)]!;
        out.push({ type: 'place', faction, unit, lane: randomInt(r, LANES), col: randomInt(r, PLANT_COLS) });
      }
      if (tick % 97 === 0) out.push({ type: 'hero', faction, lane: randomInt(r, LANES) });
      if (randomInt(r, 40) === 0) {
        out.push({ type: 'spell', faction, spell: SPELLS[faction][randomInt(r, 5)]!, lane: randomInt(r, LANES), col: randomInt(r, COLS) });
      }
    }
    return out;
  }

  it(`${MATCHES} matches, ${TICKS} ticks each`, () => {
    let midBurn = 0;
    let midFade = 0;
    let refusedRock = 0;
    for (let seed = 1; seed <= MATCHES; seed++) {
      const r: Rng = { rng: (seed * 0x9e3779b1) >>> 0 };
      const config = randomSetup(seed, r);
      const a = new Match(config);
      const at = 1 + randomInt(r, TICKS - 1);
      const commands: Command[][] = [];
      let snapshot = '';
      let snapshotHash = 0;
      while (a.state.winner === null && a.state.tick < TICKS) {
        if (a.state.tick === at) {
          snapshot = a.snapshot();
          snapshotHash = a.hash();
          const lava = a.state.config.lawn.lava;
          if (lava !== null && a.state.units.some((u) => u.burn > 0 && lava.tiles.includes(u.lane * COLS + Math.floor(u.x)))) midBurn += 1;
          if (a.state.projectiles.some((p) => p.fadeX !== null)) midFade += 1;
        }
        const cmds = randomCommands(r, a.state.tick);
        commands.push(cmds);
        for (const e of a.step(cmds)) if (e.type === 'commandRejected' && e.reason === 'rock') refusedRock += 1;
      }
      if (snapshot === '') continue; // over before the snapshot tick
      const b = Match.restore(snapshot);
      expect(b.hash()).toBe(snapshotHash);
      while (b.state.winner === null && b.state.tick < TICKS) b.step(commands[b.state.tick]!);
      expect([seed, b.state.tick, b.hash()]).toEqual([seed, a.state.tick, a.hash()]);
    }
    // The sweep did reach the moments Review Focus 1 names.
    expect(midBurn).toBeGreaterThan(10);
    expect(midFade).toBeGreaterThan(10);
    expect(refusedRock).toBeGreaterThan(10);
  });
});
