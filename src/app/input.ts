import type { CommandRejection } from '../sim/types';
import type { PlacementPreview } from '../render/battle/types';

export type Tile = { lane: number; col: number };
/** What lies under a point on the screen: a lawn tile (or null off the lawn) and a unit, if any. */
export interface Picked { tile: Tile | null; unitId: number | null }

/** What the input drives. `BattleSession` implements it with the controller and the view. */
export interface InputTarget {
  /** False before the battle begins and after it ends: the lawn ignores the pointer. */
  isLive(): boolean;
  pick(clientX: number, clientY: number): Picked;
  hover(tile: Tile | null, unitId: number | null): PlacementPreview | null;
  click(tile: Tile | null, unitId: number | null): CommandRejection | 'ignored' | null;
  setPreview(p: PlacementPreview | null): void;
  /** A right click on the lawn: drop the card or the shovel. */
  clearSelection(): void;
  hotkey(key: string): void;
  /** A tap was refused (the tray shakes by itself; this is for the sound). */
  denied(reason: CommandRejection): void;
}

export interface InputOptions {
  canvas: HTMLElement;
  doc?: Document;
  win?: Window;
  /**
   * True when the point shows the lawn, not a HUD block over it. Defaults to asking the document
   * which element is there: the HUD layer lets the pointer through everywhere but its blocks.
   */
  isOverLawn?(clientX: number, clientY: number): boolean;
}

const HOTKEYS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Escape', ' ']);

type Source = 'lawn' | 'card';
interface Active { id: number; source: Source; mouse: boolean }

/**
 * Pointer and keyboard input for a battle, touch first. Everything works by tap or drag alone:
 *
 * - Tap a card (the tray selects it), then tap the lawn: on release the tap places, merges or
 *   shovels where the finger lifted.
 * - Drag from a card and let go over the lawn: the same, where it was let go. The card has the
 *   pointer captured, so the release is heard at document level and hit-tested by position.
 * - While a card is selected the ghost and tile highlight follow a hovering mouse, or a finger
 *   while it is down (so a child sees where it will go before lifting).
 * - Only one pointer at a time: a second finger is ignored and does not break the first's drag.
 * - A right click on the lawn drops the selection. Keys 1–0, Escape and Space are extras.
 */
export class BattleInput {
  private readonly target: InputTarget;
  private readonly canvas: HTMLElement;
  private readonly doc: Document;
  private readonly win: Window;
  private readonly overLawn: (x: number, y: number) => boolean;
  private active: Active | null = null;
  /** Where the preview was last asked for: a hovering mouse, or the finger that is down. */
  private last: { x: number; y: number } | null = null;

  constructor(target: InputTarget, opts: InputOptions) {
    this.target = target;
    this.canvas = opts.canvas;
    this.doc = opts.doc ?? document;
    this.win = opts.win ?? window;
    this.overLawn = opts.isOverLawn ?? ((x, y) => this.doc.elementFromPoint?.(x, y) === this.canvas);
    this.doc.addEventListener('pointerdown', this.onDown, true);
    this.doc.addEventListener('pointermove', this.onMove, true);
    this.doc.addEventListener('pointerup', this.onUp, true);
    this.doc.addEventListener('pointercancel', this.onCancel, true);
    this.doc.addEventListener('pointerout', this.onOut, true);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.win.addEventListener('keydown', this.onKey);
  }

  /** Shows the preview again at the last known point (after a step, or a change of card). */
  refresh(): void {
    if (this.last === null || !this.target.isLive()) return;
    this.previewAt(this.last.x, this.last.y);
  }

  /** Stops listening and clears the preview. */
  dispose(): void {
    this.doc.removeEventListener('pointerdown', this.onDown, true);
    this.doc.removeEventListener('pointermove', this.onMove, true);
    this.doc.removeEventListener('pointerup', this.onUp, true);
    this.doc.removeEventListener('pointercancel', this.onCancel, true);
    this.doc.removeEventListener('pointerout', this.onOut, true);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.win.removeEventListener('keydown', this.onKey);
    this.active = null;
    this.last = null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.target.isLive() || this.active !== null) return; // one pointer at a time
    const mouse = e.pointerType === 'mouse';
    const node = e.target as Node | null;
    const onCanvas = node === this.canvas;
    if (mouse && e.button === 2 && onCanvas) {
      this.target.clearSelection();
      this.clearPreview();
      return;
    }
    if (!e.isPrimary || (mouse && e.button !== 0)) return;
    const card = !onCanvas && node instanceof Element ? node.closest('[data-card]') : null;
    if (!onCanvas && card === null) return;
    this.active = { id: e.pointerId, source: onCanvas ? 'lawn' : 'card', mouse };
    if (onCanvas) {
      if (!mouse) e.preventDefault(); // no emulated mouse events, no double-tap zoom
      this.previewAt(e.clientX, e.clientY);
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.target.isLive()) return;
    if (this.active !== null) {
      if (e.pointerId === this.active.id) this.previewAt(e.clientX, e.clientY);
      return;
    }
    if (e.pointerType === 'mouse') this.previewAt(e.clientX, e.clientY);
  };

  private readonly onUp = (e: PointerEvent): void => {
    const active = this.active;
    if (active === null || e.pointerId !== active.id) return;
    this.active = null;
    if (!this.target.isLive()) return;
    if (this.overLawn(e.clientX, e.clientY)) this.act(e.clientX, e.clientY);
    if (active.mouse) this.previewAt(e.clientX, e.clientY);
    else this.clearPreview(); // the finger has gone: nothing is hovering any more
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (this.active === null || e.pointerId !== this.active.id) return;
    this.active = null;
    this.clearPreview();
  };

  /** The mouse left the window. */
  private readonly onOut = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.relatedTarget === null && this.active === null) this.clearPreview();
  };

  private readonly onContextMenu = (e: Event): void => e.preventDefault();

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!HOTKEYS.has(e.key) || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    // Space pauses; it must not also scroll or press whichever button last had focus.
    if (e.key === ' ') {
      e.preventDefault();
      (this.doc.activeElement as HTMLElement | null)?.blur?.();
    }
    this.target.hotkey(e.key);
    if (e.key === 'Escape') this.refresh();
  };

  private act(x: number, y: number): void {
    const { tile, unitId } = this.target.pick(x, y);
    if (tile === null && unitId === null) return; // off the lawn: the sky, the sea
    const r = this.target.click(tile, unitId);
    if (r !== null && r !== 'ignored' && r !== 'match-over') this.target.denied(r);
  }

  private previewAt(x: number, y: number): void {
    this.last = { x, y };
    if (!this.overLawn(x, y)) {
      this.target.setPreview(null);
      return;
    }
    const { tile, unitId } = this.target.pick(x, y);
    this.target.setPreview(tile === null && unitId === null ? null : this.target.hover(tile, unitId));
  }

  private clearPreview(): void {
    this.last = null;
    this.target.setPreview(null);
  }
}
