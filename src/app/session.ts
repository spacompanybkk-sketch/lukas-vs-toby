import { computed, signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { grownUpHash, pinHash, PIN } from '../cloud/hash';
import { defaultCloud, pageCloudMode } from '../cloud/restClient';
import type { CloudMode } from '../cloud/restClient';
import { modeStorage } from '../cloud/modeStorage';
import { SaveSync, hashKey, syncKey } from '../cloud/sync';
import type { SaveSyncOptions, SyncState } from '../cloud/sync';
import type { Cloud, CloudError, PublicPlayer } from '../cloud/types';
import { lastSlot, loadLocal, removeLocal, saveLocal, setLastSlot } from '../progress/localStore';
import { mergeSaves } from '../progress/merge';
import { OLD_SAVE_KEYS, importOldSave } from '../progress/migrate';
import { SLOTS, isPicture, newSave, touch, validName } from '../progress/save';
import { buyUpgrade } from '../progress/upgrades';
import type { Save, Slot } from '../progress/save';
import type { CardKey } from '../sim/types';

/** Lukas and Toby have their places from the first start (spec 20), with the old game's saves. */
export const BOYS = Object.freeze({
  p01: Object.freeze({ name: 'Lukas', picture: 'peashooter' as CardKey, old: OLD_SAVE_KEYS.lukas }),
  p02: Object.freeze({ name: 'Toby', picture: 'brainEater' as CardKey, old: OLD_SAVE_KEYS.toby }),
});
type BoySlot = keyof typeof BOYS;
const isBoy = (slot: Slot): slot is BoySlot => slot === 'p01' || slot === 'p02';

/** Three wrong numbers in a row lock that player for this long (spec 20). */
export const LOCK_MS = 30_000;
export const MAX_WRONG = 3;

/** Five wrong grown-up codes in a row lock the gate on this device for this long. */
export const GATE_LOCK_MS = 60_000;
export const GATE_MAX_WRONG = 5;
/** The id the grown-up gate's lock and count are kept under (never a slot). */
const GATE = 'grownup';

/**
 * Device keys: the unlock time of a locked player (or of the gate), the wrong tries in a row
 * that lead to it, an old save carried here, a grown-up code known here.
 */
export const lockKey = (id: Slot | typeof GATE): string => `lvt2_lock_${id}`;
export const wrongKey = (id: Slot | typeof GATE): string => `lvt2_wrong_${id}`;
const oldImportKey = (slot: Slot): string => `lvt2_oldimport_${slot}`;
const GROWN_UP_KNOWN = 'lvt2_grownup_known';

/** One picture in the Players grid; `exists: false` is Lukas or Toby before he has a number. */
export interface RosterEntry extends PublicPlayer { exists: boolean }
export interface Roster {
  /** False: the cloud did not answer, and these are the players this device knows. */
  online: boolean;
  /** Last used on this device first, then by place. */
  players: RosterEntry[];
  /** No free place for a new player. */
  full: boolean;
  /** What the device knows while the cloud's answer is still on its way (`deviceRoster`). */
  pending?: boolean;
}

export type LoginResult = Save | 'locked' | CloudError;
export type CreateResult = Save | 'invalid' | CloudError;

export interface SessionDeps {
  cloud: Cloud;
  storage?: Storage;
  /** The clock for locks and saves (default `Date.now`). */
  now?: () => number;
  window?: SaveSyncOptions['window'];
  document?: SaveSyncOptions['document'];
  /**
   * Which cloud this is (default `live`). The fake and test clouds keep their device keys under
   * their own prefix (see modeStorage), and only the live one marks the boys' old saves as used.
   */
  mode?: CloudMode;
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

interface Live { cloud: Cloud; storage: Storage | undefined; now: () => number; sync: SaveSync; mode: CloudMode }

/**
 * Who is playing: logging in by picture and number, making a player, the lock-out, the grown-up
 * gate, and every change to the logged-in player's save (through `update`, kept on the device and
 * in the cloud by `SaveSync`). The app uses the one `session`; tests `configure` their own.
 */
export class PlayerSession {
  private readonly live = signal<Live | null>(null);
  /** A create whose answer never came: the same taps again try its place first. */
  private pending: { slot: Slot; name: string; picture: CardKey; pin: string } | null = null;

  /** The logged-in player's save, or null. */
  readonly player: ReadonlySignal<Save | null> = computed(() => this.live.value?.sync.save.value ?? null);
  /** Whether the logged-in player's progress has reached the cloud. */
  readonly syncState: ReadonlySignal<SyncState> = computed(() => this.live.value?.sync.state.value ?? 'synced');

  /** Replaces the cloud, storage and clock (tests, the debug clock); logs out. */
  configure(deps: SessionDeps): void {
    this.live.peek()?.sync.dispose();
    const mode = deps.mode ?? 'live';
    const storage = modeStorage(deps.storage ?? defaultStorage(), mode);
    const now = deps.now ?? (() => Date.now());
    const sync = new SaveSync(deps.cloud, storage, {
      now,
      ...(deps.window !== undefined ? { window: deps.window } : {}),
      ...(deps.document !== undefined ? { document: deps.document } : {}),
    });
    this.pending = null;
    this.live.value = { cloud: deps.cloud, storage, now, sync, mode };
  }

  private get d(): Live {
    let l = this.live.peek();
    if (l === null) {
      this.configure({ cloud: defaultCloud(), mode: pageCloudMode() });
      l = this.live.peek() as Live;
    }
    return l;
  }

  now(): number {
    return this.d.now();
  }

  /** The player last logged in on this device. */
  lastUsed(): Slot | null {
    return lastSlot(this.d.storage);
  }

  /** The pictures for the Players grid. */
  async roster(): Promise<Roster> {
    const list = await this.d.cloud.listPlayers();
    if (!Array.isArray(list)) return this.arrange(this.devicePlayers(), false);
    return this.arrange(list.map((p) => ({ ...p, exists: true })), true);
  }

  /** At once, without the cloud: the players this device has a copy of, and the two boys. */
  deviceRoster(): Roster {
    return { ...this.arrange(this.devicePlayers(), false), pending: true };
  }

  private devicePlayers(): RosterEntry[] {
    return SLOTS.flatMap((slot) => {
      const s = loadLocal(slot, this.d.storage);
      return s ? [{ slot, name: s.name, picture: s.picture, exists: true }] : [];
    });
  }

  /** The boys added when missing; the last player first, then by place. */
  private arrange(players: RosterEntry[], online: boolean): Roster {
    for (const slot of ['p01', 'p02'] as const) {
      if (!players.some((p) => p.slot === slot)) players.push({ slot, name: BOYS[slot].name, picture: BOYS[slot].picture, exists: false });
    }
    const last = lastSlot(this.d.storage);
    players.sort((a, b) => (a.slot === last ? -1 : b.slot === last ? 1 : a.slot.localeCompare(b.slot)));
    return { online, players, full: online && freeSlot(players.map((p) => p.slot)) === null };
  }

  /** When a locked player may try again (ms on this session's clock), or 0 when not locked. */
  lockedUntil(slot: Slot): number {
    return this.lockTime(slot, LOCK_MS);
  }

  /** When the grown-up gate opens again on this device, or 0. */
  gateLockedUntil(): number {
    return this.lockTime(GATE, GATE_LOCK_MS);
  }

  /**
   * The stored unlock time of `id`. An expired lock is cleared with its count. A lock further
   * away than one whole lock (the device clock was set back) is cleared too: never a longer wait.
   */
  private lockTime(id: Slot | typeof GATE, longest: number): number {
    const { storage } = this.d;
    const raw = readKey(storage, lockKey(id));
    if (raw === null) return 0;
    const until = Number(raw);
    const now = this.now();
    if (!Number.isFinite(until) || until <= now || until - now > longest) {
      removeKey(storage, lockKey(id));
      removeKey(storage, wrongKey(id));
      return 0;
    }
    return until;
  }

  /** One more wrong try for `id` (kept on the device); the `max`th in a row locks it. */
  private countWrong(id: Slot | typeof GATE, max: number, ms: number): boolean {
    const { storage } = this.d;
    const n = (Number(readKey(storage, wrongKey(id))) || 0) + 1;
    if (n < max) {
      writeKey(storage, wrongKey(id), String(n));
      return false;
    }
    removeKey(storage, wrongKey(id));
    writeKey(storage, lockKey(id), String(this.now() + ms));
    return true;
  }

  private clearWrong(id: Slot | typeof GATE): void {
    removeKey(this.d.storage, wrongKey(id));
    removeKey(this.d.storage, lockKey(id));
  }

  async login(slot: Slot, pin: string): Promise<LoginResult> {
    if (this.lockedUntil(slot) > 0) return 'locked';
    const { sync, storage } = this.d;
    const first = await sync.login(slot, pin);
    // The right number, but no save anywhere the device can read (only a console edit causes
    // it): this device's copy if it has one, else a fresh save with the player's name and picture.
    let r = first === 'no-save' ? await this.adoptFresh(slot, pin) : first;
    // Offline, a device that knows this player checks the number against its own copy's hash.
    if (r === 'offline' && loadLocal(slot, storage) !== null) {
      const known = readKey(storage, hashKey(slot));
      if (known !== null && known !== (await pinHash(slot, pin))) r = 'wrong-pin';
    }
    if (r === 'wrong-pin') {
      // The cloud refused, but this device knows the player under exactly this number: a rules
      // refusal (a rollback, a stale deploy), not a wrong number. Play from the device copy, the
      // cloud counts as unavailable, and no wrong try is counted.
      const mine = await sync.playLocal(slot, pin);
      if (mine !== null) {
        this.clearWrong(slot);
        return this.player.peek() ?? mine;
      }
      return this.countWrong(slot, MAX_WRONG, LOCK_MS) ? 'locked' : 'wrong-pin';
    }
    if (typeof r === 'string') return r;
    this.clearWrong(slot);
    this.importOld(slot);
    return this.player.peek() ?? r;
  }

  private async adoptFresh(slot: Slot, pin: string): Promise<Save | CloudError> {
    const { sync, storage, cloud } = this.d;
    let save = loadLocal(slot, storage);
    if (save === null) {
      const list = await cloud.listPlayers();
      if (typeof list === 'string') return list;
      const who = list.find((p) => p.slot === slot);
      if (who === undefined) return 'refused';
      save = newSave(slot, who.name, who.picture, this.now());
      if (slot === 'p02') save = { ...save, difficulty: { plants: 'easy', zombies: 'easy' } };
    }
    return sync.adopt(save, pin);
  }

  /**
   * Remembers on the device that a boy's old save has been carried. Only on the live cloud:
   * playing on the fake or test cloud must never use up the real import.
   */
  private markOldUsed(slot: Slot): void {
    if (this.d.mode === 'live') writeKey(this.d.storage, oldImportKey(slot), '1');
  }

  /** Carries the old game's save of Lukas or Toby into the logged-in save, if this device has one. */
  private importOld(slot: Slot): void {
    const { storage, sync } = this.d;
    const save = sync.save.peek();
    if (!isBoy(slot) || !save || save.importedOld || readKey(storage, oldImportKey(slot)) !== null) return;
    const raw = readKey(storage, BOYS[slot].old);
    if (raw === null) return;
    this.markOldUsed(slot);
    sync.update((s) => importOldSave(s, raw, this.now()));
  }

  /**
   * Makes a player and logs them in. Without `slot` the lowest free place after the boys' is used
   * (the boys' own are `p01`/`p02`). Needs the cloud: offline nothing is made or kept.
   */
  async create(name: string, picture: CardKey, pin: string, slot?: Slot): Promise<CreateResult> {
    const nick = name.trim();
    if (!validName(nick) || !isPicture(picture) || !PIN.test(pin)) return 'invalid';
    const { cloud, sync, storage } = this.d;
    const retry = this.pending;
    let target: Slot | undefined = slot
      ?? (retry && retry.name === nick && retry.picture === picture && retry.pin === pin ? retry.slot : undefined);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (target === undefined) {
        const list = await cloud.listPlayers();
        if (typeof list === 'string') return list;
        const free = freeSlot(list.map((p) => p.slot));
        if (free === null) return 'full';
        target = free;
      }
      const now = this.now();
      let save = newSave(target, nick, picture, now);
      if (target === 'p02') save = { ...save, difficulty: { plants: 'easy', zombies: 'easy' } };
      const boyOld = isBoy(target) && readKey(storage, oldImportKey(target)) === null ? readKey(storage, BOYS[target].old) : null;
      if (boyOld !== null) save = importOldSave(save, boyOld, now);
      const r = await sync.create(save, pin);
      if (r === 'offline') {
        this.pending = { slot: target, name: nick, picture, pin };
        return r;
      }
      if (r === 'taken' && slot === undefined) {
        target = undefined;
        continue;
      }
      if (typeof r === 'string') return r;
      this.pending = null;
      if (r.importedOld && isBoy(target)) this.markOldUsed(target);
      this.clearWrong(target);
      return r;
    }
    return 'taken';
  }

  logout(): void {
    this.d.sync.logout();
  }

  /** How long logging out waits for an unsent save to reach the cloud. */
  static readonly LOGOUT_WAIT_MS = 2000;

  /**
   * Logs out after pushing any unsent change to the cloud, waiting at most `waitMs`; logs out
   * regardless (the device copy keeps the change and is pushed at the next log-in).
   */
  async logoutAfterSaving(waitMs = PlayerSession.LOGOUT_WAIT_MS): Promise<void> {
    const { sync } = this.d;
    if (sync.save.peek() !== null && sync.state.peek() !== 'synced') {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        sync.flush().catch(() => {}),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); }),
      ]);
      clearTimeout(timer);
    }
    sync.logout();
  }

  /** Changes the logged-in player's save (device at once, cloud as soon as it can). */
  update(fn: (s: Save) => Save): void {
    this.d.sync.update(fn);
  }

  /**
   * One Marketplace level of `unit` for the logged-in player, paid in coins, through `update` (so
   * it is kept on the device and synced). `no-coins` and `max` change nothing.
   */
  buy(unit: CardKey): 'ok' | 'no-coins' | 'max' | 'no-player' {
    const me = this.player.peek();
    if (me === null) return 'no-player';
    const r = buyUpgrade(me, unit, this.now());
    if (typeof r === 'string') return r;
    this.update((s) => {
      const again = buyUpgrade(s, unit, this.now());
      return typeof again === 'string' ? s : again;
    });
    return 'ok';
  }

  /** Tries the cloud now; resolves when that attempt ends. */
  flush(): Promise<void> {
    return this.d.sync.flush();
  }

  /** Whether a grown-up code has been set or used on this device. */
  grownUpKnown(): boolean {
    return readKey(this.d.storage, GROWN_UP_KNOWN) !== null;
  }

  /** Whether `code` is the grown-up code. `other`: the cloud refused for another reason. */
  async checkGrownUp(code: string): Promise<'ok' | 'wrong' | 'offline' | 'other'> {
    const r = await this.d.cloud.checkGrownUpCode(await grownUpHash(code));
    if (r === 'ok') writeKey(this.d.storage, GROWN_UP_KNOWN, '1');
    return r === 'ok' ? 'ok' : r === 'offline' ? 'offline' : r === 'wrong-pin' ? 'wrong' : 'other';
  }

  /** Sets the grown-up code; only once, ever (`taken` when one exists). */
  async setGrownUp(code: string): Promise<'ok' | 'taken' | 'offline'> {
    const r = await this.d.cloud.setGrownUpCode(await grownUpHash(code));
    if (r === 'ok') writeKey(this.d.storage, GROWN_UP_KNOWN, '1');
    return r === 'ok' ? 'ok' : r === 'offline' ? 'offline' : 'taken';
  }

  /**
   * The grown-up gate. `ok`: the code is right. `new`: the cloud had no code at all, and this
   * one is now set (the screen asks for it again to confirm; a different second entry is fixed
   * with `changeGrownUp`). `wrong`: a code is set and this is not it; five in a row lock the
   * gate on this device for 60 s (`locked`). `offline` / `other`: no answer / refused otherwise.
   * "Set a new code" is only ever offered when the cloud itself says none was set.
   */
  async openGate(code: string): Promise<'ok' | 'new' | 'wrong' | 'locked' | 'offline' | 'other'> {
    if (this.gateLockedUntil() > 0) return 'locked';
    const r = await this.checkGrownUp(code);
    if (r === 'ok') {
      this.clearWrong(GATE);
      return 'ok';
    }
    if (r !== 'wrong') return r;
    // A refused proof means: not the code, or no code at all. Setting it tells which — the
    // database takes a code only when none exists (the hash is well formed, so a refusal here
    // can only mean one is set).
    const set = await this.setGrownUp(code);
    if (set === 'ok') {
      this.clearWrong(GATE);
      return 'new';
    }
    if (set === 'offline') return 'offline';
    return this.countWrong(GATE, GATE_MAX_WRONG, GATE_LOCK_MS) ? 'locked' : 'wrong';
  }

  /** A new grown-up code, proven with the current one. */
  async changeGrownUp(oldCode: string, newCode: string): Promise<'ok' | 'wrong' | 'offline' | 'other'> {
    const r = await this.d.cloud.changeGrownUpCode(await grownUpHash(oldCode), await grownUpHash(newCode));
    return r === 'ok' ? 'ok' : r === 'offline' ? 'offline' : r === 'wrong-pin' ? 'wrong' : 'other';
  }

  async deletePlayer(slot: Slot, code: string): Promise<'ok' | 'wrong' | 'offline' | 'failed'> {
    const { cloud, storage, sync } = this.d;
    const gate = await this.checkGrownUp(code);
    if (gate !== 'ok') return gate === 'other' ? 'failed' : gate;
    const r = await cloud.deletePlayer(slot, await grownUpHash(code));
    if (r !== 'ok') return r === 'offline' ? 'offline' : 'failed';
    if (sync.save.peek()?.slot === slot) sync.logout();
    this.forgetOnDevice(slot);
    if (lastSlot(storage) === slot) setLastSlot(null, storage);
    return 'ok';
  }

  /**
   * A new number for a player who forgot theirs. The progress is kept when this device has it
   * (its copy, or the cloud's read with the number last used here); otherwise the save starts
   * fresh with the same name and picture, and the answer is `fresh`.
   */
  async resetPin(player: PublicPlayer, code: string, pin: string): Promise<'ok' | 'fresh' | 'wrong' | 'offline' | 'failed'> {
    if (!PIN.test(pin)) return 'failed';
    const { cloud, storage, sync } = this.d;
    const { slot } = player;
    // "Wrong code" only when the code really is wrong; any other refusal is a retry.
    const gate = await this.checkGrownUp(code);
    if (gate !== 'ok') return gate === 'other' ? 'failed' : gate;
    const local = loadLocal(slot, storage);
    const known = readKey(storage, hashKey(slot));
    let remote: Save | null = null;
    if (known !== null) {
      const r = await cloud.loadSave(slot, known);
      if (r === 'offline') return 'offline';
      if (r !== null && typeof r === 'object') remote = r;
    }
    // Both copies merged (never one dropped): nothing the child earned on either is lost.
    const kept = local && remote ? mergeSaves(local, remote, this.now()) : local ?? remote;
    const base = kept ?? newSave(slot, player.name, player.picture, this.now());
    const save = touch({ ...base, name: player.name, picture: player.picture }, this.now());
    const newHash = await pinHash(slot, pin);
    const r = await cloud.resetPin(slot, await grownUpHash(code), newHash, save);
    if (r !== 'ok') return r === 'offline' ? 'offline' : 'failed';
    if (sync.save.peek()?.slot === slot) sync.logout();
    saveLocal(save, storage);
    writeKey(storage, hashKey(slot), newHash);
    this.clearWrong(slot);
    return kept ? 'ok' : 'fresh';
  }

  private forgetOnDevice(slot: Slot): void {
    const { storage } = this.d;
    removeLocal(slot, storage);
    removeKey(storage, hashKey(slot));
    removeKey(storage, syncKey(slot));
    this.clearWrong(slot);
  }

  dispose(): void {
    this.live.peek()?.sync.dispose();
    this.live.value = null;
  }
}

/** The lowest place a new player can take: never the boys' two. */
export function freeSlot(taken: readonly Slot[]): Slot | null {
  return SLOTS.find((s) => !isBoy(s) && !taken.includes(s)) ?? null;
}

function readKey(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeKey(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Without storage the lock lasts for this page only.
  }
}

function removeKey(storage: Storage | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** The app's one session (the default cloud on first use). */
export const session = new PlayerSession();
