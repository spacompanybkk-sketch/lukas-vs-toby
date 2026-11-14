/**
 * Stand-in players for Adventure levels and Free Play (plan Task 8, spec 10's campaign checks).
 * They sit in the boy's seat; the level brings its own opponent (a computer, scripted waves, a
 * prepared garden, a boss).
 *
 * - **beginner** (Toby, almost 5, on Easy): taps every 4–6 s, a random pick among sensible options
 *   (a Sunflower at the back, a shooter in the back half, a wall in front of a shooter, a mine in
 *   front of a zombie; as zombies any card into any lane), never merges; presses every glowing
 *   button (hero, spells) about 1.5 s after it lights, aimed like a child (`childPower`). On a belt
 *   he takes a random card to a sensible tile.
 * - **average** (Lukas, 8, on Normal): the Medium computer's choices, a little slow and careless
 *   (one decision every 3 s, 15% of them random, no powers before 20 s, at most 4 Sunflowers); Marketplace upgrades as the campaign's rewards allow
 *   (`averageUpgrades` in `levelChecks.ts`: the coins of his stars, spent at the real prices on his favourites).
 * - **expert** (on Normal, no upgrades): the Hard computer's choices. Against the Brain Titan it
 *   knows the shield bounces straight shots: it puts lobbing Kernel-pults in the Titan's lane (the
 *   average player puts Peashooters there: he shoots at the giant).
 *
 * Every stand-in handles the conveyor (no energy, cards from the belt): it takes the belt card that
 * fits best (the beginner a random one) to a sensible tile or lane. Each is a pure function of the
 * match it is shown and its own seeded random numbers; make one per match.
 */

import type { Balance } from '../data/balance';
import { isStanding } from '../sim/lookup';
import type { Match } from '../sim/match';
import { randomInt } from '../sim/rng';
import { COLS, LANES, PLANT_COLS } from '../sim/types';
import type { CardKey, Command, Faction, SpellKey, Unit } from '../sim/types';
import { createBasicBot, SKILLS, POWER_PACING } from './basicBot';
import type { SkillTable } from './basicBot';
import type { Bot, Skill } from './bot';
import { shotDps } from './laneModel';
import { placeCommand, readLawn, sendCommand } from './lawn';
import type { BotRng, LaneView } from './lawn';
import { childPower } from './powers';

export type LevelStandIn = 'beginner' | 'average' | 'expert';
export const LEVEL_STAND_INS: readonly LevelStandIn[] = ['beginner', 'average', 'expert'];

/** Each stand-in's Adventure difficulty (income only: Easy ×1.25, Normal ×1). */
export const STAND_IN_DIFFICULTY: Readonly<Record<LevelStandIn, Skill>> = { beginner: 'easy', average: 'medium', expert: 'medium' };

/** The beginner taps once every 4–6 s (ticks, drawn per tap). */
export const BEGINNER_TAP = { min: 120, max: 180 } as const;
/** The beginner presses a glowing button this long after it lights (ticks). */
export const BEGINNER_REACTION = 45;
/**
 * The average player, a plausible eight-year-old (coordinator, Task 8 fix round): one decision every
 * 3 s, 15% of them a random legal play, no hero or spell before 20 s, at most 4 Sunflowers.
 */
export const AVERAGE = { every: 90, randomShare: 0.15, powerFirst: 20, sunflowers: 4 } as const;
/** How often the expert takes a belt card (ticks). */
export const EXPERT_BELT_EVERY = 15;

/** The average player's three first favourite units, per side (his newest unlocks join them: `favouritesAt`). */
export const FAVOURITES: Readonly<Record<Faction, readonly CardKey[]>> = {
  plants: ['peashooter', 'sunflower', 'walnutBomb'],
  zombies: ['brainEater', 'veryFastWalker', 'skeletonWarrior'],
};

/** The skill table each stand-in decides with (the beginner has none: he taps). */
export function standInTable(kind: Exclude<LevelStandIn, 'beginner'>, side: Faction): SkillTable {
  if (kind === 'expert') return SKILLS[side].hard;
  return {
    ...SKILLS[side].medium, ...POWER_PACING.medium, thinkEvery: AVERAGE.every, randomShare: AVERAGE.randomShare,
    powerFirst: AVERAGE.powerFirst, sunflowers: Math.min(AVERAGE.sunflowers, SKILLS[side].medium.sunflowers),
  };
}

const SALT: Readonly<Record<LevelStandIn, number>> = { beginner: 0x1e7e_0001, average: 0x1e7e_0002, expert: 0x1e7e_0003 };

function rngFor(seed: number, kind: LevelStandIn, side: Faction): BotRng {
  return { rng: (seed ^ SALT[kind] ^ (side === 'plants' ? 0x0100_0000 : 0x0200_0000)) >>> 0 };
}

/** Shooters (they shoot down the lane: a wall in front of one is worth it). */
const SHOOTERS: ReadonlySet<string> = new Set(['peashooter', 'kernelPult', 'mangoPult']);
const WALLS: ReadonlySet<string> = new Set(['walnutBomb', 'avocadoBunker']);

/** The front-most zombie (smallest x) standing in a lane, or undefined. */
function nearestZombie(view: LaneView): Unit | undefined {
  let best: Unit | undefined;
  for (const z of view.zombies) if (best === undefined || z.x < best.x) best = z;
  return best;
}

/** The front-most plant column in a lane (-1: none). */
function frontCol(view: LaneView, keys?: ReadonlySet<string>): number {
  let front = -1;
  view.tiles.forEach((p, col) => { if (p !== undefined && (keys === undefined || keys.has(p.key))) front = col; });
  return front;
}

/**
 * The tiles of `lane` where a plant `card` would make sense to a child who knows the basics: a
 * Sunflower at the back, a shooter in the back half, a wall in front of a shooter (behind the
 * nearest zombie), a mine just in front of a zombie (or anywhere ahead with none in sight), any
 * other plant in the middle. Free tiles only; the match still has the last word.
 */
function sensibleCols(view: LaneView, card: CardKey): number[] {
  const free = (col: number): boolean => col >= 0 && col < PLANT_COLS && view.tiles[col] === undefined;
  const zombie = nearestZombie(view);
  const zx = zombie === undefined ? COLS : zombie.x;
  const range = (lo: number, hi: number): number[] => {
    const out: number[] = [];
    for (let c = lo; c <= hi; c++) if (free(c) && c + 0.5 < zx) out.push(c);
    return out;
  };
  if (card === 'sunflower') return range(0, 1);
  if (SHOOTERS.has(card)) return range(0, 3);
  if (WALLS.has(card)) {
    const shooter = frontCol(view, SHOOTERS);
    if (shooter < 0) return [];
    return range(shooter + 1, Math.min(PLANT_COLS - 1, shooter + 3));
  }
  if (card === 'potatoMine') {
    if (zombie === undefined) return [];
    const c = Math.floor(zombie.x) - 1;
    return range(Math.max(0, c - 1), c);
  }
  return range(1, 5);
}

/** Every sensible placement of a plant `card` (lanes with zombies first when asked). */
function sensiblePlants(lawn: readonly LaneView[], card: CardKey): Command[] {
  const out: Command[] = [];
  for (const view of lawn) for (const col of sensibleCols(view, card)) out.push(placeCommand('plants', card, view.lane, col));
  return out;
}

/** The lane a sensible player sends a zombie to: the one whose plants shoot least and hold least. */
function weakestLane(b: Balance, lawn: readonly LaneView[], rng: BotRng): number {
  const start = randomInt(rng, LANES);
  let best = Infinity;
  let lane = start;
  for (let i = 0; i < LANES; i++) {
    const view = lawn[(start + i) % LANES];
    if (view === undefined) continue;
    const score = view.plants.reduce((n, p) => n + shotDps(b, p) * 100 + p.hp, 0);
    if (score < best) { best = score; lane = view.lane; }
  }
  return lane;
}

/**
 * The best use of a plant belt card for a sensible player, or null to keep it: a shooter where the
 * zombies press hardest and the lane shoots least; a wall in front of the shooters of the lane with
 * the nearest zombie; a mine in front of the nearest zombie.
 */
function plantBeltCommand(match: Match, card: CardKey, slot: number, lawn: readonly LaneView[]): Command | null {
  const b = match.balance;
  const belt = (lane: number, col: number): Command => ({ type: 'belt', faction: 'plants', slot, lane, col });
  const ok = (cmd: Command): boolean => match.check(cmd) === null;
  // Lanes by how close their nearest zombie is (no zombie: last), then by how little they shoot.
  const pressure = (v: LaneView): number => {
    const z = nearestZombie(v);
    const shoot = v.plants.reduce((n, p) => n + shotDps(b, p), 0);
    return (z === undefined ? 100 : z.x * 5) + shoot;
  };
  const lanes = [...lawn].sort((a, c) => pressure(a) - pressure(c) || a.lane - c.lane);
  if (SHOOTERS.has(card)) {
    // The lane that shoots least for its pressure: shooters spread before they stack.
    const byNeed = [...lawn].sort((a, c) => {
      const need = (v: LaneView): number => v.plants.filter((p) => SHOOTERS.has(p.key)).length * 3 - (nearestZombie(v) === undefined ? 0 : 2);
      return need(a) - need(c) || a.lane - c.lane;
    });
    for (const v of byNeed) for (const col of sensibleCols(v, card)) if (ok(belt(v.lane, col))) return belt(v.lane, col);
    return null;
  }
  if (WALLS.has(card)) {
    for (const v of lanes) {
      if (nearestZombie(v) === undefined && v !== lanes[0]) continue;
      if (v.plants.some((p) => WALLS.has(p.key))) continue;
      for (const col of sensibleCols(v, card).reverse()) if (ok(belt(v.lane, col))) return belt(v.lane, col);
    }
    return null;
  }
  if (card === 'potatoMine') {
    for (const v of lanes) for (const col of sensibleCols(v, card).reverse()) if (ok(belt(v.lane, col))) return belt(v.lane, col);
    return null;
  }
  for (const v of lanes) for (const col of sensibleCols(v, card)) if (ok(belt(v.lane, col))) return belt(v.lane, col);
  return null;
}

/** The sensible player's belt move: the first belt card with a good use (a full belt plays any). */
function sensibleBelt(match: Match, side: Faction, rng: BotRng, lane: { current: number; sent: number }): Command | null {
  const s = match.state;
  const lawn = readLawn(s);
  if (side === 'plants') {
    for (let slot = 0; slot < s.belt.length; slot++) {
      const cmd = plantBeltCommand(match, s.belt[slot] as CardKey, slot, lawn);
      if (cmd !== null) return cmd;
    }
    // A full belt drops new cards: play the oldest anywhere it fits rather than lose the next.
    if (s.belt.length >= (s.config.belt?.slots ?? 0)) return anyBeltTile(match, 'plants', 0, rng);
    return null;
  }
  // Zombies: push one lane with three, then look again for the weakest.
  if (s.belt.length === 0) return null;
  if (lane.current < 0 || lane.sent >= 3) { lane.current = weakestLane(match.balance, lawn, rng); lane.sent = 0; }
  // Tanks first, so the others walk behind them.
  let slot = s.belt.findIndex((c) => c === 'skeletonWarrior');
  if (slot < 0) slot = 0;
  const cmd: Command = { type: 'belt', faction: 'zombies', slot, lane: lane.current, col: COLS - 1 };
  if (match.check(cmd) !== null) return null;
  lane.sent += 1;
  return cmd;
}

/** A belt card from `slot` onto any tile (lane for zombies) the match takes, from a random start. */
function anyBeltTile(match: Match, side: Faction, slot: number, rng: BotRng): Command | null {
  const start = randomInt(rng, LANES);
  for (let i = 0; i < LANES; i++) {
    const lane = (start + i) % LANES;
    const cols = side === 'zombies' ? [COLS - 1] : Array.from({ length: PLANT_COLS }, (_, c) => c);
    for (const col of cols) {
      const cmd: Command = { type: 'belt', faction: side, slot, lane, col };
      if (match.check(cmd) === null) return cmd;
    }
  }
  return null;
}

/** The beginner's belt move: a random belt card to a sensible tile (any lane for zombies). */
function beginnerBelt(match: Match, side: Faction, rng: BotRng): Command | null {
  const s = match.state;
  if (s.belt.length === 0) return null;
  const slot = randomInt(rng, s.belt.length);
  const card = s.belt[slot] as CardKey;
  if (side === 'zombies') {
    const cmd: Command = { type: 'belt', faction: 'zombies', slot, lane: randomInt(rng, LANES), col: COLS - 1 };
    return match.check(cmd) === null ? cmd : null;
  }
  const options = sensiblePlants(readLawn(s), card)
    .map((c) => (c.type === 'place' ? { type: 'belt', faction: 'plants', slot, lane: c.lane, col: c.col } as Command : c))
    .filter((c) => match.check(c) === null);
  if (options.length > 0) return options[randomInt(rng, options.length)] as Command;
  return s.belt.length >= (s.config.belt?.slots ?? 0) ? anyBeltTile(match, 'plants', slot, rng) : null;
}

/** The beginner's card tap: a random sensible placement of an affordable card, or nothing. */
function beginnerCard(match: Match, side: Faction, rng: BotRng): Command | null {
  const s = match.state;
  const options: Command[] = [];
  if (side === 'zombies') {
    for (const card of s.config.cards.zombies) {
      for (let lane = 0; lane < LANES; lane++) {
        const cmd = sendCommand(card, lane);
        if (match.check(cmd) === null) options.push(cmd);
      }
    }
  } else {
    const lawn = readLawn(s);
    for (const card of s.config.cards.plants) for (const cmd of sensiblePlants(lawn, card)) if (match.check(cmd) === null) options.push(cmd);
  }
  return options.length === 0 ? null : (options[randomInt(rng, options.length)] as Command);
}

/** The beginner: see the note at the top. */
function createBeginner(side: Faction, seed: number, hero: boolean): Bot {
  const rng = rngFor(seed, 'beginner', side);
  let nextTap = BEGINNER_TAP.min + randomInt(rng, BEGINNER_TAP.max - BEGINNER_TAP.min + 1);
  const readySince: Partial<Record<SpellKey | 'hero', number>> = {};
  return {
    faction: side,
    think(match) {
      const s = match.state;
      if (s.winner !== null) return [];
      // The glowing buttons: pressed about 1.5 s after they light, whatever else he is doing.
      const player = s.players[side];
      const ready = (key: SpellKey | 'hero', on: boolean): boolean => {
        if (!on) { delete readySince[key]; return false; }
        readySince[key] ??= s.tick;
        return s.tick - (readySince[key] as number) >= BEGINNER_REACTION;
      };
      let glowing = ready('hero', hero && s.config.heroes[side] && player.heroTimer === 0);
      for (const slot of player.spells) glowing = ready(slot.key, slot.timer === 0) || glowing;
      if (glowing && s.tick % 15 === 0) {
        const power = childPower(match, side, rng, hero);
        if (power !== null) return [power];
      }
      if (s.tick < nextTap) return [];
      nextTap = s.tick + BEGINNER_TAP.min + randomInt(rng, BEGINNER_TAP.max - BEGINNER_TAP.min + 1);
      const cmd = s.config.belt !== null && s.config.belt.side === side ? beginnerBelt(match, side, rng) : beginnerCard(match, side, rng);
      return cmd === null ? [] : [cmd];
    },
  };
}

/** The Brain Titan's lane while it stands (a plants level), or -1. */
function titanLane(match: Match): number {
  const boss = match.state.config.boss;
  if (boss?.key !== 'brainTitan') return -1;
  return match.state.units.some((u) => u.key === 'brainTitan' && isStanding(u)) ? boss.lane : -1;
}

/**
 * Shooters of `card` in the Titan's lane, up to `want` of them (null when there are enough, the
 * card is not held, or no tile takes one).
 */
function titanAnswer(match: Match, card: CardKey, want: number): Command | null {
  const lane = titanLane(match);
  if (lane < 0 || !match.state.config.cards.plants.includes(card)) return null;
  const view = readLawn(match.state)[lane];
  if (view === undefined) return null;
  if (view.plants.filter((p) => p.key === card).length >= want) return null;
  for (const col of sensibleCols(view, card)) {
    const cmd = placeCommand('plants', card, lane, col);
    if (match.check(cmd) === null) return cmd;
  }
  return null;
}

/**
 * What each sensible player puts in the Titan's lane: the expert knows its shield bounces straight
 * shots and plants lobbing Kernel-pults; the average player just shoots at the giant.
 */
export const TITAN_ANSWER: Readonly<Record<'average' | 'expert', { card: CardKey; want: number }>> = {
  expert: { card: 'kernelPult', want: 2 },
  average: { card: 'peashooter', want: 3 },
};

/** The average player and the expert: the computer's choices at their pace, plus the belt and the Titan. */
function createSensible(kind: 'average' | 'expert', side: Faction, seed: number, hero: boolean): Bot {
  const table = standInTable(kind, side);
  const card = createBasicBot(side, kind === 'expert' ? 'hard' : 'medium', seed ^ SALT[kind], table);
  const rng = rngFor(seed, kind, side);
  const beltEvery = kind === 'expert' ? EXPERT_BELT_EVERY : AVERAGE.every;
  const lane = { current: -1, sent: 0 };
  // Without the hero's button, the computer's hero presses are never made.
  const powerOk = (c: Command): boolean => c.type === 'spell' || (hero && c.type === 'hero');
  const own = (cmds: Command[]): Command[] => (hero ? cmds : cmds.filter((c) => c.type !== 'hero'));
  return {
    faction: side,
    think(match) {
      const s = match.state;
      if (s.winner !== null) return [];
      if (s.config.belt !== null && s.config.belt.side === side) {
        // No energy: the hero and spells as the computer would fire them, and the belt.
        const out: Command[] = card.think(match).filter(powerOk);
        if (s.tick % beltEvery === 0) {
          // The average player's mistakes: now and then a random belt card to a random sensible tile.
          const careless = kind === 'average' && randomInt(rng, 100) < AVERAGE.randomShare * 100;
          const cmd = careless ? beginnerBelt(match, side, rng) : sensibleBelt(match, side, rng, lane);
          if (cmd !== null) out.push(cmd);
        }
        return out;
      }
      if (side === 'plants' && s.tick % table.thinkEvery === 0) {
        const answer = titanAnswer(match, TITAN_ANSWER[kind].card, TITAN_ANSWER[kind].want);
        if (answer !== null) {
          const powers = card.think(match).filter(powerOk);
          return [...powers, answer];
        }
      }
      return own(card.think(match));
    },
  };
}

/**
 * A stand-in of `kind` for `side` in one match (see the note at the top). `hero` false: a level
 * where the child has no hero button yet (`heroHidden`); the stand-in never fires the hero.
 */
export function createLevelStandIn(kind: LevelStandIn, side: Faction, seed: number, opts: { hero?: boolean } = {}): Bot {
  const hero = opts.hero ?? true;
  return kind === 'beginner' ? createBeginner(side, seed, hero) : createSensible(kind, side, seed, hero);
}
