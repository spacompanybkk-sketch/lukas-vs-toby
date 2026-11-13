// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { go, screen } from '../../src/app/store';
import { BALANCE } from '../../src/data/balance';
import type { UnitKey } from '../../src/sim/types';
import { Almanac } from '../../src/ui/screens/Almanac';
import type { AlmanacHost } from '../../src/ui/screens/Almanac';
import { ALMANAC_PICTURES } from '../../src/ui/screens/almanacPictures';
import { ALMANAC_UNITS, rawStats, statBars } from '../../src/ui/screens/almanacStats';

let root: HTMLElement;
let calls: string[];
const host: AlmanacHost = {
  open: (k, l) => { calls.push(`open ${k} ${l}`); },
  show: (k, l) => { calls.push(`show ${k} ${l}`); },
  play: () => { calls.push('play'); return 'shoot'; },
  close: () => { calls.push('close'); },
};

beforeEach(() => {
  calls = [];
  root = document.createElement('div');
  document.body.appendChild(root);
  go({ name: 'almanac' });
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
});

const q = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const all = (sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const tap = (sel: string): void => {
  const el = q(sel);
  if (!el) throw new Error(`missing ${sel}`);
  act(() => el.click());
};
const mount = (): void => void act(() => render(<Almanac host={host} />, root));

describe('stat bars from the balance table', () => {
  const longest = (side: 'plants' | 'zombies', pick: (k: UnitKey) => number | null): UnitKey[] => {
    const shares = ALMANAC_UNITS[side].map((k) => [k, pick(k)] as const);
    const top = Math.max(...shares.map(([, s]) => s ?? -1));
    return shares.filter(([, s]) => s === top).map(([k]) => k);
  };

  it('each bar is a share of the biggest on its own side', () => {
    for (const side of ['plants', 'zombies'] as const) {
      for (const k of ALMANAC_UNITS[side]) {
        const b = statBars(k);
        expect(b.hp).toBeGreaterThan(0);
        expect(b.hp).toBeLessThanOrEqual(1);
        if (b.dps !== null) expect(b.dps).toBeLessThanOrEqual(1);
      }
      expect(Math.max(...ALMANAC_UNITS[side].map((k) => statBars(k).hp))).toBe(1);
    }
  });

  it("the Avocado Bunker's health bar is the longest among plants", () => {
    expect(longest('plants', (k) => statBars(k).hp)).toContain('avocadoBunker');
  });

  it('the bars follow the table: more health, a longer bar', () => {
    const z = ALMANAC_UNITS.zombies;
    for (const a of z) for (const b of z) {
      if (rawStats(a).hp > rawStats(b).hp) expect(statBars(a).hp).toBeGreaterThan(statBars(b).hp);
      if (rawStats(a).speed > rawStats(b).speed) expect(statBars(a).speed ?? 0).toBeGreaterThan(statBars(b).speed ?? 0);
    }
    // The fastest zombie in the table has the full speed bar.
    const fastest = [...z].sort((a, b) => rawStats(b).speed - rawStats(a).speed)[0] as UnitKey;
    expect(statBars(fastest).speed).toBe(1);
  });

  it('damage is the bite or the shot, whichever is more each second; none means the role icon', () => {
    const be = BALANCE.units.brainEater;
    const want = Math.max((be?.melee?.damage ?? 0) / (be?.melee?.interval ?? 1), (be?.shot?.damage ?? 0) / (be?.shot?.interval ?? 1));
    expect(rawStats('brainEater').dps).toBeCloseTo(want);
    expect(statBars('sunflower').dps).toBeNull();
    expect(statBars('avocadoBunker').dps).toBeNull();
  });

  it('plants have roots, never a speed bar', () => {
    for (const k of ALMANAC_UNITS.plants) expect(statBars(k).speed).toBeNull();
    for (const k of ALMANAC_UNITS.zombies) expect(statBars(k).speed).not.toBeNull();
  });
});

describe('Almanac screen', () => {
  it('shows all twenty units and the Bone Minion as pictures, never letters', () => {
    mount();
    expect(all('[data-row="plants"] [data-unit]')).toHaveLength(10);
    expect(all('[data-row="zombies"] [data-unit]')).toHaveLength(11);
    expect(q('[data-unit="boneMinion"]')).not.toBeNull();
    for (const tile of all('[data-unit]')) {
      expect(tile.querySelector('.pic__silhouette, .pic__img')).not.toBeNull();
      expect(tile.textContent).toBe('');
    }
  });

  it('opens the turntable on the shared stage and closes it when left', () => {
    mount();
    expect(calls[0]).toBe('open peashooter 1');
    tap('[data-action="back"]');
    expect(screen.value.name).toBe('title');
    act(() => render(null, root));
    expect(calls.at(-1)).toBe('close');
  });

  it('tapping a unit and a pip shows that look; the bars are drawn from the table', () => {
    mount();
    tap('[data-unit="avocadoBunker"]');
    tap('[data-level="4"]');
    expect(calls).toContain('show avocadoBunker 4');
    expect(q('[data-level="4"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(Number(q('[data-bar="hp"]')?.dataset.share)).toBeCloseTo(statBars('avocadoBunker').hp, 3);
    // No bite or shot: the role picture stands in; a plant has roots, not a speed bar.
    expect(q('[data-instead="dps"]')).not.toBeNull();
    expect(q('[data-instead="speed"]')).not.toBeNull();
    tap('[data-unit="veryFastWalker"]');
    expect(q('[data-bar="speed"]')).not.toBeNull();
    expect(q('[data-bar="dps"]')).not.toBeNull();
    expect(q('[data-info]')?.className).toContain('side-zombies');
  });

  it('the Bone Minion has one look: one pip', () => {
    mount();
    tap('[data-unit="cowboyZombie"]');
    tap('[data-level="5"]');
    tap('[data-unit="boneMinion"]');
    expect(all('[data-level]')).toHaveLength(1);
    expect(calls.at(-1)).toBe('show boneMinion 1');
  });

  it('play plays the move', () => {
    mount();
    tap('[data-action="act"]');
    expect(calls).toContain('play');
  });

  it('every role has a picture, every picture is square and in the palette', () => {
    for (const art of Object.values(ALMANAC_PICTURES)) {
      expect(art.rows.length).toBe(12);
      for (const row of art.rows) {
        expect(row.length).toBe(12);
        for (const ch of row) if (ch !== '.') expect(art.palette[ch]).toBeDefined();
      }
    }
    mount();
    for (const k of [...ALMANAC_UNITS.plants, ...ALMANAC_UNITS.zombies]) {
      tap(`[data-unit="${k}"]`);
      const role = q('[data-role]')?.dataset.role ?? '';
      expect(ALMANAC_PICTURES[role], `${k}: ${role}`).toBeDefined();
    }
  });
});
