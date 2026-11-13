import { useEffect, useRef } from 'preact/hooks';
import type { ReadonlySignal } from '@preact/signals';
import type { GloveAim, GloveVM } from '../../app/tutorial';
import { outlined } from '../screens/pictures';
import { PixelIcon } from './PixelIcon';
import type { PixelArt } from './PixelIcon';
import './tutorial.css';

/**
 * The tutorial's glove (plan Task 6): a boxy white glove that hops and taps at the step's target,
 * with a pulsing boxy outline round the target and the rest of the screen dimmed a little while the
 * match is held. No words: the glove is the whole lesson. It takes no taps itself; the tap goes to
 * whatever is under it.
 *
 * The glove's element carries where it points, for tests: `data-glove` (the aim's kind),
 * `data-glove-step` (the step id), `data-glove-x` / `data-glove-y` (client pixels of the point to
 * tap) and `data-holding`.
 */

/** The glove pointing up (drawn the usual way), turned upside down below: it points down. */
const GLOVE_UP = [
  '.....oo.........',
  '....owwo........',
  '....owwo........',
  '....owwo........',
  '....owwoooo.....',
  '....owwowwoooo..',
  '.oo.owwowwowwoo.',
  'owwoowwwwwwowwmo',
  'owwwowwwwwwwwwmo',
  '.owwwwwwwwwwwwmo',
  '..owwwwwwwwwwwmo',
  '..owwwwwwwwwwmo.',
  '...owwwwwwwwwmo.',
  '...osssssssssso.',
  '...osSSSSSSSSso.',
  '...oooooooooooo.',
];

/** A boxy white glove with a dark outline and a grey cuff, index finger pointing down. */
export const GLOVE: PixelArt = Object.freeze({
  rows: Object.freeze([...GLOVE_UP].reverse()),
  palette: Object.freeze({ o: '#2A1B0E', w: '#FFFFFF', m: '#C3CAD3', s: '#C3CAD3', S: '#6B7480' }),
});

/** Where the fingertip is in the glove picture (shares of its width and height). */
const TIP = { x: 6 / 16, y: 1 };

/** What the glove needs from the battle session: lawn points in client pixels. */
export interface GloveHost {
  tileToClient?(lane: number, col: number): { x: number; y: number } | null;
  unitToClient?(id: number): { x: number; y: number } | null;
}

/** The target's middle (`x`, `y`: where a tap goes), its size, and where the fingertip rests (`ty`). */
interface Box { x: number; y: number; w: number; h: number; ty: number; tx?: number }

/** The selector of an aim's HTML target (a card, the hero, a spell button), or null for a lawn aim. */
function targetSelector(aim: GloveAim): string | null {
  switch (aim.kind) {
    case 'card': return `[data-hud="tray"] [data-card="${aim.card}"], [data-hud="belt"] [data-card="${aim.card}"]`;
    case 'hero': return '[data-hero]';
    case 'spell': return `[data-spell="${aim.key}"]`;
    default: return null;
  }
}

/** An HTML target's box (client pixels), or null when it has no size. */
function elementBox(el: Element): Box | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, ty: r.top + r.height * 0.22 };
}

/** A lawn target's box (client pixels) through the battle's camera, or null when it is not there. */
function lawnBox(aim: GloveAim, host: GloveHost): Box | null {
  switch (aim.kind) {
    case 'tile': {
      const p = host.tileToClient?.(aim.lane, aim.col) ?? null;
      const q = host.tileToClient?.(aim.lane, aim.col + 1) ?? null;
      if (p === null) return null;
      const w = q === null ? 64 : Math.max(40, Math.abs(q.x - p.x));
      return { x: p.x, y: p.y, w, h: w * 0.72, ty: p.y };
    }
    case 'unit': {
      const p = host.unitToClient?.(aim.unitId) ?? null;
      const t = host.tileToClient?.(0, 0) ?? null;
      const u = host.tileToClient?.(0, 1) ?? null;
      if (p === null) return null;
      const w = t === null || u === null ? 64 : Math.max(40, Math.abs(u.x - t.x));
      // From the side, at the body: the level-up arrow over the unit's head stays in sight.
      return { x: p.x, y: p.y, w, h: w * 1.1, ty: p.y, tx: p.x - w * 0.38 };
    }
    default: return null;
  }
}

/** Frames after an aim appears (or the window changes) during which an HTML target is measured every frame (its pop-in settling). */
const SETTLE_FRAMES = 20;
/** After that, an HTML target is measured again this often (frames) in case the layout moved it. */
const RECHECK_FRAMES = 30;

/**
 * The glove over the battle. Re-renders only when the step or its aim changes; every animation
 * frame it places the glove and the outline from the target's box (writing only on a change). A
 * card, hero or spell target's box is read from the page only while it settles, on a resize, and
 * every half second; a lawn target's comes from the camera each frame.
 * Hidden while `hidden` is true (the pause menu, the result).
 */
export function PointingHand({ glove, host, hidden }: { glove: ReadonlySignal<GloveVM | null>; host: GloveHost; hidden: boolean }) {
  const vm = glove.value;
  const handRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const aim = vm?.aim ?? null;

  useEffect(() => {
    if (aim === null) return undefined;
    // What was last written, as six rounded numbers (no string or object built each frame).
    const last = [Number.NaN, 0, 0, 0, 0, 0];
    let raf = 0;
    const selector = targetSelector(aim);
    // An HTML target is found once (again only when it leaves the page) and measured while it
    // settles, on a resize or a visual-viewport change, and otherwise only now and then; a lawn
    // target follows the camera and the units every frame (a projection, no layout read).
    let el: Element | null = null;
    let box: Box | null = null;
    let measureFor = SETTLE_FRAMES;
    let frame = 0;
    const remeasure = (): void => { measureFor = SETTLE_FRAMES; };
    const viewport = window.visualViewport ?? null;
    window.addEventListener('resize', remeasure);
    viewport?.addEventListener('resize', remeasure);
    viewport?.addEventListener('scroll', remeasure);
    const place = (): void => {
      raf = requestAnimationFrame(place);
      const hand = handRef.current;
      const mark = markRef.current;
      if (hand === null || mark === null) return;
      frame += 1;
      if (selector === null) {
        box = lawnBox(aim, host);
      } else {
        if (el === null || !el.isConnected) {
          const root = hand.closest('[data-screen="battle"]') ?? document;
          el = root.querySelector(selector);
          measureFor = SETTLE_FRAMES;
        }
        if (el === null) box = null;
        else if (measureFor > 0 || frame % RECHECK_FRAMES === 0) {
          measureFor = Math.max(0, measureFor - 1);
          box = elementBox(el);
        }
      }
      if (box === null) {
        if (last[0] === -1) return;
        last[0] = -1;
        hand.style.visibility = 'hidden';
        mark.style.visibility = 'hidden';
        hand.removeAttribute('data-glove-x');
        hand.removeAttribute('data-glove-y');
        return;
      }
      const x = Math.round(box.x);
      const y = Math.round(box.y);
      const w = Math.round(box.w);
      const h = Math.round(box.h);
      const ty = Math.round(box.ty);
      const tx = Math.round(box.tx ?? box.x);
      if (last[0] === x && last[1] === y && last[2] === w && last[3] === h && last[4] === ty && last[5] === tx) return;
      last[0] = x; last[1] = y; last[2] = w; last[3] = h; last[4] = ty; last[5] = tx;
      hand.style.visibility = '';
      mark.style.visibility = '';
      hand.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      mark.style.transform = `translate3d(${Math.round(box.x - box.w / 2)}px, ${Math.round(box.y - box.h / 2)}px, 0)`;
      mark.style.width = `${w}px`;
      mark.style.height = `${h}px`;
      hand.dataset.gloveX = String(x);
      hand.dataset.gloveY = String(y);
    };
    place();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', remeasure);
      viewport?.removeEventListener('resize', remeasure);
      viewport?.removeEventListener('scroll', remeasure);
    };
  }, [aim, host]);

  if (vm === null) return null;
  const lawn = vm.aim.kind === 'tile' || vm.aim.kind === 'unit';
  return (
    <div class={`tut${vm.holding ? ' is-holding' : ''}${hidden ? ' is-hidden' : ''}`} data-tutorial aria-hidden="true">
      <div ref={markRef} class={`tut-mark${lawn ? ' tut-mark--lawn' : ''}`} style={{ visibility: 'hidden' }} />
      <div
        ref={handRef} class="tut-hand" style={{ visibility: 'hidden' }}
        data-glove={vm.aim.kind} data-glove-step={vm.step} data-holding={vm.holding ? 'true' : 'false'}
      >
        <span class={`tut-hand__turn${vm.aim.kind === 'unit' ? ' is-side' : ''}`}>
          <span class="tut-hand__pic" style={{ '--tip-x': `${TIP.x * 100}%`, '--tip-y': `${TIP.y * 100}%` }}>
            <PixelIcon art={GLOVE} />
          </span>
        </span>
      </div>
    </div>
  );
}
