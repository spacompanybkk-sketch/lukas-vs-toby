import { afterEach, describe, expect, it, vi } from 'vitest';
import { versusConfig, type VersusSetup } from '../../src/ai/versus';
import { ALL_CARDS } from '../../src/data/units';
import type { MatchChannel, WriteAnswer } from '../../src/net/channel';
import { LockstepMatch, type StepAnswer } from '../../src/net/lockstepMatch';
import { memoryPair } from '../../src/net/memoryChannel';
import { VS_TIMEOUTS, stallStage } from '../../src/net/timeouts';
import { decodeTurn } from '../../src/net/turnCodec';
import { VirtualClock } from '../../src/net/virtualClock';
import { Match } from '../../src/sim/match';
import { LANES, PLANT_COLS, type Command, type Faction } from '../../src/sim/types';

const SETUP: VersusSetup = { seed: 1, seats: { plants: 'p01', zombies: 'p02' }, head: null };
const FRAME = 1000 / 30;
const LATENCY = 100;

interface Peer {
  lm: LockstepMatch;
  /** `match.hash()` after every step that ended on a multiple of 30, by `state.tick` (a re-run overwrites). */
  hashes: Map<number, number>;
  last: StepAnswer | null;
  /** Units the steps spawned, by side. */
  spawned: Record<Faction, number>;
  /** Called before each `tryStep`: taps, nudges. */
  before?: (p: Peer) => void;
  stepping: boolean;
  /** Frames this peer has seen; until `lagFrames` it skips every `lagEvery`-th frame. */
  frames: number;
  lagFrames: number;
  lagEvery: number;
}

type Wrap = (c: MatchChannel) => MatchChannel;

/** p01 holds plants and hosts, p02 holds zombies; both on one in-memory database. */
function pair(wrap: Partial<Record<Faction, Wrap>> = {}, { delay = 12, latency = LATENCY } = {}) {
  const clock = new VirtualClock();
  const link = memoryPair({ clock, latencyMs: latency });
  const make = (seat: Faction): Peer => {
    const raw = seat === 'plants' ? link.plants : link.zombies;
    const lm = new LockstepMatch({
      match: new Match(versusConfig(SETUP)), seat, delay, host: seat === 'plants',
      me: SETUP.seats[seat], other: SETUP.seats[seat === 'plants' ? 'zombies' : 'plants'],
      channel: wrap[seat]?.(raw) ?? raw, now: () => clock.now(), timers: clock,
    });
    return { lm, hashes: new Map(), last: null, spawned: { plants: 0, zombies: 0 }, stepping: true, frames: 0, lagFrames: 0, lagEvery: 2 };
  };
  return { clock, store: link.store, a: make('plants'), b: make('zombies') };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** One frame: the clock moves, answers land, each stepping peer tries one tick. */
async function frame(clock: VirtualClock, peers: Peer[], ms = FRAME): Promise<void> {
  clock.advance(ms);
  await flush();
  for (const p of peers) {
    if (!p.stepping) continue;
    p.frames++;
    if (p.frames < p.lagFrames && p.frames % p.lagEvery === 0) continue;
    p.before?.(p);
    const answer = p.lm.tryStep();
    p.last = answer;
    const { state } = p.lm.match;
    if (answer.kind !== 'ran') continue;
    if (state.tick % 30 === 0) p.hashes.set(state.tick, p.lm.match.hash());
    for (const e of answer.events) if (e.type === 'unitSpawned') p.spawned[e.faction]++;
  }
  await flush();
}

async function frames(clock: VirtualClock, peers: Peer[], n: number, ms = FRAME): Promise<void> {
  for (let i = 0; i < n; i++) await frame(clock, peers, ms);
}

async function until(clock: VirtualClock, peers: Peer[], done: () => boolean, max = 20000): Promise<void> {
  for (let i = 0; i < max && !done(); i++) await frame(clock, peers);
  expect(done()).toBe(true);
}

/** A seeded random tapper for one seat: a place or a merge now and then. */
function randomTaps(seed: number): (p: Peer) => void {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (p) => {
    if (rnd() > 0.12) return;
    const faction = p.lm.seat;
    const cards = ALL_CARDS[faction];
    const unit = cards[Math.floor(rnd() * cards.length)]!;
    const lane = Math.floor(rnd() * LANES);
    const col = Math.floor(rnd() * PLANT_COLS);
    const units = p.lm.match.state.units.filter((u) => u.faction === faction);
    const cmd: Command = rnd() < 0.2 && units.length > 0
      ? { type: 'merge', faction, unit, targetId: units[Math.floor(rnd() * units.length)]!.id }
      : { type: 'place', faction, unit, lane, col };
    p.lm.tap(cmd);
  };
}

const nudgeAt = (ticks: number[], nudge: (p: Peer) => void) => {
  const left = new Set(ticks);
  return (p: Peer) => {
    const t = p.lm.match.state.tick;
    if (left.delete(t)) nudge(p);
  };
};

const started = (...peers: Peer[]) => peers.forEach((p) => p.lm.start());

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LockstepMatch on an in-memory channel', () => {
  it('keeps both screens equal at every hash tick through 900 ticks of random taps', async () => {
    const { clock, a, b } = pair();
    a.before = randomTaps(11);
    b.before = randomTaps(22);
    started(a, b);
    await until(clock, [a, b], () => a.lm.match.state.tick >= 900 && b.lm.match.state.tick >= 900);
    for (let t = 30; t <= 900; t += 30) {
      expect(a.hashes.get(t), `tick ${t}`).toBeDefined();
      expect(a.hashes.get(t), `tick ${t}`).toBe(b.hashes.get(t));
    }
    expect(a.spawned.plants).toBeGreaterThan(0); // the taps of both seats did something
    expect(a.spawned.zombies).toBeGreaterThan(0);
    expect(a.lm.repairs()).toBe(0);
    expect(b.lm.repairs()).toBe(0);
  });

  it('runs no tick while the other seat is silent', async () => {
    const { clock, a } = pair();
    started(a);
    await frames(clock, [a], 60);
    expect(a.last).toEqual({ kind: 'wait', why: 'turns' });
    expect(a.lm.match.state.tick).toBe(0);
  });

  it('counts its own turn only once the channel answered ok', async () => {
    const held: (() => void)[] = [];
    const hold: Wrap = (c) => ({
      ...c,
      publishTurns: (seat, turns) => new Promise<WriteAnswer>((resolve) => {
        void c.publishTurns(seat, turns).then((answer) => held.push(() => resolve(answer)));
      }),
      listen: c.listen.bind(c), write: c.write.bind(c), remove: c.remove.bind(c),
    });
    const { clock, store, a, b } = pair({ plants: hold });
    started(a, b);
    await frames(clock, [a, b], 30);
    expect(store.has('turns/plants/t000000')).toBe(true); // stored, the answer held back
    expect(a.last).toEqual({ kind: 'wait', why: 'turns' });
    expect(a.lm.match.state.tick).toBe(0);
    held.splice(0).forEach((release) => release());
    await frames(clock, [a, b], 10);
    expect(a.lm.match.state.tick).toBeGreaterThan(0);
  });

  it('retries an offline turn write after 250, 500, 1000, 2000, 2000 ms with the same strings', async () => {
    const calls: { at: number; turns: string }[] = [];
    const { clock, a } = pair({
      plants: (c) => ({
        ...c,
        publishTurns: (seat, turns) => {
          calls.push({ at: clock.now(), turns: JSON.stringify(turns) });
          return calls.length <= 5 ? Promise.resolve('offline') : c.publishTurns(seat, turns);
        },
        listen: c.listen.bind(c), write: c.write.bind(c), remove: c.remove.bind(c),
      }),
    });
    started(a);
    await flush(); // the first answer lands at time 0
    for (let ms = 0; ms < 6000; ms++) {
      clock.advance(1);
      await flush();
      if (ms % 33 === 0) a.lm.tryStep();
    }
    expect(calls.length).toBe(6);
    expect(calls.slice(1).map((c, i) => c.at - calls[i]!.at)).toEqual([250, 500, 1000, 2000, 2000]);
    for (const c of calls) expect(c.turns).toBe(calls[0]!.turns);
  });

  it('records a hash after each step that ends on a multiple of 30, keyed by that tick', async () => {
    const { clock, store, a, b } = pair();
    started(a, b);
    await until(clock, [a, b], () => a.lm.match.state.tick >= 150 && b.lm.match.state.tick >= 150);
    const sent = [...store].filter(([key]) => key.startsWith('turns/plants/'))
      .map(([, raw]) => decodeTurn(raw, 'plants').hash).filter((h) => h !== null);
    expect(sent.map((h) => h[0]).slice(0, 4)).toEqual([30, 60, 90, 120]);
    for (const [tick, hash] of sent) expect(hash).toBe(a.hashes.get(tick));
  });

  /** Repair under even and uneven stepping, for delays on and off a turn boundary (D ≡ 0 and ≢ 0 mod 6). */
  const REPAIR_CASES = [
    { delay: 12, latency: 100, lag: 'none', nudge: 'guest' },
    { delay: 13, latency: 100, lag: 'none', nudge: 'guest' },
    { delay: 12, latency: 100, lag: 'guest', nudge: 'guest' },
    { delay: 13, latency: 100, lag: 'guest', nudge: 'guest' },
    { delay: 13, latency: 30, lag: 'guest', nudge: 'guest' }, // the review's deadlock
    { delay: 9, latency: 30, lag: 'guest', nudge: 'host' },
    { delay: 20, latency: 30, lag: 'guest', nudge: 'guest' },
    { delay: 13, latency: 100, lag: 'host', nudge: 'host' },
  ] as const;

  /** The pair of a repair case: the lagging peer steps every other frame for its first 20 s. */
  function repairPair(c: (typeof REPAIR_CASES)[number], wrap: Partial<Record<Faction, Wrap>> = {}) {
    const p = pair(wrap, { delay: c.delay, latency: c.latency });
    if (c.lag === 'guest') p.b.lagFrames = 600;
    if (c.lag === 'host') p.a.lagFrames = 600;
    return { ...p, nudged: c.nudge === 'guest' ? p.b : p.a };
  }

  describe.each(REPAIR_CASES)('repair with delay $delay, latency $latency, lagging $lag, nudging the $nudge', (c) => {
    it('repairs a forced desync from the host within 2 s and stays repaired', async () => {
      const { clock, store, a, b, nudged } = repairPair(c);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      let nudgedAt = -1;
      nudged.before = nudgeAt([300], (p) => {
        p.lm.match.state.players.plants.energy += 1;
        nudgedAt = clock.now();
      });
      started(a, b);
      await until(clock, [a, b], () => nudgedAt >= 0);
      // whenever both screens stand on the same tick after the repair, their whole states agree
      const sameTick: boolean[] = [];
      while (clock.now() < nudgedAt + 2000) {
        await frame(clock, [a, b]);
        const t = a.lm.match.state.tick;
        if (a.lm.repairs() === 1 && b.lm.repairs() === 1 && b.lm.match.state.tick === t) {
          sameTick.push(a.lm.match.hash() === b.lm.match.hash());
        }
      }
      expect(a.lm.repairs()).toBe(1);
      expect(b.lm.repairs()).toBe(1);
      const sync = JSON.parse(store.get('sync/s1')!) as { tick: number; snap: string };
      expect(sync.tick).toBeGreaterThan(300);
      expect(sameTick.length).toBeGreaterThan(0);
      expect(sameTick.every(Boolean)).toBe(true);
      // and it stays repaired: no second repair, both keep going, equal hashes from then on
      const ticks = [a.lm.match.state.tick, b.lm.match.state.tick];
      await frames(clock, [a, b], 900);
      expect(a.lm.repairs()).toBe(1);
      expect(b.lm.repairs()).toBe(1);
      expect(a.lm.match.state.tick).toBeGreaterThan(ticks[0]! + 300);
      expect(b.lm.match.state.tick).toBeGreaterThan(ticks[1]! + 300);
      for (const t of [...a.hashes.keys()].filter((k) => k > sync.tick && b.hashes.has(k))) {
        expect(a.hashes.get(t), `tick ${t}`).toBe(b.hashes.get(t));
      }
    });

    it('repairs three times, then a fourth mismatch ends both as broken within 2 s of each other', async () => {
      const { clock, store, a, b, nudged } = repairPair(c);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      nudged.before = nudgeAt([300, 900, 1500, 2100], (p) => { p.lm.match.state.players.plants.energy += 1; });
      const endedAt = new Map<Peer, number>();
      for (const p of [a, b]) p.lm.onChange(() => { if (p.lm.outcome() && !endedAt.has(p)) endedAt.set(p, clock.now()); });
      started(a, b);
      await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null);
      expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
      expect(b.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
      expect(Math.abs(endedAt.get(a)! - endedAt.get(b)!)).toBeLessThanOrEqual(2000);
      expect([...store.keys()].filter((k) => k.startsWith('sync/')).sort()).toEqual(['sync/s1', 'sync/s2', 'sync/s3']);
      expect(a.lm.repairs()).toBe(3);
      expect(b.lm.repairs()).toBe(3);
      const repairs = warn.mock.calls.map((m) => String(m[0])).filter((m) => /repair s[123]/.test(m));
      expect(repairs.length).toBe(3);
      for (const m of repairs) {
        const [, own, other] = /own (\d+), other (\d+)/.exec(m) ?? [];
        expect(own).toBeDefined();
        expect(own).not.toBe(other);
      }
      expect(a.lm.tryStep()).toEqual({ kind: 'over' });
    });
  });

  it.each([12, 13])('a refused repair breaks the host, and the guest goes home too (delay %i)', async (delay) => {
    const refuseSync: Wrap = (ch) => ({
      publishTurns: ch.publishTurns.bind(ch), listen: ch.listen.bind(ch), remove: ch.remove.bind(ch),
      write: (rec, opts) => (rec.kind === 'sync' ? Promise.resolve('refused') : ch.write(rec, opts)),
    });
    const { clock, a, b, store } = pair({ plants: refuseSync }, { delay });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    b.before = nudgeAt([300], (p) => { p.lm.match.state.players.plants.energy += 1; });
    started(a, b);
    await until(clock, [a, b], () => a.lm.outcome() !== null);
    const brokeAt = clock.now();
    expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
    await until(clock, [a, b], () => b.lm.outcome() !== null);
    expect(clock.now() - brokeAt).toBeLessThanOrEqual(1000);
    expect(JSON.parse(store.get('end/plants')!)).toMatchObject({ w: 'broken' });
    expect(b.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
    expect(warn.mock.calls.some((m) => /refused repair s1/.test(String(m[0])))).toBe(true);
  });

  it('pauses both from one peer and resumes both from the other', async () => {
    const { clock, a, b } = pair();
    started(a, b);
    await until(clock, [a, b], () => a.lm.match.state.tick >= 60 && b.lm.match.state.tick >= 60);
    let changes = 0;
    b.lm.onChange(() => changes++);
    a.lm.pause();
    expect(a.lm.pausedBy).toBe('p01');
    await frames(clock, [a, b], Math.ceil((2 * LATENCY) / FRAME) + 1); // one delivery
    expect(b.lm.pausedBy).toBe('p01');
    expect(changes).toBeGreaterThan(0);
    const ticks = [a.lm.match.state.tick, b.lm.match.state.tick];
    await frames(clock, [a, b], 60);
    expect([a.lm.match.state.tick, b.lm.match.state.tick]).toEqual(ticks);
    expect(a.last).toEqual({ kind: 'wait', why: 'paused' });
    expect(b.last).toEqual({ kind: 'wait', why: 'paused' });
    b.lm.resume();
    await frames(clock, [a, b], 30);
    expect(a.lm.pausedBy).toBeNull();
    expect(b.lm.pausedBy).toBeNull();
    expect(a.lm.match.state.tick).toBeGreaterThan(ticks[0]!);
    expect(b.lm.match.state.tick).toBeGreaterThan(ticks[1]!);
  });

  it('a forfeit by p02 gives both screens p01\'s win', async () => {
    const { clock, a, b } = pair();
    started(a, b);
    await frames(clock, [a, b], 30);
    b.lm.forfeit();
    await frames(clock, [a, b], 10);
    const expected = { kind: 'forfeit', winner: 'plants', by: 'p02' };
    expect(a.lm.outcome()).toEqual(expected);
    expect(b.lm.outcome()).toEqual(expected);
    expect(a.last).toEqual({ kind: 'over' });
  });

  describe('end records', () => {
    const fall = (side: Faction) => nudgeAt([95], (p) => { p.lm.match.state.baseHp[side] = 0; });

    it('both write end and agree on the winner', async () => {
      const { clock, store, a, b } = pair();
      a.before = fall('zombies');
      b.before = fall('zombies');
      started(a, b);
      await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null);
      expect(a.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      expect(b.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      const end = { w: 'plants', t: 96, h: a.lm.match.hash() };
      expect(JSON.parse(store.get('end/plants')!)).toEqual(end);
      expect(JSON.parse(store.get('end/zombies')!)).toEqual(end);
    });

    it('the host takes its own result after 10 s when the other end never comes', async () => {
      const { clock, store, a, b } = pair();
      a.before = fall('zombies');
      b.before = (p) => { if (p.lm.match.state.tick >= 90) p.stepping = false; };
      started(a, b);
      await until(clock, [a, b], () => a.lm.match.state.winner !== null);
      const endedAt = clock.now();
      await until(clock, [a], () => clock.now() >= endedAt + 9900);
      expect(a.lm.outcome()).toBeNull();
      await frames(clock, [a], 10);
      expect(a.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      // the host wrote its record into the guest's empty slot: the guest, still not stepping, has
      // the same outcome from the same two records (no one-sided win)
      expect(b.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      expect(store.get('end/zombies')).toBe(store.get('end/plants'));
    });

    it('a guest that ended alone never takes its own result: it waits, counted, and the host decides', async () => {
      const { clock, store, a, b } = pair();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      // both states end at tick 96 the same way, but the host freezes at tick 90 for a minute
      const hostFall = fall('zombies');
      let froze = false;
      a.before = (p) => {
        if (!froze && p.lm.match.state.tick >= 90) { froze = true; p.stepping = false; }
        hostFall(p);
      };
      b.before = fall('zombies');
      started(a, b);
      await until(clock, [a, b], () => b.lm.match.state.winner !== null);
      expect(a.lm.match.state.tick).toBeLessThan(96); // the host has not reached the end
      await frames(clock, [b], 60 * 30); // a minute: far past endWaitMs
      expect(b.lm.outcome()).toBeNull();
      expect(stallStage(b.lm.silentMs())).toBe('face'); // the wait shows
      // the host comes back and reaches the guest's end with the same winner: both win
      a.stepping = true;
      await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null, 30 * 30);
      expect(a.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      expect(b.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      expect(store.get('end/zombies')).toBe(store.get('end/plants'));
    });

    it('a guest that ended alone and a host gone for 10 minutes: the give-up goes into the host\'s slot, both unfinished', async () => {
      const { clock, store, a, b } = pair();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      a.before = (p) => { if (p.lm.match.state.tick >= 90) p.stepping = false; };
      b.before = fall('zombies');
      started(a, b);
      await until(clock, [a, b], () => b.lm.match.state.winner !== null);
      const endedAt = clock.now();
      let settledAt = -1;
      b.lm.onChange(() => { if (settledAt < 0 && b.lm.outcome()) settledAt = clock.now(); });
      for (let i = 0; i < 700 && b.lm.outcome() === null; i++) await frame(clock, [b], 1000);
      expect(b.lm.outcome()).toEqual({ kind: 'unfinished', why: 'silence' });
      expect(settledAt - endedAt).toBeGreaterThanOrEqual(600000);
      expect(settledAt - endedAt).toBeLessThan(602000);
      expect(JSON.parse(store.get('end/plants')!)).toMatchObject({ w: 'broken' }); // written by the guest
      // the frozen host's slot now holds the give-up: it ends unfinished too, and can never win
      await frames(clock, [a, b], 60);
      expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
      expect(a.lm.tap({ type: 'hero', faction: 'plants', lane: 0 })).toBe('full');
    });

    it('two different winners show the host\'s and credit nobody', async () => {
      const { clock, a, b } = pair();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      a.before = fall('zombies');
      b.before = fall('plants');
      started(a, b);
      await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null);
      expect(a.lm.outcome()).toEqual({ kind: 'disagree', shown: 'plants' });
      expect(b.lm.outcome()).toEqual({ kind: 'disagree', shown: 'plants' });
      const said = warn.mock.calls.map((m) => String(m[0]));
      expect(said).toContain('[versus] the end records disagree: own plants, other zombies');
      expect(said).toContain('[versus] the end records disagree: own zombies, other plants');
    });

    it('the same winner at a different hash is a win, with one warning on each side', async () => {
      const { clock, a, b } = pair();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      a.before = fall('zombies');
      b.before = nudgeAt([95], (p) => {
        p.lm.match.state.baseHp.zombies = 0;
        p.lm.match.state.players.plants.energy += 1; // same winner, another final state
      });
      started(a, b);
      await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null);
      expect(a.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      expect(b.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      const differ = warn.mock.calls.map((m) => String(m[0])).filter((m) => /same winner but differ/.test(m));
      expect(differ.length).toBe(2);
      expect(differ[0]).toMatch(/own tick 96 hash \d+, other tick 96 hash \d+/);
    });
  });

  describe.each([12, 13])('a winner from a drifted state (delay %i)', (delay) => {
    const fall = (side: Faction) => (p: Peer) => { p.lm.match.state.baseHp[side] = 0; };
    /** Whether a guest has found a mismatch and waits for the host's snapshot (no public view of it). */
    const awaiting = (p: Peer) => (p.lm as unknown as { repairing: string }).repairing === 'awaiting';

    it.each([100, 30])('a guest waiting for the snapshot writes no end and plays on from it (latency %i)', async (latency) => {
      const { clock, store, a, b } = pair({}, { delay, latency });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const nudge = nudgeAt([300], (p) => { p.lm.match.state.players.plants.energy += 1; });
      let fellAt = -1;
      b.before = (p) => {
        nudge(p);
        if (fellAt < 0 && awaiting(p)) {
          fall('plants')(p); // the drifted state ends the match
          fellAt = p.lm.match.state.tick;
        }
      };
      started(a, b);
      await until(clock, [a, b], () => fellAt >= 0);
      // the trap of t3r/drift-end: the guest awaits the snapshot and its drifted state has a winner
      expect(awaiting(b)).toBe(true);
      expect(b.lm.match.state.winner).toBe('zombies');
      await frames(clock, [a, b], 600);
      expect(store.has('end/zombies')).toBe(false);
      expect(store.has('end/plants')).toBe(false);
      expect(a.lm.outcome()).toBeNull();
      expect(b.lm.outcome()).toBeNull();
      expect([a.lm.repairs(), b.lm.repairs()]).toEqual([1, 1]);
      expect(b.lm.match.state.winner).toBeNull(); // the snapshot replaced the drifted end
      expect(b.lm.match.state.tick).toBeGreaterThan(fellAt + 300);
      for (const t of [...a.hashes.keys()].filter((k) => k > fellAt + 60 && b.hashes.has(k))) {
        expect(a.hashes.get(t), `tick ${t}`).toBe(b.hashes.get(t));
      }
    });

    it('a guest that ended alone before any hash check credits nobody: both end broken', async () => {
      const { clock, store, a, b } = pair({}, { delay });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      b.before = nudgeAt([100], fall('plants')); // the guest alone: it says zombies won at tick 101
      const endedAt = new Map<Peer, number>();
      for (const p of [a, b]) p.lm.onChange(() => { if (p.lm.outcome() && !endedAt.has(p)) endedAt.set(p, clock.now()); });
      started(a, b);
      await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null, 30 * 30);
      expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
      expect(b.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
      expect(Math.abs(endedAt.get(a)! - endedAt.get(b)!)).toBeLessThanOrEqual(2000);
      // the host saw the guest's end passed, or the guest saw the host play on: whichever came first
      expect(warn.mock.calls.some((m) => /plays on past this screen's end|ran past it with no winner/.test(String(m[0])))).toBe(true);
      // nothing more happens later: the outcomes stay
      await frames(clock, [a, b], 600);
      expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
      expect(b.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
      expect(JSON.parse(store.get('end/zombies')!)).toMatchObject({ w: 'zombies', t: 101 }); // written, never rewritten
      expect(JSON.parse(store.get('end/plants')!)).toMatchObject({ w: 'broken' });
    });

    it('a host that ended alone is the authority: the guest takes its end record, both end with its winner', async () => {
      const { clock, store, a, b } = pair({}, { delay });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      a.before = nudgeAt([100], fall('plants')); // the host alone: zombies win at tick 101
      let fellAt = -1;
      a.lm.onChange(() => { if (fellAt < 0 && a.lm.match.state.winner !== null) fellAt = clock.now(); });
      started(a, b);
      await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null, 30 * 30);
      expect(b.lm.match.state.winner).toBeNull(); // the trap: the guest's own state never ended
      expect(a.lm.outcome()).toEqual({ kind: 'won', winner: 'zombies' });
      expect(b.lm.outcome()).toEqual({ kind: 'won', winner: 'zombies' });
      expect(clock.now() - fellAt).toBeLessThan(1000); // the guest took the record as it reached tick 101
      expect([a.lm.repairs(), b.lm.repairs()]).toEqual([0, 0]);
      expect(store.get('end/zombies')).toBe(store.get('end/plants'));
      expect(JSON.parse(store.get('end/plants')!)).toMatchObject({ w: 'zombies', t: 101 });
    });

    it('both reaching the same end settle at once, as before', async () => {
      const { clock, a, b } = pair({}, { delay });
      let fellAt = -1;
      const fallBoth = (p: Peer) => {
        if (p.lm.match.state.tick === 95) {
          fall('zombies')(p);
          if (fellAt < 0) fellAt = clock.now();
        }
      };
      a.before = fallBoth;
      b.before = fallBoth;
      started(a, b);
      await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null);
      expect(a.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      expect(b.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      expect(clock.now() - fellAt).toBeLessThan(1000); // the other's end, not the 10 s wait
      expect([a.lm.repairs(), b.lm.repairs()]).toEqual([0, 0]);
    });
  });

  describe.each([
    { delay: 13, every: 2 }, { delay: 13, every: 3 }, { delay: 9, every: 2 }, { delay: 9, every: 3 },
  ])('a lagging guest parked on a drifted winner (delay $delay, skipping every $every-th frame)', ({ delay, every }) => {
    it('still sends the hash that shows the host the mismatch, and the repair goes on', async () => {
      const { clock, store, a, b } = pair({}, { delay, latency: 30 });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      b.lagFrames = 900;
      b.lagEvery = every;
      const inner = (p: Peer) => p.lm as unknown as { repairing: string; lockstep: { hash: unknown } };
      const nudge = nudgeAt([300], (p) => { p.lm.match.state.players.plants.energy += 1; });
      let fellAt = -1;
      let sawAwaiting = false;
      b.before = (p) => {
        nudge(p);
        if (!sawAwaiting && inner(p).repairing === 'awaiting') {
          sawAwaiting = true;
          // the review's condition: awaiting while its own hash has not ridden out on a turn yet
          if (inner(p).lockstep.hash !== null) {
            p.lm.match.state.baseHp.plants = 0;
            fellAt = clock.now();
          }
        }
      };
      started(a, b);
      await until(clock, [a, b], () => sawAwaiting);
      expect(fellAt).toBeGreaterThanOrEqual(0); // the trap was set
      await until(clock, [a, b], () => a.lm.repairs() === 1 && b.lm.repairs() === 1);
      expect(clock.now() - fellAt).toBeLessThan(2000);
      expect(b.lm.match.state.winner).toBeNull();
      const ticks = [a.lm.match.state.tick, b.lm.match.state.tick];
      await frames(clock, [a, b], 300);
      expect(a.lm.match.state.tick).toBeGreaterThan(ticks[0]! + 100);
      expect(b.lm.match.state.tick).toBeGreaterThan(ticks[1]! + 100);
      expect(store.has('end/zombies')).toBe(false);
      expect([a.lm.outcome(), b.lm.outcome()]).toEqual([null, null]);
      expect([a.lm.repairs(), b.lm.repairs()]).toEqual([1, 1]);
    });
  });

  /** Private state the reproductions check their trap against (no public view of it). */
  const inner = (p: Peer) => p.lm as unknown as { repairing: string; lockstep: { hash: unknown } };

  describe.each([9, 13, 15, 20].flatMap((delay) => (['zombies', 'plants'] as const).map((nudge) => ({ delay, nudge }))))(
    'port of t3/slow: a guest that finds the mismatch first while lagging (delay $delay, latency 30, nudging $nudge)', ({ delay, nudge }) => {
      it('the host still repairs, and both play on together', async () => {
        const { clock, a, b } = pair({}, { delay, latency: 30 });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        b.lagFrames = 600; // the guest skips every other frame for its first 20 s
        b.frames = -1; // as the script counts them
        const nudged = nudge === 'zombies' ? b : a;
        let nudgedAt = -1;
        const nudgeIt = nudgeAt([300], (p) => { p.lm.match.state.players.plants.energy += 1; nudgedAt = clock.now(); });
        let guestFirst: boolean | null = null; // whether the guest awaited the snapshot before the host repaired
        nudged.before = nudgeIt;
        const watch = (p: Peer) => { if (guestFirst === null && inner(p).repairing === 'awaiting') guestFirst = a.lm.repairs() === 0; };
        b.before = nudged === b ? (p) => { nudgeIt(p); watch(p); } : watch;
        started(a, b);
        for (let i = 0; i < 60 * 30 && !(a.lm.repairs() === 1 && b.lm.repairs() === 1); i++) await frame(clock, [a, b]);
        expect(guestFirst).toBe(true); // the trap of round 1: the guest awaited on its own mismatch first
        expect([a.lm.repairs(), b.lm.repairs()]).toEqual([1, 1]);
        expect(clock.now() - nudgedAt).toBeLessThan(3000); // D 20 with the guest lagging takes 2.3 s
        const ticks = [a.lm.match.state.tick, b.lm.match.state.tick];
        await frames(clock, [a, b], 30 * 30);
        expect(a.lm.match.state.tick).toBeGreaterThan(ticks[0]! + 300);
        expect(b.lm.match.state.tick).toBeGreaterThan(ticks[1]! + 300);
        expect([a.lm.repairs(), b.lm.repairs()]).toEqual([1, 1]);
        expect([a.lm.silentMs(), b.lm.silentMs()]).toEqual([0, 0]);
        const common = [...a.hashes.keys()].filter((t) => t > ticks[0]! && b.hashes.has(t));
        expect(common.length).toBeGreaterThan(0);
        for (const t of common) expect(a.hashes.get(t), `tick ${t}`).toBe(b.hashes.get(t));
      });
    });

  describe.each([
    { latency: 30, every: 3 }, { latency: 30, every: 2 }, { latency: 100, every: 3 }, { latency: 100, every: 2 },
  ])('port of t3rrr/host-ends-first (delay 13, latency $latency, the guest skipping every $every-th frame)', ({ latency, every }) => {
    it('a host that ends while the guest is parked on a drifted winner: both end with the host\'s winner', async () => {
      const { clock, store, a, b } = pair({}, { delay: 13, latency });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      b.lagFrames = 900;
      b.lagEvery = every;
      b.frames = -1; // the script counts frames from 0: the same frames are skipped
      const nudge = nudgeAt([300], (p) => { p.lm.match.state.players.plants.energy += 1; });
      let guestFell = -1;
      let hostFell = -1;
      let hostFellAt = -1;
      let trap: { repairs: number; guestParked: boolean; guestTick: number } | null = null;
      b.before = (p) => {
        nudge(p);
        if (guestFell < 0 && inner(p).repairing === 'awaiting' && inner(p).lockstep.hash !== null) {
          p.lm.match.state.baseHp.plants = 0; // the drifted state ends while its hash is still unsent
          guestFell = p.lm.match.state.tick;
        }
      };
      a.before = (p) => {
        // the host's own state ends 6 or more ticks after the guest's drifted end, before any repair
        if (guestFell >= 0 && hostFell < 0 && p.lm.match.state.tick >= guestFell + 6 && p.lm.repairs() === 0) {
          p.lm.match.state.baseHp.zombies = 0;
          hostFell = p.lm.match.state.tick;
          hostFellAt = clock.now();
          trap = { repairs: a.lm.repairs() + b.lm.repairs(), guestParked: inner(b).repairing === 'awaiting' && b.lm.match.state.winner !== null, guestTick: b.lm.match.state.tick };
        }
      };
      started(a, b);
      for (let i = 0; i < 60 * 30 && !(a.lm.outcome() && b.lm.outcome()); i++) await frame(clock, [a, b]);
      // the trap of round 4: the host ended past the parked guest's tick before any repair
      expect(guestFell).toBeGreaterThanOrEqual(0);
      expect(hostFell).toBeGreaterThanOrEqual(guestFell + 6);
      expect(trap).toEqual({ repairs: 0, guestParked: true, guestTick: guestFell + 1 });
      expect(a.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      expect(b.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
      expect(clock.now() - hostFellAt).toBeLessThan(2000);
      expect(store.get('end/zombies')).toBe(store.get('end/plants'));
    });
  });

  it.each([12, 13])('a host that ended alone needs no repair, so a database refusing repairs changes nothing (delay %i)', async (delay) => {
    const syncs: number[] = [];
    const refuseSync: Wrap = (ch) => ({
      publishTurns: ch.publishTurns.bind(ch), listen: ch.listen.bind(ch), remove: ch.remove.bind(ch),
      write: (rec, opts) => {
        if (rec.kind !== 'sync') return ch.write(rec, opts);
        syncs.push(rec.n);
        return Promise.resolve('refused');
      },
    });
    const { clock, store, a, b } = pair({ plants: refuseSync }, { delay });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    a.before = nudgeAt([100], (p) => { p.lm.match.state.baseHp.plants = 0; }); // the host ends alone
    started(a, b);
    await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null, 30 * 30);
    expect(b.lm.match.state.winner).toBeNull(); // the guest's own state did not end
    expect(a.lm.outcome()).toEqual({ kind: 'won', winner: 'zombies' });
    expect(b.lm.outcome()).toEqual({ kind: 'won', winner: 'zombies' });
    expect(syncs).toEqual([]);
    expect(store.get('end/zombies')).toBe(store.get('end/plants'));
  });

  it('a deletion before the other\'s end record credits nobody, own end or not', async () => {
    const { clock, a, b } = pair();
    a.before = nudgeAt([95], (p) => { p.lm.match.state.baseHp.zombies = 0; });
    b.before = (p) => { if (p.lm.match.state.tick >= 90) p.stepping = false; };
    started(a, b);
    await until(clock, [a, b], () => a.lm.match.state.winner !== null);
    b.lm.giveUp();
    await frames(clock, [a], 15);
    expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'gone' });
  });

  describe('silence while paused (spec 6.8: no limit while both are present)', () => {
    it('has no limit while both devices are present', async () => {
      const { clock, a, b } = pair();
      started(a, b);
      await frames(clock, [a, b], 60);
      a.lm.pause();
      const silences: number[] = [];
      for (let i = 0; i < 15 * 60; i++) {
        await frame(clock, [a, b], 1000);
        silences.push(a.lm.silentMs(), b.lm.silentMs());
      }
      expect(silences.every((s) => s === 0)).toBe(true);
      expect(a.lm.outcome()).toBeNull();
      expect(b.lm.outcome()).toBeNull();
      expect(a.last).toEqual({ kind: 'wait', why: 'paused' });
    });

    it('ends unfinished when the other device hid and never came back', async () => {
      const { clock, store, a, b } = pair();
      let settledAt = -1;
      a.lm.onChange(() => { if (settledAt < 0 && a.lm.outcome()) settledAt = clock.now(); });
      started(a, b);
      await frames(clock, [a, b], 60);
      b.lm.hidden();
      b.stepping = false;
      const hidAt = clock.now();
      await until(clock, [a], () => a.lm.pausedBy === 'p02');
      await until(clock, [a], () => clock.now() >= hidAt + 39000);
      expect(a.lm.silentMs()).toBe(0); // under 40 s counts as here
      await until(clock, [a], () => clock.now() >= hidAt + 91000);
      expect(stallStage(a.lm.silentMs())).toBe('flag');
      for (let i = 0; i < 600 && a.lm.outcome() === null; i++) await frame(clock, [a], 1000);
      expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'silence' });
      expect(settledAt - hidAt).toBeGreaterThanOrEqual(600000);
      expect(settledAt - hidAt).toBeLessThan(602000);
      expect(a.lm.stats().maxSilentMs).toBeGreaterThanOrEqual(600000);
      // the give-up is stored in its own slot: the other device, back later, ends unfinished too
      expect(JSON.parse(store.get('end/plants')!)).toMatchObject({ w: 'broken' });
      b.stepping = true;
      b.lm.visible();
      await frames(clock, [a, b], 10);
      expect(b.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
    });

    it('counts the other as here again once it is visible', async () => {
      const { clock, a, b } = pair();
      started(a, b);
      await frames(clock, [a, b], 60);
      b.lm.hidden();
      await frames(clock, [a, b], 60, 1000);
      expect(a.lm.silentMs()).toBeGreaterThan(0);
      b.lm.visible();
      await frames(clock, [a, b], 16, 1000); // the next heartbeat
      expect(a.lm.silentMs()).toBe(0);
      expect(a.lm.pausedBy).toBe('p02'); // still paused: coming back does not resume by itself
    });
  });

  it('measures silence only while waiting on turns; 3 s is the face, 10 min unfinished', async () => {
    const { clock, a, b } = pair();
    let settledAt = -1;
    a.lm.onChange(() => { if (settledAt < 0 && a.lm.outcome()) settledAt = clock.now(); });
    started(a, b);
    const silences: number[] = [];
    a.before = (p) => { if (p.last?.kind === 'ran') silences.push(p.lm.silentMs()); };
    await until(clock, [a, b], () => a.lm.match.state.tick >= 120 && b.lm.match.state.tick >= 120);
    expect(silences.length).toBeGreaterThan(50);
    expect(silences.every((s) => s === 0)).toBe(true);
    b.stepping = false; // cut off
    await until(clock, [a], () => a.lm.silentMs() > 0);
    const cutAt = clock.now() - a.lm.silentMs();
    await until(clock, [a], () => clock.now() >= cutAt + 3000);
    expect(stallStage(a.lm.silentMs())).toBe('face');
    expect(a.lm.outcome()).toBeNull();
    for (let i = 0; i < 700 && a.lm.outcome() === null; i++) await frame(clock, [a], 1000);
    expect(settledAt - cutAt).toBeGreaterThanOrEqual(600000 - 1000);
    expect(settledAt - cutAt).toBeLessThan(600000 + 1000);
    expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'silence' });
    expect(a.lm.stats().maxSilentMs).toBeGreaterThanOrEqual(600000);
  }, 30000);

  it('a white flag that loses the race to the host\'s end takes that end: no flag, no deletion', async () => {
    let deaf = false; // the guest's stream is down: it hears nothing
    const deafen: Wrap = (ch) => ({
      publishTurns: ch.publishTurns.bind(ch), write: ch.write.bind(ch), remove: ch.remove.bind(ch),
      listen: (from, on) => ch.listen(from, (e) => { if (!deaf) on(e); }),
    });
    const { clock, store, a, b } = pair({ zombies: deafen });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    a.before = nudgeAt([95], (p) => { p.lm.match.state.baseHp.zombies = 0; }); // the host's state ends
    started(a, b);
    await until(clock, [a, b], () => a.lm.match.state.winner !== null);
    deaf = true; // the host's end record never reaches the guest
    await frames(clock, [a, b], 11 * 30);
    expect(a.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' }); // after endWaitMs, from both slots
    expect(b.lm.outcome()).toBeNull();
    await until(clock, [a, b], () => stallStage(b.lm.silentMs()) === 'flag', 100 * 30);
    expect(store.get('end/zombies')).toBe(store.get('end/plants')); // the race is lost: the host filled it
    b.lm.giveUp(); // its own slot already holds the host's record: the write is refused
    await frames(clock, [a, b], 60);
    expect(b.lm.outcome()).toBeNull(); // it does not settle a flag against a stored win
    expect(store.size).toBeGreaterThan(0); // and nothing is deleted
    deaf = false;
    b.lm.visible(); // the stream is back: the slots decide
    await frames(clock, [a, b], 5);
    expect(b.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
  });

  it('a forfeit is refused once an end record is known', async () => {
    const { clock, store, a, b } = pair();
    a.before = nudgeAt([95], (p) => { p.lm.match.state.baseHp.zombies = 0; });
    b.before = (p) => { if (p.lm.match.state.tick >= 90) p.stepping = false; };
    started(a, b);
    await until(clock, [a, b], () => a.lm.match.state.winner !== null);
    await frames(clock, [a, b], 15); // the host's end reaches the guest, which does not step
    b.lm.forfeit();
    a.lm.forfeit();
    await frames(clock, [a, b], 15);
    expect(store.has('quit')).toBe(false);
    expect([a.lm.outcome(), b.lm.outcome()]).toEqual([null, null]);
  });

  it('a white flag removes the match; the other sees it gone', async () => {
    const { clock, store, a, b } = pair();
    started(a, b);
    await frames(clock, [a, b], 30);
    a.lm.giveUp();
    expect(a.lm.outcome()).toBeNull(); // first the give-up is stored in its own end slot
    await frames(clock, [a, b], Math.ceil((2 * LATENCY) / FRAME) + 1);
    expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'flag' });
    await frames(clock, [a, b], 10);
    expect(store.size).toBe(0);
    expect(b.lm.outcome()).toEqual({ kind: 'unfinished', why: 'gone' });
    expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'flag' });
  });

  it('counts a pending place in the spend until it runs, and reports a refused tap once', async () => {
    const { clock, a, b } = pair();
    started(a, b);
    await frames(clock, [a, b], 30);
    const m = a.lm.match;
    let place: Command | null = null;
    for (let lane = 0; lane < LANES && !place; lane++) {
      for (let col = 0; col < PLANT_COLS && !place; col++) {
        const cmd: Command = { type: 'place', faction: 'plants', unit: 'peashooter', lane, col };
        if (m.check(cmd) === null) place = cmd;
      }
    }
    const tap = a.lm.tap(place!);
    const bad = a.lm.tap({ type: 'remove', faction: 'plants', targetId: 99999 });
    if (tap === 'full' || bad === 'full') throw new Error('full');
    expect(a.lm.pending().map((p) => p.id)).toEqual([tap.id, bad.id]);
    expect(a.lm.pendingSpend()).toBe(100);
    const seen: number[] = [];
    while (m.state.tick <= Math.max(tap.runTick, bad.runTick)) {
      expect(a.lm.pendingSpend()).toBe(m.state.tick <= tap.runTick ? 100 : 0);
      await frame(clock, [a, b]);
      seen.push(...a.lm.refused());
    }
    expect(a.lm.pendingSpend()).toBe(0);
    expect(a.lm.pending()).toEqual([]);
    await frames(clock, [a, b], 10);
    seen.push(...a.lm.refused());
    expect(seen).toEqual([bad.id]);
  });
});

/**
 * Seeded random timing (all on the virtual clock): input delay 9–20, latency, which device lags or
 * freezes and when, drifts injected on either device (also just before an end), and bases falling
 * on one device, both, at different ticks, on different sides, or while the guest awaits a
 * snapshot (and the host's own end some ticks later). A common fall later ends every match a
 * repair undid. For every seed both properties must hold:
 * - no silent wait: every frame a device does not step is counted in `silentMs()`, and both
 *   settle within `endWaitMs` + 1 s of the last injected event (or the end of a freeze);
 * - the same outcome on both: the same `won` winner, the same `disagree`, or both unfinished.
 */
describe('LockstepMatch under seeded random timing', () => {
  /** 300 seeds keep this under 30 s with the full suite running beside it; the same generator passed 20 000 seeds once. */
  const SEEDS = 300;
  /** Seeds kept by name: the guest froze across the host's end, and the host's fill decided both. */
  const NAMED = [6262, 18899];
  const FRAME_MS = 1000 / 30;

  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const kindOf = (o: ReturnType<LockstepMatch['outcome']>): string => {
    if (!o) return 'none';
    if (o.kind === 'won') return `won ${o.winner}`;
    if (o.kind === 'disagree') return `disagree ${o.shown}`;
    if (o.kind === 'forfeit') return `forfeit ${o.winner}`;
    return 'unfinished';
  };

  async function runSeed(seed: number): Promise<{ seed: number; a: string; b: string; span: number; uncounted: number }> {
    const r = rng(seed);
    const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
    const sides = ['plants', 'zombies'] as const;
    const delay = int(9, 20);
    const latency = pick([int(5, 60), int(60, 200), int(200, 400)]);
    const lagger = pick(['none', 'plants', 'zombies'] as const);
    const lagEvery = int(1, 4); // 1: frozen
    const lagFrom = int(0, 1500);
    const lagTo = lagFrom + (lagEvery === 1 ? int(10, 750) : int(30, 1200));
    const driftCount = pick([0, 1, 1, 2]);
    const pattern = pick(['both', 'host', 'guest', 'apart', 'sides', 'onAwait', 'onAwaitHostLater'] as const);
    const tf = int(40, 1000);
    const side = pick(sides);
    const drifts: { seat: Faction; tick: number; side: Faction }[] = [];
    for (let i = 0; i < driftCount; i++) drifts.push({ seat: pick(sides), tick: pick([int(30, 900), Math.max(1, tf - int(0, 45))]), side: pick(sides) });
    const hostLater = int(0, 40);
    const falls: Record<Faction, { tick: number; side: Faction } | null> = { plants: null, zombies: null };
    if (pattern === 'both' || pattern === 'host' || pattern === 'apart' || pattern === 'sides') falls.plants = { tick: tf, side };
    if (pattern === 'both' || pattern === 'guest') falls.zombies = { tick: tf, side };
    if (pattern === 'apart') falls.zombies = { tick: tf + int(1, 60) * pick([1, -1]), side };
    if (pattern === 'sides') falls.zombies = { tick: tf, side: side === 'plants' ? 'zombies' : 'plants' };
    if (pattern.startsWith('onAwait') && driftCount === 0) drifts.push({ seat: pick(sides), tick: int(30, 900), side: 'plants' });
    const finalTick = Math.max(tf, ...drifts.map((d) => d.tick)) + 600;

    const clock = new VirtualClock();
    const link = memoryPair({ clock, latencyMs: latency });
    const make = (seat: Faction) => new LockstepMatch({
      match: new Match(versusConfig(SETUP)), seat, delay, host: seat === 'plants',
      me: SETUP.seats[seat], other: SETUP.seats[seat === 'plants' ? 'zombies' : 'plants'],
      channel: link[seat], now: () => clock.now(), timers: clock,
    });
    const peers: Record<Faction, LockstepMatch> = { plants: make('plants'), zombies: make('zombies') };
    const done: Record<Faction, Set<string>> = { plants: new Set(), zombies: new Set() };
    const settled: Record<Faction, number> = { plants: -1, zombies: -1 };
    const waitFrom: Record<Faction, number> = { plants: -1, zombies: -1 };
    let lastEvent = 0;
    let uncounted = 0;
    let guestFell = -1;
    for (const f of sides) peers[f].onChange(() => { if (settled[f] < 0 && peers[f].outcome()) settled[f] = clock.now(); });
    peers.plants.start();
    peers.zombies.start();
    for (let frame = 1; (settled.plants < 0 || settled.zombies < 0) && clock.now() < 400000; frame++) {
      clock.advance(FRAME_MS);
      await flush();
      if (lagger !== 'none' && frame === lagTo) lastEvent = clock.now();
      for (const f of sides) {
        if (lagger === f && frame >= lagFrom && frame < lagTo && frame % lagEvery === 0) continue;
        const lm = peers[f];
        const st = lm.match.state;
        const once = (key: string, change: () => void) => { if (!done[f].has(key)) { done[f].add(key); change(); lastEvent = clock.now(); } };
        drifts.forEach((d, i) => { if (d.seat === f && st.tick >= d.tick) once(`d${i}`, () => { st.players[d.side].energy += 1; }); });
        const fl = falls[f];
        if (fl && st.tick >= fl.tick && st.winner === null) once('fall', () => { st.baseHp[fl.side] = 0; });
        if (pattern.startsWith('onAwait') && f === 'zombies' && st.winner === null && (lm as unknown as { repairing: string }).repairing === 'awaiting') {
          once('fall', () => { st.baseHp[side] = 0; guestFell = st.tick; });
        }
        if (pattern === 'onAwaitHostLater' && f === 'plants' && guestFell >= 0 && st.tick >= guestFell + hostLater && st.winner === null) {
          once('fall', () => { st.baseHp[pick(sides)] = 0; });
        }
        if (st.tick >= finalTick && st.winner === null) once('end', () => { st.baseHp.zombies = 0; });
        const answer = lm.tryStep();
        if (answer.kind === 'ran' || lm.outcome()) {
          waitFrom[f] = -1;
        } else {
          if (waitFrom[f] < 0) waitFrom[f] = clock.now();
          uncounted = Math.max(uncounted, clock.now() - waitFrom[f] - lm.silentMs() - 2 * FRAME_MS);
        }
      }
      await flush();
    }
    return { seed, a: kindOf(peers.plants.outcome()), b: kindOf(peers.zombies.outcome()), span: Math.max(settled.plants, settled.zombies) - lastEvent, uncounted };
  }

  it(`${SEEDS} seeds and the named ones: both settle in bounded time, on the same outcome`, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad: unknown[] = [];
    const kinds = new Map<string, number>();
    for (const seed of [...NAMED, ...Array.from({ length: SEEDS }, (_, i) => i + 1)]) {
      const res = await runSeed(seed);
      kinds.set(res.a, (kinds.get(res.a) ?? 0) + 1);
      const ok = res.a !== 'none' && res.a === res.b && res.span <= VS_TIMEOUTS.endWaitMs + 1000 && res.uncounted <= 0;
      if (!ok) bad.push(res);
    }
    expect(bad).toEqual([]);
    // the seeds reach every kind of end: agreeing wins of both sides, disagreements, unfinished
    for (const k of ['won plants', 'won zombies', 'disagree plants', 'disagree zombies', 'unfinished']) expect(kinds.get(k) ?? 0).toBeGreaterThan(5);
  }, 30000);
});
