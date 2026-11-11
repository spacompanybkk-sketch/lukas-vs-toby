import {
  Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3,
  type Camera,
} from 'three';
import { PALETTE } from '../palette';

// Health bars (art bible section 6): 0.6 tile wide above each damaged unit, green, then
// yellow under 50%, red under 25%, with the level as pips on its left end for levels 2 to 5.
// Every bar of every unit is one instanced mesh of camera-facing quads: one draw call.

/** Bar size in tiles. */
const BAR_W = 0.6;
const BAR_H = 0.085;
/** The dark outline round the bar and the pips. */
const EDGE = 0.03;
const PIP = 0.07;
const PIP_GAP = 0.012;
/** Quads per unit at most: outline, track, fill, and an outline and a fill per pip. */
const QUADS_PER_UNIT = 3 + 2 * 5;

/**
 * Basic materials still go through the filmic tone mapper (exposure 2); this brings their
 * colours back to roughly what is asked for on screen and keeps them under the bloom threshold.
 */
const DIM = 0.42;

function tone(hex: string, dim = DIM): Color {
  return new Color(hex).multiplyScalar(dim);
}

const C = {
  edge: tone(PALETTE.outline, 1),
  track: tone('#3A3436', 0.6),
  green: tone('#5BD13D'),
  yellow: tone(PALETTE.petal),
  red: tone(PALETTE.speedRed),
  pips: [tone('#FFFFFF'), tone('#FFF7E3'), tone(PALETTE.levelIron), tone(PALETTE.levelCrystal), tone(PALETTE.levelGold)],
};

const matrix = new Matrix4();
const place = new Vector3();
const size = new Vector3(1, 1, 1);

export class HealthBars {
  readonly mesh: InstancedMesh;
  private readonly material: MeshBasicMaterial;
  private readonly quaternion = new Quaternion();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private count = 0;
  private readonly capacity: number;

  constructor(units = 128) {
    this.capacity = units * QUADS_PER_UNIT;
    this.material = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, fog: false });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), this.material, this.capacity);
    this.mesh.name = 'health-bars';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.setColorAt(0, C.edge);
    this.mesh.instanceColor?.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.count = 0;
  }

  /** Starts a frame's bars, facing `camera`. */
  begin(camera: Camera): void {
    camera.getWorldQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.count = 0;
  }

  /** A bar centred on `at` showing `fraction` of full health, with pips for `level` 2 to 5. */
  add(at: Vector3, fraction: number, level: number): void {
    if (this.count + QUADS_PER_UNIT > this.capacity) return;
    const f = Math.min(1, Math.max(0, fraction));
    this.quad(at, 0, 0, BAR_W + 2 * EDGE, BAR_H + 2 * EDGE, C.edge);
    this.quad(at, 0, 0, BAR_W, BAR_H, C.track);
    if (f > 0) {
      const w = BAR_W * f;
      this.quad(at, -BAR_W / 2 + w / 2, 0, w, BAR_H, f < 0.25 ? C.red : f < 0.5 ? C.yellow : C.green);
    }
    if (level >= 2) {
      const color = C.pips[Math.min(level, 5) - 1] as Color;
      // Pips sit in a row on the bar's left end, just above it, so a row of plants one tile
      // apart never has its pips run into the next bar.
      const dy = BAR_H / 2 + EDGE + PIP / 2 + EDGE - 0.005;
      for (let i = 0; i < level; i++) {
        const dx = -BAR_W / 2 + PIP / 2 + i * (PIP + EDGE + PIP_GAP);
        this.quad(at, dx, dy, PIP + 2 * EDGE, PIP + 2 * EDGE, C.edge);
        this.quad(at, dx, dy, PIP, PIP, color);
      }
    }
  }

  /** Ends the frame: only the quads added since `begin` are drawn. */
  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Quads drawn last frame. */
  get quads(): number {
    return this.count;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }

  private quad(at: Vector3, dx: number, dy: number, w: number, h: number, color: Color): void {
    place.copy(at).addScaledVector(this.right, dx).addScaledVector(this.up, dy);
    size.set(w, h, 1);
    matrix.compose(place, this.quaternion, size);
    this.mesh.setMatrixAt(this.count, matrix);
    this.mesh.setColorAt(this.count, color);
    this.count++;
  }
}
