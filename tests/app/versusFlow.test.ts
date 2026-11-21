import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HEAD_STEP } from '../../src/ai/versus';
import { VCREDITED_KEY, VMATCH_KEY, VersusFlow } from '../../src/app/versus';
import type { VersusPhase } from '../../src/app/versus';
import { board } from '../../src/app/board';
import { PlayerSession } from '../../src/app/session';
import { fakeConnection } from '../../src/cloud/connection';
import type { Connection, EventSourceLike } from '../../src/cloud/connection';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { pinHash } from '../../src/cloud/hash';
import { createFakeCloud } from '../../src/cloud/restClient';
import type { CloudRoot } from '../../src/cloud/restClient';
import { readMatch } from '../../src/cloud/versusMatch';
import type { LockstepMatch, VersusOutcome } from '../../src/net/lockstepMatch';
import { VS_TIMEOUTS } from '../../src/net/timeouts';
import { VirtualClock } from '../../src/net/virtualClock';
import { newSave } from '../../src/progress/save';
import type { Slot } from '../../src/progress/save';
import type { CardKey, Faction } from '../../src/sim/types';
import { T0 } from '../cloud/helpers';
import { MemoryStorage } from '../progress/memoryStorage';

/**
 * The Versus journey as one model (spec 4, 5, 6.7, 6.8, 7.3, 9, 12): two or three devices, each
 * with its own session, storage and `VersusFlow`, over ONE fake database that checks every
 * request against the real rules and streams as the REST API does. Time is a virtual clock.
 */

const BUILD = '2289558';
const FRAME = 1000 / 30;
const PINS: Record<string, string> = { p01: '123', p02: '456' };
const PEOPLE: Record<string, { name: string; picture: CardKey }> = {
  p01: { name: 'Lukas', picture: 'peashooter' },
  p02: { name: 'Toby', picture: 'brainEater' },
};

let clock: VirtualClock;
let db: FakeDatabase;
let root: CloudRoot;
let devices: Dev[] = [];

interface Dev {
  slot: Slot;
  session: PlayerSession;
  storage: MemoryStorage;
  flag: MemoryStorage;
  flow: VersusFlow;
  w: Watched;
  reload: ReturnType<typeof vi.fn>;
  /** The most streams this device ever had open at once. */
  peak: () => number;
}

interface Watched { conn: Connection; open: number; maxOpen: number; dropReady: boolean }

/** A device's connection: counts its open streams; `dropReady` makes every write of a `ready` node fail as offline. */
function watched(): Watched {
  const base = fakeConnection(db, root);
  const w: Watched = { conn: base, open: 0, maxOpen: 0, dropReady: false };
  w.conn = {
    ...base,
    fetch: (input, init) => {
      if (w.dropReady && init?.method === 'PATCH' && typeof init.body === 'string' && init.body.includes('/ready/')) return Promise.reject(new Error('offline'));
      return base.fetch(input, init);
    },
    eventSource: (url) => {
      const es = base.eventSource(url);
      w.open++;
      w.maxOpen = Math.max(w.maxOpen, w.open);
      let closed = false;
      const out: EventSourceLike = {
        addEventListener: (type, fn) => es.addEventListener(type, fn),
        close: () => {
          if (!closed) w.open--;
          closed = true;
          es.close();
        },
        get onerror() { return es.onerror; },
        set onerror(f) { es.onerror = f; },
      };
      return out;
    },
  };
  return w;
}

/** Lets every queued answer and stream event arrive (fetch, `Response.json`, WebCrypto, `EventSource`). */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

/** Moves time on until `done`, in small steps, letting answers and events arrive between them. */
async function until(done: () => boolean, maxMs = 90_000, stepMs = 50): Promise<void> {
  for (let left = maxMs; left > 0 && !done(); left -= stepMs) {
    await settle();
    if (done()) break;
    clock.advance(stepMs);
    for (const d of devices) expect(d.w.open, `${d.slot}'s open streams`).toBeLessThanOrEqual(3);
  }
  await settle();
  expect(done()).toBe(true);
}

/** Moves time on by `ms` whatever happens. */
async function pass(ms: number, stepMs = 50): Promise<void> {
  for (let left = ms; left > 0; left -= stepMs) {
    await settle();
    clock.advance(Math.min(stepMs, left));
    for (const d of devices) expect(d.w.open, `${d.slot}'s open streams`).toBeLessThanOrEqual(3);
  }
  await settle();
}

async function device(
  slot: Slot,
  o: { build?: string; storage?: MemoryStorage; dropReady?: boolean; testBaseHp?: number; menu?: boolean } = {},
): Promise<Dev> {
  const storage = o.storage ?? new MemoryStorage();
  const flag = new MemoryStorage();
  const session = new PlayerSession();
  const now = (): number => T0 + clock.now();
  session.configure({ cloud: createFakeCloud(db, root), storage, now, window: null, document: null, mode: 'fake' });
  const w = watched();
  w.dropReady = o.dropReady === true;
  const reload = vi.fn();
  expect(typeof await session.login(slot, PINS[slot]!)).toBe('object');
  const flow = new VersusFlow({
    conn: () => Promise.resolve(w.conn), session, now, timers: clock, build: o.build ?? BUILD, reload, flag,
    ...(o.testBaseHp !== undefined ? { testBaseHp: o.testBaseHp } : {}),
  });
  const dev: Dev = { slot, session, storage, flag, flow, w, reload, peak: () => w.maxOpen };
  devices.push(dev);
  if (o.menu !== false) flow.onMenu(true);
  return dev;
}

/** A device whose lobby has started and that has heard the other (the list shows `slots`). */
const seeing = (d: Dev, ...slots: Slot[]) => (): boolean => d.flow.here.value.map((h) => h.slot).join() === slots.join();

const name = (d: Dev): VersusPhase['name'] => d.flow.phase.value.name;
const phaseOf = <N extends VersusPhase['name']>(d: Dev, n: N): Extract<VersusPhase, { name: N }> => {
  const p = d.flow.phase.value;
  if (p.name !== n) throw new Error(`${d.slot} is in ${p.name}, not ${n}`);
  return p as Extract<VersusPhase, { name: N }>;
};

/** Toby (p02) invites Lukas (p01) and Lukas has the panel up. */
async function invite(toby: Dev, lukas: Dev): Promise<void> {
  await until(seeing(toby, 'p01'));
  await until(seeing(lukas, 'p02'));
  toby.flow.open();
  toby.flow.pick('p01');
  toby.flow.send();
  await until(() => lukas.flow.incoming.value !== null);
}

/** Both are in the battle, link not yet started. */
async function intoBattle(a: Dev, b: Dev): Promise<void> {
  await until(() => name(a) === 'battle' && name(b) === 'battle');
}

const linkOf = (d: Dev): LockstepMatch => {
  const o = phaseOf(d, 'battle').options.online;
  if (!o) throw new Error('no online seat');
  return o.link;
};

const matchIds = (): string[] => Object.keys((db.peek(`${root}/vs/matches`) ?? {}) as object);

beforeEach(async () => {
  clock = new VirtualClock();
  db = new FakeDatabase({ now: () => T0 + clock.now() });
  root = 'v2';
  devices = [];
  for (const r of ['v2', 'v2test'] as const) {
    const cloud = createFakeCloud(db, r);
    for (const slot of ['p01', 'p02'] as const) {
      const p = PEOPLE[slot]!;
      expect(await cloud.createPlayer(newSave(slot, p.name, p.picture, T0), await pinHash(slot, PINS[slot]!))).toBe('ok');
    }
  }
  board.configure({ cloud: createFakeCloud(db, root), storage: new MemoryStorage() });
  clock.advance(1000);
});

afterEach(() => {
  for (const d of devices) {
    d.flow.dispose();
    d.session.dispose();
  }
  devices = [];
});

describe('who is here, the card, the invite panel', () => {
  it('Toby sees Lukas, picks him: Toby on zombies with his head start; swap moves the step only while untouched; send shows the panel on Lukas only on a menu', async () => {
    const lukas = await device('p01');
    const toby = await device('p02');
    await until(seeing(toby, 'p01'));
    expect(toby.flow.allowed.value).toBe(true);
    expect(toby.flow.here.value).toEqual([{ slot: 'p01', name: 'Lukas', picture: 'peashooter', busy: false }]);
    toby.flow.open();
    expect(name(toby)).toBe('here');
    toby.flow.pick('p01');
    let card = phaseOf(toby, 'card');
    expect(card.state).toBe('draft');
    expect(card.draft.me).toEqual({ slot: 'p02', name: 'Toby', picture: 'brainEater' });
    expect(card.draft.them).toEqual({ slot: 'p01', name: 'Lukas', picture: 'peashooter' });
    expect(card.draft.mySide).toBe('zombies');
    expect(card.draft.head).toEqual({ slot: 'p02', step: DEFAULT_HEAD_STEP.zombies });

    toby.flow.swap();
    card = phaseOf(toby, 'card');
    expect(card.draft.mySide).toBe('plants');
    expect(card.draft.head).toEqual({ slot: 'p02', step: DEFAULT_HEAD_STEP.plants });
    toby.flow.swap();
    expect(phaseOf(toby, 'card').draft.head?.step).toBe(DEFAULT_HEAD_STEP.zombies);
    toby.flow.head(1);
    expect(phaseOf(toby, 'card').draft.head).toEqual({ slot: 'p02', step: 1 });
    toby.flow.swap();
    expect(phaseOf(toby, 'card').draft.mySide).toBe('plants');
    expect(phaseOf(toby, 'card').draft.head).toEqual({ slot: 'p02', step: 1 }); // touched: it stays
    toby.flow.head(9); // not a step
    expect(phaseOf(toby, 'card').draft.head?.step).toBe(1);

    expect(lukas.flow.incoming.value).toBeNull();
    toby.flow.send();
    expect(phaseOf(toby, 'card').state).toBe('waiting');
    await until(() => lukas.flow.incoming.value !== null);
    expect(lukas.flow.incoming.value).toEqual({
      from: { slot: 'p02', name: 'Toby', picture: 'brainEater' },
      me: { slot: 'p01', name: 'Lukas', picture: 'peashooter' },
      mySide: 'zombies', // Toby is the plants now
      head: { slot: 'p02', step: 1 },
    });
    lukas.flow.onMenu(false);
    expect(lukas.flow.incoming.value).toBeNull();
    lukas.flow.onMenu(true);
    expect(lukas.flow.incoming.value?.from.slot).toBe('p02');
    // while Lukas is in an Adventure level he shows busy
    lukas.flow.onMenu(false);
    await until(() => toby.flow.here.value[0]?.busy === true);
  });

  it('a face that is not on the list cannot be picked, and the cross closes the card and takes the invite back', async () => {
    const lukas = await device('p01');
    const toby = await device('p02');
    await until(seeing(toby, 'p01'));
    toby.flow.open();
    toby.flow.pick('p09' as Slot);
    expect(name(toby)).toBe('here');
    toby.flow.pick('p01');
    toby.flow.send();
    await until(() => lukas.flow.incoming.value !== null);
    toby.flow.closeCard();
    expect(name(toby)).toBe('here');
    await until(() => lukas.flow.incoming.value === null);
    expect(db.peek(`${root}/vs/lobby/p01/in/p02`)).toBeNull();
  });
});

describe('accept, getting ready, the battle', () => {
  it('Lukas accepts: both reach ready and then the battle with the card seats, one match id, the delay from inputDelay, busy heartbeats, the lobby streams closed', async () => {
    const lukas = await device('p01');
    const toby = await device('p02');
    await invite(toby, lukas);
    toby.flow.head(2);
    lukas.flow.accept();
    await until(() => name(lukas) === 'ready' || name(lukas) === 'battle');
    await intoBattle(lukas, toby);
    const ids = matchIds();
    expect(ids).toHaveLength(1);
    const stored = await readMatch(fakeConnection(db, root), ids[0]!, clock);
    if (stored === null || stored === 'offline') throw new Error('no match stored');
    expect(stored.meta.seats).toEqual({ plants: 'p01', zombies: 'p02' }); // as on the card: Toby zombies
    expect(stored.meta.host).toBe('p01'); // the invitee
    expect(stored.meta.head).toEqual({ slot: 'p02', step: DEFAULT_HEAD_STEP.zombies });
    expect(stored.meta.delay).toBeGreaterThanOrEqual(9);
    expect(stored.meta.delay).toBeLessThanOrEqual(30);
    expect(stored.control.filter((c) => c.kind === 'ready').map((c) => (c as { seat: Faction }).seat).sort()).toEqual(['plants', 'zombies']);

    const a = phaseOf(lukas, 'battle').options;
    const b = phaseOf(toby, 'battle').options;
    expect([a.playerFaction, b.playerFaction]).toEqual(['plants', 'zombies']);
    expect([a.versus, b.versus]).toEqual([true, true]);
    expect(a.online?.me).toBe('p01');
    expect(a.online?.other).toBe('p02');
    expect(b.online?.me).toBe('p02');
    expect(a.online?.link.seat).toBe('plants');
    expect(b.online?.link.host).toBe(false);
    expect(a.online?.link.host).toBe(true);
    // both busy, and the lobby's streams are closed: nothing is open until the links start
    await until(() => (db.peek(`${root}/vs/here/p01`) as { busy: boolean }).busy === true && (db.peek(`${root}/vs/here/p02`) as { busy: boolean }).busy === true);
    expect(lukas.w.open).toBe(0);
    expect(toby.w.open).toBe(0);
    expect(lukas.session.deviceStorage()?.getItem(VMATCH_KEY)).toContain(ids[0]!);
    lukas.flow.battleBegan();
    toby.flow.battleBegan();
    await pass(500);
    expect(lukas.w.open).toBe(2);
    expect(toby.w.open).toBe(2);
    expect(lukas.peak()).toBeLessThanOrEqual(3);
    expect(toby.peak()).toBeLessThanOrEqual(3);
    // the heartbeat goes on while they play
    const at = (db.peek(`${root}/vs/here/p01`) as { at: number }).at;
    await pass(VS_TIMEOUTS.heartbeatMs + 1000);
    expect((db.peek(`${root}/vs/here/p01`) as { at: number; busy: boolean }).at).toBeGreaterThan(at);
    expect((db.peek(`${root}/vs/here/p01`) as { busy: boolean }).busy).toBe(true);
  });

  it('declined: the card shows refused for 2 s, then the list; the invite is gone', async () => {
    const lukas = await device('p01');
    const toby = await device('p02');
    await invite(toby, lukas);
    lukas.flow.decline();
    expect(lukas.flow.incoming.value).toBeNull();
    await until(() => phaseOf(toby, 'card').state === 'refused');
    await pass(1500);
    expect(name(toby)).toBe('card');
    await pass(700);
    expect(name(toby)).toBe('here');
    expect(matchIds()).toEqual([]);
  });

  it('no answer: the card expires at 60 s, shakes, and goes back to the list; the invite is taken back', async () => {
    const lukas = await device('p01');
    const toby = await device('p02');
    await invite(toby, lukas);
    await pass(VS_TIMEOUTS.inviteMs - 2000);
    expect(phaseOf(toby, 'card').state).toBe('waiting');
    await pass(2500);
    expect(phaseOf(toby, 'card').state).toBe('expired');
    await pass(1200);
    expect(name(toby)).toBe('here');
    expect(db.peek(`${root}/vs/lobby/p01/in/p02`)).toBeNull();
    expect(lukas.flow.incoming.value).toBeNull();
  });

  it('getting ready not complete in 30 s: both show the shrug, and each goes back to the list from it', async () => {
    const lukas = await device('p01', { dropReady: true });
    const toby = await device('p02');
    await invite(toby, lukas);
    lukas.flow.accept();
    await until(() => name(lukas) === 'ready' && name(toby) === 'ready');
    expect(phaseOf(toby, 'ready').blocks).toMatchObject({ connected: true, bothReady: false, sameBuild: true });
    await pass(VS_TIMEOUTS.readyMs - 2000);
    expect(name(toby)).toBe('ready');
    await pass(3000);
    await until(() => name(lukas) === 'notice' && name(toby) === 'notice');
    expect(phaseOf(lukas, 'notice').kind).toBe('shrug');
    expect(phaseOf(toby, 'notice').kind).toBe('shrug');
    expect(lukas.reload).not.toHaveBeenCalled();
    lukas.flow.home();
    toby.flow.home();
    expect(name(lukas)).toBe('here');
    expect(name(toby)).toBe('here');
    await until(() => matchIds().length === 0);
  });

  it('different builds: both show the update picture and reload once (the session flag)', async () => {
    const lukas = await device('p01', { build: 'aaaaaaa' });
    const toby = await device('p02', { build: 'bbbbbbb' });
    await until(seeing(toby, 'p01'));
    toby.flow.open();
    toby.flow.pick('p01');
    toby.flow.send();
    await until(() => lukas.flow.incoming.value !== null);
    lukas.flow.accept();
    await until(() => name(lukas) === 'notice' && name(toby) === 'notice');
    expect(phaseOf(lukas, 'notice').kind).toBe('update');
    expect(phaseOf(toby, 'notice').kind).toBe('update');
    expect(lukas.reload).toHaveBeenCalledTimes(1);
    expect(toby.reload).toHaveBeenCalledTimes(1);
    expect(matchIds()).toEqual([]);
    // a second mismatch in the same browser session does not reload again
    toby.flow.home();
    lukas.flow.home();
    await until(seeing(toby, 'p01'));
    toby.flow.pick('p01');
    toby.flow.send();
    await until(() => lukas.flow.incoming.value !== null);
    lukas.flow.accept();
    await until(() => name(toby) === 'notice');
    expect(toby.reload).toHaveBeenCalledTimes(1);
  });
});
