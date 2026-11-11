/** Test hooks exposed on `window.__lvt`; later tasks add fields to it. */
export interface LvtDebug {
  /** Resolves once the current scene has drawn its first frame. */
  ready: Promise<void>;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __lvt: LvtDebug;
  }
}

let resolveReady: () => void = () => {};

export function installDebug(): LvtDebug {
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const lvt: LvtDebug = { ready };
  window.__lvt = lvt;
  return lvt;
}

/** Call after the scene's first frame has been drawn. */
export function markReady(): void {
  resolveReady();
}
