/**
 * A stand-in for the Realtime Database REST API on this machine (spec 10 "Browser"): one
 * `FakeDatabase` — which checks every request against `database.rules.json` — behind HTTP, with
 * SSE streaming, so two browser pages (two players, two contexts) share one database. There is
 * no Firebase emulator here (no Java). Nothing ever reaches the real database.
 *
 *   npx tsx tools/fake-rtdb-server.ts --port 5316     (default: $LVT_FAKEDB_PORT, else 5316)
 *
 * Pages open `?debug&cloud=fake&fakedb=http://localhost:5316` and use the `v2test` root.
 *
 * - GET/PUT/PATCH/DELETE on `/<path>.json` as the REST API; GET with `Accept: text/event-stream`
 *   streams `put`/`cancel` events (and `keep-alive` every 30 s);
 * - `GET /__peek?path=…` the stored value, rules aside; `POST /__reset` empties the database;
 * - CORS for any `http://localhost:<port>` or `http://127.0.0.1:<port>` page;
 * - listens on the loopback addresses only.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { FAKE_DATABASE_URL, FakeDatabase } from '../src/cloud/fakeCloud';

export const DEFAULT_PORT = 5316;
const KEEP_ALIVE_MS = 30_000;
/** Requests kept in `db.requests`, so a long browser run does not grow without end. */
const KEEP_REQUESTS = 500;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/;

export interface FakeServer { url: string; db: FakeDatabase; close(): Promise<void> }

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (origin === undefined || !LOCAL_ORIGIN.test(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, PATCH, DELETE, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Cache-Control, Last-Event-ID',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const a = server.address();
      resolve(typeof a === 'object' && a !== null ? a.port : port);
    });
  });
}

function shut(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export async function startFakeServer(opts: { port: number; now?: () => number }): Promise<FakeServer> {
  const db = new FakeDatabase(opts.now ? { now: opts.now } : {});
  /** Ends each open SSE response. */
  const streams = new Set<() => void>();

  const json = (res: ServerResponse, status: number, body: unknown, cors: Record<string, string>): void => {
    res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const stream = (req: IncomingMessage, res: ServerResponse, target: string, cors: Record<string, string>): void => {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const es = db.eventSource(target);
    const send = (event: string, data: string): void => { res.write(`event: ${event}\ndata: ${data}\n\n`); };
    let ended = false;
    const keepAlive = setInterval(() => send('keep-alive', 'null'), KEEP_ALIVE_MS);
    keepAlive.unref();
    const end = (): void => {
      if (ended) return;
      ended = true;
      clearInterval(keepAlive);
      streams.delete(end);
      es.close();
      res.end();
    };
    streams.add(end);
    for (const type of ['put', 'patch']) es.addEventListener(type, (e) => send(type, e.data));
    // The REST API closes the connection after a cancel; a failure ends it with no event.
    es.addEventListener('cancel', (e) => {
      send('cancel', e.data);
      end();
    });
    es.onerror = end;
    req.on('close', end);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const cors = corsHeaders(req.headers.origin);
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (url.pathname === '/__peek' && method === 'GET') return json(res, 200, db.peek(url.searchParams.get('path') ?? ''), cors);
    if (url.pathname === '/__reset' && method === 'POST') {
      db.poke('', null);
      db.requests.length = 0;
      return json(res, 200, null, cors);
    }
    if (!url.pathname.endsWith('.json')) return json(res, 404, { error: 'Not found' }, cors);
    const target = `${FAKE_DATABASE_URL}${url.pathname}${url.search}`;
    if (method === 'GET' && (req.headers.accept ?? '').includes('text/event-stream')) return stream(req, res, target, cors);
    const body = await readBody(req);
    if (body !== '') {
      try {
        JSON.parse(body);
      } catch {
        return json(res, 400, { error: 'Invalid data; couldn\'t parse JSON object.' }, cors);
      }
    }
    // Each request is applied whole by the fake (a multi-path PATCH is atomic there), in arrival order.
    const answer = await db.fetch(target, { method, ...(body === '' ? {} : { body }) });
    if (db.requests.length > KEEP_REQUESTS) db.requests.splice(0, db.requests.length - KEEP_REQUESTS);
    res.writeHead(answer.status, { ...cors, 'Content-Type': 'application/json' });
    res.end(await answer.text());
  };

  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res).catch((e: unknown) => {
      console.error('fake-rtdb-server:', e);
      if (!res.headersSent) res.writeHead(500, corsHeaders(req.headers.origin));
      res.end();
    });
  };

  // IPv4 loopback first (its port is the server's); then IPv6 loopback on the same port, so a
  // browser that resolves `localhost` to ::1 finds it too. A machine without ::1 does without.
  const v4 = createServer(onRequest);
  const port = await listen(v4, opts.port, '127.0.0.1');
  const v6 = createServer(onRequest);
  try {
    await listen(v6, port, '::1');
  } catch {
    // No IPv6 loopback here; 127.0.0.1 serves alone.
  }

  return {
    url: `http://127.0.0.1:${port}`,
    db,
    close: async () => {
      for (const end of [...streams]) end();
      await Promise.all([shut(v4), shut(v6)]);
    },
  };
}

function portFromArgs(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const i = argv.indexOf('--port');
  const raw = i >= 0 ? argv[i + 1] : env.LVT_FAKEDB_PORT;
  const port = raw === undefined ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`not a port: ${raw}`);
  return port;
}

const main = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (main) {
  startFakeServer({ port: portFromArgs(process.argv.slice(2), process.env) }).then((s) => {
    console.log(`fake database on ${s.url} (and localhost); Ctrl-C stops it`);
    const stop = (): void => { void s.close().then(() => process.exit(0)); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }, (e: unknown) => {
    console.error('fake-rtdb-server:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
