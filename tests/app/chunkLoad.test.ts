// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { CHUNK_RELOAD_KEY, loadChunk, showChunkFallback } from '../../src/app/chunkLoad';
import { MemoryStorage } from '../progress/memoryStorage';

/** The loader's world: one browser session's storage, online or not, the reloads and fallbacks made. */
function world(opts: { online?: boolean; session?: Storage | undefined } = {}) {
  const online = opts.online ?? true;
  const session = 'session' in opts ? opts.session : new MemoryStorage(); // an explicit undefined means none
  const reloads: number[] = [];
  const fallbacks: number[] = [];
  const deps = {
    session,
    online: () => online,
    reload: () => { reloads.push(1); },
    showFallback: () => { fallbacks.push(1); },
  };
  return { reloads, fallbacks, session, deps };
}

const failing = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

afterEach(() => { document.body.innerHTML = ''; });

describe('loadChunk: a chunk that cannot be fetched', () => {
  it('online, the first time: reloads once and marks the session', async () => {
    const w = world();
    let used = 0;
    expect(await loadChunk(failing, () => { used++; }, w.deps)).toBe('reload');
    expect(w.reloads).toHaveLength(1);
    expect(w.fallbacks).toHaveLength(0);
    expect(w.session?.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
    expect(used).toBe(0);
  });

  it('again in the same session (after that reload): the fallback screen, no second reload', async () => {
    const w = world();
    await loadChunk(failing, () => {}, w.deps);
    expect(await loadChunk(failing, () => {}, w.deps)).toBe('fallback');
    expect(w.reloads).toHaveLength(1);
    expect(w.fallbacks).toHaveLength(1);
  });

  it('offline: the fallback screen at once, no reload', async () => {
    const w = world({ online: false });
    expect(await loadChunk(failing, () => {}, w.deps)).toBe('fallback');
    expect(w.reloads).toHaveLength(0);
    expect(w.fallbacks).toHaveLength(1);
    expect(w.session?.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it('without a usable session store (no guard against a loop): the fallback, never a reload', async () => {
    const none = world({ session: undefined });
    expect(await loadChunk(failing, () => {}, none.deps)).toBe('fallback');
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    const b = world({ session: blocked });
    expect(await loadChunk(failing, () => {}, b.deps)).toBe('fallback');
    expect([...none.reloads, ...b.reloads]).toHaveLength(0);
  });

  it('success: the module is used, nothing else happens', async () => {
    const w = world();
    const got: string[] = [];
    expect(await loadChunk(() => Promise.resolve({ name: 'game' }), (m) => { got.push(m.name); }, w.deps)).toBe('ok');
    expect(got).toEqual(['game']);
    expect(w.reloads).toHaveLength(0);
    expect(w.fallbacks).toHaveLength(0);
    expect(w.session?.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it("Vite's preload error and the import's rejection together are handled once", async () => {
    const w = world();
    const events = new EventTarget();
    const result = loadChunk(() => {
      events.dispatchEvent(new Event('vite:preloadError'));
      return failing();
    }, () => {}, w.deps, events);
    expect(await result).toBe('reload');
    expect(w.reloads).toHaveLength(1);
    expect(w.fallbacks).toHaveLength(0);
    events.dispatchEvent(new Event('vite:preloadError')); // after the load: no longer listened to
    expect(w.reloads).toHaveLength(1);
  });
});

describe('showChunkFallback', () => {
  it('replaces the canvas and UI layer with the sky and one big reload button that needs no stylesheet', () => {
    document.body.innerHTML = '<canvas id="game"></canvas><div id="ui"></div>';
    let reloads = 0;
    showChunkFallback(document, () => { reloads++; });
    expect(document.getElementById('game')).toBeNull();
    expect(document.getElementById('ui')).toBeNull();
    const layer = document.querySelector<HTMLElement>('[data-screen="chunk-failed"]')!;
    expect(layer.getAttribute('style')).toContain('#5ec8ff');
    const buttons = layer.querySelectorAll<HTMLButtonElement>('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.getAttribute('style')).toContain('width');
    expect(buttons[0]!.querySelectorAll('svg rect').length).toBeGreaterThan(20);
    buttons[0]!.click();
    expect(reloads).toBe(1);
    showChunkFallback(document, () => {}); // shown twice: still one screen
    expect(document.querySelectorAll('[data-screen="chunk-failed"]')).toHaveLength(1);
  });
});
