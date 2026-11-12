import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { loadLocal, saveLocal, setLastSlot } from '../progress/localStore';
import { touch } from '../progress/save';
import type { Save, Slot } from '../progress/save';
import { pinHash } from './hash';
import type { Cloud, CloudError } from './types';

/**
 * - `synced`: the cloud has this device's save.
 * - `pending`: a change is on its way to the cloud.
 * - `offline`: the cloud could not be reached (or refuses); the device copy keeps everything.
 * - `replaced`: another device saved newer progress while this one had a change waiting; the
 *   newer save was taken whole and this device's waiting change dropped. Worth a picture-level
 *   message ("your game was updated from another device").
 */
export type SyncState = 'synced' | 'pending' | 'offline' | 'replaced';

/** Retry after a failed cloud call: 2 s, doubling, at most 60 s. */
export const BACKOFF = Object.freeze({ firstMs: 2000, maxMs: 60_000 });

/**
 * Which copy of a save to keep: the one with the newer `updatedAt`, whole (never merged field by
 * field). `push`: the cloud needs the device's copy; `store`: the device needs the cloud's.
 */
export function reconcile(local: Save | null, remote: Save | null): { use: Save | null; push: boolean; store: boolean } {
  if (!local && !remote) return { use: null, push: false, store: false };
  if (!local) return { use: remote, push: false, store: true };
  if (!remote) return { use: local, push: true, store: false };
  if (local.updatedAt > remote.updatedAt) return { use: local, push: true, store: false };
  if (remote.updatedAt > local.updatedAt) return { use: remote, push: false, store: true };
  return { use: local, push: false, store: false };
}

export interface Decision { use: Save | null; push: boolean; store: boolean; replaced: boolean }

/**
 * `reconcile`, knowing which cloud version this device last synced with (`synced`, the
 * `updatedAt` of that version) and which one it may have just sent without hearing back
 * (`sent`). A save's `updatedAt` names a version (every edit gets a new, larger one), so this
 * compares identities, not clocks:
 *
 * - The cloud still holds what this device synced (or sent): nobody else wrote; the newer copy
 *   wins as in `reconcile`.
 * - The cloud holds something else: another device saved since. Its save is taken whole, even
 *   when this device's clock says its own change is newer; if this device had a change waiting,
 *   that change is dropped and `replaced` says so.
 * - This device never synced this player (`synced` null): `reconcile` alone decides.
 */
export function decide(local: Save | null, remote: Save | null, synced: number | null, sent: number | null = null): Decision {
  const plain = (): Decision => ({ ...reconcile(local, remote), replaced: false });
  if (!local || !remote || synced === null) return plain();
  if (remote.updatedAt === local.updatedAt) return plain();
  if (remote.updatedAt === synced || remote.updatedAt === sent) return plain();
  return { use: remote, push: false, store: true, replaced: local.updatedAt !== synced };
}

interface Listenable {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export interface SaveSyncOptions {
  /** The clock for `touch` (default `Date.now`). */
  now?: () => number;
  /** Where `online` fires (default `window`; null for none). */
  window?: Listenable | null;
  /** Where `visibilitychange` fires (default `document`; null for none). */
  document?: (Listenable & { visibilityState?: string }) | null;
}

/** `localStorage`, or undefined where there is none or touching it throws (as settings.ts). */
function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The hash of the pin last used on this device per slot, so a known player can log in offline. */
const hashKey = (slot: Slot): string => `lvt2_hash_${slot}`;
/** The `updatedAt` of the cloud version this device last synced with, per slot. */
export const syncedKey = (slot: Slot): string => `lvt2_synced_${slot}`;

/**
 * One logged-in player's save, kept on the device and in the cloud. `update` writes the device
 * copy at once and queues one cloud write (the latest save wins; a failed one is retried with
 * backoff 2 s → 60 s, and when the browser comes back online or the page becomes visible).
 * Every write is preceded by a read of the cloud's copy (`decide`), so a stale device — offline
 * for a while, or simply left open while another device played — adopts newer progress instead
 * of overwriting it.
 */
export class SaveSync {
  readonly state: Signal<SyncState> = signal<SyncState>('synced');
  /** The logged-in player's save, or null. Changes when the cloud's copy turns out newer. */
  readonly save: Signal<Save | null> = signal<Save | null>(null);

  private readonly now: () => number;
  private readonly win: Listenable | null;
  private readonly doc: (Listenable & { visibilityState?: string }) | null;
  private readonly storage: Storage | undefined;
  private hash: string | null = null;
  /** The cloud's copy must be read (to adopt it if newer), even with nothing to write. */
  private needsRead = false;
  /** The device copy has changes the cloud may not have. */
  private dirty = false;
  /** `updatedAt` of a write that failed without an answer: it may have landed. */
  private sent: number | null = null;
  /** Stopped until the next log-in (the pin was changed elsewhere, or the cloud refuses). */
  private stopped = false;
  private disposed = false;
  private session = 0;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delay: number = BACKOFF.firstMs;

  constructor(private readonly cloud: Cloud, storage?: Storage, opts: SaveSyncOptions = {}) {
    this.storage = storage ?? defaultStorage();
    this.now = opts.now ?? (() => Date.now());
    this.win = opts.window !== undefined ? opts.window : typeof window === 'undefined' ? null : window;
    this.doc = opts.document !== undefined ? opts.document : typeof document === 'undefined' ? null : document;
    this.win?.addEventListener('online', this.wake);
    this.doc?.addEventListener('visibilitychange', this.wake);
  }

  /**
   * Logs a player in with their pin. Online, the cloud decides whether the pin is right and
   * `decide` picks the copy to keep. Offline (or when the cloud refuses to answer), a player who
   * has logged in on this device before with the same pin plays on from the device copy, and the
   * cloud is checked when it can be. `no-save`: the pin is right but there is no save anywhere
   * (only a console edit can cause it); the screen can offer a fresh start with `adopt`.
   */
  async login(slot: Slot, pin: string): Promise<Save | CloudError | 'no-save'> {
    const hash = await pinHash(slot, pin);
    const local = loadLocal(slot, this.storage);
    const known = this.readString(hashKey(slot));
    const remote = await this.cloud.loadSave(slot, hash);
    if (this.disposed) return 'offline';
    if (remote === 'wrong-pin') return 'wrong-pin';
    if (typeof remote === 'string') {
      if (!local || known !== hash) return remote;
      this.begin(local, hash);
      this.needsRead = true;
      this.fail(remote);
      return local;
    }
    // The device copy counts only if it is this player's: the same pin was used here before,
    // or (after a grown-up reset the pin differs) it carries the same name and picture.
    const mine = local && (known === hash || (remote !== null && remote.name === local.name && remote.picture === local.picture))
      ? local : null;
    const d = decide(mine, remote, mine ? this.readSynced(slot) : null);
    if (!d.use) return 'no-save';
    this.begin(d.use, hash);
    if (d.store || mine !== local) saveLocal(d.use, this.storage);
    if (!d.push && remote) this.markSynced(remote);
    this.dirty = d.push;
    this.state.value = d.push ? 'pending' : d.replaced ? 'replaced' : 'synced';
    if (d.push) this.kick();
    return d.use;
  }

  /**
   * Creates a player in the cloud and logs them in. Nothing is kept on the device until the
   * cloud confirms; a retry after an answer was lost (the player exists with this very pin,
   * name and picture) counts as confirmed — whether the cloud then says `taken` or, when that
   * lost create was the 30th, `full`.
   */
  async create(save: Save, pin: string): Promise<Save | CloudError> {
    const hash = await pinHash(save.slot, pin);
    let res = await this.cloud.createPlayer(save, hash);
    let use = save;
    if (res === 'taken' || res === 'full') {
      const there = await this.cloud.loadSave(save.slot, hash);
      if (there === 'offline') return 'offline';
      if (there && typeof there === 'object' && there.name === save.name && there.picture === save.picture) {
        res = 'ok';
        use = there;
      }
    }
    if (this.disposed) return 'offline';
    if (res !== 'ok') return res;
    this.begin(use, hash);
    saveLocal(use, this.storage);
    this.markSynced(use);
    this.state.value = 'synced';
    return use;
  }

  /**
   * After `login` said `no-save`: makes `save` the player's save, in the cloud first (the pin is
   * checked again there), then on the device.
   */
  async adopt(save: Save, pin: string): Promise<Save | CloudError> {
    const hash = await pinHash(save.slot, pin);
    const res = await this.cloud.writeSave(save, hash);
    if (this.disposed) return 'offline';
    if (res !== 'ok') return res;
    this.begin(save, hash);
    saveLocal(save, this.storage);
    this.markSynced(save);
    this.state.value = 'synced';
    return save;
  }

  /** Changes the logged-in player's save: on the device at once, in the cloud as soon as it can. */
  update(fn: (s: Save) => Save): void {
    const cur = this.save.value;
    if (!cur) throw new Error('SaveSync.update with nobody logged in');
    let next = fn(cur);
    if (next === cur) return;
    if (next.updatedAt <= cur.updatedAt) next = touch(next, this.now());
    this.save.value = next;
    saveLocal(next, this.storage);
    this.dirty = true;
    if (this.state.value !== 'offline') this.state.value = 'pending';
    this.kick();
  }

  /** Tries the cloud now (skipping any backoff wait) and resolves when that attempt ends. */
  async flush(): Promise<void> {
    this.clearTimer();
    this.kick();
    await this.running;
  }

  /** Resolves when the cloud attempt under way, if any, ends (without starting one). */
  async idle(): Promise<void> {
    await this.running;
  }

  /** Forgets the logged-in player (their device copy stays and is pushed at the next log-in). */
  logout(): void {
    this.session += 1;
    this.clearTimer();
    this.hash = null;
    this.save.value = null;
    this.needsRead = this.dirty = this.stopped = false;
    this.sent = null;
    this.running = null;
    this.state.value = 'synced';
  }

  /** Stops every timer and listener. */
  dispose(): void {
    this.logout();
    this.disposed = true;
    this.win?.removeEventListener('online', this.wake);
    this.doc?.removeEventListener('visibilitychange', this.wake);
  }

  private begin(s: Save, hash: string): void {
    this.logout();
    this.hash = hash;
    this.save.value = s;
    this.writeString(hashKey(s.slot), hash);
    setLastSlot(s.slot, this.storage);
  }

  private readonly wake = (): void => {
    if (this.disposed || !this.save.value || this.stopped) return;
    if (this.doc?.visibilityState === 'hidden') return;
    // Another device may have saved meanwhile: look before the player carries on.
    this.needsRead = true;
    this.clearTimer();
    this.kick();
  };

  private kick(): void {
    if (this.disposed || this.stopped || this.running || this.timer !== null || !this.save.value) return;
    if (!this.needsRead && !this.dirty) return;
    const session = this.session;
    const run = this.run(session).finally(() => {
      if (this.session === session) this.running = null;
    });
    this.running = run;
  }

  /** Read, decide, and write if this device's copy should go up; again while changes keep coming. */
  private async run(session: number): Promise<void> {
    let replaced = false;
    while (this.session === session && (this.needsRead || this.dirty)) {
      const slot = this.save.value?.slot;
      const hash = this.hash;
      if (!slot || !hash) return;
      const remote = await this.cloud.loadSave(slot, hash);
      if (this.session !== session) return;
      if (typeof remote === 'string') return this.fail(remote);
      // Decide on the save as it is now: `update` may have run while we waited.
      const cur = this.save.value;
      if (!cur) return;
      const d = decide(cur, remote, this.readSynced(slot), this.sent);
      this.needsRead = false;
      this.sent = null;
      if (d.store && d.use) {
        this.save.value = d.use;
        saveLocal(d.use, this.storage);
      }
      if (d.replaced) replaced = true;
      if (!d.push) {
        if (remote) this.markSynced(remote);
        this.dirty = false;
        continue;
      }
      this.dirty = false;
      this.sent = cur.updatedAt;
      const res = await this.cloud.writeSave(cur, hash);
      if (this.session !== session) return;
      if (res !== 'ok') {
        this.dirty = true;
        return this.fail(res);
      }
      this.sent = null;
      this.markSynced(cur);
    }
    if (this.session !== session) return;
    this.delay = BACKOFF.firstMs;
    this.state.value = replaced ? 'replaced' : 'synced';
  }

  private fail(err: CloudError): void {
    this.state.value = 'offline';
    if (err === 'wrong-pin' || err === 'refused') {
      // The pin was changed on another device, or the cloud will not take this save: retrying
      // cannot help. The device copy keeps everything; the next log-in sorts it out.
      this.stopped = true;
      return;
    }
    const wait = this.delay;
    this.delay = Math.min(this.delay * 2, BACKOFF.maxMs);
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick();
    }, wait);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private markSynced(s: Save): void {
    this.writeString(syncedKey(s.slot), String(s.updatedAt));
  }

  private readSynced(slot: Slot): number | null {
    const v = Number(this.readString(syncedKey(slot)) ?? Number.NaN);
    return Number.isSafeInteger(v) ? v : null;
  }

  private readString(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private writeString(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      // Without it this device cannot log in offline or tell whose save is newer; it falls
      // back to comparing `updatedAt` alone. Online play is unaffected.
    }
  }
}
