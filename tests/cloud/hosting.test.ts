import { readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Header { source: string; headers: { key: string; value: string }[] }
const hosting = (JSON.parse(readFileSync(join(process.cwd(), 'firebase.json'), 'utf8')) as {
  hosting: { rewrites: { source: string; destination: string }[]; headers: Header[] };
}).hosting;

/** The Cache-Control the entry whose source is exactly `source` sets. */
const cacheControl = (source: string): string | undefined =>
  hosting.headers.find((h) => h.source === source)?.headers.find((x) => x.key === 'Cache-Control')?.value;

/**
 * Whether a rewrite source matches a path: a leading `!` negates the rest (as Firebase Hosting's
 * globs do); the rest is matched with Node's own glob.
 */
const rewrites = (source: string, path: string): boolean =>
  source.startsWith('!') ? !matchesGlob(path, source.slice(1)) : matchesGlob(path, source);

describe('firebase.json hosting', () => {
  it('the page itself is never cached stale; the hashed assets are cached for a year', () => {
    expect(cacheControl('/')).toBe('no-cache');
    expect(cacheControl('/index.html')).toBe('no-cache');
    expect(cacheControl('/assets/**')).toBe('public, max-age=31536000, immutable');
  });

  it('the SPA rewrite answers app paths with index.html but leaves a missing asset a plain 404', () => {
    expect(hosting.rewrites).toHaveLength(1);
    const [rw] = hosting.rewrites;
    expect(rw!.destination).toBe('/index.html');
    // No glob library in the dev dependencies: the negated form is pinned, and Node checks the rest.
    expect(rw!.source).toBe('!/assets/**');
    expect(rewrites(rw!.source, '/assets/x.js')).toBe(false);
    expect(rewrites(rw!.source, '/assets/index-0ld4a5h.js')).toBe(false);
    expect(rewrites(rw!.source, '/play')).toBe(true);
    expect(rewrites(rw!.source, '/')).toBe(true);
  });
});
