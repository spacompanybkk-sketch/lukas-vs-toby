/**
 * The lawn twists of worlds 2–5 (`MatchConfig.lawn`, spec 8). Each is off when null or empty, and
 * they compose. Where each one applies in a step:
 *
 * - Rocks (Desert): a plant cannot be put on a rock tile: a card (`checkPlace`), a belt card
 *   (`checkBelt`), the Rock Wall spell (`checkSpell`) are refused `'rock'`, a plant boss's summon
 *   leaves rock tiles out, and a level that puts a plant there is refused (`checkLawn`). Rocks cannot
 *   be destroyed; zombies and shots pass over them.
 * - Fog (Meadow): a shot reaches `min(range, fog)` tiles (`shoot`), and a straight, piercing or
 *   unaimed lobbed shot fades out (`projectileFaded`) at `fadeX`, fog tiles from where it was
 *   fired, before it can reach a base. Hero powers, spells and boss attacks are not touched.
 * - Ice (Tundra): zombies (bosses too) in the listed lanes walk `speed` times as fast (`tickMovement`).
 * - Lava (Citadel): whoever stands on a lava tile, either side, bosses too, burns (`tickLava`).
 */

import { BALANCE } from '../data/balance';
import type { Balance } from '../data/balance';
import { factionOf } from '../data/units';
import { inLane, isStanding } from './lookup';
import { inflictStatus } from './status';
import { BOSS_HALF_WIDTH, COLS, LANES, PLANT_COLS } from './types';
import type { LawnConfig, MatchConfig, SimEvent, SimState } from './types';

export type { LawnConfig } from './types';

/** No twist at all: the Backyard, Versus, Quick Battle and Free Play. Frozen; `cloneLawn` for a copy. */
export const NO_TWIST: LawnConfig = Object.freeze({
  rocks: Object.freeze([]) as unknown as number[],
  fog: null,
  ice: null,
  lava: null,
});

/** A fresh copy sharing nothing with `l`. */
export function cloneLawn(l: LawnConfig): LawnConfig {
  return {
    rocks: [...l.rocks],
    fog: l.fog,
    ice: l.ice === null ? null : { lanes: [...l.ice.lanes], speed: l.ice.speed },
    lava: l.lava === null ? null : { tiles: [...l.lava.tiles], dps: l.lava.dps, burnTicks: l.lava.burnTicks },
  };
}

/** What a zombie in `lane` has its walking speed multiplied by: the ice's `speed` in an ice lane, else 1. */
export function iceFactor(c: MatchConfig, lane: number): number {
  const ice = c.lawn.ice;
  return ice !== null && ice.lanes.includes(lane) ? ice.speed : 1;
}

/** Whether a rock of the lawn lies on plant tile (`lane`, `col`). */
export function isRock(c: MatchConfig, lane: number, col: number): boolean {
  return c.lawn.rocks.length > 0 && c.lawn.rocks.includes(lane * PLANT_COLS + col);
}

const isWhole = (n: number, min: number, max: number): boolean => Number.isInteger(n) && n >= min && n <= max;

/** Refuses a list of whole numbers that has one out of `0..max` or one twice. */
function checkList(what: string, items: readonly number[], max: number, name: (n: number) => string): void {
  if (!Array.isArray(items)) throw new RangeError(`lawn: ${what} is not a list`);
  const seen = new Set<number>();
  for (const n of items) {
    if (!isWhole(n, 0, max)) throw new RangeError(`lawn: ${what} ${String(n)} is not a whole number 0..${max}`);
    if (seen.has(n)) throw new RangeError(`lawn: ${what} ${name(n)} is listed twice`);
    seen.add(n);
  }
}

const plantTile = (t: number): string => `${t} (lane ${Math.floor(t / PLANT_COLS)}, col ${t % PLANT_COLS})`;
const lawnTile = (t: number): string => `${t} (lane ${Math.floor(t / COLS)}, col ${t % COLS})`;

/**
 * Refuses a lawn that makes no sense (a programming error in level data), with a `RangeError`
 * naming what is wrong (called from `checkLevel`):
 * - rock tiles whole, 0..`LANES × PLANT_COLS − 1`, none twice; no prepared or scripted plant, and no
 *   plant boss, on a rock; no rocks in Free Play (its gardens are laid anywhere);
 * - fog null or a number of tiles above 0;
 * - ice lanes whole, 0..`LANES − 1`, none twice, and a speed above 0;
 * - lava tiles whole, 0..`LANES × COLS − 1`, none twice, a dps from 0 and whole `burnTicks` from 1.
 */
export function checkLawn(c: MatchConfig, b: Balance = BALANCE as Balance): void {
  const l = c.lawn as LawnConfig | undefined;
  if (l === undefined || l === null) throw new RangeError('the setup has no lawn (NO_TWIST for none)');
  checkList('rock tile', l.rocks, LANES * PLANT_COLS - 1, plantTile);
  if (l.fog !== null && !(typeof l.fog === 'number' && Number.isFinite(l.fog) && l.fog > 0)) {
    throw new RangeError(`lawn: fog ${String(l.fog)} must be a number of tiles above 0`);
  }
  if (l.ice !== null) {
    checkList('ice lane', l.ice.lanes, LANES - 1, String);
    if (!(Number.isFinite(l.ice.speed) && l.ice.speed > 0)) throw new RangeError(`lawn: ice speed ${String(l.ice.speed)} must be above 0`);
  }
  if (l.lava !== null) {
    checkList('lava tile', l.lava.tiles, LANES * COLS - 1, lawnTile);
    if (!(Number.isFinite(l.lava.dps) && l.lava.dps >= 0)) throw new RangeError(`lawn: lava dps ${String(l.lava.dps)} must be a number from 0`);
    if (!isWhole(l.lava.burnTicks, 1, Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`lawn: lava burnTicks ${String(l.lava.burnTicks)} must be a whole number from 1`);
    }
  }
  if (l.rocks.length === 0) return;
  if (c.endless !== null && c.endless !== undefined) throw new RangeError('lawn: Free Play has no rocks (its gardens are laid on any tile)');
  const onRock = (what: string, lane: number, x: number | undefined): void => {
    if (x === undefined) return;
    const col = Math.floor(x);
    if (isRock(c, lane, col)) throw new RangeError(`lawn: ${what} stands on a rock (lane ${lane}, col ${col})`);
  };
  c.prepared.forEach((p, i) => { if (p.faction === 'plants') onRock(`prepared unit ${i} (${p.unit})`, p.lane, p.x); });
  c.script.forEach((e, i) => { if (e.faction === 'plants') onRock(`script entry ${i} (${e.unit})`, e.lane, e.x); });
  const boss = c.boss;
  if (boss !== null && boss !== undefined && factionOf(boss.key) === 'plants') {
    const col = b.bosses[boss.key]?.col;
    const half = BOSS_HALF_WIDTH[boss.key];
    if (col !== undefined) {
      for (let lane = boss.lane - half; lane <= boss.lane + half; lane++) onRock(`boss ${boss.key}`, lane, col + 0.5);
    }
  }
}

/**
 * Step stage, after the hazards and before the statuses: every standing unit, in ascending id,
 * either side, a boss too, that stands on a lava tile (its lane, or any lane a wide boss stands in,
 * and `floor(x)` the tile's column) burns for at least `burnTicks` at `dps` (the larger dps wins),
 * through `inflictStatus`, as the rot puddle poisons: only the start of the burn is reported
 * (`statusApplied`, no source); topping it up each tick it stands there is silent. Off it, the burn
 * runs out on its own (`tickStatuses`). No lava: nothing at all.
 */
export function tickLava(s: SimState, b: Balance, events: SimEvent[]): void {
  const lava = s.config.lawn.lava;
  if (lava === null) return;
  for (const u of s.units) {
    if (!isStanding(u)) continue;
    const col = Math.floor(u.x);
    const onLava = lava.tiles.some((t) => t % COLS === col && inLane(u, Math.floor(t / COLS)));
    if (onLava) inflictStatus(s, b, u, 'burn', lava.burnTicks, lava.dps, null, events, true);
  }
}
