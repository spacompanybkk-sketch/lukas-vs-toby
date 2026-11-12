import { describe, expect, it } from 'vitest';
import type { Bot } from '../../src/ai/bot';
import { DIFFICULTY, battleConfig } from '../../src/ai/difficulty';
import { CHILD_EVERY, SPAM_EVERY, createMergeSpamBot, createRandomChild, createSpamBot } from '../../src/ai/standIns';
import { createBasicBot } from '../../src/ai/basicBot';
import { Match, defaultConfig } from '../../src/sim/match';
import type { Command, Faction } from '../../src/sim/types';

/** Plays `ticks` of a match, checking every command a bot returns at the moment it returns it. */
function play(bots: Bot[], seed: number, ticks: number): { commands: Array<{ tick: number; cmd: Command }>; problems: string[]; match: Match } {
  const match = new Match(defaultConfig(seed));
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
        expect({ ...config, incomeMultiplier: null }).toEqual({ ...defaultConfig(4), incomeMultiplier: null });
      }
    }
  });

  it('gives the human on Easy a head start, and the computer on Hard extra income and no random moves', () => {
    for (const human of ['plants', 'zombies'] as Faction[]) {
      const { easy, medium, hard } = { easy: DIFFICULTY.easy[human], medium: DIFFICULTY.medium[human], hard: DIFFICULTY.hard[human] };
      expect(easy.income.human / easy.income.computer).toBeGreaterThan(medium.income.human / medium.income.computer);
      expect(easy.randomShare).toBeGreaterThanOrEqual(medium.randomShare);
      expect(hard.income.computer).toBeGreaterThan(1);
      expect(hard.income.human).toBe(1);
      expect(hard.randomShare).toBe(0);
    }
  });
});
