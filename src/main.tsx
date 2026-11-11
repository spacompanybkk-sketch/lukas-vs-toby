import { render } from 'preact';
import { installDebug, markReady } from './app/debug';
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
const params = new URLSearchParams(location.search);
const scene = SCENES.get(params.get('scene') ?? '');

if (!scene || scene.keepTitle) render(<App />, document.getElementById('ui') as HTMLElement);

if (scene) {
  void Promise.resolve(scene.mount(canvas, params)).then((teardown) => {
    if (!teardown) return;
    window.addEventListener('pagehide', () => teardown(), { once: true });
    // A page brought back from the back/forward cache would show a scene that has been
    // torn down; load it afresh instead.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) location.reload();
    });
  });
} else {
  // The real app mounts here in later tasks; for now it is just the title.
  requestAnimationFrame(markReady);
}
