import type { Command, Faction } from '../sim/types';
import {
  MAX_TURN, MAX_TURN_COMMANDS, TURN_TICKS, decodeTurn, encodeTurn, type Turn, type TurnCommand,
} from './turnCodec';

/** An own tap waiting to run: `runTick` is the tick it was stamped for (spec 6.2). */
export interface PendingTap { id: number; runTick: number; cmd: Command }

const FACTIONS: readonly Faction[] = ['plants', 'zombies']; // the order commands of one tick run in
/** The longest hash a turn can carry, for checking that a tap still fits in 400 characters. */
const WIDEST_HASH = [MAX_TURN * TURN_TICKS, 0xffffffff] as const;

interface Held { raw: string; turn: Turn }

const validTurn = (k: number) => Number.isInteger(k) && k >= 0 && k <= MAX_TURN;
const turnOf = (tick: number) => Math.floor(tick / TURN_TICKS);

/**
 * The lockstep scheduler of one device (spec 6.2): stamps its own taps `delay` ticks ahead, cuts
 * its own log into turn records once no tap can land in them, holds both seats' records, and says
 * when a tick may run and what runs in it. Pure: no clock, no network; the caller drives it.
 *
 * Everything that runs is decoded from the stored strings, the device's own included, so both
 * screens run exactly what the database holds.
 */
export class Lockstep {
  readonly seat: Faction;
  readonly delay: number;
  private readonly turns: Record<Faction, Map<number, Held>> = { plants: new Map(), zombies: new Map() };
  private readonly ackedTurns = new Set<number>();
  /** Own turns below this index are taken (published or adopted); taps never land in them. */
  private nextTake = 0;
  private taps: PendingTap[] = [];
  private nextId = 1;
  private hash: readonly [number, number] | null = null;
  private hashes: (readonly [number, number])[] = [];

  constructor(opts: { seat: Faction; delay: number /* 9..30 */ }) {
    if (!Number.isInteger(opts.delay) || opts.delay < 9 || opts.delay > 30) {
      throw new RangeError(`input delay ${opts.delay} outside 9..30`);
    }
    this.seat = opts.seat;
    this.delay = opts.delay;
  }

  private get other(): Faction { return this.seat === 'plants' ? 'zombies' : 'plants'; }

  private tapsIn(k: number): PendingTap[] { return this.taps.filter((p) => turnOf(p.runTick) === k); }

  private toTurnCommands(k: number, taps: readonly PendingTap[]): TurnCommand[] {
    return taps.map((p) => ({ at: p.runTick - k * TURN_TICKS, cmd: p.cmd }));
  }

  /**
   * Stamps a tap made at `tick` to run at `max(tick + delay, 6 × first unpublished own turn)`.
   * `'full'` when that turn already holds 8 taps, the record would pass 400 characters, or the
   * turn is past `MAX_TURN`. Throws RangeError on a belt command (Versus has no belt).
   */
  submit(cmd: Command, tick: number): PendingTap | 'full' {
    if (cmd.type === 'belt') throw new RangeError('a belt command is never sent');
    const runTick = Math.max(tick + this.delay, TURN_TICKS * this.nextTake);
    const k = turnOf(runTick);
    if (k > MAX_TURN) return 'full';
    const tap: PendingTap = { id: this.nextId, runTick, cmd };
    const inTurn = [...this.tapsIn(k), tap];
    if (inTurn.length > MAX_TURN_COMMANDS) return 'full';
    try {
      encodeTurn({ commands: this.toTurnCommands(k, inTurn), hash: WIDEST_HASH }); // throws past 400 characters
    } catch {
      return 'full';
    }
    this.nextId++;
    this.taps.push(tap);
    return tap;
  }

  /**
   * The own turns due at `tick` (those `k` with `6k + 5 − delay < tick`) not yet taken, in order,
   * as record strings. The newest offered hash rides on the first of them.
   */
  takeDue(tick: number): { k: number; raw: string }[] {
    const out: { k: number; raw: string }[] = [];
    while (this.nextTake <= MAX_TURN && TURN_TICKS * this.nextTake + TURN_TICKS - 1 - this.delay < tick) {
      const k = this.nextTake++;
      const raw = encodeTurn({ commands: this.toTurnCommands(k, this.tapsIn(k)), hash: this.hash });
      this.hash = null;
      this.turns[this.seat].set(k, { raw, turn: decodeTurn(raw, this.seat) });
      out.push({ k, raw });
    }
    return out;
  }

  /** The newest own hash (`tick` a multiple of 30); it rides on the next taken turn only. */
  offerHash(tick: number, hash: number): void { this.hash = [tick, hash]; }

  /** The database answered OK to own turn `k`: from now on it counts for `canRun`. */
  acked(k: number): void {
    if (this.turns[this.seat].has(k)) this.ackedTurns.add(k);
  }

  /** Rejoin: own turn `k` is already in the database, taken and acknowledged. */
  adoptOwn(k: number, raw: string): void {
    if (!validTurn(k)) return;
    const own = this.turns[this.seat];
    if (!own.has(k)) own.set(k, { raw, turn: decodeTurn(raw, this.seat) });
    this.ackedTurns.add(k);
    this.nextTake = Math.max(this.nextTake, k + 1);
  }

  /** The other seat's turn `k`. Repeats (the first string is kept) and own-seat records are ignored. */
  receive(seat: Faction, k: number, raw: string): void {
    if (seat === this.seat || !validTurn(k)) return;
    const theirs = this.turns[seat];
    if (theirs.has(k)) return;
    const turn = decodeTurn(raw, seat);
    theirs.set(k, { raw, turn });
    if (turn.hash) this.hashes.push(turn.hash);
  }

  /** Both seats hold turn `floor(tick / 6)`, and the own one is acknowledged by the database. */
  canRun(tick: number): boolean {
    const k = turnOf(tick);
    return this.ackedTurns.has(k) && this.turns[this.other].has(k);
  }

  /**
   * The commands to run at `tick`: plants' then zombies', each in record order, decoded from the
   * stored strings. Calling it marks the tick as run: own taps stamped at or before it leave
   * `pending()`.
   */
  commandsAt(tick: number): Command[] {
    const k = turnOf(tick);
    const at = tick - k * TURN_TICKS;
    this.taps = this.taps.filter((p) => p.runTick > tick);
    return FACTIONS.flatMap((f) =>
      (this.turns[f].get(k)?.turn.commands ?? []).filter((c) => c.at === at).map((c) => c.cmd));
  }

  /** Own taps not yet run. */
  pending(): readonly PendingTap[] { return this.taps; }

  /** The other seat's hashes received since the last call, in arrival order. */
  remoteHashes(): (readonly [number, number])[] {
    const out = this.hashes;
    this.hashes = [];
    return out;
  }

  /** The lowest turn index of `seat` not held (where a stream of that log starts). */
  firstMissing(seat: Faction): number {
    const held = this.turns[seat];
    let k = 0;
    while (held.has(k)) k++;
    return k;
  }

  /** After a sleep: removes and returns own taps in turns not yet taken (no one ever ran them). */
  dropUnpublished(): PendingTap[] {
    const cut = TURN_TICKS * this.nextTake;
    const dropped = this.taps.filter((p) => p.runTick >= cut);
    this.taps = this.taps.filter((p) => p.runTick < cut);
    return dropped;
  }
}
