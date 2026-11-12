import type { Renderer } from '../render/Renderer';
import type { Lawn } from '../render/world/Lawn';

/** Test hooks exposed on `window.__lvt`; later tasks add fields to it. */
export interface LvtDebug {
  /** Resolves once the current scene has drawn its first frame. */
  ready: Promise<void>;
  /** The renderer of the current 3D scene, if it has one. */
  renderer?: Renderer;
  /** The lawn of the current 3D scene, if it has one. */
  lawn?: Lawn;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __lvt: LvtDebug;
  }
}

let resolveReady: () => void = () => {};
/** The hooks object when the gate is shut: the scenes still fill it in, but nothing outside sees it. */
let hidden: LvtDebug | null = null;

/**
 * Whether the test hooks go on `window.__lvt`: always in a dev build, and in a production build
 * only when the address asks for them with `?debug` (as every e2e test and tool does).
 */
export function debugEnabled(dev: boolean, search: string): boolean {
  return dev || new URLSearchParams(search).has('debug');
}

function create(): LvtDebug {
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  return { ready };
}

/**
 * The test hooks, made once; later calls return the same object. With the gate open (see
 * `debugEnabled`) it is `window.__lvt`; shut, it is a private object and `window.__lvt` stays
 * undefined.
 */
export function installDebug(enabled = debugEnabled(import.meta.env.DEV, location.search)): LvtDebug {
  if (!enabled) return (hidden ??= create());
  const existing = (window as Partial<Window>).__lvt;
  if (existing) return existing;
  const lvt = create();
  window.__lvt = lvt;
  return lvt;
}

/** Call after the scene's first frame has been drawn. */
export function markReady(): void {
  resolveReady();
}
