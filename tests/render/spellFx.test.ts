import { Group, Mesh, Object3D, PerspectiveCamera, type BufferGeometry, type Material } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SPELL_SECONDS, SPELL_SIDE, SpellFx, spellArea } from '../../src/render/battle/SpellFx';
import type { Feel } from '../../src/render/battle/types';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import type { SpellKey } from '../../src/render/types';
import { seededRandom } from '../../src/render/world/boxes';
import { allocationsIn } from './allocations';

const SPELLS: [SpellKey, 0 | 2 | 3][] = [
  ['thunderbolt', 2],
  ['vines', 2],
  ['sunShower', 0],
  ['healingRain', 3],
  ['rockWall', 0],
  ['meteor', 2],
  ['fog', 2],
  ['brainFeast', 0],
  ['frenzy', 3],
  ['graveRise', 0],
];

const camera = new PerspectiveCamera();

function setup(feel: Feel[] = []) {
  const particles = new Particles(1500);
  const effects = new Effects(particles, seededRandom(9));
  const spells = new SpellFx(effects, particles, { onFeel: (f) => feel.push(f) });
  return { particles, effects, spells };
}

function run(spells: SpellFx, effects: Effects, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    spells.update(1 / 60);
    effects.update(1 / 60, camera);
  }
}

function visibleDeep(root: Object3D): Object3D[] {
  const out: Object3D[] = [];
  const walk = (o: Object3D): void => {
    for (const c of o.children) {
      if (!c.visible) continue;
      out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

const key = (t: { lane: number; col: number }): string => `${t.lane},${t.col}`;

describe('spellArea', () => {
  it('covers the tapped tile, the next column towards the enemy and the next lane down for a 2 × 2', () => {
    expect(spellArea('thunderbolt', 1, 3, 2).map(key).sort()).toEqual(['1,3', '1,4', '2,3', '2,4']);
    // Zombies' enemy is to the left.
    expect(spellArea('meteor', 1, 5, 2).map(key).sort()).toEqual(['1,4', '1,5', '2,4', '2,5']);
  });

  it('is clamped to the lawn so a 2 × 2 is always four tiles', () => {
    expect(spellArea('vines', 4, 9, 2).map(key).sort()).toEqual(['3,8', '3,9', '4,8', '4,9']);
    expect(spellArea('fog', 4, 0, 2).map(key).sort()).toEqual(['3,0', '3,1', '4,0', '4,1']);
  });

  it('centres a 3 × 3 on the tapped tile and clips it at the edges', () => {
    expect(spellArea('healingRain', 2, 5, 3)).toHaveLength(9);
    expect(spellArea('frenzy', 0, 0, 3).map(key).sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('is the tapped tile alone for an aimed spell of size 0, and nothing for an un-aimed one', () => {
    expect(spellArea('rockWall', 2, 3, 0).map(key)).toEqual(['2,3']);
    expect(spellArea('graveRise', 1, 6, 0).map(key)).toEqual(['1,6']);
    expect(spellArea('sunShower', 2, 3, 0)).toEqual([]);
    expect(spellArea('brainFeast', 2, 3, 0)).toEqual([]);
  });

  it('knows whose each spell is', () => {
    expect(SPELL_SIDE.thunderbolt).toBe('plants');
    expect(SPELL_SIDE.graveRise).toBe('zombies');
  });
});

describe('SpellFx', () => {
  for (const [spell, size] of SPELLS) {
    it(`${spell}: shows something at once and puts it all away when it is over`, () => {
      const { spells, effects, particles } = setup();
      const before = spells.group.children.length;
      spells.cast(spell, 2, 4, size);
      run(spells, effects, 0.35);
      const shown = visibleDeep(spells.group).length + particles.alive;
      expect(shown, spell).toBeGreaterThan(0);
      run(spells, effects, SPELL_SECONDS[spell] + 1.5);
      expect(spells.active, spell).toBe(0);
      if (spell === 'rockWall') {
        // The rock stays until it is crumbled (the rock unit dies).
        expect(spells.rocks).toBe(1);
        spells.crumbleRock(2, 4);
        expect(spells.rocks).toBe(0);
      }
      expect(visibleDeep(spells.group), spell).toHaveLength(0);
      expect(spells.group.children.length, `${spell} is pooled`).toBe(before);
    });
  }

  it('puts the effect over its area: the vines stand on the four tiles', () => {
    const { spells, effects } = setup();
    spells.cast('vines', 1, 3, 2);
    run(spells, effects, 0.6);
    const vines = visibleDeep(spells.group).filter((o) => o.name === 'vine');
    expect(vines.length).toBeGreaterThanOrEqual(8);
    for (const v of vines) {
      expect(v.position.x).toBeGreaterThanOrEqual(3);
      expect(v.position.x).toBeLessThanOrEqual(5);
      expect(v.position.z).toBeGreaterThanOrEqual(1);
      expect(v.position.z).toBeLessThanOrEqual(3);
    }
  });

  it('keeps vines and fog up for as long as the tie and the blindness last', () => {
    const { spells, effects } = setup();
    spells.cast('vines', 1, 3, 2);
    spells.cast('fog', 3, 6, 2);
    run(spells, effects, 3.5);
    const names = visibleDeep(spells.group).map((o) => o.name);
    expect(names).toContain('vine');
    expect(names).toContain('fog-block');
    expect(SPELL_SECONDS.vines).toBeCloseTo(4);
    expect(SPELL_SECONDS.fog).toBeCloseTo(5);
  });

  it('shakes the screen for the thunderbolt and the meteor', () => {
    for (const spell of ['thunderbolt', 'meteor'] as const) {
      const feel: Feel[] = [];
      const { spells, effects } = setup(feel);
      spells.cast(spell, 2, 4, 2);
      run(spells, effects, 1);
      expect(feel.some((f) => (f.shake ?? 0) > 0), spell).toBe(true);
    }
  });

  it('lights the Thunderbolt and the meteor brightly enough to bloom', () => {
    const { spells, effects } = setup();
    spells.cast('thunderbolt', 2, 4, 2);
    spells.cast('meteor', 0, 7, 2);
    let glow = 0;
    for (let t = 0; t < 0.6; t += 1 / 60) {
      run(spells, effects, 1 / 60);
      for (const o of visibleDeep(spells.group)) {
        if (!(o instanceof Mesh)) continue;
        const m = o.material as Material & { emissiveIntensity?: number; emissive?: { getHex(): number } };
        if (m.emissive && m.emissive.getHex() !== 0) glow = Math.max(glow, m.emissiveIntensity ?? 0);
      }
    }
    expect(glow).toBeGreaterThanOrEqual(1.5);
  });

  it('shows the rock crack as it is chewed, and crumbles it', () => {
    const { spells, effects, particles } = setup();
    spells.cast('rockWall', 3, 2, 0);
    run(spells, effects, 0.5);
    const rock = visibleDeep(spells.group).find((o) => o.name === 'spell-rock') as Mesh;
    expect(rock).toBeDefined();
    expect(rock.position.x).toBeCloseTo(2.5);
    expect(rock.position.z).toBeCloseTo(3.5);
    const whole = rock.geometry;
    spells.setRock(3, 2, 0.5);
    expect(rock.geometry).not.toBe(whole);
    const cracked = rock.geometry;
    spells.setRock(3, 2, 0.2);
    expect(rock.geometry).not.toBe(cracked);
    spells.crumbleRock(3, 2);
    expect(rock.visible).toBe(false);
    expect(particles.alive).toBeGreaterThan(5);
    // Telling it about a rock it does not have is harmless.
    spells.setRock(0, 0, 0.5);
    spells.crumbleRock(0, 0);
  });

  it('highlights the aimed area and clears it', () => {
    const { spells } = setup();
    spells.showArea(spellArea('healingRain', 2, 5, 3), 'plants');
    expect(visibleDeep(spells.group).filter((o) => o.name === 'spell-area')).toHaveLength(9);
    spells.showArea(spellArea('meteor', 2, 5, 2), 'zombies');
    expect(visibleDeep(spells.group).filter((o) => o.name === 'spell-area')).toHaveLength(4);
    spells.showArea(null);
    expect(visibleDeep(spells.group).filter((o) => o.name === 'spell-area')).toHaveLength(0);
  });

  it('copes with the same spell cast over and over: pools hand out what they have', () => {
    const { spells, effects } = setup();
    const before = spells.group.children.length;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 12; i++) for (const [spell, size] of SPELLS) spells.cast(spell, i % 5, i % 10, size);
    // Twelve of each at once is more than the pools hold: they say so instead of skipping quietly.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    run(spells, effects, 0.5);
    expect(spells.group.children.length).toBe(before);
    spells.clear();
    expect(spells.active).toBe(0);
    expect(spells.rocks).toBe(0);
    expect(visibleDeep(spells.group)).toHaveLength(0);
  });

  it('has room for every spell at its largest area, twice over, without running dry', () => {
    const { spells, effects } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Every aimed spell at a 3 × 3 (the 2 × 2 ones too, as a tuner might make them), twice.
    for (let i = 0; i < 2; i++) for (const [spell, size] of SPELLS) spells.cast(spell, 2, 4 + i, size === 0 ? 0 : 3);
    run(spells, effects, 1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('allocates nothing observable in update while the standing spells run', () => {
    const { spells, effects } = setup();
    for (const [spell, size] of SPELLS) spells.cast(spell, 2, 4, size);
    // Past every spell's start, so only the frame-by-frame work is left.
    run(spells, effects, 0.8);
    expect(allocationsIn(() => {
      for (let i = 0; i < 60; i++) spells.update(1 / 60);
    })).toEqual({});
  });

  it('stops running shows, frees what it owns and leaves the scene on dispose', () => {
    const { spells, effects } = setup();
    const scene = new Group();
    scene.add(spells.group);
    spells.cast('fog', 2, 4, 2);
    spells.cast('thunderbolt', 0, 2, 2);
    spells.cast('rockWall', 3, 3, 0);
    spells.showArea(spellArea('fog', 2, 4, 2));
    run(spells, effects, 0.3);
    const owned = new Set<BufferGeometry | Material>();
    spells.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      if (o.name === 'scorch' || o.name === 'vine-mat' || o.name === 'spell-area') {
        owned.add(o.geometry);
        owned.add(o.material as Material);
      }
    });
    expect(owned.size).toBeGreaterThanOrEqual(4);
    const freed = [...owned].map((r) => vi.spyOn(r, 'dispose'));
    spells.dispose();
    for (const spy of freed) expect(spy).toHaveBeenCalled();
    expect(spells.active).toBe(0);
    expect(spells.rocks).toBe(0);
    expect(scene.children).not.toContain(spells.group);
  });
});
