import type { Box, ColorRef } from '../../voxel/types';

// Small helpers the plant files share. Nothing here is a model: the plants test finds models
// in this folder by their `key`, and these are plain functions.

/** A box from its two corners: x0 to x1, y0 to y1, z0 to z1, in voxels. */
export function span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: ColorRef, extra: Partial<Box> = {}): Box {
  return { at: [x0, y0, z0], size: [x1 - x0, y1 - y0, z1 - z0], color, ...extra };
}

/** The boxes gated to exist from level `from` to level `to`. */
export function lv(from: number, to: number, boxes: Box[]): Box[] {
  return boxes.map((box) => {
    const out: Box = { ...box };
    delete out.minLevel;
    delete out.maxLevel;
    if (from > 1) out.minLevel = from;
    if (to < 5) out.maxLevel = to;
    return out;
  });
}

/** The same boxes mirrored across z = 0. */
export function mirrorZ(boxes: Box[]): Box[] {
  return boxes.map((box) => ({ ...box, at: [box.at[0], box.at[1], -box.at[2] - box.size[2]] }));
}

/** The boxes and their mirror images across z = 0. */
export function bothSides(boxes: Box[]): Box[] {
  return [...boxes, ...mirrorZ(boxes)];
}

/**
 * A stepped round from y0 to y1 about (cx, cz): one box per pair of half-widths [hx, hz].
 * Crossing boxes of a long-and-narrow and a short-and-wide make a voxel circle.
 */
export function round(cx: number, cz: number, arms: [number, number][], y0: number, y1: number, color: ColorRef, extra: Partial<Box> = {}): Box[] {
  return arms.map(([hx, hz]) => span(cx - hx, cx + hx, y0, y1, cz - hz, cz + hz, color, extra));
}
