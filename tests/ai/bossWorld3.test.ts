import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { LEVELS, levelById } from '../../src/adventure/levels';
import { rocks } from '../../src/adventure/levels/helpers';
import type { LevelDef } from '../../src/adventure/types';
import { standInSave } from '../../src/ai/levelChecks';
import { BOSS_ANSWER, createLevelStandIn } from '../../src/ai/levelStandIns';
import type { LevelStandIn } from '../../src/ai/levelStandIns';
import { Match } from '../../src/sim/match';
import { COLS } from '../../src/sim/types';
import type { Command } from '../../src/sim/types';

/**
 * What the stand-ins know about the world-3 bosses (step-3 plan Task 4, content design §2, §5):
 * the Sand Pharaoh's `recipe` (a Peashooter at column 1, a Torchwood at column 3 of its lane, on the
 * p3-8 rocks), and the Cactus King, whom only the expert's strike dodge knows. World 3's levels do
 * not exist yet, so the boss levels here are world 1's with the world-3 boss.
 */

const P18 = levelById('p1-8')!;
const Z18 = levelById('z1-8')!;
const HAND = ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber'] as const;
/** p3-8 as the content design lays it out: rocks [2,2] [2,4] [0,1] [4,1] [1,5] [3,5], all nine cards. */
const P38: LevelDef = {
  ...P18, id: 'p3-8', world: 3, n: 8, boss: { key: 'sandPharaoh', lane: 2 }, cards: [...HAND],
  twist: { rocks: rocks([[2, 2], [2, 4], [0, 1], [4, 1], [1, 5], [3, 5]]) },
};
/** The level that unlocks the Torchwood (p3-4 in the real world 3). */
const TORCH_UNLOCK: LevelDef = { ...levelById('p1-3')!, id: 'p3-4', world: 3, n: 4, unlocks: 'torchwood' };
const WORLD3 = [...LEVELS.filter((l) => l.world <= 2), TORCH_UNLOCK, P38];
const CACTUS_LEVEL: LevelDef = { ...Z18, id: 'z3-8', world: 3, n: 8, boss: { key: 'cactusKing', lane: 2 } };

interface Sent { tick: number; cmd: Command; struck: ReadonlySet<number> }

/** Plays `def` with a stand-in for `secs` seconds; every command it sent, with the lanes a strike was winding up on. */
function play(def: LevelDef, levels: readonly LevelDef[], who: LevelStandIn, seed: number, secs: number, phase2 = false): Sent[] {
  const m = new Match(levelConfig(def, standInSave(who, def, levels), seed));
  const bot = createLevelStandIn(who, def.side, seed);
  const out: Sent[] = [];
  for (let i = 0; i < secs * 30 && m.state.winner === null; i++) {
    const boss = m.state.units.find((u) => u.key === def.boss!.key);
    if (phase2 && boss !== undefined && boss.phase === 0) boss.hp = boss.maxHp * 0.5;
    const struck = new Set((boss?.strikeTiles ?? []).map((t) => Math.floor(t / COLS)));
    const cmds = bot.think(m);
    for (const cmd of cmds) out.push({ tick: m.state.tick, cmd, struck });
    m.step(cmds);
  }
  return out;
}

const placed = (sent: Sent[]) => sent.filter((s): s is Sent & { cmd: Extract<Command, { type: 'place' }> } => s.cmd.type === 'place');

describe('BOSS_ANSWER', () => {
  it('the Titan\'s and the Howler\'s entries are unchanged and carry no recipe', () => {
    expect(BOSS_ANSWER.brainTitan).toEqual({ expert: { cards: ['kernelPult'], want: 2 }, average: { cards: ['peashooter'], want: 3 } });
    expect(BOSS_ANSWER.moonHowler).toEqual({
      expert: { cards: ['mangoPult', 'kernelPult'], want: 2, cols: [3, 4] },
      average: { cards: ['peashooter'], want: 3 },
    });
  });

  it('the Sand Pharaoh: the expert\'s recipe is a Peashooter at column 1 then a Torchwood at column 3; the average three Peashooters; the beginner nothing', () => {
    expect(BOSS_ANSWER.sandPharaoh!.expert.recipe).toEqual([['peashooter', 1], ['torchwood', 3]]);
    expect(BOSS_ANSWER.sandPharaoh!.average).toEqual({ cards: ['peashooter'], want: 3 });
  });

  it('the Cactus King (a plant boss) has no entry: only the strike dodge knows it', () => {
    expect(BOSS_ANSWER.cactusKing).toBeUndefined();
    expect(BOSS_ANSWER.elderOak).toBeUndefined();
  });
});

describe('against the Sand Pharaoh (lane 2, rocks at [2,2] and [2,4])', () => {
  it.each([1, 2, 3])('the expert plants a Peashooter at [2,1] and then a Torchwood at [2,3] (seed %i)', (seed) => {
    const lane2 = placed(play(P38, WORLD3, 'expert', seed, 60)).filter((s) => s.cmd.lane === 2 && ['peashooter', 'torchwood'].includes(s.cmd.unit));
    expect(lane2.length).toBeGreaterThanOrEqual(2);
    expect(lane2[0]!.cmd).toMatchObject({ unit: 'peashooter', lane: 2, col: 1 });
    expect(lane2[1]!.cmd).toMatchObject({ unit: 'torchwood', lane: 2, col: 3 });
    // The recipe never asks a rock for a tile (the match would refuse it).
    for (const s of lane2) expect([2, 4]).not.toContain(s.cmd.col);
  });

  it('the average player puts Peashooters in its lane, as at the Titan; the beginner has no answer for it', () => {
    for (const seed of [1, 2, 3]) {
      const sent = placed(play(P38, WORLD3, 'average', seed, 120));
      expect(sent.filter((s) => s.cmd.unit === 'peashooter' && s.cmd.lane === 2).length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(sent.some((s) => s.cmd.unit === 'torchwood' && s.cmd.lane === 2)).toBe(false);
    }
  });
});

describe('against the Cactus King\'s rockfall (the strike dodge)', () => {
  const SEEDS = [1, 2, 3, 4];
  const intoStruck = (sent: Sent[]) => sent.filter((s) => (s.cmd.type === 'place' || s.cmd.type === 'belt') && s.struck.has(s.cmd.lane));
  const duringWindup = (sent: Sent[]) => sent.filter((s) => (s.cmd.type === 'place' || s.cmd.type === 'belt') && s.struck.size > 0);

  it('the expert never sends a zombie into a lane whose strike is winding up, but keeps sending into the others', () => {
    let during = 0;
    for (const seed of SEEDS) {
      const sent = play(CACTUS_LEVEL, LEVELS, 'expert', seed, 120, true);
      expect(intoStruck(sent), `seed ${seed}`).toEqual([]);
      during += duringWindup(sent).length;
    }
    expect(during).toBeGreaterThan(0);
  });
});

describe('the earlier bosses\' stand-in results are exactly as before Task 4', () => {
  const HOWLER: LevelDef = {
    ...P18, id: 'p2-8', world: 2, n: 8, boss: { key: 'moonHowler', lane: 2 },
    cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker'],
  };
  const MELON: LevelDef = { ...Z18, id: 'z2-8', world: 2, n: 8, boss: { key: 'frostMelon', lane: 2 } };
  /** Recorded on the base commit (cd0ec7a): winner (p/z) and the tick the fight ended, seeds 1-3, the stand-ins in the boy's seat. */
  const BEFORE: Record<string, string> = {
    'titan/beginner/1': 'p5086', 'titan/beginner/2': 'p6051', 'titan/beginner/3': 'z5092',
    'titan/average/1': 'p3768', 'titan/average/2': 'p4561', 'titan/average/3': 'p4202',
    'titan/expert/1': 'p3575', 'titan/expert/2': 'p4310', 'titan/expert/3': 'p4114',
    'oak/beginner/1': 'z3634', 'oak/beginner/2': 'z4453', 'oak/beginner/3': 'z3238',
    'oak/average/1': 'z3118', 'oak/average/2': 'z3010', 'oak/average/3': 'z2986',
    'oak/expert/1': 'z3275', 'oak/expert/2': 'z2573', 'oak/expert/3': 'z3133',
    'howler/beginner/1': 'z6339', 'howler/beginner/2': 'z5260', 'howler/beginner/3': 'p5457',
    'howler/average/1': 'p5554', 'howler/average/2': 'p5316', 'howler/average/3': 'p4955',
    'howler/expert/1': 'p5563', 'howler/expert/2': 'p5998', 'howler/expert/3': 'p5075',
    'melon/beginner/1': 'z7924', 'melon/beginner/2': 'z4136', 'melon/beginner/3': 'z4729',
    'melon/average/1': 'z3869', 'melon/average/2': 'z4639', 'melon/average/3': 'z4002',
    'melon/expert/1': 'z3604', 'melon/expert/2': 'z3641', 'melon/expert/3': 'z3425',
  };
  it('the Titan, Oak, Howler and Melon fights end with the same winner on the same tick', () => {
    const now: Record<string, string> = {};
    for (const [name, def] of [['titan', P18], ['oak', Z18], ['howler', HOWLER], ['melon', MELON]] as const) {
      for (const who of ['beginner', 'average', 'expert'] as const) {
        for (const seed of [1, 2, 3]) {
          const m = new Match(levelConfig(def, standInSave(who, def, LEVELS), seed));
          const bot = createLevelStandIn(who, def.side, seed);
          while (m.state.winner === null && m.state.tick < 30 * 400) m.step(bot.think(m));
          now[`${name}/${who}/${seed}`] = `${m.state.winner![0]}${m.state.tick}`;
        }
      }
    }
    expect(now).toEqual(BEFORE);
  });
});
