import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { PixelIcon } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { ARROW, BACKSPACE, CHECK, CLOUD_OFF, CROSS, DIGITS, HOURGLASS } from './pictures';
import './players.css';
import { BackButton } from '../BackButton';

/**
 * What the owner of the pad says about a number: `ok` (it moves on; the pad keeps its boxes
 * filled), `wrong` (shake, clear, deny), `locked` (as wrong, then the hourglass: `lockedUntil`
 * says until when), `offline` (clear, and a crossed-out cloud for a moment), `failed` (clear,
 * and a big cross for a moment: refused for another reason, try again).
 */
export type PadAnswer = 'ok' | 'wrong' | 'locked' | 'offline' | 'failed';

export interface PinPadProps {
  /** Digits in the number: 3 for a player, 4 for the grown-up code. */
  length?: number;
  /** What sits above the boxes: the player's picture, a lock… */
  head?: ComponentChildren;
  onCode(code: string): PadAnswer | Promise<PadAnswer>;
  onBack(): void;
  /** When the pad may be used again (ms on `now`'s clock); 0 or less: not locked. */
  lockedUntil?: () => number;
  now?: () => number;
  /** Choosing a number: 1 = choose it, 2 = type it again. */
  step?: 1 | 2;
  /** The `data-screen` of the whole layer. */
  screenName?: string;
}

const SHAKE_MS = 420;
const OFFLINE_MS = 1600;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

/**
 * The big number pad: ten pixel-digit keys and a delete key, each at least 72 px on an iPad, and
 * a box per digit that fills as it arrives. The last digit submits by itself. A wrong number
 * shakes the boxes and clears them; while locked, a boxy hourglass counts the seconds down over
 * the keys. The back arrow (and Escape) always works. Digits typed on a keyboard count too.
 */
export function PinPad({ length = 3, head, onCode, onBack, lockedUntil, now = () => Date.now(), step, screenName = 'pinpad' }: PinPadProps) {
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, setTick] = useState(0);
  const gone = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // The latest state for the keyboard listener and for presses within one event loop turn.
  const state = useRef({ digits: '', busy: false });
  state.current.digits = digits;
  state.current.busy = busy;

  const until = lockedUntil?.() ?? 0;
  const t = now();
  const locked = until > t;
  const seconds = locked ? Math.ceil((until - t) / 1000) : 0;

  useEffect(() => () => {
    gone.current = true;
    for (const id of timers.current) clearTimeout(id);
  }, []);

  // While locked, the hourglass counts down; when it ends the keys come back.
  useEffect(() => {
    if (!locked) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [locked]);

  const later = (fn: () => void, ms: number): void => {
    timers.current.push(setTimeout(() => { if (!gone.current) fn(); }, ms));
  };

  const answer = (a: PadAnswer): void => {
    if (gone.current) return;
    state.current.busy = false;
    setBusy(false);
    if (a === 'ok') return;
    state.current.digits = '';
    setDigits('');
    uiSound('deny');
    if (a === 'offline') {
      setOffline(true);
      later(() => setOffline(false), OFFLINE_MS);
      return;
    }
    if (a === 'failed') {
      setFailed(true);
      later(() => setFailed(false), OFFLINE_MS);
      return;
    }
    setShake((n) => n + 1);
    later(() => setShake(0), SHAKE_MS);
  };

  const press = (k: string): void => {
    const s = state.current;
    if (s.busy || (lockedUntil?.() ?? 0) > now()) return;
    if (k === 'del') {
      if (s.digits.length === 0) return;
      uiSound('click');
      s.digits = s.digits.slice(0, -1);
      setDigits(s.digits);
      return;
    }
    if (!/^\d$/.test(k) || s.digits.length >= length) return;
    uiSound('click');
    s.digits += k;
    setDigits(s.digits);
    if (s.digits.length < length) return;
    s.busy = true;
    setBusy(true);
    const code = s.digits;
    let result: PadAnswer | Promise<PadAnswer>;
    try {
      result = onCode(code);
    } catch (e) {
      console.error('PinPad: onCode failed', e);
      result = 'wrong';
    }
    if (result instanceof Promise) {
      result.then(answer, (e: unknown) => {
        console.error('PinPad: onCode failed', e);
        answer('wrong');
      });
    } else {
      answer(result);
    }
  };

  const keyboard = useRef({ press, onBack });
  keyboard.current = { press, onBack };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') keyboard.current.onBack();
      else if (e.key === 'Backspace') keyboard.current.press('del');
      else if (/^\d$/.test(e.key)) keyboard.current.press(e.key);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shakeCls = shake === 0 ? '' : shake % 2 === 1 ? ' is-wrong is-wrong-a' : ' is-wrong is-wrong-b';
  return (
    <div data-screen={screenName} class={`layer layer--menu pinpad${step === 2 ? ' pinpad--repeat' : ''}`}>
      <BackButton data-action="back" class="screen-back" onClick={onBack} />
      <div class="pinpad__body">
        <div class="pinpad__left">
          {head}
          {step === 2 && (
            // Step 2 is unmistakable without words: the first number done (green, ticked), a big
            // arrow down, and the same boxes again to fill.
            <div class="pin-done" data-pin-done aria-hidden="true">
              <span class="pin-done__row">
                {Array.from({ length }, (_, i) => <span key={i} class="pin-box pin-box--done px" />)}
              </span>
              <PixelIcon art={CHECK} class="pin-done__tick" />
              <PixelIcon art={ARROW} class="pin-done__arrow" />
            </div>
          )}
          {step !== undefined && <span class="visually-hidden" data-pin-step={String(step)}>{step === 1 ? 'Choose a number' : 'Type it again'}</span>}
          <div data-pin-boxes class={`pin-boxes${shakeCls}`} aria-label={`${digits.length} of ${length}`}>
            {Array.from({ length }, (_, i) => (
              <span key={i} data-pin-box class={`pin-box px${i < digits.length ? ' is-filled' : ''}`} />
            ))}
            {failed && (
              <span class="pin-offline" data-pin-failed aria-label="Try again">
                <PixelIcon art={CROSS} class="pin-offline__icon" />
              </span>
            )}
            {offline && (
              <span class="pin-offline" data-pin-offline aria-label="No connection">
                <PixelIcon art={CLOUD_OFF} class="pin-offline__icon" />
              </span>
            )}
          </div>
        </div>
        <div class="pinpad__right">
          <div data-keys class="pin-keys" aria-disabled={locked || undefined}>
            {KEYS.map((k, i) => k === ''
              ? <span key={`gap${i}`} class="pin-key pin-key--gap" aria-hidden="true" />
              : (
                <button
                  key={k} type="button" data-key={k} aria-label={k === 'del' ? 'Delete' : k}
                  class={`btn pin-key ${k === 'del' ? 'pal-stone pin-key--del' : 'pal-wood'}`}
                  aria-disabled={locked || busy || undefined} onClick={() => press(k)}
                >
                  <PixelIcon art={k === 'del' ? BACKSPACE : (DIGITS[k] as typeof BACKSPACE)} class="pin-key__glyph" />
                </button>
              ))}
          </div>
          {locked && (
            <div class="pin-lock panel px pal-slate" data-lock role="timer" aria-label={`Wait ${seconds} seconds`}>
              <PixelIcon art={HOURGLASS} class="pin-lock__glass" />
              <span class="pin-lock__num">
                {String(seconds).split('').map((d, i) => <PixelIcon key={i} art={DIGITS[d] as typeof HOURGLASS} class="pin-lock__digit" />)}
              </span>
              <span class="visually-hidden">{seconds}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
