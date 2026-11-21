import { priceOf } from '../data/units';
import type { Slot } from '../progress/save';
import { Match } from '../sim/match';
import type { Command, Faction, SimEvent } from '../sim/types';
import type { ControlRecord, MatchChannel, MatchEvent, Timers, WriteAnswer } from './channel';
import { HashRing } from './hashRing';
import { Lockstep, type PendingTap } from './lockstep';
import {
  HASH_EVERY_TICKS, MAX_REPAIRS, VS_TIMEOUTS, stallStage, type StallStage, type VersusTimeouts,
} from './timeouts';
import { TURN_TICKS } from './turnCodec';

export type VersusOutcome =
  | { kind: 'won'; winner: Faction | 'draw' }
  | { kind: 'forfeit'; winner: Faction; by: Slot }
  | { kind: 'unfinished'; why: 'broken' | 'flag' | 'silence' | 'gone' }
  | { kind: 'disagree'; shown: Faction | 'draw' }; // the host's winner is shown, nobody credited

export type StepAnswer =
  | { kind: 'ran'; events: SimEvent[] }
  | { kind: 'wait'; why: 'turns' | 'paused' | 'repair' }
  | { kind: 'over' };

export interface LockstepMatchOptions {
  match: Match; seat: Faction; delay: number; host: boolean; me: Slot; other: Slot;
  channel: MatchChannel; now: () => number; timers: Timers; timeouts?: VersusTimeouts;
}

type Winner = Faction | 'draw';
type SyncRecord = Extract<ControlRecord, { kind: 'sync' }>;

const isWinner = (v: unknown): v is Winner => v === 'plants' || v === 'zombies' || v === 'draw';

/**
 * The `w` of an end record from a device whose match broke (a mismatch after three repairs, a
 * write the database refused, or ten minutes of silence): no winner, and the other device goes
 * home too (spec 6.6 step 5).
 */
export const BROKEN_END = 'broken';
/** The `w` of an end record from a device whose player gave up waiting (the white flag): no winner. */
export const GONE_END = 'gone';
/**
 * The `w` of an end record from a device whose player forfeited (the white flag in the pause
 * menu): `{"w":"quit","by":<slot>,"t":…,"h":…}`, the other seat wins (spec 6.7). The forfeiting
 * device writes it into both empty slots; it decides only once both slots are known.
 */
export const FORFEIT_END = 'quit';

interface EndRecord { w: Winner | typeof BROKEN_END | typeof GONE_END | typeof FORFEIT_END; t: unknown; h: unknown; by?: unknown }

/** An end record (`{"w":…,"t":…,"h":…}`), or null when it is not one (read as broken: nobody wins). */
function parseEnd(raw: string): EndRecord | null {
  try {
    const o = JSON.parse(raw) as Partial<EndRecord> | null;
    if (!o) return null;
    if (o.w === FORFEIT_END) return { w: o.w, t: o.t, h: o.h, by: o.by };
    return isWinner(o.w) || o.w === BROKEN_END || o.w === GONE_END ? { w: o.w, t: o.t, h: o.h } : null;
  } catch {
    return null;
  }
}

/** A seat's `end` slot as the database holds it (write-once): the stored string and what it says. */
interface EndSlot { raw: string; rec: EndRecord | null }

const isForfeit = (s: EndSlot | null): boolean => s?.rec?.w === FORFEIT_END;

/**
 * Pause numbers say who wrote them and whether they are a heartbeat: `n = 4·seq + 2·(zombies) + beat`.
 * A heartbeat is the pause record written again every `heartbeatMs` by a device that is present
 * (not hidden) while the match is paused; it never pauses by itself. It is how a paused device
 * knows the other is still there (spec 6.8: no limit while both are present).
 */
const pauseNumber = (seq: number, seat: Faction, beat: boolean) => 4 * seq + (seat === 'zombies' ? 2 : 0) + (beat ? 1 : 0);
const pauseWriter = (n: number): Faction => (Math.floor(n / 2) % 2 === 1 ? 'zombies' : 'plants');
const isBeat = (n: number) => n % 2 === 1;

/** The same `Match` object takes the snapshot's state (the render layer keeps its reference). */
export function restoreInto(match: Match, snapshot: string): void {
  const fresh = Match.restore(snapshot, match.balance).state as unknown as Record<string, unknown>;
  const target = match.state as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) if (!Object.hasOwn(fresh, key)) delete target[key];
  Object.assign(target, fresh);
}

/**
 * One device's side of a two-device Versus match (spec 6.2, 6.5–6.8, 9): runs the shared `Match`
 * a tick at a time only when both seats' turns are held, publishes its own turns through the
 * channel (retrying unanswered writes with the same strings), checks state hashes every 30 ticks,
 * repairs a desync from the host's snapshot, and turns pause, quit, silence, deletion and the
 * two end records into an outcome. Driven by the caller's `tryStep`; all time comes from the
 * injected `now` and `timers`.
 *
 * How a match ends, so that both screens always show the same outcome: the two `end` slots are
 * write-once, so once both hold a value they never change, and the outcome is a function of the
 * two values as the database holds them (`settleFromSlots`): a slot with no winner (`broken`,
 * `gone`, unreadable) → unfinished; two winners → `won` if equal, else `disagree`. A device
 * never settles a won, a disagree or an unfinished any other way; the only other outcomes are a
 * `quit` record (forfeit) and the match deleted (`gone`). Giving up (silence, the white flag, a
 * broken match) is a write too: into the own slot while it is empty, else into the other's empty
 * slot. If that write is refused, the slot already holds the other's value, which decides.
 * The host's state is the authority (spec 6.6), for the end as well: a guest that knows the host's
 * end record and cannot reach the same end itself writes that record as its own, and a host whose
 * guest stays silent for `endWaitMs` after the host's end writes it into the guest's empty slot.
 */
export class LockstepMatch {
  readonly match: Match;
  readonly seat: Faction;
  readonly host: boolean;
  private readonly me: Slot;
  private readonly otherSlot: Slot;
  private readonly otherSeat: Faction;
  private readonly delay: number;
  private readonly channel: MatchChannel;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly t: VersusTimeouts;
  private readonly lockstep: Lockstep;

  private _pausedBy: Slot | null = null;
  private pauseSeq = 0; // the highest pause sequence seen or written
  private pausedSince: number | null = null;
  /** Pause numbers heard on the stream; at a resume they become stale (see `onEvent`). */
  private readonly heardPauses = new Set<number>();
  private stalePauses = new Set<number>();
  /** Bumped by `resume`: a pause write still being retried from before it stops. */
  private pauseWrites = 0;
  private otherLifeAt = -Infinity; // when the other device last showed it is there
  private isHidden = false;
  private heartbeat: unknown = null;
  private result: VersusOutcome | null = null;
  private disposed = false;
  private unlisten: (() => void) | null = null;
  private readonly handles = new Set<unknown>();
  private readonly listeners = new Set<() => void>();

  // publishing
  private readonly written = new Set<number>(); // own turns this device built and sends
  private outbox: { k: number; raw: string }[] = [];
  private inFlight = false;

  // hashes and repair
  private readonly ring = new HashRing();
  private readonly theirHashes = new Map<number, number>();
  /** Hashes at or before this tick are not compared: they may predate the last repair on either screen. */
  private horizon = -1;
  private repairCount = 0;
  private repairing: 'none' | 'writing' | 'awaiting' = 'none';
  private pendingSync: SyncRecord | null = null;
  private lastMismatch: { tick: number; own: number; other: number } | null = null;
  private ownConflict = false;

  // end records
  /** Each seat's `end` slot as stored (from the stream, or from an own write answered `ok`). */
  private readonly slots: Record<Faction, EndSlot | null> = { plants: null, zombies: null };
  /** What this device wrote (or is writing) into its own slot; from then on it steps no more. */
  private ownClaim: string | null = null;
  /** What this device wrote (or is writing) into the other seat's empty slot. */
  private fillClaim: string | null = null;
  /** Why this device gave up, if it did: the outcome when the slots end with no winner. */
  private conceding: 'broken' | 'flag' | 'silence' | null = null;
  private endTimer: unknown = null;

  // taps and stalls
  private refusedIds: number[] = [];
  private waitingSince: number | null = null;
  private stalledTotal = 0;
  private maxSilent = 0;
  private shownStage: StallStage = 'none';

  constructor(opts: LockstepMatchOptions) {
    this.match = opts.match;
    this.seat = opts.seat;
    this.host = opts.host;
    this.me = opts.me;
    this.otherSlot = opts.other;
    this.otherSeat = opts.seat === 'plants' ? 'zombies' : 'plants';
    this.delay = opts.delay;
    this.channel = opts.channel;
    this.now = opts.now;
    this.timers = opts.timers;
    this.t = opts.timeouts ?? VS_TIMEOUTS;
    this.lockstep = new Lockstep({ seat: opts.seat, delay: opts.delay });
  }

  get pausedBy(): Slot | null { return this._pausedBy; }

  /** Listens from the first turns not held (turn 0 on a fresh match), then publishes the turns due. */
  start(): void {
    this.listen();
    this.publishDue();
  }

  /** An own tap, stamped at the current tick (see `Lockstep.submit`); `'full'` once the match is over. */
  tap(cmd: Command): PendingTap | 'full' {
    if (this.result || this.match.state.winner !== null || this.ending()) return 'full';
    const tap = this.lockstep.submit(cmd, this.match.state.tick);
    if (tap !== 'full') this.changed();
    return tap;
  }

  /** Runs one tick if it may: both turns held, not paused, not writing a repair, not over. */
  tryStep(): StepAnswer {
    if (this.result) return { kind: 'over' };
    if (this.pendingSync) this.applySync();
    if (this.ending()) return this.waitForEnd();
    const theirs = this.slots[this.otherSeat];
    if (theirs && isForfeit(theirs)) {
      // the other player forfeited: this screen's slot takes the same record (it may already hold it)
      this.claimOwn(theirs.raw);
      return this.waitForEnd();
    }
    const { winner, tick: now } = this.match.state;
    const hostEnd = this.hostEnd();
    if (hostEnd && this.takesHostEnd(hostEnd, winner, now)) {
      this.claimOwn(hostEnd.raw);
      return this.waitForEnd();
    }
    if (winner !== null) {
      if (this.repairing === 'awaiting') return this.parked();
      this.claimEnd(winner);
      return this.waitForEnd();
    }
    if (this.host && this.guestEndPassed(now)) {
      // the guest wrote an end for a tick this screen has reached without one: the two states
      // differ, and that record can never be rewritten (write-once), so nobody wins
      console.warn(`[versus] the other end record names tick ${String(this.slots[this.otherSeat]!.rec!.t)}; this screen ran past it with no winner`);
      this.broken();
      return this.result ? { kind: 'over' } : this.waitForEnd();
    }
    this.compareHashes();
    if (this.result) return { kind: 'over' };
    if (this.ending()) return this.waitForEnd(); // a mismatch broke the match, or the guest took the host's end
    // every wait below counts towards the stall stages, so none can last unseen
    if (this.repairing === 'writing') {
      this.waitOnOther();
      return this.result ? { kind: 'over' } : { kind: 'wait', why: 'repair' };
    }
    if (this._pausedBy !== null) {
      this.endWait();
      this.checkPausedSilence();
      return this.result ? { kind: 'over' } : { kind: 'wait', why: 'paused' };
    }
    const tick = this.match.state.tick;
    if (!this.lockstep.canRun(tick)) {
      this.waitOnOther();
      return this.result ? { kind: 'over' } : { kind: 'wait', why: 'turns' };
    }
    this.stopWaiting();
    return { kind: 'ran', events: this.runTick(tick) };
  }

  private runTick(tick: number): SimEvent[] {
    const mine = this.lockstep.pending().filter((p) => p.runTick === tick);
    const commands = this.lockstep.commandsAt(tick);
    const own = commands.filter((c) => c.faction === this.seat);
    // own commands of this tick are the own taps stamped for it, in the same order, unless the
    // record came from the database instead (rejoin): then no tap is known for them
    const tapOf = new Map<Command, number>();
    if (own.length === mine.length) own.forEach((c, i) => tapOf.set(c, mine[i]!.id));
    const events = this.match.step(commands);
    let refused = false;
    for (const e of events) {
      const id = e.type === 'commandRejected' ? tapOf.get(e.command) : undefined;
      if (id !== undefined) {
        this.refusedIds.push(id);
        refused = true;
      }
    }
    const { state } = this.match;
    if (state.tick % HASH_EVERY_TICKS === 0) {
      const hash = this.match.hash();
      this.ring.put(state.tick, hash);
      // a guest that found a mismatch keeps stepping, but its hashes are known bad until the
      // host's snapshot comes: they are not sent (the one already offered still goes)
      if (this.repairing !== 'awaiting') this.lockstep.offerHash(state.tick, hash);
    }
    // a guest waiting for the host's snapshot knows its state is wrong: its winner is not one
    if (state.winner !== null && this.repairing !== 'awaiting') this.claimEnd(state.winner);
    this.publishDue();
    if (mine.length > 0 || refused) this.changed();
    return events;
  }

  pending(): readonly PendingTap[] { return this.lockstep.pending(); }

  /** What the own pending places and merges will cost, for the HUD's energy (spec 6.4). */
  pendingSpend(): number {
    let sum = 0;
    for (const { cmd } of this.lockstep.pending()) if (cmd.type === 'place' || cmd.type === 'merge') sum += priceOf(cmd.unit);
    return sum;
  }

  /** Ids of own taps the sim refused when they ran, since the last call. */
  refused(): readonly number[] {
    const out = this.refusedIds;
    this.refusedIds = [];
    return out;
  }

  /**
   * How long the other seat has been silent: while stepping waits (on turns, a repair, or the end
   * records once this screen's own end is claimed), the time waited; while paused, the time since the other device last showed it is there, once that
   * passes `hereMs` (before that it counts as here); else 0.
   */
  silentMs(): number {
    if (this._pausedBy !== null) return this.pausedSilence();
    return this.waitingSince === null ? 0 : this.now() - this.waitingSince;
  }

  pause(): void {
    if (this.result) return;
    this.writePause(false);
  }

  resume(): void {
    if (this.result) return;
    this.pauseWrites++; // a pause whose answer was lost is not sent again after this
    this.setPaused(null);
    this.writeRetrying({ kind: 'resume' });
  }

  /**
   * The white flag in the pause menu: a forfeit, the other seat wins (spec 6.7). Like every end, it
   * is decided by the two write-once slots: the forfeit record goes into the own slot and into the
   * other's, and the outcome comes once both are known. If the other device filled either slot
   * first (the host's end after `endWaitMs`), that stored value decides, on both screens alike.
   * Not once an end record is known: then the slots already decide.
   */
  forfeit(): void {
    if (this.result || this.ending() || this.slots[this.otherSeat] !== null) return;
    const { tick } = this.match.state;
    const raw = JSON.stringify({ w: FORFEIT_END, by: this.me, t: tick, h: this.match.hash() });
    this.claimOwn(raw);
    this.fill(raw);
  }

  /**
   * The white flag while waiting on a silent seat: nobody wins, and the match is deleted. The
   * outcome comes once the give-up is stored in an end slot (see `concede`), then the match goes.
   */
  giveUp(): void {
    this.concede('flag');
  }

  /** The page hides: pause, with a write that can leave as it hides. */
  hidden(): void {
    if (this.result) return;
    this.isHidden = true; // a hidden page sends no heartbeats: its silence is what the other measures
    this.writePause(true);
  }

  /** The page is back: own taps never published are dropped, the streams reopen from the turns lacking. */
  visible(): void {
    if (this.result || this.disposed) return;
    this.isHidden = false;
    this.beat();
    if (this.lockstep.dropUnpublished().length > 0) this.changed();
    this.unlisten?.();
    this.listen();
    this.publishDue();
  }

  outcome(): VersusOutcome | null { return this.result; }

  repairs(): number { return this.repairCount; }

  stats(): { stalledMs: number; maxSilentMs: number; repairs: number } {
    const silent = this.silentMs();
    return { stalledMs: this.stalledTotal + silent, maxSilentMs: Math.max(this.maxSilent, silent), repairs: this.repairCount };
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  dispose(): void {
    this.disposed = true;
    this.unlisten?.();
    this.unlisten = null;
    for (const h of this.handles) this.timers.clear(h);
    this.handles.clear();
    this.listeners.clear();
  }

  // ---- the channel ----

  private listen(): void {
    const from = { plants: this.lockstep.firstMissing('plants'), zombies: this.lockstep.firstMissing('zombies') };
    this.unlisten = this.channel.listen(from, (e) => { if (!this.disposed) this.onEvent(e); });
  }

  private onEvent(e: MatchEvent): void {
    switch (e.kind) {
      case 'turn':
        if (e.seat !== this.seat) {
          this.otherLifeAt = this.now();
          this.lockstep.receive(e.seat, e.k, e.raw);
        } else if (!this.written.has(e.k) && !this.lockstep.adoptOwn(e.k, e.raw)) {
          // an own turn the database holds differently from what this screen already ran
          console.warn(`[versus] own turn ${e.k} in the database differs from the one this screen ran`);
          this.ownConflict = true;
        }
        return;
      case 'pause':
        if (!this.seated(e.by) || !Number.isSafeInteger(e.n) || e.n < 0) return;
        // a record heard before the last resume, stored again (a retried write landing after the
        // resume, or a replay): it pauses nobody. Both devices hear the same records in the same
        // order, so both drop the same ones.
        if (this.stalePauses.has(e.n)) return;
        this.heardPauses.add(e.n);
        this.pauseSeq = Math.max(this.pauseSeq, Math.floor(e.n / 4));
        if (pauseWriter(e.n) === this.otherSeat) this.otherLifeAt = this.now();
        if (!isBeat(e.n)) this.setPaused(e.by);
        return;
      case 'resume':
        this.stalePauses = new Set(this.heardPauses);
        this.setPaused(null);
        return;
      case 'end':
        // either seat's slot, the own one too: the other device may have filled it (see concede)
        this.know(e.seat, e.raw);
        return;
      case 'quit':
        // a forfeit is an end record now (FORFEIT_END); a quit record settles nothing, since an
        // outcome from it could contradict the end slots
        return;
      case 'sync':
        if (!this.host && e.n > this.repairCount) this.pendingSync = e;
        return;
      case 'gone':
        // a device deletes only once the slots decide the match (a give-up stored first, or both
        // ends), and the stream delivers in order: a deletion seen first credits nobody
        this.finish({ kind: 'unfinished', why: 'gone' });
        return;
      default:
        return; // ready, again, link: not this layer's business
    }
  }

  private publishDue(): void {
    if (this.disposed) return;
    for (const turn of this.lockstep.takeDue(this.match.state.tick)) {
      this.written.add(turn.k);
      this.outbox.push(turn);
    }
    this.sendOutbox();
  }

  /** One write in flight at a time; turns due meanwhile ride along in the next one (spec 6.2). */
  private sendOutbox(): void {
    if (this.inFlight || this.outbox.length === 0 || this.disposed) return;
    const batch = this.outbox;
    this.outbox = [];
    this.inFlight = true;
    this.retrying(() => this.channel.publishTurns(this.seat, batch), (answer) => {
      this.inFlight = false;
      if (answer === 'refused') {
        console.warn(`[versus] the database refused own turns ${batch.map((b) => b.k).join(', ')}`);
        this.broken();
        return;
      }
      for (const { k } of batch) this.lockstep.acked(k);
      this.sendOutbox();
    });
  }

  private writeRetrying(rec: ControlRecord, keepalive = false, done?: (answer: WriteAnswer) => void, alive?: () => boolean): void {
    this.retrying(() => this.channel.write(rec, keepalive ? { keepalive } : undefined), (answer) => done?.(answer), alive);
  }

  private removeRetrying(): void {
    this.retrying(() => this.channel.remove(), () => {});
  }

  /**
   * Sends until the answer is `ok` or `refused`; `offline` (or a failed call) is sent again, 250 ms
   * doubling to 2 s, while `alive` says so.
   */
  private retrying(send: () => Promise<WriteAnswer>, done: (answer: 'ok' | 'refused') => void, alive: () => boolean = () => true): void {
    const attempt = (waitMs: number) => {
      if (this.disposed || !alive()) return;
      send().catch((): WriteAnswer => 'offline').then((answer) => {
        if (this.disposed) return;
        if (answer === 'offline') this.later(() => attempt(Math.min(waitMs * 2, this.t.retry.maxMs)), waitMs);
        else done(answer);
      });
    };
    attempt(this.t.retry.firstMs);
  }

  private later(fn: () => void, ms: number): unknown {
    const handle: unknown = this.timers.set(() => {
      this.handles.delete(handle);
      if (!this.disposed) fn();
    }, ms);
    this.handles.add(handle);
    return handle;
  }

  private seated(slot: Slot): boolean {
    return slot === this.me || slot === this.otherSlot;
  }

  private writePause(keepalive: boolean): void {
    this.setPaused(this.me);
    const writes = this.pauseWrites;
    this.writeRetrying({ kind: 'pause', by: this.me, n: pauseNumber(++this.pauseSeq, this.seat, false) }, keepalive,
      undefined, () => writes === this.pauseWrites);
  }

  /** Enters, changes or leaves the paused state; heartbeats run while paused and not hidden. */
  private setPaused(by: Slot | null): void {
    if (by === this._pausedBy) return;
    if (by !== null && this._pausedBy === null) this.pausedSince = this.now();
    this._pausedBy = by;
    if (by === null) {
      this.pausedSince = null;
      if (this.heartbeat !== null) {
        this.timers.clear(this.heartbeat);
        this.handles.delete(this.heartbeat);
        this.heartbeat = null;
      }
      this.showStage('none');
    } else {
      this.beat();
    }
    this.changed();
  }

  /** Schedules the next heartbeat: the pause record written again, once (a lost one is simply missed). */
  private beat(): void {
    if (this.heartbeat !== null || this._pausedBy === null || this.isHidden || this.result) return;
    this.heartbeat = this.later(() => {
      this.heartbeat = null;
      const by = this._pausedBy;
      if (by === null || this.isHidden || this.result) return;
      void this.channel.write({ kind: 'pause', by, n: pauseNumber(++this.pauseSeq, this.seat, true) }).catch(() => 'offline');
      this.beat();
    }, this.t.heartbeatMs);
  }

  private pausedSilence(): number {
    if (this.pausedSince === null) return 0;
    const age = this.now() - Math.max(this.pausedSince, this.otherLifeAt);
    return age >= this.t.hereMs ? age : 0;
  }

  /** Paused, and the other device silent for the stall timeouts: the same stages, the same end. */
  private checkPausedSilence(): void {
    const silent = this.pausedSilence();
    this.maxSilent = Math.max(this.maxSilent, silent);
    this.showStage(stallStage(silent, this.t));
    if (silent >= this.t.stall.unfinishedMs) this.concede('silence');
  }

  // ---- hashes and repair (spec 6.5, 6.6) ----

  private compareHashes(): void {
    for (const [tick, hash] of this.lockstep.remoteHashes()) if (tick > this.horizon) this.theirHashes.set(tick, hash);
    if (this.ownConflict && this.host && this.repairing === 'none') {
      this.ownConflict = false;
      this.mismatch(null);
      return;
    }
    if (this.repairing !== 'none') return;
    const newest = this.ring.newest();
    for (const [tick, other] of this.theirHashes) {
      const own = this.ring.get(tick);
      if (own === undefined) {
        // not reached yet: keep; behind the ring (evicted, or skipped by a restore): drop
        if (tick <= this.horizon || (newest && tick <= newest[0])) this.theirHashes.delete(tick);
        continue;
      }
      this.theirHashes.delete(tick);
      if (own !== other) {
        this.mismatch({ tick, own, other });
        return;
      }
    }
  }

  private mismatch(m: { tick: number; own: number; other: number } | string | null): void {
    if (m && typeof m !== 'string') this.lastMismatch = m;
    const hostEnd = this.hostEnd();
    if (hostEnd) {
      // the host's state has ended and is the authority: its end is this screen's end too
      console.warn(`[versus] mismatch after the host's end${this.describe(m)}; taking the host's end`);
      this.claimOwn(hostEnd.raw);
      return;
    }
    if (this.repairCount >= MAX_REPAIRS) {
      console.warn(`[versus] mismatch after ${MAX_REPAIRS} repairs, the match is broken${this.describe(m)}`);
      this.broken();
      return;
    }
    if (!this.host) {
      // the host repairs; this screen goes on stepping and publishing (spec 6.6 step 3: it stops
      // only when it sees the record), so the host gets the hash that shows it the mismatch
      this.repairing = 'awaiting';
      this.changed();
      return;
    }
    const n = (this.repairCount + 1) as 1 | 2 | 3;
    const tick = this.match.state.tick;
    const snap = this.match.snapshot();
    this.repairCount = n;
    console.warn(`[versus] repair s${n} at tick ${tick}${this.describe(m)}`);
    this.restart(tick);
    this.repairing = 'writing';
    this.writeRetrying({ kind: 'sync', n, tick, snap }, false, (answer) => {
      if (answer === 'refused') {
        console.warn(`[versus] the database refused repair s${n}`);
        this.broken();
        return;
      }
      this.repairing = 'none';
      this.changed();
    });
    this.changed();
  }

  private describe(m: { tick: number; own: number; other: number } | string | null): string {
    if (typeof m === 'string') return `: ${m}`;
    return m ? `: hashes at tick ${m.tick} differ: own ${m.own}, other ${m.other}` : ': own turn differs from the database';
  }

  /** The other seat (not the host) takes the host's snapshot and goes on from its tick with the logged turns. */
  private applySync(): void {
    const sync = this.pendingSync!;
    this.pendingSync = null;
    if (sync.n <= this.repairCount) return;
    // once an end slot of this screen is claimed, its state no longer matters: the slots decide
    if (this.ending()) return;
    const was = this.match.state.tick;
    restoreInto(this.match, sync.snap);
    // ticks the host ran that this screen skips: their own taps ran there, so they leave pending()
    for (let t = was; t < sync.tick; t++) this.lockstep.commandsAt(t);
    this.repairCount = sync.n;
    const m = this.lastMismatch;
    console.warn(`[versus] restored from s${sync.n} at tick ${sync.tick} (was at ${was})${m ? `; last mismatch at tick ${m.tick}: own ${m.own}, other ${m.other}` : ''}`);
    this.restart(sync.tick);
    this.repairing = 'none';
    this.changed();
  }

  /**
   * After a repair at tick `s`: the ring starts afresh and hashes up to `s + delay + 6` are not
   * compared, since the other screen may have run (and sent hashes for) that far before it heard
   * of the repair.
   */
  private restart(s: number): void {
    this.ring.clear();
    this.horizon = s + this.delay + TURN_TICKS;
    for (const tick of [...this.theirHashes.keys()]) if (tick <= this.horizon) this.theirHashes.delete(tick);
  }

  // ---- end, stall, outcome ----

  /** This screen steps no more: its own end slot is claimed (by its own write, or filled by the other). */
  private ending(): boolean {
    return this.ownClaim !== null || this.slots[this.seat] !== null;
  }

  /** For the guest: the host's end record, when it is known and names a winner. */
  private hostEnd(): EndSlot | null {
    const s = this.slots[this.otherSeat];
    return !this.host && s?.rec && isWinner(s.rec.w) ? s : null;
  }

  /**
   * Whether a guest that knows the host's end (tick E) takes it as its own instead of stepping on.
   * It does whenever its own state cannot give the same end: it knows its state is wrong (it
   * awaits a snapshot), it has a winner at another tick, or it reached E without one. It also does
   * while paused: the match is over, and a pause must not hold the other device's result. Only a
   * winner of its own at E itself is written as its own record (spec 9 compares the two).
   */
  private takesHostEnd(end: EndSlot, winner: Winner | null, tick: number): boolean {
    const t = end.rec!.t;
    if (typeof t !== 'number' || this.repairing === 'awaiting') return true;
    if (winner !== null) return tick !== t;
    return tick >= t || this._pausedBy !== null;
  }

  /** The state has a winner: a guest that knows the host's end may take that; else its own record. */
  private claimEnd(winner: Winner): void {
    const { tick } = this.match.state;
    const hostEnd = this.hostEnd();
    if (hostEnd && this.takesHostEnd(hostEnd, winner, tick)) this.claimOwn(hostEnd.raw);
    else this.claimOwn(JSON.stringify({ w: winner, t: tick, h: this.match.hash() }));
  }

  /**
   * Writes `raw` into the own end slot, once. The slot is known when the write is answered `ok`;
   * a refused write means the other device filled it first, and its value arrives on the stream.
   * A host that wrote a winner fills the guest's slot with the same record if it is still empty
   * after `endWaitMs` (the host's state is the authority; a guest that comes back takes it too).
   */
  private claimOwn(raw: string): void {
    if (this.ending()) return;
    this.ownClaim = raw;
    this.writeRetrying({ kind: 'end', seat: this.seat, raw }, false, (answer) => {
      if (answer === 'ok') this.know(this.seat, raw);
    });
    const rec = parseEnd(raw);
    if (this.host && rec && isWinner(rec.w)) this.endTimer = this.later(() => this.fill(raw), this.t.endWaitMs);
    this.changed();
  }

  /** Writes `raw` into the other seat's slot if it is still empty (write-once: the first value stays). */
  private fill(raw: string): void {
    if (this.result || this.fillClaim !== null || this.slots[this.otherSeat] !== null) return;
    this.fillClaim = raw;
    this.writeRetrying({ kind: 'end', seat: this.otherSeat, raw }, false, (answer) => {
      if (answer === 'ok') this.know(this.otherSeat, raw);
    });
  }

  /** A seat's slot as the database holds it; the first value is the only one it can hold. */
  private know(seat: Faction, raw: string): void {
    if (this.slots[seat] !== null) return;
    this.slots[seat] = { raw, rec: parseEnd(raw) };
    if (seat !== this.seat || raw !== this.ownClaim) this.otherLifeAt = this.now(); // written by the other device
    this.settleFromSlots();
    this.changed();
  }

  /**
   * A slot that ends the match with no winner, whatever the other slot holds: `broken`, `gone`, an
   * unreadable record, or a forfeit by someone not seated.
   */
  private noWinner(s: EndSlot | null): boolean {
    if (s === null) return false;
    if (isForfeit(s)) return typeof s.rec!.by !== 'string' || !this.seated(s.rec!.by as Slot);
    return s.rec === null || !isWinner(s.rec.w);
  }

  /**
   * The outcome from the two slots (spec 9), the same on both devices since both read the same
   * write-once values: a slot with no winner ends the match unfinished whatever the other holds;
   * two winners give `won` when they agree, else `disagree` with the host's shown.
   */
  private settleFromSlots(): void {
    if (this.result) return;
    const mine = this.slots[this.seat];
    const theirs = this.slots[this.otherSeat];
    if (this.noWinner(mine) || this.noWinner(theirs)) {
      const gone = [mine, theirs].some((s) => s?.rec?.w === GONE_END);
      this.finish({ kind: 'unfinished', why: this.conceding ?? (gone ? 'gone' : 'broken') });
      if (this.conceding === 'flag') this.removeRetrying(); // the white flag deletes the match (spec 6.7)
      return;
    }
    if (mine === null || theirs === null) return;
    // a forfeit decides once both slots are known (a slot with no winner, above, comes first); if
    // both hold one, the plants slot's: the same on both screens
    const quit = [this.slots.plants!, this.slots.zombies!].find(isForfeit);
    if (quit) {
      const by = quit.rec!.by as Slot;
      const loser = by === this.me ? this.seat : this.otherSeat;
      this.finish({ kind: 'forfeit', winner: loser === 'plants' ? 'zombies' : 'plants', by });
      return;
    }
    const own = mine.rec!;
    const other = theirs.rec!;
    const ownW = own.w as Winner;
    const otherW = other.w as Winner;
    if (ownW === otherW) {
      if (own.t !== other.t || own.h !== other.h) {
        console.warn(`[versus] the end records name the same winner but differ: own tick ${String(own.t)} hash ${String(own.h)}, other tick ${String(other.t)} hash ${String(other.h)}`);
      }
      this.finish({ kind: 'won', winner: ownW });
      return;
    }
    console.warn(`[versus] the end records disagree: own ${ownW}, other ${otherW}`);
    this.finish({ kind: 'disagree', shown: this.host ? ownW : otherW });
  }

  /**
   * This device gives up (ten minutes of silence, the white flag, a broken match) and nobody may
   * win. Settling at once could contradict the other device, which may be completing the end at
   * this moment; so the give-up is a write into an empty slot, and the slots decide:
   * - own slot empty: write `broken` (or `gone` for the flag) into it. A guest that knows the host's
   *   end takes that instead (the host's end stands).
   * - own slot claimed with a winner: write into the other's empty slot (the host: its own record,
   *   which the guest would take anyway; the guest: `broken`).
   * A refused write means that slot was filled first, and its value decides when it arrives.
   */
  private concede(why: 'broken' | 'flag' | 'silence'): void {
    if (this.result || this.conceding !== null) return;
    this.conceding = why;
    const hostEnd = this.hostEnd();
    const { tick } = this.match.state;
    const marker = () => JSON.stringify({ w: why === 'flag' ? GONE_END : BROKEN_END, t: tick, h: this.match.hash() });
    if (!this.ending()) {
      this.claimOwn(hostEnd ? hostEnd.raw : marker());
    } else if (this.slots[this.otherSeat] === null) {
      const own = this.ownClaim === null ? null : parseEnd(this.ownClaim);
      this.fill(this.host && own && isWinner(own.w) ? this.ownClaim! : marker());
    }
    this.settleFromSlots();
    this.changed();
  }

  /** The match is broken (spec 6.6 step 5): nobody wins, and the other device goes home too. */
  private broken(): void {
    if (this.result) return;
    if (this.ending()) {
      // the own slot is already claimed: the slots decide, a break changes nothing
      console.warn('[versus] broken after this screen claimed its end: the end records decide');
      return;
    }
    this.concede('broken');
  }

  /**
   * The host passed the tick named in the guest's end record with no winner of its own: the two
   * states differ there.
   */
  private guestEndPassed(tick: number): boolean {
    const s = this.slots[this.otherSeat];
    if (s === null || isForfeit(s)) return false; // a forfeit names no tick to reach
    const t = s.rec?.t;
    return typeof t !== 'number' || tick >= t;
  }

  /**
   * The guest awaits the host's snapshot and its drifted state has a winner: it waits (counted
   * towards the stall stages) for the snapshot, the host's end or the other's give-up. The hash
   * that shows the host the mismatch may still wait for a turn to ride on, and no turn is taken
   * while the tick stands still: one more turn goes out.
   */
  private parked(): StepAnswer {
    this.takeOneAhead();
    this.waitOnOther();
    return this.result ? { kind: 'over' } : { kind: 'wait', why: 'repair' };
  }

  /** The own slot is claimed: waits for the slots to decide, counted like any other wait. */
  private waitForEnd(): StepAnswer {
    if (!this.result) {
      if (this._pausedBy !== null) {
        this.endWait();
        this.checkPausedSilence();
      } else {
        this.waitOnOther();
      }
    }
    return { kind: 'over' };
  }

  private waitOnOther(): void {
    const now = this.now();
    if (this.waitingSince === null) this.waitingSince = now;
    const silent = now - this.waitingSince;
    this.showStage(stallStage(silent, this.t));
    if (silent >= this.t.stall.unfinishedMs) this.concede('silence');
  }

  private showStage(stage: StallStage): void {
    if (stage === this.shownStage) return;
    this.shownStage = stage;
    this.changed();
  }

  /**
   * Publishes the turns due and one turn more, so a hash still waiting for a turn goes out even
   * though the tick stands still. Taking it again at the same tick takes nothing.
   */
  private takeOneAhead(): void {
    this.publishDue();
    for (const turn of this.lockstep.takeDue(this.match.state.tick + TURN_TICKS)) {
      this.written.add(turn.k);
      this.outbox.push(turn);
    }
    this.sendOutbox();
  }

  private stopWaiting(): void {
    this.endWait();
    this.showStage('none');
  }

  /** Books a finished wait into the stats. */
  private endWait(): void {
    if (this.waitingSince !== null) {
      const silent = this.now() - this.waitingSince;
      this.stalledTotal += silent;
      this.maxSilent = Math.max(this.maxSilent, silent);
      this.waitingSince = null;
    }
  }

  private finish(outcome: VersusOutcome): void {
    if (this.result) return;
    this.stopWaiting();
    this.maxSilent = Math.max(this.maxSilent, this.pausedSilence());
    this.result = outcome;
    if (this.endTimer !== null) {
      this.timers.clear(this.endTimer);
      this.handles.delete(this.endTimer);
      this.endTimer = null;
    }
    this.changed();
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
