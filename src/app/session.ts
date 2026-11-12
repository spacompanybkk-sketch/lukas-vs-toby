import { computed, signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { grownUpHash, pinHash, PIN } from '../cloud/hash';
import { defaultCloud } from '../cloud/restClient';
import { SaveSync, hashKey, syncKey } from '../cloud/sync';
import type { SaveSyncOptions, SyncState } from '../cloud/sync';
import type { Cloud, CloudError, PublicPlayer } from '../cloud/types';
import { lastSlot, loadLocal, removeLocal, saveLocal, setLastSlot } from '../progress/localStore';
import { mergeSaves } from '../progress/merge';
import { OLD_SAVE_KEYS, importOldSave } from '../progress/migrate';
import { SLOTS, isPicture, newSave, touch, validName } from '../progress/save';
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

/** Device keys: the unlock time of a locked player; an old save carried here; a grown-up code known here. */
export const lockKey = (slot: Slot): string => `lvt2_lock_${slot}`;
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
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

interface Live { cloud: Cloud; storage: Storage | undefined; now: () => number; sync: SaveSync }

/**
 * Who is playing: logging in by picture and number, making a player, the lock-out, the grown-up
 * gate, and every change to the logged-in player's save (through `update`, kept on the device and
 * in the cloud by `SaveSync`). The app uses the one `session`; tests `configure` their own.
 */
export class PlayerSession {
  private readonly live = signal<Live | null>(null);
  /** Wrong numbers in a row, per player, since the last right one (this page only). */
  private readonly wrong = new Map<Slot, number>();
  /** A create whose answer never came: the same taps again try its place first. */
  private pending: { slot: Slot; name: string; picture: CardKey; pin: string } | null = null;

  /** The logged-in player's save, or null. */
  readonly player: ReadonlySignal<Save | null> = computed(() => this.live.value?.sync.save.value ?? null);
  /** Whether the logged-in player's progress has reached the cloud. */
  readonly syncState: ReadonlySignal<SyncState> = computed(() => this.live.value?.sync.state.value ?? 'synced');

  /** Replaces the cloud, storage and clock (tests, the debug clock); logs out. */
  configure(deps: SessionDeps): void {
    this.live.peek()?.sync.dispose();
    const storage = deps.storage ?? defaultStorage();
    const now = deps.now ?? (() => Date.now());
    const sync = new SaveSync(deps.cloud, storage, {
      now,
      ...(deps.window !== undefined ? { window: deps.window } : {}),
      ...(deps.document !== undefined ? { document: deps.document } : {}),
    });
    this.wrong.clear();
    this.pending = null;
    this.live.value = { cloud: deps.cloud, storage, now, sync };
  }

  private get d(): Live {
    let l = this.live.peek();
    if (l === null) {
      this.configure({ cloud: defaultCloud() });
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
    const { cloud, storage } = this.d;
    const list = await cloud.listPlayers();
    const online = Array.isArray(list);
    const players: RosterEntry[] = online
      ? list.map((p) => ({ ...p, exists: true }))
      : SLOTS.flatMap((slot) => {
        const s = loadLocal(slot, storage);
        return s ? [{ slot, name: s.name, picture: s.picture, exists: true }] : [];
      });
    for (const slot of ['p01', 'p02'] as const) {
      if (!players.some((p) => p.slot === slot)) players.push({ slot, name: BOYS[slot].name, picture: BOYS[slot].picture, exists: false });
    }
    const last = lastSlot(storage);
    players.sort((a, b) => (a.slot === last ? -1 : b.slot === last ? 1 : a.slot.localeCompare(b.slot)));
    return { online, players, full: online && freeSlot(players.map((p) => p.slot)) === null };
  }

  /** When a locked player may try again (ms on this session's clock), or 0 when not locked. */
  lockedUntil(slot: Slot): number {
    const { storage } = this.d;
    let raw: string | null = null;
    try {
      raw = storage?.getItem(lockKey(slot)) ?? null;
    } catch {
      raw = null;
    }
    const until = Number(raw);
    if (raw === null || !Number.isFinite(until) || until <= this.now()) return 0;
    // A clock set back can never make the wait longer than one lock.
    return Math.min(until, this.now() + LOCK_MS);
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
    if (r === 'wrong-pin') return this.countWrong(slot);
    if (typeof r === 'string') return r;
    this.wrong.delete(slot);
    removeKey(storage, lockKey(slot));
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

  private countWrong(slot: Slot): 'wrong-pin' | 'locked' {
    const n = (this.wrong.get(slot) ?? 0) + 1;
    if (n < MAX_WRONG) {
      this.wrong.set(slot, n);
      return 'wrong-pin';
    }
    this.wrong.delete(slot);
    writeKey(this.d.storage, lockKey(slot), String(this.now() + LOCK_MS));
    return 'locked';
  }

  /** Carries the old game's save of Lukas or Toby into the logged-in save, if this device has one. */
  private importOld(slot: Slot): void {
    const { storage, sync } = this.d;
    const save = sync.save.peek();
    if (!isBoy(slot) || !save || save.importedOld || readKey(storage, oldImportKey(slot)) !== null) return;
    const raw = readKey(storage, BOYS[slot].old);
    if (raw === null) return;
    writeKey(storage, oldImportKey(slot), '1');
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
      if (r.importedOld && isBoy(target)) writeKey(storage, oldImportKey(target), '1');
      removeKey(storage, lockKey(target));
      return r;
    }
    return 'taken';
  }

  logout(): void {
    this.d.sync.logout();
  }

  /** Changes the logged-in player's save (device at once, cloud as soon as it can). */
  update(fn: (s: Save) => Save): void {
    this.d.sync.update(fn);
  }

  /** Tries the cloud now; resolves when that attempt ends. */
  flush(): Promise<void> {
    return this.d.sync.flush();
  }

  /** Whether a grown-up code has been set or used on this device. */
  grownUpKnown(): boolean {
    return readKey(this.d.storage, GROWN_UP_KNOWN) !== null;
  }

  async checkGrownUp(code: string): Promise<'ok' | 'wrong' | 'offline'> {
    const r = await this.d.cloud.checkGrownUpCode(await grownUpHash(code));
    if (r === 'ok') writeKey(this.d.storage, GROWN_UP_KNOWN, '1');
    return r === 'ok' ? 'ok' : r === 'offline' ? 'offline' : 'wrong';
  }

  /** Sets the grown-up code; only once, ever (`taken` when one exists). */
  async setGrownUp(code: string): Promise<'ok' | 'taken' | 'offline'> {
    const r = await this.d.cloud.setGrownUpCode(await grownUpHash(code));
    if (r === 'ok') writeKey(this.d.storage, GROWN_UP_KNOWN, '1');
    return r === 'ok' ? 'ok' : r === 'offline' ? 'offline' : 'taken';
  }

  async deletePlayer(slot: Slot, code: string): Promise<'ok' | 'wrong' | 'offline' | 'failed'> {
    const { cloud, storage, sync } = this.d;
    const gate = await this.checkGrownUp(code);
    if (gate !== 'ok') return gate;
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
    if (gate !== 'ok') return gate;
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
    removeKey(storage, lockKey(slot));
    this.wrong.delete(slot);
    return kept ? 'ok' : 'fresh';
  }

  private forgetOnDevice(slot: Slot): void {
    const { storage } = this.d;
    removeLocal(slot, storage);
    removeKey(storage, hashKey(slot));
    removeKey(storage, syncKey(slot));
    removeKey(storage, lockKey(slot));
    this.wrong.delete(slot);
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
