import { afterEach, describe, expect, it, vi } from 'vitest';
import { versusConfig, type VersusSetup } from '../../src/ai/versus';
import { LockstepMatch } from '../../src/net/lockstepMatch';
import { memoryPair } from '../../src/net/memoryChannel';
import { VirtualClock } from '../../src/net/virtualClock';
import { Match } from '../../src/sim/match';
import type { Faction } from '../../src/sim/types';
import { BLACKOUT, FRAME, flush, run, settled, soakPair, start, type Soak, type SoakPeer } from './twoSims';

/**
 * The two-sim soak (spec 10): two devices, each with its own `Match`, play whole matches with the
 * stand-in bots over a faulty in-memory channel: seeded latency 50–600 ms a link, jitter 80 ms,
 * 5% of answers lost (the write is applied, the device retries), reordered turns, and one device
 * dark for 30 s from virtual 60 s. All on a virtual clock.
 */

const MATCHES = process.env.LVT_BALANCE ? 60 : 6;
const SEEDS = Array.from({ length: MATCHES }, (_, i) => i + 1);
const MAX_MATCH_MS = 40 * 60_000; // virtual; a bot match lasts a few minutes

afterEach(() => {
  vi.restoreAllMocks();
});

/** Ticks both recorded, outside `skip` (inclusive), where the two hashes differ. */
function differing(s: Soak, skip: [number, number] | null = null): number[] {
  const { plants: a, zombies: b } = s.peers;
  const out: number[] = [];
  for (const [t, h] of a.hashes) {
    if (skip && t >= skip[0] && t <= skip[1]) continue;
    if (b.hashes.has(t) && b.hashes.get(t) !== h) out.push(t);
  }
  return out;
}

const common = (s: Soak) => [...s.peers.plants.hashes.keys()].filter((t) => s.peers.zombies.hashes.has(t)).length;

function report(label: string, s: Soak): void {
  const line = (p: SoakPeer) => {
    const st = p.lm.stats();
    return `${p.seat}${p.seat === s.host ? ' (host)' : ''}${p.seat === s.toby ? ' toby' : ' lukas'}: ticks ${p.lm.match.state.tick}, runs ${p.runs}, gate waits ${p.gateWaits}, stalled ${Math.round(st.stalledMs)} ms (longest ${Math.round(st.maxSilentMs)}), repairs ${st.repairs}`;
  };
  console.log(`[soak] ${label}: ${JSON.stringify(s.peers.plants.lm.outcome())} at ${Math.round(s.clock.now() / 1000)} s virtual; ${common(s)} hash ticks compared\n  ${line(s.peers.plants)}\n  ${line(s.peers.zombies)}`);
}

describe('two-sim soak over a faulty channel', () => {
  it.each(SEEDS)('match seed %i: equal hashes, the same outcome, no tick without both turns', async (seed) => {
    const s = soakPair(seed);
    start(s);
    await run(s, () => settled(s), MAX_MATCH_MS);
    report(`seed ${seed}`, s);
    const { plants: a, zombies: b } = s.peers;
    expect(settled(s)).toBe(true);
    expect(a.lm.outcome()?.kind).toBe('won'); // a match the faults did not break
    expect(b.lm.outcome()).toEqual(a.lm.outcome());
    expect(common(s)).toBeGreaterThan(50); // more than 1,500 ticks checked
    expect(differing(s)).toEqual([]);
    for (const p of [a, b]) {
      expect(p.ranWithout).toEqual([]); // the gate never let a tick run without both turns
      expect(p.runs).toBe(p.lm.match.state.tick);
      expect(p.gateWaits).toBeGreaterThan(0); // the faults did make it wait
      expect(p.lm.repairs()).toBe(0);
      // the 30 s blackout stalled both devices at least that long
      expect(p.lm.stats().stalledMs).toBeGreaterThanOrEqual(BLACKOUT.toMs - BLACKOUT.fromMs - 1000);
    }
  }, 120_000);

  it('a state nudged at tick 600 is repaired within 2 s; the guest\'s drifted hashes are no divergence and no second repair', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = soakPair(7);
    const guest = s.peers.zombies;
    const host = s.peers.plants;
    let nudgedAt = -1;
    guest.before = (p) => {
      if (nudgedAt < 0 && p.lm.match.state.tick === 600) {
        p.lm.match.state.players.plants.energy += 1;
        nudgedAt = s.clock.now();
      }
    };
    start(s);
    await run(s, () => nudgedAt >= 0, MAX_MATCH_MS);
    expect(nudgedAt).toBeGreaterThan(0);
    await run(s, () => guest.repairedAt.length > 0, 5000);
    expect(host.repairedAt.length).toBe(1);
    expect(guest.repairedAt.length).toBe(1);
    const found = host.repairedAt[0]!; // the host found the mismatch and wrote its snapshot
    const restored = guest.repairedAt[0]!; // the guest took it
    // the first differing hash (tick 630) exists once both screens have run to it
    const seen = Math.max(...[host, guest].map((p) => p.computed.find(([t]) => t === 630)![2]));
    console.log(`[soak] nudge: nudged at ${Math.round(nudgedAt)} ms (tick 600); both at 630 by ${Math.round(seen)} ms; host repaired at ${Math.round(found.ms)} ms (tick ${found.tick}); guest restored at ${Math.round(restored.ms)} ms (tick ${restored.tick})`);
    expect(restored.ms - found.ms).toBeLessThanOrEqual(2000);
    expect(restored.ms - seen).toBeLessThanOrEqual(2000);
    expect(restored.tick).toBe(found.tick);

    await run(s, () => settled(s), MAX_MATCH_MS);
    report('seed 7, nudged', s);
    // hashes the guest computed from its drifted state (after the nudge, before its restore), and
    // when, if ever, the host heard them; under reordering one may come after the repair
    const drifted = guest.computed.filter(([t, , ms]) => t > 600 && ms >= nudgedAt && ms < restored.ms);
    const heardAt = (t: number, h: number) => host.heardHashes.find(([ht, hh]) => ht === t && hh === h)?.[2];
    console.log(`[soak] nudge: drifted guest hashes (tick: heard by the host at ms, repair at ${Math.round(found.ms)}): ${drifted.map(([t, h]) => `${t}: ${heardAt(t, h)?.toFixed(0) ?? 'never sent'}`).join(', ')}`);
    expect(host.lm.repairs()).toBe(1); // no second repair
    expect(guest.lm.repairs()).toBe(1);
    expect(host.lm.outcome()?.kind).toBe('won');
    expect(guest.lm.outcome()).toEqual(host.lm.outcome());
    // equal everywhere except where the guest ran drifted, between the nudge and the restore
    expect(differing(s, [600, found.tick])).toEqual([]);
    expect(guest.ranWithout).toEqual([]);
    expect(host.ranWithout).toEqual([]);
    expect(warn).toHaveBeenCalled();
  }, 120_000);
});

describe('the faulty in-memory channel', () => {
  it('is deterministic for a seed: the same match twice gives the same timeline', async () => {
    const play = async () => {
      const s = soakPair(3);
      start(s);
      await run(s, () => s.peers.plants.lm.match.state.tick >= 900, 120_000);
      return [s.clock.now(), s.peers.plants.gateWaits, s.peers.zombies.gateWaits, s.peers.zombies.lm.match.hash()];
    };
    expect(await play()).toEqual(await play());
  });

  it('a lost answer still applied the write; the retry is answered ok', async () => {
    const clock = new VirtualClock();
    const link = memoryPair({ clock, seed: 5, latencyMs: 100, loseAnswers: 1 });
    const answers: string[] = [];
    void link.plants.publishTurns('plants', [{ k: 0, raw: '{}' }]).then((a) => answers.push(a));
    clock.advance(250);
    await Promise.resolve();
    expect(answers).toEqual(['offline']);
    expect(link.store.get('turns/plants/t000000')).toBe('{}');
  });

  it('a dark seat is not reached: its writes are offline, its stream is held and delivered after', async () => {
    const clock = new VirtualClock();
    const link = memoryPair({ clock, latencyMs: 100 });
    link.blackout('zombies', 0, 1000);
    const heard: number[] = [];
    link.zombies.listen({ plants: 0, zombies: 0 }, (e) => { if (e.kind === 'turn') heard.push(clock.now()); });
    const answers: string[] = [];
    void link.zombies.publishTurns('zombies', [{ k: 0, raw: '{}' }]).then((a) => answers.push(a));
    void link.plants.publishTurns('plants', [{ k: 0, raw: '{}' }]);
    clock.advance(999);
    await Promise.resolve();
    expect(answers).toEqual(['offline']);
    expect(link.store.has('turns/zombies/t000000')).toBe(false);
    expect(link.store.has('turns/plants/t000000')).toBe(true);
    expect(heard).toEqual([]);
    clock.advance(200);
    expect(heard).toEqual([1100]); // the end of the blackout plus one hop
  });

  it('reorders turns but keeps control records in order', async () => {
    const clock = new VirtualClock();
    const link = memoryPair({ clock, seed: 9, minLatencyMs: 50, maxLatencyMs: 600, jitterMs: 300, reorder: true });
    const turns: number[] = [];
    const pauses: number[] = [];
    link.zombies.listen({ plants: 0, zombies: 0 }, (e) => {
      if (e.kind === 'turn') turns.push(e.k);
      if (e.kind === 'pause') pauses.push(e.n);
    });
    for (let k = 0; k < 40; k++) {
      void link.plants.publishTurns('plants', [{ k, raw: '{}' }]);
      void link.plants.write({ kind: 'pause', by: 'p01', n: 4 * (k + 1) });
      clock.advance(10);
    }
    clock.advance(5000);
    expect(turns.length).toBe(40);
    expect(turns).not.toEqual([...turns].sort((x, y) => x - y));
    expect(pauses).toEqual([...pauses].sort((x, y) => x - y));
    expect(pauses.length).toBe(40);
  });
});

/**
 * Reviewer minor M2 of task 3: a white flag in the pause menu (`forfeit`) on a guest that has not
 * heard the host's end record races the host's fill of the guest's slot after `endWaitMs`.
 */
describe('open race M2: forfeit against the host\'s 10 s fill', () => {
  /**
   * The host's state ends at tick 96 with the guest's side winning, and the guest's link goes dark
   * for `darkMs` right then; the guest's player presses the forfeit `flagAtMs` after the host's end.
   */
  async function race(darkMs: number, flagAtMs: number) {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = new VirtualClock();
    const link = memoryPair({ clock, latencyMs: 100 });
    const setup: VersusSetup = { seed: 2, seats: { plants: 'p01', zombies: 'p02' }, head: null };
    const make = (seat: Faction) => new LockstepMatch({
      match: new Match(versusConfig(setup)), seat, delay: 12, host: seat === 'plants',
      me: setup.seats[seat], other: setup.seats[seat === 'plants' ? 'zombies' : 'plants'],
      channel: link[seat], now: () => clock.now(), timers: clock,
    });
    const host = make('plants');
    const guest = make('zombies');
    host.start();
    guest.start();
    let endedAt = -1;
    const frame = async () => {
      clock.advance(FRAME);
      await flush();
      if (host.match.state.tick === 95 && endedAt < 0) host.match.state.baseHp.plants = 0;
      host.tryStep();
      if (host.match.state.winner !== null && endedAt < 0) {
        endedAt = clock.now();
        link.blackout('zombies', endedAt, endedAt + darkMs); // the host's end record does not reach the guest
      }
      guest.tryStep();
      await flush();
    };
    while (endedAt < 0) await frame();
    while (clock.now() < endedAt + flagAtMs) await frame();
    expect(guest.outcome()).toBeNull();
    guest.pause();
    guest.forfeit(); // the white flag in the pause menu, the host's end still unheard
    while (clock.now() < Math.max(endedAt + darkMs, endedAt + 10_000) + 3000) await frame();
    return { host: host.outcome(), guest: guest.outcome(), store: link.store };
  }

  it('reproduces: the guest dark for 12 s and flagging at 9.5 s; the host shows a win, the guest a forfeit for the other side', async () => {
    const r = await race(12_000, 9500);
    expect(r.host).toEqual({ kind: 'won', winner: 'zombies' }); // the host filled the guest's slot at 10 s
    expect(r.guest).toEqual({ kind: 'forfeit', winner: 'plants', by: 'p02' });
    expect(r.store.get('quit')).toBe(JSON.stringify({ by: 'p02' })); // the quit landed after the host had settled
  });

  // Known open race (M2), reproduced above. The end protocol is not redesigned in this task; the
  // controller rules on it. This is the property that should hold, and it fails today.
  it.fails('both devices show the same outcome when a forfeit races the host\'s fill', async () => {
    const r = await race(12_000, 9500);
    expect(r.guest).toEqual(r.host);
  });

  it('no race when the quit lands before the fill (dark 8 s, flag at 7 s): both show the forfeit', async () => {
    const r = await race(8000, 7000);
    expect(r.host).toEqual({ kind: 'forfeit', winner: 'plants', by: 'p02' });
    expect(r.guest).toEqual(r.host);
  });
});
