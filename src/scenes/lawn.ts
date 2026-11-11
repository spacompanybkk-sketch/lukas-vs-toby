import { installDebug, markReady } from '../app/debug';
import { GameLoop } from '../game/GameLoop';
import { Renderer, type Quality } from '../render/Renderer';
import { Lawn } from '../render/world/Lawn';
import { Sky } from '../render/world/Sky';

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

/** Frames drawn before the scene reports ready, so shadows and post-processing buffers are filled. */
const WARM_UP_FRAMES = 4;

/**
 * The lawn on its own: island, sky, lights and post-processing, no units.
 * `&t=<seconds>` freezes time for stable screenshots; `&quality=low|medium|high` picks the
 * quality level (default high). Without `t` the intro camera plays and the mouse leans the view.
 */
export function mount(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const asked = params.get('quality') as Quality | null;
  const renderer = new Renderer(canvas, asked && QUALITIES.includes(asked) ? asked : 'high');
  const lawn = new Lawn();
  const sky = new Sky();
  renderer.scene.add(sky.group, lawn.group);

  const lvt = installDebug();
  lvt.renderer = renderer;
  lvt.lawn = lawn;

  const frozenAt = params.has('t') ? Number(params.get('t')) || 0 : null;
  let time = 0;
  let frames = 0;
  const loop = new GameLoop({
    step() {},
    frame(_alpha, dtSeconds) {
      time = frozenAt ?? time + dtSeconds;
      lawn.update(time);
      sky.update(time);
      renderer.render(frozenAt === null ? dtSeconds : 0);
      if (++frames === WARM_UP_FRAMES) markReady();
    },
  });

  window.addEventListener('resize', () => renderer.resize());
  if (frozenAt === null) {
    window.addEventListener('pointermove', (event) => {
      renderer.rig.setParallax((event.clientX / window.innerWidth) * 2 - 1, 1 - (event.clientY / window.innerHeight) * 2);
    });
    void renderer.rig.playIntro(2.4);
  }
  loop.start();
}
