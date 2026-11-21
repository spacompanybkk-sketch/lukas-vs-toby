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
}

type Wrap = (c: MatchChannel) => MatchChannel;

/** p01 holds plants and hosts, p02 holds zombies; both on one in-memory database. */
function pair(wrap: Partial<Record<Faction, Wrap>> = {}) {
  const clock = new VirtualClock();
  const link = memoryPair({ clock, latencyMs: LATENCY });
  const make = (seat: Faction): Peer => {
    const raw = seat === 'plants' ? link.plants : link.zombies;
    const lm = new LockstepMatch({
      match: new Match(versusConfig(SETUP)), seat, delay: 12, host: seat === 'plants',
      me: SETUP.seats[seat], other: SETUP.seats[seat === 'plants' ? 'zombies' : 'plants'],
      channel: wrap[seat]?.(raw) ?? raw, now: () => clock.now(), timers: clock,
    });
    return { lm, hashes: new Map(), last: null, spawned: { plants: 0, zombies: 0 }, stepping: true };
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

  it('repairs a forced desync from the host within 2 s', async () => {
    const { clock, store, a, b } = pair();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let nudgedAt = -1;
    b.before = nudgeAt([300], (p) => {
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
    // and it stays repaired: no second repair, equal hashes from then on
    await frames(clock, [a, b], 300);
    expect(a.lm.repairs()).toBe(1);
    expect(b.lm.repairs()).toBe(1);
    for (const t of [...a.hashes.keys()].filter((k) => k > sync.tick && b.hashes.has(k))) {
      expect(a.hashes.get(t), `tick ${t}`).toBe(b.hashes.get(t));
    }
  });

  it('repairs three times, then a fourth mismatch ends both as broken', async () => {
    const { clock, store, a, b } = pair();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    b.before = nudgeAt([300, 900, 1500, 2100], (p) => { p.lm.match.state.players.plants.energy += 1; });
    started(a, b);
    await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null);
    expect(a.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
    expect(b.lm.outcome()).toEqual({ kind: 'unfinished', why: 'broken' });
    expect([...store.keys()].filter((k) => k.startsWith('sync/')).sort()).toEqual(['sync/s1', 'sync/s2', 'sync/s3']);
    expect(a.lm.repairs()).toBe(3);
    expect(b.lm.repairs()).toBe(3);
    const repairs = warn.mock.calls.map((c) => String(c[0])).filter((m) => /repair s[123]/.test(m));
    expect(repairs.length).toBe(3);
    for (const m of repairs) {
      const [, own, other] = /own (\d+), other (\d+)/.exec(m) ?? [];
      expect(own).toBeDefined();
      expect(own).not.toBe(other);
    }
    expect(a.lm.tryStep()).toEqual({ kind: 'over' });
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
      a.before = fall('zombies');
      b.before = fall('plants');
      started(a, b);
      await until(clock, [a, b], () => a.lm.outcome() !== null && b.lm.outcome() !== null);
      expect(a.lm.outcome()).toEqual({ kind: 'disagree', shown: 'plants' });
      expect(b.lm.outcome()).toEqual({ kind: 'disagree', shown: 'plants' });
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
