import './hud.css';

export interface TopBarProps { seconds: number; suddenDeath: boolean }

/** `m:ss`, e.g. 75 → "1:15". Negative or fractional input is floored at 0. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The match clock at the top centre, with a SUDDEN DEATH banner beneath it when active. */
export function TopBar({ seconds, suddenDeath }: TopBarProps) {
  return (
    <div data-hud="topbar" class={`hud-top${suddenDeath ? ' is-sudden' : ''}`}>
      <span class="hud-top__clock px pal-stone" role="timer" aria-label={`Time ${formatClock(seconds)}`}>
        <span class="hud-top__face" aria-hidden="true" />
        <span class="hud-top__time inked">{formatClock(seconds)}</span>
      </span>
      {suddenDeath && <span class="hud-top__sudden px pal-red inked">SUDDEN DEATH</span>}
    </div>
  );
}
