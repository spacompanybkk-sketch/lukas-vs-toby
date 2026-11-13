// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { session } from '../../src/app/session';
import { go, screen } from '../../src/app/store';
import { actionSound } from '../../src/audio/bindings';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import { setUiSound } from '../../src/ui/uiSound';
import { MemoryStorage } from '../progress/memoryStorage';
import { BALANCE } from '../../src/data/balance';
import { factionOf } from '../../src/data/units';
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

  it('each bar is a share of the biggest on its own side at the top level and full upgrade', () => {
    for (const side of ['plants', 'zombies'] as const) {
      for (const k of ALMANAC_UNITS[side]) {
        for (const [level, up] of [[1, 0], [3, 4], [5, 10]] as const) {
          const b = statBars(k, level, up);
          expect(b.hp).toBeGreaterThan(0);
          expect(b.hp).toBeLessThanOrEqual(1);
          if (b.dps !== null) expect(b.dps).toBeLessThanOrEqual(1);
        }
      }
      expect(Math.max(...ALMANAC_UNITS[side].map((k) => statBars(k, 5, 10).hp))).toBe(1);
      expect(Math.max(...ALMANAC_UNITS[side].map((k) => statBars(k, 5, 10).dps ?? 0))).toBe(1);
    }
  });

  it('a higher level makes the health and damage bars longer, never the speed bar', () => {
    for (const k of ['peashooter', 'avocadoBunker', 'brainEater', 'cowboyZombie'] as const) {
      for (let l = 1; l < 5; l++) {
        const a = statBars(k, l);
        const b = statBars(k, l + 1);
        expect(b.hp, `${k} ${l}`).toBeGreaterThan(a.hp);
        if (a.dps !== null) expect(b.dps ?? 0).toBeGreaterThan(a.dps);
        expect(b.speed).toBe(a.speed);
      }
    }
  });

  it('an upgrade makes them longer as far as the shipped step adds; the plain part stays what it was without it', () => {
    for (const k of ['peashooter', 'brainEater'] as const) {
      const step = BALANCE.upgradeStep[factionOf(k)];
      const plain = statBars(k, 2, 0);
      const up = statBars(k, 2, 6);
      // Square-root bars: the share grows by sqrt(1 + 6 × step).
      expect(up.hp).toBeCloseTo(Math.min(1, plain.hp * Math.sqrt(1 + 6 * step.hp)), 10);
      expect(up.dps ?? 0).toBeCloseTo(Math.min(1, (plain.dps ?? 0) * Math.sqrt(1 + 6 * step.damage)), 10);
      expect(up.dps ?? 0).toBeGreaterThan(plain.dps ?? 0);
      expect(up.hpPlain).toBeCloseTo(plain.hp, 10);
      expect(up.dpsPlain ?? 0).toBeCloseTo(plain.dps ?? 0, 10);
      expect(up.speed).toBe(plain.speed);
      expect(plain.hpPlain).toBe(plain.hp);
    }
  });

  it('the Bone Minion takes no upgrade', () => {
    expect(statBars('boneMinion', 1, 10)).toEqual(statBars('boneMinion', 1, 0));
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
    expect(Number(q('[data-bar="hp"]')?.dataset.share)).toBeCloseTo(statBars('avocadoBunker', 4).hp, 3);
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

  it('play plays the move, with the sound of its shot', () => {
    const heard: string[] = [];
    setUiSound((n) => heard.push(n));
    mount();
    tap('[data-action="act"]');
    expect(calls).toContain('play');
    // The fake turntable plays the shot: the Peashooter's pea.
    expect(heard.at(-1)).toBe(actionSound('peashooter', 'shoot'));
    expect(heard.at(-1)).toBe('pea');
    setUiSound(null);
  });

  it('a higher pip makes the health bar longer', () => {
    mount();
    tap('[data-unit="brainEater"]');
    const at = (n: number): number => {
      tap(`[data-level="${n}"]`);
      return Number(q('[data-bar="hp"]')?.dataset.share);
    };
    const one = at(1);
    const five = at(5);
    expect(five).toBeGreaterThan(one);
  });

  describe('with a player logged in', () => {
    beforeEach(async () => {
      const db = new FakeDatabase({ now: () => 1_762_900_000_000 });
      session.configure({ cloud: createFakeCloud(db), storage: new MemoryStorage(), now: () => 1_762_900_000_000, window: null, document: null });
      const made = await session.create('Mia', 'sunflower', '123');
      if (typeof made === 'string') throw new Error(made);
    });
    afterEach(() => session.dispose());

    it("the bars grow with the player's upgrade of that unit as the shipped step says, the gain in gold", () => {
      mount();
      tap('[data-unit="brainEater"]');
      const plain = Number(q('[data-bar="dps"]')?.dataset.share);
      expect(q('[data-bar-up="dps"]')).toBeNull();
      act(() => session.update((save) => ({ ...save, upgrades: { brainEater: 10 } })));
      const up = Number(q('[data-bar="dps"]')?.dataset.share);
      expect(up).toBeGreaterThan(plain);
      expect(up).toBeCloseTo(statBars('brainEater', 1, 10).dps ?? 0, 3);
      expect(Number(q('[data-bar="hp"]')?.dataset.share)).toBeCloseTo(statBars('brainEater', 1, 10).hp, 3);
      expect(q('[data-bar-up="dps"]')).not.toBeNull();
      // Health gains only what the shipped step gives it (none at a step of 0).
      expect(q('[data-bar-up="hp"]')).toBeNull(); // zombies: damage only
      // Another unit's upgrade does not touch this one.
      tap('[data-unit="cowboyZombie"]');
      expect(q('[data-bar-up="dps"]')).toBeNull();
    });

    it("a plant's heart bar grows a little with its upgrade (the plants' step has some health)", () => {
      mount();
      tap('[data-unit="peashooter"]');
      const plain = Number(q('[data-bar="hp"]')?.dataset.share);
      act(() => session.update((save) => ({ ...save, upgrades: { peashooter: 10 } })));
      const up = Number(q('[data-bar="hp"]')?.dataset.share);
      expect(up).toBeGreaterThan(plain);
      expect(up).toBeCloseTo(statBars('peashooter', 1, 10).hp, 3);
      expect(q('[data-bar-up="hp"]')).not.toBeNull();
      expect(q('[data-bar-up="dps"]')).not.toBeNull();
    });

    it('the gold part is at least 4 px, taken out of the plain part, so the bar keeps its true length', () => {
      mount();
      tap('[data-unit="peashooter"]');
      expect(q('[data-bar-up="hp"]')).toBeNull(); // no gain, no gold
      act(() => session.update((save) => ({ ...save, upgrades: { peashooter: 1 } })));
      const bars = statBars('peashooter', 1, 1);
      const gain = bars.hp - bars.hpPlain;
      expect(gain).toBeGreaterThan(0);
      expect(q('[data-bar-up="hp"]')).not.toBeNull();
      const track = q('[data-stat="hp"] .almanac__track') as HTMLElement;
      expect(track.className).toContain('has-gain');
      expect(track.style.getPropertyValue('--share')).toBe(`${bars.hp * 100}%`);
      expect(track.style.getPropertyValue('--gain')).toBe(`${gain * 100}%`);
      // A zombie gains no health: no gold, no minimum taken.
      tap('[data-unit="brainEater"]');
      expect((q('[data-stat="hp"] .almanac__track') as HTMLElement).className).not.toContain('has-gain');
    });
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
