import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { LEVELS, levelById, levelsFor } from '../../src/adventure/levels';
import { garden } from '../../src/adventure/levels/helpers';
import { Z4 } from '../../src/adventure/levels/z4';
import { playIdle, standInSave } from '../../src/ai/levelChecks';
import { BALANCE, seconds } from '../../src/data/balance';
import { ALL_CARDS, factionOf } from '../../src/data/units';
import { newSave } from '../../src/progress/save';
import { Match } from '../../src/sim/match';
import { checkLevel } from '../../src/sim/script';
import { LANES, PLANT_COLS } from '../../src/sim/types';
import { w4Controller } from '../app/world4Lessons';

/**
 * The Moonlit Meadow for the zombies (worlds-4 plan Task 7, content design §1 Step 4): kind, fog
 * reach (7, 7, 6, 6, 5, 5, 5, 5), the cards dealt (the first nine zombie cards, Brain Rot from z4-4;
 * a conveyor its belt), the unlock, the clocks, the growing garden of z4-5 and the glove lane of
 * z4-4. The tuned numbers (computer incomes, bases, the Glowcap's hp) are not pinned here:
 * `tools/levels.ts --world 4` measures them.
 *
 * Clocks, pinned below: z4-3 and z4-6 run 300 s, not the designed 240 s (plan ruling 6; z4-6's reason: at 240 s
 * the base that keeps the average player's three stars in band lets the expert break the garden in 1.4 min,
 * under the 1.5 minimum; z4-3 was lengthened for the five-year-old, Task 10). z4-5 runs 330 s (designed 270 s):
 * controller ruling "z4-5 330 s accepted (Task 10, eased for a five-year-old, Michal 2026-11-25)".
 */
const TABLE = [
  { kind: 'battle', fog: 7, cards: 9, seconds: null, unlocks: null },
  { kind: 'battle', fog: 7, cards: 9, seconds: null, unlocks: null },
  { kind: 'breakthrough', fog: 6, cards: 9, seconds: 300, unlocks: 'brainRot' },
  { kind: 'battle', fog: 6, cards: 10, seconds: null, unlocks: null },
  { kind: 'conveyor', fog: 5, cards: 0, seconds: 330, unlocks: null },
  { kind: 'breakthrough', fog: 5, cards: 10, seconds: 300, unlocks: null },
  { kind: 'battle', fog: 5, cards: 10, seconds: null, unlocks: null },
  { kind: 'boss', fog: 5, cards: 10, seconds: null, unlocks: null },
] as const;

const tile = (lane: number, col: number) => `${lane},${col}`;

describe('the Moonlit Meadow for the zombies (z4-1 … z4-8)', () => {
  const levels = levelsFor('zombies', 4);

  it('has z4-1 … z4-8 in order, all zombies in world 4', () => {
    expect(levels.map((l) => l.id)).toEqual(Array.from({ length: 8 }, (_, i) => `z4-${i + 1}`));
    expect(Z4.every((l) => l.world === 4 && l.side === 'zombies')).toBe(true);
  });

  it('follows the table: kinds, fog, cards, clocks, unlocks, spells everywhere, no rocks and no ice', () => {
    levels.forEach((l, i) => {
      const row = TABLE[i]!;
      expect(l.kind, l.id).toBe(row.kind);
      expect(l.twist, l.id).toEqual({ fog: row.fog });
      if (l.kind === 'conveyor') {
        expect(l.cards, l.id).toEqual(l.belt?.cards);
        expect(l.cards, l.id).toEqual(['brainEater', 'veryFastWalker', 'skeletonWarrior', 'hotTopic', 'necromancer', 'brainRot']);
      } else {
        expect(l.cards, l.id).toEqual(ALL_CARDS.zombies.slice(0, row.cards));
      }
      expect(l.seconds, l.id).toBe(row.seconds);
      expect(l.unlocks, l.id).toBe(row.unlocks);
      expect(l.spells, l.id).toBe(true);
      expect(l.boss !== null, l.id).toBe(l.kind === 'boss');
    });
  });

  it('the fog reach of each level reaches the match\'s lawn (7, 7, 6, 6, 5, 5, 5, 5 tiles)', () => {
    expect(levels.map((l) => levelConfig(l, standInSave('average', l), 1).lawn?.fog)).toEqual([7, 7, 6, 6, 5, 5, 5, 5]);
  });

  it('everything scripted is a plant on a plant tile; no two prepared plants share a tile', () => {
    for (const l of levels) {
      for (const s of [...l.waves, ...l.prepared]) {
        expect(factionOf(s.unit), `${l.id} ${s.unit}`).toBe('plants');
        expect(s.lane >= 0 && s.lane < LANES, `${l.id} lane ${s.lane}`).toBe(true);
        expect(s.col !== undefined && s.col >= 0 && s.col < PLANT_COLS, `${l.id} col ${String(s.col)}`).toBe(true);
      }
      const tiles = l.prepared.map((s) => tile(s.lane, s.col!));
      expect(new Set(tiles).size, l.id).toBe(tiles.length);
    }
  });

  it('a regrowing garden (z4-1, z4-5) asks for every tile once and never lands on the starting garden', () => {
    for (const l of levels) {
      const tiles = [...l.prepared, ...l.waves].map((s) => tile(s.lane, s.col!));
      expect(tiles.filter((t, i) => tiles.indexOf(t) !== i), l.id).toEqual([]);
    }
    const z41 = levels[0]!;
    expect(z41.prepared.map((s) => tile(s.lane, s.col!))).toEqual(['1,1', '2,1', '3,1', '2,2']);
    expect(z41.waves.map((s) => s.at)).toEqual([40, 80, 120, 160, 200, 240]);
  });

  it('z4-5 grows as z3-5 does without rocks: 11 Peashooters from 20 s, one every 24 s, on the next free tile', () => {
    const z45 = levels[4]!;
    expect(z45.prepared.map((s) => tile(s.lane, s.col!))).toEqual(['1,2', '3,2', '2,3']);
    expect(z45.waves).toHaveLength(11);
    expect(z45.waves.every((s) => s.unit === 'peashooter')).toBe(true);
    expect(z45.waves.map((s) => s.at)).toEqual(Array.from({ length: 11 }, (_, i) => 20 + i * 24));
    expect(z45.waves.at(-1)!.at).toBeLessThan(z45.seconds!);
    // Lanes 1, 3, 0, 4, 2 in turn, columns 1, 0, 4, 5, 2, 3, 6, 7 in turn: lane 1 first, skipping its (1,2).
    expect(z45.waves.slice(0, 7).map((s) => tile(s.lane, s.col!))).toEqual(['1,1', '1,0', '1,4', '1,5', '1,3', '1,6', '1,7']);
    expect(z45.twist).toEqual({ fog: 5 });
  });

  it('z4-5 plays out: all 11 arrive on free tiles (none skipped) with no zombie in the way', () => {
    // The tuned zombie base is small (the garden's stray shots end an idle match early): a big one lets the whole clock run.
    const l = { ...levels[4]!, baseHp: { ...levels[4]!.baseHp, zombies: 1_000_000 } };
    const m = new Match(levelConfig(l, standInSave('average', l), 1));
    let spawned = 0;
    let skipped = 0;
    for (let i = 0; i < seconds(l.seconds!) - 1; i++) {
      for (const e of m.step()) {
        if (e.type === 'waveSpawned') spawned++;
        if (e.type === 'waveSkipped') skipped++;
      }
    }
    expect([spawned, skipped]).toEqual([11, 0]);
  });

  it('unlocks Brain Rot after z4-3, dealt from z4-4 on (the belt of z4-5 carries it)', () => {
    expect(levels.filter((l) => l.unlocks !== null).map((l) => [l.n, l.unlocks])).toEqual([[3, 'brainRot']]);
    for (const l of levels.filter((x) => x.kind !== 'conveyor')) expect(l.cards.includes('brainRot'), l.id).toBe(l.n >= 4);
    expect(levels[4]!.belt!.cards).toContain('brainRot');
  });

  it('every level passes checkLevel for a fresh player, the one who reaches it, and one holding every card', () => {
    for (const l of levels) {
      const fresh = newSave('p02', 'Kid', 'brainEater', 0);
      const all = { ...fresh, zombies: { ...fresh.zombies, unlocked: [...ALL_CARDS.zombies] } };
      for (const save of [fresh, standInSave('average', l), all]) {
        const c = levelConfig(l, save, 3);
        expect(() => checkLevel(c, BALANCE), l.id).not.toThrow();
        expect(() => new Match(c), l.id).not.toThrow();
      }
      expect(levelConfig(l, standInSave('beginner', l), 3).cards.zombies, l.id).toEqual(l.cards);
    }
  });

  it('the plant base can be hurt on every level (the zombies\' hold-outs are races)', () => {
    for (const l of levels) expect(levelConfig(l, standInSave('average', l), 1).invulnerableBase, l.id).toBeNull();
  });

  it('a level\'s own base health is a whole number from 1 and reaches the match', () => {
    for (const l of levels) {
      const c = levelConfig(l, standInSave('average', l), 1);
      for (const side of ['plants', 'zombies'] as const) {
        const hp = l.baseHp?.[side];
        if (hp !== undefined) expect(Number.isInteger(hp) && hp >= 1, `${l.id} ${hp}`).toBe(true);
        expect(c.baseHp[side], `${l.id} ${side}`).toBe(hp ?? BALANCE.baseHp);
      }
    }
  });

  it('the computers play the plants\' cards only; a battle has one, the others none', () => {
    for (const l of levels) {
      expect(l.opponent !== null, l.id).toBe(l.n === 2 || l.n === 4 || l.n === 7);
      if (l.opponent !== null) {
        expect(l.opponent.skill, l.id).toBe('easy');
        for (const k of l.opponent.cards) expect(factionOf(k), `${l.id} ${k}`).toBe('plants');
        expect(l.opponent.cards.includes('pumpkinSquash'), l.id).toBe(false);
      }
    }
  });

  // Deviation from the design's [0,3] [4,3]: under fog 5 a Peashooter reaches the zombie base only
  // from column 5 (col + 0.5 + 5 >= 10), so a column-3 one never costs a star (everyone 100% three stars).
  it('z4-8: the Glowcap stands in lane 2; the Kernel-pults at [1,1] [3,1], the Peashooters at column 5 where they reach the base', () => {
    const l = levels[7]!;
    expect(l.boss).toEqual({ key: 'glowcap', lane: 2 });
    const c = levelConfig(l, standInSave('average', l), 1);
    expect(c.boss).toMatchObject({ key: 'glowcap', lane: 2 });
    expect(l.prepared.filter((s) => s.unit === 'kernelPult').map((s) => tile(s.lane, s.col!))).toEqual(['1,1', '3,1']);
    expect(l.prepared.filter((s) => s.unit === 'peashooter').map((s) => tile(s.lane, s.col!))).toEqual(['0,5', '4,5']);
    const fog = l.twist!.fog as number;
    for (const s of l.prepared.filter((x) => x.unit === 'peashooter')) expect(s.col! + 0.5 + fog, 'reaches the zombie base').toBeGreaterThanOrEqual(10);
  });

  // The glove lane of z4-4 (`TEACHES`): Brain Rot goes down lane 2 from the spawn edge (col 9).
  it('the z4-4 glove lane is at the spawn edge and accepted by match.check on the real level', () => {
    const l = LEVELS.find((x) => x.id === 'z4-4')!;
    const tiles = l.teaches!.flatMap((s) => (s.show === 'tile' ? [s] : []));
    expect(tiles).toHaveLength(1);
    const t = tiles[0]!;
    expect([t.card, t.lane, t.col]).toEqual(['brainRot', 2, 9]);
    expect(l.cards.includes(t.card)).toBe(true);
    expect(t.col >= PLANT_COLS).toBe(true);
    const m = new Match(levelConfig(l, standInSave('beginner', l), 1));
    expect(m.check({ type: 'place', faction: 'zombies', unit: t.card, lane: t.lane, col: t.col })).toBeNull();
  });

  // A child who does nothing loses every level of the Meadow.
  it('an idle player loses every level (20 seeds)', () => {
    for (const l of levels) {
      const results = Array.from({ length: 20 }, (_, k) => playIdle(l, k + 1));
      expect(results.every((r) => r.end !== 'none'), `${l.id} ends`).toBe(true);
      expect(results.filter((r) => r.won).length, l.id).toBe(0);
    }
  }, 240_000);
});

// Plan ruling 13: z4-3's trap is measured, not assumed. A Brain Eater chewing the column-6 Walnut
// Bomb stands at x 7.10; a shot reaches `min(range, fog)` tiles from the shooter's tile centre
// (col + 0.5), so under fog 6 a shooter at column 0 (reach 6.5) cannot touch it and columns 1-5
// (reach 7.5 and on) can - the spec's "back shooters can't reach the wall" holds for column 0 only,
// for the Peashooter and the lobbing Kernel-pult alike. (Under fog 7 every column reaches it.)
// The level is built as designed (wall column 6, shooters at columns 0-1; the middle lane's only
// shooter is the column-0 Kernel-pult, the trap lane), and the measurement is repeated here.
describe('z4-3: which columns reach a zombie chewing the column-6 Walnut Bomb (ruling 13)', () => {
  const def = levelById('z4-3')!;

  /** Whether `shooter` at column `col` fires at the Brain Eater chewing the wall (lane 2), and where it stood. */
  function reaches(fog: number, shooter: 'peashooter' | 'kernelPult', col: number): { fired: boolean; chewX: number } {
    const d = { ...def, twist: { fog }, startEnergy: 600, prepared: [...garden('walnutBomb', [[2, 6]], 3), ...garden(shooter, [[2, col]])] };
    const m = new Match(levelConfig(d, standInSave('average', d), 1));
    let fired = false;
    let chewX = -1;
    for (let t = 0; t < seconds(40); t++) {
      const events = m.step(t === 0 ? [{ type: 'place', faction: 'zombies', unit: 'brainEater', lane: 2, col: 9 }] : []);
      const z = m.state.units.find((u) => u.faction === 'zombies' && u.lane === 2);
      if (z?.blocked === true) {
        chewX = z.x;
        for (const e of events) if (e.type === 'unitAttacked' && e.attack === 'shot' && e.targetId === z.id) fired = true;
      }
    }
    return { fired, chewX };
  }

  it.each(['peashooter', 'kernelPult'] as const)('fog 6, %s: column 0 cannot reach the biters, columns 1 to 5 can', (shooter) => {
    const seen = [0, 1, 2, 3, 4, 5].map((col) => reaches(6, shooter, col));
    expect(seen.map((r) => r.fired)).toEqual([false, true, true, true, true, true]);
    for (const r of seen) expect(r.chewX).toBeCloseTo(7.1, 1);
  });

  it.each(['peashooter', 'kernelPult'] as const)('fog 7, %s: every column reaches them', (shooter) => {
    expect([0, 1, 2, 3, 4, 5].map((col) => reaches(7, shooter, col).fired)).toEqual([true, true, true, true, true, true]);
  });

  it('the real z4-3 has the wall at column 6 in every lane and a trap lane no shooter of which reaches the wall', () => {
    expect(def.twist).toEqual({ fog: 6 });
    const walls = def.prepared.filter((s) => s.unit === 'walnutBomb');
    expect(walls.map((s) => [s.lane, s.col]).sort()).toEqual([0, 1, 2, 3, 4].map((lane) => [lane, 6]));
    const shooters = def.prepared.filter((s) => s.unit !== 'walnutBomb');
    expect(shooters.every((s) => s.col! <= 1)).toBe(true);
    // A shooter reaches the biters from column 1 on under fog 6 (measured above): a lane whose
    // shooters all stand at column 0 cannot hurt them.
    const trapLanes = [0, 1, 2, 3, 4].filter((lane) => {
      const own = shooters.filter((s) => s.lane === lane);
      return own.length > 0 && own.every((s) => s.col === 0);
    });
    expect(trapLanes).toEqual([2]);
  });
});

// Task 3's carry (the lessons were written against stand-ins): the real z4-1 and z4-4 must keep
// what the lessons need, run through the real lesson controller. z4-1: the fog pan holds the match
// from tick 0 on a fog-7 level (the ghost Brain Eater walks in from the right to the puff point at
// x 8.5, starting at 10.2, and the pea fades there); z4-4: Brain Rot can be picked and then sent
// down lane 2 at col 9.
describe('the real z4-1 and z4-4 teach through the real tutorial', () => {
  const z41 = levelById('z4-1')!;
  const z44 = levelById('z4-4')!;

  it('z4-1: the fog pan holds the match on its first tick, the lawn is fogged to 7, one tap ends it', () => {
    const c = w4Controller(z41);
    expect(c.match.state.config.lawn.fog).toBe(7);
    const t = c.tutorial!;
    expect(t.current?.id).toBe('z4-1.fog');
    c.step();
    expect(t.holding).toBe(true);
    expect(t.twist.peek()).toEqual({ step: 'z4-1.fog', kind: 'fog', holding: true });
    const tick = c.match.state.tick;
    for (let i = 0; i < 20; i++) c.step();
    expect(c.match.state.tick, 'a holding pan stops the clock').toBe(tick);
    c.tapTwist();
    expect(t.current).toBeNull();
    expect(t.taught.peek()).toEqual(['z4-1.fog']);
    c.step();
    expect(c.match.state.tick).toBeGreaterThan(tick);
  });

  it('z4-4: the Brain Rot card, then its lane; the new unit stands there', () => {
    const c = w4Controller(z44);
    const [cardStep, tileStep] = z44.teaches!;
    if (cardStep?.show !== 'card' || tileStep?.show !== 'tile') throw new Error('card then tile');
    for (let i = 0; i < seconds(60) && !c.tutorial!.holding; i++) c.step();
    expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'card', card: 'brainRot' }, holding: true, step: cardStep.id });
    c.select('brainRot');
    const aim = c.tutorial!.glove.peek()!.aim;
    if (aim.kind !== 'tile') throw new Error('tile');
    expect([aim.lane, aim.col]).toEqual([2, 9]);
    expect(c.click({ lane: aim.lane, col: aim.col }, null)).toBeNull();
    c.step();
    expect(c.tutorial!.taught.peek()).toEqual([cardStep.id, tileStep.id]);
    expect(c.match.state.units.some((u) => u.key === 'brainRot' && u.lane === 2)).toBe(true);
  });
});
