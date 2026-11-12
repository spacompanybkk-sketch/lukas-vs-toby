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

  it('keeps the three old open paths exactly as they were', () => {
    expect(rules.presence).toEqual({ '.read': true, '.write': true });
    expect(rules.rooms).toEqual({ '.read': true, '.write': true });
    expect(rules.challenges).toEqual({ '.read': true, '.write': true });
    expect(Object.keys(rules)).toEqual(['presence', 'rooms', 'challenges', 'v2', 'v2test']);
  });

  it('has the same block under v2 and v2test (only the root named inside differs)', () => {
    const v2test = JSON.stringify(rules.v2test).replaceAll("'v2test/", "'v2/");
    expect(v2test).toBe(JSON.stringify(rules.v2));
    expect(JSON.stringify(rules.v2)).not.toContain('v2test');
  });

  it.each(['v2', 'v2test'])('%s grants reads and writes only at the leaves', (R) => {
    const nodes = walk(rules[R] as Rule);
    const reads = nodes.filter((n) => '.read' in n.node).map((n) => n.path);
    const writes = nodes.filter((n) => '.write' in n.node).map((n) => n.path);
    expect(reads).toEqual(['players', 'saves/$slot/$hash', 'board']);
    expect(writes).toEqual([
      'players/$slot', 'secrets/$slot', 'saves/$slot', 'saves/$slot/$hash', 'board/$slot', 'admin/secret', 'admin/proof/$hash',
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
  });
});
