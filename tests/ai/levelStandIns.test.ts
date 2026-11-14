import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { levelById } from '../../src/adventure/levels';
import { SKILLS } from '../../src/ai/basicBot';
import { playLevel, standInFor, standInSave } from '../../src/ai/levelChecks';
import {
  AVERAGE, BEGINNER_TAP, LEVEL_STAND_INS, STAND_IN_DIFFICULTY, createLevelStandIn, standInTable,
} from '../../src/ai/levelStandIns';
import { Match } from '../../src/sim/match';
import type { Command } from '../../src/sim/types';

/** Plays `id` for `secs` seconds with a stand-in and an idle opponent; every command it sent, with the tick. */
function sent(id: string, who: (typeof LEVEL_STAND_INS)[number], secs: number, seed = 3): Array<{ tick: number; cmd: Command; refused: boolean }> {
  const def = levelById(id)!;
  const m = new Match(levelConfig(def, standInSave(who, def), seed));
  const bot = createLevelStandIn(who, def.side, seed);
  const out: Array<{ tick: number; cmd: Command; refused: boolean }> = [];
  for (let i = 0; i < secs * 30 && m.state.winner === null; i++) {
    const cmds = bot.think(m);
    const refused = cmds.map((c) => m.check(c) !== null);
    cmds.forEach((cmd, k) => out.push({ tick: m.state.tick, cmd, refused: refused[k]! }));
    m.step(cmds);
  }
  return out;
}

/** Every command a bot sends on `id` over `secs` seconds, the hero kept charged so it is always there to press. */
function heroCharged(id: string, bot: ReturnType<typeof createLevelStandIn>, secs: number, seed = 3): Command[] {
  const def = levelById(id)!;
  const m = new Match(levelConfig(def, standInSave('beginner', def), seed));
  const out: Command[] = [];
  for (let i = 0; i < secs * 30 && m.state.winner === null; i++) {
    m.state.players[def.side].heroTimer = 0;
    m.state.baseHp[def.side] = m.state.baseMaxHp[def.side];
    const cmds = bot.think(m);
    out.push(...cmds);
    m.step(cmds);
  }
  return out;
}

describe('the hero where the child has no hero button', () => {
  it('a stand-in made without the hero never fires it; with it (the default) the beginner does', () => {
    for (const id of ['p1-1', 'z1-1']) {
      const side = levelById(id)!.side;
      for (const who of LEVEL_STAND_INS) {
        expect(heroCharged(id, createLevelStandIn(who, side, 3, { hero: false }), 40).filter((c) => c.type === 'hero'), `${id} ${who}`).toEqual([]);
      }
      expect(heroCharged(id, createLevelStandIn('beginner', side, 3), 40).some((c) => c.type === 'hero'), id).toBe(true);
    }
  });

  it('the level checks give the stand-ins the hero exactly where the HUD shows its button (heroHidden)', () => {
    for (const id of ['p1-1', 'z1-1']) {
      for (const who of LEVEL_STAND_INS) expect(heroCharged(id, standInFor(levelById(id)!, who, 3), 40).some((c) => c.type === 'hero'), `${id} ${who}`).toBe(false);
    }
    for (const id of ['p1-2', 'z1-2']) expect(heroCharged(id, standInFor(levelById(id)!, 'beginner', 3), 40).some((c) => c.type === 'hero'), id).toBe(true);
  });
});

describe('the level stand-ins', () => {
  it.each(['p1-3', 'p1-5', 'z1-3', 'z1-5', 'p1-8'])('every stand-in sends only commands the match takes (%s)', (id) => {
    for (const who of LEVEL_STAND_INS) {
      const cmds = sent(id, who, 60);
      expect(cmds.length, `${id} ${who}`).toBeGreaterThan(0);
      expect(cmds.filter((c) => c.refused), `${id} ${who}`).toEqual([]);
    }
  });

  it('on a conveyor every stand-in plays the belt (no energy, no hand)', () => {
    for (const id of ['p1-5', 'z1-5']) {
      for (const who of LEVEL_STAND_INS) {
        const kinds = new Set(sent(id, who, 60).map((c) => c.cmd.type));
        expect(kinds.has('belt'), `${id} ${who}`).toBe(true);
        expect(kinds.has('place') || kinds.has('merge'), `${id} ${who}`).toBe(false);
      }
    }
  });

  it('the beginner taps a card every 4-6 s at most and never merges', () => {
    const cards = sent('p1-4', 'beginner', 120).filter((c) => c.cmd.type === 'place' || c.cmd.type === 'merge');
    expect(cards.every((c) => c.cmd.type === 'place')).toBe(true);
    for (let i = 1; i < cards.length; i++) expect(cards[i]!.tick - cards[i - 1]!.tick).toBeGreaterThanOrEqual(BEGINNER_TAP.min);
  });

  it('the average player is a plausible eight-year-old: every 3 s, 15% random, powers from 20 s, at most 4 Sunflowers', () => {
    for (const side of ['plants', 'zombies'] as const) {
      const t = standInTable('average', side);
      expect([t.thinkEvery, t.randomShare, t.powerFirst]).toEqual([AVERAGE.every, 0.15, 20]);
      expect(t.sunflowers).toBeLessThanOrEqual(4);
    }
    expect(AVERAGE.every).toBe(90);
    expect(standInTable('expert', 'plants')).toBe(SKILLS.plants.hard);
  });

  it('difficulty: the beginner on Easy, the others on Normal; only the average player buys upgrades', () => {
    expect(STAND_IN_DIFFICULTY).toEqual({ beginner: 'easy', average: 'medium', expert: 'medium' });
    const z8 = levelById('z1-8')!;
    expect(Object.keys(standInSave('average', z8).upgrades).length).toBeGreaterThan(0);
    expect(standInSave('expert', z8).upgrades).toEqual({});
    expect(standInSave('beginner', z8).zombies.unlocked).toEqual(['desertZombie', 'skeletonArcher']);
  });

  it('the expert puts Kernel-pults in the Titan\'s lane; a whole boss level ends', () => {
    const pults = sent('p1-8', 'expert', 90).filter((c) => c.cmd.type === 'place' && c.cmd.unit === 'kernelPult' && c.cmd.lane === 2);
    expect(pults.length).toBeGreaterThanOrEqual(1);
    expect(playLevel(levelById('p1-8')!, 'expert', 1).end).toBe('boss');
  });
});
