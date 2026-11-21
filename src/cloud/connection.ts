// Types only: the fake is loaded with a dynamic import, and only in fake mode.
import type { FakeDatabase } from './fakeCloud';
import { DATABASE_URL, FAKE_DATABASE_URL, fakeDbUrl, pageCloudMode, pageFakeDatabase } from './restClient';
import type { CloudRoot } from './restClient';

// Defined in restClient.ts (which `defaultCloud` needs it in), so the two modules do not import each other.
export { fakeDbUrl };

/** What the streaming client needs of the browser's `EventSource`. */
export interface EventSourceLike {
  addEventListener(type: string, fn: (e: { data: string }) => void): void;
  close(): void;
  onerror: ((e: unknown) => void) | null;
}
export type EventSourceFactory = (url: string) => EventSourceLike;

/** One database as the Versus code reaches it: REST writes with `fetch`, reads as streams. */
export interface Connection {
  root: CloudRoot;
  /** `${base}/${root}/${path}.json?…`, query values JSON-quoted as the REST API wants. */
  url(path: string, query?: Record<string, string>): string;
  fetch: typeof fetch;
  eventSource: EventSourceFactory;
}

/** A connection to `base` (no trailing slash) under `root`. */
export function connectionTo(base: string, root: CloudRoot, fetchFn: typeof fetch, eventSource: EventSourceFactory): Connection {
  return {
    root,
    url(path, query) {
      const segs = path.split('/').filter((p) => p.length > 0).map(encodeURIComponent);
      const q = query ? new URLSearchParams(Object.entries(query).map(([k, v]) => [k, JSON.stringify(v)])).toString() : '';
      return `${base}/${[root, ...segs].join('/')}.json${q ? `?${q}` : ''}`;
    },
    fetch: fetchFn,
    eventSource,
  };
}

/** A connection to an in-memory fake database (tests, and fake mode in the page). */
export function fakeConnection(db: FakeDatabase, root: CloudRoot = 'v2'): Connection {
  return connectionTo(FAKE_DATABASE_URL, root, db.fetch, db.eventSource);
}

const pageSearch = (): string => (typeof location === 'undefined' ? '' : location.search);

/** The browser's `EventSource`, seen as an `EventSourceLike` (`open` carries no data: ''). */
const browserEventSource: EventSourceFactory = (url) => {
  const es = new EventSource(url);
  let onerror: ((e: unknown) => void) | null = null;
  return {
    addEventListener: (type, fn) => es.addEventListener(type, (e) => fn({ data: e instanceof MessageEvent ? String(e.data) : '' })),
    close: () => es.close(),
    get onerror() { return onerror; },
    set onerror(f) {
      onerror = f;
      es.onerror = f === null ? null : (e) => f(e);
    },
  };
};
const browserFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/** This page's database, the same one as its `Cloud` (`defaultCloud()`); in fake mode the same instance. */
export async function pageConnection(): Promise<Connection> {
  const mode = pageCloudMode();
  if (mode === 'fake') {
    const server = fakeDbUrl(pageSearch(), mode);
    if (server) return connectionTo(server, 'v2test', browserFetch, browserEventSource);
    return fakeConnection(await pageFakeDatabase());
  }
  return connectionTo(DATABASE_URL, mode === 'test' ? 'v2test' : 'v2', browserFetch, browserEventSource);
}
