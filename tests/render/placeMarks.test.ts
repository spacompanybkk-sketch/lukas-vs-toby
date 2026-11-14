import { Box3, Color, Mesh, NearestFilter, type DataTexture, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { LAWN_COLS, LAWN_LANES } from '../../src/render/coords';
import { PALETTE } from '../../src/render/palette';
import { Lawn } from '../../src/render/world/Lawn';

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

  it('shows exactly the marked tiles (lane * cols + col), hard-edged (nearest texels), in the side\'s colour', () => {
    const lawn = new Lawn();
    const mask = new Uint8Array(LAWN_COLS * LAWN_LANES);
    mask[2 * LAWN_COLS + 1] = 1;
    mask[4 * LAWN_COLS + 9] = 1;
    lawn.showPlaceable(mask, 'plants');
    const m = marks(lawn);
    expect(m.visible).toBe(true);
    const tex = uniform<DataTexture>(m, 'uMask');
    expect(tex.magFilter).toBe(NearestFilter);
    expect(tex.minFilter).toBe(NearestFilter);
    const data = tex.image.data as Uint8Array;
    const on: number[] = [];
    for (let i = 0; i < LAWN_COLS * LAWN_LANES; i++) if (data[i * 4]! > 0) on.push(i);
    expect(on).toEqual([2 * LAWN_COLS + 1, 4 * LAWN_COLS + 9]);
    expect(uniform<Color>(m, 'uFill').getHexString()).toBe(new Color(PALETTE.sun).getHexString());
    lawn.showPlaceable(mask, 'zombies');
    expect(uniform<Color>(m, 'uFill').getHexString()).toBe(new Color(PALETTE.lanePurple).getHexString());
    lawn.dispose();
  });

  it('nothing marked, or none given: hidden', () => {
    const lawn = new Lawn();
    const mask = new Uint8Array(LAWN_COLS * LAWN_LANES);
    mask[0] = 1;
    lawn.showPlaceable(mask, 'plants');
    expect(marks(lawn).visible).toBe(true);
    lawn.showPlaceable(null, 'plants');
    expect(marks(lawn).visible).toBe(false);
    lawn.showPlaceable(new Uint8Array(LAWN_COLS * LAWN_LANES), 'plants');
    expect(marks(lawn).visible).toBe(false);
    lawn.dispose();
  });
});
