import './theme.css';
import './icons.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Ref } from 'preact';
import { BattleController } from '../app/BattleController';
import type { BattleOptions } from '../app/BattleController';
import { loadSettings, saveSettings } from '../app/settings';
import type { Settings } from '../app/settings';
import { session as players } from '../app/session';
import { go, screen } from '../app/store';
import type { SfxName } from '../audio/sfx';
import { board, rankChange } from '../app/board';
import type { RankUp } from '../app/board';
import { applyBattleResult, rewardFor } from '../progress/rewards';
import { TICKS_PER_SECOND } from '../sim/types';
import { SettingsPanel } from './SettingsPanel';
import { Unsupported } from './Unsupported';
import { FpsReadout } from './hud/FpsReadout';
import type { FpsStats } from './hud/FpsReadout';
import type { BoyPortraits } from './hud/BaseBars';
import { BattleScreen } from './screens/BattleScreen';
import type { BattleSessionLike, SessionFactory } from './screens/BattleScreen';
import { CreatePlayer } from './screens/CreatePlayer';
import { GrownUp } from './screens/GrownUp';
import { Home, Soon } from './screens/Home';
import { Leaderboard } from './screens/Leaderboard';
import { Almanac } from './screens/Almanac';
import type { AlmanacHost } from './screens/Almanac';
import { Players } from './screens/Players';
import { SidePick } from './screens/SidePick';
import { Title } from './screens/Title';
import { setUiSound } from './uiSound';
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
   * Called on every user activation (pointerup, touchend, click, keydown) for the life of the
   * page. Safari lets audio start, and resume after an interruption (a call, Siri, the iPad
   * locked), only inside one of these; pass the audio unlock, which is cheap while audio runs.
   * While a returned promise is pending, the other events of the same tap are not offered.
   * `pointerdown` does not count for touch.
   */
  onGesture?(): boolean | Promise<boolean>;
  energyRef?: Ref<HTMLDivElement>;
  /** With `?fps`: where the corner readout reads fps, render scale and draw calls. */
  fpsSource?: () => FpsStats;
  /** Plays a menu sound (a key, a refusal, a coin). */
  onSound?(name: SfxName): void;
  /** The Almanac's turntable on the shared stage (none: the Almanac shows its panels only). */
  almanac?: AlmanacHost;
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
 * offered every activation for as long as the app is mounted: Safari can suspend the audio at any
 * time, and only a gesture may resume it.
 */
function useTouchHousekeeping(onGesture: (() => boolean | Promise<boolean>) | undefined): void {
  const callback = useRef(onGesture);
  callback.current = onGesture;
  useEffect(() => {
    const noop = (): void => {};
    const noGesture = (e: Event): void => e.preventDefault();
    // One tap fires pointerup, touchend and click: while an answer is still on its way, the
    // later events of the same tap are not offered again.
    let waiting = false;
    const gesture = (): void => {
      const cb = callback.current;
      if (waiting || cb === undefined) return;
      let result: boolean | Promise<boolean>;
      try {
        result = cb();
      } catch (e) {
        console.error('onGesture failed', e);
        return;
      }
      if (result instanceof Promise) {
        waiting = true;
        result.then(
          () => { waiting = false; },
          (e: unknown) => { waiting = false; console.error('onGesture failed', e); },
        );
      }
    };
    document.addEventListener('touchstart', noop, { passive: true });
    document.addEventListener('gesturestart', noGesture);
    for (const name of ACTIVATION_EVENTS) document.addEventListener(name, gesture, true);
    return () => {
      for (const name of ACTIVATION_EVENTS) document.removeEventListener(name, gesture, true);
      document.removeEventListener('touchstart', noop);
      document.removeEventListener('gesturestart', noGesture);
    };
  }, []);
}

export function App({ createSession: given, portraits, boys, onSettingsChange, onGesture, energyRef, fpsSource, onSound, almanac }: AppProps) {
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

  useEffect(() => {
    setUiSound(onSound ?? null);
    return () => setUiSound(null);
  }, [onSound]);

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
    case 'players':
      body = <Players portraits={portraits} login={s.login} />;
      break;
    case 'create':
      body = <CreatePlayer key={s.boy ?? 'new'} portraits={portraits} boy={s.boy} />;
      break;
    case 'home':
      body = <Home portraits={portraits} />;
      break;
    case 'leaderboard':
      body = <Leaderboard portraits={portraits} />;
      break;
    case 'almanac':
      body = <Almanac portraits={portraits} host={almanac} />;
      break;
    case 'marketplace':
      body = <Soon place={s.name} />;
      break;
    case 'grownup':
      body = <GrownUp portraits={portraits} />;
      break;
    case 'sidepick':
      body = <PlayerSidePick boys={boys} />;
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
      {fpsSource !== undefined && <FpsReadout source={fpsSource} />}
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

  const { coins, rankUp } = useBattleCoins(live, options);

  if (live === null) return null;
  const again = (): void => go({ name: 'battle', options: { ...options, seed: (Date.now() + live.id) >>> 0 } });
  // A logged-in player goes back to their Home; a battle opened without one, to the title.
  const quit = (): void => go({ name: players.player.peek() !== null ? 'home' : 'title' });
  return (
    <BattleScreen
      key={live.id} session={live.session} {...rest}
      onRestart={again} onQuit={quit} coins={coins} rankUp={rankUp}
    />
  );
}

/**
 * When the battle is decided and a player is logged in: its coins and win go into the save
 * (`applyBattleResult` through `session.update`), once per battle. Returns the coins earned and,
 * once the board has been fetched (or the copy kept here read), the player's best move up a
 * leaderboard table (null: no move, or nobody else on the board).
 */
function useBattleCoins(
  live: { id: number; session: BattleSessionLike } | null, options: BattleOptions,
): { coins: number | null; rankUp: RankUp | null } {
  const [coins, setCoins] = useState<number | null>(null);
  const [rankUp, setRankUp] = useState<RankUp | null>(null);
  useEffect(() => {
    setCoins(null);
    setRankUp(null);
    if (live === null) return undefined;
    const ctl = live.session.controller;
    let done = false;
    let alive = true;
    const stop = ctl.hud.result.subscribe((result) => {
      const before = players.player.peek();
      if (result === null || done || before === null) return;
      done = true;
      const base = ctl.hud.base.peek()[ctl.playerFaction];
      const r = { won: result.playerWon, skill: options.skill, baseHpShare: base.max > 0 ? base.hp / base.max : 0 };
      players.update((save) => applyBattleResult(save, { ...r, versus: false }, players.now()));
      setCoins(rewardFor(r));
      const after = players.player.peek();
      if (after === null) return;
      // The others' rows from the board just fetched; the player's own, before and after, from the save.
      void board.fetch().then(
        (v) => { if (alive) setRankUp(rankChange(v.rows, before, after)); },
        (e: unknown) => console.error('board failed', e),
      );
    });
    return () => {
      alive = false;
      stop();
    };
  }, [live, options]);
  return { coins, rankUp };
}

/**
 * The side pick, for the logged-in player: preset from their save (Lukas on plants, Toby on
 * zombies, each side at its saved difficulty); a change of difficulty is saved. Back goes Home.
 */
function PlayerSidePick({ boys }: { boys: BoyPortraits | undefined }) {
  const me = players.player.value;
  if (me === null) return <SidePick portraits={boys} />;
  return (
    <SidePick
      portraits={boys} difficulty={me.difficulty} upgrades={me.upgrades}
      side={me.slot === 'p01' ? 'plants' : me.slot === 'p02' ? 'zombies' : null}
      onSkill={(side, skill) => players.update((save) => ({ ...save, difficulty: { ...save.difficulty, [side]: skill } }))}
      onBack={() => go({ name: 'home' })}
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
