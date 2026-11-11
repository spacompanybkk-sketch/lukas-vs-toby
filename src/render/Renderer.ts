import {
  Color,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { N8AOPostPass } from 'n8ao';
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from 'postprocessing';
import { CameraRig } from './CameraRig';

export type Quality = 'low' | 'medium' | 'high';

/** How edges are anti-aliased: multisampled buffers, or a smoothing pass over the finished picture. */
type Smoothing = 'msaa' | 'smaa';

/**
 * Direction the sunlight travels: down from the upper left, about 61° above the ground.
 * The art bible asks both for a sun "from the upper left front" and for shadows that fall
 * "to the right and slightly towards the camera"; a light in front cannot throw shadows
 * forward, so the shadows win: they are what the player sees under every unit.
 */
export const SUN_TRAVEL = new Vector3(0.5, -1, 0.22).normalize();

// Art bible section 4.
const SUN_COLOR = '#FFF1D6';
const FILL_SKY = '#BFE8FF';
const FILL_GROUND = '#6BBE3F';
/** The fill sky colour let down towards white, so shaded faces are cool but not green. */
const BOUNCE_COLOR = '#DCEBFF';

/**
 * Exposure of the filmic tone mapper. It is high and the lights are correspondingly dim, so
 * lit surfaces look the same as at exposure 1 but stay under scene luminance 0.6. That
 * leaves room below the bloom threshold for painted things (sky, clouds) to be near-white
 * on screen without glowing.
 */
export const EXPOSURE = 2;
/** Scene luminance where bloom starts. Sunlit surfaces reach about 0.6 and clouds 1.0. */
const BLOOM_THRESHOLD = 1.2;

/**
 * GLSL for materials that are painted rather than lit (sky, clouds): `displayToScene(c)`
 * returns the scene colour that the tone mapper turns into linear display colour `c`, so
 * such a material can name the colour it wants on screen. It is the inverse of the filmic
 * curve used in the post chain; colours brighter than the curve can reach are clamped.
 */
export const DISPLAY_TO_SCENE_GLSL = /* glsl */ `
  vec3 displayToScene(vec3 c) {
    vec3 f = pow(clamp(c, 0.0, 0.82), vec3(1.0 / 2.2));
    vec3 a = 6.2 * (f - 1.0);
    vec3 b = 1.7 * f - 0.5;
    vec3 x = (-b - sqrt(max(b * b - 0.24 * a * f, 0.0))) / (2.0 * a);
    return (x + 0.004) / ${EXPOSURE.toFixed(4)};
  }
`;

/** Everything that casts or receives a shadow lies inside this box. */
const SHADOW_BOX = { x: [-3.4, 13.4], y: [-4.6, 3.2], z: [-2.2, 7] } as const;

const MAX_PIXEL_RATIO = 2;
const SCALE_MIN_TENTHS = 6;
const SCALE_MAX_TENTHS = 10;
const SLOW_FRAME_MS = 18;
const FAST_FRAME_MS = 14;
const LOWER_AFTER_FRAMES = 30;
const RAISE_AFTER_FRAMES = 300;
/** A gap this long is a hidden tab or a breakpoint, not a slow frame. */
const STALL_MS = 250;
/** Frames ignored after the buffers change size, while the browser catches up. */
const SETTLE_FRAMES = 10;
const MAX_PATIENCE = 16;
const RETRY_FAILED_WITHIN_FRAMES = 300;
const RETRY_PROVEN_AFTER_FRAMES = 1800;

/**
 * Chooses the render scale from frame times, in steps of 0.1 between 0.6 and 1: down after
 * 30 consecutive frames over 18 ms, up after 300 consecutive frames under 14 ms.
 *
 * Two things the plain rule misses on a real display are handled here as well:
 * - At 45 fps on a 60 Hz display frames alternate between 16.7 and 33.3 ms, so no run of
 *   30 is ever all slow. Each frame is therefore judged together with the one before it.
 * - A 60 Hz display never shows a frame under 14 ms, so the scale could only ever go down.
 *   Frames that merely arrive on time also count towards going back up, but need 300 times
 *   a patience factor that doubles (to at most 16) whenever going up had to be undone at
 *   once, so a machine that cannot hold full resolution is not made to stutter by retries.
 */
export class RenderScale {
  /** Current scale, 0.6 to 1. */
  value = 1;
  /** Smoothed frames per second. */
  fps = 60;

  private tenths = SCALE_MAX_TENTHS;
  private smoothedMs = 1000 / 60;
  private previousMs = 0;
  private slow = 0;
  private fast = 0;
  private onTime = 0;
  private ignore = 0;
  private patience = 1;
  private sinceRaise = Infinity;

  /** Ignore the next `frames` samples (after a resize or a change of quality). */
  settle(frames: number): void {
    this.ignore = Math.max(this.ignore, frames);
    this.forget();
  }

  /** Feed the time between two frames. Returns true when `value` changed. */
  sample(frameMs: number): boolean {
    if (!(frameMs > 0)) return false;
    if (frameMs > STALL_MS) {
      this.forget();
      return false;
    }
    this.smoothedMs += (frameMs - this.smoothedMs) * 0.1;
    this.fps = 1000 / this.smoothedMs;
    if (this.ignore > 0) {
      this.ignore--;
      return false;
    }

    const ms = this.previousMs > 0 ? (frameMs + this.previousMs) / 2 : frameMs;
    this.previousMs = frameMs;
    this.sinceRaise++;

    if (ms > SLOW_FRAME_MS) {
      this.slow++;
      this.fast = 0;
      this.onTime = 0;
    } else {
      this.slow = 0;
      this.onTime++;
      this.fast = ms < FAST_FRAME_MS ? this.fast + 1 : 0;
    }

    if (this.slow >= LOWER_AFTER_FRAMES) {
      if (this.sinceRaise <= RETRY_FAILED_WITHIN_FRAMES) this.patience = Math.min(this.patience * 2, MAX_PATIENCE);
      else if (this.sinceRaise >= RETRY_PROVEN_AFTER_FRAMES) this.patience = 1;
      return this.move(-1);
    }
    if (this.fast >= RAISE_AFTER_FRAMES || this.onTime >= RAISE_AFTER_FRAMES * this.patience) {
      const raised = this.move(1);
      if (raised) this.sinceRaise = 0;
      return raised;
    }
    return false;
  }

  private move(direction: 1 | -1): boolean {
    this.forget();
    const next = Math.min(SCALE_MAX_TENTHS, Math.max(SCALE_MIN_TENTHS, this.tenths + direction));
    if (next === this.tenths) return false;
    this.tenths = next;
    this.value = next / 10;
    this.ignore = Math.max(this.ignore, SETTLE_FRAMES);
    return true;
  }

  private forget(): void {
    this.slow = 0;
    this.fast = 0;
    this.onTime = 0;
    this.previousMs = 0;
  }
}

/**
 * n8ao 2.0.1 builds its half-resolution target with a `texture` getter that returns the
 * whole list of textures, which Three.js 0.187 cannot set up (it expects one texture
 * there). The pass itself only ever reads `textures`, so putting the standard getter back
 * on that one object is enough. Does nothing once the library is fixed.
 */
function fixHalfResTarget(pass: N8AOPostPass): void {
  const target = pass.depthDownsampleTarget;
  if (!target || !Array.isArray(target.texture)) return;
  Object.defineProperty(target, 'texture', { get: () => target.textures[0], configurable: true });
}

/**
 * The WebGL renderer, the scene with its lights, the camera with its rig, and the
 * post-processing chain: ambient occlusion, bloom on glowing parts, filmic tone mapping,
 * a light grade, vignette and anti-aliasing.
 */
export class Renderer {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 2, 200);
  readonly rig = new CameraRig(this.camera);
  readonly stats = { fps: 60, scale: 1 };
  /** The warm key light. It casts the only shadows. */
  readonly sun = new DirectionalLight(SUN_COLOR, 1.5);
  /** Sky-and-grass fill light. */
  readonly fill = new HemisphereLight(FILL_SKY, FILL_GROUND, 0.85);
  /**
   * Sky light reaching the faces that look at the camera and the island's underside, which
   * the sun never touches. It comes from in front and slightly below, so it adds nothing to
   * upward faces and leaves the shadows on the lawn as they are. Casts no shadow. (Not in
   * the art bible's light list: without it every camera-facing side is flat and green.)
   */
  readonly bounce = new DirectionalLight(BOUNCE_COLOR, 1);

  /** Called when the browser takes the WebGL context away; nothing is drawn until it returns. */
  onContextLost?: () => void;
  onContextRestored?: () => void;

  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly scaler = new RenderScale();
  private quality: Quality;
  private smoothing: Smoothing;
  private width = 1;
  private height = 1;
  private lastFrameAt = 0;
  private contextLost = false;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.canvas = canvas;
    this.quality = quality;

    const attributes: WebGLContextAttributes = {
      alpha: false,
      antialias: false, // the composer's own buffers are multisampled instead
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    };
    const context = canvas.getContext('webgl2', attributes);
    if (!context) throw new Error('webgl2-unavailable');
    try {
      this.gl = new WebGLRenderer({ canvas, context, ...attributes });
    } catch {
      throw new Error('webgl2-unavailable');
    }
    const gl = this.gl;
    gl.outputColorSpace = SRGBColorSpace;
    gl.toneMapping = NoToneMapping; // tone mapping happens once, in the post chain
    gl.toneMappingExposure = EXPOSURE;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = PCFShadowMap;

    // Shown only by scenes that add no sky of their own.
    this.scene.background = new Color('#8FD8FF');
    this.setUpLights();

    this.smoothing = this.pickSmoothing();
    this.composer = new EffectComposer(gl, { frameBufferType: HalfFloatType });
    this.buildChain();

    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.resize();
    // The first second compiles shaders and fills buffers; it says nothing about speed.
    this.scaler.settle(60);
  }

  /** Fits the drawing buffers and the camera frame to the canvas's size on the page. */
  resize(): void {
    this.width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    this.height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.applySize();
    this.rig.frameLawn(this.width / this.height);
  }

  /** Moves the camera rig on by `dtSeconds` and draws one frame. */
  render(dtSeconds: number): void {
    if (this.contextLost) return;

    // Timed here rather than taken from `dtSeconds`, which a caller may slow down or freeze.
    const now = performance.now();
    if (this.lastFrameAt > 0 && this.scaler.sample(now - this.lastFrameAt)) this.applySize();
    this.lastFrameAt = now;
    this.stats.fps = this.scaler.fps;
    this.stats.scale = this.scaler.value;

    // Follow the canvas even if nobody told us the window changed.
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width > 0 && height > 0 && (width !== this.width || height !== this.height)) this.resize();

    this.rig.update(dtSeconds);
    this.composer.render(dtSeconds);
  }

  /** `low`: no ambient occlusion, no bloom, 1024 shadows. `medium`: bloom, 2048 shadows. `high`: everything. */
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.applyShadowQuality();
    this.buildChain();
    this.applySize();
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.sun.shadow.dispose();
    this.composer.dispose();
    this.gl.dispose();
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault(); // lets the browser restore the context later
    this.contextLost = true;
    this.onContextLost?.();
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.lastFrameAt = 0;
    this.scaler.settle(60);
    this.onContextRestored?.();
  };

  private setUpLights(): void {
    const { sun, fill, bounce, scene } = this;
    sun.name = 'sun';
    fill.name = 'fill';
    bounce.name = 'bounce';
    bounce.position.set(0, -0.35, 1);
    scene.add(bounce);

    // Aim at the middle of the shadow box from far enough away to clear it.
    const centre = new Vector3(
      (SHADOW_BOX.x[0] + SHADOW_BOX.x[1]) / 2,
      (SHADOW_BOX.y[0] + SHADOW_BOX.y[1]) / 2,
      (SHADOW_BOX.z[0] + SHADOW_BOX.z[1]) / 2,
    );
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(SUN_TRAVEL, -40);
    sun.castShadow = true;
    scene.add(sun, sun.target, fill);

    // Fit the shadow camera round the box as the light sees it.
    sun.updateMatrixWorld(true);
    sun.target.updateMatrixWorld(true);
    const shadowCamera = sun.shadow.camera;
    shadowCamera.position.copy(sun.position);
    shadowCamera.lookAt(centre);
    shadowCamera.updateMatrixWorld(true);
    const corner = new Vector3();
    let halfWidth = 0;
    let halfHeight = 0;
    let nearest = Infinity;
    let farthest = 0;
    for (const x of SHADOW_BOX.x) {
      for (const y of SHADOW_BOX.y) {
        for (const z of SHADOW_BOX.z) {
          corner.set(x, y, z).applyMatrix4(shadowCamera.matrixWorldInverse);
          halfWidth = Math.max(halfWidth, Math.abs(corner.x));
          halfHeight = Math.max(halfHeight, Math.abs(corner.y));
          nearest = Math.min(nearest, -corner.z);
          farthest = Math.max(farthest, -corner.z);
        }
      }
    }
    shadowCamera.left = -halfWidth;
    shadowCamera.right = halfWidth;
    shadowCamera.top = halfHeight;
    shadowCamera.bottom = -halfHeight;
    shadowCamera.near = Math.max(0.5, nearest - 1);
    shadowCamera.far = farthest + 1;
    shadowCamera.updateProjectionMatrix();

    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.applyShadowQuality();
  }

  private applyShadowQuality(): void {
    const shadow = this.sun.shadow;
    const size = this.quality === 'low' ? 1024 : 2048;
    // The blur is set in texels, so halve it with the map to keep the same softness.
    shadow.radius = this.quality === 'low' ? 1.6 : 3.2;
    if (shadow.mapSize.x === size) return;
    shadow.mapSize.set(size, size);
    shadow.map?.dispose();
    shadow.map = null;
  }

  /** (Re)builds the post-processing passes for the current quality. */
  private buildChain(): void {
    const { composer, scene, camera, quality } = this;
    for (const pass of composer.passes) pass.dispose();
    composer.removeAllPasses();

    composer.addPass(new RenderPass(scene, camera));

    if (quality === 'high') {
      // Ambient occlusion works from the depth buffer alone, so the scene is drawn only once.
      const occlusion = new N8AOPostPass(scene, camera, this.width, this.height);
      const ao = occlusion.configuration;
      ao.aoRadius = 0.8; // tiles: contact shadows, not room-sized gloom
      ao.distanceFalloff = 1;
      ao.intensity = 2.6;
      ao.color = new Color('#1E2B4A'); // occluded corners go towards a dusky blue, not black
      ao.aoSamples = 16;
      ao.denoiseSamples = 8;
      ao.denoiseRadius = 12;
      ao.halfRes = true; // full resolution cost 6 ms a frame more on a Retina display
      fixHalfResTarget(occlusion);
      // Nothing see-through here should be skipped by it, and looking for such things costs
      // a walk of the whole scene every frame.
      occlusion.autoDetectTransparency = false;
      composer.addPass(occlusion);
    }

    const effects: Effect[] = [];
    if (quality !== 'low') {
      // The threshold sits above anything sunlight alone can reach, so only glowing parts bloom.
      effects.push(
        new BloomEffect({
          luminanceThreshold: BLOOM_THRESHOLD,
          luminanceSmoothing: 0.35,
          mipmapBlur: true,
          intensity: 0.9,
          radius: 0.7,
          levels: 6,
        }),
      );
    }
    effects.push(
      // "Cineon" is postprocessing's name for the Hejl and Burgess-Dawson filmic curve. It
      // works on each colour channel alone and so keeps the palette saturated.
      new ToneMappingEffect({ mode: ToneMappingMode.CINEON }),
      new HueSaturationEffect({ saturation: 0.1 }),
      new BrightnessContrastEffect({ brightness: 0, contrast: 0.04 }),
      new VignetteEffect({ offset: 0.3, darkness: 0.34 }),
    );
    const lookPass = new EffectPass(camera, ...effects);
    composer.addPass(lookPass);
    let lastPass = lookPass;
    if (this.smoothing === 'smaa') {
      // Edge smoothing runs last, on the picture as it will be shown.
      const smoother = quality === 'low' ? new FXAAEffect() : new SMAAEffect({ preset: SMAAPreset.MEDIUM });
      lastPass = new EffectPass(camera, smoother);
      composer.addPass(lastPass);
    }
    lastPass.dithering = true; // keeps the sky gradient from banding
  }

  /**
   * Multisampling these floating-point buffers is cheap at one pixel per point and very dear
   * on a Retina display (it took the bare lawn from 9 to 14 ms a frame on the reference
   * machine), where edges are fine enough for a smoothing pass to do the job.
   */
  private pickSmoothing(): Smoothing {
    return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) >= 1.5 ? 'smaa' : 'msaa';
  }

  /** Applies the pixel ratio (device ratio capped at 2, times the render scale) and resizes every buffer. */
  private applySize(): void {
    // The window may have moved to a display of another density.
    const smoothing = this.pickSmoothing();
    if (smoothing !== this.smoothing) {
      this.smoothing = smoothing;
      this.buildChain();
    }
    const deviceRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.gl.setPixelRatio(deviceRatio * this.scaler.value);
    this.composer.multisampling = smoothing === 'smaa' ? 0 : this.quality === 'low' ? 2 : 4;
    this.composer.setSize(this.width, this.height, false);
    this.scaler.settle(SETTLE_FRAMES);
  }
}
