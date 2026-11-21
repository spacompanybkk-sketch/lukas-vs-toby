// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pixelPaths } from '../../../src/ui/hud/PixelIcon';
import { SWORDS } from '../../../src/ui/screens/boardPictures';
import { HOURGLASS } from '../../../src/ui/screens/pictures';
import { setUiSound } from '../../../src/ui/uiSound';
import { BENCH } from '../../../src/ui/versus/pictures';
import type { HereVM } from '../../../src/ui/versus/types';
import { WhoIsHere } from '../../../src/ui/versus/WhoIsHere';

let root: HTMLElement;
let sounds: string[];

beforeEach(() => {
  sounds = [];
  setUiSound((n) => sounds.push(n));
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => render(null, root));
  root.remove();
  setUiSound(null);
});

const need = (sel: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 600)}`);
  return el;
};
const drawn = (el: Element): string[] => [...el.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
const paths = (art: Parameters<typeof pixelPaths>[0]): string[] => pixelPaths(art).map((p) => p.d);

const LUKAS: HereVM = { slot: 'p01', name: 'Lukas', picture: 'peashooter', busy: false };
const MIA: HereVM = { slot: 'p03', name: 'Mia', picture: 'sunflower', busy: true };

function mount(faces: HereVM[]) {
  const onPick = vi.fn();
  const onBack = vi.fn();
  act(() => render(<WhoIsHere faces={faces} portraits={{ peashooter: '/pea.png' }} onPick={onPick} onBack={onBack} />, root));
  return { onPick, onBack };
}

describe('who is here', () => {
  it('one big face per player (120 px) with his name underneath; a tap picks him', () => {
    const { onPick } = mount([LUKAS, MIA]);
    const faces = [...root.querySelectorAll<HTMLElement>('[data-face]')];
    expect(faces.map((f) => f.dataset.face)).toEqual(['p01', 'p03']);
    for (const f of faces) {
      const pic = f.querySelector<HTMLElement>('[data-face-pic]')!;
      expect(pic.style.width).toBe('120px');
      expect(pic.style.height).toBe('120px');
      const name = f.querySelector<HTMLElement>('[data-face-name]')!;
      // The name comes after (under) the picture.
      expect(pic.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(need('[data-face="p01"] [data-face-name]').textContent).toBe('Lukas');
    expect(need('[data-face="p01"] img').getAttribute('src')).toBe('/pea.png');
    act(() => need('[data-face="p01"]').click());
    expect(onPick).toHaveBeenCalledWith('p01');
    expect(sounds).toContain('click');
  });

  it('a face in a battle is greyed with a swords badge, and a tap does nothing', () => {
    const { onPick } = mount([LUKAS, MIA]);
    const busy = need('[data-face="p03"]');
    expect(busy.hasAttribute('data-busy')).toBe(true);
    expect(drawn(need('[data-face="p03"] [data-busy-badge]'))).toEqual(paths(SWORDS));
    expect(root.querySelector('[data-face="p01"]')!.hasAttribute('data-busy')).toBe(false);
    expect(root.querySelector('[data-face="p01"] [data-busy-badge]')).toBeNull();
    act(() => busy.click());
    expect(onPick).not.toHaveBeenCalled();
    expect(sounds).toEqual([]);
  });

  it('nobody here: an empty bench and a bouncing hourglass', () => {
    mount([]);
    expect(root.querySelector('[data-face]')).toBeNull();
    const bench = need('[data-empty-bench]');
    expect(drawn(need('[data-empty-bench] [data-bench]'))).toEqual(paths(BENCH));
    const glass = need('[data-empty-bench] [data-hourglass]');
    expect(glass.dataset.anim).toBe('bounce');
    expect(drawn(glass)).toEqual(paths(HOURGLASS));
    expect(bench).toBeDefined();
  });

  it('the list fills itself when someone arrives', () => {
    const onPick = vi.fn();
    act(() => render(<WhoIsHere faces={[]} portraits={{}} onPick={onPick} onBack={() => {}} />, root));
    expect(root.querySelector('[data-empty-bench]')).not.toBeNull();
    act(() => render(<WhoIsHere faces={[LUKAS]} portraits={{}} onPick={onPick} onBack={() => {}} />, root));
    expect(root.querySelector('[data-empty-bench]')).toBeNull();
    expect(root.querySelector('[data-face="p01"]')).not.toBeNull();
  });

  it('the back arrow calls onBack', () => {
    const { onBack } = mount([LUKAS]);
    act(() => need('[data-action="back"]').click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
