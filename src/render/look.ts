import { Vector3 } from 'three';

// The parts of the look that are not colours and that more than one module needs. The
// renderer applies them; the sky, the lawn and (later) the models have to agree with them.

/**
 * Direction the sunlight travels (art bible section 4): down from the upper left and
 * slightly from behind the lawn, about 61° above the ground, so shadows fall to the right
 * and slightly towards the camera.
 */
export const SUN_TRAVEL = new Vector3(0.5, -1, 0.22).normalize();

/** Art bible section 4: matte toy plastic, coloured per vertex. */
export const MATTE_PLASTIC = { vertexColors: true, roughness: 0.85, metalness: 0 } as const;

/**
 * Exposure of the filmic tone mapper. It is high and the lights are correspondingly dim, so
 * lit surfaces look the same as at exposure 1 but stay under scene luminance 0.6. That
 * leaves room below the bloom threshold for painted things (sky, clouds) to be near-white
 * on screen without glowing.
 */
export const EXPOSURE = 2;

/**
 * Scene luminance where bloom starts. Sunlit surfaces reach about 0.6 and clouds 1.0, so
 * only parts that are meant to glow (emissive intensity 1.5 or more) cross it.
 */
export const BLOOM_THRESHOLD = 1.2;

/**
 * GLSL for materials that are painted rather than lit (sky, clouds): `displayToScene(c)`
 * returns the scene colour that the tone mapper turns into linear display colour `c`, so
 * such a material can name the colour it wants on screen. It is the inverse of the filmic
 * curve used in the post chain; colours brighter than the curve can reach are clamped.
 */
export const DISPLAY_TO_SCENE_GLSL = /* glsl */ `
  vec3 displayToScene(vec3 c) {
    vec3 f = pow(clamp(c, 0.0, 0.82), vec3(1.0 / 2.2));
    vec3 a = 6.2 * (f - 1.0);
    vec3 b = 1.7 * f - 0.5;
    vec3 x = (-b - sqrt(max(b * b - 0.24 * a * f, 0.0))) / (2.0 * a);
    return (x + 0.004) / ${EXPOSURE.toFixed(4)};
  }
`;
