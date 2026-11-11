import {
  Color,
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  RGBAFormat,
} from 'three';
import { MATTE_PLASTIC, SUN_TRAVEL } from '../look';
import { LEVEL_MATERIALS, PALETTE, type LevelMaterial } from './palette';

// The few materials every model shares. A model's boxes are sorted into these classes and
// each class of each part is one mesh, so a lawn full of units changes material rarely.

/**
 * `plain` is matte toy plastic; `iron`, `crystal` and `gold` are the level materials; a
 * `glow:` key is a box that shines in its own colour at a given emissive intensity.
 */
export type MaterialKey = 'plain' | Exclude<LevelMaterial, 'none'> | `glow:#${string}:${number}`;

/** The key for a box of colour `hex` (`#RRGGBB`) glowing at emissive intensity `intensity`. */
export function glowKey(hex: string, intensity: number): MaterialKey {
  return `glow:#${hex.slice(1).toUpperCase()}:${intensity}`;
}

/** How bright the reflected studio is on metal. Tuned by eye against the lawn's exposure. */
const REFLECTION_STRENGTH = 1;

let studio: DataTexture | null = null;

/**
 * What iron and gold reflect. Metal with nothing to reflect is black, and the scene has no
 * environment of its own (adding one would relight the lawn), so the two metal materials
 * carry this small painted sky: warm white overhead, pale at the horizon, a warm floor
 * below so camera-facing sides do not go dark or green, and a soft hot spot where the sun
 * is. It is a reflection, not a light: nothing but these two materials sees it.
 */
function studioReflection(): DataTexture {
  if (studio) return studio;
  const width = 256;
  const height = 128;
  const data = new Uint16Array(width * height * 4);
  // Kept as dim as the lit lawn (scene luminance about 0.6), or metal comes out white.
  const overhead = new Color(1.0, 0.96, 0.86).multiplyScalar(0.62);
  const horizon = new Color(0.78, 0.88, 1.0).multiplyScalar(0.5);
  const floor = new Color(0.62, 0.55, 0.42).multiplyScalar(0.26);
  const sunColour = new Color(1.0, 0.9, 0.7);
  const pixel = new Color();
  for (let row = 0; row < height; row++) {
    // Row 0 is straight down, the last row straight up.
    const elevation = ((row + 0.5) / height - 0.5) * Math.PI;
    const y = Math.sin(elevation);
    const flat = Math.cos(elevation);
    for (let col = 0; col < width; col++) {
      // Three.js reads an equirectangular map with u = atan2(z, x) / 2π + 0.5.
      const azimuth = ((col + 0.5) / width - 0.5) * 2 * Math.PI;
      const x = Math.cos(azimuth) * flat;
      const z = Math.sin(azimuth) * flat;
      if (y >= 0) pixel.copy(horizon).lerp(overhead, Math.pow(y, 0.7));
      else pixel.copy(horizon).lerp(floor, Math.min(1, -y * 3));
      const towardsSun = -(x * SUN_TRAVEL.x + y * SUN_TRAVEL.y + z * SUN_TRAVEL.z);
      const glare = Math.exp((towardsSun - 1) * 14) * 2;
      const at = (row * width + col) * 4;
      data[at] = DataUtils.toHalfFloat(pixel.r + sunColour.r * glare);
      data[at + 1] = DataUtils.toHalfFloat(pixel.g + sunColour.g * glare);
      data[at + 2] = DataUtils.toHalfFloat(pixel.b + sunColour.b * glare);
      data[at + 3] = DataUtils.toHalfFloat(1);
    }
  }
  studio = new DataTexture(data, width, height, RGBAFormat, HalfFloatType);
  studio.name = 'model-studio-reflection';
  studio.mapping = EquirectangularReflectionMapping;
  studio.colorSpace = LinearSRGBColorSpace;
  studio.minFilter = LinearFilter;
  studio.magFilter = LinearFilter;
  studio.needsUpdate = true;
  return studio;
}

const cache = new Map<MaterialKey, MeshStandardMaterial>();

function make(key: MaterialKey): MeshStandardMaterial {
  if (key === 'plain') return new MeshStandardMaterial(MATTE_PLASTIC);
  if (key === 'iron' || key === 'crystal' || key === 'gold') {
    const def = LEVEL_MATERIALS[key];
    const material = new MeshStandardMaterial({
      vertexColors: true,
      metalness: def.metalness,
      roughness: def.roughness,
      emissive: def.emissive > 0 ? PALETTE[def.glow ?? def.tones[0]] : '#000000',
      emissiveIntensity: def.emissive > 0 ? def.emissive : 1,
    });
    if (def.metalness > 0) {
      material.envMap = studioReflection();
      material.envMapIntensity = REFLECTION_STRENGTH;
    }
    return material;
  }
  const [, hex, intensity] = key.split(':');
  return new MeshStandardMaterial({
    vertexColors: true,
    metalness: 0,
    roughness: 0.6,
    emissive: hex,
    emissiveIntensity: Number(intensity),
  });
}

/** The one material for `key`, made on first use. Shared by every model: never change or dispose it. */
export function sharedMaterial(key: MaterialKey): MeshStandardMaterial {
  let material = cache.get(key);
  if (!material) {
    material = make(key);
    material.name = key;
    cache.set(key, material);
  }
  return material;
}

/** Frees every shared material and the reflection they carry. They are made again on next use. */
export function disposeMaterials(): void {
  for (const material of cache.values()) material.dispose();
  cache.clear();
  studio?.dispose();
  studio = null;
}
