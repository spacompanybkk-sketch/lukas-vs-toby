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
import { BLOOM_THRESHOLD, EXPOSURE, SUN_TRAVEL } from './look';
import { PALETTE } from './palette';
import { RenderScale } from './RenderScale';

export type Quality = 'low' | 'medium' | 'high';

/** How edges are anti-aliased: multisampled buffers, or a smoothing pass over the finished picture. */
type Smoothing = 'msaa' | 'smaa';

/** Everything that casts or receives a shadow lies inside this box. */
const SHADOW_BOX = { x: [-3.4, 13.4], y: [-4.6, 3.2], z: [-2.2, 7] } as const;

const MAX_PIXEL_RATIO = 2;
/** Frames the render scale ignores after the buffers change size, while the browser catches up. */
const SETTLE_FRAMES = 10;

/**
 * n8ao 2.0.1 builds its half-resolution target with a `texture` getter that returns the
 * whole list of textures, which Three.js 0.187 cannot set up (it expects one texture
 * there). The pass itself only ever reads `textures`, so putting the standard getter back
 * on that one object is enough. Does nothing to a target that is already right, so it is
 * safe to call at any time and stops mattering once the library is fixed.
 *
 * The fix is on the target, not the pass: whenever n8ao builds a new target it has to be
 * applied again. n8ao does that when `halfRes` is switched (and when a neural quality mode
 * switches it off); resizing keeps the same target.
 */
export function fixHalfResTarget(pass: {
  readonly depthDownsampleTarget?: { readonly texture: unknown; readonly textures: readonly unknown[] } | null;
}): void {
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
  /** For the `?fps` readout and tools: smoothed fps, render scale, draw calls in the last frame. */
  readonly stats = { fps: 60, scale: 1, drawCalls: 0 };
  /** Whether `stats.drawCalls` is being counted (see `countDrawCalls`). */
  private countingCalls = false;
  // The three lights of art bible section 4. Every scene uses them as they are.

  /** The warm key light. It casts the only shadows. */
  readonly sun = new DirectionalLight(PALETTE.sunLight, 1.5);
  /** Sky-and-grass fill light. */
  readonly fill = new HemisphereLight(PALETTE.fillSky, PALETTE.fillGround, 0.85);
  /**
   * Sky light reaching the faces that look at the camera and the island's underside, which
   * the sun never touches. It comes from in front and slightly below, so it adds nothing to
   * upward faces and leaves the shadows on the lawn as they are. Casts no shadow. Without
   * it every camera-facing side is flat and green.
   */
  readonly bounce = new DirectionalLight(PALETTE.bounceLight, 1);

  /** Called when the browser takes the WebGL context away; nothing is drawn until it returns. */
  onContextLost?: () => void;
  onContextRestored?: () => void;

  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly scaler = new RenderScale();
  private quality: Quality;
  private smoothing: Smoothing;
  /** The ambient occlusion pass, at high quality only. */
  private occlusion: N8AOPostPass | null = null;
  /** Matches the display's current pixel density, so its `change` event means the density changed. */
  private densityQuery: MediaQueryList | null = null;
  /** The device pixel ratio the buffers were last sized for. */
  private density = 1;
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
    // Only a missing context means "this browser cannot run the game". Anything else that
    // goes wrong below is a fault of ours and is thrown as it is.
    const context = canvas.getContext('webgl2', attributes);
    if (!context) throw new Error('webgl2-unavailable');
    const gl = new WebGLRenderer({ canvas, context, ...attributes });
    this.gl = gl;

    let composer: EffectComposer | undefined;
    try {
      gl.outputColorSpace = SRGBColorSpace;
      gl.toneMapping = NoToneMapping; // tone mapping happens once, in the post chain
      gl.toneMappingExposure = EXPOSURE;
      gl.shadowMap.enabled = true;
      gl.shadowMap.type = PCFShadowMap;

      // Shown only by scenes that add no sky of their own.
      this.scene.background = new Color(PALETTE.skyBackdrop);
      this.setUpLights();

      this.smoothing = this.pickSmoothing();
      composer = new EffectComposer(gl, { frameBufferType: HalfFloatType });
      this.composer = composer;
      this.buildChain();

      canvas.addEventListener('webglcontextlost', this.handleContextLost);
      canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

      this.resize();
      // The first second compiles shaders and fills buffers; it says nothing about speed.
      this.scaler.settle(60);
      this.watchDensity();
    } catch (error) {
      // Half-built: give back what was taken, then pass the error on unchanged.
      this.stopListening();
      composer?.dispose();
      gl.dispose();
      throw error;
    }
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
    // Likewise the pixel density: device emulation in developer tools changes it without
    // the media query event that `watchDensity` waits for.
    if ((window.devicePixelRatio || 1) !== this.density) this.handleDensityChange();

    this.rig.update(dtSeconds);
    if (this.countingCalls) {
      const before = this.gl.info.render.calls;
      this.composer.render(dtSeconds);
      this.stats.drawCalls = this.gl.info.render.calls - before;
    } else {
      this.composer.render(dtSeconds);
    }
  }

  /**
   * Counts the draw calls of each whole frame into `stats.drawCalls` (the composer draws several
   * passes a frame, so three.js's own per-render reset is turned off while counting).
   */
  countDrawCalls(on: boolean): void {
    this.countingCalls = on;
    this.gl.info.autoReset = !on;
  }

  /**
   * The WebGL renderer itself, for drawing something else off screen with the same context (the
   * card portraits). Leave its size, pixel ratio and render target as they were found.
   */
  get webgl(): WebGLRenderer {
    return this.gl;
  }

  /** `low`: no ambient occlusion, no bloom, 1024 shadows. `medium`: bloom, 2048 shadows. `high`: everything. */
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.applyShadowQuality();
    this.buildChain();
    this.applySize();
  }

  /**
   * Stops listening to the canvas and the display, and frees the post chain (every pass and
   * buffer), the shadow map and the WebGL renderer. The scene's own contents belong to
   * whoever put them there.
   */
  dispose(): void {
    this.stopListening();
    this.occlusion = null;
    this.sun.shadow.dispose();
    this.composer.dispose();
    this.gl.dispose();
  }

  private stopListening(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.densityQuery?.removeEventListener('change', this.handleDensityChange);
    this.densityQuery = null;
  }

  /**
   * Asks to be told when the display's pixel density changes while the canvas keeps its
   * size on the page: the window dragged to another screen, or the browser zoomed. A media
   * query can only say "the density is no longer X", so it is set again for each new X.
   */
  private watchDensity(): void {
    this.densityQuery?.removeEventListener('change', this.handleDensityChange);
    this.density = window.devicePixelRatio || 1;
    this.densityQuery =
      typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${this.density}dppx)`) : null;
    this.densityQuery?.addEventListener('change', this.handleDensityChange);
  }

  private readonly handleDensityChange = (): void => {
    this.watchDensity();
    this.resize();
  };

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
    this.occlusion = null;

    composer.addPass(new RenderPass(scene, camera));

    if (quality === 'high') {
      // Ambient occlusion works from the depth buffer alone, so the scene is drawn only once.
      const occlusion = new N8AOPostPass(scene, camera, this.width, this.height);
      const ao = occlusion.configuration;
      ao.aoRadius = 0.8; // tiles: contact shadows, not room-sized gloom
      ao.distanceFalloff = 1;
      ao.intensity = 2.6;
      ao.color = new Color(PALETTE.occlusion);
      ao.aoSamples = 16;
      ao.denoiseSamples = 8;
      ao.denoiseRadius = 12;
      ao.halfRes = true; // full resolution cost 6 ms a frame more on a Retina display
      // Switching `halfRes` on has just made n8ao build its half-resolution target, which
      // Three.js cannot use as built. This must follow every such rebuild; see the function.
      fixHalfResTarget(occlusion);
      this.occlusion = occlusion;
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

  /**
   * Applies the pixel ratio (device ratio capped at 2, times the render scale) and resizes
   * every buffer. Runs on a resize, a change of quality, a change of render scale and a
   * change of the display's pixel density.
   */
  /**
   * Holds the render scale at `value` (1: full resolution) whatever the frame rate, or lets it
   * adapt again with null. For measuring tools; the game never pins it.
   */
  pinRenderScale(value: number | null): void {
    this.scaler.pin(value);
    this.applySize();
    this.stats.scale = this.scaler.value;
  }

  private applySize(): void {
    // A different pixel density can call for the other kind of anti-aliasing, which is a
    // different chain of passes.
    const smoothing = this.pickSmoothing();
    if (smoothing !== this.smoothing) {
      this.smoothing = smoothing;
      this.buildChain();
    }
    const deviceRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.gl.setPixelRatio(deviceRatio * this.scaler.value);
    this.composer.multisampling = smoothing === 'smaa' ? 0 : this.quality === 'low' ? 2 : 4;
    this.composer.setSize(this.width, this.height, false);
    // Resizing keeps n8ao's half-resolution target, so this finds nothing to do today; it is
    // here so that a version of n8ao that rebuilds the target on resize cannot break drawing.
    if (this.occlusion) fixHalfResTarget(this.occlusion);
    this.scaler.settle(SETTLE_FRAMES);
  }
}
