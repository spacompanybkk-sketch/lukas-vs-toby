import { Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { Lawn } from '../../src/render/world/Lawn';
import { NO_TWIST, SAMPLE_LAWNS, TwistTiles, coveredTile } from '../../src/render/world/TwistTiles';
import { allocationsIn } from './allocations';
import { PLANT_COLS } from '../../src/sim/types';

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

  it('lays a few low sheets of mist over a foggy lawn, under the placement marks and the health bars', () => {
    const tiles = new TwistTiles(SAMPLE_LAWNS.meadow);
    const sheets = named(tiles, 'mist');
    expect(sheets.length).toBeGreaterThan(0);
    expect(sheets.length).toBeLessThanOrEqual(4);
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
