import { useEffect, useState } from 'preact/hooks';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraRig } from '../../render/CameraRig';

/**
 * Sizes for the bottom bar (card tray, hero button, spell buttons), worked out from the window:
 * the bar must fit across between the side gutters and stay below the near edge of lanes 0–4 as
 * the battle camera frames the lawn for this window. Real iPad Safari windows (address bar
 * showing) are shorter than the screen, so both limits matter.
 *
 * The numbers here are the CSS lengths the bar is drawn with (they go in as custom properties),
 * so the fit computed is the fit drawn.
 */
export interface TrayLayout {
  rows: 1 | 2;
  cols: number;
  /** Card width in CSS px (height is CARD_ASPECT times this). */
  card: number;
  /** Gap between cards. */
  gap: number;
  hero: number;
  spell: number;
  /** Gap between the tray and the powers. */
  barGap: number;
}

export interface Viewport {
  width: number;
  height: number;
  /** Side and bottom gutters (safe areas included). */
  gutterX: number;
  gutterBottom: number;
}

export const CARD_ASPECT = 1.27;
const ROW_MAX = 5;
const CARD_MAX = 124;
/** The tray's padding left and right (bevel + 10 px each side) and top and bottom (bevel + 8). */
const TRAY_PAD_X = 28;
const TRAY_PAD_Y = 24;
const LIP = 5;
/** Two rows sit this far apart (room for a raised card in the lower one). */
const ROW_GAP = 12;
/** The selected card rises by this share of its height, and its outline reaches this far out. */
const LIFT = [0, 0.14, 0.08] as const;
const OUTLINE = 7;
/** The shovel is this share of a card wide, and sits two gaps from the cards. */
const SHOVEL = 0.9;
/** The bar's bottom sits one ink line above the bottom gutter. */
const BOTTOM_LINE = 3;
/** Kept clear between the bar's top and the near edge of the lanes. */
const LAWN_MARGIN = 8;
/** Rounding slack across the width. */
const SLACK_X = 4;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function heroFor(rows: 1 | 2, card: number): number {
  return rows === 1 ? CARD_ASPECT * card + TRAY_PAD_Y : 2 * card;
}

function widthFor(rows: 1 | 2, count: number, card: number, gap: number, barGap: number, powers: boolean): number {
  const cols = Math.max(1, Math.ceil(count / rows));
  const tray = cols * card + (cols - 1) * gap + SHOVEL * card + 2 * gap + TRAY_PAD_X;
  if (!powers) return tray;
  const hero = heroFor(rows, card);
  const spell = (hero - gap - LIP) / 2;
  return tray + barGap + hero + gap + spell;
}

/** A selected hero or spell rises by this share of its size, with its outline this far out. */
const POWER_LIFT = 0.08;
const POWER_OUTLINE = 12;

function heightFor(rows: 1 | 2, card: number, powers: boolean): number {
  const h = CARD_ASPECT * card;
  const tray = rows * (h + LIP) + (rows - 1) * ROW_GAP + TRAY_PAD_Y;
  // A raised card's outline may poke above the tray's top edge.
  const poke = Math.max(0, LIFT[rows] * h + OUTLINE - TRAY_PAD_Y / 2);
  if (!powers) return tray + poke;
  const hero = heroFor(rows, card);
  return Math.max(tray + poke, hero + LIP + POWER_LIFT * hero + POWER_OUTLINE);
}

/** The y (CSS px from the top) of the near edge of lanes 0–4, as the battle camera frames them. */
export function lawnFrontY(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return height * 0.66;
  const camera = new PerspectiveCamera(30, width / height, 2, 200);
  new CameraRig(camera).frameLawn(width / height);
  camera.updateMatrixWorld(true);
  let y = 0;
  for (const x of [0, 10]) {
    const p = new Vector3(x, 0, 5).project(camera);
    y = Math.max(y, (0.5 - p.y * 0.5) * height);
  }
  return y;
}

/** The biggest cards (up to the usual size) that fit, in one row or two; a tie keeps one row. */
export function trayLayout(count: number, view: Viewport, frontY = lawnFrontY(view.width, view.height), powers = true): TrayLayout {
  const { width, height } = view;
  const gap = clamp(width * 0.006, 4, 10);
  const barGap = clamp(width * 0.014, 10, 18);
  const base = clamp(Math.min(width * 0.066, height * 0.104), 64, CARD_MAX);
  const availW = width - 2 * view.gutterX - SLACK_X;
  const availH = height - view.gutterBottom - BOTTOM_LINE - frontY - LAWN_MARGIN;

  const fits = (rows: 1 | 2, card: number): boolean =>
    widthFor(rows, count, card, gap, barGap, powers) <= availW && heightFor(rows, card, powers) <= availH;
  /** The widest card (to 0.1 px, at most `base`) that fits in this many rows; 0 if none does. */
  const best = (rows: 1 | 2): number => {
    if (fits(rows, base)) return Math.floor(base * 10) / 10;
    let lo = 0;
    let hi = base;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(rows, mid)) lo = mid;
      else hi = mid;
    }
    return Math.floor(lo * 10) / 10;
  };

  const one = best(1);
  const two = count > ROW_MAX ? best(2) : -Infinity;
  const rows: 1 | 2 = two > one ? 2 : 1;
  const card = Math.max(rows === 2 ? two : one, 1);
  const hero = Math.floor(heroFor(rows, card));
  return {
    rows, cols: Math.max(1, Math.ceil(count / rows)), card, gap, hero,
    spell: Math.floor((hero - gap - LIP) / 2), barGap,
  };
}

/** One shared reading of the window (size and gutters) for every bar that lays itself out. */
let current: Viewport | null = null;
const listeners = new Set<(v: Viewport) => void>();

function measure(): Viewport {
  let gutterX = 12;
  let gutterBottom = 10;
  if (typeof document !== 'undefined' && document.body !== null) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-left:var(--gutter-x);padding-bottom:var(--gutter-bottom)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const px = parseFloat(cs.paddingLeft);
    const pb = parseFloat(cs.paddingBottom);
    if (px > 0) gutterX = px;
    if (pb > 0) gutterBottom = pb;
    probe.remove();
  }
  return { width: window.innerWidth, height: window.innerHeight, gutterX, gutterBottom };
}

function onResize(): void {
  const next = measure();
  const prev = current;
  if (prev !== null && prev.width === next.width && prev.height === next.height
    && prev.gutterX === next.gutterX && prev.gutterBottom === next.gutterBottom) return;
  current = next;
  for (const l of listeners) l(next);
}

/** The window as the bottom bar sees it; every user shares one resize listener. */
export function useViewport(): Viewport {
  const [view, setView] = useState<Viewport>(() => current ?? (current = measure()));
  useEffect(() => {
    if (listeners.size === 0) {
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onResize);
    }
    listeners.add(setView);
    onResize();
    if (current !== null) setView(current);
    return () => {
      listeners.delete(setView);
      if (listeners.size === 0) {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onResize);
      }
    };
  }, []);
  return view;
}

/** Layout results by window and count, so the tray and the bar beside it share one computation. */
const memo = new Map<string, TrayLayout>();

export function useTrayLayout(count: number): TrayLayout {
  const v = useViewport();
  const key = `${count}|${v.width}|${v.height}|${v.gutterX}|${v.gutterBottom}`;
  let layout = memo.get(key);
  if (layout === undefined) {
    if (memo.size > 32) memo.clear();
    layout = trayLayout(count, v);
    memo.set(key, layout);
  }
  return layout;
}
