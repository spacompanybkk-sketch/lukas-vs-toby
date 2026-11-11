import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/render/CameraRig';
import {
  PLANT_BASE_X,
  ZOMBIE_BASE_X,
  pickTile,
  simToWorld,
  tileCenter,
  worldToClient,
} from '../../src/render/coords';

function framedCamera(aspect = 16 / 10): PerspectiveCamera {
  const camera = new PerspectiveCamera();
  new CameraRig(camera).frameLawn(aspect);
  return camera;
}

describe('coords', () => {
  it('puts tile (lane 2, column 3) at (3.5, 0, 2.5)', () => {
    const p = tileCenter(2, 3);
    expect([p.x, p.y, p.z]).toEqual([3.5, 0, 2.5]);
  });

  it('puts simulation position (lane 4, x 9.5) at (9.5, 0, 4.5)', () => {
    const p = simToWorld(4, 9.5);
    expect([p.x, p.y, p.z]).toEqual([9.5, 0, 4.5]);
  });

  it('writes into the vector it is given', () => {
    const out = new Vector3(9, 9, 9);
    expect(tileCenter(0, 0, out)).toBe(out);
    expect([out.x, out.y, out.z]).toEqual([0.5, 0, 0.5]);
    expect(simToWorld(1, 2.25, out)).toBe(out);
    expect([out.x, out.y, out.z]).toEqual([2.25, 0, 1.5]);
  });

  it('keeps the bases just off the two ends of the lawn', () => {
    expect(PLANT_BASE_X).toEqual([-1.7, -0.1]);
    expect(ZOMBIE_BASE_X).toEqual([10.1, 11.7]);
  });

  it.each([4 / 3, 16 / 10, 16 / 9, 21 / 9])('picks every one of the 50 tiles through its centre (aspect %f)', (aspect) => {
    const camera = framedCamera(aspect);
    for (let lane = 0; lane < 5; lane++) {
      for (let col = 0; col < 10; col++) {
        const ndc = tileCenter(lane, col).project(camera);
        expect(pickTile(ndc.x, ndc.y, camera)).toEqual({ lane, col });
      }
    }
  });

  it('picks the right tile just inside each of its corners', () => {
    const camera = framedCamera();
    for (const [lane, col] of [[0, 0], [4, 9], [2, 7], [3, 8]] as const) {
      for (const dx of [0.02, 0.98]) {
        for (const dz of [0.02, 0.98]) {
          const ndc = new Vector3(col + dx, 0, lane + dz).project(camera);
          expect(pickTile(ndc.x, ndc.y, camera)).toEqual({ lane, col });
        }
      }
    }
  });

  it('returns null over the sky, the bases and the island rim', () => {
    const camera = framedCamera();
    expect(pickTile(0, 0.97, camera)).toBeNull();
    expect(pickTile(-0.99, -0.99, camera)).toBeNull();
    for (const off of [
      new Vector3(-0.9, 0, 2.5), // plant base
      new Vector3(10.9, 0, 2.5), // zombie base
      new Vector3(5, 0, -0.2), // behind lane 0
      new Vector3(5, 0, 5.2), // in front of lane 4
      new Vector3(-0.01, 0, 0.5),
      new Vector3(10.01, 0, 4.5),
    ]) {
      const ndc = off.project(camera);
      expect(pickTile(ndc.x, ndc.y, camera)).toBeNull();
    }
  });

  it('returns null when the pointer ray never reaches the ground', () => {
    const camera = new PerspectiveCamera(30, 1.6, 0.1, 100);
    camera.position.set(5, 3, 12);
    camera.lookAt(5, 9, 2.5); // looking up at the sky
    camera.updateMatrixWorld();
    expect(pickTile(0, 0, camera)).toBeNull();
    expect(pickTile(Number.NaN, 0, camera)).toBeNull();
  });

  it('maps world points to client pixels, top-left origin', () => {
    const camera = framedCamera(1440 / 900);
    const viewport = { width: 1440, height: 900 };

    const centre = worldToClient(new Vector3(5, 0, 2.5), camera, viewport);
    expect(centre.x).toBeCloseTo(720, 6);

    const backLeft = worldToClient(tileCenter(0, 0), camera, viewport);
    const frontRight = worldToClient(tileCenter(4, 9), camera, viewport);
    expect(backLeft.x).toBeLessThan(frontRight.x);
    expect(backLeft.y).toBeLessThan(frontRight.y); // lane 4 is nearer the camera, so lower on screen

    // The round trip agrees with pickTile.
    for (const [lane, col] of [[0, 0], [2, 5], [4, 9]] as const) {
      const px = worldToClient(tileCenter(lane, col), camera, viewport);
      expect(px.x).toBeGreaterThan(0.03 * viewport.width);
      expect(px.x).toBeLessThan(0.97 * viewport.width);
      expect(px.y).toBeGreaterThan(0.09 * viewport.height);
      expect(px.y).toBeLessThan(0.78 * viewport.height);
      const ndcX = (px.x / viewport.width) * 2 - 1;
      const ndcY = 1 - (px.y / viewport.height) * 2;
      expect(pickTile(ndcX, ndcY, camera)).toEqual({ lane, col });
    }
  });
});
