import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { LEVELS, levelById, levelsFor } from '../../src/adventure/levels';
import { P4 } from '../../src/adventure/levels/p4';
import { playIdle, standInSave } from '../../src/ai/levelChecks';
import { BALANCE, seconds } from '../../src/data/balance';
import { ALL_CARDS, factionOf } from '../../src/data/units';
import { newSave } from '../../src/progress/save';
import { Match } from '../../src/sim/match';
import { checkLevel } from '../../src/sim/script';
import { w4Controller } from '../app/world4Lessons';

/**
 * The Frozen Tundra (worlds-4 plan Task 6, content design §1 Step 4): kind, ice lanes, the cards
 * dealt (the first nine plant cards, the Squash from p4-4; a conveyor its belt), the unlock, the
 * scripted lane-1 foe of p4-4 and the Yeti's iced lane. The tuned numbers (waves, clocks, bases)
 * are not pinned here: `tools/levels.ts --world 4` measures them.
 */
const TABLE = [
  { kind: 'survive', ice: [2], cards: 9, unlocks: null },
  { kind: 'battle', ice: [1, 3], cards: 9, unlocks: null },
  { kind: 'conveyor', ice: [0, 4], cards: 0, unlocks: 'pumpkinSquash' },
  { kind: 'battle', ice: [1, 3], cards: 10, unlocks: null },
  { kind: 'survive', ice: [0, 2, 4], cards: 10, unlocks: null },
  { kind: 'battle', ice: [0, 2, 4], cards: 10, unlocks: null },
  { kind: 'survive', ice: [0, 1, 3, 4], cards: 10, unlocks: null },
  { kind: 'boss', ice: [0, 2, 4], cards: 10, unlocks: null },
] as const;

describe('the Frozen Tundra (p4-1 … p4-8)', () => {
  const levels = levelsFor('plants', 4);

  it('has p4-1 … p4-8 in order, all plants in world 4', () => {
    expect(levels.map((l) => l.id)).toEqual(Array.from({ length: 8 }, (_, i) => `p4-${i + 1}`));
    expect(P4.every((l) => l.world === 4 && l.side === 'plants')).toBe(true);
  });

  it('follows the table: kinds, ice lanes, cards, unlocks, spells everywhere', () => {
    levels.forEach((l, i) => {
      const row = TABLE[i]!;
      expect(l.kind, l.id).toBe(row.kind);
      expect(l.twist, l.id).toEqual({ iceLanes: row.ice });
      if (l.kind === 'conveyor') {
        expect(l.cards, l.id).toEqual(l.belt?.cards);
        expect(l.cards, l.id).toEqual(['peashooter', 'walnutBomb', 'potatoMine', 'kernelPult', 'torchwood']);
      } else {
        expect(l.cards, l.id).toEqual(ALL_CARDS.plants.slice(0, row.cards));
      }
      expect(l.unlocks, l.id).toBe(row.unlocks);
      expect(l.spells, l.id).toBe(true);
      expect(l.boss !== null, l.id).toBe(l.kind === 'boss');
      for (const s of l.waves) expect(factionOf(s.unit), `${l.id} ${s.unit}`).toBe('zombies');
    });
  });

  it('base health: a battle sets the zombie base, the others the plants\'; the boss starts on 600 energy', () => {
    for (const l of levels) {
      const side = l.kind === 'battle' ? 'zombies' : 'plants';
      const other = side === 'zombies' ? 'plants' : 'zombies';
      expect(Number.isInteger(l.baseHp?.[side]) && l.baseHp![side]! >= 1, `${l.id} ${side}`).toBe(true);
      expect(l.baseHp?.[other], `${l.id} ${other}`).toBeUndefined();
    }
    expect(levels.map((l) => l.startEnergy)).toEqual([null, null, null, null, null, null, null, 600]);
    expect(levels.every((l) => l.prepared.length === 0)).toBe(true);
  });

  it('unlocks the Pumpkin Squash after p4-3, dealt from p4-4 on and never before', () => {
    expect(levels.filter((l) => l.unlocks !== null).map((l) => [l.n, l.unlocks])).toEqual([[3, 'pumpkinSquash']]);
    for (const l of levels) expect(l.cards.includes('pumpkinSquash'), l.id).toBe(l.n >= 4);
  });

  it('p4-8: the Yeti stands in lane 2, which is iced, and the snow pups come down the outer lanes', () => {
    const l = levels[7]!;
    expect(l.boss).toEqual({ key: 'yeti', lane: 2 });
    expect(l.twist?.iceLanes).toContain(2);
    expect(new Set(l.waves.map((s) => s.lane))).toEqual(new Set([0, 4]));
    expect(l.waves.every((s) => s.unit === 'veryFastWalker')).toBe(true);
    const c = levelConfig(l, standInSave('average', l), 1);
    expect(c.boss).toMatchObject({ key: 'yeti', lane: 2 });
    expect(c.lawn?.ice?.lanes).toContain(2);
  });

  it('every level passes checkLevel for a fresh player, the one who reaches it, and one holding every card', () => {
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

  // Review Focus 1: the Squash's glove tile must be free and accepted, on the real level.
  it('the p4-4 glove tile [1,3] is on an iced lane, free, and accepted by match.check on the real level', () => {
    const l = LEVELS.find((x) => x.id === 'p4-4')!;
    const tiles = l.teaches!.flatMap((s) => (s.show === 'tile' ? [s] : []));
    expect(tiles).toHaveLength(1);
    const t = tiles[0]!;
    expect([t.card, t.lane, t.col]).toEqual(['pumpkinSquash', 1, 3]);
    expect(l.twist?.iceLanes).toContain(t.lane);
    const m = new Match(levelConfig(l, standInSave('beginner', l), 1));
    expect(m.check({ type: 'place', faction: 'plants', unit: t.card, lane: t.lane, col: t.col })).toBeNull();
  });
});

// Review Focus 1 (F5): the real tutorial. The card step holds the match until the card is tapped;
// after that an idle player's Squash step arms on its own, when a scripted lane-1 foe walks into the
// window x in [3.5, 5.5] (FOE_WINDOW 2 in front of column 3), within 60 s of match time.
describe('p4-4 teaches the Squash through the real tutorial', () => {
  const real = levelById('p4-4')!;

  /** Steps through the card step's hold, taps the card, and returns the controller. */
  function tapped(def = real, seed = 3) {
    const c = w4Controller(def, seed);
    for (let i = 0; i < seconds(60) && !c.tutorial!.holding; i++) c.step();
    expect(c.tutorial!.current?.id).toBe('p4-4.squash-card');
    c.select('pumpkinSquash');
    expect(c.tutorial!.current?.id).toBe('p4-4.squash-tile');
    return c;
  }
  const foeInWindow = (c: ReturnType<typeof tapped>): boolean =>
    c.match.state.units.some((u) => u.faction === 'zombies' && u.lane === 1 && u.x >= 3.5 && u.x <= 5.5);

  it.each([3, 7, 11])('seed %i: idle after the card, the tile step\'s aim is [1,3] and it arms within 60 s, only with a foe in the window', (seed) => {
    const c = tapped(real, seed);
    let armedAt = -1;
    let sawFoeBefore = false;
    for (let i = 0; i < seconds(60) && armedAt < 0; i++) {
      sawFoeBefore = foeInWindow(c);
      c.step();
      const g = c.tutorial!.glove.peek();
      if (g !== null) {
        armedAt = c.match.state.tick;
        expect(g).toMatchObject({ aim: { kind: 'tile', lane: 1, col: 3 }, step: 'p4-4.squash-tile' });
        expect(sawFoeBefore || foeInWindow(c), 'a foe stood in the window when it armed').toBe(true);
      } else {
        // While it waits it holds nothing: the match runs on.
        expect(c.tutorial!.holding).toBe(false);
      }
    }
    expect(armedAt, 'armed').toBeGreaterThan(0);
    expect(armedAt).toBeLessThanOrEqual(seconds(60));
  });

  it('without the scripted foe (no waves, no computer) it never arms: no zombie ever stands in the window', () => {
    const c = tapped({ ...real, waves: [], opponent: null });
    for (let i = 0; i < seconds(40); i++) {
      c.step();
      expect(c.tutorial!.glove.peek()).toBeNull();
    }
  });

  it('the scripted foes are Brain Eaters down lane 1, the first before 30 s', () => {
    const foes = real.waves.filter((s) => s.lane === 1);
    expect(foes.length).toBeGreaterThan(0);
    expect(foes.every((s) => s.unit === 'brainEater')).toBe(true);
    expect(Math.min(...foes.map((s) => s.at))).toBeLessThanOrEqual(30);
  });
});

// A child who does nothing loses every level of the Tundra.
describe('an idle player in the Tundra', () => {
  it('loses every level (20 seeds)', () => {
    for (const l of levelsFor('plants', 4)) {
      const results = Array.from({ length: 20 }, (_, k) => playIdle(l, k + 1));
      expect(results.every((r) => r.end !== 'none'), `${l.id} ends`).toBe(true);
      expect(results.filter((r) => r.won).length, l.id).toBe(0);
    }
  }, 240_000);
});
