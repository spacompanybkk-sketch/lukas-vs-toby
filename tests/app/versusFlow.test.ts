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

describe('Review Focus 2 and 3: crossed invites, the same player on two devices', () => {
  it('both pick each other in the same second: one meta, Lukas (the lower slot) stands, Toby withdraws and is shown Lukas', async () => {
    const lukas = await device('p01');
    const toby = await device('p02');
    await until(seeing(toby, 'p01'));
    await until(seeing(lukas, 'p02'));
    lukas.flow.open();
    toby.flow.open();
    lukas.flow.pick('p02');
    toby.flow.pick('p01');
    lukas.flow.send();
    toby.flow.send();
    // Toby's card closes and Lukas's invite is the panel on his device; Lukas's own card stays and his panel stays hidden
    await until(() => toby.flow.incoming.value !== null);
    expect(toby.flow.incoming.value?.from.slot).toBe('p01');
    expect(name(toby)).toBe('here');
    expect(name(lukas)).toBe('card');
    expect(phaseOf(lukas, 'card').state).toBe('waiting');
    await pass(1000);
    expect(lukas.flow.incoming.value).toBeNull();
    expect(db.peek(`${root}/vs/lobby/p01/in/p02`)).toBeNull(); // Toby's invite was taken back
    expect(db.peek(`${root}/vs/lobby/p02/in/p01`)).not.toBeNull(); // Lukas's stands
    expect(matchIds()).toEqual([]);

    toby.flow.accept();
    await intoBattle(lukas, toby);
    expect(matchIds()).toHaveLength(1);
    expect(phaseOf(toby, 'battle').options.playerFaction).toBe('zombies'); // Lukas's card stood: he is the plants
  });

  it('a second device of the same player accepting after the first: its panel closes, its phase stays, no notice; exactly one match', async () => {
    const lukas = await device('p01');
    const lukas2 = await device('p01');
    const toby = await device('p02');
    await until(seeing(toby, 'p01'));
    toby.flow.open();
    toby.flow.pick('p01');
    toby.flow.send();
    await until(() => lukas.flow.incoming.value !== null && lukas2.flow.incoming.value !== null);
    lukas2.flow.open();
    const before = name(lukas2);
    lukas.flow.accept();
    lukas2.flow.accept(); // both pressed within the same moment: the first answer wins (meta is write-once)
    await until(() => name(lukas) === 'battle' || name(lukas2) === 'battle');
    await until(() => lukas.flow.incoming.value === null && lukas2.flow.incoming.value === null);
    const winner = name(lukas) === 'battle' ? lukas : lukas2;
    const loser = winner === lukas ? lukas2 : lukas;
    await until(() => name(toby) === 'battle');
    expect(name(loser)).toBe(loser === lukas2 ? before : 'closed');
    expect(['closed', 'here']).toContain(name(loser));
    expect(loser.reload).not.toHaveBeenCalled();
    expect(matchIds()).toHaveLength(1);
  });

  it('a second device accepting well after the first answered: nothing is written, its panel is already gone', async () => {
    const lukas = await device('p01');
    const lukas2 = await device('p01');
    const toby = await device('p02');
    await until(seeing(toby, 'p01'));
    toby.flow.open();
    toby.flow.pick('p01');
    toby.flow.send();
    await until(() => lukas.flow.incoming.value !== null && lukas2.flow.incoming.value !== null);
    lukas.flow.accept();
    await until(() => name(lukas) === 'battle');
    await until(() => lukas2.flow.incoming.value === null);
    lukas2.flow.accept(); // nothing to accept
    await pass(1000);
    expect(name(lukas2)).toBe('closed');
    expect(matchIds()).toHaveLength(1);
  });
});

/** Both devices in the battle with their links started; `go` plays the match with no taps. */
async function battle(testBaseHp?: number): Promise<{ lukas: Dev; toby: Dev; id: string; play: (frames: number) => Promise<void> }> {
  const lukas = await device('p01', testBaseHp === undefined ? {} : { testBaseHp });
  const toby = await device('p02', testBaseHp === undefined ? {} : { testBaseHp });
  await invite(toby, lukas);
  lukas.flow.accept();
  await intoBattle(lukas, toby);
  lukas.flow.battleBegan();
  toby.flow.battleBegan();
  const id = matchIds()[0]!;
  const play = async (frames: number): Promise<void> => {
    for (let i = 0; i < frames; i++) {
      clock.advance(FRAME);
      await settle();
      for (const d of [lukas, toby]) if (d.flow.phase.value.name === 'battle') linkOf(d).tryStep();
    }
  };
  return { lukas, toby, id, play };
}

const won = (winner: Faction | 'draw'): VersusOutcome => ({ kind: 'won', winner });
const wins = (d: Dev): number => d.session.player.peek()!.versusWins;
const lastBattle = (d: Dev): string | null => d.session.player.peek()!.lastBattle;

describe('the credit', () => {
  it('a win credits the winner once and the loser a plain loss; a second outcome changes nothing; no coins', async () => {
    const { lukas, toby, id } = await battle();
    lukas.flow.battleOutcome(won('plants'));
    toby.flow.battleOutcome(won('plants'));
    expect(wins(lukas)).toBe(1);
    expect(wins(toby)).toBe(0);
    expect(lastBattle(lukas)).toBe(`vs-${id}`);
    expect(lastBattle(toby)).toBe(`vs-${id}`);
    expect(lukas.session.player.peek()!.coins).toBe(0);
    expect(name(lukas)).toBe('result');
    expect(name(toby)).toBe('result');
    const lv = phaseOf(lukas, 'result').vm;
    expect(lv.winner?.slot).toBe('p01');
    expect(lv.loser?.slot).toBe('p02');
    expect(lv.them).toBe('p02');
    expect(lv.score.leftWins).toBe(1);
    expect(lv.rematch).toBe('offer');
    expect(phaseOf(toby, 'result').vm.winner?.slot).toBe('p01');
    lukas.flow.battleOutcome(won('zombies')); // a repeat of the delivery: nothing
    lukas.flow.battleOutcome(won('plants'));
    expect(wins(lukas)).toBe(1);
    expect(phaseOf(lukas, 'result').vm.winner?.slot).toBe('p01');
    // the key for rejoining is gone once the match is over
    expect(lukas.session.deviceStorage()?.getItem(VMATCH_KEY)).toBeNull();
    expect(lukas.session.deviceStorage()?.getItem(VCREDITED_KEY)).toContain(id);
  });

  it('a forfeit credits the one who did not give up', async () => {
    const { lukas, toby } = await battle();
    toby.flow.battleOutcome({ kind: 'forfeit', winner: 'plants', by: 'p02' });
    lukas.flow.battleOutcome({ kind: 'forfeit', winner: 'plants', by: 'p02' });
    expect(wins(lukas)).toBe(1);
    expect(wins(toby)).toBe(0);
    expect(phaseOf(lukas, 'result').vm.winner?.slot).toBe('p01');
  });

  it('a draw and a disagreement credit nobody (the disagreement shows the host\'s winner)', async () => {
    const { lukas, toby, id } = await battle();
    lukas.flow.battleOutcome(won('draw'));
    toby.flow.battleOutcome({ kind: 'disagree', shown: 'plants' });
    expect(wins(lukas)).toBe(0);
    expect(wins(toby)).toBe(0);
    expect(lastBattle(lukas)).toBeNull();
    expect(phaseOf(lukas, 'result').vm.winner).toBeNull();
    expect(phaseOf(toby, 'result').vm.winner?.slot).toBe('p01');
    expect(id).toBeTruthy();
  });

  it('unfinished: nobody is credited; broken shows the cracked block, the others the door; home goes out', async () => {
    const { lukas, toby, id } = await battle();
    lukas.flow.battleOutcome({ kind: 'unfinished', why: 'broken' });
    toby.flow.battleOutcome({ kind: 'unfinished', why: 'flag' });
    expect(wins(lukas)).toBe(0);
    expect(lastBattle(lukas)).toBeNull();
    expect(phaseOf(lukas, 'notice').kind).toBe('broken');
    expect(phaseOf(toby, 'notice').kind).toBe('gone');
    expect(lukas.session.deviceStorage()?.getItem(VMATCH_KEY)).toBeNull();
    lukas.flow.home();
    expect(name(lukas)).toBe('closed');
    // the match is deleted a moment after both have settled
    await pass(VS_TIMEOUTS.endWaitMs + 1000);
    expect(db.peek(`${root}/vs/matches/${id}`)).toBeNull();
  });
});

describe('the rematch', () => {
  /** Both devices at the result of a first match (Lukas plants won). */
  async function atResult() {
    const b = await battle();
    b.lukas.flow.battleOutcome(won('plants'));
    b.toby.flow.battleOutcome(won('plants'));
    return b;
  }

  it('both press: match n + 1 with the sides swapped, a new seed and the same head start, meta written by the original invitee; the old match goes after both answered', async () => {
    const { lukas, toby, id } = await atResult();
    const old = await readMatch(fakeConnection(db, root), id, clock);
    if (old === null || old === 'offline') throw new Error('no old match');
    toby.flow.rematch();
    expect(phaseOf(toby, 'result').vm.rematch).toBe('mine');
    await until(() => phaseOf(lukas, 'result').vm.rematch === 'theirs');
    lukas.flow.rematch();
    expect(phaseOf(lukas, 'result').vm.rematch).toBe('both');
    await until(() => name(lukas) === 'battle' && name(toby) === 'battle');
    const ids = matchIds();
    const next = ids.find((x) => x !== id)!;
    expect(next).toBeDefined();
    const fresh = await readMatch(fakeConnection(db, root), next, clock);
    if (fresh === null || fresh === 'offline') throw new Error('no new match');
    expect(fresh.meta.seats).toEqual({ plants: 'p02', zombies: 'p01' });
    expect(fresh.meta.seed).not.toBe(old.meta.seed);
    expect(fresh.meta.head).toEqual(old.meta.head);
    expect(fresh.meta.host).toBe(old.meta.host); // Lukas accepted the first invite: he is the invitee and writes both
    expect(phaseOf(lukas, 'battle').options.playerFaction).toBe('zombies');
    expect(phaseOf(toby, 'battle').options.playerFaction).toBe('plants');
    expect(linkOf(toby).host).toBe(false);
    expect(lukas.session.deviceStorage()?.getItem(VMATCH_KEY)).toContain(next);
    // the old one stays until the other device has surely settled, then goes
    await until(() => db.peek(`${root}/vs/matches/${id}`) === null, VS_TIMEOUTS.endWaitMs + 2000);
    expect(db.peek(`${root}/vs/matches/${next}/meta`)).not.toBeNull();
    // and the second match is credited as its own
    lukas.flow.battleBegan();
    toby.flow.battleBegan();
    lukas.flow.battleOutcome(won('zombies')); // Lukas is the zombies now
    expect(wins(lukas)).toBe(2);
    expect(lastBattle(lukas)).toBe(`vs-${next}`);
  });

  it('one presses home: the other\'s rematch is gone; the old match is removed once both answered', async () => {
    const { lukas, toby, id } = await atResult();
    toby.flow.rematch();
    await until(() => phaseOf(lukas, 'result').vm.rematch === 'theirs');
    lukas.flow.home();
    expect(name(lukas)).toBe('closed');
    await until(() => phaseOf(toby, 'result').vm.rematch === 'gone');
    toby.flow.rematch(); // greyed: does nothing
    expect(phaseOf(toby, 'result').vm.rematch).toBe('gone');
    expect(db.peek(`${root}/vs/matches/${id}/again`)).toEqual({ plants: 0, zombies: 1 });
    await until(() => db.peek(`${root}/vs/matches/${id}`) === null, VS_TIMEOUTS.endWaitMs + 2000);
    expect(matchIds()).toEqual([]);
    toby.flow.home();
    expect(name(toby)).toBe('closed');
  });

  it('60 s without an answer: the offer is gone and the old match is removed', async () => {
    const { lukas, toby, id } = await atResult();
    lukas.flow.rematch();
    await until(() => phaseOf(toby, 'result').vm.rematch === 'theirs');
    await pass(VS_TIMEOUTS.rematchMs - 3000);
    expect(phaseOf(lukas, 'result').vm.rematch).toBe('mine');
    await pass(4000);
    expect(phaseOf(lukas, 'result').vm.rematch).toBe('gone');
    expect(phaseOf(toby, 'result').vm.rematch).toBe('gone');
    await pass(1000);
    expect(db.peek(`${root}/vs/matches/${id}`)).toBeNull();
  });
});

/** The page of `d` reloads: its flow and session are gone, its storage stays, it logs in again. */
async function reborn(d: Dev): Promise<Dev> {
  d.flow.dispose();
  d.session.dispose();
  devices = devices.filter((x) => x !== d);
  return device(d.slot, { storage: d.storage });
}

/** One frame of play for the devices in the battle, recording each device's hash every 30 ticks. */
function player(...devs: Dev[]): { frames: (n: number) => Promise<void>; hashes: Map<Dev, Map<number, number>> } {
  const hashes = new Map<Dev, Map<number, number>>(devs.map((d) => [d, new Map()]));
  const frames = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      clock.advance(FRAME);
      await settle();
      for (const d of devs) {
        if (d.flow.phase.value.name !== 'battle') continue;
        const link = linkOf(d);
        if (link.tryStep().kind === 'ran' && link.match.state.tick % 30 === 0) hashes.get(d)!.set(link.match.state.tick, link.match.hash());
      }
    }
  };
  return { frames, hashes };
}

const tickOf = (d: Dev): number => linkOf(d).match.state.tick;

describe('rejoin after a reload (spec 6.7)', () => {
  it('Toby\'s page reloads mid-match: "back to the battle" after log-in, a headless replay in 600-tick slices, the same state as the other device, and play goes on; the result offers no rematch', async () => {
    const { lukas, toby, id } = await battle();
    const p = player(lukas, toby);
    await p.frames(1250);
    expect(Math.min(tickOf(lukas), tickOf(toby))).toBeGreaterThan(1200);
    const stood = tickOf(toby);
    expect(toby.session.deviceStorage()?.getItem(VMATCH_KEY)).toContain(id);

    const toby2 = await reborn(toby);
    expect(toby2.w.open).toBe(0);
    await until(() => toby2.flow.canRejoin.value);
    toby2.flow.rejoin();
    expect(toby2.flow.canRejoin.value).toBe(false);
    let slices = 0;
    while (name(toby2) !== 'battle' && slices < 40) {
      await settle();
      clock.advance(16);
      slices++;
    }
    expect(name(toby2)).toBe('battle');
    // 1,250-odd ticks at 600 a slice: more than one slice, not one tick a frame
    expect(slices).toBeGreaterThanOrEqual(2);
    expect(slices).toBeLessThan(15);
    const link = linkOf(toby2);
    expect(link.match.state.tick).toBeGreaterThan(1200);
    expect(link.match.state.tick).toBeLessThanOrEqual(stood + 60); // as far as both logs reach
    toby2.flow.battleBegan();

    const q = player(lukas, toby2);
    await q.frames(400);
    expect(tickOf(toby2)).toBeGreaterThan(stood);
    expect(link.repairs()).toBe(0);
    expect(linkOf(lukas).repairs()).toBe(0);
    // the same match on both screens at every tick both checked since the rejoin
    let compared = 0;
    for (const [tick, h] of q.hashes.get(toby2)!) {
      const theirs = q.hashes.get(lukas)!.get(tick) ?? p.hashes.get(lukas)!.get(tick);
      if (theirs === undefined) continue;
      expect(theirs, `hash at tick ${tick}`).toBe(h);
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(5);
    expect(link.outcome()).toBeNull();
    expect(toby2.w.open).toBe(2);

    toby2.flow.battleOutcome(won('plants'));
    expect(phaseOf(toby2, 'result').vm.rematch).toBe('none');
    expect(toby2.session.deviceStorage()?.getItem(VMATCH_KEY)).toBeNull();
  }, 120_000);

  it('Review Focus 4: the stored match deleted, ended (both end records) or older than 10 minutes: no way back, and the key is removed', async () => {
    for (const how of ['deleted', 'ended', 'old'] as const) {
      const { lukas, toby, id } = await battle();
      const p = player(lukas, toby);
      await p.frames(60);
      const key = toby.session.deviceStorage()?.getItem(VMATCH_KEY);
      expect(key).toContain(id);
      lukas.flow.dispose();
      toby.flow.dispose();
      const conn = fakeConnection(db, root);
      if (how === 'deleted') {
        const ch = new (await import('../../src/cloud/versusMatch')).CloudMatchChannel({ conn, id, seat: 'plants', me: 'p01', timers: clock });
        expect(await ch.remove()).toBe('ok');
      } else if (how === 'ended') {
        const mod = await import('../../src/cloud/versusMatch');
        for (const [seat, me] of [['plants', 'p01'], ['zombies', 'p02']] as const) {
          const ch = new mod.CloudMatchChannel({ conn, id, seat, me, timers: clock });
          const w = ch.write({ kind: 'end', seat, raw: '{"w":"plants","t":90,"h":1}' });
          for (let i = 0; i < 50; i++) { await settle(); clock.advance(10); }
          expect(await w).toBe('ok');
        }
      } else {
        clock.advance(10 * 60_000 + 5_000);
      }
      const t2 = await reborn(toby);
      await until(() => t2.flow.allowed.value);
      await pass(500);
      expect(t2.flow.canRejoin.value, how).toBe(false);
      expect(t2.session.deviceStorage()?.getItem(VMATCH_KEY), how).toBeNull();
      t2.flow.dispose();
      devices = [];
      // a fresh world for the next case
      db = new FakeDatabase({ now: () => T0 + clock.now() });
      for (const r of ['v2', 'v2test'] as const) {
        const cloud = createFakeCloud(db, r);
        for (const slot of ['p01', 'p02'] as const) {
          const person = PEOPLE[slot]!;
          expect(await cloud.createPlayer(newSave(slot, person.name, person.picture, T0), await pinHash(slot, PINS[slot]!))).toBe('ok');
        }
      }
      clock.advance(1000);
    }
  }, 120_000);

  it('a match whose answer never came (offline at log-in) keeps its key for the next log-in', async () => {
    const { toby, lukas } = await battle();
    await player(lukas, toby).frames(60);
    lukas.flow.dispose();
    toby.flow.dispose();
    devices = [];
    db.offline = true;
    const t2 = await device('p02', { storage: toby.storage });
    await pass(8000);
    expect(t2.flow.canRejoin.value).toBe(false);
    expect(t2.session.deviceStorage()?.getItem(VMATCH_KEY)).not.toBeNull();
  });

  it('a pause of this device left in the store is ended on rejoin, so it holds nobody', async () => {
    const { lukas, toby, id } = await battle();
    const p = player(lukas, toby);
    await p.frames(200);
    linkOf(toby).pause();
    await p.frames(30);
    expect(linkOf(lukas).pausedBy).toBe('p02');
    expect(db.peek(`${root}/vs/matches/${id}/pause`)).not.toBeNull();
    const toby2 = await reborn(toby);
    await until(() => toby2.flow.canRejoin.value);
    toby2.flow.rejoin();
    await until(() => name(toby2) === 'battle');
    expect(linkOf(toby2).pausedBy).toBeNull(); // the stored pause does not pause the reloaded device alone
    toby2.flow.battleBegan();
    const q = player(lukas, toby2);
    await q.frames(60);
    await until(() => db.peek(`${root}/vs/matches/${id}/pause`) === null);
    expect(linkOf(lukas).pausedBy).toBeNull();
    const at = tickOf(toby2);
    await q.frames(90);
    expect(tickOf(toby2)).toBeGreaterThan(at);
    expect(tickOf(lukas)).toBeGreaterThan(at - 10);
  }, 60_000);

  it('a credit already applied is not applied again on rejoin (lastBattle equal, or the match remembered after Adventure took lastBattle)', async () => {
    for (const how of ['same tag', 'tag replaced'] as const) {
      const { lukas, toby, id } = await battle();
      await player(lukas, toby).frames(60);
      const key = lukas.session.deviceStorage()!.getItem(VMATCH_KEY)!;
      lukas.flow.battleOutcome(won('plants'));
      expect(wins(lukas)).toBe(1);
      if (how === 'tag replaced') lukas.session.update((s) => ({ ...s, lastBattle: 'adventure-3' }));
      lukas.session.deviceStorage()!.setItem(VMATCH_KEY, key); // the reload came before the key was cleaned up
      const l2 = await reborn(lukas);
      expect(wins(l2), how).toBe(1);
      await until(() => l2.flow.canRejoin.value);
      l2.flow.rejoin();
      await until(() => name(l2) === 'battle');
      l2.flow.battleBegan();
      l2.flow.battleOutcome(won('plants')); // the same end delivered again
      expect(wins(l2), how).toBe(1);
      expect(phaseOf(l2, 'result').vm.rematch).toBe('none');
      expect(id).toBeTruthy();
      l2.flow.dispose();
      toby.flow.dispose();
      devices = [];
      db = new FakeDatabase({ now: () => T0 + clock.now() });
      for (const r of ['v2', 'v2test'] as const) {
        const cloud = createFakeCloud(db, r);
        for (const slot of ['p01', 'p02'] as const) {
          const person = PEOPLE[slot]!;
          expect(await cloud.createPlayer(newSave(slot, person.name, person.picture, T0), await pinHash(slot, PINS[slot]!))).toBe('ok');
        }
      }
      clock.advance(1000);
    }
  }, 120_000);
});
