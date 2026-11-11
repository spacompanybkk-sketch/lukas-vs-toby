import { MeshStandardMaterial } from 'three';

// A glowing material for boxes painted per vertex, as the models' own glowing boxes are
// (`voxel/materials.ts`): the glow is white light multiplied by the box's painted colour, so
// a glowing part keeps its faces and creases instead of turning into a flat slab. It lives
// here rather than being borrowed from the model materials because those are freed with
// the models, and the bases and props outlive any one batch of units.

/** Multiplies the glow by the vertex colour where the shader adds it up. */
function shadeGlow(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;',
  );
}

/**
 * A new material that glows in its vertex colours at emissive `intensity`. Bloom starts at
 * scene luminance 1.2, so anything meant to glow wants 1.5 or more (art bible section 3).
 * The caller owns it and disposes it.
 */
export function glowMaterial(intensity: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0,
    emissive: '#FFFFFF',
    emissiveIntensity: intensity,
  });
  material.onBeforeCompile = shadeGlow;
  return material;
}
