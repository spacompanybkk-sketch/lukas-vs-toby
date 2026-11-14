import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { BACKYARD } from '../../src/adventure/levels/backyard';
import { levelsFor } from '../../src/adventure/levels';
import type { LevelDef } from '../../src/adventure/types';
import { standInSave } from '../../src/ai/levelChecks';
import { createBasicBot } from '../../src/ai/basicBot';
import { BALANCE, seconds } from '../../src/data/balance';
import { ALL_CARDS, factionOf } from '../../src/data/units';
import { newSave } from '../../src/progress/save';
import { Match } from '../../src/sim/match';
import { checkLevel } from '../../src/sim/script';

/** The plan's Task 8 table: kind, the cards dealt (first n of the side, a conveyor its belt), unlock. */
const TABLE = {
  plants: [
    ['battle', 1, null], ['battle', 2, null], ['survive', 3, 'potatoMine'], ['battle', 4, null],
    ['conveyor', 3, null], ['survive', 4, 'kernelPult'], ['battle', 5, null], ['boss', 5, null],
  ],
  zombies: [
    ['battle', 1, null], ['battle', 2, null], ['breakthrough', 3, 'desertZombie'], ['battle', 4, null],
    ['conveyor', 4, null], ['breakthrough', 4, 'skeletonArcher'], ['battle', 5, null], ['boss', 5, null],
  ],
} as const;

/** Every lane a level's enemy uses at the start or by script (a computer may go anywhere). */
const lanesOf = (l: LevelDef): Set<number> => new Set([...l.waves, ...l.prepared].map((s) => s.lane));

describe('the Backyard (Task 8 data)', () => {
  it('has p1-1 … p1-8 and z1-1 … z1-8, numbered in order, all in world 1', () => {
    for (const side of ['plants', 'zombies'] as const) {
      const ids = levelsFor(side, 1).map((l) => l.id);
      expect(ids).toEqual(Array.from({ length: 8 }, (_, i) => `${side === 'plants' ? 'p' : 'z'}1-${i + 1}`));
    }
    expect(BACKYARD.every((l) => l.world === 1)).toBe(true);
    expect(new Set(BACKYARD.map((l) => l.id)).size).toBe(16);
  });

  it.each(['plants', 'zombies'] as const)('%s follow the table: kinds, cards, unlocks at 3 and 6, spells from level 4', (side) => {
    levelsFor(side, 1).forEach((l, i) => {
      const [kind, cards, unlocks] = TABLE[side][i]!;
      expect(l.kind, l.id).toBe(kind);
      if (kind === 'conveyor') {
        expect(l.cards, l.id).toEqual(l.belt?.cards);
        expect(l.cards.every((c) => ALL_CARDS[side].slice(0, 4).includes(c)), l.id).toBe(true);
      } else {
        expect(l.cards, l.id).toEqual(ALL_CARDS[side].slice(0, cards));
      }
      expect(l.unlocks, l.id).toBe(unlocks);
      expect(l.spells, l.id).toBe(l.n >= 4);
      expect(l.boss !== null, l.id).toBe(kind === 'boss');
      for (const s of l.waves) expect(factionOf(s.unit), `${l.id} ${s.unit}`).not.toBe(side);
    });
  });

  it('a level unlocks the next card in spec 6.6 order (four cards after level 3, five after level 6)', () => {
    for (const side of ['plants', 'zombies'] as const) {
      const unlocks = levelsFor(side, 1).filter((l) => l.unlocks !== null).map((l) => [l.n, l.unlocks]);
      expect(unlocks).toEqual([[3, ALL_CARDS[side][3]], [6, ALL_CARDS[side][4]]]);
    }
  });

  it('every level passes checkLevel for a fresh player, for the player who reaches it, and for one holding every card', () => {
    for (const l of BACKYARD) {
      const fresh = newSave(l.side === 'plants' ? 'p01' : 'p02', 'Kid', 'peashooter', 0);
      const all = { ...fresh, [l.side]: { ...fresh[l.side], unlocked: [...ALL_CARDS[l.side]] } };
      for (const save of [fresh, standInSave('average', l), all]) {
        const c = levelConfig(l, save, 3);
        expect(() => checkLevel(c, BALANCE), l.id).not.toThrow();
        expect(() => new Match(c), l.id).not.toThrow();
      }
      // The player who reaches the level holds every card it deals.
      expect(levelConfig(l, standInSave('beginner', l), 3).cards[l.side], l.id).toEqual(l.cards);
    }
  });

  it('a conveyor level has no computer; the zombies\' base is unhittable only on a plant survive or conveyor', () => {
    for (const l of BACKYARD) {
      if (l.kind === 'conveyor') expect(l.opponent, l.id).toBeNull();
      const c = levelConfig(l, standInSave('average', l), 1);
      const holdOut = l.side === 'plants' && (l.kind === 'survive' || l.kind === 'conveyor');
      expect(c.invulnerableBase, l.id).toBe(holdOut ? 'zombies' : null);
    }
    // The zombies' conveyor is a race: the plant base can be hurt, the plants win at the clock.
    const z5 = levelConfig(BACKYARD.find((l) => l.id === 'z1-5')!, standInSave('average', BACKYARD.find((l) => l.id === 'z1-5')!), 1);
    expect([z5.mode, z5.invulnerableBase, z5.goalTicks]).toEqual(['conveyor', null, seconds(150)]);
  });

  it('the clocks follow the table: p1-3 90 s, p1-6 150 s, z1-3 120 s, z1-6 150 s', () => {
    const secs = (id: string): number | null => BACKYARD.find((l) => l.id === id)!.seconds;
    expect(['p1-3', 'p1-6', 'z1-3', 'z1-6'].map(secs)).toEqual([90, 150, 120, 150]);
  });

  it('a level\'s own base health is a whole number from 1 and reaches the match (the other side keeps the balance\'s)', () => {
    for (const l of BACKYARD) {
      for (const hp of Object.values(l.baseHp ?? {})) expect(Number.isInteger(hp) && hp >= 1, `${l.id} ${hp}`).toBe(true);
      const c = levelConfig(l, standInSave('average', l), 1);
      for (const side of ['plants', 'zombies'] as const) expect(c.baseHp[side], `${l.id} ${side}`).toBe(l.baseHp?.[side] ?? BALANCE.baseHp);
    }
  });

  it('the bosses: the Brain Titan ends the plants\' Backyard, the Elder Oak the zombies\'', () => {
    const p8 = BACKYARD.find((l) => l.id === 'p1-8')!;
    const z8 = BACKYARD.find((l) => l.id === 'z1-8')!;
    expect(levelConfig(p8, standInSave('average', p8), 1).boss).toEqual({ key: 'brainTitan', faction: 'zombies', lane: 2 });
    expect(levelConfig(z8, standInSave('average', z8), 1).boss).toEqual({ key: 'elderOak', faction: 'plants', lane: 2 });
  });

  /**
   * A child who does nothing must not win. Only the first hold-out is won by waiting, as designed:
   * p1-3 (the zombie base cannot be hurt; nothing in its waves reaches a 4500 base unaided). p1-5's
   * conveyor and p1-6 are hold-outs too, but their waves are strong enough that an idle base falls
   * (worlds plan Task 8c: p1-5 is no longer won by an idle player).
   */
  const WAITING_WINS = ['p1-3'];
  it('an idle player never wins a level (20 seeds), except the hold-outs where waiting is the point', () => {
    for (const def of BACKYARD) {
      const enemy = def.side === 'plants' ? 'zombies' : 'plants';
      let wins = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const m = new Match(levelConfig(def, standInSave('beginner', def), seed));
        const bot = def.opponent === null ? null : createBasicBot(enemy, def.opponent.skill, (Math.imul(seed, 2654435761) + 1) >>> 0);
        while (m.state.winner === null && m.state.tick < 20_000) m.step(bot === null ? [] : bot.think(m));
        expect(m.state.winner, `${def.id} seed ${seed} ends`).not.toBeNull();
        if (m.state.winner === def.side) wins += 1;
      }
      if (WAITING_WINS.includes(def.id)) expect(wins, def.id).toBe(20);
      else expect(wins, def.id).toBe(0);
    }
  }, 120_000);

  describe('the tutorial levels (1-3 of each side) are calm', () => {
    const tutorials = BACKYARD.filter((l) => l.n <= 3);

    it('scripted enemies and gardens use one or two lanes (p1-3: the table\'s three lanes of waves)', () => {
      for (const l of tutorials) expect(lanesOf(l).size, l.id).toBeLessThanOrEqual(l.id === 'p1-3' ? 3 : 2);
      expect(tutorials.every((l) => l.opponent === null)).toBe(true);
    });

    it('the first zombie arrives no sooner than 20 s', () => {
      for (const l of tutorials.filter((x) => x.side === 'plants')) {
        expect(Math.min(...l.waves.map((w) => w.at)), l.id).toBeGreaterThanOrEqual(20);
      }
    });

    it('cannot be lost in the first 20 s, even by a player who does nothing', () => {
      for (const l of tutorials) {
        const m = new Match(levelConfig(l, standInSave('beginner', l), 5));
        for (let i = 0; i < seconds(20); i++) m.step();
        expect(m.state.winner, l.id).toBeNull();
      }
    });
  });
});
