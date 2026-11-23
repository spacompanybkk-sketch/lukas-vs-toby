import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { LEVELS, levelsFor } from '../../src/adventure/levels';
import { PLANT_COLS } from '../../src/sim/types';
import { rocks } from '../../src/adventure/levels/helpers';
import { Z3 } from '../../src/adventure/levels/z3';
import { playIdle, standInSave } from '../../src/ai/levelChecks';
import { BALANCE } from '../../src/data/balance';
import { ALL_CARDS, factionOf } from '../../src/data/units';
import { newSave } from '../../src/progress/save';
import { Match } from '../../src/sim/match';
import { checkLevel } from '../../src/sim/script';
import { LANES } from '../../src/sim/types';

/**
 * The Desert Canyon for the zombies (step-3 plan Task 7, content design §1 Step 3): kind, rocks
 * (in the computer's garden), the cards dealt (the first n zombie cards; a conveyor its belt), the
 * unlocks and the glove lanes.
 */
const BACK_ROW: [number, number][] = [[0, 1], [1, 0], [2, 1], [3, 0], [4, 1]];
const TABLE = [
  { kind: 'battle', rocks: [[0, 1], [0, 3], [4, 1], [4, 3]], cards: 7, seconds: null, unlocks: null },
  { kind: 'battle', rocks: BACK_ROW, cards: 7, seconds: null, unlocks: null },
  { kind: 'breakthrough', rocks: [[1, 5], [3, 5], [1, 2], [3, 2]], cards: 7, seconds: 275, unlocks: 'necromancer' },
  { kind: 'battle', rocks: [...BACK_ROW, [2, 6]], cards: 8, seconds: null, unlocks: null },
  { kind: 'conveyor', rocks: [[0, 1], [1, 3], [2, 0], [3, 3], [4, 1], [2, 5]], cards: 0, seconds: 270, unlocks: null },
  { kind: 'breakthrough', rocks: [[0, 4], [4, 4], [1, 1], [3, 1], [0, 6], [4, 6]], cards: 8, seconds: 255, unlocks: 'tridentZombie' },
  { kind: 'battle', rocks: [...BACK_ROW, [2, 6]], cards: 9, seconds: null, unlocks: null },
  { kind: 'boss', rocks: [[0, 2], [4, 2], [0, 5], [4, 5]], cards: 9, seconds: null, unlocks: null },
] as const;

const tile = (lane: number, col: number) => lane * PLANT_COLS + col;

describe('the Desert Canyon for the zombies (z3-1 … z3-8)', () => {
  const levels = levelsFor('zombies', 3);

  it('has z3-1 … z3-8 in order, all zombies in world 3', () => {
    expect(levels.map((l) => l.id)).toEqual(Array.from({ length: 8 }, (_, i) => `z3-${i + 1}`));
    expect(Z3.every((l) => l.world === 3 && l.side === 'zombies')).toBe(true);
  });

  it('follows the table: kinds, rocks, cards, unlocks, spells everywhere', () => {
    levels.forEach((l, i) => {
      const row = TABLE[i]!;
      expect(l.kind, l.id).toBe(row.kind);
      expect(l.twist, l.id).toEqual({ rocks: rocks(row.rocks.map(([a, b]) => [a, b])) });
      if (l.kind === 'conveyor') {
        expect(l.cards, l.id).toEqual(l.belt?.cards);
        expect(l.cards, l.id).toEqual(['brainEater', 'veryFastWalker', 'skeletonWarrior', 'hotTopic', 'necromancer']);
      } else {
        expect(l.cards, l.id).toEqual(ALL_CARDS.zombies.slice(0, row.cards));
      }
      expect(l.unlocks, l.id).toBe(row.unlocks);
      expect(l.spells, l.id).toBe(true);
      expect(l.boss !== null, l.id).toBe(l.kind === 'boss');
      expect(l.seconds, l.id).toBe(row.seconds);
    });
  });

  it('everything scripted is a plant on a plant tile that is not a rock; no two prepared plants share a tile', () => {
    for (const l of levels) {
      const rockTiles = l.twist?.rocks ?? [];
      for (const s of [...l.waves, ...l.prepared]) {
        expect(factionOf(s.unit), `${l.id} ${s.unit}`).toBe('plants');
        expect(s.lane >= 0 && s.lane < LANES, `${l.id} lane ${s.lane}`).toBe(true);
        expect(s.col !== undefined && s.col >= 0 && s.col < PLANT_COLS, `${l.id} col ${String(s.col)}`).toBe(true);
        expect(rockTiles.includes(tile(s.lane, s.col!)), `${l.id} plant on a rock ${s.lane},${String(s.col)}`).toBe(false);
      }
      const tiles = l.prepared.map((s) => `${s.lane},${String(s.col)}`);
      expect(new Set(tiles).size, l.id).toBe(tiles.length);
    }
  });

  it('a regrowing garden (z3-1, z3-5) asks for every tile once and never lands on a rock or the starting garden', () => {
    for (const l of levels) {
      const tiles = [...l.prepared, ...l.waves].map((s) => `${s.lane},${String(s.col)}`);
      expect(tiles.filter((t, i) => tiles.indexOf(t) !== i), l.id).toEqual([]);
    }
    const z31 = levels[0]!;
    expect(z31.waves.map((s) => s.at)).toEqual([40, 80, 120, 160, 200, 240]);
    expect(z31.waves.every((s) => s.lane >= 1 && s.lane <= 3), 'z3-1 regrows in lanes 1-3 only').toBe(true);
    const z35 = levels[4]!;
    expect(z35.waves).toHaveLength(20);
    expect(z35.waves.map((s) => s.at)).toEqual(Array.from({ length: 20 }, (_, i) => 20 + i * 12));
    expect(z35.waves.at(-1)!.at).toBeLessThan(z35.seconds!);
    expect(z35.waves.every((s) => !z35.twist!.rocks!.includes(tile(s.lane, s.col!)))).toBe(true);
    expect(z35.prepared).toHaveLength(3);
  });

  it('z3-8 is rock-free under the Cactus King\'s lanes 1-3 at col 0', () => {
    const z8 = levels[7]!;
    expect(z8.boss).toEqual({ key: 'cactusKing', lane: 2 });
    for (const lane of [1, 2, 3]) expect(z8.twist!.rocks!.includes(tile(lane, 0)), `lane ${lane}`).toBe(false);
  });

  it('unlocks the Necromancer after z3-3 and the Trident Zombie after z3-6, each dealt from the next level on', () => {
    expect(levels.filter((l) => l.unlocks !== null).map((l) => [l.n, l.unlocks])).toEqual([[3, 'necromancer'], [6, 'tridentZombie']]);
    for (const l of levels.filter((x) => x.kind !== 'conveyor')) {
      expect(l.cards.includes('necromancer'), l.id).toBe(l.n >= 4);
      expect(l.cards.includes('tridentZombie'), l.id).toBe(l.n >= 7);
    }
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

  // The glove lanes (`TEACHES`): z3-4's Necromancer goes down lane 2 and z3-7's Trident down lane 1;
  // the real level must accept the move, and the glove sits at the spawn edge, off the rock tiles
  // (zombies walk over rocks anyway).
  it('the glove lanes of z3-4 and z3-7 are accepted by match.check and are not rocks on the real levels', () => {
    for (const id of ['z3-4', 'z3-7']) {
      const l = LEVELS.find((x) => x.id === id)!;
      const tiles = l.teaches!.flatMap((s) => (s.show === 'tile' ? [s] : []));
      expect(tiles.length, id).toBe(1);
      const t = tiles[0]!;
      // A zombie glove points at the spawn edge (col 9), beyond the plant columns where rocks stand.
      expect(t.col >= PLANT_COLS, `${id} glove col ${t.col} is off the plant grid`).toBe(true);
      const m = new Match(levelConfig(l, standInSave('beginner', l), 1));
      expect(l.cards.includes(t.card)).toBe(true);
      expect(m.check({ type: 'place', faction: 'zombies', unit: t.card, lane: t.lane, col: t.col }), id).toBeNull();
    }
  });

  it('z3-1 has the rocks pan and rocks in lanes 0 and 4 only', () => {
    const l = levels[0]!;
    expect(l.teaches?.[0]).toMatchObject({ show: 'twist' });
    expect(l.twist!.rocks!.every((r) => Math.floor(r / PLANT_COLS) === 0 || Math.floor(r / PLANT_COLS) === 4)).toBe(true);
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

  // A child who does nothing loses every level of the Canyon.
  it('an idle player loses every level (20 seeds)', () => {
    for (const l of levels) {
      const results = Array.from({ length: 20 }, (_, k) => playIdle(l, k + 1));
      expect(results.every((r) => r.end !== 'none'), `${l.id} ends`).toBe(true);
      expect(results.filter((r) => r.won).length, l.id).toBe(0);
    }
  }, 240_000);
});
