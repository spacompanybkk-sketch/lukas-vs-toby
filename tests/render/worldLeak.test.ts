import { BufferGeometry, Material, Scene, Texture } from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorldWanted } from '../../src/app/Stage';
import { WORLD_ORDER } from '../../src/data/worlds';
import { Lawn } from '../../src/render/world/Lawn';
import { Sky } from '../../src/render/world/Sky';
import { SAMPLE_LAWNS } from '../../src/render/world/TwistTiles';

// Every geometry, material and texture made and freed while one stage is dressed in world after
// world. Three.js gives each of them a uuid in its constructor; a setter on the prototype sees
// that assignment, so every creation is counted, whether or not it ever reaches the scene.

type Kind = 'geometries' | 'materials' | 'textures';
const KINDS: [Kind, { prototype: object }][] = [['geometries', BufferGeometry], ['materials', Material], ['textures', Texture]];
const created: Record<Kind, Set<object>> = { geometries: new Set(), materials: new Set(), textures: new Set() };
const disposed: Record<Kind, Set<object>> = { geometries: new Set(), materials: new Set(), textures: new Set() };
const undo: (() => void)[] = [];

beforeAll(() => {
  for (const [kind, type] of KINDS) {
    const proto = type.prototype as { dispose: () => void };
    const dispose = proto.dispose;
    proto.dispose = function (this: object) {
      disposed[kind].add(this);
      dispose.call(this);
    };
    Object.defineProperty(proto, 'uuid', {
      configurable: true,
      set(this: object, value: string) {
        created[kind].add(this);
        Object.defineProperty(this, 'uuid', { value, writable: true, configurable: true, enumerable: true });
      },
    });
    undo.push(() => {
      proto.dispose = dispose;
      delete (proto as { uuid?: string }).uuid;
    });
  }
});

afterAll(() => {
  for (const u of undo) u();
});

const live = (): Record<Kind, number> => ({
  geometries: [...created.geometries].filter((g) => !disposed.geometries.has(g)).length,
  materials: [...created.materials].filter((m) => !disposed.materials.has(m)).length,
  textures: [...created.textures].filter((t) => !disposed.textures.has(t)).length,
});

describe('one stage through every world', () => {
  it('keeps the live geometry, material and texture counts flat over ten rounds of all five worlds (lawn and sky)', () => {
    // The stage's world-dressed tree: the sky and the lawn in one scene, put on as the Stage does.
    const scene = new Scene();
    const lawn = new Lawn();
    const sky = new Sky();
    scene.add(sky.group, lawn.group);
    const renderer = { setLook() {} };
    const wanted = new WorldWanted();
    const parts = { lawn, sky, renderer };
    const round = (): void => {
      for (const world of WORLD_ORDER) {
        wanted.want(world, SAMPLE_LAWNS[world]);
        wanted.apply(parts);
        sky.update(1);
        lawn.update(1);
      }
      wanted.want('backyard', SAMPLE_LAWNS.backyard);
      wanted.apply(parts);
    };
    // The first round makes what is kept for good (the moon, the first time a look asks for it).
    round();
    const first = live();
    const rounds: Record<Kind, number>[] = [];
    for (let i = 0; i < 9; i++) {
      round();
      rounds.push(live());
    }
    for (const r of rounds) expect(r).toEqual(first);
    // And the dressing really was rebuilt each time (the counter sees it).
    expect(created.geometries.size).toBeGreaterThan(first.geometries + 9 * WORLD_ORDER.length);
    scene.remove(sky.group, lawn.group);
    lawn.dispose();
    sky.dispose();
  });
});
