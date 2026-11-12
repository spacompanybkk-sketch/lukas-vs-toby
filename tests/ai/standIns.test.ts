import { describe, expect, it } from 'vitest';
import type { Bot } from '../../src/ai/bot';
import { DIFFICULTY, battleConfig } from '../../src/ai/difficulty';
import {
  ADULT_EVERY, CHILD_EVERY, SLOW_TAP_EVERY, SPAM_EVERY, createFortressPlants, createMergeSpamBot, createNewestCardChild,
  createRandomChild, createSpamBot, createSteadyZombies,
} from '../../src/ai/standIns';
import { fullConfig } from '../../src/ai/balanceChecks';
import { BALANCE } from '../../src/data/balance';
import { ALL_CARDS, UNIT_INFO } from '../../src/data/units';
import { createBasicBot } from '../../src/ai/basicBot';
import { Match, defaultConfig } from '../../src/sim/match';
import type { Command, Faction } from '../../src/sim/types';

/** Plays `ticks` of a match, checking every command a bot returns at the moment it returns it. */
function play(bots: Bot[], seed: number, ticks: number): { commands: Array<{ tick: number; cmd: Command }>; problems: string[]; match: Match } {
  const match = new Match(fullConfig(seed, BALANCE));
  const commands: Array<{ tick: number; cmd: Command }> = [];
  const problems: string[] = [];
  while (match.state.winner === null && match.state.tick < ticks) {
    const step: Command[] = [];
    for (const bot of bots) {
      const before = match.hash();
      for (const cmd of bot.think(match)) {
        const reason = match.check(cmd);
        if (reason !== null) problems.push(`tick ${match.state.tick}: ${JSON.stringify(cmd)} refused (${reason})`);
        if (cmd.faction !== bot.faction) problems.push(`tick ${match.state.tick}: wrong side`);
        commands.push({ tick: match.state.tick, cmd });
        step.push(cmd);
      }
      if (match.hash() !== before) problems.push(`tick ${match.state.tick}: a bot changed the match`);
    }
    match.step(step);
  }
  return { commands, problems, match };
}

const opponent = (f: Faction): Faction => (f === 'plants' ? 'zombies' : 'plants');

describe('stand-in players', () => {
  it.each(['plants', 'zombies'] as Faction[])('the spammer as %s plays only its card, on its schedule, and only legal moves', (side) => {
    const unit = side === 'plants' ? 'peashooter' : 'brainEater';
    const spam = createSpamBot(side, unit, 3);
    const { commands, problems } = play([spam, createBasicBot(opponent(side), 'medium', 3)], 3, 3000);
    expect(problems).toEqual([]);
    const mine = commands.filter((c) => c.cmd.faction === side);
    expect(mine.length).toBeGreaterThanOrEqual(4);
    for (const c of mine) {
      expect(c.cmd).toMatchObject({ type: 'place', unit });
      expect(c.tick % SPAM_EVERY).toBe(0);
    }
    if (side === 'plants') {
      // The rearmost free tile of its lane.
      const first = mine[0]?.cmd;
      expect(first?.type === 'place' && first.col).toBe(0);
    }
  });

  it.each(['plants', 'zombies'] as Faction[])('the merge spammer as %s puts its card into one unit, then the next', (side) => {
    const unit = side === 'plants' ? 'peashooter' : 'brainEater';
    const { commands, problems, match } = play([createMergeSpamBot(side, unit, 5), createBasicBot(opponent(side), 'medium', 5)], 5, 4000);
    expect(problems).toEqual([]);
    const mine = commands.filter((c) => c.cmd.faction === side).map((c) => c.cmd);
    const merges = mine.filter((c) => c.type === 'merge').length;
    expect(merges).toBeGreaterThan(0);
    expect(merges).toBeGreaterThanOrEqual(mine.filter((c) => c.type === 'place').length);
    expect(mine.every((c) => 'unit' in c && c.unit === unit)).toBe(true);
    expect(match.state.units.some((u) => u.faction === side && u.level >= 2) || match.state.winner !== null).toBe(true);
  });

  it.each(['plants', 'zombies'] as Faction[])('the random child as %s taps every 2 or 3 s, more than one card, never merges', (side) => {
    const { commands, problems } = play([createRandomChild(side, 9), createBasicBot(opponent(side), 'easy', 9)], 9, 6000);
    expect(problems).toEqual([]);
    const mine = commands.filter((c) => c.cmd.faction === side);
    expect(mine.length).toBeGreaterThan(10);
    for (const c of mine) {
      expect(c.cmd.type).toBe('place');
      expect(c.tick % CHILD_EVERY[side]).toBe(0);
    }
    // It taps whatever it can afford at that moment, so cheap cards come up most (as zombies it
    // rarely holds enough for a Skeleton Warrior), but never just one.
    expect(new Set(mine.map((c) => (c.cmd.type === 'place' ? c.cmd.unit : ''))).size).toBeGreaterThan(1);
  });

  it('every stand-in replays exactly from its seed, and another seed plays differently', () => {
    const log = (seed: number): string => JSON.stringify(
      play([createRandomChild('zombies', seed), createSpamBot('plants', 'sunflower', seed)], seed, 2000).commands,
    );
    expect(log(4)).toBe(log(4));
    expect(log(4)).not.toBe(log(5));
  });
});

describe('difficulty setup', () => {
  it('builds the default setup with the difficulty\'s income for the human and the computer', () => {
    for (const human of ['plants', 'zombies'] as Faction[]) {
      for (const skill of ['easy', 'medium', 'hard'] as const) {
        const config = battleConfig(4, human, skill);
        const income = DIFFICULTY[skill][human].income;
        expect(config.incomeMultiplier[human]).toBe(income.human);
        expect(config.incomeMultiplier[opponent(human)]).toBe(income.computer);
        expect(config.cards).toEqual(ALL_CARDS);
        expect({ ...config, incomeMultiplier: null, cards: null }).toEqual({ ...defaultConfig(4), incomeMultiplier: null, cards: null });
      }
    }
  });

  it('makes the computer err most on Easy and never on Hard, and earn most on Hard', () => {
    // Phase 1 also asked Hard to give the human no extra income; Hard as zombies now gives the
    // human 30% more (an adult sending steady waves must win 15-40%, Michal 2026-11-12).
    for (const human of ['plants', 'zombies'] as Faction[]) {
      const { easy, medium, hard } = { easy: DIFFICULTY.easy[human], medium: DIFFICULTY.medium[human], hard: DIFFICULTY.hard[human] };
      expect(easy.randomShare).toBeGreaterThanOrEqual(medium.randomShare);
      expect(medium.randomShare).toBeGreaterThanOrEqual(hard.randomShare);
      expect(hard.randomShare).toBe(0);
      expect(hard.income.computer).toBeGreaterThan(1);
      expect(hard.income.computer).toBeGreaterThanOrEqual(medium.income.computer);
      expect(easy.income.human).toBeGreaterThan(1);
    }
  });
});

describe('the stand-ins of phase 2', () => {
  it.each(['plants', 'zombies'] as Faction[])('the newest-card child as %s plays only legal taps on its schedule', (side) => {
    const { commands, problems } = play([createNewestCardChild(side, 3), createBasicBot(opponent(side), 'easy', 3)], 3, 4000);
    expect(problems).toEqual([]);
    const mine = commands.filter((c) => c.cmd.faction === side);
    expect(mine.length).toBeGreaterThan(5);
    for (const c of mine) expect(c.tick % CHILD_EVERY[side]).toBe(0);
    expect(new Set(mine.map((c) => (c.cmd.type === 'place' ? c.cmd.unit : ''))).size).toBeGreaterThan(1);
  });

  it('the newest-card child picks among the dearest affordable cards only', () => {
    const match = new Match(fullConfig(2, BALANCE));
    match.state.players.zombies.energy = 160; // Necromancer and Trident (150) are the dearest it can afford
    const [cmd] = createNewestCardChild('zombies', 2).think(match);
    expect(cmd?.type === 'place' && UNIT_INFO[cmd.unit].price).toBe(150);
  });

  it('the slow tapper is the random child once every 6 s', () => {
    const { commands } = play([createRandomChild('zombies', 4, SLOW_TAP_EVERY), createBasicBot('plants', 'easy', 4)], 4, 3000);
    const mine = commands.filter((c) => c.cmd.faction === 'zombies');
    expect(mine.length).toBeGreaterThan(5);
    for (const c of mine) expect(c.tick % SLOW_TAP_EVERY).toBe(0);
  });

  it('fortressPlants builds one lane first (Sunflowers, Peashooters, a Walnut Bomb in front), then the next', () => {
    const { commands, problems } = play([createFortressPlants(6), createBasicBot('zombies', 'easy', 6)], 6, 6000);
    expect(problems).toEqual([]);
    const places = commands.filter((c) => c.cmd.faction === 'plants' && c.cmd.type === 'place').map((c) => c.cmd);
    const first = places[0];
    if (first?.type !== 'place') throw new Error('no placement');
    const firstLane = places.filter((c) => c.type === 'place' && c.lane === first.lane).slice(0, 5);
    expect(firstLane.map((c) => (c.type === 'place' ? [c.unit, c.col] : null))).toEqual([
      ['sunflower', 0], ['peashooter', 2], ['sunflower', 1], ['peashooter', 3], ['walnutBomb', 5],
    ]);
    // Nothing goes into another lane before the first lane's five tiles are taken.
    const fifth = places.indexOf(firstLane[4] as (typeof places)[number]);
    expect(places.slice(0, fifth).every((c) => c.type === 'place' && c.lane === first.lane)).toBe(true);
    expect(new Set(places.map((c) => (c.type === 'place' ? c.lane : -1))).size).toBeGreaterThan(1);
    for (const c of commands.filter((x) => x.cmd.faction === 'plants')) {
      expect(c.cmd.type === 'spell').toBe(false);
      expect(c.tick % ADULT_EVERY).toBe(0);
    }
  });

  it('steadyZombies sends waves of three into one lane, never merges and casts no spell', () => {
    const { commands, problems } = play([createBasicBot('plants', 'medium', 7), createSteadyZombies(7)], 7, 6000);
    expect(problems).toEqual([]);
    const mine = commands.filter((c) => c.cmd.faction === 'zombies').map((c) => c.cmd);
    expect(mine.some((c) => c.type === 'merge' || c.type === 'spell')).toBe(false);
    const sends = mine.filter((c) => c.type === 'place');
    expect(sends.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i + 2 < sends.length; i += 3) {
      const wave = sends.slice(i, i + 3).map((c) => (c.type === 'place' ? c.lane : -1));
      expect(new Set(wave).size, `wave ${i / 3}`).toBe(1);
    }
    expect(new Set(sends.map((c) => (c.type === 'place' ? c.unit : ''))).size).toBeGreaterThan(3);
  });

  it('the phase-2 stand-ins replay exactly from their seed', () => {
    const log = (seed: number): string => JSON.stringify(
      play([createFortressPlants(seed), createSteadyZombies(seed)], seed, 3000).commands,
    );
    expect(log(8)).toBe(log(8));
    expect(log(8)).not.toBe(log(9));
  });
});
