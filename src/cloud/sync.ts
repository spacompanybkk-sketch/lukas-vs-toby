import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { loadLocal, saveLocal, setLastSlot } from '../progress/localStore';
import { mergeSaves } from '../progress/merge';
import { touch } from '../progress/save';
import type { Save, Slot } from '../progress/save';
import { pinHash } from './hash';
import { randomVer } from './restClient';
import type { Cloud, CloudError, SaveRecord } from './types';

/**
 * - `synced`: the cloud has this device's save.
 * - `pending`: a change is on its way to the cloud.
 * - `offline`: the cloud could not be reached (or refuses); the device copy keeps everything.
 * - `merged`: another device had saved too, and both saves were joined into one (nothing lost).
 *   Worth a small cue on screen; it clears with the next change.
 */
export type SyncState = 'synced' | 'pending' | 'offline' | 'merged';

/** Retry after a failed cloud call: 2 s, doubling, at most 60 s. */
export const BACKOFF = Object.freeze({ firstMs: 2000, maxMs: 60_000 });

/** Write conflicts (another device wrote first) handled in a row before backing off. */
export const MAX_CONFLICTS = 5;

/**
 * Two copies with no shared history to go by: equal stamps → nothing to do; one missing → the
 * other; otherwise both are joined with `mergeSaves`, so a child never loses progress to a sync.
 */
export function reconcile(local: Save | null, remote: Save | null, now = 0): { use: Save | null; push: boolean; store: boolean } {
  if (!local && !remote) return { use: null, push: false, store: false };
  if (!local) return { use: remote, push: false, store: true };
  if (!remote) return { use: local, push: true, store: false };
  if (local.updatedAt === remote.updatedAt) return { use: local, push: false, store: false };
  return { use: mergeSaves(local, remote, now), push: true, store: true };
}

/** A version of the cloud record: its random id, and the `updatedAt` of the save it held. */
export interface Version { ver: string; at: number }

export interface Decision { use: Save | null; push: boolean; store: boolean; merged: boolean }

/**
 * What to do with the device copy `local` and the cloud record `remote`, knowing which version
 * this device last synced with (`base`) and which it sent without hearing back (`sent`):
 *
 * - The cloud holds `base` or `sent`: nobody else wrote since; only this device can have changed,
 *   so its copy goes up if it differs.
 * - The cloud holds a version this device never saw: if this device has not changed since `base`,
 *   it takes the cloud's copy; if it has (or its history is unknown), both are merged — stored
 *   here and pushed — so nothing either side earned is lost.
 */
export function decide(local: Save | null, remote: SaveRecord | null, base: Version | null, sent: Version | null, now: number): Decision {
  if (!remote) return { use: local, push: local !== null, store: false, merged: false };
  if (!local) return { use: remote.save, push: false, store: true, merged: false };
  const known = remote.ver === base?.ver || remote.ver === sent?.ver;
  if (known || local.updatedAt === remote.save.updatedAt) {
    // A device copy older than this device's own last version was rolled back: keep the version.
    if (local.updatedAt < remote.save.updatedAt) return { use: remote.save, push: false, store: true, merged: false };
    return { use: local, push: local.updatedAt !== remote.save.updatedAt, store: false, merged: false };
  }
  if (base !== null && local.updatedAt === base.at) return { use: remote.save, push: false, store: true, merged: false };
  return { use: mergeSaves(local, remote.save, now), push: true, store: true, merged: true };
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
  /** Version ids for writes (default `randomVer`, 16 hex digits from crypto.getRandomValues). */
  newVer?: () => string;
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
 * Per slot, the cloud version this device last synced with (`base`) and a write it sent without
 * hearing back (`sent`), kept across reloads so the device always recognises its own writes.
 */
export const syncKey = (slot: Slot): string => `lvt2_sync_${slot}`;

interface SyncRecord { base: Version | null; sent: Version | null }

const isVersion = (v: unknown): v is Version =>
  typeof v === 'object' && v !== null && typeof (v as Version).ver === 'string' && Number.isSafeInteger((v as Version).at);
const versionOf = (r: SaveRecord): Version => ({ ver: r.ver, at: r.save.updatedAt });

/**
 * One logged-in player's save, kept on the device and in the cloud. `update` writes the device
 * copy at once and queues one cloud write (the latest save wins; a failed one is retried with
 * backoff 2 s → 60 s, and when the browser comes back online or the page becomes visible).
 * Every write reads the cloud's record first (`decide`) and is a compare-and-swap on its version
 * id, so two devices never overwrite each other: whoever comes second merges and writes again.
 */
export class SaveSync {
  readonly state: Signal<SyncState> = signal<SyncState>('synced');
  /** The logged-in player's save, or null. Changes when another device's progress arrives. */
  readonly save: Signal<Save | null> = signal<Save | null>(null);

  private readonly now: () => number;
  private readonly newVer: () => string;
  private readonly win: Listenable | null;
  private readonly doc: (Listenable & { visibilityState?: string }) | null;
  private readonly storage: Storage | undefined;
  private hash: string | null = null;
  /** The cloud's record must be read (to take in another device's progress), even with nothing to write. */
  private needsRead = false;
  /** The device copy has changes the cloud may not have. */
  private dirty = false;
  /** A merge happened in this round; the state says so when the round ends. */
  private merged = false;
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
    this.newVer = opts.newVer ?? randomVer;
    this.win = opts.window !== undefined ? opts.window : typeof window === 'undefined' ? null : window;
    this.doc = opts.document !== undefined ? opts.document : typeof document === 'undefined' ? null : document;
    this.win?.addEventListener('online', this.wake);
    this.doc?.addEventListener('visibilitychange', this.wake);
  }

  /**
   * Logs a player in with their pin. Online, the cloud decides whether the pin is right and
   * `decide` picks (or merges) the copy to keep. Offline (or when the cloud refuses to answer), a
   * player who has logged in on this device before with the same pin plays on from the device
   * copy, and the cloud is checked when it can be. `no-save`: the pin is right but there is no
   * save anywhere (only a console edit can cause it); the screen can offer a fresh start with `adopt`.
   */
  async login(slot: Slot, pin: string): Promise<Save | CloudError | 'no-save'> {
    const hash = await pinHash(slot, pin);
    const local = loadLocal(slot, this.storage);
    const known = this.readString(hashKey(slot));
    const remote = await this.cloud.loadRecord(slot, hash);
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
    const mine = local && (known === hash || (remote !== null && remote.save.name === local.name && remote.save.picture === local.picture))
      ? local : null;
    const st = mine ? this.readSync(slot) : { base: null, sent: null };
    const d = decide(mine, remote, st.base, st.sent, this.now());
    if (!d.use) return 'no-save';
    this.begin(d.use, hash);
    if (d.store || mine !== local) saveLocal(d.use, this.storage);
    this.writeSync(slot, { base: remote ? versionOf(remote) : st.base, sent: remote ? null : st.sent });
    this.dirty = d.push;
    this.merged = d.merged;
    this.state.value = d.push ? 'pending' : 'synced';
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
    const ver = this.newVer();
    let res = await this.cloud.createPlayer(save, hash, ver);
    let rec: SaveRecord | null = null;
    if (res === 'taken' || res === 'full') {
      const there = await this.cloud.loadRecord(save.slot, hash);
      if (there === 'offline') return 'offline';
      if (there && typeof there === 'object' && there.save.name === save.name && there.save.picture === save.picture) {
        res = 'ok';
        rec = there;
      }
    }
    if (this.disposed) return 'offline';
    if (res !== 'ok') return res;
    const use = rec ? rec.save : save;
    this.begin(use, hash);
    saveLocal(use, this.storage);
    this.writeSync(use.slot, { base: rec ? versionOf(rec) : { ver, at: save.updatedAt }, sent: null });
    this.state.value = 'synced';
    return use;
  }

  /**
   * After `login` said `no-save`: makes `save` the player's save, in the cloud first (the pin is
   * checked again there), then on the device.
   */
  async adopt(save: Save, pin: string): Promise<Save | CloudError> {
    const hash = await pinHash(save.slot, pin);
    const ver = this.newVer();
    const res = await this.cloud.writeSave(save, hash, ver, null);
    if (this.disposed) return 'offline';
    if (res === 'conflict') return 'refused';
    if (res !== 'ok') return res;
    this.begin(save, hash);
    saveLocal(save, this.storage);
    this.writeSync(save.slot, { base: { ver, at: save.updatedAt }, sent: null });
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
    this.needsRead = this.dirty = this.stopped = this.merged = false;
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
    // Another device may have saved meanwhile: take it in before the player carries on.
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

  /** Read, decide (maybe merge), and compare-and-swap the device's copy up; again while changes keep coming. */
  private async run(session: number): Promise<void> {
    let conflicts = 0;
    while (this.session === session && (this.needsRead || this.dirty)) {
      const slot = this.save.value?.slot;
      const hash = this.hash;
      if (!slot || !hash) return;
      const remote = await this.cloud.loadRecord(slot, hash);
      if (this.session !== session) return;
      if (typeof remote === 'string') return this.fail(remote);
      // Decide on the save as it is now: `update` may have run while we waited.
      const cur = this.save.value;
      if (!cur) return;
      const st = this.readSync(slot);
      const d = decide(cur, remote, st.base, st.sent, this.now());
      this.needsRead = false;
      this.dirty = false;
      if (d.merged) this.merged = true;
      if (d.store && d.use) {
        this.save.value = d.use;
        saveLocal(d.use, this.storage);
      }
      const base = remote ? versionOf(remote) : st.base;
      if (!d.push || !d.use) {
        this.writeSync(slot, { base, sent: null });
        continue;
      }
      const out = d.use;
      const ver = this.newVer();
      // Remembered before sending, so a reload after a lost answer still knows this write.
      this.writeSync(slot, { base, sent: { ver, at: out.updatedAt } });
      const res = await this.cloud.writeSave(out, hash, ver, remote ? remote.ver : null);
      if (this.session !== session) return;
      if (res === 'ok') {
        this.writeSync(slot, { base: { ver, at: out.updatedAt }, sent: null });
        continue;
      }
      this.dirty = true;
      if (res === 'conflict') {
        // Another device wrote between our read and our write: read again, merge, retry.
        conflicts += 1;
        if (conflicts < MAX_CONFLICTS) continue;
        return this.fail('offline');
      }
      this.needsRead = true;
      return this.fail(res);
    }
    if (this.session !== session) return;
    this.delay = BACKOFF.firstMs;
    this.state.value = this.merged ? 'merged' : 'synced';
    this.merged = false;
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

  private readSync(slot: Slot): SyncRecord {
    try {
      const o = JSON.parse(this.readString(syncKey(slot)) ?? 'null') as Partial<SyncRecord> | null;
      return { base: isVersion(o?.base) ? o.base : null, sent: isVersion(o?.sent) ? o.sent : null };
    } catch {
      return { base: null, sent: null };
    }
  }

  private writeSync(slot: Slot, r: SyncRecord): void {
    this.writeString(syncKey(slot), JSON.stringify(r));
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
      // Without it this device cannot log in offline or recognise its own writes; it then
      // merges (losing nothing). Online play is unaffected.
    }
  }
}
