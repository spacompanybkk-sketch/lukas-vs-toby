import './theme.css';
import './icons.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Ref } from 'preact';
import { BattleController } from '../app/BattleController';
import type { BattleOptions } from '../app/BattleController';
import { loadSettings, saveSettings } from '../app/settings';
import type { Settings } from '../app/settings';
import { go, screen } from '../app/store';
import { TICKS_PER_SECOND } from '../sim/types';
import { SettingsPanel } from './SettingsPanel';
import { Unsupported } from './Unsupported';
import type { BoyPortraits } from './hud/BaseBars';
import { BattleScreen } from './screens/BattleScreen';
import type { BattleSessionLike, SessionFactory } from './screens/BattleScreen';
import { SidePick } from './screens/SidePick';
import { Title } from './screens/Title';
import './screens/screens.css';

export interface AppProps {
  /**
   * Builds the battle; the 3D `BattleSession` is plugged in here. In development it defaults to a
   * HUD-only stand-in; in a production build a missing factory shows the Unsupported screen.
   */
  createSession?: SessionFactory;
  /** Card portraits by unit key, and the two boys' portraits. */
  portraits?: Record<string, string>;
  boys?: BoyPortraits;
  /** Called with the settings once at start and on every change (apply to audio and renderer here). */
  onSettingsChange?(s: Settings): void;
  /**
   * Called on each user activation (pointerup, touchend, click, keydown) until it returns or
   * resolves `true`. Safari lets audio start only inside one of these; pass the audio unlock and
   * report whether the context is now running. `pointerdown` does not count for touch.
   */
  onGesture?(): boolean | Promise<boolean>;
  energyRef?: Ref<HTMLDivElement>;
}

/** Production fallback: there is no stand-in, so a missing factory is a loud error. */
const missingSession: SessionFactory = () => {
  console.error('App: no createSession was passed; the battle cannot start.');
  throw new Error('webgl2-unavailable');
};

/**
 * Development only. Until the 3D session is wired in, a battle runs the real controller with no view: the HUD is
 * live (clock, energy, cards, the bot attacking) but there is no lawn to tap.
 */
export const hudOnlySession: SessionFactory = (options) => {
  const controller = new BattleController(options);
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    controller,
    begin() {
      if (timer === undefined) timer = setInterval(() => controller.step(), 1000 / TICKS_PER_SECOND);
    },
    dispose() {
      clearInterval(timer);
      timer = undefined;
    },
  };
};

const isPortrait = (): boolean => window.innerHeight > window.innerWidth;

function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(isPortrait);
  useEffect(() => {
    const check = (): void => setPortrait(isPortrait());
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    check();
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);
  return portrait;
}

/** Events that count as user activation for audio in Safari (touch `pointerdown` does not). */
const ACTIVATION_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const;

/**
 * Touch housekeeping for iPad Safari: an (empty) touchstart listener makes `:active` work, so
 * buttons visibly press; pinch gestures are cancelled so the page never zooms. `onGesture` is
 * offered every activation until it reports success.
 */
function useTouchHousekeeping(onGesture: (() => boolean | Promise<boolean>) | undefined): void {
  const callback = useRef(onGesture);
  callback.current = onGesture;
  useEffect(() => {
    const noop = (): void => {};
    const noGesture = (e: Event): void => e.preventDefault();
    let done = false;
    const stop = (): void => {
      done = true;
      for (const name of ACTIVATION_EVENTS) document.removeEventListener(name, gesture, true);
    };
    const gesture = (): void => {
      const cb = callback.current;
      if (done || cb === undefined) return;
      let result: boolean | Promise<boolean>;
      try {
        result = cb();
      } catch (e) {
        console.error('onGesture failed', e);
        return;
      }
      if (result === true) {
        stop();
      } else if (result instanceof Promise) {
        result.then((ok) => { if (ok) stop(); }, (e: unknown) => console.error('onGesture failed', e));
      }
    };
    document.addEventListener('touchstart', noop, { passive: true });
    document.addEventListener('gesturestart', noGesture);
    for (const name of ACTIVATION_EVENTS) document.addEventListener(name, gesture, true);
    return () => {
      stop();
      document.removeEventListener('touchstart', noop);
      document.removeEventListener('gesturestart', noGesture);
    };
  }, []);
}

export function App({ createSession: given, portraits, boys, onSettingsChange, onGesture, energyRef }: AppProps) {
  const createSession = given ?? (import.meta.env.DEV ? hudOnlySession : missingSession);
  const s = screen.value;
  const portrait = usePortrait();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useTouchHousekeeping(onGesture);

  useEffect(() => {
    onSettingsChange?.(settings);
    // Only the initial settings: later changes go through `changeSettings`.
  }, []);

  const changeSettings = (next: Settings): void => {
    setSettings(next);
    saveSettings(next);
    onSettingsChange?.(next);
  };

  let body;
  switch (s.name) {
    case 'title':
      body = <Title onSettings={() => setSettingsOpen(true)} />;
      break;
    case 'sidepick':
      body = <SidePick portraits={boys} />;
      break;
    case 'battle':
      body = (
        <BattleHost
          options={s.options} createSession={createSession} portraits={portraits} boys={boys}
          portrait={portrait} settings={settings} onSettingsChange={changeSettings} energyRef={energyRef}
        />
      );
      break;
    case 'unsupported':
      body = <Unsupported reason={s.reason} />;
      break;
  }

  return (
    <>
      <div data-app class="app" aria-hidden={portrait ? 'true' : undefined} inert={portrait || undefined}>
        {body}
        {settingsOpen && s.name === 'title' && (
          <SettingsPanel settings={settings} onChange={changeSettings} onClose={() => setSettingsOpen(false)} />
        )}
      </div>
      {portrait && <RotateDevice />}
    </>
  );
}

interface BattleHostProps {
  options: BattleOptions;
  createSession: SessionFactory;
  portraits: Record<string, string> | undefined;
  boys: BoyPortraits | undefined;
  portrait: boolean;
  settings: Settings;
  onSettingsChange(s: Settings): void;
  energyRef: Ref<HTMLDivElement> | undefined;
}

let sessionCount = 0;

/** Owns one session per `options` object: a new object (restart) disposes the old and builds anew. */
function BattleHost({ options, createSession, ...rest }: BattleHostProps) {
  const [live, setLive] = useState<{ id: number; session: BattleSessionLike } | null>(null);

  useLayoutEffect(() => {
    let session: BattleSessionLike;
    try {
      session = createSession(options);
    } catch (e) {
      if (e instanceof Error && e.message === 'webgl2-unavailable') {
        go({ name: 'unsupported', reason: 'webgl2' });
        return undefined;
      }
      throw e;
    }
    sessionCount += 1;
    setLive({ id: sessionCount, session });
    return () => {
      session.dispose();
      setLive(null);
    };
  }, [options, createSession]);

  if (live === null) return null;
  const again = (): void => go({ name: 'battle', options: { ...options, seed: (Date.now() + live.id) >>> 0 } });
  return (
    <BattleScreen
      key={live.id} session={live.session} {...rest}
      onRestart={again} onQuit={() => go({ name: 'title' })}
    />
  );
}

/** Shown over everything while the device is held upright: a pixel tablet turning on its side. */
function RotateDevice() {
  return (
    <div data-screen="rotate" class="layer rotate" role="alert" aria-label="Turn your device">
      <div class="rotate__pic" aria-hidden="true">
        <span class="rotate__tablet px pal-stone"><span class="rotate__screen" /></span>
        <span class="rotate__arrow ico ico--restart" />
      </div>
    </div>
  );
}
