import { Mesh, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { HAZARD_FADE, Hazards } from '../../src/render/battle/Hazards';

function run(h: Hazards, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) h.update(1 / 60);
}

function shown(h: Hazards) {
  return h.group.children.filter((o) => o.visible);
}

describe('Hazards', () => {
  it('lays a puddle on its lane at its x, as wide as its radius', () => {
    const h = new Hazards();
    h.add(5, 2, 4.3, 0.75, 4);
    expect(h.active).toBe(1);
    const [puddle] = shown(h);
    expect(puddle!.position.x).toBeCloseTo(4.3);
    expect(puddle!.position.z).toBeCloseTo(2.5);
    expect(puddle!.position.y).toBeGreaterThanOrEqual(0);
    expect(puddle!.position.y).toBeLessThan(0.05);
    expect(puddle!.scale.x).toBeCloseTo(0.75);
  });

  it('fades out over its last half second, then goes', () => {
    const h = new Hazards();
    h.add(1, 0, 3, 0.75, 2);
    run(h, 1);
    expect(h.opacity(1)).toBe(1);
    run(h, 2 - 1 - HAZARD_FADE / 2);
    const mid = h.opacity(1);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    run(h, HAZARD_FADE);
    expect(h.active).toBe(0);
    expect(shown(h)).toHaveLength(0);
    expect(HAZARD_FADE).toBeCloseTo(0.5);
  });

  it('goes at once when removed (hazardEnded)', () => {
    const h = new Hazards();
    h.add(1, 0, 3, 0.75, 4);
    h.add(2, 1, 5, 0.75, 4);
    h.remove(1);
    expect(h.active).toBe(1);
    h.remove(99);
    expect(h.active).toBe(1);
  });

  it('keeps one puddle per id', () => {
    const h = new Hazards();
    h.add(1, 0, 3, 0.75, 4);
    h.add(1, 0, 3.5, 0.75, 4);
    expect(h.active).toBe(1);
    expect(shown(h)[0]!.position.x).toBeCloseTo(3.5);
  });

  it('is pooled: the group never grows, and a full pool gives up its oldest puddle', () => {
    const h = new Hazards(6);
    const size = h.group.children.length;
    for (let id = 0; id < 20; id++) h.add(id, id % 5, id % 10, 0.75, 4);
    expect(h.group.children.length).toBe(size);
    expect(h.active).toBe(6);
    expect(h.has(19)).toBe(true);
    expect(h.has(0)).toBe(false);
    h.clear();
    expect(h.active).toBe(0);
  });

  it('bubbles: the bubbles move and glow (emissive at least 1.5)', () => {
    const h = new Hazards();
    h.add(1, 0, 3, 0.75, 4);
    run(h, 0.1);
    const puddle = shown(h)[0]!;
    const bubbles = puddle.children.filter((o): o is Mesh => o instanceof Mesh && o.name === 'hazard-bubble');
    expect(bubbles.length).toBeGreaterThanOrEqual(3);
    const before = bubbles.map((b) => b.position.y);
    run(h, 0.3);
    expect(bubbles.some((b, i) => Math.abs(b.position.y - (before[i] as number)) > 0.01)).toBe(true);
    const m = bubbles[0]!.material as Material & { emissiveIntensity: number };
    expect(m.emissiveIntensity).toBeGreaterThanOrEqual(1.5);
  });
});
