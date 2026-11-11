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

describe('CameraRig.frameSubject', () => {
  /** A row of models on pads: wide, low and shallow. */
  const ROW = { x: [1.9, 8.1], y: [0, 1.7], z: [1.85, 3.15] } as const;
  const VIEWS: [string, { pitchDeg?: number; yawDeg?: number }][] = [
    ['the lawn angle', {}],
    ['a three-quarter view from the front', { pitchDeg: 20, yawDeg: 38 }],
    ['a view from behind', { pitchDeg: 24, yawDeg: -142 }],
    ['a level side view', { pitchDeg: 4, yawDeg: 0 }],
  ];

  function corners(camera: PerspectiveCamera): Vector3[] {
    const out: Vector3[] = [];
    for (const x of ROW.x) for (const y of ROW.y) for (const z of ROW.z) out.push(new Vector3(x, y, z).project(camera));
    return out;
  }

  it.each(VIEWS)('fits a box inside the margins it is given, as close as it can: %s', (_name, view) => {
    for (const [, aspect] of ASPECTS) {
      const camera = new PerspectiveCamera(50, 1, 0.1, 100);
      const rig = new CameraRig(camera);
      rig.frameLawn(aspect);
      rig.frameSubject(ROW, { ...view, side: 0.04, top: 0.06, bottom: 0.12 });
      const ndc = corners(camera);
      const xs = ndc.map((p) => p.x);
      const ys = ndc.map((p) => p.y);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.92);
      expect(Math.max(...xs)).toBeLessThanOrEqual(0.92);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.76);
      expect(Math.max(...ys)).toBeLessThanOrEqual(0.88);
      for (const p of ndc) {
        expect(p.z).toBeGreaterThan(-1);
        expect(p.z).toBeLessThan(1);
      }
      // It touches the margins on one axis or the other, and sits in the middle of the room
      // left on the other (near enough: corners at different depths do not mirror exactly).
      const touchesSides = Math.max(...xs) > 0.91 && Math.min(...xs) < -0.91;
      const touchesTopAndBottom = Math.max(...ys) > 0.87 && Math.min(...ys) < -0.75;
      expect(touchesSides || touchesTopAndBottom).toBe(true);
      expect(Math.abs(Math.max(...xs) + Math.min(...xs))).toBeLessThan(0.15);
      expect(camera.fov).toBe(30);
    }
  });

  it('looks from the angle it is given', () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    const rig = new CameraRig(camera);
    rig.frameLawn(16 / 10);
    rig.frameSubject(ROW, { pitchDeg: 20, yawDeg: 38 });
    const forward = camera.getWorldDirection(new Vector3());
    expect(MathUtils.radToDeg(Math.asin(-forward.y))).toBeCloseTo(20, 6);
    // Swung towards +X: it stands on the +X side of the box and looks back towards −X.
    expect(MathUtils.radToDeg(Math.atan2(-forward.x, -forward.z))).toBeCloseTo(38, 6);
    expect(camera.position.x).toBeGreaterThan(5);
  });

  it('keeps the subject through a resize and through time, and gives the lawn back exactly', () => {
    const { camera, rig } = framed(16 / 10);
    const lawn = camera.position.clone();
    const lawnQuat = camera.quaternion.clone();

    rig.frameSubject(ROW);
    const row = camera.position.clone();
    expect(row.distanceTo(lawn)).toBeGreaterThan(3);
    // What the renderer does when the window changes shape.
    rig.frameLawn(4 / 3);
    expect(camera.position.distanceTo(lawn)).toBeGreaterThan(3);
    rig.frameLawn(16 / 10);
    settle(rig, 1);
    expect(camera.position.distanceTo(row)).toBeLessThan(1e-9);

    rig.frameSubject(null);
    expect(camera.position.toArray()).toEqual(lawn.toArray());
    expect(camera.quaternion.toArray()).toEqual(lawnQuat.toArray());
  });

  it('leaves the lawn shot exactly where it has always been', () => {
    // Recorded before `frameSubject` existed: the lawn must not move by a hair.
    const recorded: [number, [number, number, number]][] = [
      [4 / 3, [5, 18.90769985574885, 17.543591538176678]],
      [16 / 10, [5, 16.282705676859795, 15.34135023278505]],
      [16 / 9, [5, 14.97020858741526, 14.240229580089235]],
      [21 / 9, [5, 13.210447115293118, 12.763876057970451]],
      [1, [5, 24.157688213526963, 21.94807414895994]],
    ];
    for (const [aspect, position] of recorded) {
      const { camera } = framed(aspect);
      expect(camera.position.toArray()).toEqual(position);
      expect(camera.quaternion.toArray()).toEqual([-0.4383711467890774, 0, 0, 0.898794046299167]);
    }
  });
});
