import { Color, InstancedMesh, MeshStandardMaterial, Object3D, type BufferGeometry, type ColorRepresentation } from 'three';
import { GRAVE_FROM_COL, LAWN_LANES, PLANT_BASE_X } from '../coords';
import { BoxBatch, paint, seededRandom, shade } from './boxes';
import { inLawn, insideIsland, onGraveSide } from './island';
import { LOOKS, type Tufts } from './looks';

// Grass tufts: one instanced mesh, bent by the wind in the vertex shader.

const TUFT_HEIGHT = 0.12;

function buildTuft(): BufferGeometry {
  const batch = new BoxBatch();
  // Shades of grey: the green comes from each instance's own colour.
  const root = new Color(0.55, 0.55, 0.55);
  const tip = new Color(1, 1, 1);
  const blade = (cx: number, cz: number, w: number, h: number): void => {
    const a = w / 2;
    const b = w / 4; // the tip is half as wide as the root
    const corners = (y: number, r: number): [number, number, number][] => [
      [cx - r, y, cz + r],
      [cx + r, y, cz + r],
      [cx + r, y, cz - r],
      [cx - r, y, cz - r],
    ];
    const low = corners(0, a);
    const high = corners(h, b);
    const normals: [number, number, number][] = [
      [0, 0.3, 1],
      [1, 0.3, 0],
      [0, 0.3, -1],
      [-1, 0.3, 0],
    ];
    for (let s = 0; s < 4; s++) {
      const t = (s + 1) % 4;
      batch.quad(
        low[s] as [number, number, number],
        low[t] as [number, number, number],
        high[t] as [number, number, number],
        high[s] as [number, number, number],
        normals[s] as [number, number, number],
        [root, root, tip, tip],
      );
    }
    batch.quad(
      high[0] as [number, number, number],
      high[1] as [number, number, number],
      high[2] as [number, number, number],
      high[3] as [number, number, number],
      [0, 1, 0],
      tip,
    );
  };
  blade(0, 0, 0.034, TUFT_HEIGHT);
  blade(-0.042, 0.02, 0.028, TUFT_HEIGHT * 0.68);
  blade(0.038, -0.022, 0.028, TUFT_HEIGHT * 0.8);
  blade(0.008, 0.045, 0.024, TUFT_HEIGHT * 0.52);
  return batch.build();
}

interface Tuft {
  x: number;
  z: number;
  scale: number;
  yaw: number;
  color: Color;
}

function scatterTufts(colours: Tufts, skip: (col: number, lane: number) => boolean): Tuft[] {
  const random = seededRandom(777);
  const tufts: Tuft[] = [];
  const { base, dark, light } = colours;
  const greens = [base, base, shade(base, 0.04), shade(dark, -0.05), light];
  const green = (): Color => paint(greens[Math.floor(random() * greens.length)] as ColorRepresentation);

  // On the grass tiles: short, and round the edges of each tile rather than under the plants.
  for (let lane = 0; lane < LAWN_LANES; lane++) {
    for (let col = 0; col < GRAVE_FROM_COL; col++) {
      const count = 3 + Math.floor(random() * 2);
      for (let i = 0; i < count; i++) {
        let dx = random();
        let dz = random();
        if (Math.hypot(dx - 0.5, dz - 0.5) < 0.33) {
          // Push it out of the middle towards the nearest edge.
          if (Math.abs(dx - 0.5) > Math.abs(dz - 0.5)) dx = dx < 0.5 ? dx * 0.3 : 1 - (1 - dx) * 0.3;
          else dz = dz < 0.5 ? dz * 0.3 : 1 - (1 - dz) * 0.3;
        }
        const tuft = { x: col + dx, z: lane + dz, scale: 0.6 + random() * 0.45, yaw: random() * Math.PI, color: green() };
        if (!skip(col, lane)) tufts.push(tuft);
      }
    }
  }
  // On the grass rim: taller and thicker.
  for (let i = 0; i < 520 && tufts.length < 720; i++) {
    const x = -2.6 + random() * 11.6;
    const z = -1.2 + random() * 7.4;
    if (inLawn(x, z) || onGraveSide(x, z)) continue;
    if (insideIsland(x, z) < 0.3) continue;
    // Keep Lukas's base pad clear for the fortress.
    if (x > PLANT_BASE_X[0] - 0.1 && x < PLANT_BASE_X[1] + 0.1 && z > 0 && z < LAWN_LANES) continue;
    tufts.push({ x, z, scale: 0.9 + random() * 0.8, yaw: random() * Math.PI, color: green() });
  }
  return tufts;
}

/**
 * The grass on the lawn and the rim, as one instanced mesh named `grass`. `wind.value` is
 * the time in seconds; change it and the tufts sway. The mesh owns its geometry and material.
 * `colours` tints the tufts; no tuft grows on a lawn tile `skip` names (ice or lava covers it).
 */
export function buildGrass(
  wind: { value: number },
  colours: Tufts = LOOKS.backyard.tufts,
  skip: (col: number, lane: number) => boolean = () => false,
): InstancedMesh {
  const tufts = scatterTufts(colours, skip);
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
          #ifdef USE_INSTANCING
            // Each tuft leans with a slow gust and a quicker flutter, timed by where it stands.
            vec3 tuftRoot = instanceMatrix[3].xyz;
            float gust = sin(uWind * 1.3 + tuftRoot.x * 0.8 + tuftRoot.z * 1.1) * 0.65
                       + sin(uWind * 2.9 + tuftRoot.x * 2.3 - tuftRoot.z * 1.7) * 0.35;
            vec3 windLocal = normalize(transpose(mat3(instanceMatrix)) * vec3(1.0, 0.0, 0.3));
            float bend = position.y / ${TUFT_HEIGHT.toFixed(3)};
            transformed += windLocal * (0.03 + gust * 0.022) * bend * bend;
          #endif`,
      );
  };

  const mesh = new InstancedMesh(buildTuft(), material, tufts.length);
  mesh.name = 'grass';
  mesh.receiveShadow = true;
  const dummy = new Object3D();
  tufts.forEach((tuft, i) => {
    dummy.position.set(tuft.x, 0, tuft.z);
    dummy.rotation.set(0, tuft.yaw, 0);
    dummy.scale.setScalar(tuft.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, tuft.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // The wind moves vertices outside each tuft's own bounds; never cull the patch as a whole.
  mesh.frustumCulled = false;
  return mesh;
}
