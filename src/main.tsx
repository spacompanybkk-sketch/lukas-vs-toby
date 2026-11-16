import { render } from 'preact';
import { browserSessionStorage, loadChunk, showChunkFallback, type ChunkLoadDeps } from './app/chunkLoad';
import { debugEnabled, installDebug } from './app/debug';
import { isPhone, readDeviceFacts } from './app/phone';
// The base stylesheet (tokens, fonts, .btn, .px, palettes) loads with the entry, as a <link> in the
// page head, so it comes BEFORE the game chunk's own stylesheet, as it did when there was one
// bundle. Imported only from the lazy chunks, it became a shared chunk that Vite inserted after the
// game's sheet, so its base rules beat the screens' rules of equal specificity (Home's door and
// Play tile, the Grown-ups lock over GUEST, the Marketplace grid).
import './ui/theme.css';

// The test hooks object exists at once (tests read `__lvt.ready` right after load); it is tiny.
installDebug();

// A chunk that cannot be fetched reloads the page once, or shows a reload button (see chunkLoad).
const reload = (): void => location.reload();
const chunkDeps: ChunkLoadDeps = {
  session: browserSessionStorage(),
  online: () => navigator.onLine !== false,
  reload,
  showFallback: () => showChunkFallback(document, reload),
};

// Decided before anything else loads: on a phone only the notice is shown. The game (3D scene,
// audio, cloud client) is a separate chunk that a phone never fetches. `?debug` skips the notice.
if (!debugEnabled(import.meta.env.DEV, location.search) && isPhone(readDeviceFacts())) {
  void loadChunk(() => import('./ui/PhoneNotice'), ({ PhoneNotice }) => {
    document.getElementById('game')?.remove(); // no canvas, so never a WebGL context
    render(<PhoneNotice />, document.getElementById('ui') as HTMLElement);
  }, chunkDeps, window);
} else {
  void loadChunk(() => import('./app/startGame'), ({ startGame }) => startGame(), chunkDeps, window);
}
