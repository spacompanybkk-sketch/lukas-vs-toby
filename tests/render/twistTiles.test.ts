import { Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { Lawn } from '../../src/render/world/Lawn';
import { SAMPLE_LAWNS, TwistTiles, coveredTile } from '../../src/render/world/TwistTiles';
import { NO_TWIST } from '../../src/sim/lawn';
import { allocationsIn } from './allocations';
import { BLOOM_THRESHOLD } from '../../src/render/look';
import { COLS, PLANT_COLS } from '../../src/sim/types';

const named = (tiles: TwistTiles, name: string): Mesh[] => {
  const found: Mesh[] = [];
  tiles.group.traverse((o) => {
    if (o instanceof Mesh && o.name === name) found.push(o);
  });
  return found;
};

describe('TwistTiles', () => {
  it('draws nothing for a lawn with no twist', () => {
    const tiles = new TwistTiles(NO_TWIST);
    expect(tiles.group.children).toHaveLength(0);
    tiles.dispose();
  });

  it('lays one low sheet of light, blocky mist over a foggy lawn (one draw call), under the placement marks and the health bars', () => {
    const tiles = new TwistTiles(SAMPLE_LAWNS.meadow);
    const sheets = named(tiles, 'mist');
    expect(sheets).toHaveLength(1);
    const shader = (sheets[0]!.material as ShaderMaterial);
    expect(shader.uniforms.uOpacity!.value).toBeLessThanOrEqual(0.25);
    // A hard, dithered edge: no smoothstep anywhere in the mist.
    expect(shader.fragmentShader).not.toContain('smoothstep');
    expect(shader.fragmentShader).toContain('bayer4');
    for (const sheet of sheets) {
      expect(sheet.position.y).toBeLessThan(0.6);
      expect(sheet.renderOrder).toBeLessThan(2);
      expect((sheet.material as ShaderMaterial).depthWrite).toBe(false);
    }
    tiles.dispose();
  });

  it('puts a boulder on every rock tile, inside its tile and low enough to see a zombie walk through', () => {
    const tiles = new TwistTiles(SAMPLE_LAWNS.desert);
    const [boulders] = named(tiles, 'boulders');
    expect(boulders).toBeDefined();
    const position = (boulders as Mesh).geometry.getAttribute('position');
    const tilesHit = new Set<number>();
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      expect(position.getY(i)).toBeLessThanOrEqual(0.36);
      tilesHit.add(Math.floor(z) * PLANT_COLS + Math.floor(x));
    }
    expect([...tilesHit].sort((a, b) => a - b)).toEqual([...SAMPLE_LAWNS.desert.rocks].sort((a, b) => a - b));
    tiles.dispose();
  });

  it('covers each icy lane end to end, under the placement marks', () => {
    const tiles = new TwistTiles(SAMPLE_LAWNS.tundra);
    const [ice] = named(tiles, 'ice');
    const position = (ice as Mesh).geometry.getAttribute('position');
    const lanes = new Set<number>();
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < position.count; i++) {
      lanes.add(Math.floor(position.getZ(i) - 1e-6 + 0.0001));
      minX = Math.min(minX, position.getX(i));
      maxX = Math.max(maxX, position.getX(i));
      expect(position.getY(i)).toBeLessThan(0.012);
    }
    expect([...lanes].sort()).toEqual([1, 3]);
    expect(minX).toBeLessThanOrEqual(0.05);
    expect(maxX).toBeGreaterThanOrEqual(9.95);
    tiles.dispose();
  });

  it('makes each lava tile glow past the bloom threshold, in a basalt crust', () => {
    const tiles = new TwistTiles(SAMPLE_LAWNS.citadel);
    const [lava] = named(tiles, 'lava');
    const [crust] = named(tiles, 'lava-crust');
    expect(crust).toBeDefined();
    const hot = ((lava as Mesh).material as ShaderMaterial).uniforms.uHot?.value as { r: number; g: number; b: number };
    expect(0.2126 * hot.r + 0.7152 * hot.g + 0.0722 * hot.b).toBeGreaterThan(BLOOM_THRESHOLD);
    // One quad per tile, inside that tile.
    const position = (lava as Mesh).geometry.getAttribute('position');
    expect(position.count).toBe(4 * SAMPLE_LAWNS.citadel.lava!.tiles.length);
    for (let i = 0; i < position.count; i += 4) {
      const index = Math.floor(position.getZ(i)) * COLS + Math.floor(position.getX(i));
      expect(SAMPLE_LAWNS.citadel.lava!.tiles).toContain(index);
    }
    tiles.dispose();
  });

  it('moves on without allocating', () => {
    const tiles = new TwistTiles({ ...SAMPLE_LAWNS.meadow, ...SAMPLE_LAWNS.citadel, fog: 5 });
    expect(allocationsIn(() => {
      for (let i = 0; i < 60; i++) tiles.update(i / 60);
    })).toEqual({});
    tiles.dispose();
  });

  it('grows no grass on a tile under ice or lava', () => {
    const covered = coveredTile(SAMPLE_LAWNS.tundra);
    expect(covered(4, 1)).toBe(true);
    expect(covered(4, 2)).toBe(false);
    const bare = new Lawn('tundra');
    const iced = new Lawn('tundra', SAMPLE_LAWNS.tundra);
    const count = (lawn: Lawn): number => (lawn.group.getObjectByName('grass') as unknown as { count: number }).count;
    expect(count(iced)).toBeLessThan(count(bare));
    bare.dispose();
    iced.dispose();
  });
});
