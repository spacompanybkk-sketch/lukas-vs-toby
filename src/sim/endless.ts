/**
 * Free Play (`MatchConfig.endless`): an endless, escalating source of the other side's units.
 *
 * - Survive (the player is the plants): zombie waves on a timer, each bought with a growing budget
 *   (`endlessWave`); waves overlap if the player falls behind. No clock; the match ends when the
 *   plant base falls (the zombie base cannot be hurt). The score is `SimState.wave`, the waves started.
 * - Breakthrough (the player is the zombies): a garden of plants, generated the same way, laid on the
 *   first step. When the plant base falls the garden is broken: the score (`SimState.wave`) goes up,
 *   the plants left leave, the clock gains time, the base comes back stronger with a new, stronger
 *   garden. The match ends when the clock (`SimState.clock`) reaches 0, the plants winning.
 *
 * The side the waves are of has no hand, no hero, no spells and no energy. Every draw is from the
 * state rng, in a fixed order (see `endlessWave`).
 */

import { seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { UNIT_INFO, isCard } from '../data/units';
import { randomInt } from './rng';
import { spawnAtLevel } from './spawn';
import { LANES, MAX_LEVEL, PLANT_COLS, ZOMBIE_SPAWN_X } from './types';
import type { CardKey, Faction, LevelMode, MatchConfig, SimEvent, SimState } from './types';

/** One unit of a wave or garden, as `endlessWave` makes it. */
export interface EndlessSpawn {
  unit: CardKey;
  lane: number;
  x: number; // a zombie: `ZOMBIE_SPAWN_X`; a plant: its tile's middle (col + 0.5)
  level: number;
  delay: number; // ticks after the wave starts that it walks on (0 for a plant)
  big: boolean; // the big one of every `bossEvery`-th wave
}

/** The side the waves are of: the zombies in survive, the plants (gardens) in breakthrough. */
export function waveSide(mode: LevelMode): Faction {
  return mode === 'breakthrough' ? 'plants' : 'zombies';
}

/** Whether `faction` has no energy at all: the level's `noEnergy`, or the waves' side in Free Play. */
export function energyOff(c: MatchConfig, faction: Faction): boolean {
  return c.noEnergy || (c.endless !== null && c.endless !== undefined && faction === waveSide(c.mode));
}

/** What wave (or garden) `wave` (1-based) may spend: `budgetBase + budgetStep × wave`. */
export function endlessBudget(b: Balance, wave: number): number {
  return b.endless.budgetBase + b.endless.budgetStep * wave;
}

/** The level of wave `wave`'s units: `1 + floor((wave − 1) / levelEvery)`, at most `MAX_LEVEL`. */
export function endlessLevel(b: Balance, wave: number): number {
  return Math.min(MAX_LEVEL, 1 + Math.floor((wave - 1) / b.endless.levelEvery));
}

/** The cards a wave of `side` may use: all of `cards`, but never a Sunflower in a garden (no energy for the defender). */
function usableCards(cards: readonly CardKey[], side: Faction): CardKey[] {
  return cards.filter((c) => !(side === 'plants' && c === 'sunflower'));
}

/**
 * Wave (or garden) `wave` of `side` from `cards`, drawing from `rng` in this order:
 * 1. the units: while any card costs (price × the wave's level) no more than what is left of the
 *    budget, one of those affordable (in `cards` order) is drawn with `randomInt` and paid for; if
 *    none was affordable from the start, the wave is one unit of the cheapest card (first in list
 *    order), so a wave is never empty;
 * 2. every `bossEvery`-th wave, the big one is put first: a level-5 unit of the priciest card (first
 *    in list order), not paid from the budget;
 * 3. where they go, in list order. Zombies: a lane each (`randomInt(LANES)`), walking on at
 *    `ZOMBIE_SPAWN_X`, unit i of n after `floor(i × spread / (n − 1))` ticks (the first at once, the
 *    last at `spreadSeconds`). Plants: a free tile each, drawn from the tiles of columns
 *    `gardenMinCol`..`gardenMaxCol` in lane-then-column order; if the tiles run out the rest stay away.
 * A garden never has a Sunflower. A card not of `side` is a `RangeError`.
 */
export function endlessWave(
  b: Balance, cards: readonly CardKey[], side: Faction, wave: number, rng: { rng: number },
): EndlessSpawn[] {
  for (const c of cards) {
    if (!isCard(c) || UNIT_INFO[c].faction !== side) throw new RangeError(`"${String(c)}" is no ${side} card`);
  }
  const usable = usableCards(cards, side);
  if (usable.length === 0) throw new RangeError(`no ${side} card a wave can use in ${cards.join(', ')}`);
  const level = endlessLevel(b, wave);
  const cost = (c: CardKey): number => UNIT_INFO[c].price * level;
  const picks: Array<{ unit: CardKey; level: number; big: boolean }> = [];
  let left = endlessBudget(b, wave);
  for (;;) {
    const affordable = usable.filter((c) => cost(c) <= left);
    if (affordable.length === 0) break;
    const unit = affordable[randomInt(rng, affordable.length)]!;
    left -= cost(unit);
    picks.push({ unit, level, big: false });
  }
  if (picks.length === 0) {
    const cheapest = usable.reduce((a, c) => (UNIT_INFO[c].price < UNIT_INFO[a].price ? c : a));
    picks.push({ unit: cheapest, level, big: false });
  }
  if (wave % b.endless.bossEvery === 0) {
    const priciest = usable.reduce((a, c) => (UNIT_INFO[c].price > UNIT_INFO[a].price ? c : a));
    picks.unshift({ unit: priciest, level: MAX_LEVEL, big: true });
  }
  if (side === 'zombies') {
    const spread = seconds(b.endless.spreadSeconds);
    const n = picks.length;
    return picks.map((p, i) => ({
      ...p, lane: randomInt(rng, LANES), x: ZOMBIE_SPAWN_X, delay: n > 1 ? Math.floor((i * spread) / (n - 1)) : 0,
    }));
  }
  const free: number[] = []; // lane * PLANT_COLS + col
  for (let lane = 0; lane < LANES; lane++) {
    for (let col = b.endless.gardenMinCol; col <= b.endless.gardenMaxCol; col++) free.push(lane * PLANT_COLS + col);
  }
  const out: EndlessSpawn[] = [];
  for (const p of picks) {
    if (free.length === 0) break;
    const tile = free.splice(randomInt(rng, free.length), 1)[0]!;
    out.push({ ...p, lane: Math.floor(tile / PLANT_COLS), x: (tile % PLANT_COLS) + 0.5, delay: 0 });
  }
  return out;
}

/**
 * Refuses a Free Play setup that makes no sense (a `RangeError` naming what is wrong). With
 * `endless` set: mode survive or breakthrough; `cards` not empty, each a card of the waves' side,
 * none twice, and in breakthrough at least one that is not a Sunflower; `firstWaveTicks` a whole
 * number from 0, and 0 in breakthrough; in breakthrough no `goalTicks` (the clock is the state's);
 * in survive the zombie base cannot be hurt; the waves' side has no hand, no spells and no hero;
 * no script, nothing prepared, and energy on. Also checks `Balance.endless` is sound.
 */
export function checkEndless(c: MatchConfig, b: Balance): void {
  const e = c.endless;
  if (e === null || e === undefined) return;
  if (c.mode !== 'survive' && c.mode !== 'breakthrough') {
    throw new RangeError(`endless is for survive and breakthrough, not ${c.mode}`);
  }
  const side = waveSide(c.mode);
  if (!Array.isArray(e.cards) || e.cards.length === 0) throw new RangeError('endless cards: none to make waves from');
  const seen = new Set<CardKey>();
  for (const card of e.cards) {
    if (!isCard(card) || UNIT_INFO[card].faction !== side || b.units[card] === undefined) {
      throw new RangeError(`endless cards: "${String(card)}" is no ${side} card with numbers`);
    }
    if (seen.has(card)) throw new RangeError(`endless cards: ${card} is listed twice`);
    seen.add(card);
  }
  if (usableCards(e.cards, side).length === 0) throw new RangeError('endless cards: a garden of Sunflowers only does nothing');
  if (!(Number.isInteger(e.firstWaveTicks) && e.firstWaveTicks >= 0)) {
    throw new RangeError(`endless firstWaveTicks ${String(e.firstWaveTicks)} is not a whole number from 0`);
  }
  if (c.mode === 'breakthrough') {
    if (e.firstWaveTicks !== 0) throw new RangeError('endless firstWaveTicks must be 0 in breakthrough: the first garden is there from the start');
    if (c.goalTicks !== null) throw new RangeError('an endless breakthrough has no goalTicks: its clock is SimState.clock');
  } else if (c.invulnerableBase !== 'zombies') {
    throw new RangeError('an endless survive needs invulnerableBase "zombies"');
  }
  if (c.cards[side].length > 0) throw new RangeError(`endless: the waves' side (${side}) plays no hand, but has cards`);
  if (c.spells[side] !== 0) throw new RangeError(`endless: the waves' side (${side}) has no spells`);
  if (c.heroes[side]) throw new RangeError(`endless: the waves' side (${side}) has no hero`);
  if (c.script.length > 0) throw new RangeError('endless: no script (the waves are endless)');
  if (c.prepared.length > 0) throw new RangeError('endless: nothing prepared (the gardens are endless)');
  if (c.noEnergy) throw new RangeError('endless: noEnergy is not allowed (the player earns as usual)');
  const n = b.endless;
  const whole = [n.budgetBase, n.budgetStep, n.levelEvery, n.bossEvery, n.gardenMinCol, n.gardenMaxCol];
  if (!whole.every((v) => Number.isInteger(v) && v >= 0) || n.levelEvery < 1 || n.bossEvery < 1
    || !(seconds(n.gapSeconds) > 0) || !(seconds(n.clockSeconds) > 0) || !(n.spreadSeconds >= 0)
    || !(n.clockBonusSeconds >= 0) || !(n.gardenHpStep >= 0)
    || n.gardenMinCol > n.gardenMaxCol || n.gardenMaxCol >= PLANT_COLS) {
    throw new RangeError('Balance.endless has a number out of range');
  }
}

/** The state's Free Play fields at the start of a match. */
export function endlessStart(c: MatchConfig, b: Balance): Pick<SimState, 'wave' | 'waveTimer' | 'clock' | 'incoming'> {
  const e = c.endless;
  if (e === null || e === undefined) return { wave: 0, waveTimer: 0, clock: 0, incoming: [] };
  return {
    wave: 0,
    waveTimer: c.mode === 'survive' ? e.firstWaveTicks : 0,
    clock: c.mode === 'breakthrough' ? seconds(b.endless.clockSeconds) : 0,
    incoming: [],
  };
}

/**
 * Step stage 0b, after `tickScript`, before the commands. Survive: when `waveTimer` is 0 the next
 * wave starts (`wave` + 1, `waveStarted`, its units queued in `incoming` at their ticks, the timer
 * set to `gapSeconds`); then every queued unit whose tick has come walks on, in queue order
 * (`waveSpawned` with its place in the wave, then its `unitSpawned`); then the timer counts down
 * one. Breakthrough: on the step of tick 0 garden 1 is laid (`layGarden`).
 */
export function tickEndless(s: SimState, b: Balance, events: SimEvent[]): void {
  const e = s.config.endless;
  if (e === null || e === undefined) return;
  if (s.config.mode === 'breakthrough') {
    if (s.tick === 0) layGarden(s, b, 1, events);
    return;
  }
  if (s.waveTimer === 0) {
    s.wave += 1;
    const spawns = endlessWave(b, e.cards, 'zombies', s.wave, s);
    events.push({ type: 'waveStarted', wave: s.wave, budget: endlessBudget(b, s.wave), units: spawns.length });
    spawns.forEach((u, index) => {
      s.incoming.push({ tick: s.tick + u.delay, unit: u.unit, lane: u.lane, x: u.x, level: u.level, index });
    });
    s.waveTimer = seconds(b.endless.gapSeconds);
  }
  if (s.incoming.length > 0) {
    const later = [];
    for (const u of s.incoming) {
      if (u.tick > s.tick) {
        later.push(u);
        continue;
      }
      events.push({ type: 'waveSpawned', index: u.index, unit: u.unit, lane: u.lane });
      spawnAtLevel(s, b, u.unit, u.lane, u.x, u.level, events);
    }
    s.incoming = later;
  }
  s.waveTimer -= 1;
}

/** Garden `garden`: `waveStarted`, then each plant (`waveSpawned`, `unitSpawned`) on its tile. */
function layGarden(s: SimState, b: Balance, garden: number, events: SimEvent[]): void {
  const spawns = endlessWave(b, s.config.endless!.cards, 'plants', garden, s);
  events.push({ type: 'waveStarted', wave: garden, budget: endlessBudget(b, garden), units: spawns.length });
  spawns.forEach((u, index) => {
    events.push({ type: 'waveSpawned', index, unit: u.unit, lane: u.lane });
    spawnAtLevel(s, b, u.unit, u.lane, u.x, u.level, events);
  });
}

/**
 * Endgame, breakthrough Free Play only, before the winner is decided. If the plant base has fallen
 * (at or below 0, or not a number) the garden is broken: `wave` + 1 and `gardenBroken`; every plant
 * left leaves the lawn (`unitDied`, cause `'spent'`, in id order, no bounty); the clock gains
 * `clockBonusSeconds`; the plant base and its max become garden g's health (g = `wave` + 1:
 * `baseHp × (1 + gardenHpStep × (g − 1))`, rounded); garden g is laid. So a fallen plant base never
 * ends this match. Then the clock counts down one (call `endlessClockOut` after the winner check).
 */
export function tickEndlessGarden(s: SimState, b: Balance, events: SimEvent[]): void {
  const e = s.config.endless;
  if (e === null || e === undefined || s.config.mode !== 'breakthrough') return;
  if (!(s.baseHp.plants > 0)) {
    s.wave += 1;
    events.push({ type: 'gardenBroken', wave: s.wave });
    const kept = [];
    for (const u of s.units) {
      if (u.faction !== 'plants') {
        kept.push(u);
        continue;
      }
      events.push({ type: 'unitDied', unitId: u.id, key: u.key, faction: u.faction, lane: u.lane, x: u.x, level: u.level, cause: 'spent' });
    }
    s.units = kept;
    s.clock += seconds(b.endless.clockBonusSeconds);
    const garden = s.wave + 1;
    const hp = Math.round(s.config.baseHp.plants * (1 + b.endless.gardenHpStep * (garden - 1)));
    s.baseHp.plants = hp;
    s.baseMaxHp.plants = hp;
    layGarden(s, b, garden, events);
  }
  s.clock -= 1;
}

/**
 * Endgame, breakthrough Free Play only, once no base has fallen: the clock at 0 ends the match, the
 * plants winning (`goalReached`, `matchEnded`). With 90 s on it and no garden broken, the step run
 * at tick 2699 ends it, as a 2700-tick `goalTicks` would.
 */
export function endlessClockOut(s: SimState, events: SimEvent[]): void {
  if (s.config.endless === null || s.config.endless === undefined || s.config.mode !== 'breakthrough') return;
  if (s.clock > 0) return;
  s.winner = 'plants';
  events.push({ type: 'goalReached', winner: 'plants' }, { type: 'matchEnded', winner: 'plants' });
}
