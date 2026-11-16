/**
 * The game (and its stylesheet) arrives by dynamic import. If that chunk cannot be fetched
 * (offline mid-load, or a deploy landed between index.html and the chunk so the old hashed file
 * is gone) the child would see a blank, unstyled page. So a failure reloads the page once, only
 * online and at most once per browser session (a flag in `sessionStorage`, as `staleBuild` guards
 * its reload), and otherwise shows a screen that needs nothing from the chunk: the sky, a pixel
 * picture and one big reload button, all inline.
 */
export const CHUNK_RELOAD_KEY = 'lvt2_chunk_reload';

export interface ChunkLoadDeps {
  /** The browser session's storage (`sessionStorage`); without one there is no guard, so no reload. */
  session: Storage | undefined;
  online(): boolean;
  reload(): void;
  /** Shows the screen that needs no chunk (`showChunkFallback` in the browser). */
  showFallback(): void;
}

/** What a chunk failure did: reloaded the page, or showed the fallback screen. */
export type ChunkFailure = 'reload' | 'fallback';

/** Handles a failed chunk: one guarded reload when online, the fallback screen otherwise. */
export function onChunkFailure(d: ChunkLoadDeps): ChunkFailure {
  if (d.online() && d.session !== undefined) {
    try {
      if (d.session.getItem(CHUNK_RELOAD_KEY) === null) {
        d.session.setItem(CHUNK_RELOAD_KEY, '1');
        d.reload();
        return 'reload';
      }
    } catch {
      // Storage blocked: no guard, so no reload (it could loop).
    }
  }
  d.showFallback();
  return 'fallback';
}

/**
 * Imports a chunk and hands it to `use`. A failure (the import rejecting, or Vite's
 * `vite:preloadError` for a file the chunk needs, on `events`) is handled once per page load by
 * `onChunkFailure`. Resolves to what happened: 'ok', or the failure's answer.
 */
export function loadChunk<T>(
  importer: () => Promise<T>,
  use: (mod: T) => void,
  d: ChunkLoadDeps,
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
): Promise<'ok' | ChunkFailure> {
  let failed: ChunkFailure | null = null;
  const fail = (): ChunkFailure => {
    failed ??= onChunkFailure(d);
    return failed;
  };
  const onPreloadError = (): void => { fail(); };
  events?.addEventListener('vite:preloadError', onPreloadError);
  return importer().then(
    (mod) => {
      events?.removeEventListener('vite:preloadError', onPreloadError);
      if (failed !== null) return failed;
      use(mod);
      return 'ok' as const;
    },
    () => {
      events?.removeEventListener('vite:preloadError', onPreloadError);
      return fail();
    },
  );
}

/** A reload arrow, one character per pixel (o ink, w white, . empty). */
const ARROW = [
  '.....oooooo.o...',
  '...oowwwwwwoowo.',
  '..owwoooooowwwo.',
  '.owwo.....owwwo.',
  '.owo.....owwwwo.',
  'owwo.....oooooo.',
  'owo.............',
  'owo.............',
  'owo.........owo.',
  'owwo.......owwo.',
  '.owo.......owo..',
  '.owwo.....owwo..',
  '..owwoooooowwo..',
  '...oowwwwwwoo...',
  '.....oooooo.....',
];

/** The fallback's pixel picture as an SVG string: the reload arrow, white with a dark outline. */
export function arrowSvg(): string {
  const fill: Record<string, string> = { o: '#2a1b0e', w: '#ffffff' };
  let rects = '';
  ARROW.forEach((row, y) => {
    [...row].forEach((c, x) => {
      const f = fill[c];
      if (f !== undefined) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${f}"/>`;
    });
  });
  const w = (ARROW[0] ?? '').length;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${ARROW.length}" shape-rendering="crispEdges" aria-hidden="true" style="display:block;width:100%;height:auto">${rects}</svg>`;
}

/**
 * Replaces the page with the fallback: the game's sky, and one big green button holding the
 * reload arrow (no words: the youngest player cannot read). Inline styles only, nothing from the
 * game's chunk or stylesheet.
 */
export function showChunkFallback(doc: Document, reload: () => void): void {
  doc.getElementById('game')?.remove();
  doc.getElementById('ui')?.remove();
  doc.querySelector('[data-screen="chunk-failed"]')?.remove();
  const layer = doc.createElement('div');
  layer.dataset.screen = 'chunk-failed';
  layer.setAttribute('style', 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#5ec8ff;margin:0;padding:16px;box-sizing:border-box');
  const button = doc.createElement('button');
  button.type = 'button';
  button.dataset.action = 'reload';
  button.setAttribute('aria-label', 'Reload');
  button.setAttribute('style', 'width:min(40vmin,220px);min-width:120px;padding:clamp(14px,4vmin,28px);border:6px solid #2a1b0e;border-radius:0;background:#7fd14b;box-shadow:0 8px 0 #2a1b0e;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent');
  button.innerHTML = arrowSvg();
  button.addEventListener('click', () => reload());
  layer.appendChild(button);
  doc.body.style.margin = '0';
  doc.body.style.background = '#5ec8ff';
  doc.body.appendChild(layer);
}

/** The browser's session storage, or undefined where it cannot be used. */
export function browserSessionStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
