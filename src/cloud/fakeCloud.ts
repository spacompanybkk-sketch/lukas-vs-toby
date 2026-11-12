import rulesFile from '../../database.rules.json';

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
 *   stored as objects with index keys and come back as arrays when the keys are 0..n-1.
 *
 * A rule expression that throws counts as false, as in the real database.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Node = null | boolean | number | string | { [k: string]: Node };
type RuleNode = { [k: string]: RuleNode | string | boolean };

export const FAKE_DATABASE_URL = 'https://fake-rtdb.invalid';

export interface FakeRequest { method: string; path: string; body: Json | undefined; status: number | 'offline' | 'lost' }

export interface FakeDatabaseOptions {
  now?: () => number;
  /** Keep the data in this storage between page loads (`?cloud=fake` in the browser). */
  storage?: Storage;
  rules?: unknown;
}

const STORAGE_KEY = 'lvt2_fake_cloud';
const BAD_KEY = /[.$#[\]/]/;
const MATCHES = Symbol('rules.matches');

// Rule strings call `.matches(/re/)` on strings; JavaScript strings have no such method, so the
// compiled rule calls a symbol-keyed one instead (invisible to any other code).
Object.defineProperty(String.prototype, MATCHES, {
  value(this: string, re: RegExp): boolean {
    return re.test(this);
  },
  configurable: true,
});

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

/** `RuleDataSnapshot`, over one state of the tree. */
class Snap {
  constructor(private readonly tree: Node, private readonly path: readonly string[]) {}
  private node(): Node { return getAt(this.tree, this.path); }
  val(): Json { return exportNode(this.node()); }
  exists(): boolean { return this.node() !== null; }
  child(p: string): Snap {
    if (typeof p !== 'string') throw new TypeError('child() takes a string');
    return new Snap(this.tree, [...this.path, ...split(p)]);
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

function evaluate(expr: string | boolean | undefined, env: Record<string, unknown>): boolean {
  if (expr === undefined) return false;
  if (typeof expr === 'boolean') return expr;
  const names = Object.keys(env);
  const key = `${names.join(',')}|${expr}`;
  let fn = compiled.get(key);
  if (!fn) {
    const body = expr.replace(/\.matches\(/g, '[__matches](');
    fn = new Function('__matches', ...names, `"use strict"; return (${body});`) as (...args: unknown[]) => unknown;
    compiled.set(key, fn);
  }
  try {
    return fn(MATCHES, ...names.map((n) => env[n])) === true;
  } catch {
    return false;
  }
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
  private readonly rules: RuleNode;
  private readonly now: () => number;
  private readonly storage: Storage | undefined;

  constructor(opts: FakeDatabaseOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.storage = opts.storage;
    const file = (opts.rules ?? rulesFile) as { rules: RuleNode };
    this.rules = file.rules;
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
    this.tree = setAt(this.tree, split(path), normalize(value, this.now()));
    this.persist();
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
    const [status, data] = this.handle(method, split(path), body);
    if (method !== 'GET' && status === 200 && this.loseResponses > 0) {
      this.loseResponses -= 1;
      this.requests.push({ method, path, body, status: 'lost' });
      throw new TypeError('Failed to fetch');
    }
    this.requests.push({ method, path, body, status });
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };

  private handle(method: string, path: string[], body: Json | undefined): [number, Json] {
    const now = this.now();
    try {
      if (method === 'GET') {
        if (!this.canRead(path, now)) return [401, { error: 'Permission denied' }];
        return [200, exportNode(getAt(this.tree, path))];
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
      this.tree = next;
      this.persist();
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
