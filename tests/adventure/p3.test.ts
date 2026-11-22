import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { LEVELS, levelsFor } from '../../src/adventure/levels';
import { rocks } from '../../src/adventure/levels/helpers';
import { P3 } from '../../src/adventure/levels/p3';
import { playIdle, standInSave } from '../../src/ai/levelChecks';
import { BALANCE } from '../../src/data/balance';
import { ALL_CARDS, factionOf } from '../../src/data/units';
import { newSave } from '../../src/progress/save';
import { Match } from '../../src/sim/match';
import { checkLevel } from '../../src/sim/script';

/**
 * The Desert Canyon (step-3 plan Task 6, content design §1 Step 3): kind, rocks, the cards dealt
 * (the first n plant cards; a conveyor its belt), the base, the unlocks and the glove tiles.
 */
const TABLE = [
  { kind: 'survive', rocks: [[1, 4], [2, 5], [3, 3]], cards: 7, unlocks: null },
  { kind: 'battle', rocks: [[0, 1], [1, 0], [2, 1], [3, 0], [4, 1]], cards: 7, unlocks: null },
  { kind: 'conveyor', rocks: [[0, 2], [1, 4], [3, 4], [4, 2]], cards: 0, unlocks: 'torchwood' },
  { kind: 'battle', rocks: [[0, 0], [1, 1], [3, 1], [4, 0], [2, 5]], cards: 8, unlocks: null },
  { kind: 'survive', rocks: [[0, 1], [1, 0], [2, 1], [3, 0], [4, 1], [2, 4]], cards: 8, unlocks: null },
  { kind: 'battle', rocks: [[0, 1], [1, 0], [3, 0], [4, 1], [1, 5], [3, 5]], cards: 8, unlocks: 'cherryBomber' },
  { kind: 'survive', rocks: [[0, 1], [1, 0], [3, 0], [4, 1], [1, 5], [3, 5]], cards: 9, unlocks: null },
  { kind: 'boss', rocks: [[2, 2], [2, 4], [0, 1], [4, 1], [1, 5], [3, 5]], cards: 9, unlocks: null },
] as const;

describe('the Desert Canyon (p3-1 … p3-8)', () => {
  const levels = levelsFor('plants', 3);

  it('has p3-1 … p3-8 in order, all plants in world 3', () => {
    expect(levels.map((l) => l.id)).toEqual(Array.from({ length: 8 }, (_, i) => `p3-${i + 1}`));
    expect(P3.every((l) => l.world === 3 && l.side === 'plants')).toBe(true);
  });

  it('follows the table: kinds, rocks, cards, unlocks, spells everywhere', () => {
    levels.forEach((l, i) => {
      const row = TABLE[i]!;
      expect(l.kind, l.id).toBe(row.kind);
      expect(l.twist, l.id).toEqual({ rocks: rocks(row.rocks.map(([a, b]) => [a, b])) });
      if (l.kind === 'conveyor') {
        expect(l.cards, l.id).toEqual(l.belt?.cards);
        expect(l.cards, l.id).toEqual(['peashooter', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult']);
      } else {
        expect(l.cards, l.id).toEqual(ALL_CARDS.plants.slice(0, row.cards));
      }
      expect(l.unlocks, l.id).toBe(row.unlocks);
      expect(l.spells, l.id).toBe(true);
      expect(l.boss !== null, l.id).toBe(l.kind === 'boss');
      for (const s of l.waves) expect(factionOf(s.unit), `${l.id} ${s.unit}`).toBe('zombies');
    });
  });

  it('base health, start energy and the head start follow the table', () => {
    expect(levels.map((l) => l.baseHp)).toEqual([
      { plants: 5000 }, { zombies: 2500 }, { plants: 5500 }, { zombies: 2500 },
      { plants: 5500 }, { zombies: 3000 }, { plants: 5500 }, { plants: 5300 },
    ]);
    expect(levels.map((l) => l.startEnergy)).toEqual([null, null, null, null, null, null, null, 600]);
    expect(levels[3]!.prepared).toEqual([{ at: 0, unit: 'peashooter', lane: 2, col: 1, level: 1 }]);
    expect(levels.filter((l) => l.n !== 4).every((l) => l.prepared.length === 0)).toBe(true);
    expect(levels[7]!.boss).toEqual({ key: 'sandPharaoh', lane: 2 });
  });

  it('unlocks the Torchwood after p3-3 and the Cherry Bomber after p3-6, each dealt from the next level on', () => {
    expect(levels.filter((l) => l.unlocks !== null).map((l) => [l.n, l.unlocks])).toEqual([[3, 'torchwood'], [6, 'cherryBomber']]);
    for (const l of levels.filter((x) => x.kind !== 'conveyor')) {
      expect(l.cards.includes('torchwood'), l.id).toBe(l.n >= 4);
      expect(l.cards.includes('cherryBomber'), l.id).toBe(l.n >= 7);
    }
  });

  it('every level passes checkLevel (no prepared or scripted plant on a rock) for a fresh player, the one who reaches it, and one holding every card', () => {
    for (const l of levels) {
      const fresh = newSave('p01', 'Kid', 'peashooter', 0);
      const all = { ...fresh, plants: { ...fresh.plants, unlocked: [...ALL_CARDS.plants] } };
      for (const save of [fresh, standInSave('average', l), all]) {
        const c = levelConfig(l, save, 3);
        expect(() => checkLevel(c, BALANCE), l.id).not.toThrow();
        expect(() => new Match(c), l.id).not.toThrow();
      }
      expect(levelConfig(l, standInSave('beginner', l), 3).cards.plants, l.id).toEqual(l.cards);
    }
  });

  it('the hold-outs have no computer and an unhittable zombie base; battles and the boss a hittable one', () => {
    for (const l of levels) {
      const holdOut = l.kind === 'survive' || l.kind === 'conveyor';
      if (holdOut) expect(l.opponent, l.id).toBeNull();
      expect(levelConfig(l, standInSave('average', l), 1).invulnerableBase, l.id).toBe(holdOut ? 'zombies' : null);
    }
  });

  // Review Focus 1: the glove must never point at a rock, and the move must be accepted.
  it('every glove tile of p3-4 and p3-7 is rock-free and accepted by match.check on the real levels', () => {
    for (const id of ['p3-4', 'p3-7']) {
      const l = LEVELS.find((x) => x.id === id)!;
      const tiles = l.teaches!.flatMap((s) => (s.show === 'tile' ? [s] : []));
      expect(tiles.length, id).toBe(1);
      const t = tiles[0]!;
      expect(l.twist?.rocks?.includes(t.lane * 8 + t.col), `${id} glove on a rock`).toBe(false);
      const m = new Match(levelConfig(l, standInSave('beginner', l), 1));
      expect(m.check({ type: 'place', faction: 'plants', unit: t.card, lane: t.lane, col: t.col }), id).toBeNull();
    }
  });

  it('a tap on any rock of any level is refused with reason rock, places nothing, and the tile beside it is fine', () => {
    for (const l of levels.filter((x) => x.kind !== 'conveyor')) {
      const m = new Match(levelConfig(l, standInSave('beginner', l), 1));
      for (const r of l.twist!.rocks!) {
        const cmd = { type: 'place', faction: 'plants', unit: 'sunflower', lane: Math.floor(r / 8), col: r % 8 } as const;
        expect(m.check(cmd), `${l.id} rock ${r}`).toBe('rock');
      }
    }
    const l = levels[0]!;
    const m = new Match(levelConfig(l, standInSave('beginner', l), 1));
    const onRock = { type: 'place', faction: 'plants', unit: 'sunflower', lane: 1, col: 4 } as const;
    const events = m.step([onRock]);
    expect(events).toContainEqual({ type: 'commandRejected', command: onRock, reason: 'rock' });
    expect(m.state.units.filter((u) => u.faction === 'plants')).toHaveLength(0);
    expect(m.check({ ...onRock, col: 3 })).toBeNull();
  });

  // Review Focus 5: peas fly over a rock, and a Torchwood on the far side of it still lights them.
  it('fire peas over a rock: a Peashooter, the rock at [2,4], a Torchwood at [2,5] - the peas ignite', () => {
    const l = levels[4]!;
    const c = levelConfig({ ...l, waves: [] }, standInSave('average', l), 1);
    c.startEnergy.plants = 1000;
    const m = new Match(c);
    expect(m.check({ type: 'place', faction: 'plants', unit: 'torchwood', lane: 2, col: 4 })).toBe('rock');
    m.step([
      { type: 'place', faction: 'plants', unit: 'peashooter', lane: 2, col: 3 },
      { type: 'place', faction: 'plants', unit: 'torchwood', lane: 2, col: 5 },
    ]);
    const lit = [];
    for (let t = 0; t < 300; t++) lit.push(...m.step().filter((e) => e.type === 'abilityUsed' && e.ability === 'ignite'));
    expect(lit.length).toBeGreaterThan(0);
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
