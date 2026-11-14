import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import type { LevelDef, LevelTwist } from '../../src/adventure/types';
import { createBasicBot } from '../../src/ai/basicBot';
import type { Bot, Skill } from '../../src/ai/bot';
import { reckonLane } from '../../src/ai/laneModel';
import { standInFor, standInSave } from '../../src/ai/levelChecks';
import { LEVEL_STAND_INS } from '../../src/ai/levelStandIns';
import { freeTile, readLawn } from '../../src/ai/lawn';
import { ALL_CARDS } from '../../src/data/units';
import { cloneLawn, NO_TWIST } from '../../src/sim/lawn';
import { Match, defaultConfig } from '../../src/sim/match';
import { COLS, PLANT_COLS } from '../../src/sim/types';
import type { Command, Faction, LawnConfig, MatchConfig } from '../../src/sim/types';

/** The lawns the bots are tried on: each twist laid heavily, so a careless bot would trip on it. */
const TWISTS: Readonly<Record<'rocks' | 'fog' | 'ice' | 'lava', LevelTwist>> = {
  // Plant tiles (lane*8+col): the back and middle columns of every lane have a rock somewhere.
  rocks: { rocks: [0, 1, 9, 10, 18, 20, 27, 28, 36, 38, 3, 12, 21, 30, 39] },
  fog: { fog: true },
  ice: { iceLanes: [0, 2, 4] },
  // Lawn tiles (lane*10+col): columns 0-2 of lanes 0-1, 3-5 of lane 2, 1 and 6 of lanes 3-4.
  lava: { lavaTiles: [0, 1, 2, 10, 11, 12, 23, 24, 25, 31, 36, 41, 46] },
};

const SKILLS: readonly Skill[] = ['easy', 'medium', 'hard'];

/** A level for match `seed`: a battle with all ten cards a side, or (every fifth seed) a plant conveyor. */
function levelFor(seed: number, twist: LevelTwist): LevelDef {
  const side: Faction = seed % 2 === 1 ? 'plants' : 'zombies';
  const enemy: Faction = side === 'plants' ? 'zombies' : 'plants';
  const base: LevelDef = {
    id: `${side[0]}5-1`, side, world: 5, n: 1, kind: 'battle', cards: [...ALL_CARDS[side]],
    opponent: { skill: SKILLS[Math.floor(seed / 2) % 3]!, cards: [...ALL_CARDS[enemy]], incomeScale: 1 },
    waves: [], prepared: [], seconds: null, belt: null, boss: null, twist, startEnergy: null, spells: true, unlocks: null, teaches: null,
  };
  if (seed % 5 !== 0) return base;
  return {
    ...base, side: 'plants', id: 'p5-2', kind: 'conveyor', opponent: null, seconds: 90, cards: [],
    belt: { everySeconds: 3, cards: [...ALL_CARDS.plants] },
    waves: Array.from({ length: 14 }, (_, k) => ({ at: 10 + 5 * k, unit: ALL_CARDS.zombies[k % 5]!, lane: (k * 3 + seed) % 5 })),
  };
}

/** Every unlock held: the stand-ins' save for a level whose earlier levels do not exist. */
function heldAll(def: LevelDef, who: (typeof LEVEL_STAND_INS)[number]): ReturnType<typeof standInSave> {
  const s = standInSave(who, def, [def]);
  return { ...s, [def.side]: { ...s[def.side], unlocked: ALL_CARDS[def.side].slice(3) } };
}

interface Trip { who: string; tick: number; cmd: Command; why: string }

/**
 * Plays `def` on `seed` with a stand-in and the level's computer; every command the match refused
 * (checked in order within each step), and every plant put on lava while its lane had a free plain tile.
 */
function play(def: LevelDef, seed: number, maxTicks: number): { refused: Trip[]; onLava: Trip[] } {
  const who = LEVEL_STAND_INS[seed % 3]!;
  const config = levelConfig(def, heldAll(def, who), seed);
  const m = new Match(config);
  const bots: Array<{ name: string; bot: Bot }> = [{ name: `${who} ${def.side}`, bot: standInFor(def, who, seed, [def]) }];
  if (def.opponent !== null) {
    const enemy: Faction = def.side === 'plants' ? 'zombies' : 'plants';
    bots.push({ name: `computer ${enemy} ${def.opponent.skill}`, bot: createBasicBot(enemy, def.opponent.skill, seed * 7 + 1) });
  }
  bots.sort((a, b) => (a.bot.faction === 'plants' ? 0 : 1) - (b.bot.faction === 'plants' ? 0 : 1));
  const refused: Trip[] = [];
  const onLava: Trip[] = [];
  const lava = config.lawn.lava?.tiles ?? [];
  const nameOf = (f: Faction): string => bots.find((x) => x.bot.faction === f)?.name ?? f;
  while (m.state.winner === null && m.state.tick < maxTicks) {
    const all: Command[] = [];
    for (const { bot } of bots) {
      for (const cmd of bot.think(m)) {
        if ((cmd.type === 'place' || cmd.type === 'belt') && cmd.faction === 'plants' && lava.includes(cmd.lane * COLS + cmd.col)) {
          const view = readLawn(m.state)[cmd.lane]!;
          const plain = Array.from({ length: PLANT_COLS }, (_, c) => c).filter((c) => freeTile(view, c));
          if (plain.length > 0) onLava.push({ who: nameOf(cmd.faction), tick: m.state.tick, cmd, why: `free plain columns ${plain.join(',')}` });
        }
        all.push(cmd);
      }
    }
    // The match checks each command after the ones before it in the step are applied (two plays for
    // one tile in a step: the second is refused), and says so with `commandRejected`.
    const tick = m.state.tick;
    for (const e of m.step(all)) {
      if (e.type === 'commandRejected') refused.push({ who: nameOf(e.command.faction), tick, cmd: e.command, why: e.reason });
    }
  }
  return { refused, onLava };
}

describe('the bots read the lawn\'s twists (Review Focus 5)', () => {
  const lawnWith = (l: Partial<LawnConfig>): MatchConfig => ({ ...defaultConfig(1), lawn: { ...cloneLawn(NO_TWIST), ...l } });

  it('readLawn gives each lane its rocks, lava, ice and fog; freeTile is a tile with no plant, rock or lava', () => {
    const m = new Match(lawnWith({ rocks: [1 * PLANT_COLS + 2], lava: { tiles: [1 * COLS + 4, 2 * COLS + 9], dps: 15, burnTicks: 60 }, ice: { lanes: [3], speed: 1.6 }, fog: 5 }));
    const lawn = readLawn(m.state);
    expect(lawn[1]!.blocked[2]).toBe(true);
    expect(lawn[1]!.blocked[3]).toBe(false);
    expect(lawn[1]!.lava?.cols[4]).toBe(true);
    expect(lawn[2]!.lava?.cols[9]).toBe(true);
    expect(lawn[0]!.lava).toBeNull();
    expect(lawn[3]!.ice).toBe(1.6);
    expect(lawn[2]!.ice).toBe(1);
    expect(lawn[0]!.fog).toBe(5);
    expect([freeTile(lawn[1]!, 2), freeTile(lawn[1]!, 4), freeTile(lawn[1]!, 3)]).toEqual([false, false, true]);
    const plain = readLawn(new Match(defaultConfig(1)).state);
    expect(plain.every((v) => v.fog === null && v.ice === 1 && v.lava === null && v.blocked.every((b) => !b))).toBe(true);
  });

  it('the lane model: ice shortens the walk, lava burns the walkers, fog shortens the plants\' reach', () => {
    /** Lane 0 with a Peashooter on column 0 and a Brain Eater just sent, on lawn `l`. */
    const lane = (l: Partial<LawnConfig>): ReturnType<typeof readLawn>[number] => {
      const m = new Match({
        ...lawnWith(l), cards: { plants: ['peashooter'], zombies: ['brainEater'] }, startEnergy: { plants: 1000, zombies: 1000 },
      });
      m.step([
        { type: 'place', faction: 'plants', unit: 'peashooter', lane: 0, col: 0 },
        { type: 'place', faction: 'zombies', unit: 'brainEater', lane: 0, col: COLS - 1 },
      ]);
      return readLawn(m.state)[0]!;
    };
    const bal = new Match(defaultConfig(1)).balance;
    const plain = reckonLane(bal, lane({}), 0.5).stopping;
    expect(plain).toBeGreaterThan(0);
    expect(reckonLane(bal, lane({ ice: { lanes: [0], speed: 1.6 } }), 0.5).stopping).toBeLessThan(plain);
    expect(reckonLane(bal, lane({ lava: { tiles: [3, 4, 5], dps: 15, burnTicks: 60 } }), 0.5).stopping).toBeGreaterThan(plain);
    expect(reckonLane(bal, lane({ fog: 3 }), 0.5).stopping).toBeLessThan(plain);
  });

  for (const [name, twist] of Object.entries(TWISTS)) {
    it(`${name}: 100 seeded matches, no bot sends a refused command, and no plant goes on lava while its lane has a free plain tile`, () => {
      const refused: Trip[] = [];
      const onLava: Trip[] = [];
      for (let seed = 1; seed <= 100; seed++) {
        const r = play(levelFor(seed, twist), seed, 5400);
        refused.push(...r.refused);
        onLava.push(...r.onLava);
      }
      expect(refused.slice(0, 5), `${refused.length} refused`).toEqual([]);
      expect(onLava.slice(0, 5), `${onLava.length} on lava`).toEqual([]);
    }, 300_000);
  }

  it('fog: the plant computer puts a shooter where its shot reaches the zombie base (column 10 − fog or beyond)', () => {
    let forward = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const def = { ...levelFor(1, TWISTS.fog), opponent: null, cards: [...ALL_CARDS.plants] };
      const m = new Match({ ...levelConfig(def, heldAll(def, 'expert'), seed), cards: { plants: [...ALL_CARDS.plants], zombies: [] } });
      const bot = createBasicBot('plants', 'hard', seed);
      while (m.state.tick < 3600 && m.state.winner === null) m.step(bot.think(m));
      const reach = COLS - (m.state.config.lawn.fog ?? 0);
      if (m.state.units.some((u) => u.faction === 'plants' && ['peashooter', 'kernelPult', 'mangoPult'].includes(u.key) && Math.floor(u.x) >= reach)) forward += 1;
    }
    expect(forward).toBe(10);
  }, 120_000);
});
