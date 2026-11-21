import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * versus.css overrides some theme.css / hud.css rules on the same element. The bundler's load order
 * of the sheets is not ours to count on (ResultOverlay imports versus.css before hud.css), so each
 * override must be strictly more specific than the rule it beats. Read from the stylesheet text.
 */
const read = (path: string): string => fs.readFileSync(`${process.cwd()}/${path}`, 'utf8');
const VERSUS = read('src/ui/versus/versus.css');
const BASE = read('src/ui/theme.css') + read('src/ui/hud/hud.css');

/** [ids, classes + attributes + pseudo-classes, elements] of one simple selector list item. */
function specificity(sel: string): [number, number, number] {
  const s = sel.replace(/::[\w-]+/g, ' ');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const cls = (s.match(/\.[\w-]+/g) ?? []).length + (s.match(/\[[^\]]+\]/g) ?? []).length + (s.match(/:[\w-]+/g) ?? []).length;
  const els = s.replace(/\[[^\]]+\]/g, ' ').split(/[\s>+~]+/).filter((p) => /^[a-z]/i.test(p)).length;
  return [ids, cls, els];
}
const beats = (a: [number, number, number], b: [number, number, number]): boolean => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
};

/** The declarations of every top-level rule whose selector list contains `sel`, joined. */
function declarations(css: string, sel: string): string {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const found: string[] = [];
  for (let m = re.exec(flat); m !== null; m = re.exec(flat)) {
    if (m[1]!.split(',').map((x) => x.trim()).includes(sel)) found.push(m[2]!);
  }
  if (found.length === 0) throw new Error(`no rule for ${sel}`);
  return found.join(';');
}

/** [the Versus override, the base rule it overrides, a property both set]. */
const OVERRIDES: [string, string, string][] = [
  ['.result__panel.result__panel--versus', '.result__panel', 'grid-template-areas'],
  ['.panel.vs-notice__card', '.panel', 'padding'],
  ['.btn.vs-stall__flag', '.btn--square', 'padding'],
  ['.btn.vs-stall__play', '.btn--big', '--ico-size'],
  ['.btn.vs-notice__home', '.btn--big', '--ico-size'],
  ['.btn.vs-result__rematch', '.btn', 'min-width'],
  ['.btn.vs-result__rematch.is-off', ".btn[aria-disabled='true']", 'filter'],
  ['.vs-stall__line.inked', '.inked', 'font-family'],
];

describe('versus.css overrides do not depend on load order', () => {
  it.each(OVERRIDES)('%s beats %s on %s', (override, base, prop) => {
    expect(declarations(VERSUS, override)).toContain(`${prop}:`);
    expect(declarations(BASE, base)).toContain(`${prop}:`);
    expect(beats(specificity(override), specificity(base)), `${override} vs ${base}`).toBe(true);
  });

  it('the Versus result panel names the area its body sits in', () => {
    expect(declarations(VERSUS, '.result__panel.result__panel--versus')).toMatch(/grid-template-areas:\s*'word'\s*'versus'/);
    expect(declarations(VERSUS, '.vs-result')).toMatch(/grid-area:\s*versus/);
  });
});
