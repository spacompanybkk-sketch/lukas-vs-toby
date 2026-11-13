import { Group, Mesh, MeshStandardMaterial } from 'three';
import type { Director, StageLike } from '../app/Stage';
import { envelopeAround } from '../render/gallery';
import { MATTE_PLASTIC } from '../render/look';
import { getModelDef } from '../render/models/registry';
import { PALETTE } from '../render/palette';
import { MAX_LEVEL } from '../render/voxel/palette';
import { ModelInstance } from '../render/voxel/rig';
import type { ClipName, ModelDef } from '../render/voxel/types';
import { BoxBatch } from '../render/world/boxes';
import type { UnitKey } from '../sim/types';

/** Where the turntable stands: the middle of the lawn, inside the sun's shadow box. */
const AT_X = 5;
const AT_Z = 2.5;
/** The pedestal's height and width in tiles. */
const PEDESTAL_H = 0.36;
const PEDESTAL_W = 1.3;
/** Radians a second the turntable turns: slowly. */
export const TURN_SPEED = 0.45;
/** The share of the screen width the picture is moved left by, clear of the panel on the right. */
const SHIFT = 0.2;
/** The camera's near plane while the Almanac shows: a small unit seen close. */
const NEAR = 0.25;

/** The clip the "play" button plays: the ability, else the shot, else the bite (null: none). */
export function actionClip(def: ModelDef): ClipName | null {
  for (const c of ['ability', 'shoot', 'melee'] as const) if (def.clips[c] !== undefined) return c;
  return null;
}

/** The levels a unit's looks can be picked at: one for a `singleLevel` model, else 1 to 5. */
export function levelsOf(def: ModelDef): number[] {
  return def.singleLevel ? [1] : Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);
}

/** A boxy turntable: a stone block, a darker plinth and a grass top. */
function buildPedestal(): Mesh {
  const batch = new BoxBatch();
  batch.boxOn(0, -PEDESTAL_H, 0, PEDESTAL_W + 0.16, 0.1, PEDESTAL_W + 0.16, PALETTE.soilDark, PALETTE.soil);
  batch.boxOn(0, -PEDESTAL_H + 0.1, 0, PEDESTAL_W, PEDESTAL_H - 0.18, PEDESTAL_W, 0x8a929c, 0xa7aeb8);
  batch.boxOn(0, -0.08, 0, PEDESTAL_W + 0.06, 0.08, PEDESTAL_W + 0.06, PALETTE.rimGrass, PALETTE.grassLight);
  const mesh = new Mesh(batch.build(), new MeshStandardMaterial(MATTE_PLASTIC));
  mesh.name = 'almanac-pedestal';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The Almanac's turntable, a director on the app's one stage (one WebGL context; no renderer or
 * canvas of its own, and no lights: the stage's sun, fill and bounce light it). It shows one unit
 * at a level on a boxy pedestal in the middle of the lawn, slowly turning, framed in the left part
 * of the screen. `open` puts it on stage; `close` (or any other director taking the stage) takes
 * everything back out.
 */
export class AlmanacStage implements Director {
  private readonly stage: StageLike;
  private readonly turntable = new Group();
  private pedestal: Mesh | null = null;
  private model: ModelInstance | null = null;
  private key: UnitKey = 'peashooter';
  private level = 1;
  private angle = -0.5;
  private near = 0;
  private offsetFor = '';

  constructor(stage: StageLike) {
    this.stage = stage;
    this.turntable.name = 'almanac';
    this.turntable.position.set(AT_X, PEDESTAL_H, AT_Z);
  }

  get isOpen(): boolean {
    return this.stage.director === this;
  }

  /** The unit on the pedestal now (for tests and tools). */
  get current(): ModelInstance | null {
    return this.model;
  }

  /** Puts the turntable on stage, showing `key` at `level`. */
  open(key: UnitKey = this.key, level = this.level): void {
    if (!this.isOpen) {
      this.stage.show(this);
      this.pedestal = buildPedestal();
      this.turntable.add(this.pedestal);
      this.stage.scene.add(this.turntable);
      this.near = this.stage.camera.near;
      this.stage.camera.near = NEAR;
      this.model = null;
    }
    this.show(key, level);
  }

  close(): void {
    this.stage.release(this);
  }

  /** Shows `key` at `level` (a single-look unit always at 1). */
  show(key: UnitKey, level: number): void {
    const def = getModelDef(key);
    const lv = Math.min(Math.max(1, Math.floor(level)), def.singleLevel ? 1 : MAX_LEVEL);
    const sameUnit = key === this.key;
    this.key = key;
    this.level = lv;
    if (!this.isOpen) return;
    if (this.model && this.model.def.key === def.key && this.model.level === lv) return;
    this.model?.dispose();
    const model = new ModelInstance(def, lv);
    model.play('idle');
    this.turntable.add(model.root);
    this.model = model;
    // Framed on the biggest look, so a higher level is seen to grow; a new unit faces a little forward.
    if (!sameUnit) this.angle = -0.5;
    this.turntable.rotation.y = this.angle;
    const top = def.singleLevel ? 1 : MAX_LEVEL;
    const box = envelopeAround([{ key: def.key, level: top, x: AT_X, z: AT_Z }]);
    // The pedestal fits the unit's footprint, so a small unit (the Bone Minion) is not dwarfed by it.
    const foot = Math.max(box.x[1] - box.x[0], box.z[1] - box.z[0]);
    const scale = Math.min(Math.max((foot + 0.2) / PEDESTAL_W, 0.45), 1.3);
    // Scaled whole (height too), so a small pedestal keeps its shape; the unit stands on its top.
    this.pedestal?.scale.setScalar(scale);
    this.turntable.position.y = PEDESTAL_H * scale;
    const half = Math.max(foot, PEDESTAL_W * scale) / 2;
    this.stage.rig.frameSubject(
      { x: [AT_X - half, AT_X + half], y: [0, PEDESTAL_H * scale + box.y[1]], z: [AT_Z - half, AT_Z + half] },
      { pitchDeg: 14, side: 0.27, top: 0.1, bottom: 0.3 },
    );
    this.offsetFor = '';
  }

  /** Plays the unit's attack or ability once (it then goes back to idle); returns the clip, or null. */
  play(): ClipName | null {
    const model = this.model;
    if (!model) return null;
    const clip = actionClip(model.def);
    if (clip) model.play(clip);
    return clip;
  }

  step(): void {}

  frame(_alpha: number, realDt: number, gameDt: number): void {
    this.angle += TURN_SPEED * (realDt > 0 ? Math.min(realDt, 0.1) : 0);
    this.turntable.rotation.y = this.angle;
    this.model?.update(gameDt);
    this.placeView();
  }

  detach(): void {
    this.model?.dispose();
    this.model = null;
    if (this.pedestal) {
      this.turntable.remove(this.pedestal);
      this.pedestal.geometry.dispose();
      (this.pedestal.material as MeshStandardMaterial).dispose();
      this.pedestal = null;
    }
    this.stage.scene.remove(this.turntable);
    const camera = this.stage.camera;
    camera.clearViewOffset();
    if (this.near > 0) camera.near = this.near;
    camera.updateProjectionMatrix();
    this.stage.rig.frameSubject(null);
    this.offsetFor = '';
  }

  /** Moves the picture left (a view offset), clear of the panel; kept in step with the window size. */
  private placeView(): void {
    const w = this.stage.canvas.clientWidth || window.innerWidth;
    const h = this.stage.canvas.clientHeight || window.innerHeight;
    const camera = this.stage.camera;
    const want = `${w}x${h}`;
    if (this.offsetFor === want && camera.view?.enabled) return;
    this.offsetFor = want;
    camera.setViewOffset(w, h, Math.round(w * SHIFT), 0, w, h);
  }
}
