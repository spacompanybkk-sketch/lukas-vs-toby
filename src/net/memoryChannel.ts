import type { Faction } from '../sim/types';
import type { ControlRecord, MatchChannel, MatchEvent, WriteAnswer } from './channel';
import { turnKey } from './turnCodec';
import type { VirtualClock } from './virtualClock';

/** An in-memory match database for tests. `latencyMs` is one way: request → store → answer, store → stream. */
export interface MemoryLinkOptions { clock: VirtualClock; latencyMs?: number }

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

/**
 * Two seats' channels on one in-memory match. Every write reaches the store `latencyMs` after it
 * is sent, its answer comes back `latencyMs` later, and every listener hears the change `latencyMs`
 * after it is stored. A listener first gets what is stored, synchronously, inside `listen`.
 * The rules it enforces: turns and write-once records keep their first value; after `remove`
 * every write is refused and listeners hear `gone`.
 */
export function memoryPair(opts: MemoryLinkOptions): {
  plants: MatchChannel; zombies: MatchChannel; store: ReadonlyMap<string, string>;
} {
  const { clock } = opts;
  const latency = opts.latencyMs ?? 0;
  const store = new Map<string, string>();
  const controls = new Map<string, ControlRecord>(); // what a replay sends for each control key
  const listeners = new Set<(e: MatchEvent) => void>();
  let removed = false;

  const deliver = (events: MatchEvent[]) => {
    if (events.length === 0) return;
    clock.set(() => {
      for (const on of [...listeners]) for (const e of events) if (listeners.has(on)) on(e);
    }, latency);
  };

  /** Applies `change` at the store after one latency and answers after another. */
  const request = (change: () => { answer: WriteAnswer; events: MatchEvent[] }): Promise<WriteAnswer> =>
    new Promise((resolve) => {
      clock.set(() => {
        const { answer, events } = removed ? { answer: 'refused' as const, events: [] } : change();
        deliver(events);
        clock.set(() => resolve(answer), latency);
      }, latency);
    });

  const channel = (): MatchChannel => ({
    publishTurns(seat, turns) {
      const own = turns.map(({ k, raw }) => ({ key: `turns/${seat}/${turnKey(k)}`, k, raw }));
      return request(() => {
        if (own.some((t) => store.has(t.key) && store.get(t.key) !== t.raw)) return { answer: 'refused', events: [] };
        const fresh = own.filter((t) => !store.has(t.key));
        for (const t of fresh) store.set(t.key, t.raw);
        return { answer: 'ok', events: fresh.map((t) => ({ kind: 'turn', seat, k: t.k, raw: t.raw })) };
      });
    },
    write(rec) {
      return request(() => {
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
      return request(() => {
        if (removed) return { answer: 'ok', events: [] };
        removed = true;
        store.clear();
        controls.clear();
        return { answer: 'ok', events: [{ kind: 'gone' }] };
      });
    },
    listen(from, on) {
      listeners.add(on);
      if (removed) {
        on({ kind: 'gone' });
      } else {
        for (const seat of FACTIONS) {
          const prefix = `turns/${seat}/t`;
          const held = [...store].filter(([key]) => key.startsWith(prefix))
            .map(([key, raw]) => ({ k: Number(key.slice(prefix.length)), raw }))
            .filter((t) => t.k >= from[seat]).sort((x, y) => x.k - y.k);
          for (const t of held) if (listeners.has(on)) on({ kind: 'turn', seat, k: t.k, raw: t.raw });
        }
        for (const rec of [...controls.values()]) if (listeners.has(on)) on(rec);
      }
      return () => { listeners.delete(on); };
    },
  });

  return { plants: channel(), zombies: channel(), store };
}
