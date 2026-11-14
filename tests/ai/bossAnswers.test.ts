import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { LEVELS, levelById } from '../../src/adventure/levels';
import type { LevelDef } from '../../src/adventure/types';
import { standInSave } from '../../src/ai/levelChecks';
import { BOSS_ANSWER, createLevelStandIn } from '../../src/ai/levelStandIns';
import type { LevelStandIn } from '../../src/ai/levelStandIns';
import { Match } from '../../src/sim/match';
import { COLS } from '../../src/sim/types';
import type { Command } from '../../src/sim/types';

/**
 * What the stand-ins know about each boss (step-2 plan Task 4, content design §2). World 2's levels
 * do not exist yet, so the boss levels here are world 1's boss levels with the world-2 boss and the
 * world-2 hand; `levels` adds a level unlocking the Mango-pult before the Howler.
 */

const P18 = levelById('p1-8')!;
const Z18 = levelById('z1-8')!;
const HOWLER_LEVEL: LevelDef = {
  ...P18, id: 'p2-8', world: 2, n: 8, boss: { key: 'moonHowler', lane: 2 },
  cards: ['peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker'],
};
const MANGO_UNLOCK: LevelDef = { ...levelById('p1-3')!, id: 'p2-3', world: 2, n: 3, unlocks: 'mangoPult' };
const MELON_LEVEL: LevelDef = { ...Z18, id: 'z2-8', world: 2, n: 8, boss: { key: 'frostMelon', lane: 2 } };
const WITH_MANGO = [...LEVELS, MANGO_UNLOCK, HOWLER_LEVEL];
const WITHOUT_MANGO = [...LEVELS, HOWLER_LEVEL];

interface Sent { tick: number; cmd: Command; struck: ReadonlySet<number> }

/** Plays `def` with a stand-in for `secs` seconds; every command it sent, with the lanes a strike was winding up on. */
function play(def: LevelDef, levels: readonly LevelDef[], who: LevelStandIn, seed: number, secs: number, phase2 = false): Sent[] {
  const m = new Match(levelConfig(def, standInSave(who, def, levels), seed));
  const bot = createLevelStandIn(who, def.side, seed);
  const out: Sent[] = [];
  for (let i = 0; i < secs * 30 && m.state.winner === null; i++) {
    const boss = m.state.units.find((u) => u.key === def.boss!.key);
    if (phase2 && boss !== undefined && boss.phase === 0) boss.hp = boss.maxHp * 0.5; // straight to the strikes
    const struck = new Set((boss?.strikeTiles ?? []).map((t) => Math.floor(t / COLS)));
    const cmds = bot.think(m);
    for (const cmd of cmds) out.push({ tick: m.state.tick, cmd, struck });
    m.step(cmds);
  }
  return out;
}

const placed = (sent: Sent[]) => sent.filter((s): s is Sent & { cmd: Extract<Command, { type: 'place' }> } => s.cmd.type === 'place');

describe('BOSS_ANSWER', () => {
  it('the Titan\'s entry is the old TITAN_ANSWER: the expert two Kernel-pults, the average three Peashooters, anywhere sensible', () => {
    expect(BOSS_ANSWER.brainTitan).toEqual({ expert: { cards: ['kernelPult'], want: 2 }, average: { cards: ['peashooter'], want: 3 } });
  });

  it('the Howler: the expert two pults (Mango first) on columns 3-4 of its lane, the average three Peashooters; the Oak and the Melon (plant bosses) none', () => {
    expect(BOSS_ANSWER.moonHowler).toEqual({
      expert: { cards: ['mangoPult', 'kernelPult'], want: 2, cols: [3, 4] },
      average: { cards: ['peashooter'], want: 3 },
    });
    expect(BOSS_ANSWER.elderOak).toBeUndefined();
    expect(BOSS_ANSWER.frostMelon).toBeUndefined();
  });
});

describe('against the Moon Howler (lane 2)', () => {
  const PULTS = ['mangoPult', 'kernelPult'];
  const pultsAt34 = (sent: Sent[], cards: readonly string[]) =>
    placed(sent).filter((s) => cards.includes(s.cmd.unit) && s.cmd.lane === 2 && s.cmd.col >= 3 && s.cmd.col <= 4);

  it.each([1, 2, 3])('the expert plants two pults on columns 3-4 of its lane, a Mango-pult first when he holds it (seed %i)', (seed) => {
    const pults = pultsAt34(play(HOWLER_LEVEL, WITH_MANGO, 'expert', seed, 90), PULTS);
    expect(pults.length).toBeGreaterThanOrEqual(2);
    expect(pults[0]!.cmd.unit).toBe('mangoPult');
  });

  it.each([1, 2, 3])('without the Mango-pult he takes Kernel-pults there (seed %i)', (seed) => {
    const sent = play(HOWLER_LEVEL, WITHOUT_MANGO, 'expert', seed, 90);
    expect(pultsAt34(sent, ['kernelPult']).length).toBeGreaterThanOrEqual(2);
    expect(placed(sent).some((s) => s.cmd.unit === 'mangoPult')).toBe(false);
  });

  it('the average player shoots at it: Peashooters in its lane (up to three, on the back columns he has free)', () => {
    for (const seed of [1, 2, 3]) {
      const sent = placed(play(HOWLER_LEVEL, WITH_MANGO, 'average', seed, 120));
      expect(sent.filter((s) => s.cmd.unit === 'peashooter' && s.cmd.lane === 2).length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('against the Frost Melon\'s freeze', () => {
  const SEEDS = [1, 2, 3, 4];
  const intoStruck = (sent: Sent[]) => sent.filter((s) => (s.cmd.type === 'place' || s.cmd.type === 'belt') && s.struck.has(s.cmd.lane));
  const duringWindup = (sent: Sent[]) => sent.filter((s) => (s.cmd.type === 'place' || s.cmd.type === 'belt') && s.struck.size > 0);

  it('the expert never sends a zombie into a lane whose strike is winding up, but keeps sending into the others', () => {
    let during = 0;
    for (const seed of SEEDS) {
      const sent = play(MELON_LEVEL, LEVELS, 'expert', seed, 120, true);
      expect(intoStruck(sent), `seed ${seed}`).toEqual([]);
      during += duringWindup(sent).length;
    }
    expect(during).toBeGreaterThan(0);
  });

  it('the average player and the beginner are unaware: they send into a blinking lane now and then', () => {
    for (const who of ['average', 'beginner'] as const) {
      const n = SEEDS.reduce((k, seed) => k + intoStruck(play(MELON_LEVEL, LEVELS, who, seed, 120, true)).length, 0);
      expect(n, who).toBeGreaterThan(0);
    }
  });
});
