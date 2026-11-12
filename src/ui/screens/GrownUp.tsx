import { useEffect, useRef, useState } from 'preact/hooks';
import { session } from '../../app/session';
import { GROWN_UP_DIGITS } from '../../cloud/hash';
import type { RosterEntry } from '../../app/session';
import { go } from '../../app/store';
import { PixelIcon } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { PinPad } from './PinPad';
import type { PadAnswer } from './PinPad';
import { PadHead } from './Players';
import { PlayerPicture } from './PlayerPicture';
import { CHECK, CLOUD_OFF, CROSS, KEY, LOCK } from './pictures';
import './players.css';

type Step =
  | { name: 'code' }
  | { name: 'new-code'; first: string }
  | { name: 'list'; note?: string }
  | { name: 'delete'; who: RosterEntry }
  | { name: 'pin'; who: RosterEntry }
  | { name: 'pin2'; who: RosterEntry; first: string }
  | { name: 'offline' };

/** How long a mismatched repeat shakes before choosing starts again. */
const MISMATCH_MS = 450;

/**
 * Behind the small lock on the Players screen, for grown-ups (who can read): the first use sets
 * a six-digit code (typed twice); afterwards the code opens a list where a player can be deleted
 * (the code typed again to confirm) or given a new number.
 */
export function GrownUp({ portraits = {} }: { portraits?: Record<string, string> }) {
  const [step, setStep] = useState<Step>({ name: 'code' });
  const [players, setPlayers] = useState<RosterEntry[] | null>(null);
  const code = useRef('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const later = (fn: () => void): void => { setTimeout(() => { if (alive.current) fn(); }, MISMATCH_MS); };

  const openList = async (note?: string): Promise<void> => {
    const r = await session.roster();
    if (!alive.current) return;
    if (!r.online) {
      setStep({ name: 'offline' });
      return;
    }
    setPlayers(r.players.filter((p) => p.exists));
    setStep({ name: 'list', ...(note !== undefined ? { note } : {}) });
  };

  const lockHead = (text: string) => (
    <div class="pad-head">
      <span class="pad-head__pic px pal-stone grown__lock"><PixelIcon art={LOCK} /></span>
      <span class="pad-head__name grown__text">{text}</span>
    </div>
  );
  const toPlayers = (): void => go({ name: 'players' });

  switch (step.name) {
    case 'code':
      return (
        <PinPad
          key="code" screenName="grownup" length={GROWN_UP_DIGITS} head={lockHead('Grown-up code')} onBack={toPlayers}
          onCode={async (c): Promise<PadAnswer> => {
            const r = await session.checkGrownUp(c);
            if (r === 'offline') return 'offline';
            if (r === 'ok') {
              code.current = c;
              void openList();
              return 'ok';
            }
            // Not the code. If this device has never seen one, it may be the first: type it again to set it.
            if (session.grownUpKnown()) return 'wrong';
            setStep({ name: 'new-code', first: c });
            return 'ok';
          }}
        />
      );
    case 'new-code':
      return (
        <PinPad
          key="new-code" screenName="grownup" length={GROWN_UP_DIGITS} step={2} head={lockHead('New code? Type it again')}
          onBack={() => setStep({ name: 'code' })}
          onCode={async (c): Promise<PadAnswer> => {
            if (c !== step.first) {
              later(() => setStep({ name: 'code' }));
              return 'wrong';
            }
            const r = await session.setGrownUp(c);
            if (r === 'offline') return 'offline';
            if (r === 'taken') {
              // A code exists already, and this was not it.
              later(() => setStep({ name: 'code' }));
              return 'wrong';
            }
            code.current = c;
            void openList();
            return 'ok';
          }}
        />
      );
    case 'offline':
      return (
        <div data-screen="grownup" data-step="offline" class="layer layer--menu create">
          <button type="button" data-action="back" class="btn btn--square pal-wood screen-back" aria-label="Back" onClick={toPlayers}>
            <span class="ico ico--back" aria-hidden="true" />
          </button>
          <div class="stack">
            <span class="problem px pal-slate" aria-label="No connection"><PixelIcon art={CLOUD_OFF} class="problem__icon" /></span>
            <button type="button" data-action="retry" class="btn btn--big pal-leaf" aria-label="Try again" onClick={() => void (code.current ? openList() : setStep({ name: 'code' }))}>
              <span class="ico ico--restart" aria-hidden="true" />
            </button>
          </div>
        </div>
      );
    case 'list':
      return (
        <div data-screen="grownup" data-step="list" class="layer layer--menu grown">
          <button type="button" data-action="back" class="btn btn--square pal-wood screen-back" aria-label="Back" onClick={toPlayers}>
            <span class="ico ico--back" aria-hidden="true" />
          </button>
          <div class="grown__panel panel px pal-cream">
            <h2 class="grown__title">Players</h2>
            {step.note !== undefined && <p class="grown__note" data-note>{step.note}</p>}
            <ul class="grown__list">
              {(players ?? []).map((p) => (
                <li key={p.slot} class="grown__row" data-row={p.slot}>
                  <PlayerPicture picture={p.picture} portraits={portraits} class="grown__pic px" />
                  <span class="grown__name">{p.name}</span>
                  <button type="button" data-action="new-number" aria-label={`New number for ${p.name}`} class="btn btn--square pal-wood" onClick={() => setStep({ name: 'pin', who: p })}>
                    <PixelIcon art={KEY} class="grown__icon" />
                  </button>
                  <button type="button" data-action="delete" aria-label={`Delete ${p.name}`} class="btn btn--square pal-stone" onClick={() => setStep({ name: 'delete', who: p })}>
                    <PixelIcon art={CROSS} class="grown__icon" />
                  </button>
                </li>
              ))}
              {players !== null && players.length === 0 && <li class="grown__empty">No players yet.</li>}
            </ul>
          </div>
        </div>
      );
    case 'delete': {
      const who = step.who;
      return (
        <PinPad
          key={`delete-${who.slot}`} screenName="grownup" length={GROWN_UP_DIGITS}
          head={<div class="grown__confirm"><PadHead who={who} portraits={portraits} /><span class="grown__text">Delete? Type the code</span><PixelIcon art={CROSS} class="grown__confirm-x" /></div>}
          onBack={() => setStep({ name: 'list' })}
          onCode={async (c): Promise<PadAnswer> => {
            const r = await session.deletePlayer(who.slot, c);
            if (r === 'wrong') return 'wrong';
            if (r !== 'ok') return 'offline'; // no answer or refused: the crossed cloud, try again
            uiSound('click');
            void openList(`${who.name} was deleted.`);
            return 'ok';
          }}
        />
      );
    }
    case 'pin':
      return (
        <PinPad
          key={`pin-${step.who.slot}`} screenName="grownup" step={1}
          head={<div class="grown__confirm"><PadHead who={step.who} portraits={portraits} /><span class="grown__text">New number</span></div>}
          onBack={() => setStep({ name: 'list' })}
          onCode={(c): PadAnswer => {
            setStep({ name: 'pin2', who: step.who, first: c });
            return 'ok';
          }}
        />
      );
    case 'pin2': {
      const { who, first } = step;
      return (
        <PinPad
          key={`pin2-${who.slot}`} screenName="grownup" step={2}
          head={<div class="grown__confirm"><PadHead who={who} portraits={portraits} /><span class="grown__text">Again</span><PixelIcon art={CHECK} class="grown__confirm-x" /></div>}
          onBack={() => setStep({ name: 'pin', who })}
          onCode={async (c): Promise<PadAnswer> => {
            if (c !== first) {
              later(() => setStep({ name: 'pin', who }));
              return 'wrong';
            }
            const r = await session.resetPin(who, code.current, c);
            if (r === 'offline' || r === 'failed' || r === 'wrong') {
              // The code was right a moment ago: anything else is a retry (the crossed cloud), never "wrong".
              return 'offline';
            }
            uiSound('click');
            void openList(r === 'fresh'
              ? `${who.name} has a new number. This device had no copy of the progress, so it starts fresh.`
              : `${who.name} has a new number.`);
            return 'ok';
          }}
        />
      );
    }
  }
}
