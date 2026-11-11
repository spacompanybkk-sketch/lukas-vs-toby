import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/render/CameraRig';

const ASPECTS: [string, number][] = [
  ['4:3', 4 / 3],
  ['16:10', 16 / 10],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
];

/** The lawn, both bases and the tallest thing that stands on them. */
const BOX = { x: [-1.9, 11.9], y: [0, 2.4], z: [-0.3, 5.3] } as const;

/** Screen rectangle left free by the HUD, in NDC: 3% side margins, 9% top bar, 22% card tray. */
const FREE = { left: -0.94, right: 0.94, bottom: -0.56, top: 0.82 };

function boxCornersNdc(camera: PerspectiveCamera): Vector3[] {
  const out: Vector3[] = [];
  for (const x of BOX.x) for (const y of BOX.y) for (const z of BOX.z) out.push(new Vector3(x, y, z).project(camera));
  return out;
}

function framed(aspect: number): { camera: PerspectiveCamera; rig: CameraRig } {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  const rig = new CameraRig(camera);
  rig.frameLawn(aspect);
  return { camera, rig };
}

function settle(rig: CameraRig, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) rig.update(1 / 60);
}

describe.each(ASPECTS)('CameraRig.frameLawn at %s', (_name, aspect) => {
  it('keeps the whole lawn and both bases clear of the top bar, the card tray and the sides', () => {
    const { camera } = framed(aspect);
    for (const ndc of boxCornersNdc(camera)) {
      expect(ndc.x).toBeGreaterThanOrEqual(FREE.left);
      expect(ndc.x).toBeLessThanOrEqual(FREE.right);
      expect(ndc.y).toBeGreaterThanOrEqual(FREE.bottom);
      expect(ndc.y).toBeLessThanOrEqual(FREE.top);
      expect(ndc.z).toBeGreaterThan(-1);
      expect(ndc.z).toBeLessThan(1);
    }
  });

  it('comes no further back than it has to', () => {
    const { camera } = framed(aspect);
    const ndc = boxCornersNdc(camera);
    const xs = ndc.map((p) => p.x);
    const ys = ndc.map((p) => p.y);
    const touchesSides = Math.max(...xs) > FREE.right - 0.01 && Math.min(...xs) < FREE.left + 0.01;
    const touchesTopAndBottom = Math.max(...ys) > FREE.top - 0.01 && Math.min(...ys) < FREE.bottom + 0.01;
    expect(touchesSides || touchesTopAndBottom).toBe(true);
  });

  it('keeps a 30 degree field of view, a 52 degree pitch and no yaw', () => {
    const { camera } = framed(aspect);
    expect(camera.fov).toBe(30);
    expect(camera.aspect).toBeCloseTo(aspect, 10);
    const forward = camera.getWorldDirection(new Vector3());
    expect(forward.x).toBeCloseTo(0, 10);
    expect(MathUtils.radToDeg(Math.asin(-forward.y))).toBeCloseTo(52, 6);
    expect(forward.z).toBeLessThan(0);
    // No roll either: the camera's right axis is world +X.
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    expect(right.x).toBeCloseTo(1, 10);
  });

  it('stays framed after the same frame is asked for again and after time passes', () => {
    const { camera, rig } = framed(aspect);
    const before = camera.position.clone();
    rig.frameLawn(aspect);
    settle(rig, 1);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9);
  });
});

describe('CameraRig motion', () => {
  it('re-frames for a new window shape', () => {
    const { camera, rig } = framed(16 / 9);
    const wide = camera.position.clone();
    rig.frameLawn(4 / 3);
    expect(camera.position.distanceTo(wide)).toBeGreaterThan(1);
    expect(camera.position.distanceTo(framed(4 / 3).camera.position)).toBeLessThan(1e-9);
  });

  it('shakes, then comes to rest exactly where it was', () => {
    const { camera, rig } = framed(16 / 10);
    const home = camera.position.clone();
    rig.shake(1, 0.4);
    let moved = 0;
    for (let i = 0; i < 12; i++) {
      rig.update(1 / 60);
      moved = Math.max(moved, camera.position.distanceTo(home));
    }
    expect(moved).toBeGreaterThan(0.01);
    expect(moved).toBeLessThan(1);
    settle(rig, 1);
    expect(camera.position.distanceTo(home)).toBeLessThan(1e-9);
  });

  it('punches in towards the lawn and eases back out', () => {
    const { camera, rig } = framed(16 / 10);
    const home = camera.position.clone();
    const target = new Vector3(5, 0, 2.5);
    rig.punch(0.05, 0.3);
    let closest = home.distanceTo(target);
    for (let i = 0; i < 18; i++) {
      rig.update(1 / 60);
      closest = Math.min(closest, camera.position.distanceTo(target));
    }
    expect(closest).toBeLessThan(home.distanceTo(target) * 0.97);
    settle(rig, 1);
    expect(camera.position.distanceTo(home)).toBeLessThan(1e-9);
  });

  it('leans a little with the mouse without losing the lawn', () => {
    const { camera, rig } = framed(16 / 10);
    const home = camera.position.clone();
    rig.setParallax(1, -1);
    settle(rig, 3);
    const lean = camera.position.distanceTo(home);
    expect(lean).toBeGreaterThan(0.05);
    expect(lean).toBeLessThan(1.5);
    for (const ndc of boxCornersNdc(camera)) {
      expect(Math.abs(ndc.x)).toBeLessThan(0.97);
      expect(ndc.y).toBeGreaterThan(FREE.bottom - 0.03);
      expect(ndc.y).toBeLessThan(FREE.top + 0.03);
    }
    rig.setParallax(0, 0);
    settle(rig, 3);
    expect(camera.position.distanceTo(home)).toBeLessThan(1e-3);
  });

  it('plays the intro from a wider shot and lands exactly on the frame', async () => {
    const { camera, rig } = framed(16 / 10);
    const home = camera.position.clone();
    const homeQuat = camera.quaternion.clone();

    let done = false;
    const intro = rig.playIntro(2).then(() => {
      done = true;
    });
    rig.update(0);
    // The opening shot shows more than the frame does.
    expect(camera.position.distanceTo(home)).toBeGreaterThan(3);
    const span = (points: Vector3[]) => Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    expect(span(boxCornersNdc(camera))).toBeLessThan(1.6);

    settle(rig, 1);
    await Promise.resolve();
    expect(done).toBe(false);

    settle(rig, 1.1);
    await intro;
    expect(done).toBe(true);
    expect(camera.position.distanceTo(home)).toBeLessThan(1e-9);
    expect(camera.quaternion.angleTo(homeQuat)).toBeLessThan(1e-9);
  });

  it('resolves an interrupted intro instead of leaving it hanging', async () => {
    const { rig } = framed(16 / 10);
    const first = rig.playIntro(5);
    const second = rig.playIntro(0.1);
    settle(rig, 0.2);
    await expect(Promise.all([first, second])).resolves.toBeDefined();
  });

  it('orbits towards the winning side', () => {
    for (const [side, sign] of [['plants', -1], ['zombies', 1]] as const) {
      const { camera, rig } = framed(16 / 10);
      const home = camera.position.clone();
      rig.orbitVictory(side);
      settle(rig, 3);
      const early = camera.position.clone();
      expect(Math.sign(early.x - home.x)).toBe(sign);
      // The base it celebrates is in view, in front of the camera.
      const base = new Vector3(side === 'plants' ? -0.9 : 10.9, 0.8, 2.5).project(camera);
      expect(Math.abs(base.x)).toBeLessThan(0.6);
      expect(Math.abs(base.y)).toBeLessThan(0.6);
      // And it keeps moving.
      settle(rig, 1);
      expect(camera.position.distanceTo(early)).toBeGreaterThan(0.01);
    }
  });
});
