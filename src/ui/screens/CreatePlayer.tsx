import { useEffect, useRef, useState } from 'preact/hooks';
import { BOYS, session } from '../../app/session';
import { go } from '../../app/store';
import { PICTURES, validName } from '../../progress/save';
import type { Slot } from '../../progress/save';
import type { CardKey } from '../../sim/types';
import { PixelIcon } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { PinPad } from './PinPad';
import type { PadAnswer } from './PinPad';
import { PadHead } from './Players';
import { PlayerPicture } from './PlayerPicture';
import { BACKSPACE, CHECK, CLOUD_OFF, CROSS, PLUS } from './pictures';
import './players.css';

type Step = 'check' | 'picture' | 'name' | 'pin' | 'repeat' | 'offline' | 'full';

const MAX_NAME = 10;
const KEY_ROWS = ['1234567890', 'ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ'] as const;
/** How long a mismatched repeat shakes before choosing starts again. */
const MISMATCH_MS = 450;

/** A name as typed on the boxy keyboard: the first letter big, the rest small ("Lukas"). */
export function typed(name: string, ch: string): string {
  if (name.length >= MAX_NAME || !/^[A-Za-z0-9]$/.test(ch)) return name;
  return name + (name.length === 0 ? ch.toUpperCase() : ch.toLowerCase());
}

export interface CreatePlayerProps {
  portraits?: Record<string, string>;
  /** Lukas (`p01`) or Toby (`p02`): his name and picture are set, he only chooses his number. */
  boy?: Slot;
}

/**
 * A new player: pick a picture from the twenty, type a name on a boxy keyboard, choose a number
 * and type it again. Needs a connection: without one it says so with a crossed-out cloud and a
 * retry button, and nothing is made.
 */
export function CreatePlayer({ portraits = {}, boy }: CreatePlayerProps) {
  const preset = boy === 'p01' || boy === 'p02' ? BOYS[boy] : null;
  const [step, setStep] = useState<Step>('check');
  const [picture, setPicture] = useState<CardKey | null>(preset?.picture ?? null);
  const [name, setName] = useState(preset?.name ?? '');
  const pin = useRef('');
  /** Where the retry button goes back to: the check, or making the player with the number chosen. */
  const [retryMakes, setRetryMakes] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const check = async (): Promise<void> => {
    setStep('check');
    const r = await session.roster();
    if (!alive.current) return;
    if (!r.online) {
      setRetryMakes(false);
      setStep('offline');
    } else if (boy !== undefined && r.players.some((p) => p.slot === boy && p.exists)) {
      go({ name: 'players', login: boy }); // made on another device meanwhile: just log in
    } else if (boy === undefined && r.full) {
      setStep('full');
    } else {
      setStep(preset ? 'pin' : 'picture');
    }
  };
  useEffect(() => { void check(); }, []);

  const make = async (): Promise<void> => {
    if (picture === null) return;
    const r = await session.create(name, picture, pin.current, boy);
    if (!alive.current) return;
    if (typeof r === 'object') {
      uiSound('win');
      go({ name: 'home' });
    } else if (r === 'full') {
      setStep('full');
    } else if (r === 'taken') {
      go({ name: 'players' });
    } else if (r === 'invalid') {
      setStep('name');
    } else {
      setRetryMakes(true);
      setStep('offline');
    }
  };

  const back = (): void => {
    if (step === 'repeat') setStep('pin');
    else if (step === 'pin' && !preset) setStep('name');
    else if (step === 'name') setStep('picture');
    else go({ name: 'players' });
  };

  const who = { name, picture: picture ?? 'peashooter' as CardKey };

  switch (step) {
    case 'check':
      return <div data-screen="create" data-step="check" class="layer layer--menu create" />;
    case 'offline':
      return (
        <Problem step="offline" art={CLOUD_OFF} onBack={back}>
          <button type="button" data-action="retry" class="btn btn--big pal-leaf" aria-label="Try again" onClick={() => { uiSound('click'); void (retryMakes ? make() : check()); }}>
            <span class="ico ico--restart" aria-hidden="true" />
          </button>
        </Problem>
      );
    case 'full':
      return <Problem step="full" art={PLUS} cross onBack={back} />;
    case 'picture':
      return (
        <div data-screen="create" data-step="picture" class="layer layer--menu create">
          <BackButton onBack={back} />
          <div class="pick-grid">
            {PICTURES.map((k) => (
              <button
                key={k} type="button" data-pick={k} aria-label={k} aria-pressed={picture === k}
                class={`pick px pal-side side-${PICTURES.indexOf(k) < 10 ? 'plants' : 'zombies'}${picture === k ? ' is-picked' : ''}`}
                onClick={() => { uiSound('click'); setPicture(k); setStep('name'); }}
              >
                <PlayerPicture picture={k} portraits={portraits} />
              </button>
            ))}
          </div>
        </div>
      );
    case 'name':
      return <NameStep who={who} portraits={portraits} onBack={back} onName={setName} onPicture={() => setStep('picture')} onDone={() => setStep('pin')} />;
    case 'pin':
      return (
        <PinPad
          key="pin" screenName="create" step={1} head={<PadHead who={who} portraits={portraits} />} onBack={back}
          onCode={(code): PadAnswer => {
            pin.current = code;
            setStep('repeat');
            return 'ok';
          }}
        />
      );
    case 'repeat':
      return (
        <PinPad
          key="repeat" screenName="create" step={2} head={<PadHead who={who} portraits={portraits} />} onBack={back}
          onCode={async (code): Promise<PadAnswer> => {
            if (code !== pin.current) {
              setTimeout(() => { if (alive.current) setStep('pin'); }, MISMATCH_MS);
              return 'wrong';
            }
            await make();
            return 'ok';
          }}
        />
      );
  }
}

function BackButton({ onBack }: { onBack(): void }) {
  return (
    <button type="button" data-action="back" class="btn btn--square pal-wood screen-back" aria-label="Back" onClick={onBack}>
      <span class="ico ico--back" aria-hidden="true" />
    </button>
  );
}

/** A picture-only message (no connection, no room) with a back arrow and maybe a button. */
function Problem({ step, art, cross = false, onBack, children }: { step: string; art: typeof PLUS; cross?: boolean; onBack(): void; children?: preact.ComponentChildren }) {
  return (
    <div data-screen="create" data-step={step} class="layer layer--menu create">
      <BackButton onBack={onBack} />
      <div class="stack">
        <span class="problem px pal-slate" aria-label={step === 'offline' ? 'No connection' : 'No room'}>
          <PixelIcon art={art} class="problem__icon" />
          {cross && <PixelIcon art={CROSS} class="problem__cross" />}
        </span>
        {children}
      </div>
    </div>
  );
}

interface NameStepProps {
  who: { name: string; picture: CardKey };
  portraits: Record<string, string>;
  onBack(): void;
  onName(name: string): void;
  onPicture(): void;
  onDone(): void;
}

/** The name: shown big beside the chosen picture, typed on a boxy A–Z / 0–9 keyboard (or the device's). */
function NameStep({ who, portraits, onBack, onName, onPicture, onDone }: NameStepProps) {
  const ok = validName(who.name);
  const latest = useRef({ who, ok, onName, onDone, onBack });
  latest.current = { who, ok, onName, onDone, onBack };
  const press = (k: string): void => {
    const { who: w, ok: valid, onName: set, onDone: done } = latest.current;
    if (k === 'del') {
      if (w.name.length > 0) uiSound('click');
      set(w.name.slice(0, -1));
    } else if (k === 'ok') {
      if (!valid) {
        uiSound('deny');
        return;
      }
      uiSound('click');
      done();
    } else {
      const next = typed(w.name, k);
      if (next === w.name) {
        uiSound('deny');
        return;
      }
      uiSound('click');
      set(next);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') latest.current.onBack();
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
      else if (/^[A-Za-z0-9]$/.test(e.key)) press(e.key);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div data-screen="create" data-step="name" class="layer layer--menu create">
      <BackButton onBack={onBack} />
      <div class="name-step">
        <div class="name-step__top">
          <button type="button" class="name-step__pic px" data-action="change-picture" aria-label="Change picture" onClick={onPicture}>
            <PlayerPicture picture={who.picture} portraits={portraits} />
          </button>
          <div class="name-field px pal-cream" data-name-field aria-label="Name">
            <span class="name-field__text">{who.name}</span>
            {who.name.length < MAX_NAME && <span class="name-field__cursor" aria-hidden="true" />}
          </div>
        </div>
        <div class="keyboard">
          {KEY_ROWS.map((row, r) => (
            <div key={r} class="keyboard__row">
              {[...row].map((ch) => (
                <button key={ch} type="button" data-letter={ch} class={`btn kb-key ${r === 0 ? 'pal-stone' : 'pal-wood'}`} onClick={() => press(ch)}>
                  <span class="btn__label inked">{ch}</span>
                </button>
              ))}
              {r === KEY_ROWS.length - 1 && (
                <>
                  <button type="button" data-key="del" aria-label="Delete" class="btn kb-key kb-key--wide pal-stone" onClick={() => press('del')}>
                    <PixelIcon art={BACKSPACE} class="kb-key__icon" />
                  </button>
                  <button
                    type="button" data-action="name-ok" aria-label="OK" aria-disabled={!ok}
                    class={`btn kb-key kb-key--wide pal-leaf${ok ? ' is-ready' : ''}`} onClick={() => press('ok')}
                  >
                    <PixelIcon art={CHECK} class="kb-key__icon" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
