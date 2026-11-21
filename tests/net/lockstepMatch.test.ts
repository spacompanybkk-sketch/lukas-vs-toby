import { afterEach, describe, expect, it, vi } from 'vitest';
import { versusConfig, type VersusSetup } from '../../src/ai/versus';
import { ALL_CARDS } from '../../src/data/units';
import type { MatchChannel, WriteAnswer } from '../../src/net/channel';
import { LockstepMatch, type StepAnswer } from '../../src/net/lockstepMatch';
import { memoryPair } from '../../src/net/memoryChannel';
import { stallStage } from '../../src/net/timeouts';
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

    it('takes its own result after 10 s when the other end never comes', async () => {
      const { clock, a, b } = pair();
      a.before = fall('zombies');
      b.before = (p) => { if (p.lm.match.state.tick >= 90) p.stepping = false; };
      started(a, b);
      await until(clock, [a, b], () => a.lm.match.state.winner !== null);
      const endedAt = clock.now();
      await until(clock, [a], () => clock.now() >= endedAt + 9900);
      expect(a.lm.outcome()).toBeNull();
      await frames(clock, [a], 10);
      expect(a.lm.outcome()).toEqual({ kind: 'won', winner: 'plants' });
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

    it('a host that ended alone is the authority: it repairs, and both end with its winner', async () => {
      const { clock, store, a, b } = pair({}, { delay });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      a.before = nudgeAt([100], fall('plants')); // the host alone: zombies win at tick 101
      started(a, b);
      await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null, 30 * 30);
      expect(a.lm.outcome()).toEqual({ kind: 'won', winner: 'zombies' });
      expect(b.lm.outcome()).toEqual({ kind: 'won', winner: 'zombies' });
      expect([a.lm.repairs(), b.lm.repairs()]).toEqual([1, 1]);
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

  it.each([12, 13])('a host that breaks after writing its end deletes the match: the guest ends at once (delay %i)', async (delay) => {
    const refuseSync: Wrap = (ch) => ({
      publishTurns: ch.publishTurns.bind(ch), listen: ch.listen.bind(ch), remove: ch.remove.bind(ch),
      write: (rec, opts) => (rec.kind === 'sync' ? Promise.resolve('refused') : ch.write(rec, opts)),
    });
    const { clock, store, a, b } = pair({ plants: refuseSync }, { delay });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    a.before = nudgeAt([100], (p) => { p.lm.match.state.baseHp.plants = 0; }); // the host ends alone; its repair is refused
    started(a, b);
    await until(clock, [a, b], () => a.lm.outcome() !== null, 30 * 30);
    const brokeAt = clock.now();
    expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
    await until(clock, [a, b], () => b.lm.outcome() !== null, 30);
    expect(clock.now() - brokeAt).toBeLessThanOrEqual(1000);
    expect(b.lm.outcome()).toEqual({ kind: 'unfinished', why: 'gone' });
    expect(store.size).toBe(0);
    expect(warn.mock.calls.some((m) => /the match is deleted/.test(String(m[0])))).toBe(true);
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
      const { clock, a, b } = pair();
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
      expect(clock.now() - hidAt).toBeGreaterThanOrEqual(600000);
      expect(clock.now() - hidAt).toBeLessThan(602000);
      expect(a.lm.stats().maxSilentMs).toBeGreaterThanOrEqual(600000);
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
    expect(clock.now() - cutAt).toBeGreaterThanOrEqual(600000 - 1000);
    expect(clock.now() - cutAt).toBeLessThan(600000 + 1000);
    expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'silence' });
    expect(a.lm.stats().maxSilentMs).toBeGreaterThanOrEqual(600000);
  }, 30000);

  it('a white flag removes the match; the other sees it gone', async () => {
    const { clock, store, a, b } = pair();
    started(a, b);
    await frames(clock, [a, b], 30);
    a.lm.giveUp();
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
