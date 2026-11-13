import { DynamicDrawUsage, InstancedMesh, type BufferGeometry, type Material, type Object3D } from 'three';

/** What a batch's copies do with the sun's shadow (default: neither cast nor receive). */
export interface BatchShadows { cast?: boolean; receive?: boolean }

/**
 * Many copies of one shape in one draw call. The pieces it draws stay ordinary objects in the
 * scene graph, posed as before (and kept hidden, so the renderer skips them); each frame the
 * owner hands the batch every piece that should show, between `begin()` and `end()`, and the
 * batch copies their world matrices into one InstancedMesh. Nothing is allocated per frame.
 *
 * Casts and receives no shadow unless asked (`shadows`: then one shadow draw for all the
 * copies). Never frustum-culled: its pieces are spread over the whole lawn, and one bounding
 * sphere for them all would be stale as soon as they move.
 */
export class InstanceBatch {
  readonly mesh: InstancedMesh;
  private n = 0;

  constructor(geometry: BufferGeometry, material: Material, readonly capacity: number, name: string, shadows: BatchShadows = {}) {
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows.cast === true;
    this.mesh.receiveShadow = shadows.receive === true;
  }

  /** How many copies the last `end()` drew. */
  get count(): number {
    return this.mesh.count;
  }

  begin(): void {
    this.n = 0;
  }

  /** Draws `piece` where it stands now; its world matrix must be current. Beyond capacity it is skipped. */
  add(piece: Object3D): void {
    if (this.n >= this.capacity) return;
    this.mesh.setMatrixAt(this.n++, piece.matrixWorld);
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Frees the instance buffer (the geometry and material belong to the owner). */
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}
