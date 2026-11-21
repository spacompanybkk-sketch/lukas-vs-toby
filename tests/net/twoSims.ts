import type { Bot } from '../../src/ai/bot';
import { createFortressPlants, createRandomChild, createSteadyZombies } from '../../src/ai/standIns';
import { defaultHeadStart, versusConfig, type VersusSetup } from '../../src/ai/versus';
import type { MatchChannel } from '../../src/net/channel';
import { LockstepMatch, type StepAnswer } from '../../src/net/lockstepMatch';
import { memoryPair, type MemoryLinkOptions, type MemoryPair } from '../../src/net/memoryChannel';
import { decodeTurn } from '../../src/net/turnCodec';
import { VirtualClock } from '../../src/net/virtualClock';
import { Match } from '../../src/sim/match';
import type { Faction } from '../../src/sim/types';

/**
 * Two devices playing one Versus match over the in-memory channel, each with its own `Match`,
 * driven by the stand-in bots (spec 10, "Two-sim soak"): Toby's seat by a random-tapping child,
 * Lukas's by the adult stand-in of his side. Every bot command goes through `LockstepMatch.tap`.
 * Time is a virtual clock; one frame is 1/30 s and each device tries one tick a frame.
 */

export const FRAME = 1000 / 30;
const FACTIONS: readonly Faction[] = ['plants', 'zombies'];
const other = (f: Faction): Faction => (f === 'plants' ? 'zombies' : 'plants');

/** The faults of the soak (spec 10): latency 50–600 ms a link, jitter 80 ms, 5% lost answers, reordered turns. */
export const SOAK_LINK: Omit<MemoryLinkOptions, 'clock' | 'seed'> = {
  minLatencyMs: 50, maxLatencyMs: 600, jitterMs: 80, loseAnswers: 0.05, reorder: true,
};
/** One peer goes dark for 30 s from virtual 60 s. */
export const BLACKOUT = { fromMs: 60_000, toMs: 90_000 };
/**
 * Input delay 30 ticks: `inputDelay` of the p90 round trip of these links (two hops of up to
 * 600 + 80 ms) clamps to its top.
 */
export const SOAK_DELAY = 30;

export interface SoakPeer {
  seat: Faction;
  lm: LockstepMatch;
  bot: Bot;
  /** `match.hash()` after every step that ended on a multiple of 30, by tick (a re-run overwrites). */
  hashes: Map<number, number>;
  /** The same hashes as computed, re-runs included: `[tick, hash, virtual ms]`. */
  computed: [number, number, number][];
  /** Ticks run, and `tryStep` answers waiting on turns (the lockstep gate refusing). */
  runs: number;
  gateWaits: number;
  /** Ticks run although this test had not seen both turns of that tick reach the device. */
  ranWithout: number[];
  /** Own turns the channel answered `ok`; the other seat's turns the stream delivered. */
  ownAcked: Set<number>;
  otherHeard: Set<number>;
  /** Control writes answered `offline` (sent again by the device), by kind. */
  offline: Record<string, number>;
  /** The other seat's hashes as they arrived: `[tick, hash, virtual ms]`. */
  heardHashes: [number, number, number][];
  /** Called before each `tryStep` (nudges). */
  before?: (p: SoakPeer) => void;
  /** Virtual ms when `repairs()` last went up, and the tick the device stood on right after. */
  repairedAt: { ms: number; tick: number }[];
  last: StepAnswer | null;
  thoughtAt: number;
}

export interface Soak {
  clock: VirtualClock;
  link: MemoryPair;
  setup: VersusSetup;
  host: Faction;
  toby: Faction;
  peers: Record<Faction, SoakPeer>;
  /** One frame: the clock moves, answers land, each device thinks and tries one tick. */
  frame(): Promise<void>;
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/**
 * The soak pair for `seed`: Toby (`p02`, with his default head start) on plants for odd seeds and
 * zombies for even ones, Lukas (`p01`) on the other side; the plants device hosts. With
 * `blackout`, that seat's device goes dark for 30 s from virtual 60 s.
 */
export function soakPair(seed: number, opts: { blackout?: Faction | null; link?: Partial<MemoryLinkOptions> } = {}): Soak {
  const clock = new VirtualClock();
  const link = memoryPair({ clock, seed, ...SOAK_LINK, ...opts.link });
  const toby: Faction = seed % 2 === 1 ? 'plants' : 'zombies';
  const seats: Record<Faction, 'p01' | 'p02'> = toby === 'plants' ? { plants: 'p02', zombies: 'p01' } : { plants: 'p01', zombies: 'p02' };
  const setup: VersusSetup = { seed, seats, head: defaultHeadStart(seats) };
  const host: Faction = 'plants';
  const blackout = opts.blackout === undefined ? (seed % 3 === 0 ? 'plants' : 'zombies') : opts.blackout;
  if (blackout) link.blackout(blackout, BLACKOUT.fromMs, BLACKOUT.toMs);

  const make = (seat: Faction): SoakPeer => {
    const peer = {} as SoakPeer;
    const raw = link[seat];
    const watched: MatchChannel = {
      publishTurns: (s, turns) => raw.publishTurns(s, turns).then((answer) => {
        if (answer === 'ok') for (const t of turns) peer.ownAcked.add(t.k);
        return answer;
      }),
      write: (rec, o) => raw.write(rec, o).then((answer) => {
        if (answer === 'offline') peer.offline[rec.kind] = (peer.offline[rec.kind] ?? 0) + 1;
        return answer;
      }),
      remove: () => raw.remove(),
      listen: (from, on) => raw.listen(from, (e) => {
        if (e.kind === 'turn' && e.seat !== seat && !peer.otherHeard.has(e.k)) {
          peer.otherHeard.add(e.k);
          const h = decodeTurn(e.raw, e.seat).hash;
          if (h) peer.heardHashes.push([h[0], h[1], clock.now()]);
        }
        on(e);
      }),
    };
    const bot = seat === toby ? createRandomChild(seat, seed)
      : seat === 'plants' ? createFortressPlants(seed) : createSteadyZombies(seed);
    Object.assign(peer, {
      seat, bot, hashes: new Map(), computed: [], runs: 0, gateWaits: 0, ranWithout: [], ownAcked: new Set(), otherHeard: new Set(),
      heardHashes: [], offline: {}, repairedAt: [], last: null, thoughtAt: -1,
      lm: new LockstepMatch({
        match: new Match(versusConfig(setup)), seat, delay: SOAK_DELAY, host: seat === host,
        me: seats[seat], other: seats[other(seat)], channel: watched, now: () => clock.now(), timers: clock,
      }),
    });
    return peer;
  };
  const peers = { plants: make('plants'), zombies: make('zombies') };

  const step = (p: SoakPeer) => {
    const { match } = p.lm;
    if (match.state.tick !== p.thoughtAt) {
      p.thoughtAt = match.state.tick;
      for (const cmd of p.bot.think(match)) p.lm.tap(cmd);
    }
    p.before?.(p);
    const repairs = p.lm.repairs();
    const answer = p.lm.tryStep();
    p.last = answer;
    if (p.lm.repairs() !== repairs) p.repairedAt.push({ ms: clock.now(), tick: match.state.tick - (answer.kind === 'ran' ? 1 : 0) });
    if (answer.kind === 'wait' && answer.why === 'turns') p.gateWaits++;
    if (answer.kind !== 'ran') return;
    p.runs++;
    const ran = match.state.tick - 1;
    const k = Math.floor(ran / 6);
    if (!p.ownAcked.has(k) || !p.otherHeard.has(k)) p.ranWithout.push(ran);
    if (match.state.tick % 30 === 0) {
      const hash = match.hash();
      p.hashes.set(match.state.tick, hash);
      p.computed.push([match.state.tick, hash, clock.now()]);
    }
  };

  return {
    clock, link, setup, host, toby, peers,
    async frame() {
      clock.advance(FRAME);
      await flush();
      for (const f of FACTIONS) step(peers[f]);
      await flush();
    },
  };
}

/** Both devices start; frames run until `done` or `maxMs` of virtual time. */
export async function run(s: Soak, done: () => boolean, maxMs: number): Promise<void> {
  const end = s.clock.now() + maxMs;
  while (!done() && s.clock.now() < end) await s.frame();
}

export const settled = (s: Soak) => s.peers.plants.lm.outcome() !== null && s.peers.zombies.lm.outcome() !== null;

export function start(s: Soak): void {
  for (const f of FACTIONS) s.peers[f].lm.start();
}
