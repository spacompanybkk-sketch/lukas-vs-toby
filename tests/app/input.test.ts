// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BattleInput } from '../../src/app/input';
import type { InputTarget, Picked } from '../../src/app/input';
import type { PlacementPreview } from '../../src/render/battle/types';

/** A target that maps client x to a column (100 px each) and y to a lane (100 px each). */
function fakeTarget(live = true) {
  const calls: string[] = [];
  const target = {
    live,
    isLive: vi.fn(() => target.live),
    pick: vi.fn((x: number, y: number): Picked => ({ tile: { lane: Math.floor(y / 100), col: Math.floor(x / 100) }, unitId: null })),
    hover: vi.fn((tile: Picked['tile']): PlacementPreview | null =>
      tile === null ? null : { unit: 'peashooter', lane: tile.lane, col: tile.col, ok: true, mergeTargetId: null }),
    click: vi.fn((tile: Picked['tile']) => {
      calls.push(`click ${tile?.lane},${tile?.col}`);
      return null as ReturnType<InputTarget['click']>;
    }),
    setPreview: vi.fn((p: PlacementPreview | null) => calls.push(p === null ? 'preview none' : `preview ${p.lane},${p.col}`)),
    clearSelection: vi.fn(() => calls.push('clear')),
    hotkey: vi.fn((k: string) => calls.push(`key ${k}`)),
    denied: vi.fn(() => calls.push('denied')),
  };
  return { target, calls };
}

let canvas: HTMLCanvasElement;
let tray: HTMLElement;
let card: HTMLElement;
let input: BattleInput | null = null;
/** Points with y >= 600 are over the card tray, not the lawn. */
const isOverLawn = (_x: number, y: number): boolean => y < 600;

function ptr(type: string, init: { x: number; y: number; id?: number; kind?: string; button?: number; primary?: boolean }, at: EventTarget): void {
  const e = new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: init.x, clientY: init.y, pointerId: init.id ?? 1,
    pointerType: init.kind ?? 'mouse', button: init.button ?? 0, isPrimary: init.primary ?? true,
  });
  at.dispatchEvent(e);
}

beforeEach(() => {
  canvas = document.createElement('canvas');
  tray = document.createElement('div');
  card = document.createElement('button');
  card.dataset.card = 'peashooter';
  const inner = document.createElement('span');
  card.appendChild(inner);
  tray.appendChild(card);
  document.body.append(canvas, tray);
});

afterEach(() => {
  input?.dispose();
  input = null;
  canvas.remove();
  tray.remove();
});

describe('BattleInput', () => {
  it('a mouse click on the lawn acts on the tile where the button is released', () => {
    const { target, calls } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointerdown', { x: 350, y: 250 }, canvas);
    ptr('pointerup', { x: 350, y: 250 }, canvas);
    expect(target.click).toHaveBeenCalledTimes(1);
    expect(calls).toContain('click 2,3');
  });

  it('a hovering mouse shows the preview, and clears it over the tray', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointermove', { x: 450, y: 150 }, canvas);
    expect(target.setPreview).toHaveBeenLastCalledWith(expect.objectContaining({ lane: 1, col: 4 }));
    ptr('pointermove', { x: 450, y: 700 }, tray);
    expect(target.setPreview).toHaveBeenLastCalledWith(null);
  });

  it('a finger shows the preview while down and moving, places on release, then clears it', () => {
    const { target, calls } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointerdown', { x: 150, y: 150, kind: 'touch' }, canvas);
    ptr('pointermove', { x: 250, y: 350, kind: 'touch' }, canvas);
    ptr('pointerup', { x: 250, y: 350, kind: 'touch' }, canvas);
    expect(calls).toEqual(['preview 1,1', 'preview 3,2', 'click 3,2', 'preview none']);
  });

  it('a finger moving with nothing down does not preview (no hover on touch)', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointermove', { x: 150, y: 150, kind: 'touch' }, canvas);
    expect(target.setPreview).not.toHaveBeenCalled();
  });

  it('dragging from a card and letting go over the lawn acts there (the release is heard on the document)', () => {
    const { target, calls } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    const inner = card.firstElementChild as HTMLElement;
    ptr('pointerdown', { x: 100, y: 700, kind: 'touch' }, inner);
    // The card holds the pointer: move and up are dispatched at the card, not the canvas.
    ptr('pointermove', { x: 420, y: 330, kind: 'touch' }, card);
    ptr('pointerup', { x: 420, y: 330, kind: 'touch' }, card);
    expect(calls).toEqual(['preview 3,4', 'click 3,4', 'preview none']);
  });

  for (const [attr, value] of [['hero', 'plants'], ['spell', 'thunderbolt']] as const) {
    it(`dragging from the ${attr} button and letting go over the lawn acts there, like a card`, () => {
      const { target, calls } = fakeTarget();
      input = new BattleInput(target, { canvas, isOverLawn });
      const button = document.createElement('button');
      button.dataset[attr] = value;
      tray.appendChild(button);
      ptr('pointerdown', { x: 100, y: 700, kind: 'touch' }, button);
      ptr('pointermove', { x: 220, y: 130, kind: 'touch' }, button);
      ptr('pointerup', { x: 220, y: 130, kind: 'touch' }, button);
      expect(calls).toEqual(['preview 1,2', 'click 1,2', 'preview none']);
    });
  }

  it('forwards H, Q and W (either case) for the hero and the two spells', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    for (const key of ['h', 'Q', 'w', 'e']) window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    expect(target.hotkey.mock.calls.map((c) => c[0])).toEqual(['h', 'Q', 'w']);
  });

  it('a tap on a card (released over the tray) does not act on the lawn', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointerdown', { x: 100, y: 700 }, card);
    ptr('pointerup', { x: 100, y: 700 }, card);
    expect(target.click).not.toHaveBeenCalled();
  });

  it('a press elsewhere in the HUD (not a card) is ignored', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointerdown', { x: 100, y: 100 }, tray);
    ptr('pointerup', { x: 100, y: 100 }, canvas);
    expect(target.click).not.toHaveBeenCalled();
  });

  it('a second finger neither acts nor breaks the first finger\'s drag', () => {
    const { target, calls } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointerdown', { x: 100, y: 700, id: 1, kind: 'touch' }, card);
    ptr('pointerdown', { x: 550, y: 50, id: 2, kind: 'touch', primary: false }, canvas);
    ptr('pointermove', { x: 560, y: 60, id: 2, kind: 'touch', primary: false }, canvas);
    ptr('pointerup', { x: 560, y: 60, id: 2, kind: 'touch', primary: false }, canvas);
    ptr('pointermove', { x: 220, y: 120, id: 1, kind: 'touch' }, card);
    ptr('pointerup', { x: 220, y: 120, id: 1, kind: 'touch' }, card);
    expect(calls).toEqual(['preview 1,2', 'click 1,2', 'preview none']);
  });

  it('a cancelled touch clears the preview and does nothing', () => {
    const { target, calls } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointerdown', { x: 150, y: 150, kind: 'touch' }, canvas);
    ptr('pointercancel', { x: 150, y: 150, kind: 'touch' }, canvas);
    ptr('pointerup', { x: 150, y: 150, kind: 'touch' }, canvas);
    expect(calls).toEqual(['preview 1,1', 'preview none']);
  });

  it('a right click on the lawn drops the selection', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointerdown', { x: 150, y: 150, button: 2 }, canvas);
    expect(target.clearSelection).toHaveBeenCalledTimes(1);
    expect(target.click).not.toHaveBeenCalled();
  });

  it('a refused tap reports the denial; an ignored one does not', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    target.click.mockReturnValueOnce('occupied').mockReturnValueOnce('ignored');
    ptr('pointerdown', { x: 150, y: 150 }, canvas);
    ptr('pointerup', { x: 150, y: 150 }, canvas);
    ptr('pointerdown', { x: 150, y: 150 }, canvas);
    ptr('pointerup', { x: 150, y: 150 }, canvas);
    expect(target.denied).toHaveBeenCalledTimes(1);
  });

  it('a tap off the lawn (nothing picked) is not a click', () => {
    const { target } = fakeTarget();
    target.pick.mockReturnValue({ tile: null, unitId: null });
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointerdown', { x: 5, y: 5 }, canvas);
    ptr('pointerup', { x: 5, y: 5 }, canvas);
    expect(target.click).not.toHaveBeenCalled();
  });

  it('passes a picked unit on, for merging', () => {
    const { target } = fakeTarget();
    target.pick.mockReturnValue({ tile: { lane: 2, col: 3 }, unitId: 17 });
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointerdown', { x: 350, y: 250 }, canvas);
    ptr('pointerup', { x: 350, y: 250 }, canvas);
    expect(target.click).toHaveBeenCalledWith({ lane: 2, col: 3 }, 17);
  });

  it('ignores the pointer while the battle is not live', () => {
    const { target } = fakeTarget(false);
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointermove', { x: 150, y: 150 }, canvas);
    ptr('pointerdown', { x: 150, y: 150 }, canvas);
    ptr('pointerup', { x: 150, y: 150 }, canvas);
    expect(target.click).not.toHaveBeenCalled();
    expect(target.setPreview).not.toHaveBeenCalled();
  });

  it('forwards 1–0, Escape and Space (once per press) and nothing else', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    for (const key of ['1', '0', 'Escape', ' ', 'a', 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true }));
    expect(target.hotkey.mock.calls.map((c) => c[0])).toEqual(['1', '0', 'Escape', ' ']);
  });

  it('Space does not scroll the page', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    const e = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('stops listening when disposed', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    input.dispose();
    ptr('pointerdown', { x: 150, y: 150 }, canvas);
    ptr('pointerup', { x: 150, y: 150 }, canvas);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    expect(target.click).not.toHaveBeenCalled();
    expect(target.hotkey).not.toHaveBeenCalled();
  });

  it('refresh shows the preview again where the mouse last was', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointermove', { x: 450, y: 150 }, canvas);
    target.setPreview.mockClear();
    input.refresh();
    expect(target.setPreview).toHaveBeenCalledWith(expect.objectContaining({ lane: 1, col: 4 }));
  });

  it('a press whose release was lost (window blur) is forgotten, so the next tap works', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointerdown', { x: 150, y: 150, id: 7, kind: 'touch' }, canvas);
    window.dispatchEvent(new Event('blur'));
    expect(target.setPreview).toHaveBeenLastCalledWith(null);
    ptr('pointerdown', { x: 250, y: 250, id: 8, kind: 'touch' }, canvas);
    ptr('pointerup', { x: 250, y: 250, id: 8, kind: 'touch' }, canvas);
    expect(target.click).toHaveBeenCalledTimes(1);
  });

  it('the tab being hidden mid-press forgets the press too', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    ptr('pointerdown', { x: 150, y: 150, id: 3, kind: 'touch' }, canvas);
    document.dispatchEvent(new Event('visibilitychange'));
    ptr('pointerup', { x: 150, y: 150, id: 3, kind: 'touch' }, canvas);
    expect(target.click).not.toHaveBeenCalled();
    ptr('pointerdown', { x: 150, y: 150, id: 4, kind: 'touch' }, canvas);
    ptr('pointerup', { x: 150, y: 150, id: 4, kind: 'touch' }, canvas);
    expect(target.click).toHaveBeenCalledTimes(1);
  });

  it('keys do nothing while the battle is not live', () => {
    const { target } = fakeTarget(false);
    input = new BattleInput(target, { canvas, isOverLawn });
    for (const key of ['1', ' ', 'Escape']) window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    expect(target.hotkey).not.toHaveBeenCalled();
  });

  it('Space blurs a focused button and stops its keyup from pressing it', () => {
    const { target } = fakeTarget();
    input = new BattleInput(target, { canvas, isOverLawn });
    card.focus();
    expect(document.activeElement).toBe(card);
    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(document.activeElement).not.toBe(card);
    const up = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
    card.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(target.hotkey).toHaveBeenCalledWith(' ');
  });
});
