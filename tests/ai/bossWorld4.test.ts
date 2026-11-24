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
 * What the stand-ins know about the world-4 bosses (worlds-4 plan Task 4, content design §2, §5): the
 * Yeti's `recipe` (a Walnut Bomb at column 4, a Mango-pult at column 2, a Pumpkin-squash at column 3
 * of its lane, on the p4-8 layout), and the Glowcap, whom only the expert's strike dodge knows. World
 * 4's levels do not exist yet, so the boss levels here are world 1's with the world-4 boss.
 */

const P18 = levelById('p1-8')!;
const Z18 = levelById('z1-8')!;
const HAND = ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber', 'pumpkinSquash'] as const;
/** p4-8 as the content design lays it out: ice on lanes 0, 2 and 4, start energy 600, the cards the recipe needs. */
const P48: LevelDef = {
  ...P18, id: 'p4-8', world: 4, n: 8, boss: { key: 'yeti', lane: 2 }, cards: [...HAND],
  startEnergy: 600, twist: { iceLanes: [0, 2, 4] },
};
/**
 * The recipe test's hand: the three recipe cards and a Sunflower. The stand-in's
 * ordinary choices run between its answer's turns (`createSensible`) and, with a Potato Mine, a Peashooter or a
 * Kernel-pult in hand, can take the Pumpkin's tile first; the real p4-8's ten cards are Task 6's
 * to re-check (see the task report).
 */
const P48_LEAN: LevelDef = { ...P48, cards: ['sunflower', 'walnutBomb', 'mangoPult', 'pumpkinSquash'] };
/** The level that unlocks the Pumpkin Squash (a world-4 level in the real campaign). */
const PUMPKIN_UNLOCK: LevelDef = { ...levelById('p1-3')!, id: 'p4-5', world: 4, n: 5, unlocks: 'pumpkinSquash' };
const WORLD4 = [...LEVELS, PUMPKIN_UNLOCK, P48];
const WORLD4_LEAN = [...LEVELS, PUMPKIN_UNLOCK, P48_LEAN];
const GLOW_LEVEL: LevelDef = { ...Z18, id: 'z4-8', world: 4, n: 8, boss: { key: 'glowcap', lane: 2 } };

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
  it('the earlier bosses\' entries are unchanged', () => {
    expect(BOSS_ANSWER.brainTitan).toEqual({ expert: { cards: ['kernelPult'], want: 2 }, average: { cards: ['peashooter'], want: 3 } });
    expect(BOSS_ANSWER.sandPharaoh!.expert.recipe).toEqual([['peashooter', 1], ['torchwood', 3]]);
  });

  it('the Yeti: the expert\'s recipe is a Walnut Bomb at 4, a Mango-pult at 2, a Pumpkin-squash at 3; the average three Peashooters; the beginner nothing', () => {
    expect(BOSS_ANSWER.yeti).toEqual({
      expert: { cards: ['walnutBomb', 'mangoPult', 'pumpkinSquash'], want: 3, recipe: [['walnutBomb', 4], ['mangoPult', 2], ['pumpkinSquash', 3]] },
      average: { cards: ['peashooter'], want: 3 },
    });
  });

  it('the Glowcap (a plant boss) has no entry: only the strike dodge knows it', () => {
    expect(BOSS_ANSWER.glowcap).toBeUndefined();
  });
});

describe('against the Yeti (lane 2)', () => {
  it.each([1, 2, 3])('the expert plants W at [2,4], Mg at [2,2], Pu at [2,3], in that order (seed %i)', (seed) => {
    const lane2 = placed(play(P48_LEAN, WORLD4_LEAN, 'expert', seed, 90)).filter((s) => s.cmd.lane === 2 && ['walnutBomb', 'mangoPult', 'pumpkinSquash'].includes(s.cmd.unit));
    expect(lane2.length).toBeGreaterThanOrEqual(3);
    expect(lane2.slice(0, 3).map((s) => [s.cmd.unit, s.cmd.col])).toEqual([['walnutBomb', 4], ['mangoPult', 2], ['pumpkinSquash', 3]]);
  });

  it('the average player puts Peashooters in its lane; the beginner has no answer for it', () => {
    for (const seed of [1, 2, 3]) {
      const sent = placed(play(P48, WORLD4, 'average', seed, 200));
      expect(sent.filter((s) => s.cmd.unit === 'peashooter' && s.cmd.lane === 2).length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('against the Glowcap\'s spore cloud (the strike dodge)', () => {
  const intoStruck = (sent: Sent[]) => sent.filter((s) => (s.cmd.type === 'place' || s.cmd.type === 'belt') && s.struck.has(s.cmd.lane));

  it('the expert never sends a zombie into a lane with a cloud winding up; the average player, who has no dodge, does', () => {
    let averageInto = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sent = play(GLOW_LEVEL, LEVELS, 'expert', seed, 120, true);
      expect(intoStruck(sent), `seed ${seed}`).toEqual([]);
      averageInto += intoStruck(play(GLOW_LEVEL, LEVELS, 'average', seed, 120, true)).length;
    }
    expect(averageInto, 'the cloud\'s lanes are lanes the zombies use').toBeGreaterThan(0);
  });
});

describe('every world 1-3 boss stand-in result is exactly as before Task 4', () => {
  const HOWLER: LevelDef = {
    ...P18, id: 'p2-8', world: 2, n: 8, boss: { key: 'moonHowler', lane: 2 },
    cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker'],
  };
  const MELON: LevelDef = { ...Z18, id: 'z2-8', world: 2, n: 8, boss: { key: 'frostMelon', lane: 2 } };
  const P38: LevelDef = {
    ...P18, id: 'p3-8', world: 3, n: 8, boss: { key: 'sandPharaoh', lane: 2 },
    cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber'],
    twist: { rocks: rocks([[2, 2], [2, 4], [0, 1], [4, 1], [1, 5], [3, 5]]) },
  };
  const TORCH_UNLOCK: LevelDef = { ...levelById('p1-3')!, id: 'p3-4', world: 3, n: 4, unlocks: 'torchwood' };
  const WORLD3 = [...LEVELS.filter((l) => l.world <= 2), TORCH_UNLOCK, P38];
  const CACTUS: LevelDef = { ...Z18, id: 'z3-8', world: 3, n: 8, boss: { key: 'cactusKing', lane: 2 } };
  /** Recorded on the base commit (036d8a9): winner (p/z) and the tick the fight ended, seeds 1-3. */
  const BEFORE: Record<string, string> = {
    'titan/beginner/1': 'p5086',
    'titan/beginner/2': 'p6051',
    'titan/beginner/3': 'z5092',
    'titan/average/1': 'p3768',
    'titan/average/2': 'p4561',
    'titan/average/3': 'p4202',
    'titan/expert/1': 'p3575',
    'titan/expert/2': 'p4310',
    'titan/expert/3': 'p4114',
    'oak/beginner/1': 'z3634',
    'oak/beginner/2': 'z4453',
    'oak/beginner/3': 'z3238',
    'oak/average/1': 'z3118',
    'oak/average/2': 'z3010',
    'oak/average/3': 'z2986',
    'oak/expert/1': 'z3275',
    'oak/expert/2': 'z2573',
    'oak/expert/3': 'z3133',
    'howler/beginner/1': 'z6339',
    'howler/beginner/2': 'z5260',
    'howler/beginner/3': 'p5457',
    'howler/average/1': 'p5554',
    'howler/average/2': 'p5316',
    'howler/average/3': 'p4955',
    'howler/expert/1': 'p5563',
    'howler/expert/2': 'p5998',
    'howler/expert/3': 'p5075',
    'melon/beginner/1': 'z7924',
    'melon/beginner/2': 'z4136',
    'melon/beginner/3': 'z4729',
    'melon/average/1': 'z3869',
    'melon/average/2': 'z4639',
    'melon/average/3': 'z4002',
    'melon/expert/1': 'z3604',
    'melon/expert/2': 'z3641',
    'melon/expert/3': 'z3425',
    'pharaoh/beginner/1': 'z4775',
    'pharaoh/beginner/2': 'z4117',
    'pharaoh/beginner/3': 'z4810',
    'pharaoh/average/1': 'p5881',
    'pharaoh/average/2': 'z5248',
    'pharaoh/average/3': 'z4840',
    'pharaoh/expert/1': 'z5630',
    'pharaoh/expert/2': 'p6021',
    'pharaoh/expert/3': 'p6033',
    'cactus/beginner/1': 'z7758',
    'cactus/beginner/2': 'z4018',
    'cactus/beginner/3': 'z4051',
    'cactus/average/1': 'z5818',
    'cactus/average/2': 'z4394',
    'cactus/average/3': 'z2829',
    'cactus/expert/1': 'z6755',
    'cactus/expert/2': 'z3655',
    'cactus/expert/3': 'z3837'
  };
  it('the Titan, Oak, Howler, Melon, Pharaoh and Cactus King fights end with the same winner on the same tick', () => {
    const now: Record<string, string> = {};
    for (const [name, def, levels] of [['titan', P18, LEVELS], ['oak', Z18, LEVELS], ['howler', HOWLER, LEVELS], ['melon', MELON, LEVELS], ['pharaoh', P38, WORLD3], ['cactus', CACTUS, LEVELS]] as const) {
      for (const who of ['beginner', 'average', 'expert'] as const) {
        for (const seed of [1, 2, 3]) {
          const m = new Match(levelConfig(def, standInSave(who, def, levels), seed));
          const bot = createLevelStandIn(who, def.side, seed);
          while (m.state.winner === null && m.state.tick < 30 * 400) m.step(bot.think(m));
          now[`${name}/${who}/${seed}`] = `${m.state.winner![0]}${m.state.tick}`;
        }
      }
    }
    expect(now).toEqual(BEFORE);
  });
});
