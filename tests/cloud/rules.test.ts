import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PICTURES } from '../../src/progress/save';

type Rule = { [k: string]: Rule | string | boolean };

const ROOT = process.cwd();
const text = readFileSync(join(ROOT, 'database.rules.json'), 'utf8');
const rules = (JSON.parse(text) as { rules: Rule }).rules;
const SLOT_RE = '$slot.matches(/^p(0[1-9]|[12][0-9]|30)$/)';

/** Every node of a rule tree with its path, e.g. `players/$slot`. */
function walk(node: Rule, path: string[] = [], out: { path: string; node: Rule }[] = []) {
  out.push({ path: path.join('/'), node });
  for (const [k, v] of Object.entries(node)) if (!k.startsWith('.') && typeof v === 'object') walk(v, [...path, k], out);
  return out;
}

describe('database.rules.json', () => {
  it('is exactly what tools/build-rules.mjs builds', () => {
    const built = execFileSync(process.execPath, [join(ROOT, 'tools', 'build-rules.mjs'), '--print'], { encoding: 'utf8' });
    expect(text).toBe(built);
  });

  it('closes the old paths: only v2 and v2test at the top, and no grant at the root', () => {
    expect(Object.keys(rules)).toEqual(['v2', 'v2test']);
    for (const p of ['presence', 'rooms', 'challenges']) expect(rules[p], p).toBeUndefined();
    expect(rules['.read']).toBeUndefined();
    expect(rules['.write']).toBeUndefined();
  });

  it('has the same block under v2 and v2test (only the root named inside, and the test rule of meta, differ)', () => {
    const metaOf = (R: string) => ((((rules[R] as Rule).vs as Rule).matches as Rule)['$id'] as Rule).meta as Rule;
    // The one real difference: `test` (smaller base health) is refused live and allowed on v2test.
    expect(metaOf('v2').test).toEqual({ '.validate': false });
    expect(String((metaOf('v2test').test as Rule)['.validate'])).toContain('newData.val() >= 1 && newData.val() <= 500');
    const without = (R: string) => {
      const copy = JSON.parse(JSON.stringify(rules[R])) as Rule;
      delete ((((copy.vs as Rule).matches as Rule)['$id'] as Rule).meta as Rule).test;
      return JSON.stringify(copy);
    };
    expect(without('v2test').replaceAll("'v2test/", "'v2/")).toBe(without('v2'));
    expect(JSON.stringify(rules.v2)).not.toContain('v2test');
  });

  it.each(['v2', 'v2test'])('%s grants reads and writes only at the leaves', (R) => {
    const nodes = walk(rules[R] as Rule);
    const reads = nodes.filter((n) => '.read' in n.node).map((n) => n.path);
    const writes = nodes.filter((n) => '.write' in n.node).map((n) => n.path);
    expect(reads).toEqual(['players', 'saves/$slot/$hash', 'board', 'vs/here', 'vs/lobby/$owner', 'vs/matches/$id', 'vs/results/$id']);
    expect(writes).toEqual([
      'players/$slot', 'secrets/$slot', 'saves/$slot', 'saves/$slot/$hash', 'board/$slot', 'admin/secret', 'admin/proof/$hash',
      'proof/$slot', 'proof/$slot/$hash', 'vs/here/$slot', 'vs/lobby/$owner', 'vs/lobby/$owner/in/$from', 'vs/lobby/$owner/back/$from',
      'vs/matches/$id', 'vs/matches/$id/meta', 'vs/matches/$id/ready/$seat', 'vs/matches/$id/end/$seat',
      'vs/matches/$id/again/$seat', 'vs/matches/$id/turns/$seat/$k', 'vs/matches/$id/pause',
      'vs/matches/$id/sync/$n', 'vs/results/$id',
    ]);
    expect((rules[R] as Rule)['.read']).toBeUndefined();
    expect((rules[R] as Rule)['.write']).toBeUndefined();
  });

  it.each(['v2', 'v2test'])('%s checks the slot pattern on every slot read and write', (R) => {
    for (const { path, node } of walk(rules[R] as Rule)) {
      if (!path.includes('$slot')) continue;
      for (const k of ['.read', '.write'] as const) if (k in node) expect(String(node[k]), `${path} ${k}`).toContain(SLOT_RE);
    }
  });

  it('allows every picture key and no other', () => {
    const v = String(((rules.v2 as Rule).players as Rule)['$slot'] && (((rules.v2 as Rule).players as Rule)['$slot'] as Rule).picture && ((((rules.v2 as Rule).players as Rule)['$slot'] as Rule).picture as Rule)['.validate']);
    expect(v).toContain(`/^(${PICTURES.join('|')})$/`);
  });

  it('reads saves only at the exact hash path, and secrets and admin never', () => {
    const v2 = rules.v2 as Rule;
    expect(String(((v2.saves as Rule)['$slot'] as Rule)['$hash'] && (((v2.saves as Rule)['$slot'] as Rule)['$hash'] as Rule)['.read']))
      .toContain("root.child('v2/secrets/' + $slot).val() === $hash");
    expect(JSON.stringify(v2.secrets)).not.toContain('.read');
    expect(JSON.stringify(v2.admin)).not.toContain('.read');
    expect(JSON.stringify(v2.proof)).not.toContain('.read');
  });

  it.each(['v2', 'v2test'])('%s lets the grown-up only delete, never write, here, lobbies and proofs', (R) => {
    const v = rules[R] as Rule;
    const write = (path: string) => String(path.split('/').reduce<Rule>((n, k) => n[k] as Rule, v)['.write']);
    const byGrownUp = `!newData.exists() && (root.child('${R}/admin/secret')`;
    for (const p of ['proof/$slot', 'vs/lobby/$owner', 'vs/here/$slot']) expect(write(p), p).toContain(byGrownUp);
  });

  it.each(['v2', 'v2test'])('%s Versus grants refuse a proof stored earlier in the same millisecond (the stored touch must not already be now)', (R) => {
    const v = rules[R] as Rule;
    const all = JSON.stringify({ proof: v.proof, vs: v.vs });
    const count = (needle: string) => all.split(needle).length - 1;
    // Every proof read in this update's data has its twin in the stored data, compared with `!== now`.
    const after = count(".child('proof/' + ") + count(".child('admin/proof/' + ");
    const before = count(`root.child('${R}/proof/' + `) + count(`root.child('${R}/admin/proof/' + `);
    expect(after).toBeGreaterThan(0);
    expect(before).toBe(after);
    expect(count("+ '/touch').val() !== now")).toBe(after);
  });

  it.each(['v2', 'v2test'])('%s checks the slot pattern on every lobby read and write', (R) => {
    for (const { path, node } of walk(rules[R] as Rule)) {
      if (!path.startsWith('vs/lobby/')) continue;
      for (const k of ['.read', '.write'] as const) {
        if (!(k in node)) continue;
        expect(String(node[k]), `${path} ${k}`).toContain('$owner.matches(/^p(0[1-9]|[12][0-9]|30)$/)');
        if (path.includes('$from')) expect(String(node[k]), `${path} ${k}`).toContain('$from.matches(/^p(0[1-9]|[12][0-9]|30)$/)');
      }
    }
  });
});
