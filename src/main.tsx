import { render } from 'preact';
import { installDebug, markReady } from './app/debug';
import * as boot from './scenes/boot';
import * as lawn from './scenes/lawn';
import { App } from './ui/App';
import './ui/theme.css';

/** A development scene, opened with `?scene=<name>`. It calls `markReady()` once it has drawn. */
interface SceneModule {
  mount(canvas: HTMLCanvasElement, params: URLSearchParams): void | Promise<void>;
  /** True if the game title should stay on screen over the scene. */
  keepTitle?: boolean;
}

const SCENES: Record<string, SceneModule> = { boot, lawn };

installDebug();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const scene = SCENES[params.get('scene') ?? ''];

if (!scene || scene.keepTitle) render(<App />, document.getElementById('ui') as HTMLElement);

if (scene) {
  void scene.mount(canvas, params);
} else {
  // The real app mounts here in later tasks; for now it is just the title.
  requestAnimationFrame(markReady);
}
