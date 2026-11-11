import { describe, expect, it } from 'vitest';
import { createBasicBot } from '../../src/ai/basicBot';
import type { Bot, Skill } from '../../src/ai/bot';
import { runBotMatch, runMatch } from '../../src/ai/runMatch';
import type { MatchResult } from '../../src/ai/runMatch';
import { Match, defaultConfig } from '../../src/sim/match';
import type { Command, Faction, MatchConfig } from '../../src/sim/types';
import { eventsOf } from '../sim/helpers';

const SKILLS: readonly Skill[] = ['easy', 'medium', 'hard'];
const FACTIONS: readonly Faction[] = ['plants', 'zombies'];
const SEEDS_1_TO_40 = Array.from({ length: 40 }, (_, i) => i + 1);
const LAST_TICK = 14_400; // 8:00
/** Bulk matches get a generous budget: a full match is about 14,000 steps. */
const BULK_MS = 60_000;

/** What happened on one tick of a match between two bots. */
interface TickLog { tick: number; commands: Command[] }

/**
 * The default setup, or a rich one: more energy, triple income and bases that last the whole
 * 3,000 ticks, so the bots do much more.
 */
function setup(seed: number, rich: boolean): MatchConfig {
  const config = defaultConfig(seed);
  if (rich) {
    config.startEnergy = { plants: 500, zombies: 500 };
    config.incomeMultiplier = { plants: 3, zombies: 3 };
    config.baseHp = { plants: 100_000, zombies: 100_000 };
  }
  return config;
}

/**
 * Plays up to `ticks` ticks between `plants` and `zombies` the way `runMatch` does, and on every
 * tick checks each returned command against `match.check` at the moment it is returned, and
 * that the bots left the match exactly as they found it.
 */
function playChecked(
  seed: number, plants: Bot, zombies: Bot, ticks: number, rich = false,
): { log: TickLog[]; problems: string[]; match: Match } {
  const match = new Match(setup(seed, rich));
  const log: TickLog[] = [];
  const problems: string[] = [];
  while (match.state.winner === null && match.state.tick < ticks) {
    const before = match.hash();
    const commands: Command[] = [];
    for (const bot of [plants, zombies]) {
      for (const cmd of bot.think(match)) {
        const reason = match.check(cmd);
        if (reason !== null) problems.push(`tick ${match.state.tick}: ${JSON.stringify(cmd)} refused (${reason})`);
        if (cmd.faction !== bot.faction) problems.push(`tick ${match.state.tick}: ${bot.faction} bot sent ${JSON.stringify(cmd)}`);
        commands.push(cmd);
      }
    }
    if (match.hash() !== before) problems.push(`tick ${match.state.tick}: a bot changed the match`);
    if (commands.length > 0) log.push({ tick: match.state.tick, commands });
    const events = match.step(commands);
    for (const e of eventsOf(events, 'commandRejected')) problems.push(`tick ${match.state.tick - 1}: step refused ${e.reason}`);
  }
  return { log, problems, match };
}

function wins(results: readonly MatchResult[], side: Faction): number {
  return results.filter((r) => r.winner === side).length;
}

describe('createBasicBot', () => {
  it.each(SKILLS)('%s bots of both sides only return commands that match.check accepts, and never change the match', (skill) => {
    for (const rich of [false, true]) {
      for (const seed of [1, 2, 3]) {
        const label = `${skill}, ${rich ? 'rich' : 'default'} setup, seed ${seed}`;
        const plants = createBasicBot('plants', skill, seed);
        const { log, problems } = playChecked(seed, plants, createBasicBot('zombies', skill, seed), 3000, rich);
        expect(problems, label).toEqual([]);
        // Guards against a bot that passes by doing nothing.
        for (const faction of FACTIONS) {
          const sent = log.flatMap((t) => t.commands).filter((c) => c.faction === faction);
          expect(sent.length, `${label}, ${faction}`).toBeGreaterThanOrEqual(rich ? 10 : 3);
        }
      }
    }
  });

  it('plays every card and merges on the rich setup', () => {
    const sent = SKILLS.flatMap((skill) => {
      const { log } = playChecked(4, createBasicBot('plants', skill, 4), createBasicBot('zombies', skill, 4), 6000, true);
      return log.flatMap((t) => t.commands);
    });
    const kinds = new Set(sent.map((c) => (c.type === 'remove' ? 'remove' : `${c.type}:${c.unit}`)));
    for (const kind of [
      'place:peashooter', 'place:sunflower', 'place:walnutBomb', 'merge:peashooter',
      'place:brainEater', 'place:veryFastWalker', 'place:skeletonWarrior',
    ]) expect(kinds, kind).toContain(kind);
    expect(kinds).not.toContain('remove'); // the shovel is never part of a bot's play
  });

  it('sends at most one command per think, and acts only every 60, 30 or 15 ticks for easy, medium, hard', () => {
    const every: Record<Skill, number> = { easy: 60, medium: 30, hard: 15 };
    for (const skill of SKILLS) {
      for (const seed of [5, 6]) {
        const { log } = playChecked(seed, createBasicBot('plants', skill, seed), createBasicBot('zombies', skill, seed), 3000, true);
        for (const faction of FACTIONS) {
          const ticks = log.filter((t) => t.commands.some((c) => c.faction === faction)).map((t) => t.tick);
          expect(ticks.length, `${skill} ${faction}`).toBeGreaterThan(1);
          // Every action falls on the same tick of the bot's interval.
          for (const tick of ticks) expect((tick - (ticks[0] ?? 0)) % every[skill], `${skill} ${faction} acted on tick ${tick}`).toBe(0);
        }
        for (const { tick, commands } of log) {
          for (const faction of FACTIONS) {
            expect(commands.filter((c) => c.faction === faction).length, `${skill} tick ${tick}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it.each(SKILLS)('%s is deterministic: the same seed plays the same commands on a replay, another seed does not', (skill) => {
    const play = (seed: number): TickLog[] =>
      playChecked(7, createBasicBot('plants', skill, seed), createBasicBot('zombies', skill, seed), 3000).log;
    const first = play(11);
    expect(first.length).toBeGreaterThan(0);
    expect(play(11)).toEqual(first);
    expect(play(12)).not.toEqual(first);
  });

  it('returns nothing once the match is over, on any tick of its interval', () => {
    const match = new Match(defaultConfig(1));
    match.state.players.plants.energy = 1000;
    match.state.players.zombies.energy = 1000;
    match.state.baseHp.zombies = 0;
    match.step();
    expect(match.state.winner).toBe('plants');
    for (const skill of SKILLS) {
      for (const faction of FACTIONS) {
        const bot = createBasicBot(faction, skill, 1);
        expect(bot.faction).toBe(faction);
        for (let tick = 0; tick < 60; tick++) {
          match.state.tick = tick; // a finished match's tick stands still; try every phase
          expect(bot.think(match)).toEqual([]);
        }
      }
    }
  });
});

describe('runMatch', () => {
  it('plays to the end and reports the winner, the ticks and both bases', () => {
    const result = runMatch(defaultConfig(3), [createBasicBot('plants', 'medium', 3), createBasicBot('zombies', 'medium', 3)]);
    expect(['plants', 'zombies', 'draw']).toContain(result.winner);
    expect(result.ticks).toBeGreaterThan(0);
    expect(result.ticks).toBeLessThanOrEqual(LAST_TICK);
    const loser = result.winner === 'plants' ? 'zombies' : result.winner === 'zombies' ? 'plants' : null;
    if (loser !== null) expect(result.baseHp[loser]).toBeLessThanOrEqual(0);
  });

  it('gives the same result for the same seeds, and passes the bots\' commands to the match in a fixed order', () => {
    const play = (order: 'pz' | 'zp'): MatchResult => {
      const plants = createBasicBot('plants', 'hard', 21);
      const zombies = createBasicBot('zombies', 'hard', 21);
      return runMatch(defaultConfig(21), order === 'pz' ? [plants, zombies] : [zombies, plants]);
    };
    expect(play('zp')).toEqual(play('pz'));
  });

  it('stops at maxTicks and calls an unfinished match a draw', () => {
    const config = defaultConfig(1);
    const result = runMatch(config, [], 100);
    expect(result).toEqual({ winner: 'draw', ticks: 100, baseHp: config.baseHp });
  });
});

describe('bot against bot', () => {
  it('medium against medium, seeds 1..40: each side wins at least 8 and every match ends by tick 14,400', () => {
    // Run past 8:00 so a match that would not end shows up as one, rather than as a cut-off draw.
    const results = SEEDS_1_TO_40.map((seed) => runBotMatch(seed, { plants: 'medium', zombies: 'medium' }, 2 * LAST_TICK));
    const lengths = results.map((r) => r.ticks);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(LAST_TICK);
    expect(wins(results, 'plants'), 'plants wins').toBeGreaterThanOrEqual(8);
    expect(wins(results, 'zombies'), 'zombies wins').toBeGreaterThanOrEqual(8);
  }, BULK_MS);

  it.each(FACTIONS)('hard beats easy in at least 28 of 40 as %s', (hardSide) => {
    const easySide: Faction = hardSide === 'plants' ? 'zombies' : 'plants';
    const skills = { [hardSide]: 'hard', [easySide]: 'easy' } as Record<Faction, Skill>;
    const results = SEEDS_1_TO_40.map((seed) => runBotMatch(seed, skills));
    expect(wins(results, hardSide)).toBeGreaterThanOrEqual(28);
  }, BULK_MS);
});
