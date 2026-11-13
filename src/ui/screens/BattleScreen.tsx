import type { RankUp } from '../../app/board';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, Ref } from 'preact';
import { batch, useComputed, useSignal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import type { BattleOptions, HudSignals, IncomingVM, LevelHudInfo, LevelSignals } from '../../app/BattleController';
import type { LevelOutcome } from '../../app/levelSession';
import { ADVENTURE } from '../../adventure/rewards';
import type { Settings } from '../../app/settings';
import type { Faction, SpellKey, UnitKey } from '../../sim/types';
import { SettingsPanel } from '../SettingsPanel';
import { BaseBar } from '../hud/BaseBars';
import { BossBar } from '../hud/BossBar';
import type { BoyPortraits } from '../hud/BaseBars';
import { CardTray } from '../hud/CardTray';
import { useTrayLayout } from '../hud/trayLayout';
import { HERO_NAMES, HeroButton } from '../hud/HeroButton';
import { SpellButtons } from '../hud/SpellButtons';
import type { SpellButtonVM } from '../hud/SpellButtons';
import { EnergyCounter } from '../hud/EnergyCounter';
import { PauseMenu } from '../hud/PauseMenu';
import { ResultOverlay } from '../hud/ResultOverlay';
import type { Turntable } from '../hud/ResultOverlay';
import { Belt } from '../hud/Belt';
import { ClockGoal } from '../hud/ClockGoal';
import { WaveBar } from '../hud/WaveBar';
import { ALERT } from '../hud/levelPictures';
import { PixelIcon } from '../hud/PixelIcon';
import { TopBar } from '../hud/TopBar';
import { PointingHand } from '../hud/PointingHand';
import type { GloveHost } from '../hud/PointingHand';
import type { GloveVM } from '../../app/tutorial';
import type { EndlessSignals } from '../../app/BattleController';
import type { FreePlayOutcome } from '../../app/levelSession';
import { BALANCE } from '../../data/balance';
import { FreePlayResult, FreePlayTop, RunBank, WaveBanner, bigOne } from './FreePlay';
import { FREE_PLAY, wavesCleared } from '../../adventure/freePlay';

/** The seconds a broken garden adds to Free Play's clock (the "+30"). */
const FREE_BONUS_SECONDS = BALANCE.endless.clockBonusSeconds;
import '../hud/hud.css';

/** What the battle screen needs from a session; the real `BattleSession` satisfies it, tests pass a fake. */
export interface BattleSessionLike {
  controller: {
    hud: HudSignals;
    playerFaction: Faction;
    select(unit: UnitKey | null): void;
    toggleShovel(): void;
    setPaused(paused: boolean): void;
    /** The hero button: pick the hero power or put it down (a refusal counts in `hud.denied`). */
    toggleHero?(): void;
    /** A spell button: pick an aimed spell (again: put it down), or cast an un-aimed one. */
    selectSpell?(key: SpellKey | null): void;
    /** An Adventure level's fixed HUD info (clock, waves, belt); null or absent: a Quick Battle. */
    level?: LevelHudInfo | null;
    /** The level's own signals (the belt, the big-wave cue). */
    levelHud?: LevelSignals;
    /** A belt card tapped (its slot), or null: put down. */
    selectBelt?(slot: number | null): void;
    /** A Free Play run's HUD signals (none or null: no run). */
    endless?: EndlessSignals | null;
    /** The level's tutorial: where its glove points (none or null: no tutorial). */
    tutorial?: { glove: ReadonlySignal<GloveVM | null>; sunPulse?: ReadonlySignal<number> } | null;
  };
  /** Client pixels of a tile's middle (the big-wave cue stands at a lane's end); none: no cue. */
  tileToClient?(lane: number, col: number): { x: number; y: number } | null;
  /** Client pixels of one of the units (the tutorial's glove points at it); null when it is gone. */
  unitToClient?(id: number): { x: number; y: number } | null;
  begin(): void;
  dispose(): void;
  /**
   * When given, the result panel waits until this turns true (the end of the match plays out on
   * the lawn first). Without it the panel shows as soon as `hud.result` is set.
   */
  resultReady?: ReadonlySignal<boolean>;
  /** When given, the READY and FIGHT! banners wait for it (the opening camera move). */
  intro?: Promise<void>;
  /** No banners at all: the battle has already begun (a test scene jumping straight in). */
  skipIntro?: boolean;
  /** The last hero power used, by either side: its boy's banner shows for `HERO_BANNER_MS`. */
  heroBanner?: ReadonlySignal<{ side: Faction; n: number } | null>;
  /** A tap on the boss's entrance card: the lawn ends its entrance show too. */
  skipBossEntrance?(): void;
}

/** Builds a session for a battle; throws Error('webgl2-unavailable') when the device cannot draw it. */
export type SessionFactory = (options: BattleOptions) => BattleSessionLike;

type Controller = BattleSessionLike['controller'];

export interface BattleScreenProps {
  session: BattleSessionLike;
  /** Card portraits by unit key. */
  portraits?: Record<string, string>;
  boys?: BoyPortraits;
  /** True while the device is held in portrait: the battle pauses (and stays paused). */
  portrait?: boolean;
  settings: Settings;
  onSettingsChange(s: Settings): void;
  onRestart(): void;
  onQuit(): void;
  /** Handed to the energy counter, so the session can fly tokens into it. */
  energyRef?: Ref<HTMLDivElement>;
  /** Hero power and spells; absent until the controller provides them. */
  powers?: BattlePowers;
  /** Coins the logged-in player earned from this battle, shown falling on the result (none: no player). */
  coins?: number | null;
  /** The logged-in player's best move up a leaderboard table after this battle (none: no move). */
  rankUp?: RankUp | null;
  /** An Adventure level's applied result: the result shows its stars, coins and unlock. */
  level?: LevelOutcome | null;
  /** In a level: the next level and the map (result buttons). In a level `onQuit` is the map too. */
  onNextLevel?(): void;
  onMap?(): void;
  /** The turntable an unlocked unit is shown on. */
  turntable?: Turntable;
  /**
   * BOSS BAR SLOT (Task 3, bosses): the bosses task passes its BossBar here. This screen reads
   * nothing boss-specific; it only places whatever it is given under the level's goal bars.
   */
  bossBar?: ComponentChildren;
  /** A Free Play run's applied result: the wave reached, best, coins. */
  freePlay?: FreePlayOutcome | null;
  /** Free Play: the result's Home (the pause menu's Quit, `onQuit`, ends the run instead). */
  onHome?(): void;
}

/**
 * The hero power and spell buttons, beside the tray on the player's own side (Lukas left, Toby
 * right). Every part is optional: without `hero` there is no hero button, without `spells` (or
 * with none dealt) no spell buttons, and without either the bottom is the tray alone.
 */
export interface BattlePowers {
  hero?: ReadonlySignal<{ ready: boolean; fraction: number }>;
  heroSelected?: ReadonlySignal<boolean>;
  onHero?(): void;
  spells?: ReadonlySignal<SpellButtonVM[]>;
  spellSelected?: ReadonlySignal<string | null>;
  onSpell?(key: string): void;
}

/** Each intro banner shows this long; the session begins when the second has gone. */
export const BANNER_MS = 700;
/** A hero power's banner shows this long. */
export const HERO_BANNER_MS = 600;
/** A refused power button shakes this long (as the tray does). */
const SHAKE_MS = 300;

/**
 * The HUD over the lawn. This component reads no signal itself: each HUD block below is a small
 * leaf that reads only the signals it shows, so a tick re-renders only what changed (the clock
 * when a second passes, a card when its recharge steps), never the whole screen.
 */
export function BattleScreen(props: BattleScreenProps) {
  const { session, portraits = {}, boys = {}, portrait = false, settings, onSettingsChange, onRestart, onQuit, energyRef, powers, coins = null, rankUp = null } = props;
  const { level = null, onNextLevel, onMap, turntable, bossBar, freePlay = null, onHome } = props;
  const ctl = session.controller;
  const hud = ctl.hud;
  const side = ctl.playerFaction;

  // A hidden tab always pauses; coming back never resumes by itself.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden && hud.result.peek() === null) ctl.setPaused(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [ctl, hud]);

  // Turning the device upright pauses too (the rotate picture covers the game).
  useEffect(() => {
    if (portrait && hud.result.peek() === null) ctl.setPaused(true);
  }, [portrait, ctl, hud]);

  return (
    <div data-screen="battle" class={`battle side-${side}`}>
      <ResultClears hud={hud} resultReady={session.resultReady} clear={level !== null || ctl.endless != null}>
      <div class="battle__top">
        <div class="battle__left">
          {ctl.level?.noEnergy !== true && <LiveEnergy hud={hud} side={side} anchorRef={energyRef} teach={ctl.tutorial?.sunPulse} />}
        </div>
        {ctl.endless != null ? <FreePlayTop endless={ctl.endless} bonusSeconds={FREE_BONUS_SECONDS} /> : <LiveClock hud={hud} />}
        <div class="battle__right">
          <LivePause ctl={ctl} />
        </div>
      </div>
      <div class="battle__bases">
        <LiveBase hud={hud} faction="plants" playerFaction={side} portrait={boys.lukas} />
        {/* Free Play survive: the zombie base cannot fall, so it has no bar. */}
        {ctl.endless?.mode !== 'survive' && <LiveBase hud={hud} faction="zombies" playerFaction={side} portrait={boys.toby} />}
      </div>
      </ResultClears>
      {ctl.level != null && <LiveLevel hud={hud} info={ctl.level} />}
      {/* BOSS BAR SLOT (Task 3): the bosses task's bar, nothing else. A passed bar wins; otherwise the
          live one, whose own box places itself on the screen (display: contents); its entrance card
          sits beside it, in the top band; in a level it sits under the level's goal bars. */}
      {bossBar !== undefined
        ? <div class="battle__boss" data-hud-slot="boss">{bossBar}</div>
        : (
          <div class={`battle__boss-live${ctl.level != null ? ' is-level' : ''}`} data-hud-slot="boss">
            <LiveBoss hud={hud} onSkip={() => session.skipBossEntrance?.()} />
          </div>
        )}
      <LiveBottom ctl={ctl} portraits={portraits} powers={powers} boys={boys} />
      {ctl.levelHud !== undefined && session.tileToClient !== undefined && (
        <IncomingCues incoming={ctl.levelHud.incoming} at={(lane, side) => session.tileToClient?.(lane, side === 'zombies' ? 9 : 0) ?? null} />
      )}
      {ctl.tutorial != null && <LiveGlove hud={hud} glove={ctl.tutorial.glove} host={session} />}
      {ctl.endless != null && (
        <WaveBanner banner={ctl.endless.banner} side={ctl.endless.mode === 'survive' ? 'zombies' : 'plants'} mode={ctl.endless.mode} big={bigOne(ctl.endless.cards)} portraits={portraits} />
      )}
      {session.heroBanner !== undefined && <HeroBanner banner={session.heroBanner} boys={boys} />}
      <IntroBanner session={session} />
      <Overlays
        ctl={ctl} resultReady={session.resultReady} boys={boys} settings={settings} onSettingsChange={onSettingsChange}
        onRestart={onRestart} onQuit={onQuit} coins={coins} rankUp={rankUp}
        level={level} onNextLevel={onNextLevel} onMap={onMap} turntable={turntable} cards={portraits} freePlay={freePlay} onHome={onHome}
      />
    </div>
  );
}

/**
 * The battle HUD's top (energy, clock, pause, base bars), gone while a level's result is up, so its
 * stars, coins and unlock show on a clear screen. A Quick Battle's result keeps it.
 */
function ResultClears({ hud, resultReady, clear, children }: { hud: HudSignals; resultReady: ReadonlySignal<boolean> | undefined; clear: boolean; children: ComponentChildren }) {
  const up = hud.result.value !== null && (resultReady === undefined || resultReady.value);
  if (clear && up) return null;
  return <>{children}</>;
}

/** A level's goal: the clock bar (with the star marks for Breakthrough) and the wave bar; gone at the end. */
function LiveLevel({ hud, info }: { hud: HudSignals; info: LevelHudInfo }) {
  if (hud.result.value !== null) return null;
  const seconds = hud.seconds.value;
  const clock = info.goalSeconds !== null;
  const waves = info.lastWave > 0;
  if (!clock && !waves) return null;
  return (
    <div class="battle__level" data-hud="level" data-mode={info.mode}>
      {/* One bar: with a clock, the waves ride on it; the wave bar alone only without a clock. */}
      {clock && (
        <ClockGoal
          seconds={seconds} goal={info.goalSeconds as number} stars={info.clockStars}
          waves={waves ? { flags: info.flags, enemy: info.enemy } : undefined}
        />
      )}
      {!clock && waves && <WaveBar seconds={seconds} last={info.lastWave} flags={info.flags} enemy={info.enemy} />}
    </div>
  );
}

/** The tutorial's glove; hidden under the pause menu and the result. */
function LiveGlove({ hud, glove, host }: { hud: HudSignals; glove: ReadonlySignal<GloveVM | null>; host: GloveHost }) {
  return <PointingHand glove={glove} host={host} hidden={hud.paused.value || hud.result.value !== null} />;
}

/** A Free Play run's bank on the armed Quit: its score and the coins ending now would pay. */
function LiveBank({ endless }: { endless: EndlessSignals }) {
  const wave = endless.wave.value;
  return <RunBank wave={wave} coins={wavesCleared(endless.mode, wave) * FREE_PLAY.coinsPerWave} />;
}

/** How long a big wave's cue stays at its lane's end. */
export const INCOMING_MS = 1500;

/** A red "!" block at the end of each lane a big wave's unit comes down, for `INCOMING_MS`. */
function IncomingCues({ incoming, at }: { incoming: ReadonlySignal<IncomingVM | null>; at(lane: number, side: IncomingVM['side']): { x: number; y: number } | null }) {
  const [cues, setCues] = useState<{ n: number; x: number; y: number }[]>([]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stop = incoming.subscribe((v) => {
      if (v === null) return;
      const p = at(v.lane, v.side);
      if (p === null) return;
      setCues((old) => [...old.filter((c) => c.n !== v.n), { n: v.n, x: p.x, y: p.y }]);
      timers.push(setTimeout(() => setCues((old) => old.filter((c) => c.n !== v.n)), INCOMING_MS));
    });
    return () => {
      stop();
      timers.forEach(clearTimeout);
    };
  }, [incoming]);
  return (
    <>
      {cues.map((c) => (
        <span key={c.n} class="lvl-incoming" data-incoming={c.n} style={{ left: `${c.x}px`, top: `${c.y}px` }} aria-hidden="true">
          <PixelIcon art={ALERT} />
        </span>
      ))}
    </>
  );
}

function LiveEnergy({ hud, side, anchorRef, teach }: { hud: HudSignals; side: Faction; anchorRef: Ref<HTMLDivElement> | undefined; teach?: ReadonlySignal<number> }) {
  return <EnergyCounter value={hud.energy.value} side={side} anchorRef={anchorRef} teach={teach?.value ?? 0} />;
}

function LiveClock({ hud }: { hud: HudSignals }) {
  return <TopBar seconds={hud.seconds.value} suddenDeath={hud.suddenDeath.value} />;
}

/** The boss bar, in a boss level only. */
function LiveBoss({ hud, onSkip }: { hud: HudSignals; onSkip: () => void }) {
  return <BossBar boss={hud.boss.value} onSkip={onSkip} />;
}

function LiveBase({ hud, faction, playerFaction, portrait }: { hud: HudSignals; faction: Faction; playerFaction: Faction; portrait: string | undefined }) {
  return <BaseBar faction={faction} vm={hud.base.value[faction]} you={playerFaction === faction} portrait={portrait} />;
}

/** The pause button; gone once the match is decided. */
function LivePause({ ctl }: { ctl: Controller }) {
  const hud = ctl.hud;
  if (hud.result.value !== null) return null;
  return (
    <button
      type="button" data-hud="pause" class="btn btn--square btn--small pal-stone hud-pause"
      aria-label="Pause" onClick={() => { if (hud.result.peek() === null) ctl.setPaused(true); }}
    >
      <span class="ico ico--pause" aria-hidden="true" />
    </button>
  );
}

/**
 * The powers a controller offers on its own (the real one does): its hero and spell signals and
 * the methods the buttons call. Undefined for a controller without them.
 */
function controllerPowers(ctl: Controller): BattlePowers | undefined {
  const { toggleHero, selectSpell } = ctl;
  if (toggleHero === undefined || selectSpell === undefined) return undefined;
  const hud = ctl.hud;
  return {
    hero: hud.hero, heroSelected: hud.heroSelected, onHero: () => toggleHero.call(ctl),
    spells: hud.spells, spellSelected: hud.spellSelected, onSpell: (k) => selectSpell.call(ctl, k as SpellKey),
  };
}

/**
 * The bottom bar: the tray, with the player's powers beside it on his side. Re-renders only when
 * the number of cards (and so the row layout) changes; each block inside reads its own signals.
 * `powerDenied` counts the refusals that came from a power button: those shake the button, not
 * the tray.
 */
function LiveBottom({ ctl, portraits, powers, boys }: { ctl: Controller; portraits: Record<string, string>; powers: BattlePowers | undefined; boys: BoyPortraits }) {
  const count = useComputed(() => (ctl.level?.belt === true ? ADVENTURE.beltSlots : ctl.hud.cards.value.length)).value;
  const layout = useTrayLayout(count);
  const powerDenied = useSignal(0);
  const side = ctl.playerFaction;
  const shown = powers ?? controllerPowers(ctl);
  const slot = shown !== undefined && (shown.hero !== undefined || shown.spells !== undefined)
    ? <LivePowers ctl={ctl} powers={shown} portrait={side === 'plants' ? boys.lukas : boys.toby} powerDenied={powerDenied} />
    : null;
  return (
    <div
      class={`battle__bottom battle__bottom--rows-${layout.rows} side-${side}`}
      style={{
        gap: `${layout.barGap}px`, '--tray-gap': `${layout.gap}px`,
        '--bar-hero': `${layout.hero}px`, '--bar-spell': `${layout.spell}px`,
      }}
    >
      {side === 'plants' && slot}
      {ctl.level?.belt === true && ctl.levelHud !== undefined
        ? <LiveBelt ctl={ctl} levelHud={ctl.levelHud} portraits={portraits} powerDenied={powerDenied} />
        : <LiveTray ctl={ctl} portraits={portraits} powerDenied={powerDenied} />}
      {side === 'zombies' && slot}
    </div>
  );
}

/** Which power button shakes now ('hero' or a spell's key), and 1 or 2 so each refusal restarts it. */
interface Shake { key: string; n: number }

/** Hero and spell buttons; gone once the match is decided, like the tray. */
function LivePowers({ ctl, powers, portrait, powerDenied }: { ctl: Controller; powers: BattlePowers; portrait: string | undefined; powerDenied: Signal<number> }) {
  const [shake, setShake] = useState<Shake | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (ctl.hud.result.value !== null) return null;
  const side = ctl.playerFaction;
  const hero = powers.hero?.value;
  const spells = powers.spells?.value ?? [];
  /** Presses a button; a press the controller refused shakes that button (and not the tray). */
  const press = (key: string, act: () => void): void => {
    const before = ctl.hud.denied.peek();
    batch(() => {
      act();
      const refused = ctl.hud.denied.peek() - before;
      if (refused > 0) powerDenied.value += refused;
    });
    if (ctl.hud.denied.peek() === before) return;
    setShake((old) => ({ key, n: old !== null && old.n === 1 ? 2 : 1 }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShake(null), SHAKE_MS);
  };
  return (
    <div class={`battle__powers side-${side}`} data-hud="powers">
      {hero !== undefined && (
        <HeroButton
          faction={side} ready={hero.ready} fraction={hero.fraction} selected={powers.heroSelected?.value ?? false}
          portrait={portrait} onPress={() => press('hero', () => powers.onHero?.())}
          shake={shake?.key === 'hero' ? shake.n : 0}
        />
      )}
      {spells.length > 0 && (
        <SpellButtons
          spells={spells} selected={powers.spellSelected?.value ?? null} onPress={(k) => press(k, () => powers.onSpell?.(k))}
          shake={shake !== null && shake.key !== 'hero' ? shake : undefined}
        />
      )}
    </div>
  );
}

/**
 * A hero power just used: a full-width boxy band with the boy's portrait and the power's name,
 * for `HERO_BANNER_MS`. It takes no taps; the battle goes on under it.
 */
function HeroBanner({ banner, boys }: { banner: ReadonlySignal<{ side: Faction; n: number } | null>; boys: BoyPortraits }) {
  const now = banner.value;
  const [gone, setGone] = useState(0);
  useEffect(() => {
    if (now === null) return undefined;
    const t = setTimeout(() => setGone(now.n), HERO_BANNER_MS);
    return () => clearTimeout(t);
  }, [now]);
  if (now === null || gone === now.n) return null;
  const face = now.side === 'plants' ? boys.lukas : boys.toby;
  return (
    <div key={now.n} class={`hero-banner side-${now.side}`} data-banner="hero" aria-live="polite">
      {face !== undefined && <img class="hero-banner__face" src={face} alt="" draggable={false} />}
      <span class="hero-banner__name inked">{HERO_NAMES[now.side]}</span>
    </div>
  );
}

/** The card tray; gone once the match is decided, so the end plays out on a clear lawn. */
function LiveTray({ ctl, portraits, powerDenied }: { ctl: Controller; portraits: Record<string, string>; powerDenied: Signal<number> }) {
  const hud = ctl.hud;
  const side = ctl.playerFaction;
  if (hud.result.value !== null) return null;
  return (
    <CardTray
      cards={hud.cards.value} selected={hud.selected.value} portraits={portraits} side={side}
      denied={hud.denied.value - powerDenied.value}
      onSelect={(u) => ctl.select(u)} onDeselect={() => ctl.select(null)}
      shovel={hud.shovel.value} onShovel={side === 'plants' ? () => ctl.toggleShovel() : undefined}
    />
  );
}

/** The conveyor belt in place of the tray (a level whose belt is the player's); gone at the end. */
function LiveBelt({ ctl, levelHud, portraits, powerDenied }: { ctl: Controller; levelHud: LevelSignals; portraits: Record<string, string>; powerDenied: Signal<number> }) {
  const hud = ctl.hud;
  const side = ctl.playerFaction;
  if (hud.result.value !== null) return null;
  return (
    <Belt
      cards={levelHud.belt.value} slots={ADVENTURE.beltSlots} selected={levelHud.beltSlot.value} portraits={portraits} side={side}
      denied={hud.denied.value - powerDenied.value} onSelect={(slot) => ctl.selectBelt?.(slot)}
      shovel={hud.shovel.value} onShovel={side === 'plants' ? () => ctl.toggleShovel() : undefined}
    />
  );
}

type Phase = 'intro' | 'ready' | 'fight' | 'live';

/**
 * READY… then FIGHT!, BANNER_MS each, then `session.begin()`. The countdown holds while the game
 * is paused and resumes where it stopped; unmounting (Quit, a hidden screen change) cancels it,
 * so `begin()` is never called for a battle that was left during its banners.
 */
function IntroBanner({ session }: { session: BattleSessionLike }) {
  const hud = session.controller.hud;
  const paused = hud.paused.value;
  const over = hud.result.value !== null;
  const [phase, setPhase] = useState<Phase>(() => (session.skipIntro ? 'live' : session.intro ? 'intro' : 'ready'));
  const remaining = useRef(BANNER_MS);

  useEffect(() => {
    if (phase !== 'intro' || session.intro === undefined) return undefined;
    let gone = false;
    void session.intro.then(() => { if (!gone) setPhase('ready'); });
    return () => { gone = true; };
  }, [phase, session]);

  useEffect(() => {
    if (phase === 'live' || phase === 'intro' || paused) return undefined;
    const started = Date.now();
    let fired = false;
    const t = setTimeout(() => {
      fired = true;
      remaining.current = BANNER_MS;
      if (phase === 'ready') {
        setPhase('fight');
      } else {
        setPhase('live');
        session.begin();
      }
    }, remaining.current);
    return () => {
      clearTimeout(t);
      if (!fired) remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [phase, paused, session]);

  if (phase === 'live' || phase === 'intro' || over) return null;
  return (
    <div class="battle__banner" data-banner={phase} aria-live="assertive">
      <span key={phase} class={`banner inked banner--${phase}`}>{phase === 'ready' ? 'READY…' : 'FIGHT!'}</span>
    </div>
  );
}

interface OverlaysProps {
  ctl: Controller;
  resultReady: ReadonlySignal<boolean> | undefined;
  boys: BoyPortraits;
  settings: Settings;
  onSettingsChange(s: Settings): void;
  onRestart(): void;
  onQuit(): void;
  coins: number | null;
  rankUp: RankUp | null;
  level: LevelOutcome | null;
  onNextLevel: (() => void) | undefined;
  onMap: (() => void) | undefined;
  turntable: Turntable | undefined;
  cards: Record<string, string>;
  freePlay: FreePlayOutcome | null;
  onHome: (() => void) | undefined;
}

/** Pause menu (or settings in its place) while paused; the result panel once the match is decided. */
function Overlays({ ctl, resultReady, boys, settings, onSettingsChange, onRestart, onQuit, coins, rankUp, level, onNextLevel, onMap, turntable, cards, freePlay, onHome }: OverlaysProps) {
  const hud = ctl.hud;
  const paused = hud.paused.value;
  const result = hud.result.value;
  const ready = resultReady === undefined ? true : resultReady.value;
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (result !== null) {
    if (!ready) return null; // the base is still falling
    if (ctl.endless != null) {
      return <FreePlayResult outcome={freePlay} side={ctl.playerFaction} rankUp={rankUp} onAgain={onRestart} onHome={onHome ?? onQuit} />;
    }
    return (
      <ResultOverlay
        result={result} playerFaction={ctl.playerFaction} seconds={hud.seconds.value} portraits={boys}
        onPlayAgain={onRestart} onMenu={onQuit} coins={coins} rankUp={rankUp}
        level={level} onNext={onNextLevel} onMap={onMap} turntable={turntable} cards={cards}
      />
    );
  }
  if (!paused) return null;
  if (settingsOpen) {
    return <SettingsPanel settings={settings} onChange={onSettingsChange} onClose={() => setSettingsOpen(false)} />;
  }
  return (
    <PauseMenu
      onResume={() => { setSettingsOpen(false); ctl.setPaused(false); }}
      onRestart={onRestart} onSettings={() => setSettingsOpen(true)} onQuit={onQuit}
      bank={ctl.endless != null ? <LiveBank endless={ctl.endless} /> : undefined}
    />
  );
}
