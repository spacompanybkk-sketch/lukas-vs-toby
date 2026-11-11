import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { Sky } from '../../src/render/world/Sky';

function clouds(sky: Sky): Mesh[] {
  return sky.group.children.filter((child): child is Mesh => child instanceof Mesh && child.name === 'cloud');
}

describe('Sky', () => {
  it('has a dome and six clouds', () => {
    const sky = new Sky();
    expect(sky.group.getObjectByName('sky-dome')).toBeInstanceOf(Mesh);
    expect(clouds(sky)).toHaveLength(6);
  });

  it('keeps every cloud below the lawn, so the island floats above them', () => {
    const sky = new Sky();
    for (const time of [0, 30, 600]) {
      sky.update(time);
      for (const cloud of clouds(sky)) {
        cloud.geometry.computeBoundingBox();
        const top = cloud.position.y + (cloud.geometry.boundingBox?.max.y ?? 0);
        expect(top).toBeLessThan(-0.5);
      }
    }
  });

  it('drifts the clouds along +X and brings them round again', () => {
    const sky = new Sky();
    sky.update(0);
    const start = clouds(sky).map((cloud) => cloud.position.x);
    sky.update(10);
    const later = clouds(sky).map((cloud) => cloud.position.x);
    later.forEach((x, i) => {
      expect(x).toBeGreaterThan(start[i] as number);
      expect(x - (start[i] as number)).toBeLessThan(3);
    });
    // However long the game runs they stay within sight of the island.
    for (const time of [1e3, 1e4, 1e5, 1e6]) {
      sky.update(time);
      for (const cloud of clouds(sky)) {
        expect(cloud.position.x).toBeGreaterThanOrEqual(-30);
        expect(cloud.position.x).toBeLessThanOrEqual(40);
      }
    }
  });

  it('frees every geometry and material it made when disposed', () => {
    const sky = new Sky();
    const freed = new Set<object>();
    const made = new Set<object>();
    sky.group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      for (const resource of [object.geometry, object.material]) {
        made.add(resource);
        resource.addEventListener('dispose', () => freed.add(resource));
      }
    });
    // Seven geometries (dome and six clouds) and the two materials they share.
    expect(made.size).toBe(9);

    sky.dispose();
    expect(freed.size).toBe(made.size);
  });

  it('shows the same sky at the same time', () => {
    const a = new Sky();
    const b = new Sky();
    a.update(12.5);
    b.update(3);
    b.update(12.5);
    expect(clouds(a).map((c) => c.position.toArray())).toEqual(clouds(b).map((c) => c.position.toArray()));
    expect(clouds(a).map((c) => c.geometry.getAttribute('position').count)).toEqual(
      clouds(b).map((c) => c.geometry.getAttribute('position').count),
    );
  });
});
