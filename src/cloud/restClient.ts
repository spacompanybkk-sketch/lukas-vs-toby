import { isPicture, isSlot, parseSave, totalStars } from '../progress/save';
import type { Save, Slot } from '../progress/save';
// Types only: the fake (which evaluates rule strings with `new Function`) is loaded with a
// dynamic import, and only when the cloud mode is `fake`.
import type { FakeDatabase, FakeDatabaseOptions } from './fakeCloud';
import type { BoardRow, Cloud, CloudError, PublicPlayer, SaveRecord } from './types';

/** The old game's database (tag `old-game-final`, src/firebase/config.ts). */
export const DATABASE_URL = 'https://lukas-toby-plants-vs-zombies-default-rtdb.firebaseio.com';
export type CloudRoot = 'v2' | 'v2test';
export const TIMEOUT_MS = 5000;
export const MAX_PLAYERS = 30;
/** Where the fake database answers (never a real host). */
export const FAKE_DATABASE_URL = 'https://fake-rtdb.invalid';

/** The database's own clock, filled in when the write lands. */
const SERVER_NOW = Object.freeze({ '.sv': 'timestamp' });
const HASH = /^[0-9a-f]{64}$/;
const VER = /^[0-9a-f]{16}$/;

/** A fresh version id: 16 hex digits from `crypto.getRandomValues`. */
export function randomVer(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Shape only — anything that could leave the path (`/`, `..`) is refused before a request is made. */
const SLOT_SHAPE = /^p[0-9]{2}$/;

export interface RestCloudOptions {
  baseUrl?: string;
  root?: CloudRoot;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Version ids for writes that do not name one (default `randomVer`). */
  newVer?: () => string;
}

type Answer = { kind: 'ok'; data: unknown } | { kind: 'offline' } | { kind: 'denied' } | { kind: 'bad' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The save goes into the database as ONE JSON string. The database would otherwise drop empty
 * objects and lists and turn maps with number-like keys into lists; as a string it comes back
 * exactly as written and is parsed strictly.
 */
export const saveToWire = (s: Save): string => JSON.stringify(s);

export function saveFromWire(raw: unknown): Save | null {
  if (typeof raw !== 'string') return null;
  try {
    return parseSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The board row a save publishes, kept inside the rules' bounds; `updatedAt` is the server's clock. */
export function boardRowFor(s: Save): Record<string, unknown> {
  return {
    slot: s.slot, name: s.name, picture: s.picture,
    stars: Math.min(totalStars(s), 240),
    wave: Math.min(s.bestWave, 9999),
    versusWins: Math.min(s.versusWins, 99999),
    computerWins: Math.min(s.computerWins, 99999),
    updatedAt: SERVER_NOW,
  };
}

const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

function parsePlayers(data: unknown): PublicPlayer[] {
  if (!isObj(data)) return [];
  const out: PublicPlayer[] = [];
  for (const [slot, p] of Object.entries(data)) {
    if (!isSlot(slot) || !isObj(p) || typeof p.name !== 'string' || !isPicture(p.picture)) continue;
    out.push({ slot, name: p.name, picture: p.picture });
  }
  return out.sort((a, b) => a.slot.localeCompare(b.slot));
}

function parseBoard(data: unknown): BoardRow[] {
  if (!isObj(data)) return [];
  const out: BoardRow[] = [];
  for (const [slot, r] of Object.entries(data)) {
    if (!isSlot(slot) || !isObj(r) || typeof r.name !== 'string' || !isPicture(r.picture)) continue;
    const { stars, wave, versusWins, computerWins, updatedAt } = r;
    if (!count(stars) || !count(wave) || !count(versusWins) || !count(computerWins) || !count(updatedAt)) continue;
    out.push({ slot, name: r.name, picture: r.picture, stars, wave, versusWins, computerWins, updatedAt });
  }
  return out.sort((a, b) => a.slot.localeCompare(b.slot));
}

/**
 * The cloud over the Realtime Database REST API with plain `fetch` (no SDK). Every request
 * times out after 5 s; no answer, a timeout or a server error is `offline`; a rules refusal
 * (401/403) is `wrong-pin` or `refused` depending on the call.
 */
export class RestCloud implements Cloud {
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly newVer: () => string;

  constructor(opts: RestCloudOptions = {}) {
    this.newVer = opts.newVer ?? randomVer;
    this.base = `${opts.baseUrl ?? DATABASE_URL}/${opts.root ?? 'v2'}`;
    this.fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  }

  private async request(method: 'GET' | 'PUT' | 'PATCH', path: string, body?: unknown): Promise<Answer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(`${this.base}${path === '' ? '' : `/${path}`}.json`, {
        method,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
      });
      if (res.status === 401 || res.status === 403) return { kind: 'denied' };
      if (res.status >= 500 || res.status === 429 || res.status === 408) return { kind: 'offline' };
      if (!res.ok) return { kind: 'bad' };
      return { kind: 'ok', data: await res.json() };
    } catch {
      // Network failure, the timeout's abort, or a body that is not JSON (a captive portal page).
      return { kind: 'offline' };
    } finally {
      clearTimeout(timer);
    }
  }

  async listPlayers(): Promise<PublicPlayer[] | CloudError> {
    const a = await this.request('GET', 'players');
    if (a.kind === 'ok') return parsePlayers(a.data);
    return a.kind === 'offline' ? 'offline' : 'refused';
  }

  async createPlayer(save: Save, hash: string, ver: string = this.newVer()): Promise<'ok' | CloudError> {
    if (!SLOT_SHAPE.test(save.slot) || !HASH.test(hash) || !VER.test(ver)) return 'refused';
    const slot = save.slot;
    const a = await this.request('PATCH', '', {
      [`secrets/${slot}`]: hash,
      [`saves/${slot}/${hash}`]: { save: saveToWire(save), touch: SERVER_NOW, ver },
      [`players/${slot}`]: { name: save.name, picture: save.picture },
      [`board/${slot}`]: boardRowFor(save),
    });
    if (a.kind === 'ok') return 'ok';
    if (a.kind === 'offline') return 'offline';
    // Refused: say why, from what is public. The slot's own row first: an earlier attempt whose
    // answer was lost may have been the one to fill the list.
    const players = await this.listPlayers();
    if (typeof players === 'string') return players === 'offline' ? 'offline' : 'refused';
    if (players.some((p) => p.slot === slot)) return 'taken';
    if (players.length >= MAX_PLAYERS) return 'full';
    return 'refused';
  }

  async loadSave(slot: Slot, hash: string): Promise<Save | null | CloudError> {
    const r = await this.loadRecord(slot, hash);
    return r === null || typeof r === 'string' ? r : r.save;
  }

  async loadRecord(slot: Slot, hash: string): Promise<SaveRecord | null | CloudError> {
    if (!SLOT_SHAPE.test(slot) || !HASH.test(hash)) return 'refused';
    const a = await this.request('GET', `saves/${slot}/${hash}`);
    if (a.kind === 'denied') return 'wrong-pin';
    if (a.kind !== 'ok') return a.kind === 'offline' ? 'offline' : 'refused';
    if (a.data === null) return null;
    const s = isObj(a.data) ? saveFromWire(a.data.save) : null;
    const ver = isObj(a.data) ? a.data.ver : undefined;
    // Something is stored but unreadable (a newer game's save?): never treat it as "nothing".
    return s && s.slot === slot && typeof ver === 'string' && VER.test(ver) ? { save: s, ver } : 'refused';
  }

  async writeSave(save: Save, hash: string, ver: string, prev: string | null): Promise<'ok' | 'conflict' | CloudError> {
    if (!SLOT_SHAPE.test(save.slot) || !HASH.test(hash) || !VER.test(ver) || (prev !== null && !VER.test(prev))) return 'refused';
    const a = await this.request('PATCH', '', {
      [`saves/${save.slot}/${hash}`]: { save: saveToWire(save), touch: SERVER_NOW, ver, ...(prev === null ? {} : { prev }) },
      [`board/${save.slot}`]: boardRowFor(save),
    });
    if (a.kind === 'ok') return 'ok';
    if (a.kind === 'offline') return 'offline';
    if (a.kind === 'bad') return 'refused';
    // The database says only "permission denied": a wrong pin, or someone else wrote first.
    const there = await this.loadRecord(save.slot, hash);
    if (there === 'wrong-pin' || there === 'offline') return there;
    if (there !== null && typeof there === 'object' && there.ver !== prev) return 'conflict';
    return 'refused';
  }

  async board(): Promise<BoardRow[] | CloudError> {
    const a = await this.request('GET', 'board');
    if (a.kind === 'ok') return parseBoard(a.data);
    return a.kind === 'offline' ? 'offline' : 'refused';
  }

  async setGrownUpCode(hash: string): Promise<'ok' | CloudError> {
    if (!HASH.test(hash)) return 'refused';
    const a = await this.request('PUT', 'admin/secret', hash);
    return a.kind === 'ok' ? 'ok' : a.kind === 'offline' ? 'offline' : 'refused';
  }

  /** A new grown-up code, proven with the current one. */
  async changeGrownUpCode(oldHash: string, newHash: string): Promise<'ok' | CloudError> {
    if (!HASH.test(oldHash) || !HASH.test(newHash)) return 'refused';
    const a = await this.request('PATCH', '', {
      'admin/secret': newHash,
      [`admin/proof/${oldHash}`]: { touch: SERVER_NOW },
    });
    return a.kind === 'ok' ? 'ok' : a.kind === 'denied' ? 'wrong-pin' : a.kind === 'offline' ? 'offline' : 'refused';
  }

  async deletePlayer(slot: Slot, grownUpHash: string): Promise<'ok' | CloudError> {
    if (!SLOT_SHAPE.test(slot) || !HASH.test(grownUpHash)) return 'refused';
    const a = await this.request('PATCH', '', {
      [`secrets/${slot}`]: null,
      [`saves/${slot}`]: null,
      [`players/${slot}`]: null,
      [`board/${slot}`]: null,
      [`admin/proof/${grownUpHash}`]: { touch: SERVER_NOW },
    });
    return a.kind === 'ok' ? 'ok' : a.kind === 'denied' ? 'wrong-pin' : a.kind === 'offline' ? 'offline' : 'refused';
  }

  async resetPin(slot: Slot, grownUpHash: string, newHash: string, save: Save, ver: string = this.newVer()): Promise<'ok' | CloudError> {
    if (!SLOT_SHAPE.test(slot) || save.slot !== slot || !HASH.test(grownUpHash) || !HASH.test(newHash) || !VER.test(ver)) return 'refused';
    const a = await this.request('PATCH', '', {
      [`secrets/${slot}`]: newHash,
      // Replaces the slot's saves wholesale, so the save under the old hash goes too.
      [`saves/${slot}`]: { [newHash]: { save: saveToWire(save), touch: SERVER_NOW, ver } },
      [`players/${slot}`]: { name: save.name, picture: save.picture },
      [`board/${slot}`]: boardRowFor(save),
      [`admin/proof/${grownUpHash}`]: { touch: SERVER_NOW },
    });
    return a.kind === 'ok' ? 'ok' : a.kind === 'denied' ? 'wrong-pin' : a.kind === 'offline' ? 'offline' : 'refused';
  }
}

export type CloudMode = 'live' | 'test' | 'fake';

/**
 * Which cloud to use. Until the rules are deployed (build flag `VITE_CLOUD` is not `live`, the
 * default) it is always the fake. After that: `?cloud=fake` the fake, `?cloud=test` the
 * `v2test` root, otherwise the live `v2` root.
 */
export function cloudMode(search: string, flag: string | undefined): CloudMode {
  if (flag !== 'live') return 'fake';
  const asked = new URLSearchParams(search).get('cloud');
  return asked === 'fake' ? 'fake' : asked === 'test' ? 'test' : 'live';
}

/** A cloud over a fake database, with the real client on top. */
export function createFakeCloud(db: FakeDatabase, root: CloudRoot = 'v2', timeoutMs = TIMEOUT_MS): Cloud {
  return new RestCloud({ baseUrl: FAKE_DATABASE_URL, root, fetch: db.fetch, timeoutMs });
}

/**
 * A cloud whose implementation is loaded on first use. A load that fails (a missing chunk while
 * offline) answers `offline`, and is tried again on the next call.
 */
export function lazyCloud(load: () => Promise<Cloud>): Cloud {
  let pending: Promise<Cloud> | null = null;
  const get = (): Promise<Cloud> => {
    pending ??= load().catch((e: unknown) => {
      pending = null;
      throw e;
    });
    return pending;
  };
  return new Proxy({} as Cloud, {
    // Not a promise itself (`then`), and nothing behind symbol keys.
    get: (_t, key) => (key === 'then' || typeof key === 'symbol' ? undefined : async (...args: unknown[]) => {
      let cloud: Cloud;
      try {
        cloud = await get();
      } catch {
        return 'offline';
      }
      const fn = (cloud as unknown as Record<PropertyKey, unknown>)[key];
      if (typeof fn !== 'function') throw new TypeError(`Cloud has no ${String(key)}`);
      return (fn as (...a: unknown[]) => unknown).apply(cloud, args);
    }),
  });
}

export function createCloud(mode: CloudMode, fake: FakeDatabaseOptions = {}): Cloud {
  if (mode === 'fake') {
    return lazyCloud(async () => {
      const { FakeDatabase } = await import('./fakeCloud');
      return createFakeCloud(new FakeDatabase(fake));
    });
  }
  return new RestCloud({ root: mode === 'test' ? 'v2test' : 'v2' });
}

/** The cloud this page should use. */
export function defaultCloud(): Cloud {
  const search = typeof location === 'undefined' ? '' : location.search;
  const flag = import.meta.env.VITE_CLOUD as string | undefined;
  let storage: Storage | undefined;
  try {
    storage = typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    storage = undefined;
  }
  return createCloud(cloudMode(search, flag), storage ? { storage } : {});
}
