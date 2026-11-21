import { useEffect } from 'preact/hooks';
import { PixelIcon } from '../hud/PixelIcon';
import type { PixelArt } from '../hud/PixelIcon';
import { DOOR } from '../screens/pictures';
import { uiSound } from '../uiSound';
import { CRACKED_BLOCK, SHRUG, UPDATE } from './pictures';
import { touch } from './types';
import './versus.css';

/**
 * Why a Versus match did not start or stopped, as one picture:
 * - `update`: the two devices run different game versions (an arrow into a tablet; spec §8.1);
 * - `broken`: three repairs failed (a cracked block; §6.6);
 * - `shrug`: getting ready timed out (§6.8);
 * - `gone`: the other boy left (the door).
 */
export type NoticeKind = 'update' | 'broken' | 'shrug' | 'gone';

const PICTURE: Readonly<Record<NoticeKind, PixelArt>> = { update: UPDATE, broken: CRACKED_BLOCK, shrug: SHRUG, gone: DOOR };

/** The notice: its picture, big, and one home button. Something gone wrong plays the "uh-uh". */
export function VersusNotice({ kind, onHome }: { kind: NoticeKind; onHome(): void }) {
  useEffect(() => { if (kind !== 'update') uiSound('deny'); }, [kind]);
  return (
    <div data-screen="vs-notice" data-notice={kind} class="layer layer--menu vs-notice" role="dialog" aria-label={kind}>
      <div class="vs-notice__card panel px pal-cream">
        <span class="vs-notice__pic" data-notice-pic aria-hidden="true"><PixelIcon art={PICTURE[kind]} /></span>
        <button
          type="button" data-action="home" aria-label="Home" class="btn btn--big pal-leaf vs-notice__home" style={touch(96)}
          onClick={() => { uiSound('click'); onHome(); }}
        >
          <span class="ico ico--home" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
