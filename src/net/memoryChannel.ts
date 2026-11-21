import type { Faction } from '../sim/types';
import type { ControlRecord, MatchChannel, MatchEvent, WriteAnswer } from './channel';
import { turnKey } from './turnCodec';
import type { VirtualClock } from './virtualClock';

/**
 * An in-memory match database for tests, optionally faulty (spec 10, "Two-sim soak"). Every hop
 * (request → store, store → answer, store → stream) takes one latency of the seat whose device
 * is on the other end:
 * - `latencyMs` alone: that latency on every hop, nothing random, everything in order.
 * - `minLatencyMs`..`maxLatencyMs`: each seat's link latency, drawn once per match from `seed`
 *   (a per-link range, not a per-message one: the per-message spread is `jitterMs`).
 * - `jitterMs`: each hop is its link latency ± up to this much (never below 0).
 * - `loseAnswers`: the share of writes whose change is applied but whose answer is lost: the
 *   device hears `offline` and retries the same value.
 * - `reorder`: turns reach a stream each on its own delay, so they may arrive out of order;
 *   control records still arrive in the order they were stored. Without it a stream is in order.
 *   A device's requests always reach the store in the order it sent them (one connection). This
 *   is a modelling assumption: separate REST requests can overtake each other on a real network.
 * Random draws come from a mulberry32 seeded with `seed`, never `Math.random`, so a run on the
 * virtual clock is repeatable.
 */
export interface MemoryLinkOptions {
  clock: VirtualClock; latencyMs?: number;
  seed?: number; minLatencyMs?: number; maxLatencyMs?: number; // seeded uniform 50..600 in the soak
  jitterMs?: number; loseAnswers?: number /* share 0..1: applied, answer lost, then retried */; reorder?: boolean;
}

export interface MemoryPair {
  plants: MatchChannel;
  zombies: MatchChannel;
  /** What the database holds (spec 8.1 keys below the match). */
  store: ReadonlyMap<string, string>;
  /**
   * `seat`'s device is cut off from virtual `fromMs` to `toMs`: its requests sent meanwhile never
   * arrive (answered `offline`), answers due meanwhile are lost (`offline`, the change stands),
   * and its stream is held, then delivered one hop after `toMs` in the order it was held.
   * Gentler than a real outage: a real stream is dropped and reopened from the device's own
   * `from` (a snapshot, already heard turns again, no `resume` event for a pause gone meanwhile),
   * and a request on a dead network can take up to the client's timeout, not one hop, to fail.
   */
  blackout(seat: Faction, fromMs: number, toMs: number): void;
}

const FACTIONS: readonly Faction[] = ['plants', 'zombies'];

/** The store key and value of a control record (the layout of spec 8.1, below the match). */
function controlEntry(rec: Exclude<ControlRecord, { kind: 'resume' }>): [key: string, value: string] {
  switch (rec.kind) {
    case 'ready': return [`ready/${rec.seat}`, String(rec.at)];
    case 'pause': return ['pause', JSON.stringify({ by: rec.by, n: rec.n })];
    case 'end': return [`end/${rec.seat}`, rec.raw];
    case 'quit': return ['quit', JSON.stringify({ by: rec.by })];
    case 'sync': return [`sync/s${rec.n}`, JSON.stringify({ tick: rec.tick, snap: rec.snap })];
    case 'again': return [`again/${rec.seat}`, String(rec.value)];
  }
}

/** Records written once: the same value again is fine (a retried write), another value is refused (spec 8.3, 8.4). */
const WRITE_ONCE = new Set<ControlRecord['kind']>(['ready', 'end', 'quit', 'sync']);

/** A seeded uniform 0..1 generator (mulberry32). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Two seats' channels on one in-memory match. A listener first gets what is stored,
 * synchronously, inside `listen`, then live events one hop after they are stored. The rules it
 * enforces: turns and write-once records keep their first value; after `remove` every write is
 * refused and listeners hear `gone`.
 */
export function memoryPair(opts: MemoryLinkOptions): MemoryPair {
  const { clock } = opts;
  const rnd = mulberry32(opts.seed ?? 1);
  const ranged = opts.minLatencyMs !== undefined && opts.maxLatencyMs !== undefined;
  const linkMs = {} as Record<Faction, number>;
  for (const f of FACTIONS) {
    linkMs[f] = ranged ? Math.round(opts.minLatencyMs! + rnd() * (opts.maxLatencyMs! - opts.minLatencyMs!)) : opts.latencyMs ?? 0;
  }
  const jitter = opts.jitterMs ?? 0;
  const lose = opts.loseAnswers ?? 0;
  const reorder = opts.reorder ?? false;
  /** One hop on `seat`'s link. */
  const hop = (seat: Faction) => (jitter > 0 ? Math.max(0, Math.round(linkMs[seat] + (2 * rnd() - 1) * jitter)) : linkMs[seat]);

  const store = new Map<string, string>();
  const controls = new Map<string, ControlRecord>(); // what a replay sends for each control key
  const listeners: Record<Faction, Set<(e: MatchEvent) => void>> = { plants: new Set(), zombies: new Set() };
  let removed = false;

  const dark: Record<Faction, { from: number; to: number }[]> = { plants: [], zombies: [] };
  const isDark = (seat: Faction, at = clock.now()) => dark[seat].some((w) => at >= w.from && at < w.to);
  /** Events that reached a dark seat's stream, delivered when its blackout ends. */
  const held: Record<Faction, MatchEvent[]> = { plants: [], zombies: [] };
  /** The latest time anything in order on `seat`'s stream is due: nothing in order may overtake it. */
  const lastDue: Record<Faction, number> = { plants: 0, zombies: 0 };

  /** A stream coming back from a blackout: until what it held is delivered, newer events queue behind it. */
  const releasing: Record<Faction, boolean> = { plants: false, zombies: false };

  const handNow = (seat: Faction, events: MatchEvent[]) => {
    for (const on of [...listeners[seat]]) for (const e of events) if (listeners[seat].has(on)) on(e);
  };

  const hand = (seat: Faction, events: MatchEvent[]) => {
    if (isDark(seat) || releasing[seat]) held[seat].push(...events);
    else handNow(seat, events);
  };

  /** Schedules `events` on `seat`'s stream: in order, unless reordering lets turns take their own delay. */
  const toStream = (seat: Faction, events: MatchEvent[], inOrder: boolean) => {
    const at = clock.now() + hop(seat);
    const due = inOrder ? Math.max(at, lastDue[seat]) : at;
    if (inOrder) lastDue[seat] = due;
    clock.set(() => hand(seat, events), due - clock.now());
  };

  const deliver = (events: MatchEvent[]) => {
    if (events.length === 0) return;
    for (const seat of FACTIONS) {
      if (!reorder) {
        toStream(seat, events, true);
        continue;
      }
      const turns = events.filter((e) => e.kind === 'turn');
      const rest = events.filter((e) => e.kind !== 'turn');
      for (const t of turns) toStream(seat, [t], false);
      if (rest.length > 0) toStream(seat, rest, true);
    }
  };

  /** The latest time a request of `seat` is due at the store. */
  const lastSent: Record<Faction, number> = { plants: 0, zombies: 0 };

  /** `seat` sends `change`: it is applied at the store one hop later and answered one hop after that. */
  const request = (seat: Faction, change: () => { answer: WriteAnswer; events: MatchEvent[] }): Promise<WriteAnswer> =>
    new Promise((resolve) => {
      if (isDark(seat)) {
        clock.set(() => resolve('offline'), hop(seat)); // never left the device
        return;
      }
      const due = Math.max(clock.now() + hop(seat), lastSent[seat]); // one connection: requests arrive in order
      lastSent[seat] = due;
      clock.set(() => {
        const { answer, events } = removed ? { answer: 'refused' as const, events: [] } : change();
        deliver(events);
        const lost = lose > 0 && rnd() < lose;
        clock.set(() => resolve(lost || isDark(seat) ? 'offline' : answer), hop(seat));
      }, due - clock.now());
    });

  const channel = (me: Faction): MatchChannel => ({
    publishTurns(seat, turns) {
      const own = turns.map(({ k, raw }) => ({ key: `turns/${seat}/${turnKey(k)}`, k, raw }));
      return request(me, () => {
        if (own.some((t) => store.has(t.key) && store.get(t.key) !== t.raw)) return { answer: 'refused', events: [] };
        const fresh = own.filter((t) => !store.has(t.key));
        for (const t of fresh) store.set(t.key, t.raw);
        return { answer: 'ok', events: fresh.map((t) => ({ kind: 'turn', seat, k: t.k, raw: t.raw })) };
      });
    },
    write(rec) {
      return request(me, () => {
        if (rec.kind === 'resume') {
          const had = store.delete('pause');
          controls.delete('pause');
          return { answer: 'ok', events: had ? [rec] : [] };
        }
        const [key, value] = controlEntry(rec);
        if (store.has(key) && WRITE_ONCE.has(rec.kind)) {
          return store.get(key) === value ? { answer: 'ok', events: [] } : { answer: 'refused', events: [] };
        }
        store.set(key, value);
        controls.set(key, rec);
        return { answer: 'ok', events: [rec] };
      });
    },
    remove() {
      return request(me, () => {
        if (removed) return { answer: 'ok', events: [] };
        removed = true;
        store.clear();
        controls.clear();
        return { answer: 'ok', events: [{ kind: 'gone' }] };
      });
    },
    listen(from, on) {
      listeners[me].add(on);
      if (removed) {
        on({ kind: 'gone' });
      } else {
        for (const seat of FACTIONS) {
          const prefix = `turns/${seat}/t`;
          const kept = [...store].filter(([key]) => key.startsWith(prefix))
            .map(([key, raw]) => ({ k: Number(key.slice(prefix.length)), raw }))
            .filter((t) => t.k >= from[seat]).sort((x, y) => x.k - y.k);
          for (const t of kept) if (listeners[me].has(on)) on({ kind: 'turn', seat, k: t.k, raw: t.raw });
        }
        for (const rec of [...controls.values()]) if (listeners[me].has(on)) on(rec);
      }
      return () => { listeners[me].delete(on); };
    },
  });

  return {
    plants: channel('plants'),
    zombies: channel('zombies'),
    store,
    blackout(seat, fromMs, toMs) {
      if (!(toMs > fromMs)) return;
      dark[seat].push({ from: fromMs, to: toMs });
      // the stream comes back: what reached it while dark arrives one hop later, in order
      clock.set(() => {
        if (isDark(seat) || releasing[seat] || held[seat].length === 0) return; // a later window releases
        releasing[seat] = true;
        clock.set(() => {
          releasing[seat] = false;
          const events = held[seat];
          held[seat] = [];
          handNow(seat, events);
        }, hop(seat));
      }, Math.max(0, toMs - clock.now()));
    },
  };
}
