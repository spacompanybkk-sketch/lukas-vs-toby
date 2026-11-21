import './theme.css';
import './icons.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Ref } from 'preact';
import { BattleController } from '../app/BattleController';
import type { BattleOptions } from '../app/BattleController';
import { loadSettings, saveSettings } from '../app/settings';
import type { Settings } from '../app/settings';
import { session as players } from '../app/session';
import { go, screen, startFreePlay, startLevel } from '../app/store';
import { settleFreePlay, settleLevel } from '../app/levelSession';
import type { VersusFlow } from '../app/versus';
import { rememberTaught } from '../app/tutorial';
import type { Tutorial } from '../app/tutorial';
import type { FreePlayOutcome, LevelOutcome, LevelRecord } from '../app/levelSession';
import { FREE_PLAY } from '../adventure/freePlay';
import type { FreePlayRecord } from '../adventure/freePlay';
import type { Turntable } from './hud/ResultOverlay';
import type { SfxName } from '../audio/sfx';
import type { Theme } from '../audio/music';
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
import { Home } from './screens/Home';
import { Marketplace } from './screens/Marketplace';
import { Leaderboard } from './screens/Leaderboard';
import { Almanac } from './screens/Almanac';
import type { AlmanacHost } from './screens/Almanac';
import { Players } from './screens/Players';
import { SidePick } from './screens/SidePick';
import { PlayMenu, PlaySide } from './screens/PlayMenu';
import { MapScreen } from './screens/Map';
import type { MapHost } from './screens/Map';
import { Title } from './screens/Title';
import type { VersusTicksProps } from './screens/GrownUp';
import { GettingReady } from './versus/GettingReady';
import { InviteCard } from './versus/InviteCard';
import { InvitePanel } from './versus/InvitePanel';
import { VersusNotice } from './versus/VersusNotice';
import { WhoIsHere } from './versus/WhoIsHere';
import { setUiSound } from './uiSound';
import type { UiSoundOptions } from './uiSound';
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
  onSound?(name: SfxName, opts?: UiSoundOptions): void;
  /** Plays a tune on a menu screen that picks its own (the Adventure map: the island shown). */
  onMusic?(theme: Theme): void;
  /** The Almanac's turntable on the shared stage (none: the Almanac shows its panels only). */
  almanac?: AlmanacHost;
  /** The Adventure map's 3D board on the shared stage (none: the stones are laid out flat). */
  map?: MapHost;
  /**
   * Two-device Versus: the page's flow (`pageVersusFlow`), one for the life of the page; it follows
   * log-ins and log-outs itself. None: no Versus (the tile stays locked, no panel, no way back).
   */
  versus?: VersusFlow;
}

const NO_PORTRAITS: Record<string, string> = Object.freeze({});

/** The screens a player waits on, where an invite may arrive (spec 4.2); the lobby counts the device "here" on them. */
const MENU_SCREENS: ReadonlySet<string> = new Set(['home', 'play', 'map', 'marketplace', 'almanac', 'leaderboard']);

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

export function App({ createSession: given, portraits, boys, onSettingsChange, onGesture, energyRef, fpsSource, onSound, onMusic, almanac, map, versus: givenFlow }: AppProps) {
  const versus = givenFlow ?? null;
  const createSession = given ?? (import.meta.env.DEV ? hudOnlySession : missingSession);
  const s = screen.value;
  const portrait = usePortrait();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useTouchHousekeeping(onGesture);
  const phase = versus?.phase.value ?? null;
  const incoming = versus?.incoming.value ?? null;
  useVersusRouting(versus, phase);
  const ticks = useVersusTicks(versus, s.name === 'grownup');
  // The who-is-here list and its card are menus too: an invite may arrive there, and the device is "here".
  const onMenu = MENU_SCREENS.has(s.name) || (s.name === 'versus' && (phase?.name === 'here' || phase?.name === 'card'));
  useEffect(() => { versus?.onMenu(onMenu); }, [versus, onMenu]);

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
      body = <Title onSettings={() => setSettingsOpen(true)} canRejoin={versus?.canRejoin} onRejoin={() => versus?.rejoin()} />;
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
      body = <Marketplace portraits={portraits} />;
      break;
    case 'grownup':
      body = <GrownUp portraits={portraits} versus={ticks} />;
      break;
    case 'sidepick':
      body = <PlayerSidePick boys={boys} />;
      break;
    case 'play':
      body = <PlayMenu versus={versus === null ? undefined : { allowed: versus.allowed.value, onOpen: () => versus.open() }} />;
      break;
    case 'side':
      body = <PlaySide key={s.mode} mode={s.mode} boys={boys} portraits={portraits} />;
      break;
    case 'map':
      body = <MapScreen side={s.side} card={s.card} world={s.world} portraits={portraits} boys={boys} host={map} onMusic={onMusic} />;
      break;
    case 'battle':
      body = (
        <BattleHost
          options={s.options} createSession={createSession} portraits={portraits} boys={boys}
          portrait={portrait} settings={settings} onSettingsChange={changeSettings} energyRef={energyRef}
          turntable={almanac} versus={versus}
        />
      );
      break;
    case 'versus':
      body = versus === null || phase === null ? null : <VersusScreen flow={versus} phase={phase} portraits={portraits ?? NO_PORTRAITS} />;
      break;
    case 'unsupported':
      body = <Unsupported reason={s.reason} />;
      break;
  }

  return (
    <>
      <div data-app class="app" aria-hidden={portrait ? 'true' : undefined} inert={portrait || undefined}>
        {body}
        {versus !== null && onMenu && incoming !== null && (phase === null || phase.name === 'closed' || phase.name === 'here' || phase.name === 'card') && (
          <InvitePanel
            invite={incoming} portraits={portraits ?? NO_PORTRAITS}
            onAccept={() => versus.accept()} onDecline={() => versus.decline()}
          />
        )}
        {versus !== null && phase?.name === 'notice' && <VersusNotice kind={phase.kind} onHome={() => versus.home()} />}
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
  /** The Almanac's turntable, where a level's unlocked unit is shown. */
  turntable: Turntable | undefined;
  /** The page's Versus flow: a battle with `options.online` is its battle (its link, credit, result and rematch). */
  versus: VersusFlow | null;
}

let sessionCount = 0;

/** Owns one session per `options` object: a new object (restart) disposes the old and builds anew. */
function BattleHost({ options, createSession, versus, ...rest }: BattleHostProps) {
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
  const { outcome, rankUp: levelRankUp } = useLevelResult(live, options);
  useTeached(live, options);
  useVersusLink(live, options, versus);
  const { outcome: freeOutcome, rankUp: freeRankUp } = useFreePlayResult(live, options);

  if (live === null) return null;
  const play = options.play;
  // A level is started again through `startLevel` (a fresh battle id, the save as it is now).
  const again = (): void => {
    const me = players.player.peek();
    if (play !== undefined && me !== null) {
      if (!startLevel(play.def, me, (Date.now() + live.id) >>> 0)) go({ name: 'map', side: play.def.side });
      return;
    }
    go({ name: 'battle', options: { ...options, seed: (Date.now() + live.id) >>> 0 } });
  };
  // A logged-in player goes back to their Home, a battle opened without one, to the title.
  const quit = (): void => go({ name: players.player.peek() !== null ? 'home' : 'title' });
  const seat = options.online;
  if (seat !== undefined && versus !== null) {
    // Two-device Versus: the flow owns the end (credit, result, rematch, home); the screen never leaves by itself.
    const ph = versus.phase.value;
    return (
      <BattleScreen
        key={live.id} session={live.session} {...rest} onRestart={quit} onQuit={quit}
        versus={{
          me: seat.me, other: seat.other, face: (slot) => versus.face(slot), result: ph.name === 'result' ? ph.vm : null,
          onRematch: () => versus.rematch(), onHome: () => versus.home(),
        }}
      />
    );
  }
  const free = options.free;
  if (free !== undefined) {
    // Free Play: again is a fresh run on the same side; the way out is Home.
    const runAgain = (): void => {
      const me = players.player.peek();
      if (me === null) quit();
      else startFreePlay(free.side, me, (Date.now() + live.id) >>> 0);
    };
    // The pause menu's Quit ends the run and banks it (like losing); the result's Home goes Home.
    const endRun = (): void => {
      const ctl = live.session.controller as BattleSessionLike['controller'] & { quitRun?(): void };
      if (ctl.quitRun !== undefined) ctl.quitRun();
      else quit();
    };
    return <BattleScreen key={live.id} session={live.session} {...rest} onRestart={runAgain} onQuit={endRun} onHome={quit} freePlay={freeOutcome} rankUp={freeRankUp} />;
  }
  if (play === undefined) {
    return <BattleScreen key={live.id} session={live.session} {...rest} onRestart={again} onQuit={quit} coins={coins} rankUp={rankUp} />;
  }
  // In a level the one way out (pause's Quit, the result's map) is the level's map.
  const toMap = (): void => go({ name: 'map', side: play.def.side });
  const next = (): void => {
    const me = players.player.peek();
    const to = outcome?.next ?? null;
    if (me === null || to === null || !startLevel(to, me)) toMap();
  };
  return (
    <BattleScreen
      key={live.id} session={live.session} {...rest}
      onRestart={again} onQuit={toMap} onMap={toMap} onNextLevel={next}
      level={outcome} rankUp={levelRankUp}
    />
  );
}

/**
 * An Adventure level's result, the moment the match is decided: its record is kept on the device,
 * applied to the save (`settleLevel`: stars, coins, unlock, once per battle id) and taken off the
 * device. Returns what the result shows, and the player's best move up a leaderboard table.
 * Quick Battle never comes here (and a level never pays through `useBattleCoins`).
 */
function useLevelResult(
  live: { id: number; session: BattleSessionLike } | null, options: BattleOptions,
): { outcome: LevelOutcome | null; rankUp: RankUp | null } {
  const [outcome, setOutcome] = useState<LevelOutcome | null>(null);
  const [rankUp, setRankUp] = useState<RankUp | null>(null);
  useEffect(() => {
    setOutcome(null);
    setRankUp(null);
    if (live === null || options.play === undefined) return undefined;
    const ctl = live.session.controller as BattleSessionLike['controller'] & { levelResult?(): LevelRecord | null };
    let done = false;
    let alive = true;
    const stop = ctl.hud.result.subscribe((result) => {
      const before = players.player.peek();
      if (result === null || done || before === null) return;
      const record = ctl.levelResult?.() ?? null;
      if (record === null) return;
      done = true;
      const out = settleLevel(players, record, options.play?.slot ?? before.slot);
      setOutcome(out);
      const after = players.player.peek();
      if (out === null || after === null) return;
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
  return { outcome, rankUp };
}

/**
 * A Free Play run's result, the moment it is over: its record is kept on the device, applied to the
 * save (`settleFreePlay`: 5 coins a wave cleared, bestWave, once per battle id) and taken off the
 * device. Returns what the result shows, and the player's best move up a leaderboard table.
 */
function useFreePlayResult(
  live: { id: number; session: BattleSessionLike } | null, options: BattleOptions,
): { outcome: FreePlayOutcome | null; rankUp: RankUp | null } {
  const [outcome, setOutcome] = useState<FreePlayOutcome | null>(null);
  const [rankUp, setRankUp] = useState<RankUp | null>(null);
  useEffect(() => {
    setOutcome(null);
    setRankUp(null);
    const free = options.free;
    if (live === null || free === undefined) return undefined;
    const ctl = live.session.controller as BattleSessionLike['controller'] & { freeResult?(): FreePlayRecord | null };
    let done = false;
    let alive = true;
    const stop = ctl.hud.result.subscribe((result) => {
      const before = players.player.peek();
      if (result === null || done) return;
      const record = ctl.freeResult?.() ?? null;
      if (record === null) return;
      done = true;
      // Kept on the device first; applied now only for the run's own player (else at their log-in).
      const out = settleFreePlay(players, record, free.slot);
      // Not applied here (the run's player is not the one logged in): the run's own numbers, paid later.
      setOutcome(out ?? {
        side: record.side, wave: record.wave, cleared: record.cleared,
        coins: record.cleared * FREE_PLAY.coinsPerWave, best: false,
      });
      const after = players.player.peek();
      if (out === null || after === null || before === null) return;
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
  return { outcome, rankUp };
}

/**
 * The tutorial steps done in this battle go into the save (`teached`) as they are done, so a step
 * is shown once per player; nothing is kept for anyone but the level's own player.
 */
function useTeached(live: { id: number; session: BattleSessionLike } | null, options: BattleOptions): void {
  useEffect(() => {
    const play = options.play;
    const tutorial = (live?.session.controller as { tutorial?: Tutorial | null } | undefined)?.tutorial ?? null;
    if (play === undefined || tutorial === null) return undefined;
    let kept = 0;
    return tutorial.taught.subscribe((ids) => {
      const fresh = ids.slice(kept);
      kept = ids.length;
      if (fresh.length === 0 || players.player.peek()?.slot !== play.slot) return;
      players.update((save) => fresh.reduce(rememberTaught, save));
    });
  }, [live, options]);
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
      // An Adventure level pays only through `applyLevelResult` (useLevelResult), never here; a two-device Versus match only through the flow.
      if (result === null || done || before === null || options.level !== undefined || options.play !== undefined || options.free !== undefined || options.online !== undefined) return;
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
 * A two-device Versus battle's link to the flow: the battle screen is up, so the link starts; and
 * when the controller's outcome comes, the flow credits it once and shows the result or a notice.
 */
function useVersusLink(live: { id: number; session: BattleSessionLike } | null, options: BattleOptions, flow: VersusFlow | null): void {
  useEffect(() => {
    const online = live?.session.controller.online;
    if (flow === null || live === null || options.online === undefined || online == null) return undefined;
    flow.battleBegan();
    return online.outcome.subscribe((o) => { if (o !== null) flow.battleOutcome(o); });
  }, [live, options, flow]);
}

/**
 * Keeps the screen where the flow's phase says: the list, the card and getting ready are the
 * `versus` screen; a battle is the battle screen; and when the flow closes the screen it opened
 * (or the battle it ended) goes Home (the list's back goes to the Play menu it came from). The
 * result and the notices show over the screen they came on.
 */
function useVersusRouting(flow: VersusFlow | null, phase: VersusFlow['phase']['value'] | null): void {
  const before = useRef<string>('closed');
  const battle = phase?.name === 'battle' ? phase.options : null;
  useEffect(() => {
    if (flow === null || phase === null) return;
    const came = before.current;
    before.current = phase.name;
    const here = screen.peek();
    if (phase.name === 'battle') {
      if (!(here.name === 'battle' && here.options === phase.options)) go({ name: 'battle', options: phase.options });
    } else if (phase.name === 'here' || phase.name === 'card' || phase.name === 'ready') {
      if (here.name !== 'versus') go({ name: 'versus' });
    } else if (phase.name === 'closed' && (here.name === 'versus' || (here.name === 'battle' && here.options.online !== undefined))) {
      go({ name: came === 'here' || came === 'card' ? 'play' : players.player.peek() !== null ? 'home' : 'title' });
    }
  }, [flow, phase?.name, battle]);
}

/** The grown-up screen's Versus list, fetched when that screen opens (none until it arrives, or without a connection). */
function useVersusTicks(flow: VersusFlow | null, wanted: boolean): VersusTicksProps | undefined {
  const [ticks, setTicks] = useState<VersusTicksProps | undefined>(undefined);
  useEffect(() => {
    if (flow === null || !wanted) return undefined;
    let alive = true;
    void flow.ticks().then((t) => { if (alive && t !== null) setTicks(t); }, () => undefined);
    return () => { alive = false; };
  }, [flow, wanted]);
  return ticks;
}

/** The `versus` screen: "who is here", with the invite card over it, or getting ready. */
function VersusScreen({ flow, phase, portraits }: { flow: VersusFlow; phase: VersusFlow['phase']['value']; portraits: Record<string, string> }) {
  if (phase.name === 'ready') {
    return <GettingReady me={phase.me} them={phase.them} mySide={phase.mySide} blocks={phase.blocks} portraits={portraits} />;
  }
  if (phase.name !== 'here' && phase.name !== 'card') return null;
  return (
    <>
      <WhoIsHere faces={flow.here.value} portraits={portraits} onPick={(slot) => flow.pick(slot)} onBack={() => flow.home()} />
      {phase.name === 'card' && (
        <InviteCard
          draft={phase.draft} state={phase.state} portraits={portraits}
          onSwap={() => flow.swap()} onHead={(step) => flow.head(step)} onSend={() => flow.send()} onClose={() => flow.closeCard()}
        />
      )}
    </>
  );
}

/**
 * The side pick, for the logged-in player: preset from their save (Lukas on plants, Toby on
 * zombies, each side at its saved difficulty); a change of difficulty is saved. Back goes Home.
 */
function PlayerSidePick({ boys }: { boys: BoyPortraits | undefined }) {
  const me = players.player.value;
  if (me === null) return <SidePick portraits={boys} onBack={() => go({ name: 'play' })} />;
  return (
    <SidePick
      portraits={boys} difficulty={me.difficulty} upgrades={me.upgrades}
      side={me.slot === 'p01' ? 'plants' : me.slot === 'p02' ? 'zombies' : null}
      onSkill={(side, skill) => players.update((save) => ({ ...save, difficulty: { ...save.difficulty, [side]: skill } }))}
      onBack={() => go({ name: 'play' })}
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
