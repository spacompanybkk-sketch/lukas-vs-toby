import {
  DirectionalLight,
  FloatType,
  HemisphereLight,
  NearestFilter,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { factionOf } from '../data/units';
import type { UnitKey } from '../sim/types';
import { CameraRig } from './CameraRig';
import { envelopeAround } from './gallery';
import { EXPOSURE } from './look';
import { getModelDef } from './models/registry';
import type { Renderer } from './Renderer';
import { ModelInstance } from './voxel/rig';

/** Draws one unit's card portrait, `size` CSS pixels square, as a data URL. */
export type PortraitPainter = (key: UnitKey, size: number) => string | Promise<string>;

let painter: PortraitPainter | null = null;
/** One entry per key and size for the whole session; a request in flight is shared. */
const cache = new Map<string, Promise<string>>();

/** Sets what draws portraits (the game's renderer, or a fake in tests) and forgets the cache. */
export function setPortraitPainter(p: PortraitPainter | null): void {
  painter = p;
  cache.clear();
}

/**
 * Card portraits rendered from the real models, as data URLs with transparent backgrounds. Each
 * key and size is drawn once per session. `onEach` hears each one as soon as it is drawn, so the
 * cards fill in one by one rather than all at the end. A portrait that fails is tried once more
 * at once (a lost frame, a busy context); one that fails again is left out, so its card keeps its
 * placeholder, and is tried again on the next call.
 */
export async function renderPortraits(
  keys: readonly UnitKey[], size: number, onEach?: (key: UnitKey, url: string) => void,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let since = now();
  for (const key of keys) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = `${key}@${size}`;
      let job = cache.get(id);
      if (job === undefined) {
        const p = painter;
        if (p === null) break;
        // A few per frame: never hold the page for more than about a frame and a half at once.
        if (now() - since > FRAME_BUDGET_MS) {
          await nextFrame();
          since = now();
        }
        job = Promise.resolve().then(() => p(key, size));
        cache.set(id, job);
        job.catch(() => cache.delete(id));
      }
      try {
        out[key] = await job;
        onEach?.(key, out[key] as string);
        break;
      } catch (e) {
        cache.delete(id);
        if (attempt === 1) console.error(`portrait of ${key} failed`, e);
      }
    }
  }
  return out;
}

/** Milliseconds of portrait drawing allowed before waiting for the next frame. */
const FRAME_BUDGET_MS = 24;
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0)));

/** The filmic curve of the post chain (postprocessing's Cineon, after the exposure): scene to display. */
function toDisplay(v: number): number {
  const x = Math.max(0, v * EXPOSURE - 0.004);
  return (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
}

/** True when the context can render to and read back 32-bit float colour. */
function floatReadable(gl: WebGLRenderer): boolean {
  try {
    return gl.extensions.has('EXT_color_buffer_float');
  } catch {
    return false;
  }
}

/** True when any pixel has some alpha (a read that failed leaves every alpha at 0). */
export function anyAlpha(pixels: ArrayLike<number>): boolean {
  for (let i = 3; i < pixels.length; i += 4) if ((pixels[i] as number) > 0) return true;
  return false;
}

/** Supersampling: drawn at this many times the size, then scaled down for clean edges. */
const SUPER = 2;

/**
 * A painter that uses the game's own WebGL context (there is only ever one) to draw each model
 * off screen, at the gallery's portrait framing: the unit's envelope (not what it happens to
 * reach), seen from 20° up and turned 32° towards its face, under copies of the lawn's lights.
 * The picture is tone-mapped like the game's, so the cards match the lawn.
 */
export function createPortraitPainter(renderer: Renderer): PortraitPainter {
  const scene = new Scene();
  const sun = new DirectionalLight(renderer.sun.color, renderer.sun.intensity);
  sun.position.copy(renderer.sun.position).sub(renderer.sun.target.position);
  const fill = new HemisphereLight(renderer.fill.color, renderer.fill.groundColor, renderer.fill.intensity);
  const bounce = new DirectionalLight(renderer.bounce.color, renderer.bounce.intensity);
  bounce.position.copy(renderer.bounce.position);
  scene.add(sun, fill, bounce);
  const camera = new PerspectiveCamera(30, 1, 0.25, 100);
  const rig = new CameraRig(camera);

  return (key, size) => {
    const gl: WebGLRenderer = renderer.webgl;
    const px = Math.max(8, Math.round(size * Math.min(window.devicePixelRatio || 1, 2)));
    const draw = px * SUPER;
    const faction = factionOf(key);
    const model = new ModelInstance(getModelDef(key), 1);
    model.play('idle');
    model.seek(0.4);
    scene.add(model.root);
    camera.aspect = 1;
    rig.frameSubject(envelopeAround([{ key, level: 1, x: 0, z: 0 }]), {
      pitchDeg: 20, yawDeg: faction === 'plants' ? 32 : -32, side: 0.06, top: 0.1, bottom: 0.04,
    });
    // Linear float pixels where the context can draw and read them (three's read does not
    // throw when it cannot; it logs and leaves the buffer as it was), else bytes, which band a
    // little in the darks. A float read that came back with nothing in it is redone in bytes.
    const before = gl.getRenderTarget();
    const clearAlpha = gl.getClearAlpha();
    const shadows = gl.shadowMap.enabled;
    const read = (type: typeof FloatType | typeof UnsignedByteType): Float32Array | Uint8Array => {
      const target = new WebGLRenderTarget(draw, draw, { type, format: RGBAFormat, depthBuffer: true, minFilter: NearestFilter, magFilter: NearestFilter });
      try {
        gl.setRenderTarget(target);
        gl.clear(true, true, true);
        gl.render(scene, camera);
        const out = type === FloatType ? new Float32Array(draw * draw * 4) : new Uint8Array(draw * draw * 4);
        gl.readRenderTargetPixels(target, 0, 0, draw, draw, out);
        return out;
      } finally {
        target.dispose();
      }
    };
    let float = floatReadable(gl);
    let pixels: Float32Array | Uint8Array;
    try {
      gl.shadowMap.enabled = false;
      gl.setClearAlpha(0);
      pixels = float ? read(FloatType) : read(UnsignedByteType);
      if (float && !anyAlpha(pixels)) {
        float = false;
        pixels = read(UnsignedByteType);
      }
    } finally {
      gl.setRenderTarget(before);
      gl.setClearAlpha(clearAlpha);
      gl.shadowMap.enabled = shadows;
      scene.remove(model.root);
      model.dispose();
    }

    // Into a 2D canvas: flip (GL rows run bottom up), tone-map, then scale down.
    const big = document.createElement('canvas');
    big.width = big.height = draw;
    const ctx = big.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas');
    const image = ctx.createImageData(draw, draw);
    for (let y = 0; y < draw; y++) {
      for (let x = 0; x < draw; x++) {
        const src = ((draw - 1 - y) * draw + x) * 4;
        const dst = (y * draw + x) * 4;
        const a = float ? (pixels[src + 3] as number) : (pixels[src + 3] as number) / 255;
        if (a <= 0) continue;
        for (let c = 0; c < 3; c++) {
          const v = pixels[src + c] as number;
          const lin = float ? v / a : (v / 255) / a;
          image.data[dst + c] = Math.round(Math.min(1, toDisplay(lin)) * 255);
        }
        image.data[dst + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    const small = document.createElement('canvas');
    small.width = small.height = px;
    const sctx = small.getContext('2d');
    if (!sctx) throw new Error('no 2d canvas');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(big, 0, 0, px, px);
    return small.toDataURL('image/png');
  };
}
