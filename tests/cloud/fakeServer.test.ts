import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { pinHash } from '../../src/cloud/hash';
import { RestCloud } from '../../src/cloud/restClient';
import { startFakeServer } from '../../tools/fake-rtdb-server';
import { T0, makeClock, saveFor } from './helpers';

/**
 * The stand-in database server for two-page browser tests (spec 10 "Browser"): one
 * `FakeDatabase` behind HTTP, with SSE streaming. Port 0 asks the system for a free one.
 */

const running: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const s of running.splice(0)) await s.close();
});

async function start() {
  const clock = makeClock();
  const s = await startFakeServer({ port: 0, now: clock.now });
  running.push(s);
  return { ...s, clock };
}

/** Reads SSE events from a streaming response until `n` have arrived. */
function sse(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events: { event: string; data: unknown }[] = [];
  const until = async (n: number) => {
    while (events.length < n) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`stream ended after ${events.length} events`);
      buf += dec.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
        const data = /^data: (.*)$/m.exec(block)?.[1] ?? '';
        events.push({ event, data: JSON.parse(data) });
      }
    }
    return events;
  };
  return { until, cancel: () => reader.cancel() };
}

describe('the fake database server', () => {
  it('serves the REST client on v2test, with the rules', async () => {
    const { url } = await start();
    const cloud = new RestCloud({ baseUrl: url, root: 'v2test' });
    const h = await pinHash('p01', '123');
    expect(await cloud.createPlayer(saveFor('p01', 'Lukas'), h)).toBe('ok');
    expect(await cloud.listPlayers()).toEqual([{ slot: 'p01', name: 'Lukas', picture: saveFor('p01').picture }]);
    expect(await cloud.loadSave('p01', 'f'.repeat(64))).toBe('wrong-pin');
    const secret = await fetch(`${url}/v2test/secrets.json`);
    expect(secret.status).toBe(401);
  });

  it('streams with Accept: text/event-stream: put, then a live put', async () => {
    const { url, clock, db } = await start();
    const res = await fetch(`${url}/v2test/players.json`, { headers: { Accept: 'text/event-stream' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    const s = sse(res);
    expect(await s.until(1)).toEqual([{ event: 'put', data: { path: '/', data: null } }]);
    clock.t = T0 + 5;
    expect(await new RestCloud({ baseUrl: url, root: 'v2test' }).createPlayer(saveFor('p02', 'Toby'), await pinHash('p02', '456'))).toBe('ok');
    const events = await s.until(2);
    expect(events[1]).toEqual({ event: 'put', data: { path: '/p02', data: { name: 'Toby', picture: saveFor('p02').picture } } });
    expect(db.openStreams()).toBe(1);
    // The page goes away: the server stops the fake stream.
    await s.cancel();
    for (let i = 0; i < 50 && db.openStreams() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(db.openStreams()).toBe(0);
  });

  it('peeks and resets, rules aside', async () => {
    const { url, db } = await start();
    db.poke('v2test/players/p01', { name: 'Lukas', picture: 'cat' });
    const peek = await fetch(`${url}/__peek?path=v2test/players`);
    expect(await peek.json()).toEqual({ p01: { name: 'Lukas', picture: 'cat' } });
    expect((await fetch(`${url}/__reset`, { method: 'POST' })).status).toBe(200);
    expect(await (await fetch(`${url}/__peek?path=v2test/players`)).json()).toBeNull();
    expect(db.peek('')).toBeNull();
  });

  it('answers OPTIONS with CORS headers for a localhost page, and none for another origin', async () => {
    const { url } = await start();
    const ok = await fetch(`${url}/v2test/players.json`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5314', 'Access-Control-Request-Method': 'PATCH' },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5314');
    expect(ok.headers.get('access-control-allow-methods')).toContain('PATCH');
    expect(ok.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('content-type');
    const get = await fetch(`${url}/v2test/players.json`, { headers: { Origin: 'http://127.0.0.1:5314' } });
    expect(get.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5314');
    const v6 = await fetch(`${url}/v2test/players.json`, { headers: { Origin: 'http://[::1]:5314' } });
    expect(v6.headers.get('access-control-allow-origin')).toBe('http://[::1]:5314');
    const evil = await fetch(`${url}/v2test/players.json`, { method: 'OPTIONS', headers: { Origin: 'http://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses every request from another website\'s page: no read, no write, no reset', async () => {
    const { url, db } = await start();
    db.poke('v2test/players/p01', { name: 'Lukas', picture: 'cat' });
    const from = (o: string) => ({ Origin: o });
    for (const origin of ['http://evil.example', 'https://localhost:5314', 'http://localhost.evil.example', 'null']) {
      expect((await fetch(`${url}/__reset`, { method: 'POST', headers: from(origin) })).status, origin).toBe(403);
      expect((await fetch(`${url}/__peek?path=v2test`, { headers: from(origin) })).status, origin).toBe(403);
      expect((await fetch(`${url}/v2test/players.json`, { headers: from(origin) })).status, origin).toBe(403);
      expect((await fetch(`${url}/v2test/players/p01.json`, { method: 'DELETE', headers: from(origin) })).status, origin).toBe(403);
      const sse = await fetch(`${url}/v2test/players.json`, { headers: { ...from(origin), Accept: 'text/event-stream' } });
      expect(sse.status, origin).toBe(403);
    }
    expect(db.peek('v2test/players')).toEqual({ p01: { name: 'Lukas', picture: 'cat' } });
    expect(db.openStreams()).toBe(0);
  });

  it('a refused stream is a 401 and an unmodelled query a 400, before any event', async () => {
    const { url, db } = await start();
    const denied = await fetch(`${url}/v2test/secrets.json`, { headers: { Accept: 'text/event-stream' } });
    expect(denied.status).toBe(401);
    expect(denied.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await denied.json()).toEqual({ error: 'Permission denied' });
    const bad = await fetch(`${url}/v2test/players.json?orderBy=%22tick%22`, { headers: { Accept: 'text/event-stream' } });
    expect(bad.status).toBe(400);
    await bad.text();
    expect(db.openStreams()).toBe(0);
  });

  it('keeps the request log short after stream opens too', async () => {
    const { url, db } = await start();
    for (let i = 0; i < 600; i++) db.requests.push({ method: 'GET', path: '/x', body: undefined, status: 200 });
    const res = await fetch(`${url}/v2test/secrets.json`, { headers: { Accept: 'text/event-stream' } });
    await res.text();
    expect(db.requests.length).toBeLessThanOrEqual(500);
    expect(db.requests[db.requests.length - 1]).toMatchObject({ method: 'STREAM', path: '/v2test/secrets', status: 401 });
  });

  it('close() ends open streams and frees the port', async () => {
    const s = await startFakeServer({ port: 0 });
    const port = Number(new URL(s.url).port);
    const res = await fetch(`${s.url}/v2test/players.json`, { headers: { Accept: 'text/event-stream' } });
    const events = sse(res);
    await events.until(1);
    expect(s.db.openStreams()).toBe(1);
    await s.close();
    await expect(events.until(2)).rejects.toThrow();
    await new Promise<void>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
    });
  });
});
