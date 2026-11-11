import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Box3, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { BLOOM_THRESHOLD, EXPOSURE, MATTE_PLASTIC, SUN_TRAVEL } from '../../src/render/look';
import { PALETTE } from '../../src/render/palette';
import { GRAVESTONE_HEIGHT, makeGravestone } from '../../src/render/world/props';

const ROOT = path.resolve(import.meta.dirname, '../..');

describe('palette', () => {
  it('has every name the models and effects will ask for', () => {
    const names = [
      'leaf', 'leafDark', 'leafLight', 'stem', 'pea', 'petal', 'petalDark', 'sunflowerFace', 'walnut', 'walnutDark',
      'walnutLight', 'terracotta', 'skin', 'skinDark', 'clothPurple', 'clothDark', 'bone', 'boneShadow', 'brainPink',
      'iron', 'rust', 'speedRed', 'grassLight', 'grassDark', 'soil', 'soilDark', 'islandRock', 'graveLight',
      'graveDark', 'skyTop', 'skyHorizon', 'cloud', 'levelIron', 'levelCrystal', 'levelGold', 'hitSpark', 'fire',
      'fireLight', 'poison', 'heal', 'stunStars', 'sun', 'brains', 'outline',
    ];
    for (const name of names) expect(PALETTE[name], name).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('holds only upper-case #RRGGBB values', () => {
    for (const [name, value] of Object.entries(PALETTE)) expect(value, name).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('carries every colour in the art bible, exactly', () => {
    const bible = readFileSync(path.join(ROOT, 'docs/art-bible.md'), 'utf8');
    const inBible = new Set(bible.match(/#[0-9A-Fa-f]{6}\b/g)?.map((hex) => hex.toUpperCase()));
    expect(inBible.size).toBeGreaterThan(40);
    const inPalette = new Set(Object.values(PALETTE));
    const missing = [...inBible].filter((hex) => !inPalette.has(hex));
    expect(missing).toEqual([]);
  });

  it('matches the art bible on the colours named there', () => {
    expect(PALETTE).toMatchObject({
      leaf: '#58C13B',
      petal: '#FFC928',
      terracotta: '#C8643C',
      skin: '#9ACD8A',
      clothPurple: '#7B4BD6',
      bone: '#EDE6D3',
      speedRed: '#E2553F',
      grassLight: '#7FD14B',
      grassDark: '#6BBE3F',
      soil: '#8B5A2B',
      islandRock: '#7A6A5A',
      graveLight: '#5B4B7A',
      graveDark: '#4A3C66',
      skyTop: '#5EC8FF',
      skyHorizon: '#CFF3FF',
      levelIron: '#AEB7C2',
      levelCrystal: '#7DE8FF',
      levelGold: '#FFC83D',
      fire: '#FF7A1A',
      fireLight: '#FFD23F',
      sun: '#FFD54A',
      brains: '#FF8FB1',
      outline: '#2A1B0E',
      sunLight: '#FFF1D6',
      fillSky: '#BFE8FF',
      fillGround: '#6BBE3F',
      bounceLight: '#DCEBFF',
    });
  });

  it('answers undefined for a name it does not have', () => {
    expect(PALETTE['no-such-colour']).toBeUndefined();
  });
});

describe('look', () => {
  it('sends sunlight down, to the right and slightly towards the camera', () => {
    expect(SUN_TRAVEL.length()).toBeCloseTo(1, 12);
    expect(SUN_TRAVEL.y).toBeLessThan(0);
    expect(SUN_TRAVEL.x).toBeGreaterThan(0);
    expect(SUN_TRAVEL.z).toBeGreaterThan(0);
    expect(SUN_TRAVEL.z).toBeLessThan(SUN_TRAVEL.x);
  });

  it('keeps the art bible numbers', () => {
    expect(MATTE_PLASTIC).toEqual({ vertexColors: true, roughness: 0.85, metalness: 0 });
    expect(BLOOM_THRESHOLD).toBe(1.2);
    expect(EXPOSURE).toBeGreaterThan(0);
  });
});

describe('world modules', () => {
  it('do not reach back into the renderer', () => {
    const dir = path.join(ROOT, 'src/render/world');
    for (const file of readdirSync(dir)) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      expect(source, file).not.toMatch(/from '\.\.\/Renderer'/);
    }
    for (const file of ['look.ts', 'palette.ts', 'types.ts', 'coords.ts', 'RenderScale.ts']) {
      const source = readFileSync(path.join(ROOT, 'src/render', file), 'utf8');
      expect(source, file).not.toMatch(/Renderer'|postprocessing|n8ao/);
    }
  });
});

describe('makeGravestone', () => {
  it('makes a gravestone that stands on its origin, half a tile tall', () => {
    const stone = makeGravestone();
    expect(stone).toBeInstanceOf(Mesh);
    expect(stone.name).toBe('gravestone');
    const box = new Box3().setFromObject(stone);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(GRAVESTONE_HEIGHT, 6);
    expect(GRAVESTONE_HEIGHT).toBe(0.5);
    // Centred on its own origin, and thin front to back.
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 6);
    expect(box.max.x - box.min.x).toBeLessThan(0.5);
    expect(box.max.z - box.min.z).toBeLessThan(0.25);
    expect(stone.castShadow).toBe(true);
    expect(stone.receiveShadow).toBe(true);
  });

  it('gives separate objects that share one geometry and one material', () => {
    const a = makeGravestone() as Mesh;
    const b = makeGravestone() as Mesh;
    expect(a).not.toBe(b);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    a.position.set(3, 0, 1);
    expect(b.position.toArray()).toEqual([0, 0, 0]);
  });
});
