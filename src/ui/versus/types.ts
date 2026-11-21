import type { Slot } from '../../progress/save';
import type { CardKey, Faction } from '../../sim/types';

/** A player as the Versus screens show him: his picture and (for the boy who reads) his name. */
export interface FaceVM { slot: Slot; name: string; picture: CardKey }
/** A face on "who is here": `busy` while his device is in a battle (greyed, cannot be picked). */
export interface HereVM extends FaceVM { busy: boolean }
/** The head start: whose it is and how big (0..5 sun or brain pictures). Structurally the lobby's HeadStart. */
export interface HeadVM { slot: Slot; step: number /* 0..5 */ }
/** The invite card before and after sending: my face, his, my side, the head start. */
export interface InviteDraftVM { me: FaceVM; them: FaceVM; mySide: Faction; head: HeadVM | null }
export type InviteCardState = 'draft' | 'waiting' | 'refused' | 'expired';
/** An invite arriving: who sent it, me, the side I would play, the head start. */
export interface IncomingVM { from: FaceVM; me: FaceVM; mySide: Faction; head: HeadVM | null }

/** Sizes (CSS px) the Versus screens promise: faces on "who is here", any new button, the invite panel's tick and cross. */
export const FACE_PX = 120;
export const TOUCH_PX = 64;
export const PANEL_TOUCH_PX = 112;
/** The invite panel's tick and cross sit this far in from the screen's edges. */
export const PANEL_EDGE_PX = 24;
/** The most head-start steps. */
export const HEAD_MAX = 5;

export const otherSide = (side: Faction): Faction => (side === 'plants' ? 'zombies' : 'plants');
