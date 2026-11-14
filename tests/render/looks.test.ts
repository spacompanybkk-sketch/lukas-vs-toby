import { BufferGeometry, Color, Material, Mesh, Texture, type Object3D } from 'three';
import { BLOOM_THRESHOLD } from '../../src/render/look';
import { describe, expect, it } from 'vitest';
import { battleWorld } from '../../src/app/BattleSession';
import { dressWorld } from '../../src/app/Stage';
import { levelById } from '../../src/adventure/levels';
import { WORLD_ORDER, type WorldKey } from '../../src/data/worlds';
import { Lawn } from '../../src/render/world/Lawn';
import { LOOKS } from '../../src/render/world/looks';
import { MOON_GLOW, Sky } from '../../src/render/world/Sky';
import { SAMPLE_LAWNS } from '../../src/render/world/TwistTiles';
import { NO_TWIST } from '../../src/sim/lawn';
import type { LawnConfig } from '../../src/sim/types';
import { levelOptions, prepareLevel } from '../../src/app/levelSession';
import { newSave } from '../../src/progress/save';

/** Every geometry, material and texture an object tree holds (textures through materials and uniforms). */
function resources(root: Object3D): { geometries: Set<BufferGeometry>; materials: Set<Material>; textures: Set<Texture> } {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (!(object instanceof Mesh) && !('isPoints' in object)) return;
    const holder = object as unknown as { geometry: BufferGeometry; material: Material | Material[] };
    geometries.add(holder.geometry);
    for (const material of Array.isArray(holder.material) ? holder.material : [holder.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      const uniforms = (material as { uniforms?: Record<string, { value: unknown }> }).uniforms;
      for (const u of Object.values(uniforms ?? {})) if (u.value instanceof Texture) textures.add(u.value);
    }
  });
  return { geometries, materials, textures };
}

/** Marks each resource as freed when it sends its `dispose` event. */
function watchDisposal(r: ReturnType<typeof resources>): Set<object> {
  const freed = new Set<object>();
  for (const set of [r.geometries, r.materials, r.textures]) {
    for (const item of set) (item as BufferGeometry).addEventListener('dispose', () => freed.add(item));
  }
  return freed;
}

const counts = (lawn: Lawn): [number, number, number] => {
  const r = resources(lawn.group);
  return [r.geometries.size, r.materials.size, r.textures.size];
};

describe('world looks', () => {
  it('has a look for every world', () => {
    for (const key of WORLD_ORDER) expect(LOOKS[key].key).toBe(key);
  });

  it.each(WORLD_ORDER)('builds the %s, bare and with its sample twist', (key) => {
    for (const twist of [NO_TWIST, SAMPLE_LAWNS[key]]) {
      const lawn = new Lawn(key, twist);
      expect(lawn.world).toBe(key);
      expect(lawn.group.getObjectByName('island')).toBeInstanceOf(Mesh);
      expect(lawn.group.getObjectByName('grass')).toBeDefined();
      lawn.dispose();
    }
  });

  it('frees everything a dressing made when another world replaces it, and grows nothing', () => {
    const lawn = new Lawn();
    const backyard = counts(lawn);
    const seen: [WorldKey, LawnConfig][] = [];
    for (const key of WORLD_ORDER) seen.push([key, SAMPLE_LAWNS[key]]);
    for (const [key, twist] of seen) {
      const before = resources(lawn.group);
      const freed = watchDisposal(before);
      const first = (lawn.setWorld(key, twist), counts(lawn));
      const after = resources(lawn.group);
      // Whatever the old dressing held and the new one does not is freed.
      for (const set of [before.geometries, before.materials, before.textures]) {
        for (const item of set) {
          const kept = after.geometries.has(item as BufferGeometry) || after.materials.has(item as Material) || after.textures.has(item as Texture);
          if (!kept) expect(freed.has(item), `${key}: a ${item.constructor.name} was not disposed`).toBe(true);
        }
      }
      // Leaving and coming back builds exactly as much again.
      lawn.setWorld('backyard', NO_TWIST);
      expect(counts(lawn)).toEqual(backyard);
      lawn.setWorld(key, twist);
      expect(counts(lawn)).toEqual(first);
    }
    lawn.dispose();
  });

  it('does nothing when asked for the world it already shows', () => {
    const lawn = new Lawn('desert', SAMPLE_LAWNS.desert);
    const island = lawn.group.getObjectByName('island');
    expect(lawn.setWorld('desert', { ...SAMPLE_LAWNS.desert, rocks: [...SAMPLE_LAWNS.desert.rocks] })).toBe(false);
    expect(lawn.group.getObjectByName('island')).toBe(island);
    lawn.dispose();
  });

  it('dresses the sky and the lights with the lawn', () => {
    const lawn = new Lawn();
    const sky = new Sky();
    const looks: string[] = [];
    const renderer = { setLook: (look: { backdrop: string }) => void looks.push(look.backdrop) };
    dressWorld({ lawn, sky, renderer }, 'citadel', NO_TWIST);
    expect(lawn.world).toBe('citadel');
    expect(looks).toEqual([LOOKS.citadel.backdrop]);
    dressWorld({ lawn, sky, renderer }, 'citadel', NO_TWIST);
    expect(looks).toHaveLength(1);
    lawn.dispose();
    sky.dispose();
  });
});

describe('Meadow glow', () => {
  it('keeps the Backyard bloom as it was and gives the Meadow a tighter, weaker one', () => {
    expect(LOOKS.backyard.grade.bloom).toEqual({ intensity: 0.9, radius: 0.7 });
    expect(LOOKS.meadow.grade.bloom.radius).toBeLessThan(LOOKS.backyard.grade.bloom.radius * 0.6);
    expect(LOOKS.meadow.grade.bloom.intensity).toBeLessThan(LOOKS.backyard.grade.bloom.intensity);
  });

  it('lights the moon only a little past the bloom threshold, its craters under it', () => {
    const lit = new Color('#FFF6D8');
    const crater = new Color('#D9D2BC');
    const lum = (c: Color): number => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * MOON_GLOW;
    expect(lum(lit)).toBeGreaterThan(BLOOM_THRESHOLD);
    expect(lum(lit)).toBeLessThan(BLOOM_THRESHOLD * 1.15);
    expect(lum(crater)).toBeLessThan(BLOOM_THRESHOLD);
  });
});

describe('Citadel rim', () => {
  it('has no lava pools on the rim: the glow lying on the ground is only hair-thin seams in cooled crust', () => {
    const { solid, glow } = LOOKS.citadel.props();
    const position = glow.getAttribute('position');
    const normal = glow.getAttribute('normal');
    let groundGlow = 0;
    for (let q = 0; q < position.count; q += 4) {
      if (normal.getY(q) < 0.99 || position.getY(q) > 0.12) continue; // up faces near the ground only
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = q; i < q + 4; i++) {
        minX = Math.min(minX, position.getX(i)); maxX = Math.max(maxX, position.getX(i));
        minZ = Math.min(minZ, position.getZ(i)); maxZ = Math.max(maxZ, position.getZ(i));
      }
      expect(Math.min(maxX - minX, maxZ - minZ)).toBeLessThan(0.03); // a seam, never a pool
      groundGlow += (maxX - minX) * (maxZ - minZ);
    }
    expect(groundGlow).toBeGreaterThan(0);
    expect(groundGlow).toBeLessThan(0.15);
    solid.dispose();
    glow.dispose();
  });
});

describe('battleWorld', () => {
  it('puts a battle that is no level in the Backyard with no twist', () => {
    expect(battleWorld({ playerFaction: 'plants', skill: 'easy', seed: 1 })).toEqual({ world: 'backyard', lawn: NO_TWIST, theme: 'backyard' });
  });

  it("plays a level in its side's arena: plant world 1 the Backyard, zombie world 1 the Citadel with no lava", () => {
    for (const [id, world] of [['p1-1', 'backyard'], ['p1-8', 'backyard'], ['z1-1', 'citadel'], ['z1-8', 'citadel']] as const) {
      const def = levelById(id)!;
      const save = newSave(def.side === 'plants' ? 'p01' : 'p02', 'Kid', 'peashooter', 0);
      const opts = levelOptions(prepareLevel(def, save, 3));
      const got = battleWorld(opts);
      expect(got.world).toBe(world);
      expect(got.lawn.lava).toBeNull();
      expect(got.lawn).toBe(opts.play!.config.lawn);
      expect(got.theme).toBe(world);
    }
  });
});
