import rulesFile from '../../database.rules.json';
import type { EventSourceFactory, EventSourceLike } from './connection';
import { FAKE_DATABASE_URL } from './restClient';
import type { Json } from './stream';

/**
 * An in-memory Realtime Database behind a `fetch`-shaped function, for tests and for
 * `?cloud=fake` (the default until the rules are deployed). The real REST client talks to it
 * unchanged, and every request is checked against `database.rules.json` itself — the same file
 * that would be deployed — with the database's semantics as documented:
 *
 * - `.read`/`.write` cascade: a grant anywhere from the top down to the path allows it;
 * - `.validate` runs, without cascading, on the written node, its ancestors and every non-null
 *   node below it; a null (deleted) node is never validated;
 * - a multi-path `PATCH` is one atomic update: `newData` is the state after all of it, and if
 *   any path is refused nothing is written;
 * - `{".sv": "timestamp"}` becomes the request's `now`; empty objects are not stored; arrays are
 *   stored as objects with index keys and come back as arrays when the keys are 0..n-1;
 * - reads take `orderBy="$key"` with `startAt`/`endAt` (any other query is a 400, never more data);
 * - `eventSource` streams a path as the REST API does (spec 6.1): `open`, a `put` of the value at
 *   `/`, then a `put` for each later write that changes it (one per written path of a multi-path
 *   PATCH, the path relative to the stream; `/` for a write above it), or a `cancel` when the
 *   rules refuse the read, at the open or after a write. This is a model of the real streaming
 *   (spec 12): the real server may group a PATCH into one `patch` event, so clients handle both.
 *
 * A rule expression that throws counts as false, as in the real database. Where the fake cannot
 * tell what the real database does, it refuses rather than allows (for example `child()` with an
 * empty path segment). This module evaluates rule strings with `new Function`; the app loads it
 * only in fake mode, through a dynamic `import()`.
 */

export type { Json };
type Node = null | boolean | number | string | { [k: string]: Node };
type RuleNode = { [k: string]: RuleNode | string | boolean };

export { FAKE_DATABASE_URL };

export interface FakeRequest { method: string; path: string; body: Json | undefined; status: number | 'offline' | 'lost' }

export interface FakeDatabaseOptions {
  now?: () => number;
  /** Keep the data in this storage between page loads (`?cloud=fake` in the browser). */
  storage?: Storage;
  rules?: unknown;
}

const STORAGE_KEY = 'lvt2_fake_cloud';
const BAD_KEY = /[.$#[\]/]/;
/**
 * Rule strings call `.matches(/re/)` on a string (`$slot` or `newData.val()`), which JavaScript
 * strings do not have; the compiled rule calls `__matches(value, /re/)` instead.
 */
const MATCHES_CALL = /(\$[A-Za-z_][A-Za-z0-9_]*|newData\.val\(\))\.matches\((\/(?:\\.|[^/\\\n])+\/[a-z]*)\)/g;
const matches = (value: unknown, re: RegExp): boolean => {
  if (typeof value !== 'string') throw new TypeError('matches() on a non-string');
  return re.test(value);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const split = (path: string): string[] => path.split('/').filter((p) => p.length > 0);

/** A value as the database stores it: no empty objects, arrays as index-keyed objects, server values resolved. */
function normalize(v: unknown, now: number): Node {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new BadRequest('number');
    return v;
  }
  if (Array.isArray(v)) return normalize(Object.fromEntries(v.map((x, i) => [String(i), x])), now);
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === '.sv') {
      if (v['.sv'] === 'timestamp') return now;
      throw new BadRequest('server value');
    }
    const out: { [k: string]: Node } = {};
    for (const k of keys) {
      if (k.length === 0 || BAD_KEY.test(k)) throw new BadRequest(`key ${k}`);
      const n = normalize(v[k], now);
      if (n !== null) out[k] = n;
    }
    return Object.keys(out).length === 0 ? null : out;
  }
  throw new BadRequest('value');
}

/** A stored node as the REST API returns it: index-keyed objects back into arrays. */
function exportNode(n: Node): Json {
  if (!isObj(n)) return n;
  const keys = Object.keys(n);
  // Keys 0..n-1, each written canonically: the database answers with an array.
  const isArray = keys.length > 0 && keys.every((k) => /^(0|[1-9][0-9]*)$/.test(k) && Number(k) < keys.length);
  if (isArray) return keys.map((_, i) => exportNode(n[String(i)] ?? null));
  return Object.fromEntries(keys.map((k) => [k, exportNode(n[k] ?? null)]));
}

function getAt(tree: Node, path: readonly string[]): Node {
  let n = tree;
  for (const p of path) {
    if (!isObj(n)) return null;
    n = (n as { [k: string]: Node })[p] ?? null;
  }
  return n;
}

/** `tree` with `value` set at `path` (empty parents removed); `tree` itself is not changed. */
function setAt(tree: Node, path: readonly string[], value: Node): Node {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string, ...string[]];
  const base: { [k: string]: Node } = isObj(tree) ? { ...(tree as { [k: string]: Node }) } : {};
  const child = setAt(base[head] ?? null, rest, value);
  if (child === null) delete base[head];
  else base[head] = child;
  return Object.keys(base).length === 0 ? null : base;
}

class BadRequest extends Error {}

/** The children kept by `orderBy="$key"` with `startAt`/`endAt`. */
interface KeyRange { start?: string; end?: string }

/** Key order as the database sorts keys: 32-bit integer keys first, by value; then the rest as strings. */
const INT_KEY = /^-?(0|[1-9][0-9]{0,9})$/;
const intKey = (k: string): boolean => INT_KEY.test(k) && Math.abs(Number(k)) <= 2 ** 31 - 1;
function compareKeys(a: string, b: string): number {
  const ia = intKey(a);
  const ib = intKey(b);
  if (ia && ib) return Number(a) - Number(b);
  if (ia !== ib) return ia ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

const inRange = (key: string, r: KeyRange): boolean =>
  (r.start === undefined || compareKeys(key, r.start) >= 0) && (r.end === undefined || compareKeys(key, r.end) <= 0);

/** The query of a read, or null for none; a query the fake does not model is a bad request. */
function parseQuery(params: URLSearchParams): KeyRange | null {
  const keys = [...params.keys()];
  if (keys.length === 0) return null;
  const json = (k: string): unknown => {
    const v = params.get(k);
    if (v === null) return undefined;
    try {
      return JSON.parse(v);
    } catch {
      throw new BadRequest(`${k} is not JSON`);
    }
  };
  for (const k of keys) if (k !== 'orderBy' && k !== 'startAt' && k !== 'endAt') throw new BadRequest(`query ${k}`);
  if (json('orderBy') !== '$key') throw new BadRequest('orderBy');
  const range: KeyRange = {};
  for (const [k, field] of [['startAt', 'start'], ['endAt', 'end']] as const) {
    const v = json(k);
    if (v === undefined) continue;
    if (typeof v !== 'string') throw new BadRequest(`${k} must be a string with orderBy "$key"`);
    range[field] = v;
  }
  return range;
}

function filterNode(n: Node, r: KeyRange | null): Node {
  if (r === null || !isObj(n)) return n;
  const out = Object.fromEntries(Object.entries(n as { [k: string]: Node }).filter(([k]) => inRange(k, r)));
  return Object.keys(out).length === 0 ? null : out;
}

/** An `EventSource` on the fake: events arrive on a later turn, in order, until it is closed. */
class FakeEventSource implements EventSourceLike {
  onerror: ((e: unknown) => void) | null = null;
  private closed = false;
  private readonly fns = new Map<string, ((e: { data: string }) => void)[]>();
  constructor(private readonly onClose: () => void) {}
  addEventListener(type: string, fn: (e: { data: string }) => void): void {
    this.fns.set(type, [...(this.fns.get(type) ?? []), fn]);
  }
  close(): void {
    this.closed = true;
    this.onClose();
  }
  /** An event whose `data` is the JSON text the REST API sends. */
  send(type: string, data: string): void {
    queueMicrotask(() => {
      if (this.closed) return;
      for (const fn of this.fns.get(type) ?? []) fn({ data });
    });
  }
  /** The connection fails (no answer, a 400, the Wi-Fi gone). */
  fail(): void {
    queueMicrotask(() => {
      if (!this.closed) this.onerror?.({ type: 'error' });
    });
  }
}

interface OpenStream { es: FakeEventSource; path: string[]; range: KeyRange | null }
const DENIED = JSON.stringify('Permission denied');

/** `RuleDataSnapshot`, over one state of the tree. */
class Snap {
  constructor(private readonly tree: Node, private readonly path: readonly string[]) {}
  private node(): Node { return getAt(this.tree, this.path); }
  val(): Json { return exportNode(this.node()); }
  exists(): boolean { return this.node() !== null; }
  child(p: string): Snap {
    if (typeof p !== 'string') throw new TypeError('child() takes a string');
    const parts = p.split('/');
    // The real database fails the rule on an empty segment or a key it cannot store.
    if (parts.some((k) => k.length === 0 || BAD_KEY.test(k))) throw new TypeError(`child('${p}')`);
    return new Snap(this.tree, [...this.path, ...parts]);
  }
  parent(): Snap {
    if (this.path.length === 0) throw new Error('the root has no parent');
    return new Snap(this.tree, this.path.slice(0, -1));
  }
  hasChild(k: string): boolean { return this.child(k).exists(); }
  hasChildren(keys?: string[]): boolean {
    const n = this.node();
    if (!isObj(n)) return false;
    return keys === undefined ? Object.keys(n).length > 0 : keys.every((k) => this.hasChild(k));
  }
  isString(): boolean { return typeof this.node() === 'string'; }
  isNumber(): boolean { return typeof this.node() === 'number'; }
  isBoolean(): boolean { return typeof this.node() === 'boolean'; }
}

interface RuleStep { rule: RuleNode | undefined; vars: Record<string, string> }

const compiled = new Map<string, (...args: unknown[]) => unknown>();

/** A rule string as a JavaScript expression; throws if it uses `.matches` in a form not handled. */
export function translateRule(expr: string): string {
  const body = expr.replace(MATCHES_CALL, '__matches($1, $2)');
  if (body.includes('.matches(')) throw new Error(`the fake cannot evaluate: ${expr}`);
  return body;
}

function evaluate(expr: string | boolean | undefined, env: Record<string, unknown>): boolean {
  if (expr === undefined) return false;
  if (typeof expr === 'boolean') return expr;
  const names = Object.keys(env);
  const key = `${names.join(',')}|${expr}`;
  let fn = compiled.get(key);
  if (!fn) {
    fn = new Function('__matches', ...names, `"use strict"; return (${translateRule(expr)});`) as (...args: unknown[]) => unknown;
    compiled.set(key, fn);
  }
  try {
    return fn(matches, ...names.map((n) => env[n])) === true;
  } catch {
    return false;
  }
}

/** Every rule string in a rules tree (so a rule the fake cannot read fails at once, not silently). */
function ruleStrings(node: RuleNode, out: string[] = []): string[] {
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && k.startsWith('.')) out.push(v);
    else if (isObj(v)) ruleStrings(v as RuleNode, out);
  }
  return out;
}

export class FakeDatabase {
  /** Every request answered, in order (for tests). */
  readonly requests: FakeRequest[] = [];
  /** Every request fails as a network error, without reaching the data. */
  offline = false;
  /** Every request waits until its signal aborts (a request that hangs). */
  hang = false;
  /** The next n writes are applied, then fail as a network error (the answer is lost). */
  loseResponses = 0;
  private tree: Node = null;
  private readonly streams = new Set<OpenStream>();
  private readonly rules: RuleNode;
  private readonly now: () => number;
  private readonly storage: Storage | undefined;

  constructor(opts: FakeDatabaseOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.storage = opts.storage;
    const file = (opts.rules ?? rulesFile) as { rules: RuleNode };
    this.rules = file.rules;
    for (const r of ruleStrings(this.rules)) translateRule(r);
    try {
      const text = this.storage?.getItem(STORAGE_KEY);
      if (text) this.tree = normalize(JSON.parse(text), 0);
    } catch {
      this.tree = null;
    }
  }

  /** The raw stored value at a path, rules aside (for tests). */
  peek(path: string): Json { return exportNode(getAt(this.tree, split(path))); }

  /** Sets a value rules aside, as the Firebase console would (for tests). */
  poke(path: string, value: Json): void {
    const before = this.tree;
    this.tree = setAt(this.tree, split(path), normalize(value, this.now()));
    this.persist();
    this.notify(before, [split(path)]);
  }

  /** Streams open now. */
  openStreams(): number { return this.streams.size; }

  /** Every open stream fails as a lost connection would (a lost Wi-Fi). */
  dropStreams(): void {
    for (const s of this.streams) s.es.fail();
    this.streams.clear();
  }

  /**
   * An `EventSource` for `FAKE_DATABASE_URL/<path>.json`, read-checked as a GET. The fake has no
   * reconnect of its own: a failed stream stays failed (the client reconnects; spec 6.1).
   */
  readonly eventSource: EventSourceFactory = (input: string) => {
    let entry: OpenStream | null = null;
    const es = new FakeEventSource(() => {
      if (entry) this.streams.delete(entry);
    });
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      es.fail();
      return es;
    }
    if (url.origin !== new URL(FAKE_DATABASE_URL).origin) {
      es.fail();
      return es;
    }
    const path = decodeURIComponent(url.pathname.replace(/\.json$/, ''));
    const log = (status: FakeRequest['status']): void => { this.requests.push({ method: 'STREAM', path, body: undefined, status }); };
    if (this.offline) {
      log('offline');
      es.fail();
      return es;
    }
    let range: KeyRange | null;
    try {
      range = parseQuery(url.searchParams);
    } catch (e) {
      if (!(e instanceof BadRequest)) throw e;
      log(400);
      es.fail();
      return es;
    }
    const parts = split(path);
    es.send('open', '');
    if (!this.canRead(parts, this.now())) {
      log(401);
      es.send('cancel', DENIED);
      return es;
    }
    log(200);
    entry = { es, path: parts, range };
    this.streams.add(entry);
    es.send('put', JSON.stringify({ path: '/', data: exportNode(filterNode(getAt(this.tree, parts), range)) }));
    return es;
  };

  /** Tells each open stream about the writes at `written` that changed what it sees. */
  private notify(before: Node, written: readonly (readonly string[])[]): void {
    const now = this.now();
    for (const s of [...this.streams]) {
      if (!this.canRead(s.path, now)) {
        this.streams.delete(s);
        s.es.send('cancel', DENIED);
        continue;
      }
      for (const w of written) {
        if (!w.every((p, i) => i >= s.path.length || p === s.path[i])) continue;
        let at: readonly string[];
        let range: KeyRange | null = null;
        if (w.length <= s.path.length) {
          // At the stream or above it: the whole (filtered) value again.
          at = s.path;
          range = s.range;
        } else {
          at = w;
          if (s.range && !inRange(w[s.path.length]!, s.range)) continue;
        }
        const was = exportNode(filterNode(getAt(before, at), range));
        const is = exportNode(filterNode(getAt(this.tree, at), range));
        if (JSON.stringify(was) === JSON.stringify(is)) continue;
        s.es.send('put', JSON.stringify({ path: `/${at.slice(s.path.length).join('/')}`, data: is }));
      }
    }
  }

  /** A `fetch` for `FAKE_DATABASE_URL/<path>.json`. */
  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const path = decodeURIComponent(url.pathname.replace(/\.json$/, ''));
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Json) : undefined;
    const signal = init.signal ?? undefined;
    if (signal?.aborted) throw abortError();
    if (this.offline) {
      this.requests.push({ method, path, body, status: 'offline' });
      throw new TypeError('Failed to fetch');
    }
    if (this.hang) {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    }
    // Answer on a later turn, as a network would.
    await Promise.resolve();
    if (signal?.aborted) throw abortError();
    const [status, data] = this.handle(method, split(path), body, url.searchParams);
    if (method !== 'GET' && status === 200 && this.loseResponses > 0) {
      this.loseResponses -= 1;
      this.requests.push({ method, path, body, status: 'lost' });
      throw new TypeError('Failed to fetch');
    }
    this.requests.push({ method, path, body, status });
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };

  private handle(method: string, path: string[], body: Json | undefined, query: URLSearchParams): [number, Json] {
    const now = this.now();
    try {
      if (method === 'GET') {
        const range = parseQuery(query);
        if (!this.canRead(path, now)) return [401, { error: 'Permission denied' }];
        return [200, exportNode(filterNode(getAt(this.tree, path), range))];
      }
      let writes: [string[], Node][];
      if (method === 'PUT') writes = [[path, normalize(body, now)]];
      else if (method === 'DELETE') writes = [[path, null]];
      else if (method === 'PATCH') {
        if (!isObj(body)) throw new BadRequest('PATCH needs an object');
        writes = Object.entries(body).map(([k, v]) => [[...path, ...split(k)], normalize(v, now)]);
        for (const [a] of writes) {
          for (const [b] of writes) {
            if (a !== b && a.length <= b.length && a.every((p, i) => p === b[i])) throw new BadRequest('overlapping paths');
          }
        }
      } else {
        return [405, { error: 'Method not allowed' }];
      }
      let next = this.tree;
      for (const [p, v] of writes) next = setAt(next, p, v);
      for (const [p] of writes) {
        if (!this.canWrite(p, next, now) || !this.valid(p, next, now)) return [401, { error: 'Permission denied' }];
      }
      const before = this.tree;
      this.tree = next;
      this.persist();
      this.notify(before, writes.map(([p]) => p));
      if (method === 'PATCH') return [200, body ?? null];
      return [200, method === 'DELETE' ? null : exportNode(getAt(next, path))];
    } catch (e) {
      if (e instanceof BadRequest) return [400, { error: e.message }];
      throw e;
    }
  }

  /** The rule node at each depth from the top (index 0) down to `path`, with the `$` captures so far. */
  private steps(path: readonly string[]): RuleStep[] {
    const out: RuleStep[] = [{ rule: this.rules, vars: {} }];
    let rule: RuleNode | undefined = this.rules;
    let vars: Record<string, string> = {};
    for (const key of path) {
      let next: RuleNode | undefined;
      if (rule) {
        const literal = rule[key];
        if (!key.startsWith('$') && !key.startsWith('.') && isObj(literal)) next = literal as RuleNode;
        else {
          const wild = Object.keys(rule).find((k) => k.startsWith('$'));
          if (wild) {
            next = rule[wild] as RuleNode;
            vars = { ...vars, [wild]: key };
          }
        }
      }
      rule = next;
      out.push({ rule, vars });
    }
    return out;
  }

  private env(path: readonly string[], vars: Record<string, string>, next: Node, now: number): Record<string, unknown> {
    return {
      root: new Snap(this.tree, []),
      data: new Snap(this.tree, path),
      newData: new Snap(next, path),
      now,
      auth: null,
      ...vars,
    };
  }

  private canRead(path: readonly string[], now: number): boolean {
    return this.steps(path).some((s, depth) =>
      evaluate(s.rule?.['.read'] as string | boolean | undefined, this.env(path.slice(0, depth), s.vars, this.tree, now)));
  }

  private canWrite(path: readonly string[], next: Node, now: number): boolean {
    return this.steps(path).some((s, depth) =>
      evaluate(s.rule?.['.write'] as string | boolean | undefined, this.env(path.slice(0, depth), s.vars, next, now)));
  }

  private valid(path: readonly string[], next: Node, now: number): boolean {
    const steps = this.steps(path);
    for (let depth = 0; depth < steps.length; depth++) {
      const at = path.slice(0, depth);
      if (getAt(next, at) === null) continue;
      const step = steps[depth]!;
      const rule = step.rule?.['.validate'];
      if (rule !== undefined && !evaluate(rule as string | boolean, this.env(at, step.vars, next, now))) return false;
    }
    const last = steps[steps.length - 1]!;
    return this.validBelow(path, last, next, now);
  }

  private validBelow(path: readonly string[], step: RuleStep, next: Node, now: number): boolean {
    const n = getAt(next, path);
    if (!isObj(n) || !step.rule) return true;
    for (const key of Object.keys(n)) {
      const rule = step.rule;
      let child: RuleStep | undefined;
      if (isObj(rule[key])) child = { rule: rule[key] as RuleNode, vars: step.vars };
      else {
        const wild = Object.keys(rule).find((k) => k.startsWith('$'));
        if (wild) child = { rule: rule[wild] as RuleNode, vars: { ...step.vars, [wild]: key } };
      }
      if (!child) continue;
      const at = [...path, key];
      const v = child.rule?.['.validate'];
      if (v !== undefined && !evaluate(v as string | boolean, this.env(at, child.vars, next, now))) return false;
      if (!this.validBelow(at, child, next, now)) return false;
    }
    return true;
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(exportNode(this.tree)));
    } catch {
      // A fake that forgets is still a fake.
    }
  }
}

function abortError(): Error {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}
