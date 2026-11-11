import { useEffect, useState } from 'preact/hooks';
import type { Ref } from 'preact';
import type { BattleOptions, HudSignals } from '../../app/BattleController';
import type { Settings } from '../../app/settings';
import type { Faction, UnitKey } from '../../sim/types';
import { SettingsPanel } from '../SettingsPanel';
import { BaseBars } from '../hud/BaseBars';
import type { BoyPortraits } from '../hud/BaseBars';
import { CardTray } from '../hud/CardTray';
import { EnergyCounter } from '../hud/EnergyCounter';
import { PauseMenu } from '../hud/PauseMenu';
import { ResultOverlay } from '../hud/ResultOverlay';
import { TopBar } from '../hud/TopBar';
import '../hud/hud.css';

/** What the battle screen needs from a session; the real `BattleSession` satisfies it, tests pass a fake. */
export interface BattleSessionLike {
  controller: {
    hud: HudSignals;
    playerFaction: Faction;
    select(unit: UnitKey | null): void;
    toggleShovel(): void;
    setPaused(paused: boolean): void;
  };
  begin(): void;
  dispose(): void;
}

/** Builds a session for a battle; throws Error('webgl2-unavailable') when the device cannot draw it. */
export type SessionFactory = (options: BattleOptions) => BattleSessionLike;

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
}

/** Each intro banner shows this long; the session begins when the second has gone. */
export const BANNER_MS = 700;

type Phase = 'ready' | 'fight' | 'live';

/**
 * The HUD over the lawn. It draws only from the session's signals and talks back only through
 * the controller's methods, so the same layout runs with the real 3D session or a fake.
 */
export function BattleScreen(props: BattleScreenProps) {
  const { session, portraits = {}, boys, portrait = false, settings, onSettingsChange, onRestart, onQuit, energyRef } = props;
  const ctl = session.controller;
  const hud = ctl.hud;
  const side = ctl.playerFaction;
  const [phase, setPhase] = useState<Phase>('ready');
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setPhase('ready');
    const fight = setTimeout(() => setPhase('fight'), BANNER_MS);
    const live = setTimeout(() => {
      setPhase('live');
      session.begin();
    }, BANNER_MS * 2);
    return () => {
      clearTimeout(fight);
      clearTimeout(live);
    };
  }, [session]);

  // A hidden tab always pauses; coming back never resumes by itself.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden && hud.result.peek() === null) ctl.setPaused(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [ctl, hud]);

  useEffect(() => {
    if (portrait && hud.result.peek() === null) ctl.setPaused(true);
  }, [portrait, ctl, hud]);

  const paused = hud.paused.value;
  const result = hud.result.value;
  const pause = (): void => {
    if (hud.result.peek() === null) ctl.setPaused(true);
  };
  const resume = (): void => {
    setSettingsOpen(false);
    ctl.setPaused(false);
  };

  return (
    <div data-screen="battle" class={`battle side-${side}`}>
      <div class="battle__top">
        <div class="battle__left">
          <EnergyCounter value={hud.energy.value} side={side} anchorRef={energyRef} />
        </div>
        <TopBar seconds={hud.seconds.value} suddenDeath={hud.suddenDeath.value} />
        <div class="battle__right">
          <button
            type="button" data-hud="pause" class="btn btn--square btn--small pal-stone hud-pause"
            aria-label="Pause" onClick={pause}
          >
            <span class="ico ico--pause" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div class="battle__bases">
        <BaseBars base={hud.base.value} playerFaction={side} portraits={boys} />
      </div>
      <div class="battle__bottom">
        <CardTray
          cards={hud.cards.value} selected={hud.selected.value} portraits={portraits} side={side}
          denied={hud.denied.value}
          onSelect={(u) => ctl.select(u)} onDeselect={() => ctl.select(null)}
          shovel={hud.shovel.value} onShovel={side === 'plants' ? () => ctl.toggleShovel() : undefined}
        />
      </div>

      {phase !== 'live' && result === null && (
        <div class="battle__banner" data-banner={phase} aria-live="assertive">
          <span key={phase} class={`banner inked banner--${phase}`}>{phase === 'ready' ? 'READY…' : 'FIGHT!'}</span>
        </div>
      )}

      {paused && result === null && !settingsOpen && (
        <PauseMenu onResume={resume} onRestart={onRestart} onSettings={() => setSettingsOpen(true)} onQuit={onQuit} />
      )}
      {paused && result === null && settingsOpen && (
        <SettingsPanel settings={settings} onChange={onSettingsChange} onClose={() => setSettingsOpen(false)} />
      )}
      {result !== null && (
        <ResultOverlay
          result={result} playerFaction={side} seconds={hud.seconds.value} portraits={boys}
          onPlayAgain={onRestart} onMenu={onQuit}
        />
      )}
    </div>
  );
}
