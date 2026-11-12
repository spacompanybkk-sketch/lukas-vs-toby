import { Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Effects, HEAL_GLOW } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import { PIXEL_FONT_HEIGHT, pixelText } from '../../src/render/fx/pixelFont';
import { seededRandom } from '../../src/render/world/boxes';

const camera = new PerspectiveCamera();
camera.position.set(5, 8, 12);

function make(): Effects {
  return new Effects(new Particles(200), seededRandom(1));
}

function run(effects: Effects, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) effects.update(1 / 60, camera);
}

function shown(effects: Effects, name: string): Mesh[] {
  return effects.group.children.filter((o): o is Mesh => o instanceof Mesh && o.name === name && o.visible);
}

describe('Effects.miss', () => {
  it('pops a grey cross above the unit that goes away on its own', () => {
    const effects = make();
    const before = effects.group.children.length;
    effects.miss(new Vector3(3, 1, 2.5));
    run(effects, 0.1);
    const crosses = shown(effects, 'miss');
    expect(crosses).toHaveLength(1);
    const c = (crosses[0]!.material as MeshBasicMaterial).color;
    // Grey: no channel far from the others.
    expect(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)).toBeLessThan(0.05);
    // It rises above where it was asked for.
    run(effects, 0.2);
    expect(crosses[0]!.position.y).toBeGreaterThan(1);
    run(effects, 1);
    expect(shown(effects, 'miss')).toHaveLength(0);
    // Pooled: nothing was added to the group.
    expect(effects.group.children.length).toBe(before);
  });

  it('reuses its pool when many misses come at once', () => {
    const effects = make();
    const before = effects.group.children.length;
    for (let i = 0; i < 50; i++) effects.miss(new Vector3(i % 10, 1, 2.5));
    run(effects, 0.05);
    expect(shown(effects, 'miss').length).toBeGreaterThan(0);
    expect(effects.group.children.length).toBe(before);
  });
});

describe('Effects.healPlus', () => {
  it('raises a few glowing green plus blocks, then clears', () => {
    const effects = make();
    effects.healPlus(new Vector3(2, 0.5, 1.5));
    run(effects, 0.4);
    const pluses = shown(effects, 'heal-plus');
    expect(pluses.length).toBeGreaterThanOrEqual(3);
    for (const plus of pluses) {
      const c = (plus.material as MeshBasicMaterial).color;
      expect(c.g).toBeGreaterThan(c.r);
      expect(c.g).toBeGreaterThan(c.b * 0.9);
    }
    expect(HEAL_GLOW).toBeGreaterThanOrEqual(1.5);
    run(effects, 1.5);
    expect(shown(effects, 'heal-plus')).toHaveLength(0);
  });

  it('is cleared by clear()', () => {
    const effects = make();
    effects.healPlus(new Vector3(2, 0.5, 1.5));
    effects.miss(new Vector3(2, 0.5, 1.5));
    run(effects, 0.3);
    effects.clear();
    expect(shown(effects, 'heal-plus')).toHaveLength(0);
    expect(shown(effects, 'miss')).toHaveLength(0);
  });
});

describe('pixelText (floating numbers drawn pixel-hard)', () => {
  it('draws each character as a 5 × 7 glyph with a one-pixel outline', () => {
    const text = pixelText('+25');
    expect(text.height).toBe(PIXEL_FONT_HEIGHT);
    expect(text.width).toBe(3 * 6 - 1 + 2);
    expect(text.cells).toHaveLength(text.width * text.height);
  });

  it('has only three values: empty, outline and fill; nothing in between', () => {
    const text = pixelText('-140');
    expect(new Set(text.cells)).toEqual(new Set([0, 1, 2]));
  });

  it('surrounds every filled pixel with filled or outline pixels', () => {
    const { width, height, cells } = pixelText('+10 MISS');
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (cells[y * width + x] !== 2) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = cells[(y + dy) * width + (x + dx)];
            expect(v, `around ${x},${y}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('draws an unknown character as a question mark, and at most 8 characters', () => {
    expect(pixelText('é').cells).toEqual(pixelText('?').cells);
    expect(pixelText('1234567890').width).toBe(pixelText('12345678').width);
  });
});
