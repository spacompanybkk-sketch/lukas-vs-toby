import { useEffect } from 'preact/hooks';
import type { RankUp } from '../../app/board';
import type { Slot } from '../../progress/save';
import { PixelIcon } from '../hud/PixelIcon';
import type { PixelArt } from '../hud/PixelIcon';
import { SWORDS } from '../screens/boardPictures';
import { CHECK, DIGITS, DOOR } from '../screens/pictures';
import { RankUpBadge } from '../screens/RankBlock';
import { uiSound } from '../uiSound';
import { CROWN, QUESTION } from './pictures';
import { touch } from './types';
import type { FaceVM } from './types';
import { VersusFace } from './WhoIsHere';
import './versus.css';

/** What the Versus result shows, on one boy's screen. */
export interface VersusResultVM {
  /** null: no winner shown (with `loser` null too: neither face). */
  winner: FaceVM | null;
  loser: FaceVM | null;
  /** The other boy (whose rematch answer shows on his faces): the "?", a tick, or the door. */
  them: Slot;
  /** The scoreboard strip, "Lukas N ⚔ M Toby". */
  score: { left: FaceVM; leftWins: number; right: FaceVM; rightWins: number };
  /**
   * offer: nobody pressed yet; mine: I pressed (tick on my button, "?" on his face); theirs: he
   * pressed (tick on his face); both: both pressed; gone: he pressed home (my rematch greys, the
   * door on his face); none: no rematch button.
   */
  rematch: 'offer' | 'mine' | 'theirs' | 'both' | 'gone' | 'none';
  rankUp: RankUp | null;
}

export const WINNER_PX = 160;
export const LOSER_PX = 88;
const SCORE_PX = 56;

type Answer = 'question' | 'yes' | 'door';
const ANSWER_ART: Readonly<Record<Answer, PixelArt>> = { question: QUESTION, yes: CHECK, door: DOOR };

function answerOf(rematch: VersusResultVM['rematch']): Answer | null {
  if (rematch === 'mine') return 'question';
  if (rematch === 'theirs' || rematch === 'both') return 'yes';
  if (rematch === 'gone') return 'door';
  return null;
}

/** A number as pixel digits. */
function Wins({ n, part }: { n: number; part: string }) {
  const text = String(Math.max(0, Math.floor(n)));
  return (
    <span class="vs-score__wins" data-part={part} data-wins={text} aria-label={text}>
      {[...text].map((d, i) => <PixelIcon key={i} art={DIGITS[d]!} />)}
    </span>
  );
}

/**
 * The Versus result, inside the result overlay: the winner's face large with a crown, the loser's
 * small; the scoreboard strip (left face, his wins, swords, the right's wins, right face); a rank-up
 * badge when one of the tables moved; rematch (two curved arrows over a small sun and brain, the
 * sides swap) and home.
 */
export function VersusResult({ vm, portraits, onRematch, onHome }: {
  vm: VersusResultVM; portraits: Record<string, string>; onRematch(): void; onHome(): void;
}) {
  const answer = answerOf(vm.rematch);
  useEffect(() => { if (vm.rematch === 'theirs') uiSound('chime'); }, [vm.rematch]);
  // His faces carry his rematch answer as a badge on their corner.
  const faceOf = (f: FaceVM, size: number) => (
    <span class="vs-result__face" data-result-face={f.slot}>
      <VersusFace face={f} portraits={portraits} size={size} />
      {answer !== null && f.slot === vm.them && (
        <span class={`vs-result__answer vs-result__answer--${answer}`} data-answer={answer} aria-hidden="true">
          <PixelIcon art={ANSWER_ART[answer]} />
        </span>
      )}
    </span>
  );
  const ticked = vm.rematch === 'mine' || vm.rematch === 'both';
  const gone = vm.rematch === 'gone';
  const pressRematch = (): void => {
    if (gone) { uiSound('deny'); return; }
    if (ticked) return;
    uiSound('click');
    onRematch();
  };
  return (
    <div class="vs-result" data-versus-result data-rematch={vm.rematch}>
      {(vm.winner !== null || vm.loser !== null) && (
        <div class="vs-result__faces">
          {vm.winner !== null && (
            <span class="vs-result__winner" data-winner>
              <span class="vs-result__crown" data-crown aria-hidden="true"><PixelIcon art={CROWN} /></span>
              {faceOf(vm.winner, WINNER_PX)}
            </span>
          )}
          {vm.loser !== null && <span class="vs-result__loser" data-loser>{faceOf(vm.loser, LOSER_PX)}</span>}
        </div>
      )}
      <div class="vs-score px pal-stone" data-score>
        <span data-part="left">{faceOf(vm.score.left, SCORE_PX)}</span>
        <Wins n={vm.score.leftWins} part="left-wins" />
        <span class="vs-score__vs" data-part="vs" aria-hidden="true"><PixelIcon art={SWORDS} /></span>
        <Wins n={vm.score.rightWins} part="right-wins" />
        <span data-part="right">{faceOf(vm.score.right, SCORE_PX)}</span>
      </div>
      {vm.rankUp !== null && <RankUpBadge up={vm.rankUp} />}
      <div class="row vs-result__buttons">
        {vm.rematch !== 'none' && (
          <button
            type="button" data-action="rematch" aria-label="Play again" aria-disabled={gone ? 'true' : undefined}
            class={`btn btn--big pal-leaf vs-result__rematch${gone ? ' is-off' : ''}`} style={touch(96)} onClick={pressRematch}
          >
            <span class="vs-rematch">
              <span class="ico ico--restart vs-rematch__arrows" aria-hidden="true" />
              <span class="vs-rematch__swap" data-rematch-swap aria-hidden="true">
                <span class="ico ico--sun" /><span class="ico ico--brain" />
              </span>
            </span>
            {ticked && <span class="vs-rematch__tick" data-rematch-tick aria-hidden="true"><PixelIcon art={CHECK} /></span>}
          </button>
        )}
        <button
          type="button" data-action="home" aria-label="Home" class="btn btn--big pal-cream" style={touch(96)}
          onClick={() => { uiSound('click'); onHome(); }}
        >
          <span class="ico ico--home" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
