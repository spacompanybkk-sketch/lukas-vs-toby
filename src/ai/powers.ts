/**
 * How the computer players aim their hero power and their dealt spells. Each reads the lawn once,
 * scores every place a power could go, and fires a power only where it pays (its score clears the
 * power's line); otherwise it keeps it for later. Shared by both sides and every skill: the skills
 * differ in how often they look (`thinkEvery`) and how often they play at random, not in aim.
 *
 * - Hero (Mega Mower, Bone Storm): the lane where the damage it would deal, plus the price of what
 *   it would kill, is largest. A zombie near the plant base counts double for the Mower.
 * - Thunderbolt / Meteor: the 2×2 with the most damage dealt (each unit counts up to the spell's
 *   damage), once an area holds two enemies; after waiting `BLAST_PATIENCE` seconds, any area with
 *   an enemy (a child should see it used).
 * - Vines: the 2×2 holding the most zombie health that is walking into plants.
 * - Fog: the 2×2 whose plants would fire the most at zombies in its blind seconds.
 * - Frenzy: the 3×3 whose zombies are biting plants hardest, or about to.
 * - Healing Rain: the 3×3 with the most plant health to give back.
 * - Rock Wall: in front of the lane with the most zombie health closing in.
 * - Grave Rise: its minions just right of the front plant of the lane its zombies push hardest.
 * - Sun Shower / Brain Feast: as soon as they are ready.
 */

import type { Balance } from '../data/balance';
import { priceOf } from '../data/units';
import type { Match } from '../sim/match';
import { isStanding } from '../sim/lookup';
import { spellArea } from '../sim/spells';
import { COLS, LANES, PLANT_COLS } from '../sim/types';
import type { Command, Faction, SimState, SpellKey, SpellSize, Unit } from '../sim/types';
import { seconds } from '../data/balance';
import { nextRandom, randomInt } from '../sim/rng';
import { TICKS_PER_SECOND } from '../sim/types';
import { biteDps, shotDps } from './laneModel';
import type { BotRng } from './lawn';

/** What a power must be worth before it is fired, as a multiple of its own damage where it has one. */
export const POWER_LINES = {
  /** Hero: damage dealt plus prices killed, × its damage. */
  hero: 1.5,
  /** Vines: zombie health held. */
  vines: 700,
  /** Fog: plant damage prevented. */
  fog: 150,
  /** Frenzy: extra bite damage gained. */
  frenzy: 150,
  /** Healing Rain: health given back, × its amount. */
  heal: 1.5,
  /** Rock Wall: zombie health closing in on the lane. */
  rock: 500,
} as const;

/** Seconds a ready Thunderbolt or Meteor waits for two enemies in an area before one will do. */
export const BLAST_PATIENCE = 20;

/**
 * How a computer player paces its powers (from its skill table): none before `firstSeconds` into
 * the match, at least `gapSeconds` between two, and `aimMiss` of them aimed at a random legal spot
 * instead of the best one. Easy is slow and clumsy with them, Hard is neither.
 */
export interface PowerPacing { readonly firstSeconds: number; readonly gapSeconds: number; readonly aimMiss: number }

/** No pacing: every power as soon as it pays, aimed well. */
export const UNPACED: PowerPacing = { firstSeconds: 0, gapSeconds: 0, aimMiss: 0 };

/** What a player remembers about its powers between thinks. */
export interface PowerMemory {
  /** The tick it last used a power, or null. */
  lastTick: number | null;
  /** The first tick each ready power was seen ready (`'hero'` or a spell key), cleared once used. */
  readySince: Partial<Record<SpellKey | 'hero', number>>;
}

export function newPowerMemory(): PowerMemory {
  return { lastTick: null, readySince: {} };
}

/** A zombie this close to the plant base (x) counts double for the Mega Mower: it is at the gate. */
const GATE_X = 3;
/** Vines only count zombies already on the lawn proper (left of the graveyard's middle). */
const ON_LAWN_X = 8.5;
/** Fog only counts plants with a zombie this close ahead: they would be shooting during the fog. */
const FOG_REACH = 7;
/** Frenzy counts zombies this close to the front plant of their lane: they are about to bite. */
const ABOUT_TO_BITE = 2.5;

/** The lawn as the powers see it: each standing unit, by side, on its tile. */
interface Grid {
  readonly units: readonly Unit[];
  readonly at: ReadonlyArray<ReadonlyArray<Unit[]>>; // [lane][col]
}

function readGrid(s: SimState): Grid {
  const at = Array.from({ length: LANES }, () => Array.from({ length: COLS }, (): Unit[] => []));
  const units: Unit[] = [];
  for (const u of s.units) {
    if (!isStanding(u)) continue;
    const col = Math.min(COLS - 1, Math.max(0, Math.floor(u.x)));
    at[u.lane]?.[col]?.push(u);
    units.push(u);
  }
  return { units, at };
}

/** The best command among one power's candidates, or null when none clears its line. */
interface Pick { cmd: Command; score: number }

function better(a: Pick | null, b: Pick | null): Pick | null {
  if (b === null) return a;
  if (a === null || b.score > a.score) return b;
  return a;
}

/**
 * The hero power or a dealt spell worth firing right now, or null. The hero comes first, then the
 * spells in deal order. Whatever it returns, `match.check` accepts.
 */
export function powerMove(
  match: Match, faction: Faction, pacing: PowerPacing = UNPACED, memory?: PowerMemory, rng?: BotRng,
): Command | null {
  const s = match.state;
  const player = s.players[faction];
  const heroReady = s.config.heroes[faction] && player.heroTimer === 0;
  if (memory !== undefined) {
    const seen = (key: SpellKey | 'hero', ready: boolean): void => {
      if (!ready) delete memory.readySince[key];
      else memory.readySince[key] ??= s.tick;
    };
    seen('hero', heroReady);
    for (const slot of player.spells) seen(slot.key, slot.timer === 0);
  }
  const spellReady = player.spells.some((slot) => slot.timer === 0);
  if (!heroReady && !spellReady) return null; // the usual case: nothing to aim, nothing read
  if (s.tick < seconds(pacing.firstSeconds)) return null;
  if (memory?.lastTick != null && s.tick - memory.lastTick < seconds(pacing.gapSeconds)) return null;
  const b = match.balance;
  const grid = readGrid(s);
  const waited = (key: SpellKey | 'hero'): number => {
    const since = memory?.readySince[key];
    return since === undefined ? 0 : (s.tick - since) / TICKS_PER_SECOND;
  };
  const use = (cmd: Command): Command => {
    const aimed = rng !== undefined && pacing.aimMiss > 0 && nextRandom(rng) < pacing.aimMiss ? misaim(match, cmd, rng) : cmd;
    if (memory !== undefined) memory.lastTick = s.tick;
    return aimed;
  };
  if (heroReady) {
    const pick = heroPick(b, grid, faction);
    if (pick !== null && match.check(pick.cmd) === null) return use(pick.cmd);
  }
  for (const slot of player.spells) {
    if (slot.timer !== 0) continue;
    const pick = spellPick(b, grid, faction, slot.key, waited(slot.key));
    if (pick !== null && match.check(pick.cmd) === null) return use(pick.cmd);
  }
  return null;
}

/** The same power aimed at a random spot it may legally go (a clumsy aim); the aimed one if none. */
function misaim(match: Match, cmd: Command, rng: BotRng): Command {
  if (cmd.type !== 'hero' && cmd.type !== 'spell') return cmd;
  for (let tries = 0; tries < 8; tries++) {
    const lane = randomInt(rng, LANES);
    const other: Command = cmd.type === 'hero' ? { ...cmd, lane } : { ...cmd, lane, col: randomInt(rng, COLS) };
    if (match.check(other) === null) return other;
  }
  return cmd;
}

/** The hero power alone, where `powerMove` would fire it, or null: for players that cast no spells. */
export function heroMove(match: Match, faction: Faction): Command | null {
  const s = match.state;
  if (!s.config.heroes[faction] || s.players[faction].heroTimer !== 0) return null;
  const pick = heroPick(match.balance, readGrid(s), faction);
  return pick !== null && match.check(pick.cmd) === null ? pick.cmd : null;
}

function enemyOf(faction: Faction): Faction {
  return faction === 'plants' ? 'zombies' : 'plants';
}

function heroPick(b: Balance, grid: Grid, faction: Faction): Pick | null {
  const damage = b.hero[faction].damage;
  const scores = new Array<number>(LANES).fill(0);
  for (const u of grid.units) {
    if (u.faction === faction) continue;
    let v = Math.min(u.hp, damage) + (u.hp <= damage ? priceOf(u.key) : 0);
    if (faction === 'plants' && u.x < GATE_X) v *= 2; // a zombie at the gate
    scores[u.lane] = (scores[u.lane] ?? 0) + v;
  }
  let best: Pick | null = null;
  scores.forEach((score, lane) => {
    if (score >= POWER_LINES.hero * damage) best = better(best, { cmd: { type: 'hero', faction, lane }, score });
  });
  return best;
}

/** Sums `value` over the units of `side` in the spell's area at every aim point, keeping the best. */
function bestArea(
  grid: Grid, faction: Faction, spell: SpellKey, size: SpellSize, side: Faction, line: number,
  value: (u: Unit) => number, minCol = 0, maxCol = COLS - 1,
): Pick | null {
  let best: Pick | null = null;
  for (let lane = 0; lane < LANES; lane++) {
    for (let col = minCol; col <= maxCol; col++) {
      let score = 0;
      for (const t of spellArea(faction, size, lane, col)) {
        for (const u of grid.at[t.lane]?.[t.col] ?? []) if (u.faction === side) score += value(u);
      }
      if (score >= line && (best === null || score > best.score)) {
        best = { cmd: { type: 'spell', faction, spell, lane, col }, score };
      }
    }
  }
  return best;
}

/** The plant nearest the zombies in `lane` (largest x), or undefined. */
function frontPlant(grid: Grid, lane: number): Unit | undefined {
  let front: Unit | undefined;
  for (const u of grid.units) {
    if (u.faction === 'plants' && u.lane === lane && (front === undefined || u.x > front.x)) front = u;
  }
  return front;
}

/** The zombie nearest the plant base in `lane`, or undefined. */
function frontZombie(grid: Grid, lane: number): Unit | undefined {
  let front: Unit | undefined;
  for (const u of grid.units) {
    if (u.faction === 'zombies' && u.lane === lane && (front === undefined || u.x < front.x)) front = u;
  }
  return front;
}

function spellPick(b: Balance, grid: Grid, faction: Faction, spell: SpellKey, waited = 0): Pick | null {
  const stats = b.spells[spell];
  const enemy = enemyOf(faction);
  switch (spell) {
    case 'sunShower':
    case 'brainFeast':
      return { cmd: { type: 'spell', faction, spell, lane: 0, col: 0 }, score: 1 };
    case 'thunderbolt':
    case 'meteor': {
      // Fired on two enemies in an area, or once it has waited, on one: the area with the most
      // damage dealt among those (a child sees it used, and it clears what it hits).
      const damage = stats.damage ?? 0;
      const enough = waited >= BLAST_PATIENCE ? 1 : 2;
      if (bestArea(grid, faction, spell, stats.size, enemy, enough, () => 1) === null) return null;
      return bestArea(grid, faction, spell, stats.size, enemy, 0, (u) => Math.min(u.hp, damage));
    }
    case 'vines': {
      // Zombies with a plant somewhere ahead of them in their lane.
      const fronts = Array.from({ length: LANES }, (_, lane) => frontPlant(grid, lane)?.x ?? -1);
      return bestArea(grid, faction, spell, stats.size, 'zombies', POWER_LINES.vines,
        (z) => (fronts[z.lane] ?? -1) >= 0 && z.x < ON_LAWN_X ? z.hp : 0);
    }
    case 'fog': {
      // Plants with a zombie in their lane they could be shooting at for the whole fog.
      const near = Array.from({ length: LANES }, (_, lane) => frontZombie(grid, lane)?.x ?? Infinity);
      const secs = stats.seconds ?? 0;
      return bestArea(grid, faction, spell, stats.size, 'plants', POWER_LINES.fog,
        (p) => ((near[p.lane] ?? Infinity) - p.x < FOG_REACH ? shotDps(b, p) * secs : 0));
    }
    case 'frenzy': {
      const secs = stats.seconds ?? 0;
      const extra = (stats.factor ?? 1) - 1;
      // Zombies biting, or about to (within ABOUT_TO_BITE of the lane's front plant): faster feet and teeth.
      const fronts = Array.from({ length: LANES }, (_, lane) => frontPlant(grid, lane)?.x ?? -Infinity);
      return bestArea(grid, faction, spell, stats.size, 'zombies', POWER_LINES.frenzy,
        (z) => (z.blocked || z.x - (fronts[z.lane] ?? -Infinity) < ABOUT_TO_BITE ? biteDps(b, z) * secs * extra : 0));
    }
    case 'healingRain': {
      const amount = stats.amount ?? 0;
      return bestArea(grid, faction, spell, stats.size, 'plants', POWER_LINES.heal * amount,
        (p) => (p.key === 'rock' ? 0 : Math.min(amount, p.maxHp - p.hp)));
    }
    case 'rockWall':
      return rockPick(grid, faction);
    case 'graveRise':
      return gravePick(grid, faction, stats.minCol ?? 0);
    default: {
      const unhandled: never = spell;
      throw new Error(`No aim for spell ${String(unhandled)}`);
    }
  }
}

/** A rock on the free tile just in front of the lane with the most zombie health closing in. */
function rockPick(grid: Grid, faction: Faction): Pick | null {
  let best: Pick | null = null;
  for (let lane = 0; lane < LANES; lane++) {
    const front = frontZombie(grid, lane);
    if (front === undefined || front.x > PLANT_COLS + 0.5) continue;
    let hp = 0;
    for (const u of grid.units) if (u.faction === 'zombies' && u.lane === lane && u.x < front.x + 2) hp += u.hp;
    if (hp < POWER_LINES.rock) continue;
    // The rearmost tile still in front of the zombie that no plant stands on, nearest the zombie first.
    for (let col = Math.min(PLANT_COLS - 1, Math.floor(front.x - 0.6)); col >= 0; col--) {
      if ((grid.at[lane]?.[col] ?? []).some((u) => u.faction === 'plants')) continue;
      best = better(best, { cmd: { type: 'spell', faction, spell: 'rockWall', lane, col }, score: hp });
      break;
    }
  }
  return best;
}

/**
 * Its minions (Grave Rise's `count`) in the lane where its zombies push hardest (most zombie health), or failing that
 * the lane with the fewest plants, just right of that lane's front plant (never left of `minCol`).
 */
function gravePick(grid: Grid, faction: Faction, minCol: number): Pick {
  const push = new Array<number>(LANES).fill(0);
  const plants = new Array<number>(LANES).fill(0);
  for (const u of grid.units) {
    if (u.faction === 'zombies') push[u.lane] = (push[u.lane] ?? 0) + u.hp;
    else plants[u.lane] = (plants[u.lane] ?? 0) + 1;
  }
  let lane = 0;
  for (let l = 1; l < LANES; l++) {
    const a = push[l] ?? 0;
    const b = push[lane] ?? 0;
    if (a > b || (a === b && (plants[l] ?? 0) < (plants[lane] ?? 0))) lane = l;
  }
  const front = frontPlant(grid, lane);
  const col = Math.min(COLS - 1, Math.max(minCol, front === undefined ? minCol : Math.floor(front.x) + 1));
  return { cmd: { type: 'spell', faction, spell: 'graveRise', lane, col }, score: 1 };
}

/**
 * A small child's press of a glowing button: the first ready power (the hero, then the spells in
 * deal order), aimed at a random spot, half the time on the half of the lawn where most units are
 * (where something is happening) and otherwise anywhere. Null when nothing is ready or no spot is
 * legal after a few tries.
 */
export function childPower(match: Match, faction: Faction, rng: BotRng): Command | null {
  const s = match.state;
  const player = s.players[faction];
  const ready: Array<SpellKey | 'hero'> = [];
  if (s.config.heroes[faction] && player.heroTimer === 0) ready.push('hero');
  for (const slot of player.spells) if (slot.timer === 0) ready.push(slot.key);
  const power = ready[0];
  if (power === undefined) return null;
  let left = 0;
  let right = 0;
  for (const u of s.units) if (isStanding(u)) { if (u.x < COLS / 2) left += 1; else right += 1; }
  for (let tries = 0; tries < 8; tries++) {
    const busy = nextRandom(rng) < 0.5;
    const lane = randomInt(rng, LANES);
    const half = right > left ? COLS / 2 : 0;
    const col = busy ? half + randomInt(rng, COLS / 2) : randomInt(rng, COLS);
    const cmd: Command = power === 'hero' ? { type: 'hero', faction, lane } : { type: 'spell', faction, spell: power, lane, col };
    if (match.check(cmd) === null) return cmd;
  }
  return null;
}
