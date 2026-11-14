import { SLOTS } from '../progress/save';
import type { Slot } from '../progress/save';

/**
 * Ten boxy frame colours, clearly apart from each other and from the side colours (leaf green,
 * zombie purple) behind the pictures. Two players may share a picture; their frames tell them
 * apart without reading: "mine is the zombie with the red frame".
 */
export const FRAME_COLORS = Object.freeze([
  '#E2553F', // red
  '#3D7BFF', // blue
  '#FFD54A', // yellow
  '#FF8FB1', // pink
  '#2EC4B6', // teal
  '#F58A0B', // orange
  '#FFFFFF', // white
  '#B5651D', // brown
  '#A3E635', // lime
  '#1F1F2E', // night
] as const);

/** A player's frame colour, fixed by their place (the same on every screen and device). */
export function frameColor(slot: Slot): string {
  const i = Math.max(0, SLOTS.indexOf(slot));
  return FRAME_COLORS[i % FRAME_COLORS.length] as string;
}
