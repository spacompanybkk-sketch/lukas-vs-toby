import { render } from 'preact';
import { installDebug } from './app/debug';
import { battleOptionsFrom, mountGame } from './app/game';
import * as gallery from './render/gallery';
import * as battleDemo from './scenes/battleDemo';
import * as boot from './scenes/boot';
import * as fx from './scenes/fx';
import * as lawn from './scenes/lawn';
import { App } from './ui/App';
import './ui/theme.css';

/** Undoes everything a scene set up: stops its loop, removes its listeners, frees its GPU resources. */
type Teardown = () => void;

/** A development scene, opened with `?scene=<name>`. It calls `markReady()` once it has drawn. */
interface SceneModule {
  mount(canvas: HTMLCanvasElement, params: URLSearchParams): void | Teardown | Promise<void | Teardown>;
  /** True if the game title should stay on screen over the scene. */
  keepTitle?: boolean;
}

// A Map, not an object: `?scene=constructor` must find nothing, not something inherited.
const SCENES = new Map<string, SceneModule>([
  ['boot', boot],
  ['lawn', lawn],
  ['gallery', gallery],
  ['fx', fx],
  ['battle-demo', battleDemo],
]);

installDebug();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const params = new URLSearchParams(location.search);
const name = params.get('scene') ?? '';
const scene = SCENES.get(name);

/** Frees everything when the page goes; a page restored from the back/forward cache reloads instead. */
function tearDownOnLeave(teardown: Teardown): void {
  window.addEventListener('pagehide', () => teardown(), { once: true });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
}

if (scene) {
  if (scene.keepTitle) render(<App />, ui);
  void Promise.resolve(scene.mount(canvas, params)).then((teardown) => {
    if (teardown) tearDownOnLeave(teardown);
  });
} else {
  // The game: the title (or, with `?scene=battle`, straight into a battle that has begun).
  tearDownOnLeave(mountGame(canvas, ui, name === 'battle' ? battleOptionsFrom(params) : null));
}
