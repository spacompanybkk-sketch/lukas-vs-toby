import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Sprite,
  SpriteMaterial,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Object3D,
} from 'three';
import { PALETTE } from '../palette';
import { BoxBatch, hash2, seededRandom } from '../world/boxes';
import { FX } from './fxPalette';
import type { Particles } from './Particles';

// The effects library: bursts, debris, sparks, explosions, rings, sparkles, auras, smoke,
// trails and floating numbers. Everything keeps the voxel grain: particles are cubes from
// the shared pool, flashes are stepped voxel balls and plates, rings are rings of blocks,
// and numbers are drawn pixel-crisp. Effects run on game time, so slow motion slows them.

const hex = (color: string): number => parseInt(color.slice(1), 16);

const C = {
  spark: hex(PALETTE.hitSpark),
  fire: hex(PALETTE.fire),
  fireLight: hex(PALETTE.fireLight),
  core: hex(FX.core),
  ember: hex(FX.ember),
  soil: hex(PALETTE.soil),
  soilDark: hex(PALETTE.soilDark),
  grassDark: hex(PALETTE.grassDark),
  stoneDark: hex(PALETTE.stoneDark),
  iron: hex(PALETTE.levelIron),
  ironDark: hex(PALETTE.levelIronDark),
  white: 0xffffff,
  puff: hex(FX.puff),
  smoke: hex(FX.smoke),
  smokeDark: hex(FX.smokeDark),
  smokeLight: hex(FX.smokeLight),
} as const;

/** How many of each pooled shape can show at once. The oldest gives way when they run out. */
const FLASHES = 12;
const RINGS = 8;
const TEXTS = 20;
/** Particles per second for the effects that are called every frame. */
const AURA_RATE = 7;
const TRAIL_RATE = 45;
/** Floating numbers: how far they rise, how long they take, how tall they stand (tiles). */
const TEXT_RISE = 0.6;
const TEXT_SECONDS = 0.8;
const TEXT_HEIGHT = 0.34;
/** Pixels on the canvas a number is drawn on: kept small and scaled up without smoothing, so it is pixel-crisp. */
const TEXT_CANVAS = { width: 96, height: 32, font: 22 } as const;

// ---- Shapes ----------------------------------------------------------------------------

/**
 * A ball of voxels, radius 1: the centre of a flash. Lower cells are darker, so it has a
 * top and an underside. A `shell` keeps only the outer layer, with gaps, so what burns
 * inside it shows through.
 */
function voxelBall(shell = false): BufferGeometry {
  const batch = new BoxBatch();
  const n = 4;
  const cell = 1 / n;
  const inside = (i: number, j: number, k: number): boolean => {
    const d = Math.sqrt((i + 0.5) ** 2 + (j + 0.5) ** 2 + (k + 0.5) ** 2);
    if (d > n + 0.25) return false;
    if (!shell) return true;
    return d > n - 1.2 && hash2(i * 7 + k, j * 13 - k, 7) > 0.62;
  };
  const shades = [0.42, 0.52, 0.62, 0.72, 0.82, 0.9, 1, 1].map((v) => new Color(v, v * 0.97, v * 0.92));
  batch.voxels(cell, [-n, -n, -n], [n - 1, n - 1, n - 1], inside, (_i, j) => shades[j + n] as Color);
  return batch.build();
}

/** A rounded square plate of voxels facing +Z, radius 1: a shield block lighting up. */
function voxelPlate(): BufferGeometry {
  const batch = new BoxBatch();
  const n = 4;
  const cell = 1 / n;
  const inside = (i: number, j: number, k: number): boolean =>
    k === 0 && Math.max(Math.abs(i + 0.5), Math.abs(j + 0.5)) <= n && Math.abs(i + 0.5) + Math.abs(j + 0.5) <= n * 1.5;
  const rim = new Color(0.45, 0.48, 0.55);
  const middle = new Color(1, 1, 1);
  batch.voxels(cell, [-n, -n, 0], [n - 1, n - 1, 0], inside, (i, j) =>
    Math.abs(i + 0.5) + Math.abs(j + 0.5) > n * 1.1 ? rim : middle,
  );
  return batch.build();
}

/**
 * A flat ring of blocks, radius 1, lying on the ground: cells of a grid whose centres fall
 * in a band just inside the circle, so the ring is stepped like everything else. The tops
 * are bright and the sides dimmer.
 */
function steppedRing(): BufferGeometry {
  const batch = new BoxBatch();
  const cell = 1 / 9;
  const n = 10;
  const top = new Color(1, 1, 1);
  const side = new Color(0.6, 0.6, 0.6);
  for (let i = -n; i < n; i++) {
    for (let k = -n; k < n; k++) {
      const d = Math.hypot((i + 0.5) * cell, (k + 0.5) * cell);
      if (d > 1 || d < 1 - cell * 1.6) continue;
      batch.box(i * cell, 0, k * cell, cell, cell * 0.7, cell, side, top);
    }
  }
  return batch.build();
}

// ---- Pools -----------------------------------------------------------------------------

interface Flash {
  mesh: Mesh;
  material: MeshBasicMaterial;
  color: Color;
  /** Brightness at the peak; above 1 so it blooms. */
  peak: number;
  age: number;
  /** Seconds to swell, then seconds to shrink away. */
  grow: number;
  fade: number;
  from: number;
  to: number;
  active: boolean;
}

interface Ring {
  mesh: Mesh;
  material: MeshBasicMaterial;
  color: Color;
  age: number;
  duration: number;
  radius: number;
  active: boolean;
}

interface FloatingText {
  sprite: Sprite;
  material: SpriteMaterial;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: CanvasTexture;
  start: Vector3;
  age: number;
  active: boolean;
}

/** Makes a 2D canvas context, or null where there is none (tests run in node). */
function canvas2d(): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = TEXT_CANVAS.width;
    canvas.height = TEXT_CANVAS.height;
    const context = canvas.getContext('2d');
    if (!context || typeof context.fillText !== 'function' || typeof context.getImageData !== 'function') return null;
    return { canvas, context };
  } catch {
    return null;
  }
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const at = new Vector3();
const velocity = new Vector3();
const toCamera = new Vector3();
const centre = new Vector3();

export class Effects {
  readonly group = new Group();

  private readonly particles: Particles;
  private readonly random: () => number;
  private readonly ball = voxelBall();
  private readonly shell = voxelBall(true);
  private readonly plate = voxelPlate();
  private readonly ringShape = steppedRing();
  private readonly flashes: Flash[] = [];
  private readonly rings: Ring[] = [];
  private readonly texts: FloatingText[] = [];
  /** Particles owed to each object that has an aura or a trail, between frames. */
  private readonly owed = new WeakMap<Object3D, number>();
  private nextFlash = 0;
  private nextRing = 0;
  private nextText = 0;
  /** The last frame's game time step, for the effects that are called once a frame. */
  private lastDt = 0;

  constructor(particles: Particles, random: () => number = seededRandom(0x5eed)) {
    this.particles = particles;
    this.random = random;
    this.group.name = 'effects';

    for (let i = 0; i < FLASHES; i++) {
      const material = new MeshBasicMaterial({ vertexColors: true, toneMapped: true });
      const mesh = new Mesh(this.ball, material);
      mesh.name = 'flash';
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.flashes.push({ mesh, material, color: new Color(), peak: 1, age: 0, grow: 0, fade: 0, from: 0, to: 0, active: false });
    }
    for (let i = 0; i < RINGS; i++) {
      const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
      const mesh = new Mesh(this.ringShape, material);
      mesh.name = 'ring';
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.rings.push({ mesh, material, color: new Color(), age: 0, duration: 0, radius: 1, active: false });
    }
    for (let i = 0; i < TEXTS; i++) {
      const drawn = canvas2d();
      if (!drawn) break;
      const texture = new CanvasTexture(drawn.canvas);
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestFilter;
      texture.generateMipmaps = false;
      // Dimmed so the tone mapper shows the colour asked for instead of washing it out: unlit,
      // it would otherwise sit far above anything sunlight reaches.
      const material = new SpriteMaterial({ map: texture, color: 0xbdbdbd, transparent: true, depthTest: false, depthWrite: false });
      const sprite = new Sprite(material);
      sprite.name = 'float-text';
      sprite.visible = false;
      sprite.renderOrder = 10;
      this.group.add(sprite);
      this.texts.push({ sprite, material, ...drawn, texture, start: new Vector3(), age: 0, active: false });
    }
  }

  // ---- Particle effects ----------------------------------------------------------------

  /** `count` cubes in the given colours flung up and out at about `speed` tiles a second. */
  burst(at: Vector3, colors: number[], count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      this.upward(0.25, speed * this.between(0.5, 1));
      this.emit(at, this.pick(colors), this.between(0.045, 0.08), this.between(0.5, 0.9), 9, 0.35);
    }
  }

  /**
   * A unit breaking up into cubes of its own colours (`colors` most plentiful first, as
   * `modelColors` gives them): more and bigger cubes at higher levels, falling with a
   * bounce, and a small puff.
   */
  debris(at: Vector3, colors: number[], level: number): void {
    const count = 12 + 4 * level;
    const scale = 1 + 0.08 * (level - 1);
    for (let i = 0; i < count; i++) {
      this.upward(0.35, this.between(1.4, 3.1));
      const pick = Math.floor(this.random() ** 1.6 * colors.length);
      const color = colors[Math.min(colors.length - 1, pick)] ?? C.stoneDark;
      this.emit(this.jitter(at, 0.12, 0.25), color, this.between(0.055, 0.105) * scale, this.between(0.9, 1.3), 10, 0.4);
    }
    this.puff(at);
  }

  /** Soil thrown up from the lawn: a plant coming up, a zombie clawing out. */
  dirt(at: Vector3): void {
    const colors = [C.soil, C.soil, C.soilDark, C.grassDark];
    for (let i = 0; i < 14; i++) {
      this.upward(0.55, this.between(1, 2.2));
      this.emit(this.jitter(at, 0.15, 0), this.pick(colors), this.between(0.04, 0.075), this.between(0.5, 0.8), 9, 0.25);
    }
  }

  /** A small cloud of cubes that swell and drift up. */
  puff(at: Vector3, color: number = C.puff): void {
    const colors = [color, C.smokeLight, C.smokeLight];
    for (let i = 0; i < 9; i++) {
      const angle = this.random() * Math.PI * 2;
      const out = this.between(0.5, 1);
      velocity.set(Math.cos(angle) * out, this.between(0.3, 0.6), Math.sin(angle) * out);
      this.emit(this.jitter(at, 0.08, 0.1), this.pick(colors), this.between(0.06, 0.11), this.between(0.45, 0.7), -0.4, undefined, false, 1, 0.3);
    }
  }

  /** A projectile landing: a quick hot flash and a spray of tiny sparks. */
  spark(at: Vector3): void {
    this.flash(at, this.ball, C.spark, 3.2, 0.04, 0.12, 0.05, 0.17);
    for (let i = 0; i < 7; i++) {
      this.direction(0.6);
      velocity.multiplyScalar(this.between(2.5, 4));
      this.emit(at, this.random() < 0.6 ? C.spark : C.fireLight, this.between(0.03, 0.05), this.between(0.15, 0.3), 6, undefined, true, 0, 0);
    }
  }

  /** A shot stopped by a shield: a plate of iron light and a few chips of metal. */
  blockFlash(at: Vector3): void {
    const slot = this.flash(at, this.plate, C.iron, 1.5, 0.05, 0.16, 0.1, 0.26);
    this.flash(at, this.ball, C.white, 2.5, 0.03, 0.1, 0.03, 0.08);
    slot.mesh.userData.facesCamera = true;
    for (let i = 0; i < 8; i++) {
      this.direction(0.3);
      velocity.multiplyScalar(this.between(2, 3.5));
      this.emit(at, this.random() < 0.5 ? C.white : C.iron, this.between(0.03, 0.045), this.between(0.15, 0.28), 5, undefined, true, 0, 0);
    }
    for (let i = 0; i < 4; i++) {
      this.upward(0.4, this.between(1, 1.8));
      this.emit(at, this.random() < 0.5 ? C.iron : C.ironDark, this.between(0.04, 0.06), this.between(0.6, 0.9), 9, 0.4);
    }
  }

  /**
   * A blast `radius` tiles across: a white-hot core swelling inside a ball of fire, a
   * shockwave ring along the ground, burning cubes and clods thrown out, and smoke.
   */
  explosion(at: Vector3, radius: number): void {
    const r = Math.max(0.3, radius);
    centre.copy(at).setY(at.y + 0.25 * r);
    this.flash(centre, this.ball, C.core, 4, 0.09, 0.2, 0.25 * r, 0.5 * r);
    this.flash(centre, this.shell, C.ember, 1.5, 0.14, 0.26, 0.3 * r, 0.72 * r);
    this.ring(at, C.fireLight, r);

    const hot = [C.fire, C.fireLight, C.ember, C.core];
    for (let i = 0; i < 20; i++) {
      this.upward(0.2, this.between(2.2, 4.6) * Math.sqrt(r));
      this.emit(this.jitter(centre, 0.15 * r, 0.1), this.pick(hot), this.between(0.05, 0.09), this.between(0.35, 0.7), 8, undefined, true, 0, 1.5);
    }
    const clods = [C.soil, C.soilDark, C.stoneDark, C.grassDark];
    for (let i = 0; i < 14; i++) {
      this.upward(0.45, this.between(1.8, 3.6) * Math.sqrt(r));
      this.emit(this.jitter(at, 0.2 * r, 0.05), this.pick(clods), this.between(0.06, 0.11), this.between(1, 1.4), 10, 0.35);
    }
    const smoke = [C.smokeLight, C.puff, C.smoke];
    for (let i = 0; i < 10; i++) {
      const angle = this.random() * Math.PI * 2;
      const out = this.between(0.3, 0.9) * r;
      velocity.set(Math.cos(angle) * out, this.between(0.4, 0.9), Math.sin(angle) * out);
      this.emit(this.jitter(centre, 0.25 * r, 0.15), this.pick(smoke), this.between(0.13, 0.22), this.between(1, 1.6), -0.3, undefined, false, 0.7, 0.25);
    }
  }

  /** A shockwave: a stepped ring of light that runs out along the ground to `radius` and fades. */
  ring(at: Vector3, color: number, radius: number): void {
    const slot = this.rings[this.nextRing] as Ring;
    this.nextRing = (this.nextRing + 1) % RINGS;
    slot.active = true;
    slot.age = 0;
    slot.duration = 0.42;
    slot.radius = Math.max(0.1, radius);
    slot.color.setHex(color);
    slot.mesh.position.set(at.x, Math.max(0.01, at.y + 0.01), at.z);
    slot.mesh.visible = true;
    this.applyRing(slot);
  }

  /** A merge: sparks of the level's colour rising round a unit in a swirl. */
  sparkles(at: Vector3, color: number): void {
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + this.random() * 0.3;
      const reach = this.between(0.2, 0.38);
      const swirl = this.between(0.5, 0.9);
      velocity.set(-Math.sin(angle) * swirl, this.between(0.9, 1.7), Math.cos(angle) * swirl);
      const start = this.jitter(at, 0, 0);
      start.x += Math.cos(angle) * reach;
      start.z += Math.sin(angle) * reach;
      start.y += this.between(0.05, 0.4);
      this.emit(start, i % 4 === 0 ? C.white : color, this.between(0.035, 0.06), this.between(0.6, 1), 1.2, undefined, true, 0, 0);
    }
  }

  /** Level 5: motes of `color` drifting up round `target`. Call once a frame. */
  aura(target: Object3D, color: number): void {
    let owed = (this.owed.get(target) ?? 0) + this.lastDt * AURA_RATE;
    if (owed < 1) {
      this.owed.set(target, owed);
      return;
    }
    target.getWorldPosition(toCamera);
    while (owed >= 1) {
      owed -= 1;
      const angle = this.random() * Math.PI * 2;
      const start = this.jitter(toCamera, 0, 0);
      start.x += Math.cos(angle) * 0.32;
      start.z += Math.sin(angle) * 0.32;
      start.y += this.between(0.1, 0.85);
      velocity.set(0, this.between(0.35, 0.6), 0);
      this.emit(start, color, this.between(0.035, 0.05), this.between(0.9, 1.3), 0, undefined, true, 0, 0.5);
    }
    this.owed.set(target, owed);
  }

  /** Smoke from a burning base: a couple of grey cubes that swell as they rise. Call a few times a second. */
  smoke(at: Vector3): void {
    const colors = [C.smoke, C.smokeLight, C.smokeLight, C.smokeDark];
    for (let i = 0; i < 2; i++) {
      velocity.set(this.between(0.05, 0.22), this.between(0.35, 0.55), this.between(-0.08, 0.08));
      this.emit(this.jitter(at, 0.06, 0.05), this.pick(colors), this.between(0.06, 0.1), this.between(1.2, 1.7), -0.25, undefined, false, 0.7, 0.25);
    }
  }

  /** A short trail of cubes behind a projectile. Call once a frame while it flies. */
  trail(obj: Object3D, color: number): void {
    let owed = (this.owed.get(obj) ?? 0) + this.lastDt * TRAIL_RATE;
    if (owed >= 1) obj.getWorldPosition(toCamera);
    while (owed >= 1) {
      owed -= 1;
      velocity.set(0, this.between(-0.05, 0.1), 0);
      const shade = this.random() < 0.35 ? C.white : color;
      this.emit(this.jitter(toCamera, 0.025, 0.025), shade, this.between(0.045, 0.07), this.between(0.16, 0.26), 0, undefined, false, 0, 0);
    }
    this.owed.set(obj, owed);
  }

  /**
   * A number or short word that rises 0.6 tile over 0.8 s and fades, in `color` (CSS) with
   * a dark outline. Does nothing where there is no 2D canvas (tests in node).
   */
  floatText(at: Vector3, text: string, color: string): void {
    if (this.texts.length === 0) return;
    const slot = this.texts[this.nextText] as FloatingText;
    this.nextText = (this.nextText + 1) % this.texts.length;
    const { context } = slot;
    const { width, height, font } = TEXT_CANVAS;
    context.clearRect(0, 0, width, height);
    context.font = `${font}px 'Lilita One', system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'miter';
    context.lineWidth = 5;
    context.strokeStyle = PALETTE.outline;
    context.fillStyle = color;
    const shown = text.slice(0, 8);
    context.strokeText(shown, width / 2, height / 2 + 1);
    context.fillText(shown, width / 2, height / 2 + 1);
    // Hard edges: every pixel either shows or does not, so the number is pixel-crisp.
    const image = context.getImageData(0, 0, width, height);
    const data = image.data;
    for (let i = 3; i < data.length; i += 4) data[i] = (data[i] as number) >= 110 ? 255 : 0;
    context.putImageData(image, 0, 0);
    slot.texture.needsUpdate = true;
    const used = Math.min(width, context.measureText(shown).width + 12);
    slot.texture.repeat.set(used / width, 1);
    slot.texture.offset.set((1 - used / width) / 2, 0);
    slot.sprite.scale.set((TEXT_HEIGHT * used) / height, TEXT_HEIGHT, 1);
    slot.start.copy(at);
    slot.age = 0;
    slot.active = true;
    slot.sprite.visible = true;
    slot.material.opacity = 1;
    slot.sprite.position.copy(at);
  }

  /** Moves every flash, ring and floating number on by `dtSeconds` of game time. The particles update on their own. */
  update(dtSeconds: number, camera: Camera): void {
    const dt = Math.max(0, dtSeconds);
    this.lastDt = dt;
    for (const slot of this.flashes) {
      if (!slot.active) continue;
      slot.age += dt;
      this.applyFlash(slot, camera);
    }
    for (const slot of this.rings) {
      if (!slot.active) continue;
      slot.age += dt;
      this.applyRing(slot);
    }
    for (const slot of this.texts) {
      if (!slot.active) continue;
      slot.age += dt;
      const t = Math.min(1, slot.age / TEXT_SECONDS);
      slot.sprite.position.set(slot.start.x, slot.start.y + TEXT_RISE * easeOutCubic(t), slot.start.z);
      slot.material.opacity = t < 0.5 ? 1 : 1 - ((t - 0.5) / 0.5) ** 2;
      if (t >= 1) {
        slot.active = false;
        slot.sprite.visible = false;
      }
    }
  }

  /** Stops every effect at once (a scene being reset). Particles are cleared separately. */
  clear(): void {
    for (const slot of this.flashes) (slot.active = false), (slot.mesh.visible = false);
    for (const slot of this.rings) (slot.active = false), (slot.mesh.visible = false);
    for (const slot of this.texts) (slot.active = false), (slot.sprite.visible = false);
    this.lastDt = 0;
  }

  /** Frees the shapes, materials and canvases. Take `group` out of the scene first. */
  dispose(): void {
    this.ball.dispose();
    this.shell.dispose();
    this.plate.dispose();
    this.ringShape.dispose();
    for (const slot of this.flashes) slot.material.dispose();
    for (const slot of this.rings) slot.material.dispose();
    for (const slot of this.texts) {
      slot.material.dispose();
      slot.texture.dispose();
    }
  }

  // ---- Helpers -------------------------------------------------------------------------

  private between(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  private pick(colors: readonly number[]): number {
    return colors[Math.floor(this.random() * colors.length)] ?? C.white;
  }

  /** A point near `p`: up to `spread` tiles sideways and `lift` tiles up. Shared scratch vector. */
  private jitter(p: Vector3, spread: number, lift: number): Vector3 {
    return at.set(p.x + (this.random() - 0.5) * 2 * spread, p.y + this.random() * lift, p.z + (this.random() - 0.5) * 2 * spread);
  }

  /** Sets `velocity` to a random direction no lower than `minUp` above the ground, times `speed`. */
  private upward(minUp: number, speed: number): void {
    const angle = this.random() * Math.PI * 2;
    const up = minUp + (1 - minUp) * this.random();
    const flat = Math.sqrt(1 - up * up);
    velocity.set(Math.cos(angle) * flat * speed, up * speed, Math.sin(angle) * flat * speed);
  }

  /** Sets `velocity` to a random unit direction, at least `minUp` upwards. */
  private direction(minUp: number): void {
    this.upward(Math.max(-1, Math.min(1, minUp)), 1);
  }

  private emit(
    position: Vector3,
    color: number,
    size: number,
    life: number,
    gravity: number,
    bounce?: number,
    emissive = false,
    grow = 0,
    spin = 1,
  ): void {
    this.particles.emit({ position, velocity, color, size, life, gravity, bounce, emissive, grow, spin });
  }

  private flash(
    p: Vector3,
    shape: BufferGeometry,
    color: number,
    peak: number,
    grow: number,
    fade: number,
    from: number,
    to: number,
  ): Flash {
    const slot = this.flashes[this.nextFlash] as Flash;
    this.nextFlash = (this.nextFlash + 1) % FLASHES;
    slot.mesh.geometry = shape;
    slot.mesh.userData.facesCamera = false;
    slot.mesh.rotation.set(0, 0, 0);
    slot.mesh.position.copy(p);
    slot.color.setHex(color);
    slot.peak = peak;
    slot.age = 0;
    slot.grow = grow;
    slot.fade = fade;
    slot.from = from;
    slot.to = to;
    slot.active = true;
    slot.mesh.visible = true;
    this.applyFlash(slot, null);
    return slot;
  }

  private applyFlash(slot: Flash, camera: Camera | null): void {
    const { age, grow, fade } = slot;
    if (age >= grow + fade) {
      slot.active = false;
      slot.mesh.visible = false;
      return;
    }
    let scale: number;
    let bright: number;
    if (age < grow) {
      const t = easeOutCubic(age / grow);
      scale = slot.from + (slot.to - slot.from) * t;
      bright = 1;
    } else {
      const t = (age - grow) / fade;
      scale = slot.to * (1 - t * t * t);
      bright = 1 - t * 0.6;
    }
    slot.mesh.scale.setScalar(Math.max(1e-3, scale));
    slot.material.color.copy(slot.color).multiplyScalar(slot.peak * bright);
    if (camera && slot.mesh.userData.facesCamera) {
      // A plate turns to face the camera across the ground, so it never shows edge on.
      toCamera.copy(camera.position).sub(slot.mesh.position);
      slot.mesh.rotation.set(0, Math.atan2(toCamera.x, toCamera.z), 0);
    }
  }

  private applyRing(slot: Ring): void {
    const t = slot.age / slot.duration;
    if (t >= 1) {
      slot.active = false;
      slot.mesh.visible = false;
      return;
    }
    const radius = slot.radius * (0.2 + 0.8 * easeOutCubic(Math.min(1, t * 1.4)));
    slot.mesh.scale.set(radius, Math.max(0.05, 1 - t) * 1.4, radius);
    slot.material.color.copy(slot.color).multiplyScalar(2.6);
    slot.material.opacity = 1 - t * t;
  }
}
