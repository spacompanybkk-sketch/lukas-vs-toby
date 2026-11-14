import { Box3, Mesh, NearestFilter, type DataTexture, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { LAWN_COLS, LAWN_LANES } from '../../src/render/coords';
import { Lawn } from '../../src/render/world/Lawn';
import { MARKS_LOUD, MARKS_QUIET } from '../../src/render/world/PlaceMarks';

// UX fix A: the tiles the picked card may go on, as one pixel-edged overlay on the lawn.

function marks(lawn: Lawn): Mesh {
  const found = lawn.group.getObjectByName('place-marks');
  if (!(found instanceof Mesh)) throw new Error('no place-marks mesh');
  return found;
}

const uniform = <T>(m: Mesh, name: string): T => ((m.material as ShaderMaterial).uniforms[name] as { value: T }).value;

describe('the place marks', () => {
  it('one quad over the whole lawn, hidden until something may be placed', () => {
    const lawn = new Lawn();
    const m = marks(lawn);
    expect(m.visible).toBe(false);
    m.updateMatrixWorld(true);
    const box = new Box3().setFromObject(m);
    expect(box.min.x).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(LAWN_COLS);
    expect(box.min.z).toBeCloseTo(0);
    expect(box.max.z).toBeCloseTo(LAWN_LANES);
    lawn.dispose();
  });

  it('shows exactly the marked tiles (lane * cols + col), hard-edged (nearest texels); corner brackets only, no fill over the grass', () => {
    const lawn = new Lawn();
    const mask = new Uint8Array(LAWN_COLS * LAWN_LANES);
    mask[2 * LAWN_COLS + 1] = 1;
    mask[4 * LAWN_COLS + 9] = 1;
    lawn.showPlaceable(mask);
    const m = marks(lawn);
    expect(m.visible).toBe(true);
    const tex = uniform<DataTexture>(m, 'uMask');
    expect(tex.magFilter).toBe(NearestFilter);
    expect(tex.minFilter).toBe(NearestFilter);
    const data = tex.image.data as Uint8Array;
    const on: number[] = [];
    for (let i = 0; i < LAWN_COLS * LAWN_LANES; i++) if (data[i * 4]! > 0) on.push(i);
    expect(on).toEqual([2 * LAWN_COLS + 1, 4 * LAWN_COLS + 9]);
    const material = m.material as ShaderMaterial;
    expect(Object.keys(material.uniforms)).not.toContain('uFill');
    expect(material.fragmentShader).not.toMatch(/uFill|inside/);
    lawn.dispose();
  });

  it('quiet by default (thin brackets the lawn reads through), loud on request', () => {
    const lawn = new Lawn();
    const m = marks(lawn);
    expect(MARKS_QUIET).toBeCloseTo(0.35);
    expect(uniform<number>(m, 'uStrength')).toBe(MARKS_QUIET);
    lawn.setPlaceStrength(MARKS_LOUD);
    expect(uniform<number>(m, 'uStrength')).toBe(1);
    lawn.setPlaceStrength(MARKS_QUIET);
    expect(uniform<number>(m, 'uStrength')).toBe(MARKS_QUIET);
    lawn.dispose();
  });

  it('nothing marked, or none given: hidden', () => {
    const lawn = new Lawn();
    const mask = new Uint8Array(LAWN_COLS * LAWN_LANES);
    mask[0] = 1;
    lawn.showPlaceable(mask);
    expect(marks(lawn).visible).toBe(true);
    lawn.showPlaceable(null);
    expect(marks(lawn).visible).toBe(false);
    lawn.showPlaceable(new Uint8Array(LAWN_COLS * LAWN_LANES));
    expect(marks(lawn).visible).toBe(false);
    lawn.dispose();
  });
});
