import { Box3, Color, Mesh, NearestFilter, type DataTexture, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { LAWN_COLS, LAWN_LANES } from '../../src/render/coords';
import { Lawn } from '../../src/render/world/Lawn';
import { MARKS_LAVA, MARKS_LOUD, MARKS_QUIET } from '../../src/render/world/PlaceMarks';
import { NO_TWIST } from '../../src/sim/lawn';
import type { LawnConfig } from '../../src/sim/types';

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

  it('a marked lava tile gets the warning instead ("you can, but it burns"): opaque orange brackets over the crust; other tiles keep the look\'s', () => {
    const lava: LawnConfig = { ...NO_TWIST, lava: { tiles: [1 * LAWN_COLS + 3, 2 * LAWN_COLS + 4], dps: 15, burnTicks: 60 } };
    const lawn = new Lawn('citadel', lava);
    const m = marks(lawn);
    const warn = lawn.group.getObjectByName('place-marks-lava') as Mesh;
    expect(warn).toBeInstanceOf(Mesh);
    expect(warn.visible).toBe(false);
    const mask = new Uint8Array(LAWN_COLS * LAWN_LANES);
    mask[1 * LAWN_COLS + 3] = 1; // lava, marked
    mask[1 * LAWN_COLS + 2] = 1; // plain, marked
    lawn.showPlaceable(mask);
    expect(m.visible).toBe(true);
    expect(warn.visible).toBe(true);
    const data = uniform<DataTexture>(m, 'uMask').image.data as Uint8Array;
    expect(uniform<DataTexture>(warn, 'uMask')).toBe(uniform<DataTexture>(m, 'uMask')); // one texture
    const warned = (i: number): boolean => data[i * 4 + 1]! > 0;
    const shown = (i: number): boolean => data[i * 4]! > 0;
    expect(shown(1 * LAWN_COLS + 3) && warned(1 * LAWN_COLS + 3)).toBe(true);
    expect(shown(1 * LAWN_COLS + 2) && !warned(1 * LAWN_COLS + 2)).toBe(true);
    // The other lava tile is not marked: the warning never lights a tile by itself.
    expect(warned(2 * LAWN_COLS + 4) && !shown(2 * LAWN_COLS + 4)).toBe(true);
    // The plain quad skips warned tiles and the warning quad draws only them.
    const plainShader = (m.material as ShaderMaterial).fragmentShader;
    const warnShader = (warn.material as ShaderMaterial).fragmentShader;
    expect(plainShader).toMatch(/texel\.g > 0\.5\) discard/);
    expect(warnShader).toMatch(/texel\.g < 0\.5\) discard/);
    // Opaque whatever the strength (the molten glow swallows anything see-through), over the crust.
    expect(warnShader).not.toMatch(/uStrength, uGamma/);
    lawn.setPlaceStrength(MARKS_QUIET);
    expect(warnShader).toMatch(/vec4\(uInk, 1\.0\)/);
    expect(warnShader).toMatch(/d == 1\.0 \|\| d == 2\.0\)\) gl_FragColor = vec4\(uLine, 1\.0\)/); // a thick orange band
    expect(warn.position.y).toBeGreaterThan(0.055);
    // Warning orange inked in near-black, kept through the world's own marks look.
    const line = uniform<Color>(warn, 'uLine');
    expect(line.r).toBeGreaterThan(line.g);
    expect(line.g).toBeGreaterThan(line.b);
    expect(line.getHexString().toUpperCase()).toBe(MARKS_LAVA.line.slice(1).toUpperCase());
    expect(new Color(MARKS_LAVA.ink).getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.1);
    // A world without lava: no warned tile left, the warning quad hidden.
    lawn.setWorld('backyard', NO_TWIST);
    for (let i = 0; i < LAWN_COLS * LAWN_LANES; i++) expect(warned(i), String(i)).toBe(false);
    expect(warn.visible).toBe(false);
    expect(m.visible).toBe(true);
    lawn.dispose();
  });
});
