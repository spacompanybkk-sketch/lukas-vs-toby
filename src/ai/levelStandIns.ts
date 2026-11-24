/**
 * Stand-in players for Adventure levels and Free Play (plan Task 8, spec 10's campaign checks).
 * They sit in the boy's seat; the level brings its own opponent (a computer, scripted waves, a
 * prepared garden, a boss).
 *
 * - **beginner** (Toby, almost 5, on Easy): taps every 4–6 s, a random pick among sensible options
 *   (a Sunflower at the back, a shooter in the back half - in fog moved forward just enough to
 *   reach the zombie base, `fogShift` -, a wall in front of a shooter, a mine in
 *   front of a zombie; as zombies any card into any lane), never merges; presses every glowing
 *   button (hero, spells) about 1.5 s after it lights, aimed like a child (`childPower`). On a belt
 *   he takes a random card to a sensible tile.
 * - **average** (Lukas, 8, on Normal): the Medium computer's choices, a little slow and careless
 *   (one decision every 3 s, 15% of them random, no powers before 20 s, at most 4 Sunflowers); Marketplace upgrades as the campaign's rewards allow
 *   (`averageUpgrades` in `levelChecks.ts`: the coins of his stars, spent at the real prices on his favourites).
 * - **expert** (on Normal, no upgrades): the Hard computer's choices. He knows the bosses
 *   (`BOSS_ANSWER`): lobbing pults in the Brain Titan's and the Moon Howler's lane, where the average
 *   player puts Peashooters (he shoots at the giant); as the zombies he never sends into a lane
 *   whose strike is winding up (`strikeLanes`). The average player and the beginner are unaware.
 *   On a zombie belt with ice (z2-5) he reads which lane gives; the others push as without ice.
 *
 * In a Breakthrough (a garden to break: z1-3, z1-6, Free Play's gardens) the average player and the
 * expert push one lane with every zombie (`breakthroughLane`): the expert reads which lane gives as
 * the computer reads a lane and stacks it, the average player takes the one with the fewest plants.
 *
 * - **child** (a measuring tool, zombies only): how a 5-year-old or a casual adult taps - bursts of 2-3
 *   cards into a favourite lane, then a long idle gap (`CHILD`, `createChild`).
 *
 * Every stand-in handles the conveyor (no energy, cards from the belt): it takes the belt card that
 * fits best (the beginner a random one) to a sensible tile or lane. Each is a pure function of the
 * match it is shown and its own seeded random numbers; make one per match.
 */

import type { Balance } from '../data/balance';
import { isBoss, isStanding } from '../sim/lookup';
import type { Match } from '../sim/match';
import { nextRandom, randomInt } from '../sim/rng';
import { COLS, LANES, PLANT_COLS } from '../sim/types';
import type { BossKey, CardKey, Command, Faction, SpellKey, Unit } from '../sim/types';
import { createBasicBot, SKILLS, POWER_PACING } from './basicBot';
import type { SkillTable } from './basicBot';
import type { Bot, Skill } from './bot';
import { shotDps } from './laneModel';
import { UNIT_INFO } from '../data/units';
import { freeTile, placeCommand, randomLegal, readLawn, sendCommand, shuffledLanes } from './lawn';
import type { BotRng, LaneView } from './lawn';
import { childPower } from './powers';
import { choose } from './wants';
import { cardsFor, laneSurplus, newZombieMemory } from './zombieStrategy';
import type { ZombieMemory } from './zombieStrategy';

export type LevelStandIn = 'beginner' | 'average' | 'expert' | 'child';
/**
 * The three stand-ins the band tests judge. `child` (a measuring tool, see `createChild`) is left out
 * on purpose: no bands judge it yet. `tools/levels.ts --who child` reaches it.
 */
export const LEVEL_STAND_INS: readonly LevelStandIn[] = ['beginner', 'average', 'expert'];

/** Each stand-in's Adventure difficulty (income only: Easy ×1.25, Normal ×1). */
export const STAND_IN_DIFFICULTY: Readonly<Record<LevelStandIn, Skill>> = { beginner: 'easy', average: 'medium', expert: 'medium', child: 'easy' };

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
export function standInTable(kind: 'average' | 'expert', side: Faction): SkillTable {
  if (kind === 'expert') return SKILLS[side].hard;
  return {
    ...SKILLS[side].medium, ...POWER_PACING.medium, thinkEvery: AVERAGE.every, randomShare: AVERAGE.randomShare,
    powerFirst: AVERAGE.powerFirst, sunflowers: Math.min(AVERAGE.sunflowers, SKILLS[side].medium.sunflowers),
  };
}

const SALT: Readonly<Record<LevelStandIn, number>> = { beginner: 0x1e7e_0001, average: 0x1e7e_0002, expert: 0x1e7e_0003, child: 0x1e7e_0004 };

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

/** The columns, 0-3, a child puts a shooter on: the back half of the lawn. */
const SHOOTER_COLS = { lo: 0, hi: 3 } as const;

/**
 * How far the beginner moves his shooter columns forward in fog (step-2 Task 6 ruling: the p2-1 fog
 * lesson shows a child that peas fly only so far, so he plants forward): just far enough that his
 * front shooter column reaches the zombie base, i.e. at least one column ≥ `COLS − reach`. 0 with no
 * fog, and 0 at reach 7 or more (column 3 already reaches column 10).
 */
export function fogShift(fog: number | null): number {
  return fog === null ? 0 : Math.max(0, COLS - fog - SHOOTER_COLS.hi);
}

/**
 * The tiles of `lane` where a plant `card` would make sense to a child who knows the basics: a
 * Sunflower at the back, a shooter in the back half, a wall in front of a shooter (behind the
 * nearest zombie), a mine just in front of a zombie (or anywhere ahead with none in sight), any
 * other plant in the middle. Free tiles only; the match still has the last word. `shift` moves the
 * shooter columns forward (the beginner in fog: `fogShift`); every other card is unchanged.
 */
function sensibleCols(view: LaneView, card: CardKey, shift = 0): number[] {
  const free = (col: number): boolean => col >= 0 && col < PLANT_COLS && freeTile(view, col);
  const zombie = nearestZombie(view);
  const zx = zombie === undefined ? COLS : zombie.x;
  const range = (lo: number, hi: number): number[] => {
    const out: number[] = [];
    for (let c = lo; c <= hi; c++) if (free(c) && c + 0.5 < zx) out.push(c);
    return out;
  };
  if (card === 'sunflower') return range(0, 1);
  if (SHOOTERS.has(card)) return range(SHOOTER_COLS.lo + shift, SHOOTER_COLS.hi + shift);
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

/**
 * Every sensible placement of a plant `card` (lanes with zombies first when asked). `fogAware`: the
 * beginner's choice - his shooters move forward in fog just enough to reach the base (`fogShift`).
 */
function sensiblePlants(lawn: readonly LaneView[], card: CardKey, fogAware = false): Command[] {
  const out: Command[] = [];
  for (const view of lawn) {
    const shift = fogAware ? fogShift(view.fog) : 0;
    for (const col of sensibleCols(view, card, shift)) out.push(placeCommand('plants', card, view.lane, col));
  }
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

/**
 * The sensible player's belt move: the first belt card with a good use (a full belt plays any). As
 * the zombies he pushes one lane with three cards, then looks again: the lane whose plants shoot
 * and hold least - or, the expert on a lawn with ice, the lane that gives (`breakthroughLane`: he
 * knows the icy lanes are fast; the average player does not look at the ice). No ice: both as before.
 */
function sensibleBelt(match: Match, side: Faction, rng: BotRng, lane: { current: number; sent: number }, kind: 'average' | 'expert' = 'average'): Command | null {
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
  if (lane.current < 0 || lane.sent >= 3) {
    // On ice the expert reads which lane gives, as in a Breakthrough (the walk is shorter on the
    // icy lanes, so more of a zombie arrives): the Tundra's belt level is about choosing a fast lane.
    const reads = kind === 'expert' && match.state.config.lawn.ice !== null;
    lane.current = reads ? breakthroughLane(match, 'expert', rng).lane : weakestLane(match.balance, lawn, rng);
    lane.sent = 0;
  }
  // Tanks first, so the others walk behind them.
  let slot = s.belt.findIndex((c) => c === 'skeletonWarrior');
  if (slot < 0) slot = 0;
  const cmd: Command = { type: 'belt', faction: 'zombies', slot, lane: lane.current, col: COLS - 1 };
  if (match.check(cmd) !== null) return null;
  lane.sent += 1;
  return cmd;
}

/** A belt card from `slot` onto any tile (lane for zombies) the match takes, from a random start; never on lava. */
function anyBeltTile(match: Match, side: Faction, slot: number, rng: BotRng): Command | null {
  const start = randomInt(rng, LANES);
  const lawn = readLawn(match.state);
  for (let i = 0; i < LANES; i++) {
    const lane = (start + i) % LANES;
    const lava = lawn[lane]?.lava?.cols;
    const cols = side === 'zombies' ? [COLS - 1] : Array.from({ length: PLANT_COLS }, (_, c) => c).filter((c) => lava?.[c] !== true);
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
  const options = sensiblePlants(readLawn(s), card, true)
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
    for (const card of s.config.cards.plants) for (const cmd of sensiblePlants(lawn, card, true)) if (match.check(cmd) === null) options.push(cmd);
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

/**
 * What a sensible plant player puts in a zombie boss's lane (`BOSS_ANSWER`): up to `want` plants of
 * `cards` in all, the first of `cards` he holds that a tile takes, on `cols` (lo..hi, free tiles
 * short of the nearest zombie) or wherever `sensibleCols` says.
 */
export interface BossAnswer {
  readonly cards: readonly CardKey[];
  readonly want: number;
  readonly cols?: readonly [number, number];
  /** An ordered plan instead of `want` plants of `cards`: `[card, col]`, each planted in the boss's lane in turn (`bossAnswer`). */
  readonly recipe?: readonly (readonly [CardKey, number])[];
}

/**
 * What each sensible player knows about each zombie boss (a plants level; plant bosses have no entry).
 * - Brain Titan: the expert knows its shield bounces straight shots and plants lobbing Kernel-pults;
 *   the average player just shoots at the giant.
 * - Moon Howler: its dome bounces straight shots and the fog caps every shot at 5 tiles, so the
 *   expert plants two pults (the Mango-pult first) on columns 3-4 of its lane; the average player
 *   puts three Peashooters at the usual columns. The beginner knows nothing of either.
 * - Sand Pharaoh: its sand swirl halves shots and its sandstorm blinds plants, so the expert follows
 *   a recipe in its lane: a Peashooter at column 1, a Torchwood at column 3 in front of it (fire
 *   peas), over the rocks of its lane; the average player puts three Peashooters. The Cactus King
 *   (a plant boss) has no entry: only the expert's strike dodge knows its rockfall.
 */
export const BOSS_ANSWER: Readonly<Partial<Record<BossKey, Readonly<Record<'average' | 'expert', BossAnswer>>>>> = {
  brainTitan: { expert: { cards: ['kernelPult'], want: 2 }, average: { cards: ['peashooter'], want: 3 } },
  moonHowler: { expert: { cards: ['mangoPult', 'kernelPult'], want: 2, cols: [3, 4] }, average: { cards: ['peashooter'], want: 3 } },
  sandPharaoh: {
    expert: { cards: ['peashooter', 'torchwood'], want: 2, recipe: [['peashooter', 1], ['torchwood', 3]] },
    average: { cards: ['peashooter'], want: 3 },
  },
};

/** The level's zombie boss with an answer, and its lane while it stands (a plants level), or null. */
function answeredBoss(match: Match, kind: 'average' | 'expert'): { lane: number; answer: BossAnswer } | null {
  const boss = match.state.config.boss;
  if (boss === null) return null;
  const answer = BOSS_ANSWER[boss.key]?.[kind];
  if (answer === undefined) return null;
  return match.state.units.some((u) => u.key === boss.key && isStanding(u)) ? { lane: boss.lane, answer } : null;
}

/** The free tiles of `view` on columns lo..hi short of its nearest zombie. */
function colsBetween(view: LaneView, lo: number, hi: number): number[] {
  const zombie = nearestZombie(view);
  const zx = zombie === undefined ? COLS : zombie.x;
  const out: number[] = [];
  for (let c = Math.max(0, lo); c <= Math.min(PLANT_COLS - 1, hi); c++) if (freeTile(view, c) && c + 0.5 < zx) out.push(c);
  return out;
}

/**
 * The next step of a recipe: the first `[card, col]` not standing yet, in order, as a placement, or
 * null when the match refuses it now (no energy yet: he waits and keeps the order) or all stand. A
 * step whose tile a rock or another plant holds, or whose card he lacks, is skipped.
 */
function recipeStep(match: Match, view: LaneView, recipe: readonly (readonly [CardKey, number])[]): Command | null {
  for (const [card, col] of recipe) {
    if (view.tiles[col]?.key === card) continue;
    if (!match.state.config.cards.plants.includes(card) || !freeTile(view, col)) continue;
    const cmd = placeCommand('plants', card, view.lane, col);
    return match.check(cmd) === null ? cmd : null;
  }
  return null;
}

/**
 * The sensible player's next answer to the boss (`BOSS_ANSWER`), or null when there is no boss with
 * an answer, there are enough already, he holds none of its cards, or no tile takes one.
 */
function bossAnswer(match: Match, kind: 'average' | 'expert'): Command | null {
  const found = answeredBoss(match, kind);
  if (found === null) return null;
  const { lane, answer } = found;
  const held = answer.cards.filter((c) => match.state.config.cards.plants.includes(c));
  if (held.length === 0) return null;
  const view = readLawn(match.state)[lane];
  if (view === undefined) return null;
  if (answer.recipe !== undefined) return recipeStep(match, view, answer.recipe);
  if (view.plants.filter((p) => answer.cards.includes(p.key as CardKey)).length >= answer.want) return null;
  for (const card of held) {
    const cols = answer.cols === undefined ? sensibleCols(view, card) : colsBetween(view, answer.cols[0], answer.cols[1]);
    for (const col of cols) {
      const cmd = placeCommand('plants', card, lane, col);
      if (match.check(cmd) === null) return cmd;
    }
  }
  return null;
}

/**
 * The lanes a boss's strike is winding up on (its `strikeTiles`, which the child sees blink), or
 * an empty set.
 */
export function strikeLanes(match: Match): ReadonlySet<number> {
  const lanes = new Set<number>();
  if (match.state.config.boss === null) return lanes;
  for (const u of match.state.units) {
    if (!isBoss(u.key) || !isStanding(u)) continue;
    for (const t of u.strikeTiles) lanes.add(Math.floor(t / COLS));
  }
  return lanes;
}

/** The zombie expert's dodge: no zombie into a lane whose strike is winding up (the computer's choice is dropped; he looks again). */
function dodgeStrikes(match: Match, cmds: Command[]): Command[] {
  const lanes = strikeLanes(match);
  if (lanes.size === 0) return cmds;
  return cmds.filter((c) => !((c.type === 'place' || c.type === 'belt') && lanes.has(c.lane)));
}

/**
 * A Breakthrough (a garden to break, nobody rebuilding it): the lane a sensible zombie player pushes
 * with everything he sends. The expert reads it as the computer reads a lane (`laneSurplus`: where
 * a fresh Brain Eater, behind the zombies he already has there, gets furthest past the plants' fire),
 * so he keeps stacking the lane that gives; the average player just takes the lane with the fewest
 * plants, read afresh each time. Ties from a random start.
 */
export function breakthroughLane(match: Match, kind: 'average' | 'expert', rng: BotRng): LaneView {
  const lawn = readLawn(match.state);
  const order = shuffledLanes(rng).map((l) => lawn[l] as LaneView);
  const score = (v: LaneView): number => (kind === 'expert' ? laneSurplus(match.balance, v, true) : -v.plants.length);
  let best = order[0] as LaneView;
  for (const v of order) if (score(v) > score(best)) best = v;
  return best;
}

/** The sensible player's Breakthrough move: the best answer for `breakthroughLane` (as the computer picks cards), waiting for its energy. */
function breakthroughMove(match: Match, kind: 'average' | 'expert', table: SkillTable, rng: BotRng, memory: ZombieMemory): Command | null {
  const view = breakthroughLane(match, kind, rng);
  return choose(match, cardsFor(view, table, rng, memory).map((card) => ({
    cmd: sendCommand(card, view.lane), wait: 'energy' as const, onChosen: () => { memory.lastLane = view.lane; },
  })));
}

/** The average player and the expert: the computer's choices at their pace, plus the belt, the Titan and the Breakthrough push. */
function createSensible(kind: 'average' | 'expert', side: Faction, seed: number, hero: boolean, strong: StrongExpert | null): Bot {
  const table = strong === null ? standInTable(kind, side) : { ...standInTable(kind, side), ...strong.table };
  const card = createBasicBot(side, kind === 'expert' ? 'hard' : 'medium', seed ^ SALT[kind], table);
  const rng = rngFor(seed, kind, side);
  const beltEvery = kind === 'expert' ? EXPERT_BELT_EVERY : AVERAGE.every;
  const lane = { current: -1, sent: 0 };
  const memory = newZombieMemory();
  // Without the hero's button, the computer's hero presses are never made.
  const powerOk = (c: Command): boolean => c.type === 'spell' || (hero && c.type === 'hero');
  const own = (cmds: Command[]): Command[] => (hero ? cmds : cmds.filter((c) => c.type !== 'hero'));
  const think = (match: Match): Command[] => {
    const s = match.state;
    if (s.winner !== null) return [];
    if (s.config.belt !== null && s.config.belt.side === side) {
      // No energy: the hero and spells as the computer would fire them, and the belt.
      const out: Command[] = card.think(match).filter(powerOk);
      if (s.tick % beltEvery === 0) {
        // The average player's mistakes: now and then a random belt card to a random sensible tile.
        const careless = kind === 'average' && randomInt(rng, 100) < AVERAGE.randomShare * 100;
        const cmd = careless ? beginnerBelt(match, side, rng) : sensibleBelt(match, side, rng, lane, kind);
        if (cmd !== null) out.push(cmd);
      }
      return out;
    }
    if (side === 'zombies' && (s.config.mode === 'breakthrough' || (strong?.stack === true && s.config.mode === 'battle'))) {
      // The hero and spells as the computer fires them; the cards all down the lane that gives.
      const out: Command[] = card.think(match).filter(powerOk);
      if (s.tick % table.thinkEvery === 0) {
        const careless = kind === 'average' && randomInt(rng, 100) < AVERAGE.randomShare * 100;
        const cmd = careless ? randomLegal(match, side, rng) : breakthroughMove(match, kind, table, rng, memory);
        if (cmd !== null) out.push(cmd);
      }
      return out;
    }
    if (side === 'plants' && s.tick % table.thinkEvery === 0) {
      const answer = bossAnswer(match, kind);
      if (answer !== null) {
        const powers = card.think(match).filter(powerOk);
        return [...powers, answer];
      }
    }
    return own(card.think(match));
  };
  if (kind === 'expert' && side === 'zombies') return { faction: side, think: (match) => dodgeStrikes(match, think(match)) };
  return { faction: side, think };
}

/**
 * The child (a measuring tool; zombies only), modelled on a 5-year-old or a casual adult who taps in
 * bursts. All numbers are ticks (30 per second) unless noted.
 * - Bursts: waits until it can pay for `burst` (2-3) cards, sends them `burstSpacing` apart (about 1 s
 *   in all), then sits idle `gap` (4-10 s, drawn per burst).
 * - Lanes: a favourite lane gets `favouriteShare` of the sends, otherwise a neighbouring lane. Every
 *   `switchEvery` (20-40 s) it looks for a lane with the fewest plants and moves its favourite there
 *   after `reaction` (2-3 s).
 * - Cards: affordable cards weighted towards the newest and the most expensive ("the cool one"), and a
 *   little towards its last pick.
 * - Hero and spells: pressed `power` (1-3 s) after they light, into the favourite lane, no targeting.
 */
export const CHILD = {
  burst: { min: 2, max: 3 },
  burstSpacing: 10,
  /** The original idle gap between bursts (4-10 s): the `pace: null` variant, the fast first child. */
  gap: { min: 120, max: 300 },
  /**
   * The pace of a person who loses track of energy: cards sent per minute, on average. Each gap is drawn
   * so that the burst before it, plus the gap, takes `cards x 60 / cardsPerMinute` seconds, give or take
   * `paceJitter`; the energy he does not spend just banks. `DEFAULT_PACE` is the pace `child` plays at.
   */
  paceJitter: 0.3,
  /** About 20% of bursts are a single card. */
  singleShare: 0.2,
  favouriteShare: 0.7,
  switchEvery: { min: 600, max: 1200 },
  /** He sees a new open lane (or the plants' change) 2-4 s late. */
  reaction: { min: 60, max: 120 },
  power: { min: 30, max: 90 },
  /** Card weight: 1, plus up to 2 for the newest, up to 2 for the dearest, plus this for the last pick. */
  repeatBonus: 1,
  /** A burst stuck on recharging cards waits this long (about 1.5 s) before it gives up. */
  patience: 45,
} as const;

/** The pace `child` plays at by default (cards a minute): set by the sweep in child-standin-report.md. */
export const DEFAULT_PACE = 6;

const between = (rng: BotRng, r: { min: number; max: number }): number => r.min + randomInt(rng, r.max - r.min + 1);

/** The lane with the fewest plants (a random one of any tie) other than `not`, as the child sees it. */
function openLane(lawn: readonly LaneView[], not: number, rng: BotRng): number {
  let fewest = Infinity;
  for (const v of lawn) if (v.lane !== not) fewest = Math.min(fewest, v.plants.length);
  const open = lawn.filter((v) => v.lane !== not && v.plants.length === fewest);
  return (open[randomInt(rng, open.length)] as LaneView).lane;
}

/**
 * The child, for the zombie side. The plant side is not modelled yet: it is the `beginner`.
 */
function createChild(side: Faction, seed: number, hero: boolean, pace: number | null = DEFAULT_PACE): Bot {
  if (side === 'plants') return createBeginner(side, seed, hero); // plant side: aliased to the beginner
  const rng = rngFor(seed, 'child', side);
  let favourite = randomInt(rng, LANES);
  let nextBurst = between(rng, CHILD.gap);
  let left = 0; // cards still to send in this burst
  let nextSend = 0;
  const drawWant = (): number => (nextRandom(rng) < CHILD.singleShare ? 1 : between(rng, CHILD.burst));
  let want = drawWant();
  let burstStart = 0;
  let burstCards = 0;
  let giveUp = 0; // the tick a burst that cannot go on ends
  let lastCard: CardKey | null = null;
  let switchAt = between(rng, CHILD.switchEvery);
  let pending: { lane: number; at: number } | null = null;
  const readyAt: Partial<Record<SpellKey | 'hero', { since: number; wait: number }>> = {};

  const lane = (): number => {
    if (nextRandom(rng) < CHILD.favouriteShare) return favourite;
    const near = [favourite - 1, favourite + 1].filter((l) => l >= 0 && l < LANES);
    return near[randomInt(rng, near.length)] as number;
  };

  const pickCard = (match: Match, l: number): CardKey | null => {
    const cards = match.state.config.cards.zombies;
    // He has counted his burst: first a card that leaves enough for the ones still to come, else any he can pay.
    const cheapest = Math.min(...cards.map((c) => UNIT_INFO[c].price));
    const maxPrice = Math.max(...cards.map((c) => UNIT_INFO[c].price));
    const weigh = (spare: number): Array<{ c: CardKey; w: number }> => cards
      .map((c, i) => ({ c, w: 1 + (cards.length > 1 ? 2 * i / (cards.length - 1) : 0) + 2 * UNIT_INFO[c].price / maxPrice + (c === lastCard ? CHILD.repeatBonus : 0) }))
      .filter(({ c }) => UNIT_INFO[c].price <= spare && match.check(sendCommand(c, l)) === null);
    const energy = match.state.players[side].energy;
    let options = weigh(energy - (left - 1) * cheapest);
    if (options.length === 0) options = weigh(energy);
    if (options.length === 0) return null;
    let roll = nextRandom(rng) * options.reduce((n, o) => n + o.w, 0);
    for (const o of options) { roll -= o.w; if (roll < 0) return o.c; }
    return (options[options.length - 1] as { c: CardKey }).c;
  };

  /** Can the child pay for `want` cards now? (the cheapest card's price times `want`; a belt: that many cards on it) */
  const canStart = (match: Match, onBelt: boolean): boolean => {
    const s = match.state;
    if (onBelt) return s.belt.length >= Math.min(want, s.config.belt?.slots ?? want);
    const cheapest = Math.min(...s.config.cards.zombies.map((c) => UNIT_INFO[c].price));
    return s.players[side].energy >= want * cheapest;
  };

  return {
    faction: side,
    think(match) {
      const s = match.state;
      if (s.winner !== null) return [];
      const out: Command[] = [];
      const now = s.tick;
      // The favourite: look every 20-40 s, move after the reaction time.
      if (pending !== null && now >= pending.at) { favourite = pending.lane; pending = null; }
      if (pending === null && now >= switchAt) {
        pending = { lane: openLane(readLawn(s), favourite, rng), at: now + between(rng, CHILD.reaction) };
        switchAt = now + between(rng, CHILD.switchEvery);
      }
      // The glowing buttons, 1-3 s after they light, into the favourite lane.
      const player = s.players[side];
      const lit = (key: SpellKey | 'hero', on: boolean): boolean => {
        if (!on) { delete readyAt[key]; return false; }
        const r = (readyAt[key] ??= { since: now, wait: between(rng, CHILD.power) });
        return now - r.since >= r.wait;
      };
      let power: SpellKey | 'hero' | null = null;
      if (lit('hero', hero && s.config.heroes[side] && player.heroTimer === 0)) power = 'hero';
      for (const slot of player.spells) if (lit(slot.key, slot.timer === 0) && power === null) power = slot.key;
      if (power !== null) {
        for (let tries = 0; tries < 6; tries++) {
          const cmd: Command = power === 'hero' ? { type: 'hero', faction: side, lane: favourite }
            : { type: 'spell', faction: side, spell: power, lane: favourite, col: randomInt(rng, COLS) };
          if (match.check(cmd) === null) { out.push(cmd); delete readyAt[power]; break; }
        }
      }
      // The cards: a burst of 2-3, then an idle gap.
      const onBelt = s.config.belt !== null && s.config.belt.side === side;
      if (left === 0 && now >= nextBurst && canStart(match, onBelt)) { left = want; burstStart = now; burstCards = 0; nextSend = now; giveUp = now + CHILD.patience; }
      if (left > 0 && now >= nextSend) {
        const l = lane();
        let cmd: Command | null = null;
        if (onBelt) {
          const slot = randomInt(rng, s.belt.length);
          const c: Command = { type: 'belt', faction: 'zombies', slot, lane: l, col: COLS - 1 };
          if (match.check(c) === null) cmd = c;
        } else {
          const card = pickCard(match, l);
          if (card !== null) { cmd = sendCommand(card, l); lastCard = card; }
        }
        if (cmd !== null) { out.push(cmd); left -= 1; burstCards += 1; nextSend = now + CHILD.burstSpacing; } else if (now >= giveUp) left = 0; // cards still recharging: he waits a moment, then gives up
        if (left === 0) {
          // The pace: the burst and its gap take burstCards x 60 / pace seconds, give or take; never shorter than the burst.
          const cycle = pace === null ? 0 : Math.round((Math.max(burstCards, 1) * 1800 / pace) * (1 + CHILD.paceJitter * (2 * nextRandom(rng) - 1)));
          nextBurst = pace === null ? now + between(rng, CHILD.gap) : Math.max(now + CHILD.gap.min / 2, burstStart + cycle);
          want = drawWant();
        }
      }
      return out;
    },
  };
}

/**
 * A stronger expert, for probes (worlds plan Task 8 review): `table` changes his skill table (e.g.
 * a faster look or a wider defence margin); `stack` (zombies) plays a battle as he plays a
 * Breakthrough, every zombie down the lane that gives.
 */
export interface StrongExpert { readonly table?: Partial<SkillTable>; readonly stack?: boolean }

/**
 * A stand-in of `kind` for `side` in one match (see the note at the top). `hero` false: a level
 * where the child has no hero button yet (`heroHidden`); the stand-in never fires the hero.
 * `strong` (the expert only, probes): see `StrongExpert`. `pace` (the child only): cards a minute, or
 * null for the fast first child (`CHILD.gap`).
 */
export function createLevelStandIn(
  kind: LevelStandIn, side: Faction, seed: number, opts: { hero?: boolean; strong?: StrongExpert; pace?: number | null } = {},
): Bot {
  const hero = opts.hero ?? true;
  if (kind === 'beginner') return createBeginner(side, seed, hero);
  if (kind === 'child') return createChild(side, seed, hero, opts.pace === undefined ? DEFAULT_PACE : opts.pace);
  return createSensible(kind, side, seed, hero, kind === 'expert' ? opts.strong ?? null : null);
}
