import { Euler, MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { LAWN_COLS, LAWN_LANES, PLANT_BASE_X, ZOMBIE_BASE_X } from './coords';
import type { Faction } from './types';

const FOV_DEG = 30;
const PITCH = MathUtils.degToRad(52);

/** What must stay on screen: the lawn, both bases and the tallest thing standing on them. */
const FRAME_BOX = { x: [-1.9, 11.9], y: [0, 2.4], z: [-0.3, 5.3] } as const;
/**
 * The part of the screen the HUD leaves free, in NDC: 3% side margins, the top 9% is the
 * top bar and the bottom 22% the card tray. Pulled in by a hair so rounding never puts a
 * corner outside.
 */
const HAIR = 1e-6;
const FREE_X = 1 - 2 * 0.03 - HAIR;
const FREE_TOP = 1 - 2 * 0.09 - HAIR;
const FREE_BOTTOM = 1 - 2 * 0.22 - HAIR;

/** A camera placement: orbiting `pivot` at `distance`, turned by `yaw` and tipped down by `pitch`. */
interface Orbit {
  pivot: Vector3;
  yaw: number;
  pitch: number;
  distance: number;
}

const easeInOutCubic = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOutCubic = (u: number): number => 1 - Math.pow(1 - u, 3);

/** Smooth, repeatable wobble in −1..1 for the shake (no random numbers, so replays match). */
const wobble = (t: number, seed: number): number =>
  (Math.sin(t * 61.7 + seed) + 0.6 * Math.sin(t * 97.3 + seed * 2.3) + 0.3 * Math.sin(t * 151.1 + seed * 4.1)) / 1.9;

const euler = new Euler(0, 0, 0, 'YXZ');
const scratch = new Vector3();

/** Frames the lawn for any window shape and layers intro, parallax, punch, shake and the victory orbit on top. */
export class CameraRig {
  private readonly camera: PerspectiveCamera;

  /** The framed shot every motion starts from and returns to. */
  private readonly home: Orbit = { pivot: new Vector3(), yaw: 0, pitch: PITCH, distance: 30 };
  private readonly pose: Orbit = { pivot: new Vector3(), yaw: 0, pitch: PITCH, distance: 30 };

  private parallaxTarget = { x: 0, y: 0 };
  private parallax = { x: 0, y: 0 };

  private shakeStrength = 0;
  private shakeSeconds = 0;
  private shakeLeft = 0;
  private shakeClock = 0;

  private punchAmount = 0;
  private punchSeconds = 0;
  private punchLeft = 0;

  private introSeconds = 0;
  private introLeft = 0;
  private introDone: (() => void) | null = null;

  private victory: Faction | null = null;
  private victoryClock = 0;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
    this.frameLawn(camera.aspect);
  }

  /**
   * Sets the camera for a window of this aspect ratio: field of view 30°, pitched 52° down,
   * no yaw, as close as it can be with the whole frame box inside the HUD-free rectangle.
   */
  frameLawn(aspect: number): void {
    const camera = this.camera;
    camera.fov = FOV_DEG;
    camera.aspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
    camera.updateProjectionMatrix();

    const tanY = Math.tan(MathUtils.degToRad(FOV_DEG) / 2);
    const tanX = tanY * camera.aspect;
    // Camera axes at this pitch: right is +X, `up` and `fwd` lie in the YZ plane.
    const upY = Math.cos(PITCH);
    const upZ = -Math.sin(PITCH);
    const fwdY = -Math.sin(PITCH);
    const fwdZ = -Math.cos(PITCH);

    // Work relative to the box centre: the camera sits at centre − fwd·D + up·s. A corner
    // then has view x = a, view y = b − s and depth d + D, so every screen-edge limit is
    // linear in D and s.
    const cx = (FRAME_BOX.x[0] + FRAME_BOX.x[1]) / 2;
    const cy = (FRAME_BOX.y[0] + FRAME_BOX.y[1]) / 2;
    const cz = (FRAME_BOX.z[0] + FRAME_BOX.z[1]) / 2;
    const corners: { a: number; b: number; d: number }[] = [];
    for (const x of FRAME_BOX.x) {
      for (const y of FRAME_BOX.y) {
        for (const z of FRAME_BOX.z) {
          corners.push({
            a: x - cx,
            b: (y - cy) * upY + (z - cz) * upZ,
            d: (y - cy) * fwdY + (z - cz) * fwdZ,
          });
        }
      }
    }

    // Smallest D that fits the sides …
    let distance = 0;
    for (const c of corners) distance = Math.max(distance, Math.abs(c.a) / (FREE_X * tanX) - c.d);
    // … and that leaves some s with every corner between the top bar and the tray.
    for (const hi of corners) {
      for (const lo of corners) {
        const need =
          (hi.b - lo.b - FREE_TOP * tanY * hi.d - FREE_BOTTOM * tanY * lo.d) / ((FREE_TOP + FREE_BOTTOM) * tanY);
        distance = Math.max(distance, need);
      }
    }
    // Centre the box in whatever vertical room is left.
    let sMin = -Infinity;
    let sMax = Infinity;
    for (const c of corners) {
      sMin = Math.max(sMin, c.b - FREE_TOP * tanY * (c.d + distance));
      sMax = Math.min(sMax, c.b + FREE_BOTTOM * tanY * (c.d + distance));
    }
    const s = (sMin + sMax) / 2;

    const eyeY = cy - fwdY * distance + upY * s;
    const eyeZ = cz - fwdZ * distance + upZ * s;
    // Store the shot as an orbit around the point on the ground the camera looks at.
    const reach = eyeY / Math.sin(PITCH);
    this.home.pivot.set(cx, 0, eyeZ + fwdZ * reach);
    this.home.yaw = 0;
    this.home.pitch = PITCH;
    this.home.distance = reach;

    this.apply();
  }

  /** Mouse position across the window, −1..1 on each axis; the camera leans a little towards it. */
  setParallax(nx: number, ny: number): void {
    this.parallaxTarget.x = Number.isFinite(nx) ? MathUtils.clamp(nx, -1, 1) : 0;
    this.parallaxTarget.y = Number.isFinite(ny) ? MathUtils.clamp(ny, -1, 1) : 0;
  }

  /** Shakes the picture; `strength` 1 is a heavy blow. Fades out over `seconds`. */
  shake(strength: number, seconds: number): void {
    if (!(strength > 0) || !(seconds > 0)) return;
    const current = this.shakeSeconds > 0 ? this.shakeStrength * (this.shakeLeft / this.shakeSeconds) ** 2 : 0;
    if (strength < current) return;
    this.shakeStrength = strength;
    this.shakeSeconds = seconds;
    this.shakeLeft = seconds;
  }

  /** A brief zoom towards the lawn: `amount` is the share of the distance, 0.04 is plenty. */
  punch(amount: number, seconds: number): void {
    if (!(amount > 0) || !(seconds > 0)) return;
    this.punchAmount = amount;
    this.punchSeconds = seconds;
    this.punchLeft = seconds;
  }

  /** Starts from a wide establishing shot and eases into the frame; resolves when it lands. */
  playIntro(seconds: number): Promise<void> {
    this.finishIntro();
    if (!(seconds > 0)) return Promise.resolve();
    this.introSeconds = seconds;
    this.introLeft = seconds;
    const done = new Promise<void>((resolve) => {
      this.introDone = resolve;
    });
    this.apply();
    return done;
  }

  /** Swings round to the winner's base and keeps drifting about it. */
  orbitVictory(side: Faction): void {
    this.finishIntro();
    this.victory = side;
    this.victoryClock = 0;
  }

  update(dtSeconds: number): void {
    const dt = dtSeconds > 0 ? Math.min(dtSeconds, 0.25) : 0;

    const follow = 1 - Math.exp(-dt * 5);
    this.parallax.x += (this.parallaxTarget.x - this.parallax.x) * follow;
    this.parallax.y += (this.parallaxTarget.y - this.parallax.y) * follow;
    if (Math.abs(this.parallax.x) < 1e-7 && this.parallaxTarget.x === 0) this.parallax.x = 0;
    if (Math.abs(this.parallax.y) < 1e-7 && this.parallaxTarget.y === 0) this.parallax.y = 0;

    this.shakeClock += dt;
    this.shakeLeft = Math.max(0, this.shakeLeft - dt);
    this.punchLeft = Math.max(0, this.punchLeft - dt);
    if (this.victory) this.victoryClock += dt;

    if (this.introDone) {
      this.introLeft = Math.max(0, this.introLeft - dt);
      if (this.introLeft === 0) this.finishIntro();
    }

    this.apply();
  }

  private finishIntro(): void {
    this.introLeft = 0;
    const done = this.introDone;
    this.introDone = null;
    done?.();
  }

  /** Writes the camera transform for the current state. */
  private apply(): void {
    const { home, pose, camera } = this;
    pose.pivot.copy(home.pivot);
    pose.yaw = home.yaw;
    pose.pitch = home.pitch;
    pose.distance = home.distance;

    if (this.introDone) {
      // 1 at the opening shot, 0 on the frame.
      const k = 1 - easeInOutCubic(1 - this.introLeft / this.introSeconds);
      pose.yaw += MathUtils.degToRad(-24) * k;
      pose.pitch += MathUtils.degToRad(-22) * k;
      pose.distance *= 1 + 0.8 * k;
      pose.pivot.y -= 1.2 * k;
    }

    if (this.victory) {
      const sign = this.victory === 'plants' ? -1 : 1;
      const range = this.victory === 'plants' ? PLANT_BASE_X : ZOMBIE_BASE_X;
      const k = easeInOutCubic(Math.min(this.victoryClock / 1.8, 1));
      // Look at the base from the lawn side and sway about it.
      const yaw = -sign * MathUtils.degToRad(12 + 9 * Math.sin(this.victoryClock * 0.5));
      scratch.set((range[0] + range[1]) / 2, 0.7, LAWN_LANES / 2);
      pose.pivot.lerp(scratch, k);
      pose.yaw = MathUtils.lerp(pose.yaw, yaw, k);
      pose.pitch = MathUtils.lerp(pose.pitch, MathUtils.degToRad(34), k);
      pose.distance = MathUtils.lerp(pose.distance, home.distance * (LAWN_COLS / 18), k);
    }

    pose.yaw += MathUtils.degToRad(1.4) * this.parallax.x;
    pose.pitch += MathUtils.degToRad(0.7) * this.parallax.y;

    if (this.punchLeft > 0) {
      const u = 1 - this.punchLeft / this.punchSeconds;
      const swell = u < 0.25 ? easeOutCubic(u / 0.25) : 1 - easeInOutCubic((u - 0.25) / 0.75);
      pose.distance *= 1 - this.punchAmount * swell;
    }

    euler.set(-pose.pitch, pose.yaw, 0);
    camera.quaternion.setFromEuler(euler);
    // Back away from the pivot along the view direction.
    camera.position.set(0, 0, pose.distance).applyQuaternion(camera.quaternion).add(pose.pivot);

    if (this.shakeLeft > 0) {
      const fade = (this.shakeLeft / this.shakeSeconds) ** 2;
      const reach = 0.16 * this.shakeStrength * fade;
      scratch.set(wobble(this.shakeClock, 1.3) * reach, wobble(this.shakeClock, 7.9) * reach, 0);
      camera.position.add(scratch.applyQuaternion(camera.quaternion));
    }

    camera.updateMatrixWorld(true);
  }
}
