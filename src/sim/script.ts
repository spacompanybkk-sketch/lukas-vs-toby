/**
 * Level modes, part 1: what a level sets up (`checkLevel`), the units it has on the lawn from the
 * start (`MatchConfig.prepared`) and the units its script brings on (`MatchConfig.script`).
 * The belt is in `belt.ts`, the clock goal in `endgame.ts`.
 */

import type { Balance } from '../data/balance';
import { factionOf, isCard, priceOf } from '../data/units';
import { checkBeltConfig, plantAt } from './belt';
import { levelScale, statsFor, upgradeScale } from './lookup';
import { spawnUnit } from './spawn';
import { LANES, MAX_LEVEL, PLANT_COLS, ZOMBIE_SPAWN_X } from './types';
import type { LevelMode, MatchConfig, SimEvent, SimState, Unit, UnitKey } from './types';

const MODES: readonly LevelMode[] = ['battle', 'survive', 'breakthrough', 'conveyor', 'boss'];

/** The modes played against a clock: sudden death is off and the plants win at `goalTicks`. */
export function hasClock(mode: LevelMode): boolean {
  return mode === 'survive' || mode === 'breakthrough' || mode === 'conveyor';
}

/** The non-card units a level may put on the lawn, with their side. */
const NON_CARDS: ReadonlySet<UnitKey> = new Set<UnitKey>(['boneMinion', 'rock']);

/**
 * Refuses a level setup that makes no sense (a programming error in level data, never a game
 * situation), with a `RangeError` naming what is wrong:
 * - `mode` one of the five; `goalTicks` a whole number above 0, required in survive, breakthrough
 *   and conveyor, not allowed in battle and boss (they end by sudden death);
 * - `noEnergy` true or false;
 * - `belt` exactly in conveyor, and sound (see `checkBeltConfig`);
 * - `invulnerableBase` null or `'zombies'` (a safe plant base would make the clock unwinnable for zombies);
 * - every prepared unit and script entry: a unit the balance table has numbers for (a card or a
 *   Bone Minion or rock), its own side, a lane 0..4, a level 1..`MAX_LEVEL`; a plant's `x` the
 *   middle of a plant tile (col + 0.5, col 0..7), a zombie's (optional in the script) a number
 *   0..`ZOMBIE_SPAWN_X`; no two prepared plants on one tile;
 * - script ticks whole, not below 0, in order (ties keep list order), and before `goalTicks`.
 */
export function checkLevel(c: MatchConfig, b: Balance): void {
  if (!MODES.includes(c.mode)) throw new RangeError(`mode "${String(c.mode)}" is none of ${MODES.join(', ')}`);
  if (c.goalTicks !== null && !(Number.isInteger(c.goalTicks) && c.goalTicks > 0)) {
    throw new RangeError(`goalTicks ${String(c.goalTicks)} is not a whole number above 0`);
  }
  if (hasClock(c.mode)) {
    if (c.goalTicks === null) throw new RangeError(`a ${c.mode} level needs goalTicks`);
  } else if (c.goalTicks !== null) {
    throw new RangeError(`a ${c.mode} level has no clock, but goalTicks is ${c.goalTicks}`);
  }
  if ((c.mode === 'conveyor') !== (c.belt !== null)) {
    throw new RangeError(c.mode === 'conveyor' ? 'a conveyor level needs a belt' : `a ${c.mode} level has no belt`);
  }
  if (c.belt !== null) checkBeltConfig(c.belt, b);
  if (typeof c.noEnergy !== 'boolean') throw new RangeError(`noEnergy ${String(c.noEnergy)} is not true or false`);
  if (c.invulnerableBase !== null && c.invulnerableBase !== 'zombies') {
    // The clock's winner is always the plants, so a plant base that cannot be hurt would make a
    // level a zombie player can never win; only the zombie base may be made safe.
    throw new RangeError(`invulnerableBase "${String(c.invulnerableBase)}" is not allowed: only the zombie base (or none)`);
  }
  const tiles = new Set<number>();
  c.prepared.forEach((p, i) => {
    checkPlacement(`prepared unit ${i}`, p.unit, p.faction, p.lane, p.x, p.level, b);
    if (p.faction === 'plants') {
      const tile = p.lane * PLANT_COLS + Math.floor(p.x);
      if (tiles.has(tile)) throw new RangeError(`prepared unit ${i}: a plant already stands on that tile`);
      tiles.add(tile);
    }
  });
  let lastTick = 0;
  c.script.forEach((e, i) => {
    if (!(Number.isInteger(e.tick) && e.tick >= 0)) throw new RangeError(`script entry ${i}: tick ${e.tick} is not a whole number from 0`);
    if (e.tick < lastTick) throw new RangeError(`script entry ${i}: the script is not sorted by tick`);
    lastTick = e.tick;
    if (c.goalTicks !== null && e.tick >= c.goalTicks) {
      throw new RangeError(`script entry ${i}: tick ${e.tick} is at or after goalTicks ${c.goalTicks}, a wave that never comes`);
    }
    checkPlacement(`script entry ${i}`, e.unit, e.faction, e.lane, e.x, e.level, b);
  });
}

function checkPlacement(
  what: string, unit: UnitKey, faction: MatchConfig['prepared'][number]['faction'], lane: number, x: number | undefined,
  level: number, b: Balance,
): void {
  if (!(isCard(unit) || NON_CARDS.has(unit)) || b.units[unit] === undefined) {
    throw new RangeError(`${what}: "${String(unit)}" is no unit the balance table has numbers for`);
  }
  if (factionOf(unit) !== faction) throw new RangeError(`${what}: ${unit} is not on the ${String(faction)} side`);
  if (!(Number.isInteger(lane) && lane >= 0 && lane < LANES)) throw new RangeError(`${what}: lane ${lane} is not 0..${LANES - 1}`);
  if (!(Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL)) throw new RangeError(`${what}: level ${level} is not 1..${MAX_LEVEL}`);
  if (faction === 'plants') {
    const col = x === undefined ? Number.NaN : x - 0.5;
    if (!(Number.isInteger(col) && col >= 0 && col < PLANT_COLS)) {
      throw new RangeError(`${what}: a plant's x (${String(x)}) must be the middle of a tile, col + 0.5, col 0..${PLANT_COLS - 1}`);
    }
  } else if (x !== undefined && !(x >= 0 && x <= ZOMBIE_SPAWN_X)) {
    throw new RangeError(`${what}: x ${x} is not 0..${ZOMBIE_SPAWN_X}`);
  }
}

/**
 * A unit as a level puts it on the lawn: `spawnUnit` (its side's Marketplace level applies, as for a
 * placed card), then at `level` its max health and health are its base health times the `hp` level
 * curve times `upgradeScale`, rounded, and its `spent` is its price × level (0 for a unit that is no
 * card), so it pays a bounty like a unit merged up to that level.
 */
export function spawnAtLevel(
  s: SimState, b: Balance, key: UnitKey, lane: number, x: number, level: number, events: SimEvent[],
): Unit {
  const u = spawnUnit(s, b, key, lane, x, events);
  if (level !== 1) {
    u.level = level;
    u.maxHp = Math.round(statsFor(b, key).hp * levelScale(b, u.faction, level, 'hp') * upgradeScale(b, s.config, u, 'hp'));
    u.hp = u.maxHp;
  }
  u.spent = priceOf(key) * level;
  return u;
}

/**
 * Step stage 0, before the commands. On the step of tick 0 the prepared units come on, in list
 * order (`unitSpawned` each, no `waveSpawned`). Then every script entry whose tick has come, in list
 * order: `waveSpawned` then the unit's own `unitSpawned`; a zombie at its `x`, or at
 * `ZOMBIE_SPAWN_X` with none; a plant on its tile, unless a plant already stands there: then it is
 * skipped with `waveSkipped` (reason `'occupied'`). Either way `scriptIndex` moves past it.
 */
export function tickScript(s: SimState, b: Balance, events: SimEvent[]): void {
  const c = s.config;
  if (s.tick === 0) {
    for (const p of c.prepared) spawnAtLevel(s, b, p.unit, p.lane, p.x, p.level, events);
  }
  while (s.scriptIndex < c.script.length) {
    const index = s.scriptIndex;
    const e = c.script[index]!;
    if (e.tick > s.tick) break;
    s.scriptIndex += 1;
    const x = e.x ?? ZOMBIE_SPAWN_X; // a plant always has one (checkLevel)
    if (e.faction === 'plants' && plantAt(s, e.lane, Math.floor(x))) {
      events.push({ type: 'waveSkipped', index, unit: e.unit, lane: e.lane, reason: 'occupied' });
      continue;
    }
    events.push({ type: 'waveSpawned', index, unit: e.unit, lane: e.lane });
    spawnAtLevel(s, b, e.unit, e.lane, x, e.level, events);
  }
}

