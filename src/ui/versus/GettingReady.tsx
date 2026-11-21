import type { Faction } from '../../sim/types';
import { PixelIcon } from '../hud/PixelIcon';
import { SWORDS } from '../screens/boardPictures';
import { otherSide } from './types';
import type { FaceVM } from './types';
import { VersusFace } from './WhoIsHere';
import './versus.css';

/** The three blocks of the bar, in the order they fill. */
const BLOCKS = ['connected', 'ready', 'build'] as const;

/**
 * Getting ready: both faces with their sides (sun and brain), the crossed swords between them, and
 * a bar of three blocks that fills left to right: the devices are connected, both boys are ready,
 * both run the same game version. A block never fills past an empty one before it. Then the
 * usual READY… FIGHT! intro (the battle's own).
 */
export function GettingReady({ me, them, mySide, blocks, portraits }: {
  me: FaceVM; them: FaceVM; mySide: Faction;
  blocks: { connected: boolean; bothReady: boolean; sameBuild: boolean };
  portraits: Record<string, string>;
}) {
  const filled = !blocks.connected ? 0 : !blocks.bothReady ? 1 : !blocks.sameBuild ? 2 : 3;
  return (
    <div data-screen="vs-ready" class="layer layer--menu vs-ready">
      <div class="vs-ready__faces">
        <VersusFace face={me} portraits={portraits} side={mySide} />
        <span class="vs-ready__vs" aria-hidden="true"><PixelIcon art={SWORDS} class="vs-icon" /></span>
        <VersusFace face={them} portraits={portraits} side={otherSide(mySide)} />
      </div>
      <div class="vs-ready__bar px pal-stone" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={filled}>
        {BLOCKS.map((b, i) => (
          <span key={b} class={`vs-ready__block${i < filled ? ' is-on' : ''}`} data-block={b} data-filled={i < filled ? '' : undefined} />
        ))}
      </div>
    </div>
  );
}
