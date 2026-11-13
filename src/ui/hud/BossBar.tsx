import { useEffect, useRef, useState } from 'preact/hooks';
import type { BossVM } from '../../app/BattleController';
import { BALANCE } from '../../data/balance';
import type { BossKey } from '../../sim/types';
import './bossBar.css';

// The boss's health, wide at the top centre under the clock (phase 3 Task 3): a small pixel face
// of the boss, a bar in blocks with a notch at each health mark where its shield goes up, and the
// shield showing over the bar while it is up. No words: the face says who, the bar says how much.
// It comes in with the boss: for its first 1.5 s it is a big face card in the middle of the screen
// (the entrance), which a tap sends to its place at once.

/** The bar fills in this many visible blocks. */
export const BOSS_BAR_STEPS = 40;
/** How long the entrance card shows before it moves up into the bar. */
export const BOSS_INTRO_MS = 1500;

/** The health marks (shares of max) where the boss's shield goes up, highest first: the bar's notches. */
export function bossNotches(key: BossKey): readonly number[] {
  for (const p of BALANCE.bosses[key].patterns) if (p.kind === 'shield') return p.atHealth;
  return [];
}

/** The bar's fill, cut to whole blocks, rounding up (a boss with health left never shows empty). */
export function bossStep(hp: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.ceil(Math.min(1, Math.max(0, hp / max)) * BOSS_BAR_STEPS) / BOSS_BAR_STEPS;
}

export interface BossBarProps {
  boss: BossVM | null;
  /** Called when the entrance is skipped by a tap (the view ends its own show too). */
  onSkip?: () => void;
  /** False: no entrance card (a still taken well after the boss came on). Default true. */
  intro?: boolean;
}

export function BossBar({ boss, onSkip, intro: withIntro = true }: BossBarProps) {
  const [intro, setIntro] = useState(false);
  const seen = useRef(false);
  useEffect(() => {
    if (boss === null || seen.current) return;
    seen.current = true;
    if (!withIntro) return;
    setIntro(true);
    const timer = setTimeout(() => setIntro(false), BOSS_INTRO_MS);
    return () => clearTimeout(timer);
  }, [boss !== null]);

  if (boss === null) return null;
  const frac = bossStep(boss.hp, boss.max);
  const down = boss.hp <= 0;
  const skip = (): void => {
    setIntro(false);
    onSkip?.();
  };
  return (
    <>
      <div
        data-hud="boss"
        class={`hud-boss hud-boss--${boss.key}${boss.shield ? ' is-shielded' : ''}${down ? ' is-down' : ''}`}
      >
        <span class="hud-boss__face px pal-bone" aria-hidden="true">
          <BossFace boss={boss.key} down={down} />
        </span>
        <span
          class="hud-boss__bar px"
          role="meter" aria-label="Boss" aria-valuemin={0} aria-valuemax={boss.max} aria-valuenow={boss.hp}
        >
          <span class="hud-boss__fill" style={{ width: `${frac * 100}%` }} />
          <span class="hud-boss__blocks" aria-hidden="true" />
          {bossNotches(boss.key).map((mark) => (
            <span key={mark} class={`hud-boss__notch${frac <= mark ? ' is-passed' : ''}`} style={{ left: `${mark * 100}%` }} aria-hidden="true" />
          ))}
          {boss.shield && <span class="hud-boss__shield" aria-hidden="true"><ShieldIcon /></span>}
        </span>
      </div>
      {intro && (
        <button type="button" data-hud="boss-intro" class={`hud-boss-intro hud-boss-intro--${boss.key}`} aria-label="Boss" onPointerDown={skip}>
          <span class="hud-boss-intro__card px pal-bone"><BossFace boss={boss.key} /></span>
        </button>
      )}
    </>
  );
}

/** A pixel shield, drawn in squares. */
function ShieldIcon() {
  return (
    <svg viewBox="0 0 8 9" shape-rendering="crispEdges" class="hud-boss__shield-icon">
      <rect x="0" y="0" width="8" height="5" fill="#2A1B0E" />
      <rect x="1" y="5" width="6" height="2" fill="#2A1B0E" />
      <rect x="2" y="7" width="4" height="1" fill="#2A1B0E" />
      <rect x="3" y="8" width="2" height="1" fill="#2A1B0E" />
      <rect x="1" y="1" width="6" height="4" fill="#9FE7FF" />
      <rect x="2" y="5" width="4" height="2" fill="#9FE7FF" />
      <rect x="3" y="7" width="2" height="1" fill="#9FE7FF" />
      <rect x="1" y="1" width="2" height="2" fill="#FFFFFF" />
    </svg>
  );
}

/** The boss's face, 12 pixels square, crisp: the Titan's green head with its brain crown, the Oak's bark face under leaves. */
export function BossFace({ boss, down = false }: { boss: BossKey; down?: boolean }) {
  const eye = (x: number, y: number, w: number, h: number) =>
    down ? (
      <>
        <rect x={x} y={y} width="1" height="1" fill="#1A1A22" />
        <rect x={x + w - 1} y={y} width="1" height="1" fill="#1A1A22" />
        <rect x={x + 1} y={y + 1} width={Math.max(1, w - 2)} height="1" fill="#1A1A22" />
        <rect x={x} y={y + 2} width="1" height="1" fill="#1A1A22" />
        <rect x={x + w - 1} y={y + 2} width="1" height="1" fill="#1A1A22" />
      </>
    ) : (
      <>
        <rect x={x} y={y} width={w} height={h} fill="#1A1A22" />
        <rect x={x} y={y} width="1" height="1" fill="#FFFFFF" />
      </>
    );
  if (boss === 'brainTitan') {
    return (
      <svg viewBox="0 0 12 12" shape-rendering="crispEdges" class="hud-boss__face-art">
        <rect x="1" y="3" width="10" height="7" fill="#9ACD8A" />
        <rect x="1" y="2" width="10" height="1" fill="#FFC83D" />
        <rect x="1" y="0" width="3" height="2" fill="#FF8FB1" />
        <rect x="4.5" y="0" width="3" height="2" fill="#FF8FB1" />
        <rect x="8" y="0" width="3" height="2" fill="#FF8FB1" />
        {eye(2, 4, 3, 3)}
        {eye(7, 5, 2, 2)}
        <rect x="0" y="8" width="12" height="4" fill="#6FA364" />
        <rect x="2" y="7" width="2" height="2" fill="#F4EBDD" />
        <rect x="8" y="7" width="2" height="2" fill="#F4EBDD" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 12 12" shape-rendering="crispEdges" class="hud-boss__face-art">
      <rect x="0" y="0" width="12" height="4" fill="#3E9A2E" />
      <rect x="1" y="0" width="10" height="2" fill="#58C13B" />
      <rect x="2" y="4" width="8" height="8" fill="#A8703A" />
      <rect x="3" y="5" width="6" height="6" fill="#C98F55" />
      <rect x="3" y="4" width="2" height="1" fill="#3E9A2E" />
      <rect x="7" y="4" width="2" height="1" fill="#3E9A2E" />
      {eye(3, 5, 2, 2)}
      {eye(7, 5, 2, 2)}
      <rect x="4" y="8" width="4" height="1" fill="#8BE05A" />
      <rect x="4" y="9" width="4" height="1" fill="#24140A" />
    </svg>
  );
}
