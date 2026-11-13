import { effect } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { isOpen, levelConfig } from '../adventure/campaign';
import { LEVELS, levelById } from '../adventure/levels';
import { applyLevelResult, starsFor } from '../adventure/rewards';
import type { Stars } from '../adventure/rewards';
import type { LevelDef, TutorialStep } from '../adventure/types';
import { seconds } from '../data/balance';
import type { Save, Slot } from '../progress/save';
import type { Match } from '../sim/match';
import type { CardKey, Faction, MatchConfig } from '../sim/types';
import type { BattleOptions } from './BattleController';

/**
 * One Adventure level being played, and how its result reaches the save exactly once
 * (plan review-focus 4):
 *
 * 1. `prepareLevel` when the level STARTS: the match from `levelConfig` and a fresh battle id.
 * 2. The match ends: `levelRecord` reads the stars off the end state (the player's base health
 *    share; the clock left for Breakthrough) into `{ battleId, levelId, side, stars, won }`.
 * 3. `settleLevel`: the record is written to the device first (`pendingKey`), then applied with
 *    `applyLevelResult` through `host.update`, then the device record is removed.
 * 4. A record still on the device (the page went away in between) is applied at the player's next
 *    log-in or app start (`watchPending`) and before the next level starts (`applyPending`).
 *    Applying twice changes nothing: `applyLevelResult` ignores a battle id the save already has
 *    as `lastBattle`.
 *
 * Quitting a level stores nothing. Quick Battle never comes here.
 */

/** A level as it is played: its definition, the match, the battle's id and whose battle it is. */
export interface LevelPlay {
  def: LevelDef; config: MatchConfig; battleId: string; slot: Slot;
  /** The tutorial steps to show in this battle (`stepsToTeach`); none or empty: no tutorial. */
  teach?: TutorialStep[];
}

/** The result of one played level, kept on the device until applied. */
export interface LevelRecord { battleId: string; levelId: string; side: Faction; stars: Stars; won: boolean }

/** What the result screen shows once a record is applied. */
export interface LevelOutcome {
  levelId: string; won: boolean; stars: Stars;
  /** Coins this battle paid (0 when it had already been paid). */
  coins: number; newStars: number;
  /** The card this win unlocked, or null. */
  unlocked: CardKey | null;
  /** The level after this one when it is open now (a win opens it), else null. */
  next: LevelDef | null;
}

/** What the level flow needs from the player session (the app's `session`; tests pass their own). */
export interface LevelHost {
  readonly player: ReadonlySignal<Save | null>;
  update(fn: (s: Save) => Save): void;
  now(): number;
  /** The device storage of this cloud mode (keys `lvt2_…` are moved to the mode's prefix). */
  deviceStorage(): Storage | undefined;
}

/** The device key of a player's pending level result. */
export const pendingKey = (slot: Slot): string => `lvt2_pending_${slot}`;

/** A fresh battle id: 'b' and 16 random base-36 characters (the save takes 1..64). */
export function newBattleId(random: () => number = Math.random): string {
  let id = 'b';
  for (let i = 0; i < 16; i++) id += Math.floor(random() * 36).toString(36);
  return id;
}

/** Why `def` cannot be played, or null. A computer with no energy could never play a card. */
export function levelProblem(def: LevelDef): string | null {
  if (def.opponent !== null && def.kind === 'conveyor') {
    return `level ${def.id}: an opponent in a conveyor level could never play a card (no energy); its opponent must be null`;
  }
  return null;
}

/** Sets up `def` for the owner of `save` (throws on a level that cannot be played; see `levelProblem`). */
export function prepareLevel(
  def: LevelDef, save: Save, seed: number, slot: Slot = save.slot, random: () => number = Math.random,
): LevelPlay {
  const problem = levelProblem(def);
  if (problem !== null) throw new Error(problem);
  return { def, config: levelConfig(def, save, seed >>> 0), battleId: newBattleId(random), slot };
}

/** The battle options of a prepared level (the controller plays `play.config`). */
export function levelOptions(play: LevelPlay): BattleOptions {
  const side = play.def.side;
  return {
    playerFaction: side,
    skill: play.def.opponent?.skill ?? 'easy',
    seed: play.config.seed,
    cards: [...play.config.cards[side]],
    level: play.def.id,
    play,
  };
}

/** The record of a decided level (null while it runs, and for a battle that is no level). */
export function levelRecord(ctl: { readonly play: LevelPlay | null; readonly match: Match }): LevelRecord | null {
  const play = ctl.play;
  const s = ctl.match.state;
  if (play === null || s.winner === null) return null;
  const side = play.def.side;
  const won = s.winner === side;
  const max = s.baseMaxHp[side];
  const goal = play.config.goalTicks;
  const stars = starsFor(play.def, {
    won,
    baseHpShare: max > 0 ? Math.max(0, s.baseHp[side]) / max : 0,
    clockShareLeft: goal === null ? 0 : Math.max(0, goal - s.tick) / goal,
  });
  return { battleId: play.battleId, levelId: play.def.id, side, stars, won };
}

function readKey(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeKey(storage: Storage | undefined, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // No storage: the record lives as long as this page (it is applied at once anyway).
  }
}

function parseRecord(raw: string): LevelRecord | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const r = o as Record<string, unknown>;
  const okId = typeof r.battleId === 'string' && r.battleId.length >= 1 && r.battleId.length <= 64;
  const okSide = r.side === 'plants' || r.side === 'zombies';
  const okStars = r.stars === 0 || r.stars === 1 || r.stars === 2 || r.stars === 3;
  if (!okId || typeof r.levelId !== 'string' || !okSide || !okStars || typeof r.won !== 'boolean') return null;
  if (r.won !== ((r.stars as number) > 0)) return null;
  return { battleId: r.battleId as string, levelId: r.levelId, side: r.side as Faction, stars: r.stars as Stars, won: r.won };
}

/** The pending record of `slot` on this device, or null. */
export function readPending(host: Pick<LevelHost, 'deviceStorage'>, slot: Slot): LevelRecord | null {
  const raw = readKey(host.deviceStorage(), pendingKey(slot));
  return raw === null ? null : parseRecord(raw);
}

/** The level after `def` on its side (the next number in its world, then the next world's first). */
function after(def: LevelDef, levels: readonly LevelDef[]): LevelDef | null {
  const order = levels.filter((l) => l.side === def.side).sort((a, b) => a.world - b.world || a.n - b.n);
  const i = order.findIndex((l) => l.id === def.id);
  return i < 0 ? null : order[i + 1] ?? null;
}

/** Applies `rec` to the logged-in player's save (once per battle id) and says what it did. */
function apply(host: LevelHost, rec: LevelRecord, levels: readonly LevelDef[]): LevelOutcome | null {
  const def = levelById(rec.levelId, levels);
  if (def === null || def.side !== rec.side || host.player.peek() === null) return null;
  let paid = { coins: 0, newStars: 0, unlocked: null as CardKey | null };
  host.update((save) => {
    const r = applyLevelResult(save, def, rec.stars, host.now(), rec.battleId);
    paid = { coins: r.coins, newStars: r.newStars, unlocked: r.unlocked };
    return r.save;
  });
  const save = host.player.peek();
  const next = after(def, levels);
  return {
    levelId: def.id, won: rec.won, stars: rec.stars, ...paid,
    next: next !== null && save !== null && isOpen(save, next, levels) ? next : null,
  };
}

/**
 * The match of `slot`'s battle is decided: the record goes onto the device, then into the save,
 * then off the device. When `slot` is not the player logged in now (nobody, or another player:
 * a guest plays no level), the record stays on the device for `slot`'s next log-in and the answer
 * is null. Null too when the record names no known level.
 */
export function settleLevel(host: LevelHost, rec: LevelRecord, slot: Slot, levels: readonly LevelDef[] = LEVELS): LevelOutcome | null {
  const storage = host.deviceStorage();
  writeKey(storage, pendingKey(slot), JSON.stringify(rec));
  if (host.player.peek()?.slot !== slot) return null;
  const out = apply(host, rec, levels);
  writeKey(storage, pendingKey(slot), null);
  return out;
}

/** Applies the logged-in player's pending record, if this device holds one (and removes it). */
export function applyPending(host: LevelHost, levels: readonly LevelDef[] = LEVELS): LevelOutcome | null {
  const me = host.player.peek();
  if (me === null) return null;
  const storage = host.deviceStorage();
  const raw = readKey(storage, pendingKey(me.slot));
  if (raw === null) return null;
  const rec = parseRecord(raw);
  const out = rec === null ? null : apply(host, rec, levels);
  writeKey(storage, pendingKey(me.slot), null);
  return out;
}

/** On every log-in (and at start, for a player already in): their pending record first. Returns the stop. */
export function watchPending(host: LevelHost, levels: readonly LevelDef[] = LEVELS): () => void {
  let last: Slot | null = null;
  return effect(() => {
    const slot = host.player.value?.slot ?? null;
    if (slot === last) return;
    last = slot;
    if (slot !== null) queueMicrotask(() => { if (host.player.peek()?.slot === slot) applyPending(host, levels); });
  });
}

/**
 * The big waves of a script: each run of arrivals where every one comes within 3 s of the one
 * before, with at least 4 units in it, from its first arrival's tick to its last's.
 */
export function bigWaveRuns(script: readonly { tick: number }[]): { from: number; to: number }[] {
  const gap = seconds(3);
  const runs: { from: number; to: number }[] = [];
  let start = 0;
  for (let i = 1; i <= script.length; i++) {
    if (i < script.length && script[i]!.tick - script[i - 1]!.tick <= gap) continue;
    if (i - start >= 4) runs.push({ from: script[start]!.tick, to: script[i - 1]!.tick });
    start = i;
  }
  return runs;
}

/** The script ticks that get a flag on the wave bar: where each big wave (`bigWaveRuns`) begins. */
export function bigWaves(script: readonly { tick: number }[]): number[] {
  return bigWaveRuns(script).map((r) => r.from);
}
