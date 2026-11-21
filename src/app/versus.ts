import { batch, computed, effect, signal, untracked } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { defaultHeadStart, rematchSetup, versusConfig } from '../ai/versus';
import type { VersusSetup } from '../ai/versus';
import { factionOf } from '../data/units';
import type { Connection } from '../cloud/connection';
import type { BoardRow } from '../cloud/types';
import { matchId, newKeyPair, sharedSecret } from '../cloud/versusKeys';
import type { KeyPair } from '../cloud/versusKeys';
import { VersusLobby } from '../cloud/versusLobby';
import type { HereEntry, Invite, MatchMeta, Reply } from '../cloud/versusLobby';
import { CloudMatchChannel, readMatch } from '../cloud/versusMatch';
import type { StoredMatch } from '../cloud/versusMatch';
import type { MatchChannel, MatchEvent, Timers, WriteAnswer } from '../net/channel';
import { Lockstep } from '../net/lockstep';
import { LockstepMatch } from '../net/lockstepMatch';
import type { VersusOutcome } from '../net/lockstepMatch';
import { REPLAY_SLICE_TICKS, replaySlice } from '../net/replay';
import { VS_TIMEOUTS, inputDelay } from '../net/timeouts';
import type { VersusTimeouts } from '../net/timeouts';
import { MAX_TURN, TURN_TICKS } from '../net/turnCodec';
import { isSlot } from '../progress/save';
import type { Save, Slot } from '../progress/save';
import { applyBattleResult, versusBattleId } from '../progress/rewards';
import { Match } from '../sim/match';
import type { Faction } from '../sim/types';
import type { FaceVM, HereVM, IncomingVM, InviteCardState, InviteDraftVM } from '../ui/versus/types';
import { HEAD_MAX, otherSide } from '../ui/versus/types';
import type { NoticeKind } from '../ui/versus/VersusNotice';
import type { VersusResultVM } from '../ui/versus/VersusResult';
import type { BattleOptions } from './BattleController';
import { board, rankChange } from './board';
import type { RankUp } from './board';
import { buildId } from './buildId';
import type { PlayerSession } from './session';
import { BOYS } from './session';
import { reloadForUnreadableSave } from './staleBuild';
import { versusCredit } from './versusCredit';

/**
 * The whole two-device Versus journey as one app model (spec 4, 5, 6.7, 6.8, 7.3, 9, 12): who is
 * here, the invite card, an invite arriving, getting ready, the battle, the credit, the result and
 * the rematch, and coming back after a reload. It owns the lobby, the match channel and the
 * lockstep link; the screens (Task 15) only read the signals and call the methods.
 *
 * Streams: the lobby holds two while the player is on a menu; they close the moment a match opens
 * (getting ready, the battle and the result's rematch watch hold two), so no device ever has more
 * than three. All time comes from the injected `now` and `timers`.
 */

/** The device key of the match to come back to: `{ id, n, seat, me, other, host }` (spec 6.7). */
export const VMATCH_KEY = 'lvt2_vmatch';
/** The device key of the matches already credited on this device (a short list of match ids). */
export const VCREDITED_KEY = 'lvt2_vcredited';

/** A rejoin replay that has not finished by now gives up: the device goes home. */
export const REJOIN_REPLAY_MAX_MS = 60_000;
/** How long a refusing cross, and the shaking expired card, stay on screen. */
export const REFUSED_SHOWN_MS = 2000;
export const EXPIRED_SHOWN_MS = 1000;
/** The seats' turns the result's rematch watch must never ask for (the very last turn index: none is ever held there). */
const NO_TURNS = MAX_TURN;
const KEPT_CREDITS = 8;

export type VersusPhase =
  | { name: 'closed' }
  | { name: 'here' }
  | { name: 'card'; draft: InviteDraftVM; state: InviteCardState }
  | { name: 'ready'; me: FaceVM; them: FaceVM; mySide: Faction; blocks: { connected: boolean; bothReady: boolean; sameBuild: boolean } }
  | { name: 'battle'; options: BattleOptions }
  | { name: 'result'; vm: VersusResultVM }
  | { name: 'notice'; kind: NoticeKind };

export interface VersusFlowDeps {
  conn: () => Promise<Connection>;
  session: PlayerSession;
  now?: () => number;
  timers?: Timers;
  timeouts?: VersusTimeouts;
  build?: string;
  /** Test matches (v2test only): both bases' health. */
  testBaseHp?: number | null;
  /** Reloads the page for a newer build (default `location.reload`). */
  reload?: () => void;
  /** The browser session's storage for the once-only reload flag (default `sessionStorage`). */
  flag?: Storage;
}

interface VMatchKey { id: string; n: number; seat: Faction; me: Slot; other: Slot; host: boolean }

type Rematch = VersusResultVM['rematch'];
type Agains = { plants?: 0 | 1; zombies?: 0 | 1 };

/** The invite this device has out (the card). */
interface Out {
  to: Slot; mySide: Faction; head: { slot: Slot; step: number } | null; headTouched: boolean;
  state: 'draft' | 'waiting' | 'matching' | 'refused' | 'expired';
  keys: KeyPair | null;
  /** Answers already there when it was sent (left by an earlier invite): not answers to this one. */
  stale: ReadonlySet<string>;
  timer: unknown;
}

/** One match this device is in, from getting ready to the result. */
interface Ctx {
  id: string; n: number; seat: Faction; me: Slot; other: Slot; host: boolean;
  meta: MatchMeta;
  /** The ECDH secret (rematches derive their ids from it); null after a rejoin: no rematch then. */
  secret: string | null;
  /** The original invitee: writes every `meta` of the pair. */
  writer: boolean;
  rejoined: boolean;
  channel: CloudMatchChannel;
  alive: boolean;
  unlisten: (() => void) | null;
  link: LockstepMatch | null;
  linkStarted: boolean;
  resumeOnStart: boolean;
  /** Rejoined a match that had ended: the link only listens for the outcome. */
  endedRejoin: boolean;
  timer: unknown;
  readySeen: { plants: boolean; zombies: boolean };
  connected: boolean;
  outcome: VersusOutcome | null;
  resultAt: number | null;
  again: Agains;
  rematchState: Rematch;
  rematchTimer: unknown;
  rematching: boolean;
  rows: BoardRow[];
  rankUp: RankUp | null;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const other = otherSide;
const ID_RE = /^[0-9a-f]{32}$/;
const replyKey = (r: Reply): string => `${r.from}|${r.at}|${String(r.ok)}|${r.pub ?? ''}|${r.build}`;
const inviteKey = (i: Invite): string => `${i.from}|${i.at}|${i.pub}`;

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** The 90th percentile of the heartbeat round trips, or null when none was measured. */
function p90(trips: readonly number[]): number | null {
  if (trips.length === 0) return null;
  const sorted = [...trips].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)]!;
}

const setupOf = (m: MatchMeta): VersusSetup => ({
  seed: m.seed, seats: { ...m.seats }, head: m.head === null ? null : { ...m.head },
  ...(m.test !== null ? { testBaseHp: m.test } : {}),
});

/** Who wrote a pause record (`n = 4·seq + 2·(zombies) + beat`, see LockstepMatch). */
const pauseWriter = (n: number): Faction => (Math.floor(n / 2) % 2 === 1 ? 'zombies' : 'plants');

function parseKey(raw: string | null): VMatchKey | null {
  if (raw === null) return null;
  try {
    const o = JSON.parse(raw) as Partial<VMatchKey> | null;
    if (!o || typeof o.id !== 'string' || !ID_RE.test(o.id) || !Number.isSafeInteger(o.n) || o.n! < 0) return null;
    if (o.seat !== 'plants' && o.seat !== 'zombies') return null;
    if (typeof o.me !== 'string' || !isSlot(o.me) || typeof o.other !== 'string' || !isSlot(o.other) || typeof o.host !== 'boolean') return null;
    return { id: o.id, n: o.n!, seat: o.seat, me: o.me, other: o.other, host: o.host };
  } catch {
    return null;
  }
}

const bothEnded = (s: StoredMatch): boolean => {
  const ends = new Set(s.control.filter((c) => c.kind === 'end').map((c) => (c as { seat: Faction }).seat));
  return ends.has('plants') && ends.has('zombies');
};

export class VersusFlow {
  private readonly _phase = signal<VersusPhase>({ name: 'closed' });
  readonly phase: ReadonlySignal<VersusPhase> = this._phase;

  private readonly lobbySig = signal<VersusLobby | null>(null);
  private readonly lobbyOn = signal(false);
  private readonly allowedSet = signal<ReadonlySet<Slot> | null>(null);
  private readonly menuSig = signal(false);
  private readonly facesRev = signal(0);
  private readonly rejoinable = signal(false);
  private readonly outSig = signal<Out | null>(null);
  /** Bumped whenever the invite out changes in place (its state), so what depends on it runs again. */
  private readonly outRev = signal(0);
  private readonly faceTried = new Set<Slot>();
  private readonly dismissed = signal<ReadonlySet<string>>(new Set());
  private readonly meSlot: ReadonlySignal<Slot | null>;

  readonly here: ReadonlySignal<HereVM[]>;
  readonly incoming: ReadonlySignal<IncomingVM | null>;
  readonly allowed: ReadonlySignal<boolean>;
  readonly canRejoin: ReadonlySignal<boolean>;
  private readonly invite: ReadonlySignal<Invite | null>;

  private readonly session: PlayerSession;
  private readonly connFn: () => Promise<Connection>;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly t: VersusTimeouts;
  private readonly build: string;
  private readonly testHp: number | null;
  private readonly reloadPage: () => void;
  private readonly flag: Storage | undefined;

  private epoch = 0;
  private conn: Connection | null = null;
  private lobby: VersusLobby | null = null;
  private lastBusy = false;
  private faces = new Map<Slot, FaceVM>();
  private loadingFaces = false;
  private keysFor = new Map<Slot, KeyPair>();
  private ctx: Ctx | null = null;
  private pendingKey: VMatchKey | null = null;
  private accepting = false;
  private noticeBack: 'here' | 'closed' = 'closed';
  private heartbeat: unknown = null;
  private readonly handles = new Set<unknown>();
  private readonly stops: (() => void)[] = [];
  private disposed = false;

  constructor(d: VersusFlowDeps) {
    this.session = d.session;
    this.connFn = d.conn;
    this.now = d.now ?? (() => Date.now());
    this.timers = d.timers ?? realTimers;
    this.t = d.timeouts ?? VS_TIMEOUTS;
    this.build = d.build ?? buildId();
    this.testHp = d.testBaseHp ?? null;
    this.reloadPage = d.reload ?? (() => { if (typeof location !== 'undefined') location.reload(); });
    this.flag = d.flag ?? (() => { try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage; } catch { return undefined; } })();

    const s = this.session;
    this.meSlot = computed(() => s.player.value?.slot ?? null);
    this.allowed = computed(() => {
      const me = this.meSlot.value;
      const set = this.allowedSet.value;
      return me !== null && set !== null && set.has(me);
    });
    this.canRejoin = computed(() => this.rejoinable.value && this.meSlot.value !== null);
    this.here = computed(() => {
      if (!this.allowed.value || !this.lobbyOn.value) return [];
      const entries: HereEntry[] = this.lobbySig.value?.here.value ?? [];
      const ok = this.allowedSet.value;
      return entries.filter((e) => ok?.has(e.slot) === true).map((e) => ({ ...this.face(e.slot), busy: e.busy }));
    });
    // The invite that would show: not one already answered here, and not (crossed invites) the one
    // from the player I have my own invite out to when my slot sorts before his: mine stands.
    this.invite = computed(() => {
      const me = this.meSlot.value;
      if (me === null || !this.menuSig.value || !this.allowed.value) return null;
      const ph = this._phase.value.name;
      if (ph === 'ready' || ph === 'battle' || ph === 'result' || ph === 'notice') return null;
      const out = this.outSig.value;
      void this.outRev.value;
      const inbox: Invite[] = this.lobbySig.value?.inbox.value ?? [];
      const gone = this.dismissed.value;
      return inbox.find((i) => !gone.has(inviteKey(i)) && !(out !== null && out.to === i.from && me < i.from)) ?? null;
    });
    this.incoming = computed(() => {
      const inv = this.invite.value;
      const mine = s.player.value;
      if (inv === null || mine === null) return null;
      return { from: this.face(inv.from), me: { slot: mine.slot, name: mine.name, picture: mine.picture }, mySide: other(inv.side), head: inv.head };
    });

    // A log-in or log-out starts everything afresh; only the slot counts (not each save).
    this.stops.push(effect(() => {
      const slot = this.meSlot.value;
      untracked(() => this.onSlot(slot));
    }));
    // Crossed invites: the answer to an invite out, and an invite from the one I have invited.
    this.stops.push(effect(() => {
      const reps: Reply[] = this.lobbySig.value?.replies.value ?? [];
      const inbox: Invite[] = this.lobbySig.value?.inbox.value ?? [];
      const out = this.outSig.value;
      void this.outRev.value;
      untracked(() => {
        this.crossed(out, inbox);
        this.onReplies(out, reps);
      });
    }));
    this.stops.push(effect(() => {
      const want = this.here.value.filter((h) => !this.faces.has(h.slot) && !this.faceTried.has(h.slot));
      if (want.length > 0) untracked(() => { for (const h of want) this.faceTried.add(h.slot); void this.loadFaces(this.epoch); });
    }));
  }

  // ---- the page's side ----

  /** The App says whether the player is on a menu screen (Home, Play, the map, Marketplace, Almanac, Leaderboard). */
  onMenu(on: boolean): void {
    if (this.menuSig.peek() === on) return;
    this.menuSig.value = on;
    if (on && this.allowedSet.peek() === null) void this.refreshAllowed(this.epoch);
    this.syncLobby();
  }

  /** Opens "who is here". */
  open(): void {
    if (!this.allowed.peek() || this.ctx !== null) return;
    if (this._phase.peek().name === 'closed') this._phase.value = { name: 'here' };
  }

  pick(slot: Slot): void {
    const me = this.meSlot.peek();
    const mine = this.session.player.peek();
    if (me === null || mine === null || this._phase.peek().name !== 'here' || slot === me) return;
    const entry = this.here.peek().find((h) => h.slot === slot);
    if (entry === undefined || entry.busy) return;
    const mySide = factionOf(mine.picture);
    const seats = { [mySide]: me, [other(mySide)]: slot } as Record<Faction, Slot>;
    this.outSig.value = { to: slot, mySide, head: defaultHeadStart(seats), headTouched: false, state: 'draft', keys: null, stale: new Set(), timer: null };
    this.showCard();
  }

  /** Changes sides; the head start follows its boy, and its size follows the side only while untouched. */
  swap(): void {
    const o = this.outSig.peek();
    const me = this.meSlot.peek();
    if (o === null || me === null || o.state !== 'draft') return;
    o.mySide = other(o.mySide);
    if (!o.headTouched) {
      const seats = { [o.mySide]: me, [other(o.mySide)]: o.to } as Record<Faction, Slot>;
      o.head = defaultHeadStart(seats);
    }
    this.showCard();
  }

  /** Sets the head start to `step` (0..5). */
  head(step: number): void {
    const o = this.outSig.peek();
    if (o === null || o.state !== 'draft' || o.head === null || !Number.isInteger(step) || step < 0 || step > HEAD_MAX) return;
    o.head = { slot: o.head.slot, step };
    o.headTouched = true;
    this.showCard();
  }

  send(): void {
    const o = this.outSig.peek();
    const lobby = this.lobby;
    if (o === null || lobby === null || o.state !== 'draft') return;
    o.state = 'waiting';
    o.stale = new Set(lobby.replies.peek().filter((r) => r.from === o.to).map(replyKey));
    this.showCard();
    o.timer = this.after(this.t.inviteMs, () => this.expire(o));
    void (async () => {
      const keys = this.keysFor.get(o.to) ?? await newKeyPair();
      this.keysFor.set(o.to, keys);
      o.keys = keys;
      if (this.outSig.peek() !== o) return;
      // A stale answer from an earlier invite must not answer this one; the queue keeps the order.
      void lobby.clearReply(o.to);
      const a = await lobby.invite(o.to, keys, o.mySide, o.head === null ? null : { slot: o.head.slot, step: o.head.step as 0 | 1 | 2 | 3 | 4 | 5 });
      if (this.outSig.peek() !== o || o.state !== 'waiting') return;
      if (a !== 'ok') {
        this.clear(o.timer);
        o.state = 'draft';
        this.showCard();
      }
    })();
  }

  /** The cross on the card: cancels an invite out and goes back to the list. */
  closeCard(): void {
    const o = this.outSig.peek();
    if (o === null) return;
    this.dropOut(o, true);
    if (this.ctx === null) this._phase.value = { name: 'here' };
  }

  accept(): void {
    const inv = this.invite.peek();
    const lobby = this.lobby;
    const me = this.meSlot.peek();
    if (inv === null || lobby === null || me === null || this.accepting) return;
    this.accepting = true;
    void (async () => {
      try {
        if (inv.build !== this.build) {
          // Not the same game version: nobody plays, and the sender's card says so (the reply carries my build).
          this.dismiss(inv);
          await lobby.decline(inv.from);
          this.notice('update', 'here');
          return;
        }
        const out = this.outSig.peek();
        if (out !== null) this.dropOut(out, true);
        const keys = await newKeyPair();
        const secret = await sharedSecret(keys, inv.pub);
        const id = await matchId(secret, 0);
        const mySide = other(inv.side);
        const meta: MatchMeta = {
          v: 1, build: this.build, seed: randomSeed(),
          seats: { [inv.side]: inv.from, [mySide]: me } as Record<Faction, Slot>,
          host: me, head: inv.head, turn: 6, delay: inputDelay(p90(lobby.roundTrips())), test: this.testHp, created: 0,
        };
        const a = await lobby.accept(inv, keys, meta, id);
        if (a === 'ok') {
          this.dismiss(inv);
          this.enterMatch({ meta, id, n: 0, secret, writer: true });
        } else if (a === 'taken') {
          this.dismiss(inv); // another device of mine answered first, or the sender took it back
        }
      } finally {
        this.accepting = false;
      }
    })();
  }

  decline(): void {
    const inv = this.invite.peek();
    if (inv === null || this.lobby === null) return;
    this.dismiss(inv);
    void this.lobby.decline(inv.from);
  }

  // ---- the battle and after ----

  /** The battle screen is up: the link starts listening and publishing. */
  battleBegan(): void {
    const ctx = this.ctx;
    if (ctx === null || ctx.link === null || ctx.linkStarted || this._phase.peek().name !== 'battle') return;
    ctx.linkStarted = true;
    ctx.link.start();
    if (ctx.resumeOnStart) ctx.link.resume(); // a pause of mine from before the reload must not hold the other device
  }

  /** The controller's `online.outcome`: credit once, then the result (or a notice for an unfinished match). */
  battleOutcome(o: VersusOutcome): void {
    const ctx = this.ctx;
    if (ctx === null || ctx.outcome !== null || (this._phase.peek().name !== 'battle' && !ctx.endedRejoin)) return;
    ctx.outcome = o;
    ctx.resultAt = this.now();
    ctx.link?.dispose();
    this.clear(this.heartbeat);
    this.heartbeat = null;
    this.forgetKey();
    // A rejoined match has no rematch to wait for: it goes once the other device has surely settled.
    if (ctx.rejoined) this.scheduleRemoval(ctx.channel, ctx.resultAt + this.t.endWaitMs);
    const before = this.session.player.peek();
    this.credit(ctx, o);
    if (o.kind === 'unfinished') {
      // Nobody is credited. The match goes once the other device has surely settled too.
      this.scheduleRemoval(ctx.channel, ctx.resultAt + this.t.endWaitMs);
      this.notice(o.why === 'broken' ? 'broken' : 'gone', 'closed');
      return;
    }
    ctx.rows = board.cached() ?? [];
    ctx.rematchState = ctx.secret === null ? 'none' : 'offer';
    this.showResult(ctx);
    if (ctx.secret !== null) this.watchAgain(ctx);
    void (async () => {
      await this.session.flush().catch(() => undefined);
      const view = await board.fetch().catch(() => null);
      if (view === null || this.ctx !== ctx) return;
      ctx.rows = view.rows;
      const after = this.session.player.peek();
      ctx.rankUp = before !== null && after !== null && versusCredit(o, ctx.seat, ctx.me) !== null ? rankChange(view.rows, before, after) : null;
      this.showResult(ctx);
    })();
  }

  rematch(): void {
    const ctx = this.ctx;
    if (ctx === null || this._phase.peek().name !== 'result' || ctx.secret === null || ctx.rematching) return;
    if (ctx.rematchState === 'gone' || ctx.rematchState === 'none' || ctx.again[ctx.seat] !== undefined) return;
    ctx.again[ctx.seat] = 1;
    this.afterAgain(ctx);
    void this.retry(ctx, () => ctx.channel.write({ kind: 'again', seat: ctx.seat, value: 1 }));
  }

  /** The home button: of the result, a notice, or the list and its card. */
  home(): void {
    const ph = this._phase.peek();
    const ctx = this.ctx;
    if (ph.name === 'result' && ctx !== null) {
      if (!ctx.rematching && ctx.again[ctx.seat] === undefined && ctx.secret !== null) {
        ctx.again[ctx.seat] = 0;
        // Written even though this screen goes: the other's rematch button greys and shows the door.
        void this.retry(ctx, () => ctx.channel.write({ kind: 'again', seat: ctx.seat, value: 0 }), true);
      }
      this.checkRemoval(ctx);
      this.leaveMatch();
      this._phase.value = { name: 'closed' };
    } else if (ph.name === 'ready' && ctx !== null) {
      // The way out of getting ready, and of a rejoin replay that hangs.
      if (ctx.rejoined) this.forgetKey();
      else void ctx.channel.remove();
      this.leaveMatch();
      this._phase.value = { name: 'closed' };
    } else if (ph.name === 'notice') {
      this._phase.value = this.noticeBack === 'here' && this.allowed.peek() ? { name: 'here' } : { name: 'closed' };
    } else if (ph.name === 'card' || ph.name === 'here') {
      const o = this.outSig.peek();
      if (o !== null) this.dropOut(o, true);
      this._phase.value = { name: 'closed' };
    }
    this.syncLobby();
  }

  /** Back to the battle after a reload (the title's "back to the battle" button). */
  rejoin(): void {
    const key = this.pendingKey;
    if (key === null || !this.rejoinable.peek() || this.ctx !== null) return;
    this.rejoinable.value = false;
    void this.doRejoin(key, this.epoch);
  }

  dispose(): void {
    this.disposed = true;
    this.epoch++;
    for (const stop of this.stops.splice(0)) stop();
    this.leaveMatch();
    const o = this.outSig.peek();
    if (o !== null) this.clear(o.timer);
    this.lobby?.stop();
    for (const h of this.handles) this.timers.clear(h);
    this.handles.clear();
  }

  // ---- log-in, the lobby, faces ----

  private onSlot(slot: Slot | null): void {
    this.epoch++;
    const ep = this.epoch;
    // Logging out (or in as someone else) leaves a match as a reload would: the key stays for rejoin.
    this.leaveMatch();
    const o = this.outSig.peek();
    if (o !== null) this.clear(o.timer);
    this.lobby?.stop();
    batch(() => {
      this.outSig.value = null;
      this.lobbySig.value = null;
      this.lobbyOn.value = false;
      this.allowedSet.value = null;
      this.dismissed.value = new Set();
      this.rejoinable.value = false;
      this._phase.value = { name: 'closed' };
    });
    this.lobby = null;
    this.lastBusy = false;
    this.keysFor = new Map();
    this.pendingKey = null;
    this.accepting = false;
    if (slot === null) return;
    void this.connect(ep, slot);
  }

  private connect(ep: number, me: Slot): Promise<void> {
    return this.connFn().then((conn) => {
      if (ep !== this.epoch || this.disposed) return;
      this.conn = conn;
      const lobby = new VersusLobby({
        conn, me, build: this.build, proof: () => this.session.proofHash(), now: this.now, timers: this.timers, timeouts: this.t,
      });
      this.lobby = lobby;
      this.lobbySig.value = lobby;
      return Promise.all([this.refreshAllowed(ep), this.checkRejoin(ep), this.loadFaces(ep)]).then(() => undefined);
    }, () => undefined);
  }

  private async refreshAllowed(ep: number): Promise<void> {
    const lobby = this.lobby;
    if (lobby === null) return;
    const set = await lobby.allowed();
    if (ep !== this.epoch || set === 'offline') return;
    this.allowedSet.value = set;
    this.syncLobby();
  }

  /** The lobby runs while a player who may play Versus is not in a match: busy (greyed) off a menu. */
  private syncLobby(): void {
    const lobby = this.lobby;
    if (lobby === null || this.disposed) return;
    const may = this.allowed.peek();
    const want = may && this.ctx === null;
    const busy = this.ctx !== null || !this.menuSig.peek();
    if (may && busy !== this.lastBusy) {
      this.lastBusy = busy;
      void lobby.setBusy(busy);
    }
    if (want && !this.lobbyOn.peek()) {
      lobby.start();
      this.lobbyOn.value = true;
    } else if (!want && this.lobbyOn.peek()) {
      lobby.stop();
      this.lobbyOn.value = false;
    }
  }

  private async loadFaces(ep: number): Promise<void> {
    if (this.loadingFaces || ep !== this.epoch) return;
    this.loadingFaces = true;
    try {
      const roster = await this.session.roster();
      if (ep !== this.epoch) return;
      for (const p of roster.players) this.faces.set(p.slot, { slot: p.slot, name: p.name, picture: p.picture });
      for (const r of board.cached() ?? []) if (!this.faces.has(r.slot)) this.faces.set(r.slot, { slot: r.slot, name: r.name, picture: r.picture });
      this.facesRev.value++;
    } catch {
      // the faces keep what they have
    } finally {
      this.loadingFaces = false;
    }
  }

  private face(slot: Slot): FaceVM {
    void this.facesRev.value; // a signal read: faces arriving later redraw
    const mine = this.session.player.value;
    if (mine !== null && mine.slot === slot) return { slot, name: mine.name, picture: mine.picture };
    const known = this.faces.get(slot);
    if (known !== undefined) return known;
    const boy = slot === 'p01' || slot === 'p02' ? BOYS[slot] : null;
    return boy === null ? { slot, name: slot, picture: 'peashooter' } : { slot, name: boy.name, picture: boy.picture };
  }

  // ---- the card ----

  private showCard(): void {
    const o = this.outSig.peek();
    const me = this.meSlot.peek();
    const mine = this.session.player.peek();
    if (o === null || me === null || mine === null) return;
    const state: InviteCardState = o.state === 'matching' ? 'waiting' : o.state;
    this._phase.value = {
      name: 'card', state,
      draft: { me: { slot: me, name: mine.name, picture: mine.picture }, them: this.face(o.to), mySide: o.mySide, head: o.head === null ? null : { ...o.head } },
    };
    // After the phase: what depends on the invite (crossed invites, the answer) may move the phase on.
    this.outRev.value++;
  }

  private expire(o: Out): void {
    if (this.outSig.peek() !== o || o.state !== 'waiting') return;
    o.state = 'expired';
    this.showCard();
    void this.lobby?.cancel(o.to);
    o.timer = this.after(EXPIRED_SHOWN_MS, () => {
      if (this.outSig.peek() !== o) return;
      this.outSig.value = null;
      if (this.ctx === null && this._phase.peek().name === 'card') this._phase.value = { name: 'here' };
    });
  }

  /** Drops the invite out (and takes it back from the database when it is still open). */
  private dropOut(o: Out, cancel: boolean): void {
    this.clear(o.timer);
    if (cancel && (o.state === 'waiting' || o.state === 'matching' || o.state === 'expired')) void this.lobby?.cancel(o.to);
    if (this.outSig.peek() === o) this.outSig.value = null;
  }

  /** Crossed invites: I have one out to X and X's arrives; the later slot withdraws and the other's stands. */
  private crossed(out: Out | null, inbox: readonly Invite[]): void {
    const me = this.meSlot.peek();
    if (out === null || me === null || out.state !== 'waiting') return;
    if (!(me > out.to) || !inbox.some((i) => i.from === out.to)) return;
    this.dropOut(out, true);
    if (this.ctx === null && this._phase.peek().name === 'card') this._phase.value = { name: 'here' };
  }

  private onReplies(out: Out | null, replies: readonly Reply[]): void {
    if (out === null || out.state !== 'waiting') return;
    const r = replies.find((x) => x.from === out.to && !out.stale.has(replyKey(x)));
    if (r === undefined) return;
    this.clear(out.timer);
    void this.lobby?.clearReply(out.to);
    if (!r.ok) {
      if (r.build !== this.build) {
        this.outSig.value = null;
        this.notice('update', 'here');
        return;
      }
      out.state = 'refused';
      this.showCard();
      out.timer = this.after(REFUSED_SHOWN_MS, () => {
        if (this.outSig.peek() !== out) return;
        this.outSig.value = null;
        if (this.ctx === null && this._phase.peek().name === 'card') this._phase.value = { name: 'here' };
      });
      return;
    }
    out.state = 'matching';
    void this.answered(out, r);
  }

  /** The invitee said yes: derive the id, read the `meta` the same update wrote, and get ready. */
  private async answered(out: Out, r: Reply): Promise<void> {
    const ep = this.epoch;
    const me = this.meSlot.peek();
    if (me === null || out.keys === null || r.pub === null || this.conn === null) {
      this.outSig.value = null;
      this.notice('shrug', 'here');
      return;
    }
    const secret = await sharedSecret(out.keys, r.pub);
    const id = await matchId(secret, 0);
    const meta = await this.waitForMeta(id, () => ep === this.epoch && this.outSig.peek() === out);
    if (ep !== this.epoch || this.outSig.peek() !== out) return;
    this.outSig.value = null;
    if (meta === null) {
      this.notice('shrug', 'here');
    } else if (r.build !== this.build || meta.build !== this.build) {
      this.notice('update', 'here');
    } else if (meta.seats[out.mySide] !== me || meta.seats[other(out.mySide)] !== out.to) {
      this.notice('shrug', 'here');
    } else {
      this.enterMatch({ meta, id, n: 0, secret, writer: false });
    }
  }

  // ---- getting ready, the battle ----

  private newCtx(p: { meta: MatchMeta; id: string; n: number; secret: string | null; writer: boolean; rejoined: boolean }): Ctx | null {
    const me = this.meSlot.peek();
    if (me === null || this.conn === null) return null;
    const seat: Faction = p.meta.seats.plants === me ? 'plants' : 'zombies';
    const them = p.meta.seats[other(seat)];
    return {
      id: p.id, n: p.n, seat, me, other: them, host: p.meta.host === me, meta: p.meta, secret: p.secret, writer: p.writer,
      rejoined: p.rejoined,
      channel: new CloudMatchChannel({ conn: this.conn, id: p.id, seat, me, timers: this.timers }),
      alive: true, unlisten: null, link: null, linkStarted: false, resumeOnStart: false, endedRejoin: false, timer: null,
      readySeen: { plants: false, zombies: false }, connected: false, outcome: null, resultAt: null,
      again: {}, rematchState: 'offer', rematchTimer: null, rematching: false, rows: [], rankUp: null,
    };
  }

  /** A match opens: the lobby's streams close (the device is busy), and the two devices get ready. */
  private enterMatch(p: { meta: MatchMeta; id: string; n: number; secret: string | null; writer: boolean }): void {
    this.leaveMatch();
    const ctx = this.newCtx({ ...p, rejoined: false });
    if (ctx === null) return;
    this.ctx = ctx;
    this.syncLobby();
    this.startHeartbeat();
    this.showReady(ctx);
    ctx.timer = this.after(this.t.readyMs, () => {
      if (this.ctx !== ctx || this._phase.peek().name !== 'ready') return;
      void ctx.channel.remove();
      this.notice('shrug', 'here');
    });
    ctx.unlisten = ctx.channel.listen({ plants: 0, zombies: 0 }, (e) => this.onReadyEvent(ctx, e));
    void this.retry(ctx, () => ctx.channel.write({ kind: 'ready', seat: ctx.seat, at: 0 }));
  }

  private onReadyEvent(ctx: Ctx, e: MatchEvent): void {
    if (this.ctx !== ctx || !ctx.alive || this._phase.peek().name !== 'ready') return;
    if (e.kind === 'link') ctx.connected = e.up;
    else if (e.kind === 'ready') ctx.readySeen[e.seat] = true;
    else if (e.kind === 'gone') {
      this.notice('shrug', 'here');
      return;
    } else return;
    this.showReady(ctx);
    if (ctx.connected && ctx.readySeen.plants && ctx.readySeen.zombies && ctx.meta.build === this.build) this.toBattle(ctx);
  }

  private showReady(ctx: Ctx): void {
    const mine = this.session.player.peek();
    this._phase.value = {
      name: 'ready',
      me: mine === null ? this.face(ctx.me) : { slot: mine.slot, name: mine.name, picture: mine.picture },
      them: this.face(ctx.other), mySide: ctx.seat,
      blocks: { connected: ctx.connected, bothReady: ctx.readySeen.plants && ctx.readySeen.zombies, sameBuild: ctx.meta.build === this.build },
    };
  }

  private toBattle(ctx: Ctx): void {
    ctx.unlisten?.(); // the ready watch's streams close before the link opens its own
    ctx.unlisten = null;
    this.clear(ctx.timer);
    ctx.timer = null;
    const match = new Match(versusConfig(setupOf(ctx.meta)));
    ctx.link = this.makeLink(ctx, match, ctx.channel);
    this.beginBattle(ctx);
  }

  private makeLink(ctx: Ctx, match: Match, channel: MatchChannel): LockstepMatch {
    return new LockstepMatch({
      match, seat: ctx.seat, delay: ctx.meta.delay, host: ctx.host, me: ctx.me, other: ctx.other,
      channel, now: this.now, timers: this.timers, timeouts: this.t,
    });
  }

  private beginBattle(ctx: Ctx): void {
    const link = ctx.link!;
    try {
      this.session.deviceStorage()?.setItem(VMATCH_KEY, JSON.stringify({ id: ctx.id, n: ctx.n, seat: ctx.seat, me: ctx.me, other: ctx.other, host: ctx.host } satisfies VMatchKey));
    } catch {
      // without storage there is no rejoin
    }
    this._phase.value = {
      name: 'battle',
      options: {
        playerFaction: ctx.seat, skill: 'easy', seed: ctx.meta.seed, versus: true,
        online: { link, me: ctx.me, other: ctx.other, timeouts: this.t },
      },
    };
  }

  private startHeartbeat(): void {
    this.clear(this.heartbeat);
    const tick = (): void => {
      if (this.ctx === null) return;
      void this.lobby?.setBusy(true);
      this.heartbeat = this.timers.set(tick, this.t.heartbeatMs);
    };
    this.heartbeat = this.timers.set(tick, this.t.heartbeatMs);
  }

  // ---- the result and the rematch ----

  private credit(ctx: Ctx, o: VersusOutcome): void {
    const c = versusCredit(o, ctx.seat, ctx.me);
    if (c === null || this.session.player.peek() === null) return;
    const store = this.session.deviceStorage();
    let credited: string[] = [];
    try {
      const raw = store?.getItem(VCREDITED_KEY);
      if (raw != null) credited = (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === 'string');
    } catch {
      credited = [];
    }
    // Once per match even when a result of another kind came between (`lastBattle` is shared with Adventure).
    if (credited.includes(ctx.id)) return;
    this.session.update((s: Save) => applyBattleResult(s, { won: c.won, skill: 'easy', baseHpShare: 1, versus: true, battleId: versusBattleId(ctx.id) }, this.session.now()));
    try {
      store?.setItem(VCREDITED_KEY, JSON.stringify([...credited, ctx.id].slice(-KEPT_CREDITS)));
    } catch {
      // `lastBattle` still guards the plain repeat
    }
  }

  private showResult(ctx: Ctx): void {
    if (this.ctx !== ctx || ctx.outcome === null) return;
    const o = ctx.outcome;
    const seatOf = (f: Faction): Slot => ctx.meta.seats[f];
    const wSeat: Faction | null = o.kind === 'won' ? (o.winner === 'draw' ? null : o.winner)
      : o.kind === 'forfeit' ? o.winner : o.kind === 'disagree' ? (o.shown === 'draw' ? null : o.shown) : null;
    const mine = this.session.player.peek();
    const meFace: FaceVM = mine === null ? this.face(ctx.me) : { slot: mine.slot, name: mine.name, picture: mine.picture };
    const themFace = this.face(ctx.other);
    const faceOf = (slot: Slot): FaceVM => (slot === ctx.me ? meFace : themFace);
    const theirs = ctx.rows.find((r) => r.slot === ctx.other);
    const vm: VersusResultVM = {
      winner: wSeat === null ? null : faceOf(seatOf(wSeat)),
      loser: wSeat === null ? null : faceOf(seatOf(other(wSeat))),
      them: ctx.other,
      score: { left: meFace, leftWins: mine?.versusWins ?? 0, right: themFace, rightWins: theirs?.versusWins ?? 0 },
      rematch: ctx.rematchState,
      rankUp: ctx.rankUp,
    };
    this._phase.value = { name: 'result', vm };
  }

  /** The rematch watch: the two `again` records of the finished match (two streams, no turns). */
  private watchAgain(ctx: Ctx): void {
    ctx.unlisten = ctx.channel.listen({ plants: NO_TURNS, zombies: NO_TURNS }, (e) => {
      if (this.ctx !== ctx || !ctx.alive || ctx.rematching) return;
      if (e.kind === 'again') {
        if (ctx.again[e.seat] === undefined) ctx.again[e.seat] = e.value;
        this.afterAgain(ctx);
      } else if (e.kind === 'gone' && ctx.rematchState !== 'both') {
        ctx.rematchState = 'gone';
        this.showResult(ctx);
      }
    });
  }

  /** `again` changed: the button states, the 60 s window, the old match's removal, and the rematch itself. */
  private afterAgain(ctx: Ctx): void {
    const mine = ctx.again[ctx.seat];
    const theirs = ctx.again[other(ctx.seat)];
    if (ctx.rematchState !== 'gone') {
      if (theirs === 0) ctx.rematchState = 'gone';
      else if (mine === 1 && theirs === 1) ctx.rematchState = 'both';
      else if (mine === 1) ctx.rematchState = 'mine';
      else if (theirs === 1) ctx.rematchState = 'theirs';
    }
    if ((mine === 1 || theirs === 1) && ctx.rematchTimer === null) {
      // 60 s to answer once someone has asked; then the offer is gone and so is the old match.
      ctx.rematchTimer = this.after(this.t.rematchMs, () => {
        if (this.ctx !== ctx || ctx.rematching || ctx.rematchState === 'both') return;
        ctx.rematchState = 'gone';
        this.showResult(ctx);
        this.scheduleRemoval(ctx.channel, ctx.resultAt ?? this.now());
      });
    }
    this.checkRemoval(ctx);
    this.showResult(ctx);
    if (ctx.rematchState === 'both' && !ctx.rematching) {
      ctx.rematching = true;
      void this.startRematch(ctx);
    }
  }

  /** Both `again` records exist: the finished match can go, but not before the other device has settled. */
  private checkRemoval(ctx: Ctx): void {
    if (ctx.again.plants !== undefined && ctx.again.zombies !== undefined && ctx.resultAt !== null) {
      this.scheduleRemoval(ctx.channel, ctx.resultAt + this.t.endWaitMs);
    }
  }

  private scheduleRemoval(channel: CloudMatchChannel, notBefore: number): void {
    const run = async (left: number): Promise<void> => {
      const a = await channel.remove().catch((): WriteAnswer => 'offline');
      if (a === 'offline' && left > 0 && !this.disposed) this.after(this.t.retry.maxMs, () => void run(left - 1));
    };
    this.after(Math.max(0, notBefore - this.now()), () => void run(3));
  }

  /** The rematch: match `n + 1`, seats swapped, a new seed, the same head start; the original invitee writes `meta`. */
  private async startRematch(old: Ctx): Promise<void> {
    const ep = this.epoch;
    old.unlisten?.();
    old.unlisten = null;
    this.clear(old.rematchTimer);
    const alive = (): boolean => ep === this.epoch && this.ctx === old && old.alive;
    const n = old.n + 1;
    const id = await matchId(old.secret!, n);
    let meta: MatchMeta | null;
    if (old.writer) {
      const next = rematchSetup(setupOf(old.meta), randomSeed());
      const mine: MatchMeta = {
        v: 1, build: this.build, seed: next.seed, seats: next.seats, host: old.meta.host, head: next.head,
        turn: 6, delay: inputDelay(p90(this.lobby?.roundTrips() ?? [])), test: old.meta.test, created: 0,
      };
      meta = (await this.lobby?.createMatch(mine, id)) === 'ok' ? mine : null;
    } else {
      meta = await this.waitForMeta(id, alive);
    }
    if (!alive()) return;
    const swapped = meta !== null && meta.seats.plants === old.meta.seats.zombies && meta.seats.zombies === old.meta.seats.plants;
    if (meta === null || !swapped) {
      this.scheduleRemoval(old.channel, (old.resultAt ?? this.now()) + this.t.endWaitMs);
      this.notice('shrug', 'here');
      return;
    }
    if (meta.build !== this.build) {
      this.notice('update', 'here');
      return;
    }
    // The old match stays until the other device has surely settled; it is no longer watched.
    this.scheduleRemoval(old.channel, (old.resultAt ?? this.now()) + this.t.endWaitMs);
    this.enterMatch({ meta, id, n, secret: old.secret, writer: old.writer });
  }

  // ---- rejoin ----

  private async checkRejoin(ep: number): Promise<void> {
    const store = this.session.deviceStorage();
    const me = this.meSlot.peek();
    const conn = this.conn;
    if (store === undefined || me === null || conn === null) return;
    let raw: string | null = null;
    try {
      raw = store.getItem(VMATCH_KEY);
    } catch {
      return;
    }
    const key = parseKey(raw);
    if (raw !== null && key === null) this.forgetKey();
    if (key === null || key.me !== me) return; // another player's match stays for him
    const stored = await readMatch(conn, key.id, this.timers);
    if (ep !== this.epoch || stored === 'offline') return; // no answer: the key stays for the next log-in
    // Any stored match that still exists: one that ended while this device was away is credited on rejoin.
    if (stored === null) {
      this.forgetKey();
      return;
    }
    this.pendingKey = key;
    this.rejoinable.value = true;
  }

  private async doRejoin(key: VMatchKey, ep: number): Promise<void> {
    const conn = this.conn;
    if (conn === null) return;
    const stored = await readMatch(conn, key.id, this.timers);
    if (ep !== this.epoch) return;
    if (stored === 'offline') {
      this.rejoinable.value = true;
      return;
    }
    if (stored === null) {
      this.forgetKey();
      this.notice('gone', 'closed');
      return;
    }
    const ctx = this.newCtx({ meta: stored.meta, id: key.id, n: key.n, secret: null, writer: false, rejoined: true });
    if (ctx === null) return;
    this.leaveMatch();
    this.ctx = ctx;
    this.syncLobby();
    this.startHeartbeat();
    // Replaying is not waiting for the other boy: the bar shows full.
    const mine = this.session.player.peek();
    this._phase.value = {
      name: 'ready', me: mine === null ? this.face(ctx.me) : { slot: mine.slot, name: mine.name, picture: mine.picture },
      them: this.face(ctx.other), mySide: ctx.seat, blocks: { connected: true, bothReady: true, sameBuild: true },
    };

    // A replay that fails or never finishes must not strand the device: it gives up and goes home.
    const giveUp = (why: string): void => {
      if (this.ctx !== ctx || !ctx.alive) return;
      console.warn(`[versus] the rejoin gave up: ${why}`);
      this.forgetKey();
      this.notice('gone', 'closed');
    };
    ctx.timer = this.after(REJOIN_REPLAY_MAX_MS, () => giveUp('the replay did not finish in time'));
    try {
      this.replay(ctx, stored, ep, giveUp);
    } catch (e) {
      giveUp(String(e));
    }
  }

  private replay(ctx: Ctx, stored: StoredMatch, ep: number, giveUp: (why: string) => void): void {
    if (bothEnded(stored)) {
      // Over while this device was away: no replay, the stored ends give the outcome (and the credit).
      ctx.endedRejoin = true;
      this.finishRejoin(ctx, stored, new Match(versusConfig(setupOf(stored.meta))));
      return;
    }
    // Every stored turn goes into a lockstep: the own ones adopted, the other's received.
    const lockstep = new Lockstep({ seat: ctx.seat, delay: stored.meta.delay });
    const theirSeat = other(ctx.seat);
    for (const [k, raw] of stored.turns[ctx.seat]) lockstep.adoptOwn(k, raw);
    for (const [k, raw] of stored.turns[theirSeat]) lockstep.receive(theirSeat, k, raw);
    const toTick = TURN_TICKS * Math.min(lockstep.firstMissing(ctx.seat), lockstep.firstMissing(theirSeat));
    const match = new Match(versusConfig(setupOf(stored.meta)));
    const theirHashes = new Map<number, number>(lockstep.remoteHashes());
    let mismatched = 0;
    const slice = (): void => {
      if (ep !== this.epoch || this.ctx !== ctx || !ctx.alive) return;
      try {
        sliceOnce();
      } catch (e) {
        giveUp(String(e));
      }
    };
    const sliceOnce = (): void => {
      // 30 ticks at a time (a hash is taken every 30), 600 a slice: one slice a frame.
      for (let done = 0; done < REPLAY_SLICE_TICKS && match.state.tick < toTick && match.state.winner === null; done += 30) {
        replaySlice(match, { lockstep, toTick }, 30);
        const their = theirHashes.get(match.state.tick);
        if (their !== undefined && their !== match.hash()) mismatched++;
      }
      if (match.state.tick < toTick && match.state.winner === null) {
        this.after(16, slice);
        return;
      }
      if (mismatched > 0) console.warn(`[versus] the replay differs from the other device's hashes ${mismatched} times; the link will ask for a repair`);
      this.finishRejoin(ctx, stored, match);
    };
    this.after(0, slice);
  }

  private finishRejoin(ctx: Ctx, stored: StoredMatch, match: Match): void {
    const them = other(ctx.seat);
    const turns = stored.turns;
    // After a reload the heard-pause set is empty: a pause of this device left in the store would
    // pause it alone, or hold the other device for ever. Ignored here, and ended once the link runs.
    const mineStored = stored.control.some((c) => c.kind === 'pause' && (c.by === ctx.me || pauseWriter(c.n) === ctx.seat));
    ctx.resumeOnStart = mineStored;
    let fed = false;
    const base = ctx.channel;
    const channel: MatchChannel = {
      publishTurns: (s, t) => base.publishTurns(s, t),
      write: (r, o) => base.write(r, o),
      remove: () => base.remove(),
      listen: (from, on) => {
        if (!fed) {
          fed = true;
          for (const [k, raw] of turns[ctx.seat]) on({ kind: 'turn', seat: ctx.seat, k, raw });
          for (const [k, raw] of turns[them]) on({ kind: 'turn', seat: them, k, raw });
        }
        const held = (m: Map<number, string>): number => { let k = 0; while (m.has(k)) k++; return k; };
        const next = { ...from, [them]: Math.max(from[them], held(turns[them])) };
        return base.listen(next, (e) => {
          if (e.kind === 'pause' && (e.by === ctx.me || pauseWriter(e.n) === ctx.seat)) return;
          on(e);
        });
      },
    };
    ctx.link = this.makeLink(ctx, match, channel);
    this.clear(ctx.timer);
    ctx.timer = null;
    if (ctx.endedRejoin) {
      // No battle to show: the link only listens until the two end records give the outcome.
      const link = ctx.link;
      ctx.linkStarted = true;
      link.onChange(() => {
        const o = link.outcome();
        if (o !== null) this.battleOutcome(o);
      });
      link.start();
      return;
    }
    this.beginBattle(ctx);
  }

  // ---- leaving, notices, helpers ----

  /** Disposes of the match's watch and link (the key stays: a reload may come back to it). */
  private leaveMatch(): void {
    const ctx = this.ctx;
    this.clear(this.heartbeat);
    this.heartbeat = null;
    if (ctx === null) return;
    ctx.alive = false;
    ctx.unlisten?.();
    ctx.unlisten = null;
    ctx.link?.dispose();
    this.clear(ctx.timer);
    this.clear(ctx.rematchTimer);
    this.ctx = null;
  }

  private notice(kind: NoticeKind, back: 'here' | 'closed'): void {
    const ctx = this.ctx;
    if (ctx !== null && (kind === 'broken' || kind === 'gone')) this.forgetKey();
    this.leaveMatch();
    this.noticeBack = back;
    this._phase.value = { name: 'notice', kind };
    if (kind === 'update') {
      reloadForUnreadableSave({ session: this.flag, online: () => true, reload: this.reloadPage });
    }
    this.syncLobby();
  }

  private forgetKey(): void {
    try {
      this.session.deviceStorage()?.removeItem(VMATCH_KEY);
    } catch {
      // nothing to forget
    }
    this.pendingKey = null;
    this.rejoinable.value = false;
  }

  private dismiss(inv: Invite): void {
    this.dismissed.value = new Set([...this.dismissed.peek(), inviteKey(inv)]);
  }

  private after(ms: number, fn: () => void): unknown {
    const h: unknown = this.timers.set(() => {
      this.handles.delete(h);
      if (!this.disposed) fn();
    }, ms);
    this.handles.add(h);
    return h;
  }

  private clear(h: unknown): void {
    if (h === null || h === undefined) return;
    this.timers.clear(h);
    this.handles.delete(h);
  }

  /**
   * Sends a write until the database answers `ok` or `refused` (an `offline` is sent again, 250 ms
   * doubling to 2 s) while the match is still this one (`always`: even after it was left).
   */
  private async retry(ctx: Ctx, send: () => Promise<WriteAnswer>, always = false): Promise<WriteAnswer | null> {
    let wait = this.t.retry.firstMs;
    for (;;) {
      if (!always && (this.ctx !== ctx || !ctx.alive)) return null;
      if (this.disposed) return null;
      const a = await send().catch((): WriteAnswer => 'offline');
      if (a !== 'offline') return a;
      await new Promise<void>((resolve) => { this.after(wait, resolve); });
      wait = Math.min(wait * 2, this.t.retry.maxMs);
    }
  }

  /** The `meta` at `id`, asked again (250 ms doubling to 2 s) for as long as the ready window lasts; null if it never comes. */
  private async waitForMeta(id: string, alive: () => boolean): Promise<MatchMeta | null> {
    const conn = this.conn;
    if (conn === null) return null;
    const end = this.now() + this.t.readyMs;
    let wait = this.t.retry.firstMs;
    while (alive()) {
      const s = await readMatch(conn, id, this.timers);
      if (s !== null && s !== 'offline') return s.meta;
      if (this.now() >= end) return null;
      await new Promise<void>((resolve) => { this.after(wait, resolve); });
      wait = Math.min(wait * 2, this.t.retry.maxMs);
    }
    return null;
  }
}
