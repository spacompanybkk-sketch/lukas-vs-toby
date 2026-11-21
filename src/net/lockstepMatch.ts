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
 * The `w` of an end record from a device whose match broke (a mismatch after three repairs, or a
 * write the database refused): no winner, and the other device goes home too (spec 6.6 step 5).
 */
export const BROKEN_END = 'broken';

interface EndRecord { w: Winner | typeof BROKEN_END; t: unknown; h: unknown }

/** An end record (`{"w":…,"t":…,"h":…}`), or null when it names no winner and is not broken. */
function parseEnd(raw: string): EndRecord | null {
  try {
    const o = JSON.parse(raw) as Partial<EndRecord> | null;
    return o && (isWinner(o.w) || o.w === BROKEN_END) ? { w: o.w, t: o.t, h: o.h } : null;
  } catch {
    return null;
  }
}

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
  private ownWinner: Winner | null = null;
  private ownEndRecord: EndRecord | null = null;
  private otherEnd: EndRecord | null = null;
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
    if (this.result || this.match.state.winner !== null) return 'full';
    const tap = this.lockstep.submit(cmd, this.match.state.tick);
    if (tap !== 'full') this.changed();
    return tap;
  }

  /** Runs one tick if it may: both turns held, not paused, not writing a repair, not over. */
  tryStep(): StepAnswer {
    if (this.result) return { kind: 'over' };
    if (this.pendingSync) this.applySync();
    if (this.match.state.winner !== null) return { kind: 'over' };
    this.compareHashes();
    if (this.result) return { kind: 'over' };
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
    if (state.winner !== null) this.ownEnd(state.winner);
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
   * How long the other seat has been silent: while stepping waits (on turns or a repair write), the
   * time waited; while paused, the time since the other device last showed it is there, once that
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
    this.setPaused(null);
    this.writeRetrying({ kind: 'resume' });
  }

  /** The white flag in the pause menu: a forfeit, the other seat wins (spec 6.7). */
  forfeit(): void {
    if (this.result) return;
    this.writeRetrying({ kind: 'quit', by: this.me });
    this.finish({ kind: 'forfeit', winner: this.otherSeat, by: this.me });
  }

  /** The white flag while waiting on a silent seat: the match is deleted and nobody wins. */
  giveUp(): void {
    if (this.result) return;
    this.finish({ kind: 'unfinished', why: 'flag' });
    this.removeRetrying();
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
        this.pauseSeq = Math.max(this.pauseSeq, Math.floor(e.n / 4));
        if (pauseWriter(e.n) === this.otherSeat) this.otherLifeAt = this.now();
        if (!isBeat(e.n)) this.setPaused(e.by);
        return;
      case 'resume':
        this.setPaused(null);
        return;
      case 'end': {
        if (e.seat === this.seat) return;
        const rec = parseEnd(e.raw);
        if (rec?.w === BROKEN_END) {
          this.finish({ kind: 'unfinished', why: 'broken' });
          return;
        }
        this.otherEnd = rec;
        if (this.ownWinner !== null && this.otherEnd !== null) this.resolveEnd();
        return;
      }
      case 'quit': {
        if (!this.seated(e.by)) return;
        const winner = e.by === this.me ? this.otherSeat : this.seat;
        this.finish({ kind: 'forfeit', winner, by: e.by });
        return;
      }
      case 'sync':
        if (!this.host && e.n > this.repairCount) this.pendingSync = e;
        return;
      case 'gone':
        if (this.ownWinner !== null) this.finish({ kind: 'won', winner: this.ownWinner });
        else this.finish({ kind: 'unfinished', why: 'gone' });
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

  private writeRetrying(rec: ControlRecord, keepalive = false, done?: (answer: WriteAnswer) => void): void {
    this.retrying(() => this.channel.write(rec, keepalive ? { keepalive } : undefined), (answer) => done?.(answer));
  }

  private removeRetrying(): void {
    this.retrying(() => this.channel.remove(), () => {});
  }

  /** Sends until the answer is `ok` or `refused`; `offline` (or a failed call) is sent again, 250 ms doubling to 2 s. */
  private retrying(send: () => Promise<WriteAnswer>, done: (answer: 'ok' | 'refused') => void): void {
    const attempt = (waitMs: number) => {
      if (this.disposed) return;
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
    this.writeRetrying({ kind: 'pause', by: this.me, n: pauseNumber(++this.pauseSeq, this.seat, false) }, keepalive);
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
    if (silent >= this.t.stall.unfinishedMs) this.finish({ kind: 'unfinished', why: 'silence' });
    else this.showStage(stallStage(silent, this.t));
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

  private mismatch(m: { tick: number; own: number; other: number } | null): void {
    if (m) this.lastMismatch = m;
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

  private describe(m: { tick: number; own: number; other: number } | null): string {
    return m ? `: hashes at tick ${m.tick} differ: own ${m.own}, other ${m.other}` : ': own turn differs from the database';
  }

  /** The other seat (not the host) takes the host's snapshot and goes on from its tick with the logged turns. */
  private applySync(): void {
    const sync = this.pendingSync!;
    this.pendingSync = null;
    if (sync.n <= this.repairCount) return;
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

  private ownEnd(winner: Winner): void {
    if (this.ownWinner !== null) return;
    this.ownWinner = winner;
    const { state } = this.match;
    this.ownEndRecord = { w: winner, t: state.tick, h: this.match.hash() };
    this.writeRetrying({ kind: 'end', seat: this.seat, raw: JSON.stringify(this.ownEndRecord) });
    if (this.otherEnd !== null) {
      this.resolveEnd();
    } else {
      this.endTimer = this.later(() => this.finish({ kind: 'won', winner }), this.t.endWaitMs);
    }
  }

  /** Both end records are in (spec 9): the same winner is the result; different winners show the host's. */
  private resolveEnd(): void {
    const own = this.ownEndRecord!;
    const theirs = this.otherEnd!;
    const other = theirs.w as Winner; // a broken end never gets here
    if (own.w === other) {
      if (own.t !== theirs.t || own.h !== theirs.h) {
        console.warn(`[versus] the end records name the same winner but differ: own tick ${String(own.t)} hash ${String(own.h)}, other tick ${String(theirs.t)} hash ${String(theirs.h)}`);
      }
      this.finish({ kind: 'won', winner: own.w as Winner });
      return;
    }
    const ownW = own.w as Winner;
    console.warn(`[versus] the end records disagree: own ${ownW}, other ${other}`);
    this.finish({ kind: 'disagree', shown: this.host ? ownW : other });
  }

  private waitOnOther(): void {
    const now = this.now();
    if (this.waitingSince === null) this.waitingSince = now;
    const silent = now - this.waitingSince;
    if (silent >= this.t.stall.unfinishedMs) {
      this.finish({ kind: 'unfinished', why: 'silence' });
      return;
    }
    this.showStage(stallStage(silent, this.t));
  }

  private showStage(stage: StallStage): void {
    if (stage === this.shownStage) return;
    this.shownStage = stage;
    this.changed();
  }

  /**
   * This match is broken (spec 6.6 step 5). The other device must go home too, not sit through
   * the stall stages: the turns due go out, plus one more so a hash still waiting rides along (the
   * other may then see the mismatch itself), and the end record names no winner but `broken`.
   */
  private broken(): void {
    if (this.result) return;
    this.publishDue();
    for (const turn of this.lockstep.takeDue(this.match.state.tick + TURN_TICKS)) {
      this.written.add(turn.k);
      this.outbox.push(turn);
    }
    this.sendOutbox();
    const { state } = this.match;
    const rec: EndRecord = { w: BROKEN_END, t: state.tick, h: this.match.hash() };
    if (this.ownWinner === null) this.writeRetrying({ kind: 'end', seat: this.seat, raw: JSON.stringify(rec) });
    this.finish({ kind: 'unfinished', why: 'broken' });
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
