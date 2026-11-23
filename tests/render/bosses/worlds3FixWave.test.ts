import type { Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { BOSS_LOOK } from '../../../src/data/bossLooks';
import { throwsFrozenMelons, throwsNeedles } from '../../../src/render/battle/BossFx';
import { NEEDLE_SIZE, PROJECTILE_SIZE, makeNeedle } from '../../../src/render/models/props';
import { allocationsIn } from '../allocations';
import { DT, bossStage, shown } from './stage';

// Desert Canyon fix wave: the Cactus King throws needles (not acorns), the rockfall's warning is
// told apart from the Desert's rock tiles (rust boulders, an orange ring that pulses), and the
// boulders and the mummy wraps are made when the fight starts, not in the middle of it.

const hex = (m: MeshBasicMaterial | MeshStandardMaterial): string => `#${m.color.getHexString().toUpperCase()}`;

describe('the Cactus King\'s needles', () => {
  it('only its barrage is a needle: the row says so, no other boss throws one, the Melon still throws melons', () => {
    expect(BOSS_LOOK.cactusKing.fx.barrage).toBe('needle');
    expect(throwsNeedles('cactusKing')).toBe(true);
    for (const other of ['elderOak', 'brainTitan', 'moonHowler', 'frostMelon', 'sandPharaoh', 'peashooter'] as const) {
      expect(throwsNeedles(other), other).toBe(false);
    }
    expect(throwsFrozenMelons('cactusKing')).toBe(false);
    expect(throwsFrozenMelons('frostMelon')).toBe(true);
  });

  it('a needle is a long thin spike, at least as long as the arrow\'s reading size, a few boxes', () => {
    const needle = makeNeedle() as Mesh;
    expect(needle.name).toBe('projectile-needle');
    needle.geometry.computeBoundingBox();
    const box = needle.geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(NEEDLE_SIZE, 2);
    expect(NEEDLE_SIZE).toBeGreaterThan(PROJECTILE_SIZE.acorn);
    expect(box.max.y - box.min.y).toBeLessThan(0.15);
    expect(box.max.z - box.min.z).toBeLessThan(0.15);
  });

  it('its barrage flies needles, no acorns, pointing at the zombies, each with a landing mark; they are pooled', () => {
    const s = bossStage('cactusKing');
    const needles = (): Set<Object3D> => {
      const out = new Set<Object3D>();
      s.scene.traverse((o) => { if (o.name === 'projectile-needle') out.add(o); });
      return out;
    };
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    s.play(0.4);
    const flying = s.match.state.projectiles.filter((p) => p.kind === 'acorn').length;
    expect(flying).toBeGreaterThan(0);
    expect(shown(s.scene, 'projectile-needle')).toBe(flying);
    expect(shown(s.scene, 'projectile-acorn')).toBe(0);
    expect(shown(s.scene, 'boss-acorn-mark')).toBe(flying);
    s.scene.traverse((o) => { if (o.name === 'projectile-needle') expect(o.rotation.y).toBeCloseTo(Math.PI, 5); });
    const first = needles();
    s.play(6);
    expect(shown(s.scene, 'projectile-needle')).toBe(0);
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    s.play(0.4);
    for (const o of needles()) expect(first.has(o)).toBe(true);
  });

  it('the Oak still throws acorns (its barrage is as it was)', () => {
    const s = bossStage('elderOak');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    s.play(0.4);
    expect(shown(s.scene, 'projectile-acorn')).toBeGreaterThan(0);
    expect(shown(s.scene, 'projectile-needle')).toBe(0);
  });
});

describe('the boulder warning is not a rock tile', () => {
  it('the boulder is rust red and orange, none of the rock tiles\' greys, and a ring on its tile is hot orange', () => {
    const s = bossStage('cactusKing');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.1);
    let boulder: Mesh | null = null;
    let ring: Mesh | null = null;
    s.scene.traverse((o) => {
      if (o.name === 'boss-boulder' && o.visible) boulder = o as Mesh;
      if (o.name === 'boss-boulder-ring' && o.visible) ring = o as Mesh;
    });
    expect(ring).not.toBeNull();
    expect(hex((ring as unknown as Mesh).material as MeshBasicMaterial)).toBe('#FF8A1F');
    // The boulder's vertex colours: warm, red above green above blue, never grey (a rock tile's is A39E96, 7F7A73, BDB8AF).
    const colors = (boulder as unknown as Mesh).geometry.getAttribute('color');
    expect(colors.count).toBeGreaterThan(0);
    for (let i = 0; i < colors.count; i++) {
      const r = colors.getX(i);
      const g = colors.getY(i);
      const b = colors.getZ(i);
      expect(r - b, `vertex ${i} is warm, not grey`).toBeGreaterThan(0.2);
    }
  });

  it('a ring shows on each warned tile with its boulder, pulses in two steps, and goes with the blow', () => {
    const s = bossStage('cactusKing');
    const said = s.until((e) => e.type === 'bossStrike' && e.windup) as { tiles: { lane: number; col: number }[] } | null;
    s.play(0.1);
    expect(shown(s.scene, 'boss-boulder-ring')).toBe(3);
    const at: string[] = [];
    s.scene.traverse((o) => { if (o.name === 'boss-boulder-ring' && o.visible) at.push(`${o.position.x},${o.position.z}`); });
    expect(at.sort()).toEqual(said!.tiles.map((t) => `${t.col + 0.5},${t.lane + 0.5}`).sort());
    const sizes = new Set<number>();
    for (let i = 0; i < 40; i++) {
      s.play(0.05);
      s.scene.traverse((o) => { if (o.name === 'boss-boulder-ring' && o.visible) sizes.add(Math.round(o.scale.x * 100)); });
    }
    expect(sizes.size).toBe(2);
    s.until((e) => e.type === 'bossStrike' && !e.windup);
    s.play(0.1);
    expect(shown(s.scene, 'boss-boulder-ring')).toBe(0);
  });

  it('the Pharaoh\'s warning (sandstorm) is a dither in cream, which has no boulder and no ring', () => {
    const s = bossStage('sandPharaoh');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.1);
    expect(shown(s.scene, 'boss-boulder')).toBe(0);
    expect(shown(s.scene, 'boss-boulder-ring')).toBe(0);
  });
});

describe('nothing is made in the middle of the fight', () => {
  function boulderNames(scene: Object3D): number {
    let n = 0;
    scene.traverse((o) => { if (o.name === 'boss-boulder' || o.name === 'boss-boulder-ring') n++; });
    return n;
  }

  it('the Cactus King\'s boulders and rings exist once it has come on, before the first warning', () => {
    const s = bossStage('cactusKing');
    s.play(0.5);
    expect(boulderNames(s.scene)).toBeGreaterThanOrEqual(6);
    expect(shown(s.scene, 'boss-boulder')).toBe(0);
    const before = boulderNames(s.scene);
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.1);
    expect(boulderNames(s.scene)).toBe(before);
  });

  it('the Pharaoh\'s mummy wraps are made when it comes on: its summon dresses units from the pool, making no new geometry or slot', () => {
    const s = bossStage('sandPharaoh');
    s.play(0.5);
    const fx = s.view.bossFx as unknown as { wrapGeometry: unknown; dressed: { owner: unknown }[] };
    expect(fx.wrapGeometry).not.toBeNull();
    const slots = [...fx.dressed];
    const geometry = fx.wrapGeometry;
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((d) => d.owner === null)).toBe(true);
    s.until((e) => e.type === 'bossPhase');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'summon');
    s.play(0.1);
    expect(fx.wrapGeometry).toBe(geometry);
    expect(fx.dressed).toEqual(slots);
    expect(fx.dressed.some((d) => d.owner !== null)).toBe(true);
  });

  it('the Pharaoh\'s dither geometries are made when it comes on, not at its first sandstorm', () => {
    const s = bossStage('sandPharaoh');
    s.play(0.5);
    const fx = s.view.bossFx as unknown as { ditherA: unknown; ditherB: unknown };
    expect(fx.ditherA).not.toBeNull();
    expect(fx.ditherB).not.toBeNull();
    const a = fx.ditherA;
    s.until((e) => e.type === 'bossStrike' && e.windup);
    expect(fx.ditherA).toBe(a);
  });

  it('each boss draws its pieces at no size for a few frames as it comes on (to upload them), then they go', () => {
    for (const key of ['sandPharaoh', 'cactusKing'] as const) {
      const s = bossStage(key);
      s.play(1 / 30); // one step, two frames: it has come on, one warm frame is left
      const warm: Mesh[] = [];
      s.scene.traverse((o) => { if (o.name === 'boss-warm') warm.push(o as Mesh); });
      expect(warm.length, key).toBeGreaterThan(3);
      for (const m of warm) expect(m.scale.x, key).toBe(0);
      s.view.bossFx.update(DT);
      let left = 0;
      s.scene.traverse((o) => { if (o.name === 'boss-warm') left++; });
      expect(left, key).toBe(0);
    }
  });

  it('a boulder fight draws without allocating', () => {
    const s = bossStage('cactusKing');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.2);
    expect(allocationsIn(() => {
      for (let i = 0; i < 20; i++) s.view.bossFx.update(DT);
    })).toEqual({});
  });
});
