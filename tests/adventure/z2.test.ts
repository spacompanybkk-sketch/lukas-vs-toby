import { describe, expect, it } from 'vitest';
import { isOpen, lawnOf, levelConfig, nextLevel } from '../../src/adventure/campaign';
import { LEVELS, levelsFor } from '../../src/adventure/levels';
import { TEACHES } from '../../src/adventure/levels/teaches';
import { Z2 } from '../../src/adventure/levels/z2';
import { playIdle, standInSave } from '../../src/ai/levelChecks';
import { BALANCE } from '../../src/data/balance';
import { ALL_CARDS, factionOf } from '../../src/data/units';
import { newSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { Match } from '../../src/sim/match';
import { checkLevel } from '../../src/sim/script';
import { LANES, PLANT_COLS } from '../../src/sim/types';
import { mapIslands, mapStones, openingWorld } from '../../src/ui/screens/mapModel';

/**
 * The Frozen Tundra (step-2 plan Task 7, content design §1): kind, icy lanes, the cards dealt (the
 * first n zombie cards; a conveyor its belt), and the unlock of each level.
 */
const TABLE = [
  { kind: 'battle', ice: [2], cards: 5, unlocks: null },
  { kind: 'battle', ice: [1, 3], cards: 5, unlocks: null },
  { kind: 'breakthrough', ice: [2], cards: 5, unlocks: 'hotTopic' },
  { kind: 'battle', ice: [1, 3], cards: 6, unlocks: null },
  { kind: 'conveyor', ice: [0, 2, 4], cards: 0, unlocks: null },
  { kind: 'breakthrough', ice: [0, 2, 4], cards: 6, unlocks: 'cowboyZombie' },
  { kind: 'battle', ice: [0, 1, 3, 4], cards: 7, unlocks: null },
  { kind: 'boss', ice: [0, 1, 3, 4], cards: 7, unlocks: null },
] as const;

describe('the Frozen Tundra (z2-1 … z2-8)', () => {
  const levels = levelsFor('zombies', 2);

  it('has z2-1 … z2-8 in order, all zombies in world 2', () => {
    expect(levels.map((l) => l.id)).toEqual(Array.from({ length: 8 }, (_, i) => `z2-${i + 1}`));
    expect(Z2.every((l) => l.world === 2 && l.side === 'zombies')).toBe(true);
  });

  it('follows the table: kinds, icy lanes, cards, unlocks, spells everywhere, and never all five lanes iced', () => {
    levels.forEach((l, i) => {
      const row = TABLE[i]!;
      expect(l.kind, l.id).toBe(row.kind);
      expect(l.twist, l.id).toEqual({ iceLanes: row.ice });
      expect(lawnOf(l.twist).ice, l.id).toEqual({ lanes: row.ice, speed: BALANCE.twists.ice.speed });
      // A plain lane is always left: icing all five would take the lane choice away.
      expect(row.ice.length, l.id).toBeLessThan(LANES);
      if (l.kind === 'conveyor') {
        expect(l.cards, l.id).toEqual(l.belt?.cards);
        expect(l.cards, l.id).toEqual(['brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'hotTopic']);
      } else {
        expect(l.cards, l.id).toEqual(ALL_CARDS.zombies.slice(0, row.cards));
      }
      expect(l.unlocks, l.id).toBe(row.unlocks);
      expect(l.spells, l.id).toBe(true);
      expect(l.boss !== null, l.id).toBe(l.kind === 'boss');
      expect((l.seconds !== null), l.id).toBe(l.kind === 'breakthrough' || l.kind === 'conveyor');
    });
  });

  it('everything scripted is a plant on a plant tile; no two prepared plants share a tile', () => {
    for (const l of levels) {
      for (const s of [...l.waves, ...l.prepared]) {
        expect(factionOf(s.unit), `${l.id} ${s.unit}`).toBe('plants');
        expect(s.lane >= 0 && s.lane < LANES, `${l.id} lane ${s.lane}`).toBe(true);
        expect(s.col !== undefined && s.col >= 0 && s.col < PLANT_COLS, `${l.id} col ${String(s.col)}`).toBe(true);
      }
      const tiles = l.prepared.map((s) => `${s.lane},${String(s.col)}`);
      expect(new Set(tiles).size, l.id).toBe(tiles.length);
    }
  });

  it('unlocks Hot Topic after z2-3 and the Cowboy Zombie after z2-6, each dealt from the next level on', () => {
    expect(levels.filter((l) => l.unlocks !== null).map((l) => [l.n, l.unlocks])).toEqual([[3, 'hotTopic'], [6, 'cowboyZombie']]);
    for (const l of levels) {
      expect(l.cards.includes('hotTopic'), l.id).toBe(l.n >= 4);
      expect(l.cards.includes('cowboyZombie'), l.id).toBe(l.n >= 7);
    }
  });

  it('every level passes checkLevel for a fresh player, for the player who reaches it, and for one holding every card', () => {
    for (const l of levels) {
      const fresh = newSave('p02', 'Kid', 'brainEater', 0);
      const all = { ...fresh, zombies: { ...fresh.zombies, unlocked: [...ALL_CARDS.zombies] } };
      for (const save of [fresh, standInSave('average', l), all]) {
        const c = levelConfig(l, save, 3);
        expect(() => checkLevel(c, BALANCE), l.id).not.toThrow();
        expect(() => new Match(c), l.id).not.toThrow();
      }
      // The player who reaches the level holds every card it deals.
      expect(levelConfig(l, standInSave('beginner', l), 3).cards.zombies, l.id).toEqual(l.cards);
    }
  });

  it('the plant base can be hurt on every level (the zombies\' hold-outs are races)', () => {
    for (const l of levels) expect(levelConfig(l, standInSave('average', l), 1).invulnerableBase, l.id).toBeNull();
  });

  it('the Frost Melon stands on the plain middle lane of z2-8, ice on the four lanes round it (ruling 3)', () => {
    const z8 = levels[7]!;
    const c = levelConfig(z8, standInSave('average', z8), 1);
    expect(c.boss).toEqual({ key: 'frostMelon', faction: 'plants', lane: 2 });
    expect(c.lawn.ice?.lanes).toEqual([0, 1, 3, 4]);
  });

  // What the lessons (`TEACHES`) need of these levels: the ice pan on z2-1 wants icy lanes; the
  // glove of z2-4 points Hot Topic down lane 0 and that of z2-7 the Cowboy down lane 2, so those
  // lanes are plain (not iced) and nothing stands in them at the start.
  it('the lessons fit: z2-1 has ice, z2-4 deals Hot Topic with lane 0 open, z2-7 the Cowboy with lane 2 open', () => {
    const cfg = (n: number) => levelConfig(levels[n - 1]!, standInSave('beginner', levels[n - 1]!), 1);
    expect(TEACHES['z2-1']).toEqual([{ id: 'z2-1.ice', show: 'twist', until: 'tapped' }]);
    expect(cfg(1).lawn.ice?.lanes.length).toBeGreaterThan(0);
    for (const [n, card, lane] of [[4, 'hotTopic', 0], [7, 'cowboyZombie', 2]] as const) {
      const c = cfg(n);
      expect(c.cards.zombies, `z2-${n}`).toContain(card);
      expect(c.lawn.ice?.lanes ?? [], `z2-${n}`).not.toContain(lane);
      expect(c.prepared.filter((u) => u.lane === lane), `z2-${n}`).toEqual([]);
    }
    expect(cfg(8).lawn.ice?.lanes).not.toContain(levels[7]!.boss!.lane);
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

  // Review Focus 3: a child who does nothing loses every level of the Tundra (none is a level where
  // waiting is the lesson). The same check as the bands' (`playIdle`: the beginner's save, nobody in
  // his seat, the level's own computer).
  it('an idle player loses every level (20 seeds)', () => {
    for (const l of levels) {
      const results = Array.from({ length: 20 }, (_, k) => playIdle(l, k + 1));
      expect(results.every((r) => r.end !== 'none'), `${l.id} ends`).toBe(true);
      expect(results.filter((r) => r.won).length, l.id).toBe(0);
    }
  }, 180_000);
});

// The zombie campaign goes on: z1-8's result leads to z2-1 and the map opens on the Tundra, as
// p1-8 leads to p2-1 (the shipped level list, no stand-in worlds).
describe('from the Backyard to the Tundra', () => {
  const stars = (ids: string[]): Save => {
    const s = newSave('p02', 'Toby', 'brainEater', 0);
    return { ...s, zombies: { stars: Object.fromEntries(ids.map((id) => [id, 1])), unlocked: ['desertZombie', 'skeletonArcher'] } };
  };
  const w1 = levelsFor('zombies', 1).map((l) => l.id);

  it('z2-1 is closed until z1-8 has a star, then it is next and the Tundra island opens', () => {
    const before = stars(w1.slice(0, 7));
    expect(nextLevel(before, 'zombies', LEVELS)?.id).toBe('z1-8');
    expect(isOpen(before, levelsFor('zombies', 2)[0]!, LEVELS)).toBe(false);
    expect(openingWorld(before, 'zombies', LEVELS)).toBe(1);
    expect(mapIslands(before, 'zombies', LEVELS).find((i) => i.world === 2)?.locked).toBe(true);

    const after = stars(w1);
    expect(nextLevel(after, 'zombies', LEVELS)?.id).toBe('z2-1');
    expect(isOpen(after, levelsFor('zombies', 2)[0]!, LEVELS)).toBe(true);
    expect(openingWorld(after, 'zombies', LEVELS)).toBe(2);
    const islands = mapIslands(after, 'zombies', LEVELS);
    expect(islands.find((i) => i.world === 2)?.locked).toBe(false);
    expect(islands.filter((i) => i.world > 2).every((i) => i.locked)).toBe(true);
    expect(mapStones(after, 'zombies', 2, LEVELS).map((s) => s.state)).toEqual(['next', ...Array.from({ length: 7 }, () => 'closed')]);
  });

  it('the plants\' progress does not open the Tundra, nor the zombies\' the Meadow', () => {
    const s = stars(w1);
    expect(nextLevel(s, 'plants', LEVELS)?.id).toBe('p1-1');
    expect(mapIslands(s, 'plants', LEVELS).find((i) => i.world === 2)?.locked).toBe(true);
  });

  it('a Tundra graduate has nothing next (worlds 3-5 are still to come)', () => {
    const s = stars([...w1, ...levelsFor('zombies', 2).map((l) => l.id)]);
    expect(nextLevel(s, 'zombies', LEVELS)).toBeNull();
    expect(openingWorld(s, 'zombies', LEVELS)).toBe(2);
  });
});
