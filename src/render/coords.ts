import { Vector3, type Camera } from 'three';

// World space: x is the simulation's x along the lane (column c covers [c, c + 1]),
// y is up with the lawn surface at 0, z is lane + 0.5 (lane 0 at the back, lane 4
// nearest the camera).

/** Lawn size in tiles. The simulation's own constants are not imported here on purpose. */
export const LAWN_COLS = 10;
export const LAWN_LANES = 5;
/** The graveyard strip, where plants cannot stand, starts at this column. */
export const GRAVE_FROM_COL = 8;

/** World x range each base stands on, just off the two ends of the lawn. */
export const PLANT_BASE_X: [number, number] = [-1.7, -0.1];
export const ZOMBIE_BASE_X: [number, number] = [10.1, 11.7];

const near = new Vector3();
const far = new Vector3();
const projected = new Vector3();

/** Centre of a tile on the lawn surface. */
export function tileCenter(lane: number, col: number, out: Vector3 = new Vector3()): Vector3 {
  return out.set(col + 0.5, 0, lane + 0.5);
}

/** World position of a simulation position: lane index and continuous x. */
export function simToWorld(lane: number, x: number, out: Vector3 = new Vector3()): Vector3 {
  return out.set(x, 0, lane + 0.5);
}

/**
 * The tile under a pointer at normalised device coordinates (−1..1, y up), or null when
 * the pointer is off the lawn. The camera's matrices must be current (CameraRig keeps
 * them so).
 */
export function pickTile(ndcX: number, ndcY: number, camera: Camera): { lane: number; col: number } | null {
  near.set(ndcX, ndcY, -1).unproject(camera);
  far.set(ndcX, ndcY, 1).unproject(camera);
  const fall = near.y - far.y;
  // The ray has to come down onto the lawn plane y = 0 from above.
  if (!(fall > 0) || !(near.y > 0)) return null;
  const t = near.y / fall;
  const x = near.x + (far.x - near.x) * t;
  const z = near.z + (far.z - near.z) * t;
  if (!(x >= 0 && x < LAWN_COLS && z >= 0 && z < LAWN_LANES)) return null;
  return { lane: Math.floor(z), col: Math.floor(x) };
}

/** Client pixel position (origin top-left of the viewport) of a world point. */
export function worldToClient(
  p: Vector3,
  camera: Camera,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  projected.copy(p).project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * viewport.width,
    y: (0.5 - projected.y * 0.5) * viewport.height,
  };
}
