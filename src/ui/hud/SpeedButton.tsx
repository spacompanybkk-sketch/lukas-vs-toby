import './hud.css';

export interface SpeedButtonProps {
  /** Lit: the battle runs at double speed. */
  fast: boolean;
  onToggle(): void;
}

/**
 * The 2X button beside Pause: the same small square stone button, a pixel double arrow with the
 * word 2X under it. A tap toggles normal and double speed; lit (the buttons' pressed look: lighter
 * fill and a sun outline) while double speed is on.
 */
export function SpeedButton({ fast, onToggle }: SpeedButtonProps) {
  return (
    <button
      type="button" data-hud="speed" class="btn btn--square btn--small pal-stone hud-speed"
      aria-label="Double speed" aria-pressed={fast} onClick={onToggle}
    >
      <span class="ico ico--fast" aria-hidden="true" />
      <span class="hud-speed__word inked" aria-hidden="true">2X</span>
    </button>
  );
}
