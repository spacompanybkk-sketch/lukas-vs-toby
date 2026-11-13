/**
 * How the computer players aim their hero power and their dealt spells. Each reads the lawn once,
 * scores every place a power could go, and fires a power only where it pays (its score clears the
 * power's line); otherwise it keeps it for later. Shared by both sides and every skill: the skills
 * differ in how often they look (`thinkEvery`) and how often they play at random, not in aim.
 *
 * - Hero (Mega Mower, Bone Storm): the lane where the damage it would deal, plus the price of what
 *   it would kill, is largest. A zombie near the plant base counts double for the Mower.
 * - Thunderbolt / Meteor: the 2×2 with the most damage dealt (each unit counts up to the spell's
 *   damage), held until that clears its own line.
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
import { biteDps, shotDps } from './laneModel';

/** What a power must be worth before it is fired, as a multiple of its own damage where it has one. */
export const POWER_LINES = {
  /** Hero: damage dealt plus prices killed, × its damage. */
  hero: 1.5,
  /** Thunderbolt: damage dealt, × its damage (held for a crowd: rarer and bigger). */
  thunderbolt: 3,
  /** Meteor: damage dealt, × its damage. */
  meteor: 4,
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
export function powerMove(match: Match, faction: Faction): Command | null {
  const s = match.state;
  const player = s.players[faction];
  const heroReady = s.config.heroes[faction] && player.heroTimer === 0;
  const spellReady = player.spells.some((slot) => slot.timer === 0);
  if (!heroReady && !spellReady) return null; // the usual case: nothing to aim, nothing read
  const b = match.balance;
  const grid = readGrid(s);
  if (heroReady) {
    const pick = heroPick(b, grid, faction);
    if (pick !== null && match.check(pick.cmd) === null) return pick.cmd;
  }
  for (const slot of player.spells) {
    if (slot.timer !== 0) continue;
    const pick = spellPick(b, grid, faction, slot.key);
    if (pick !== null && match.check(pick.cmd) === null) return pick.cmd;
  }
  return null;
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

function spellPick(b: Balance, grid: Grid, faction: Faction, spell: SpellKey): Pick | null {
  const stats = b.spells[spell];
  const enemy = enemyOf(faction);
  switch (spell) {
    case 'sunShower':
    case 'brainFeast':
      return { cmd: { type: 'spell', faction, spell, lane: 0, col: 0 }, score: 1 };
    case 'thunderbolt':
    case 'meteor': {
      const damage = stats.damage ?? 0;
      return bestArea(grid, faction, spell, stats.size, enemy, POWER_LINES[spell] * damage, (u) => Math.min(u.hp, damage));
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
