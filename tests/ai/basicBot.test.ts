import { describe, expect, it } from 'vitest';
import { SKILLS, createBasicBot } from '../../src/ai/basicBot';
import type { Bot, Skill } from '../../src/ai/bot';
import { runBotMatch, runMatch } from '../../src/ai/runMatch';
import type { MatchResult } from '../../src/ai/runMatch';
import { newZombieMemory, zombieMove } from '../../src/ai/zombieStrategy';
import { BALANCE, seconds } from '../../src/data/balance';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { Command, Faction, MatchConfig } from '../../src/sim/types';
import { eventsOf } from '../sim/helpers';

const SKILL_NAMES: readonly Skill[] = ['easy', 'medium', 'hard'];
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
  it.each(SKILL_NAMES)('%s bots of both sides only return commands that match.check accepts, and never change the match', (skill) => {
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

  it('plays all six cards on the rich setup, merges Peashooters and Sunflowers, and Hard merges zombies', () => {
    const sent = SKILL_NAMES.flatMap((skill) => {
      const { log } = playChecked(4, createBasicBot('plants', skill, 4), createBasicBot('zombies', skill, 4), 6000, true);
      return log.flatMap((t) => t.commands);
    });
    const kinds = new Set(sent.map((c) => (c.type === 'remove' ? 'remove' : `${c.type}:${c.unit}`)));
    for (const kind of [
      'place:peashooter', 'place:sunflower', 'place:walnutBomb', 'merge:peashooter', 'merge:sunflower',
      'place:brainEater', 'place:veryFastWalker', 'place:skeletonWarrior',
    ]) expect(kinds, kind).toContain(kind);
    expect(sent.some((c) => c.type === 'merge' && c.faction === 'zombies'), 'a zombie merge').toBe(true);
    expect(kinds).not.toContain('remove'); // the shovel is never part of a bot's play
  });

  it('sends at most one command per think, and acts only on its own think interval', () => {
    for (const skill of SKILL_NAMES) {
      for (const seed of [5, 6]) {
        const { log } = playChecked(seed, createBasicBot('plants', skill, seed), createBasicBot('zombies', skill, seed), 3000, true);
        for (const faction of FACTIONS) {
          const ticks = log.filter((t) => t.commands.some((c) => c.faction === faction)).map((t) => t.tick);
          expect(ticks.length, `${skill} ${faction}`).toBeGreaterThan(1);
          // Every action falls on the same tick of the bot's interval.
          const every = SKILLS[faction][skill].thinkEvery;
          for (const tick of ticks) expect((tick - (ticks[0] ?? 0)) % every, `${skill} ${faction} acted on tick ${tick}`).toBe(0);
        }
        for (const { tick, commands } of log) {
          for (const faction of FACTIONS) {
            expect(commands.filter((c) => c.faction === faction).length, `${skill} tick ${tick}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it.each(SKILL_NAMES)('%s is deterministic: the same seed plays the same commands on a replay, another seed does not', (skill) => {
    const play = (seed: number): TickLog[] =>
      playChecked(7, createBasicBot('plants', skill, seed), createBasicBot('zombies', skill, seed), 3000).log;
    const first = play(11);
    expect(first.length).toBeGreaterThan(0);
    expect(play(11)).toEqual(first);
    expect(play(12)).not.toEqual(first);
  });

  it('gives a finished match no thought: it returns nothing and draws no random numbers', () => {
    const over = new Match(defaultConfig(1));
    over.state.players.plants.energy = 1000;
    over.state.players.zombies.energy = 1000;
    over.state.baseHp.zombies = 0;
    over.step();
    expect(over.state.winner).toBe('plants');
    for (const skill of SKILL_NAMES) {
      for (const faction of FACTIONS) {
        const asked = createBasicBot(faction, skill, 9);
        expect(asked.faction).toBe(faction);
        for (let tick = 0; tick < 60; tick++) {
          over.state.tick = tick; // a finished match's tick stands still; try every phase
          expect(asked.think(over)).toEqual([]);
        }
        // Had it drawn any random numbers, it would now play differently from a fresh twin.
        const fresh = createBasicBot(faction, skill, 9);
        const against = (): Bot => createBasicBot(faction === 'plants' ? 'zombies' : 'plants', 'medium', 3);
        const play = (bot: Bot): TickLog[] =>
          (faction === 'plants' ? playChecked(2, bot, against(), 1500) : playChecked(2, against(), bot, 1500)).log;
        expect(play(asked), `${skill} ${faction}`).toEqual(play(fresh));
      }
    }
  });
});

describe('runMatch', () => {
  it('plays to the end and reports the winner, the ticks and both bases as the match left them', () => {
    for (const seed of [3, 4, 5]) {
      const result = runMatch(defaultConfig(seed), [createBasicBot('plants', 'medium', seed), createBasicBot('zombies', 'medium', seed)]);
      expect(result.winner, `seed ${seed}`).not.toBe('draw');
      const loser: Faction = result.winner === 'plants' ? 'zombies' : 'plants';
      const winner: Faction = loser === 'plants' ? 'zombies' : 'plants';
      expect(result.baseHp[loser], `seed ${seed}`).toBeLessThanOrEqual(0);
      expect(result.baseHp[winner], `seed ${seed}`).toBeGreaterThan(0);
      expect(result.ticks).toBeGreaterThan(0);
      expect(result.ticks).toBeLessThanOrEqual(LAST_TICK);
    }
  });

  it("hands the match the plants' commands before the zombies', whatever order the bots come in", () => {
    // Each stub places a unit on tick 0; the observer reads who was spawned first on tick 1.
    const stub = (cmd: Command): Bot => ({ faction: cmd.faction, think: (m) => (m.state.tick === 0 ? [cmd] : []) });
    const plants = stub({ type: 'place', faction: 'plants', unit: 'sunflower', lane: 0, col: 0 });
    const zombies = stub({ type: 'place', faction: 'zombies', unit: 'veryFastWalker', lane: 1, col: 9 });
    const seen: Faction[][] = [];
    const observer: Bot = {
      faction: 'zombies',
      think: (m) => {
        if (m.state.tick === 1) seen.push(m.state.units.map((u) => u.faction));
        return [];
      },
    };
    runMatch(defaultConfig(1), [observer, zombies, plants], 2);
    runMatch(defaultConfig(1), [zombies, plants, observer], 2);
    expect(seen).toEqual([['plants', 'zombies'], ['plants', 'zombies']]);
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
    let hardMerges = 0;
    const results = SEEDS_1_TO_40.map((seed) => {
      // The very match runBotMatch(seed, skills) plays, with the hard bot's merges counted.
      const bots = FACTIONS.map((f) => createBasicBot(f, skills[f], seed));
      const counted = bots.map((bot): Bot => (bot.faction !== hardSide ? bot : {
        faction: bot.faction,
        think: (m) => {
          const commands = bot.think(m);
          hardMerges += commands.filter((c) => c.type === 'merge').length;
          return commands;
        },
      }));
      return runMatch(defaultConfig(seed), counted);
    });
    expect(results[0]).toEqual(runBotMatch(1, skills));
    expect(wins(results, hardSide)).toBeGreaterThanOrEqual(28);
    expect(hardMerges, 'merges by the hard bot').toBeGreaterThan(0);
  }, BULK_MS);
});

describe("the Hard zombies' merge rule", () => {
  const plan = SKILLS.zombies.hard;
  /** The line in energy at the default income: so many seconds of the zombies' trickle. */
  const line = plan.mergeSpareSeconds * BALANCE.trickle.zombies;

  /**
   * Zombies going down lane 2, the lane it last sent to: a Brain Eater held up by a Walnut Bomb
   * (fresh, but blocked), a half-dead Skeleton Warrior and a nearly fresh Brain Eater still walking.
   */
  function pushScene(): { match: Match; held: number; damaged: number; fresh: number } {
    const match = new Match(defaultConfig(1));
    spawnUnit(match.state, BALANCE, 'walnutBomb', 2, 3.5);
    const held = spawnUnit(match.state, BALANCE, 'brainEater', 2, 4);
    const damaged = spawnUnit(match.state, BALANCE, 'skeletonWarrior', 2, 7);
    const fresh = spawnUnit(match.state, BALANCE, 'brainEater', 2, 8.5);
    match.step(); // movement works out who is blocked
    damaged.hp = damaged.maxHp / 2;
    fresh.hp = fresh.maxHp - 10;
    expect([held.blocked, damaged.blocked, fresh.blocked]).toEqual([true, false, false]);
    return { match, held: held.id, damaged: damaged.id, fresh: fresh.id };
  }

  function move(match: Match, energy: number): Command | null {
    match.state.players.zombies.energy = energy;
    return zombieMove(match, { rng: 1 }, plan, { ...newZombieMemory(), lastLane: 2 });
  }

  it('is on for Hard only, with a line it can reach in play', () => {
    expect(SKILLS.zombies.easy.mergeSpareSeconds).toBe(0);
    expect(SKILLS.zombies.medium.mergeSpareSeconds).toBe(0);
    expect(line).toBeGreaterThan(0);
    expect(line).toBeLessThan(500);
  });

  it('above its line, merges onto the walking zombie of its last lane with the most health left, never a blocked one', () => {
    const { match, fresh } = pushScene();
    expect(move(match, line + 1)).toEqual({ type: 'merge', faction: 'zombies', unit: 'brainEater', targetId: fresh });
  });

  it('at its line exactly, sends a zombie instead of merging', () => {
    const { match } = pushScene();
    expect(move(match, line)?.type).toBe('place');
  });

  it('with only blocked zombies in its last lane, does not merge', () => {
    const { match, damaged, fresh } = pushScene();
    match.state.units = match.state.units.filter((u) => u.id !== damaged && u.id !== fresh);
    expect(move(match, line + 1)?.type).not.toBe('merge');
  });

  it('a Hard zombie bot merges onto a walking zombie of the lane it last sent to, on one of its phase ticks', () => {
    const match = new Match(defaultConfig(6));
    match.state.players.zombies.energy = 3000;
    const bot = createBasicBot('zombies', 'hard', 6);
    const sent: Array<{ tick: number; cmd: Command; walking: boolean; lane: number | null }> = [];
    let lastLane: number | null = null;
    const merges: Array<{ tick: number; walking: boolean; lane: number | null; lastLane: number | null }> = [];
    while (match.state.tick < seconds(30)) {
      const commands = bot.think(match);
      for (const cmd of commands) {
        const target = cmd.type === 'merge' ? match.state.units.find((u) => u.id === cmd.targetId) : undefined;
        sent.push({ tick: match.state.tick, cmd, walking: target?.blocked === false, lane: target?.lane ?? null });
        if (cmd.type === 'merge') merges.push({ tick: match.state.tick, walking: target?.blocked === false, lane: target?.lane ?? null, lastLane });
        if (cmd.type === 'place') lastLane = cmd.lane;
      }
      match.step(commands);
    }
    const first = sent[0];
    if (first?.cmd.type !== 'place') throw new Error('the bot did not start by sending a zombie');
    expect(merges.length).toBeGreaterThan(0);
    for (const m of merges) {
      expect(m.walking).toBe(true);
      expect(m.lane).toBe(m.lastLane);
      expect((m.tick - first.tick) % plan.thinkEvery).toBe(0);
    }
  });
});
