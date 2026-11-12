import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { loadLocal, saveLocal, setLastSlot } from '../progress/localStore';
import { touch } from '../progress/save';
import type { Save, Slot } from '../progress/save';
import { pinHash } from './hash';
import type { Cloud, CloudError } from './types';

export type SyncState = 'synced' | 'pending' | 'offline';

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

/**
 * One logged-in player's save, kept on the device and in the cloud. `update` writes the device
 * copy at once and queues one cloud write (the latest save wins; a failed one is retried with
 * backoff 2 s → 60 s, and when the browser comes back online or the page becomes visible).
 * After any doubt about the cloud (log-in while offline, a failed call, the page coming back)
 * the cloud's copy is read first and the newer one kept, so a stale device never overwrites
 * newer progress made elsewhere.
 */
export class SaveSync {
  readonly state: Signal<SyncState> = signal<SyncState>('synced');
  /** The logged-in player's save, or null. Changes when the cloud's copy turns out newer. */
  readonly save: Signal<Save | null> = signal<Save | null>(null);

  private readonly now: () => number;
  private readonly win: Listenable | null;
  private readonly doc: (Listenable & { visibilityState?: string }) | null;
  private hash: string | null = null;
  /** The cloud's copy must be read before writing. */
  private needsRead = false;
  /** The device copy has changes the cloud may not have. */
  private dirty = false;
  /** Stopped until the next log-in (the pin was changed elsewhere, or the cloud refuses). */
  private stopped = false;
  private disposed = false;
  private session = 0;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delay: number = BACKOFF.firstMs;

  private readonly storage: Storage | undefined;

  constructor(private readonly cloud: Cloud, storage?: Storage, opts: SaveSyncOptions = {}) {
    this.storage = storage ?? defaultStorage();
    this.now = opts.now ?? (() => Date.now());
    this.win = opts.window !== undefined ? opts.window : typeof window === 'undefined' ? null : window;
    this.doc = opts.document !== undefined ? opts.document : typeof document === 'undefined' ? null : document;
    this.win?.addEventListener('online', this.wake);
    this.doc?.addEventListener('visibilitychange', this.wake);
  }

  /**
   * Logs a player in with their pin. Online, the cloud decides whether the pin is right and the
   * newer of the two copies is kept. Offline, a player who has logged in on this device before
   * with the same pin plays on from the device copy, and the cloud is checked when it returns.
   */
  async login(slot: Slot, pin: string): Promise<Save | CloudError> {
    const hash = await pinHash(slot, pin);
    const local = loadLocal(slot, this.storage);
    const known = this.readHash(slot);
    const remote = await this.cloud.loadSave(slot, hash);
    if (this.disposed) return 'offline';
    if (remote === 'wrong-pin') return 'wrong-pin';
    if (typeof remote === 'string') {
      if (!local || known !== hash) return remote;
      this.begin(local, hash);
      this.needsRead = true;
      this.fail('offline');
      return local;
    }
    // The device copy counts only if it is this player's: the same pin was used here before,
    // or (after a grown-up reset the pin differs) it carries the same name and picture.
    const mine = local && (known === hash || (remote !== null && remote.name === local.name && remote.picture === local.picture))
      ? local : null;
    const r = reconcile(mine, remote);
    if (!r.use) return 'refused';
    this.begin(r.use, hash);
    if (r.store || mine !== local) saveLocal(r.use, this.storage);
    this.dirty = r.push;
    this.state.value = r.push ? 'pending' : 'synced';
    if (r.push) this.kick();
    return r.use;
  }

  /**
   * Creates a player in the cloud and logs them in. Nothing is kept on the device until the
   * cloud confirms; a retry after an answer was lost (the player exists with this very pin and
   * save) counts as confirmed.
   */
  async create(save: Save, pin: string): Promise<Save | CloudError> {
    const hash = await pinHash(save.slot, pin);
    let res = await this.cloud.createPlayer(save, hash);
    let use = save;
    if (res === 'taken') {
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
    this.state.value = 'synced';
    return use;
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
    this.writeHash(s.slot, hash);
    setLastSlot(s.slot, this.storage);
  }

  private readonly wake = (): void => {
    if (this.disposed || !this.save.value || this.stopped) return;
    if (this.doc?.visibilityState === 'hidden') return;
    // Another device may have saved meanwhile: look before writing again.
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

  private async run(session: number): Promise<void> {
    while (this.session === session && (this.needsRead || this.dirty)) {
      const cur = this.save.value;
      const hash = this.hash;
      if (!cur || !hash) return;
      if (this.needsRead) {
        const remote = await this.cloud.loadSave(cur.slot, hash);
        if (this.session !== session) return;
        if (typeof remote === 'string') return this.fail(remote);
        // Compare with the save as it is now: `update` may have run while we waited.
        const r = reconcile(this.save.value, remote);
        if (r.store && r.use) {
          this.save.value = r.use;
          saveLocal(r.use, this.storage);
        }
        this.needsRead = false;
        this.dirty = r.push;
        continue;
      }
      this.dirty = false;
      const res = await this.cloud.writeSave(cur, hash);
      if (this.session !== session) return;
      if (res !== 'ok') {
        this.dirty = true;
        // It may have landed anyway (a lost answer), or someone else may write meanwhile.
        this.needsRead = true;
        return this.fail(res);
      }
    }
    if (this.session !== session) return;
    this.delay = BACKOFF.firstMs;
    this.state.value = 'synced';
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

  private readHash(slot: Slot): string | null {
    try {
      return this.storage?.getItem(hashKey(slot)) ?? null;
    } catch {
      return null;
    }
  }

  private writeHash(slot: Slot, hash: string): void {
    try {
      this.storage?.setItem(hashKey(slot), hash);
    } catch {
      // Without it this player cannot log in offline on this device; online is unaffected.
    }
  }
}
