// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pixelPaths } from '../../../src/ui/hud/PixelIcon';
import { HOURGLASS } from '../../../src/ui/screens/pictures';
import { setUiSound } from '../../../src/ui/uiSound';
import { PAUSE_SIGN, WHITE_FLAG, ZZZ } from '../../../src/ui/versus/pictures';
import { RemotePause } from '../../../src/ui/versus/RemotePause';
import type { FaceVM, StallStage } from '../../../src/ui/versus/types';
import { Waiting } from '../../../src/ui/versus/Waiting';

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

const LUKAS: FaceVM = { slot: 'p01', name: 'Lukas', picture: 'peashooter' };
const need = (sel: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(sel);
  if (el === null) throw new Error(`missing ${sel}\n${root.innerHTML.slice(0, 800)}`);
  return el;
};
const drawn = (el: Element): string[] => [...el.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
const paths = (art: Parameters<typeof pixelPaths>[0]): string[] => pixelPaths(art).map((p) => p.d);
const atLeast64 = (el: HTMLElement): void => {
  expect(parseFloat(el.style.minWidth)).toBeGreaterThanOrEqual(64);
  expect(parseFloat(el.style.minHeight)).toBeGreaterThanOrEqual(64);
};

function mount(stage: StallStage, line?: string) {
  const onFlag = vi.fn();
  act(() => render(<Waiting who={LUKAS} stage={stage} portraits={{}} onFlag={onFlag} {...(line !== undefined ? { line } : {})} />, root));
  return onFlag;
}

describe('waiting for the other device', () => {
  it('none: nothing at all', () => {
    mount('none');
    expect(root.innerHTML).toBe('');
  });

  it('hourglass: only a small hourglass (on his base bar), the lawn not dimmed, no face', () => {
    mount('hourglass');
    const glass = need('[data-stall="hourglass"]');
    expect(drawn(glass)).toEqual(paths(HOURGLASS));
    expect(root.querySelector('[data-stall-veil]')).toBeNull();
    expect(root.querySelector('[data-face-of]')).toBeNull();
    expect(root.querySelector('[data-action="flag"]')).toBeNull();
  });

  it('the small hourglass sits on the given side\'s base bar', () => {
    act(() => render(<Waiting who={LUKAS} stage="hourglass" side="plants" portraits={{}} onFlag={() => {}} />, root));
    expect(need('[data-stall="hourglass"]').dataset['side']).toBe('plants');
  });

  it('face: the lawn dims, his face big and asleep (Zzz), a slow hourglass, no flag yet', () => {
    mount('face');
    const veil = need('[data-stall-veil]');
    expect(veil.dataset['stall']).toBe('face');
    const face = need('[data-face-of="p01"] [data-face-pic]');
    expect(parseFloat(face.style.width)).toBeGreaterThanOrEqual(160);
    expect(drawn(need('[data-zzz]'))).toEqual(paths(ZZZ));
    const glass = need('[data-slow-hourglass]');
    expect(glass.dataset['anim']).toBe('slow');
    expect(drawn(glass)).toEqual(paths(HOURGLASS));
    expect(root.querySelector('[data-action="flag"]')).toBeNull();
  });

  it('flag: the same sleeping face plus a white flag button (≥ 64 px) that gives up', () => {
    const onFlag = mount('flag');
    expect(need('[data-stall-veil]').dataset['stall']).toBe('flag');
    expect(root.querySelector('[data-zzz]')).not.toBeNull();
    const flag = need('[data-action="flag"]');
    atLeast64(flag);
    expect(drawn(flag)).toEqual(paths(WHITE_FLAG));
    act(() => flag.click());
    expect(onFlag).toHaveBeenCalledTimes(1);
    expect(sounds).toContain('click');
  });

  it('the one short line is an extra under the face, only when given', () => {
    mount('face');
    expect(root.querySelector('[data-line]')).toBeNull();
    mount('face', "Lukas's iPad is asleep");
    expect(need('[data-line]').textContent).toBe("Lukas's iPad is asleep");
  });

  it('unfinished: nothing (the match has ended; the end screen takes over)', () => {
    mount('unfinished');
    expect(root.innerHTML).toBe('');
  });
});

describe('the other boy paused', () => {
  it('his face with a pause sign, and a Play button (≥ 64 px) that resumes', () => {
    const onResume = vi.fn();
    act(() => render(<RemotePause who={LUKAS} portraits={{}} onResume={onResume} />, root));
    need('[data-screen="vs-paused"]');
    need('[data-face-of="p01"]');
    expect(drawn(need('[data-pause-sign]'))).toEqual(paths(PAUSE_SIGN));
    const play = need('[data-action="resume"]');
    atLeast64(play);
    expect(play.querySelector('.ico--play')).not.toBeNull();
    act(() => play.click());
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(sounds).toContain('click');
  });
});
