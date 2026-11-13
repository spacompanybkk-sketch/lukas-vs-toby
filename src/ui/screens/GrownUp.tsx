import { useEffect, useRef, useState } from 'preact/hooks';
import { session } from '../../app/session';
import { GROWN_UP_DIGITS } from '../../cloud/hash';
import type { RosterEntry } from '../../app/session';
import { go } from '../../app/store';
import { PixelIcon } from '../hud/PixelIcon';
import { frameColor } from '../frameColor';
import { uiSound } from '../uiSound';
import { PinPad } from './PinPad';
import type { PadAnswer } from './PinPad';
import { PadHead } from './Players';
import { PlayerPicture } from './PlayerPicture';
import { ARROW, CHECK, CLOUD_OFF, COIN, CROSS, KEY, LOCK, TABLET } from './pictures';
import './players.css';

type Step =
  | { name: 'code' }
  /** The cloud had no code; `first` is now set: type it again to confirm. */
  | { name: 'confirm'; first: string }
  /** The confirmation differed: choose the code again (twice), replacing `current`. */
  | { name: 'rechoose'; current: string }
  | { name: 'rechoose2'; current: string; first: string }
  | { name: 'list'; note?: string }
  | { name: 'delete'; who: RosterEntry }
  /** This device holds no copy of the child's save: warn before asking for a new number. */
  | { name: 'warn'; who: RosterEntry }
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
          lockedUntil={() => session.gateLockedUntil()} now={() => session.now()}
          onCode={async (c): Promise<PadAnswer> => {
            const r = await session.openGate(c);
            if (r === 'ok') {
              code.current = c;
              void openList();
              return 'ok';
            }
            if (r === 'new') {
              // The cloud said there was no code: this one is set now; confirm it.
              code.current = c;
              setStep({ name: 'confirm', first: c });
              return 'ok';
            }
            return r === 'other' ? 'failed' : r;
          }}
        />
      );
    case 'confirm':
      return (
        <PinPad
          key="confirm" screenName="grownup" length={GROWN_UP_DIGITS} step={2} head={lockHead('New code. Type it again')}
          onBack={toPlayers}
          onCode={(c): PadAnswer => {
            if (c === step.first) {
              void openList();
              return 'ok';
            }
            later(() => setStep({ name: 'rechoose', current: step.first }));
            return 'wrong';
          }}
        />
      );
    case 'rechoose':
      return (
        <PinPad
          key="rechoose" screenName="grownup" length={GROWN_UP_DIGITS} step={1} head={lockHead('They differed. Choose the code again')}
          onBack={toPlayers}
          onCode={(c): PadAnswer => {
            setStep({ name: 'rechoose2', current: step.current, first: c });
            return 'ok';
          }}
        />
      );
    case 'rechoose2': {
      const { current, first } = step;
      return (
        <PinPad
          key="rechoose2" screenName="grownup" length={GROWN_UP_DIGITS} step={2} head={lockHead('Type it again')}
          onBack={() => setStep({ name: 'rechoose', current })}
          onCode={async (c): Promise<PadAnswer> => {
            if (c !== first) {
              later(() => setStep({ name: 'rechoose', current }));
              return 'wrong';
            }
            const r = await session.changeGrownUp(current, c);
            if (r === 'ok') {
              code.current = c;
              void openList();
              return 'ok';
            }
            return r === 'offline' ? 'offline' : 'failed';
          }}
        />
      );
    }
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
                  <PlayerPicture picture={p.picture} portraits={portraits} class="grown__pic" frame={frameColor(p.slot)} />
                  <span class="grown__name">{p.name}</span>
                  <button type="button" data-action="new-number" aria-label={`New number for ${p.name}`} class="btn btn--square pal-wood" onClick={() => setStep(session.hasDeviceCopy(p.slot) ? { name: 'pin', who: p } : { name: 'warn', who: p })}>
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
          head={<div class="grown__confirm"><PadHead who={who} portraits={portraits} frame={frameColor(who.slot)} /><span class="grown__text">Delete? Type the code</span><PixelIcon art={CROSS} class="grown__confirm-x" /></div>}
          onBack={() => setStep({ name: 'list' })}
          onCode={async (c): Promise<PadAnswer> => {
            const r = await session.deletePlayer(who.slot, c);
            if (r === 'wrong') return 'wrong';
            if (r === 'offline') return 'offline';
            if (r !== 'ok') return 'failed';
            uiSound('click');
            void openList(`${who.name} was deleted.`);
            return 'ok';
          }}
        />
      );
    }
    case 'warn':
      return <ResetWarning who={step.who} portraits={portraits} onBack={() => setStep({ name: 'list' })} onGo={() => setStep({ name: 'pin', who: step.who })} />;
    case 'pin':
      return (
        <PinPad
          key={`pin-${step.who.slot}`} screenName="grownup" step={1}
          head={<div class="grown__confirm"><PadHead who={step.who} portraits={portraits} frame={frameColor(step.who.slot)} /><span class="grown__text">New number</span></div>}
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
          head={<div class="grown__confirm"><PadHead who={who} portraits={portraits} frame={frameColor(who.slot)} /><span class="grown__text">Again</span><PixelIcon art={CHECK} class="grown__confirm-x" /></div>}
          onBack={() => setStep({ name: 'pin', who })}
          onCode={async (c): Promise<PadAnswer> => {
            if (c !== first) {
              later(() => setStep({ name: 'pin', who }));
              return 'wrong';
            }
            const r = await session.resetPin(who, code.current, c);
            // The code was right a moment ago: anything but a real wrong code is a retry.
            if (r === 'offline') return 'offline';
            if (r === 'wrong') return 'wrong';
            if (r === 'failed') return 'failed';
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

/**
 * Before a new number on a device that holds no copy of the child's save: the coins and stars
 * crossed out (they would start again from nothing) and a tablet with an arrow (do this on the
 * child's own device instead). Going on takes two taps: the first arms, the second goes.
 */
function ResetWarning({ who, portraits, onBack, onGo }: { who: RosterEntry; portraits: Record<string, string>; onBack(): void; onGo(): void }) {
  const [armed, setArmed] = useState(false);
  return (
    <div data-screen="grownup" data-step="warn" class="layer layer--menu grown">
      <button type="button" data-action="back" class="btn btn--square pal-wood screen-back" aria-label="Back" onClick={onBack}>
        <span class="ico ico--back" aria-hidden="true" />
      </button>
      <div class="grown__panel grown__warn panel px pal-cream">
        <div class="grown__warn-pics">
          <PlayerPicture picture={who.picture} portraits={portraits} class="grown__warn-me" frame={frameColor(who.slot)} />
          <span class="grown__warn-lost" data-warn-lost aria-label="Coins and stars would be lost">
            <PixelIcon art={COIN} class="grown__warn-icon" />
            <span class="ico ico--star grown__warn-icon" aria-hidden="true" />
            <PixelIcon art={CROSS} class="grown__warn-cross" />
          </span>
          <span class="grown__warn-device" data-warn-device aria-label="Use the child's own device">
            <PixelIcon art={ARROW} class="grown__warn-arrow" />
            <PixelIcon art={TABLET} class="grown__warn-icon" />
          </span>
        </div>
        <p class="grown__note grown__note--warn">
          This device has no copy of {who.name}'s progress. A new number here starts {who.name} again from nothing.
          Do it on {who.name}'s own device to keep the coins and stars.
        </p>
        <div class="row">
          <button type="button" data-action="warn-back" class="btn pal-leaf" onClick={onBack}>
            <span class="ico ico--back" aria-hidden="true" /><span class="btn__label">Back</span>
          </button>
          <button
            type="button" data-action="warn-go" aria-pressed={armed} class={`btn ${armed ? 'pal-red' : 'pal-stone'}`}
            onClick={() => { if (armed) onGo(); else setArmed(true); }}
          >
            <span class="btn__label">{armed ? 'Tap again to start fresh' : 'Start fresh anyway'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

