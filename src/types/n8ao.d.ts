// n8ao ships no type declarations; this covers the part of it the renderer uses.
declare module 'n8ao' {
  import type { Camera, Color, Scene, WebGLRenderTarget } from 'three';
  import { Pass } from 'postprocessing';

  export type N8AOQualityMode = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
  export type N8AODisplayMode = 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO';

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    readonly configuration: {
      aoSamples: number;
      /** Reach of the occlusion in world units (pixels when `screenSpaceRadius` is on). */
      aoRadius: number;
      denoiseSamples: number;
      denoiseRadius: number;
      denoiseIterations: number;
      distanceFalloff: number;
      intensity: number;
      color: Color;
      screenSpaceRadius: boolean;
      halfRes: boolean;
      depthAwareUpsampling: boolean;
      gammaCorrection: boolean;
      transparencyAware: boolean;
    };
    /** Internal: the half-resolution depth and normal target, present while `halfRes` is on. */
    readonly depthDownsampleTarget?: WebGLRenderTarget | null;
    /** When true the pass walks the scene every frame looking for transparent materials. */
    autoDetectTransparency: boolean;
    setQualityMode(mode: N8AOQualityMode): void;
    setDisplayMode(mode: N8AODisplayMode): void;
  }
}
