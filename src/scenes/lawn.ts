import { installDebug, markReady } from '../app/debug';
import { GameLoop } from '../game/GameLoop';
import { Renderer, type Quality } from '../render/Renderer';
import { Lawn } from '../render/world/Lawn';
import { Sky } from '../render/world/Sky';
import { dressWorld } from '../app/Stage';
import { worldParams } from './worldParams';

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

/** Frames drawn before the scene reports ready, so shadows and post-processing buffers are filled. */
const WARM_UP_FRAMES = 4;

/**
 * The lawn on its own: island, sky, lights and post-processing, no units.
 * `&t=<seconds>` freezes time for stable screenshots; `&quality=low|medium|high` picks the
 * quality level (default high). Without `t` the intro camera plays and the mouse leans the view.
 * Returns a function that stops the scene and frees everything it made.
 */
export function mount(canvas: HTMLCanvasElement, params: URLSearchParams): () => void {
  const asked = params.get('quality') as Quality | null;
  const renderer = new Renderer(canvas, asked && QUALITIES.includes(asked) ? asked : 'high');
  const lawn = new Lawn();
  const sky = new Sky();
  renderer.scene.add(sky.group, lawn.group);
  const { world, lawn: twist } = worldParams(params);
  dressWorld({ lawn, sky, renderer }, world, twist);

  const lvt = installDebug();
  lvt.renderer = renderer;
  lvt.lawn = lawn;

  const frozenAt = params.has('t') ? Number(params.get('t')) || 0 : null;
  let time = 0;
  let frames = 0;
  const loop = new GameLoop({
    step() {},
    frame(_alpha, realDt, gameDt) {
      // The world keeps game time; the camera keeps real time.
      time = frozenAt ?? time + gameDt;
      lawn.update(time);
      sky.update(time);
      renderer.render(frozenAt === null ? realDt : 0);
      if (++frames === WARM_UP_FRAMES) markReady();
    },
  });

  const onResize = (): void => renderer.resize();
  const onPointerMove = (event: PointerEvent): void => {
    renderer.rig.setParallax((event.clientX / window.innerWidth) * 2 - 1, 1 - (event.clientY / window.innerHeight) * 2);
  };
  window.addEventListener('resize', onResize);
  if (frozenAt === null) {
    window.addEventListener('pointermove', onPointerMove);
    void renderer.rig.playIntro(2.4);
  }
  loop.start();

  return () => {
    loop.stop();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onPointerMove);
    renderer.scene.remove(sky.group, lawn.group);
    lawn.dispose();
    sky.dispose();
    renderer.dispose();
    if (lvt.renderer === renderer) delete lvt.renderer;
    if (lvt.lawn === lawn) delete lvt.lawn;
  };
}
