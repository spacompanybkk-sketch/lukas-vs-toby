import { render } from 'preact';
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { installDebug, markReady } from './app/debug';
import { App } from './ui/App';
import './ui/theme.css';

/** A lit, slowly spinning green cube: proves the renderer, lights and fonts work. */
function mountBoot(canvas: HTMLCanvasElement): void {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new Scene();
  scene.background = new Color('#1b2430');

  const camera = new PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(2.6, 2.2, 3.4);
  camera.lookAt(0, 0, 0);

  const cube = new Mesh(
    new BoxGeometry(1.4, 1.4, 1.4),
    new MeshStandardMaterial({ color: '#58c13b', roughness: 0.7 }),
  );
  cube.rotation.y = 0.5;
  scene.add(cube);

  scene.add(new AmbientLight('#ffffff', 0.9));
  const sun = new DirectionalLight('#fff4d6', 2.4);
  sun.position.set(3, 5, 2);
  scene.add(sun);

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let first = true;
  let last = performance.now();
  renderer.setAnimationLoop((now: number) => {
    cube.rotation.y += ((now - last) / 1000) * 0.6;
    last = now;
    renderer.render(scene, camera);
    if (first) {
      first = false;
      markReady();
    }
  });
}

installDebug();

const canvas = document.getElementById('game') as HTMLCanvasElement;
render(<App />, document.getElementById('ui') as HTMLElement);

switch (new URLSearchParams(location.search).get('scene')) {
  case 'boot':
    mountBoot(canvas);
    break;
  default:
    // The real app mounts here in later tasks; for now it is just the title.
    requestAnimationFrame(markReady);
}
