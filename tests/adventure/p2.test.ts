import { describe, expect, it } from 'vitest';
import { lawnOf, levelConfig } from '../../src/adventure/campaign';
import { levelsFor } from '../../src/adventure/levels';
import { P2 } from '../../src/adventure/levels/p2';
import { playIdle, standInSave } from '../../src/ai/levelChecks';
import { BALANCE } from '../../src/data/balance';
import { ALL_CARDS, factionOf } from '../../src/data/units';
import { newSave } from '../../src/progress/save';
import { Match } from '../../src/sim/match';
import { checkLevel } from '../../src/sim/script';

/**
 * The Moonlit Meadow (step-2 plan Task 6, content design §1): kind, fog reach, the cards dealt
 * (the first n plant cards; a conveyor its belt), the clock and the unlock of each level.
 */
const TABLE = [
  { kind: 'survive', fog: 7, cards: 5, unlocks: null },
  { kind: 'battle', fog: 7, cards: 5, unlocks: null },
  { kind: 'conveyor', fog: 6, cards: 0, unlocks: 'mangoPult' },
  { kind: 'battle', fog: 6, cards: 6, unlocks: null },
  { kind: 'survive', fog: 5, cards: 6, unlocks: null },
  { kind: 'battle', fog: 5, cards: 6, unlocks: 'avocadoBunker' },
  { kind: 'survive', fog: 5, cards: 7, unlocks: null },
  { kind: 'boss', fog: 5, cards: 7, unlocks: null },
] as const;

describe('the Moonlit Meadow (p2-1 … p2-8)', () => {
  const levels = levelsFor('plants', 2);

  it('has p2-1 … p2-8 in order, all plants in world 2', () => {
    expect(levels.map((l) => l.id)).toEqual(Array.from({ length: 8 }, (_, i) => `p2-${i + 1}`));
    expect(P2.every((l) => l.world === 2 && l.side === 'plants')).toBe(true);
  });

  it('follows the table: kinds, fog reach 7 7 6 6 5 5 5 5, cards, unlocks, spells everywhere', () => {
    levels.forEach((l, i) => {
      const row = TABLE[i]!;
      expect(l.kind, l.id).toBe(row.kind);
      expect(l.twist, l.id).toEqual({ fog: row.fog });
      expect(lawnOf(l.twist).fog, l.id).toBe(row.fog);
      if (l.kind === 'conveyor') {
        expect(l.cards, l.id).toEqual(l.belt?.cards);
        expect(l.cards, l.id).toEqual(['peashooter', 'walnutBomb', 'potatoMine', 'kernelPult']);
      } else {
        expect(l.cards, l.id).toEqual(ALL_CARDS.plants.slice(0, row.cards));
      }
      expect(l.unlocks, l.id).toBe(row.unlocks);
      expect(l.spells, l.id).toBe(true);
      expect(l.boss !== null, l.id).toBe(l.kind === 'boss');
      for (const s of [...l.waves, ...l.prepared]) expect(factionOf(s.unit), `${l.id} ${s.unit}`).toBe('zombies');
    });
  });

  it('unlocks the Mango-pult after p2-3 and the Avocado Bunker after p2-6, each dealt from the next level on', () => {
    expect(levels.filter((l) => l.unlocks !== null).map((l) => [l.n, l.unlocks])).toEqual([[3, 'mangoPult'], [6, 'avocadoBunker']]);
    for (const l of levels) {
      expect(l.cards.includes('mangoPult'), l.id).toBe(l.n >= 4);
      expect(l.cards.includes('avocadoBunker'), l.id).toBe(l.n >= 7);
    }
  });

  it('every level passes checkLevel for a fresh player, for the player who reaches it, and for one holding every card', () => {
    for (const l of levels) {
      const fresh = newSave('p01', 'Kid', 'peashooter', 0);
      const all = { ...fresh, plants: { ...fresh.plants, unlocked: [...ALL_CARDS.plants] } };
      for (const save of [fresh, standInSave('average', l), all]) {
        const c = levelConfig(l, save, 3);
        expect(() => checkLevel(c, BALANCE), l.id).not.toThrow();
        expect(() => new Match(c), l.id).not.toThrow();
      }
      // The player who reaches the level holds every card it deals.
      expect(levelConfig(l, standInSave('beginner', l), 3).cards.plants, l.id).toEqual(l.cards);
    }
  });

  it('the hold-outs (survive, conveyor) have no computer and an unhittable zombie base; battles and the boss a hittable one', () => {
    for (const l of levels) {
      const holdOut = l.kind === 'survive' || l.kind === 'conveyor';
      if (holdOut) expect(l.opponent, l.id).toBeNull();
      expect(levelConfig(l, standInSave('average', l), 1).invulnerableBase, l.id).toBe(holdOut ? 'zombies' : null);
    }
  });

  it('the Moon Howler walks the middle lane of p2-8', () => {
    const p8 = levels[7]!;
    expect(levelConfig(p8, standInSave('average', p8), 1).boss).toEqual({ key: 'moonHowler', faction: 'zombies', lane: 2 });
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

  // Review Focus 3: a child who does nothing loses every level of the Meadow (none is a level where
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
