import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectionTo, fakeConnection } from '../../src/cloud/connection';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import type { EventSourceLike } from '../../src/cloud/connection';
import { DATABASE_URL, FAKE_DATABASE_URL } from '../../src/cloud/restClient';
import type { CloudRoot } from '../../src/cloud/restClient';
import { RtdbStream } from '../../src/cloud/stream';
import type { StreamEvent, Timers } from '../../src/cloud/stream';

/**
 * The streaming client (spec 6.1): `EventSource` for reading, our own reconnect with backoff,
 * a reopen when the page comes back. All on a virtual clock and a scripted `EventSource`.
 */

/** Timers that run only when the test moves time on. */
class VirtualClock implements Timers {
  t = 0;
  private next = 1;
  private readonly due = new Map<number, { at: number; fn: () => void }>();
  set(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.due.set(id, { at: this.t + ms, fn });
    return id;
  }
  clear(h: unknown): void { this.due.delete(h as number); }
  pending(): number { return this.due.size; }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const first = [...this.due.entries()].filter(([, d]) => d.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!first) break;
      this.due.delete(first[0]);
      this.t = first[1].at;
      first[1].fn();
    }
    this.t = end;
  }
}

/** A scripted `EventSource`: the test makes it say things. */
class ScriptedSource implements EventSourceLike {
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  private readonly fns = new Map<string, ((e: { data: string }) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, fn: (e: { data: string }) => void): void {
    this.fns.set(type, [...(this.fns.get(type) ?? []), fn]);
  }
  close(): void { this.closed = true; }
  say(type: string, data: unknown = null): void { this.sayText(type, JSON.stringify(data)); }
  sayText(type: string, text: string): void {
    for (const fn of this.fns.get(type) ?? []) fn({ data: text });
  }
  open(): void { for (const fn of this.fns.get('open') ?? []) fn({ data: '' }); }
  fail(): void { this.onerror?.(new Error('network')); }
}

function rig(opts: { base?: string; root?: CloudRoot; query?: () => Record<string, string>; refuse?: () => boolean } = {}) {
  const sources: ScriptedSource[] = [];
  const conn = connectionTo(opts.base ?? FAKE_DATABASE_URL, opts.root ?? 'v2', globalThis.fetch, (url) => {
    // As `new EventSource(badUrl)` does.
    if (opts.refuse?.()) throw new SyntaxError('bad url');
    const s = new ScriptedSource(url);
    sources.push(s);
    return s;
  });
  const clock = new VirtualClock();
  const events: StreamEvent[] = [];
  const doc = {
    visibilityState: 'visible' as string,
    fns: new Set<() => void>(),
    addEventListener(_t: 'visibilitychange', f: () => void) { this.fns.add(f); },
    removeEventListener(_t: 'visibilitychange', f: () => void) { this.fns.delete(f); },
    show() { this.visibilityState = 'visible'; for (const f of this.fns) f(); },
    hide() { this.visibilityState = 'hidden'; for (const f of this.fns) f(); },
  };
  const make = () => new RtdbStream({
    conn, path: 'vs/here', on: (e) => events.push(e), timers: clock, doc,
    ...(opts.query ? { query: opts.query } : {}),
  });
  return { sources, clock, events, doc, make, last: () => sources[sources.length - 1]! };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RtdbStream', () => {
  it('opens one EventSource on the path and passes put and patch on; keep-alive is ignored', () => {
    const r = rig();
    const s = r.make();
    expect(r.sources.map((x) => x.url)).toEqual([`${FAKE_DATABASE_URL}/v2/vs/here.json`]);
    r.last().open();
    r.last().say('put', { path: '/', data: { p01: { at: 5 } } });
    r.last().say('keep-alive', null);
    r.last().say('patch', { path: '/p01', data: { at: 6 } });
    expect(r.events).toEqual([
      { kind: 'open' },
      { kind: 'put', path: '/', data: { p01: { at: 5 } } },
      { kind: 'patch', path: '/p01', data: { at: 6 } },
    ]);
    expect(s.opens).toBe(1);
  });

  it('never uses EventSource\'s own reconnect: on error it closes, then reopens after 0.5, 1, 2, 4, 8, 8 s', () => {
    const r = rig();
    const s = r.make();
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = r.last();
      before.fail();
      expect(before.closed).toBe(true);
      const t0 = r.clock.t;
      while (r.last() === before) r.clock.advance(100);
      gaps.push(r.clock.t - t0);
    }
    expect(gaps).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
    expect(s.opens).toBe(7);
    expect(r.events.filter((e) => e.kind === 'down')).toHaveLength(6);
    expect(r.events[0]).toEqual({ kind: 'down', why: 'error' });
  });

  /** The gaps between the opens of the next `n` sources, each made to do `act` as soon as it opens. */
  function gaps(r: ReturnType<typeof rig>, n: number, act: (s: ScriptedSource) => void): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const before = r.last();
      act(before);
      const t0 = r.clock.t;
      while (r.last() === before) r.clock.advance(100);
      out.push(r.clock.t - t0);
    }
    return out;
  }

  it('an open that is only followed by a cancel (a refused path) does not reset the backoff', () => {
    const r = rig();
    r.make();
    expect(gaps(r, 6, (s) => { s.open(); s.say('cancel', 'Permission denied'); })).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });

  it('the backoff starts again once a source has delivered data', () => {
    const r = rig();
    r.make();
    expect(gaps(r, 3, (s) => s.fail())).toEqual([500, 1000, 2000]);
    r.last().open();
    r.last().say('put', { path: '/', data: null });
    expect(gaps(r, 2, (s) => s.fail())).toEqual([500, 1000]);
    r.last().open();
    r.last().say('patch', { path: '/a', data: { b: 1 } });
    expect(gaps(r, 1, (s) => s.fail())).toEqual([500]);
  });

  it('auth_revoked counts as a cancel', () => {
    const r = rig();
    r.make();
    const first = r.last();
    first.open();
    first.say('auth_revoked', 'credential is no longer valid');
    expect(first.closed).toBe(true);
    expect(r.events).toEqual([{ kind: 'open' }, { kind: 'down', why: 'cancel' }]);
    r.clock.advance(500);
    expect(r.sources).toHaveLength(2);
  });

  it('an EventSource that throws on creation is a failure, retried with backoff', () => {
    let refuse = true;
    const r = rig({ refuse: () => refuse });
    const s = r.make();
    expect(r.events).toEqual([{ kind: 'down', why: 'error' }]);
    expect(s.opens).toBe(0);
    r.clock.advance(500);
    expect(r.events).toHaveLength(2);
    refuse = false;
    r.clock.advance(1000);
    expect(r.sources).toHaveLength(1);
    expect(s.opens).toBe(1);
    s.close();
    expect(r.doc.fns.size).toBe(0);
  });

  it('a query() that throws in the constructor leaves no listener on the page', () => {
    const r = rig({ query: () => { throw new Error('no state yet'); } });
    expect(() => r.make()).toThrow('no state yet');
    expect(r.doc.fns.size).toBe(0);
    expect(r.clock.pending()).toBe(0);
  });

  it('a cancel closes and reopens the same way', () => {
    const r = rig();
    r.make();
    const first = r.last();
    first.open();
    first.say('cancel', 'Permission denied');
    expect(first.closed).toBe(true);
    expect(r.events.slice(-1)).toEqual([{ kind: 'down', why: 'cancel' }]);
    r.clock.advance(500);
    expect(r.sources).toHaveLength(2);
  });

  it('reads query() again at each reopen, quoted as the REST API wants', () => {
    let from = 't000000';
    const r = rig({ query: () => ({ orderBy: '$key', startAt: from }) });
    r.make();
    from = 't000042';
    r.last().fail();
    r.clock.advance(500);
    const urls = r.sources.map((x) => new URL(x.url));
    expect(urls.map((u) => u.searchParams.get('startAt'))).toEqual(['"t000000"', '"t000042"']);
    expect(urls[1]!.searchParams.get('orderBy')).toBe('"$key"');
  });

  it('events from a source it has let go are not passed on', () => {
    const r = rig();
    r.make();
    const old = r.last();
    old.fail();
    old.say('put', { path: '/', data: 1 });
    old.fail();
    expect(r.events).toEqual([{ kind: 'down', why: 'error' }]);
    expect(r.clock.pending()).toBe(1);
  });

  it('a visibilitychange to visible reopens at once; to hidden it does nothing', () => {
    const r = rig();
    const s = r.make();
    r.last().fail();
    r.doc.hide();
    expect(r.sources).toHaveLength(1);
    r.doc.show();
    expect(r.sources).toHaveLength(2);
    expect(r.sources[0]!.closed).toBe(true);
    // The pending backoff timer is gone: no third source when it would have fired.
    r.clock.advance(10_000);
    expect(r.sources).toHaveLength(2);
    s.reopen();
    expect(r.sources[1]!.closed).toBe(true);
    expect(r.sources).toHaveLength(3);
  });

  it('a visibilitychange to visible reopens a healthy stream too, with a fresh query', () => {
    let from = 't000000';
    const r = rig({ query: () => ({ orderBy: '$key', startAt: from }) });
    r.make();
    r.last().open();
    r.last().say('put', { path: '/', data: { t000000: '{}' } });
    from = 't000001';
    r.doc.show();
    expect(r.sources).toHaveLength(2);
    expect(r.sources[0]!.closed).toBe(true);
    expect(r.sources[1]!.closed).toBe(false);
    expect(new URL(r.sources[1]!.url).searchParams.get('startAt')).toBe('"t000001"');
    expect(r.events.filter((e) => e.kind === 'down')).toEqual([]);
    expect(r.clock.pending()).toBe(0);
  });

  it('close() stops everything: the source, the timer, the page listener', () => {
    const r = rig();
    const s = r.make();
    r.last().fail();
    s.close();
    r.clock.advance(60_000);
    r.doc.show();
    expect(r.sources).toHaveLength(1);
    expect(r.doc.fns.size).toBe(0);
    s.close();
    s.reopen();
    expect(r.sources).toHaveLength(1);
  });

  it('a malformed message counts as an error', () => {
    const r = rig();
    r.make();
    const first = r.last();
    first.sayText('put', '{nope');
    expect(first.closed).toBe(true);
    expect(r.events).toEqual([{ kind: 'down', why: 'error' }]);
  });

  it('a page under automation opens nothing on the live v2 root; v2test and the fake are allowed', () => {
    vi.stubGlobal('navigator', { webdriver: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const live = rig({ base: DATABASE_URL, root: 'v2' });
    const s = live.make();
    expect(live.sources).toHaveLength(0);
    expect(s.opens).toBe(0);
    // The caller hears it once, so it does not wait forever; nothing is retried.
    expect(live.events).toEqual([{ kind: 'down', why: 'error' }]);
    s.reopen();
    live.clock.advance(60_000);
    expect(live.sources).toHaveLength(0);
    expect(live.events).toHaveLength(1);
    expect(live.clock.pending()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    const test = rig({ base: DATABASE_URL, root: 'v2test' });
    test.make();
    expect(test.sources).toHaveLength(1);
    const fake = rig();
    fake.make();
    expect(fake.sources).toHaveLength(1);
  });

  it('over the fake database: a dropped stream comes back after 0.5 s asking only for what it lacks', async () => {
    const db = new FakeDatabase({ now: () => 1 });
    const id = '3f9c0a1e5b7d24c68e0f1a2b3c4d5e6f';
    db.poke(`v2/vs/matches/${id}/turns/plants`, { t000000: 'a', t000001: 'b' });
    const clock = new VirtualClock();
    const seen = new Map<string, unknown>();
    const events: string[] = [];
    const roots: unknown[] = [];
    let next = 0;
    const settle = () => new Promise<void>((r) => setTimeout(r, 0));
    const s = new RtdbStream({
      conn: fakeConnection(db), path: `vs/matches/${id}/turns/plants`, timers: clock,
      doc: { addEventListener: () => undefined, removeEventListener: () => undefined },
      query: () => ({ orderBy: '$key', startAt: `t${String(next).padStart(6, '0')}` }),
      on: (e) => {
        events.push(e.kind === 'put' ? `put ${e.path}` : e.kind === 'down' ? `down ${e.why}` : e.kind);
        if (e.kind !== 'put') return;
        if (e.path === '/') roots.push(e.data);
        const add = e.path === '/' ? Object.entries((e.data ?? {}) as Record<string, unknown>) : [[e.path.slice(1), e.data] as const];
        for (const [k, v] of add) {
          seen.set(k, v);
          next = Math.max(next, Number(k.slice(1)) + 1);
        }
      },
    });
    await settle();
    db.dropStreams();
    db.poke(`v2/vs/matches/${id}/turns/plants/t000002`, 'c');
    await settle();
    expect(db.openStreams()).toBe(0);
    clock.advance(500);
    await settle();
    expect(events).toEqual(['open', 'put /', 'down error', 'open', 'put /']);
    expect(db.requests.filter((r) => r.method === 'STREAM')).toHaveLength(2);
    expect(roots).toEqual([{ t000000: 'a', t000001: 'b' }, { t000002: 'c' }]);
    expect([...seen]).toEqual([['t000000', 'a'], ['t000001', 'b'], ['t000002', 'c']]);
    s.close();
    expect(db.openStreams()).toBe(0);
  });

  it('over the fake database: a refused path backs off instead of reopening every 0.5 s', async () => {
    const db = new FakeDatabase({ now: () => 1 });
    const clock = new VirtualClock();
    const settle = () => new Promise<void>((r) => setTimeout(r, 0));
    const events: string[] = [];
    const s = new RtdbStream({
      conn: fakeConnection(db), path: 'secrets', timers: clock,
      doc: { addEventListener: () => undefined, removeEventListener: () => undefined },
      on: (e) => events.push(e.kind),
    });
    await settle();
    for (const ms of [500, 1000, 2000, 4000, 8000]) {
      clock.advance(ms - 1);
      await settle();
      const before = s.opens;
      clock.advance(1);
      await settle();
      expect(s.opens, `after ${ms} ms`).toBe(before + 1);
    }
    expect(db.requests.filter((r) => r.method === 'STREAM')).toHaveLength(6);
    expect(events.slice(0, 4)).toEqual(['open', 'down', 'open', 'down']);
    s.close();
  });
});
