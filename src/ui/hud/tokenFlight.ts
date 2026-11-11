import type { Faction } from '../../sim/types';

/** How long a token takes to reach the counter, and how many visible steps it moves in. */
export const TOKEN_FLIGHT_MS = 520;
const FLIGHT_STEPS = 10;
/** At most this many tokens in the air; more would only clutter the top of the screen. */
const MAX_IN_FLIGHT = 6;

let inFlight = 0;

/**
 * Flies a pixel sun (or brain) from a point on the lawn to the energy counter, then bumps the
 * counter. Pure DOM and the Web Animations API, stepped so it moves like the rest of the HUD.
 * Does nothing without a target, or when `animate` is missing (old browsers, tests).
 */
export function flyToken(
  layer: HTMLElement,
  from: { x: number; y: number },
  to: HTMLElement | null,
  side: Faction,
): void {
  if (to === null || inFlight >= MAX_IN_FLIGHT) return;
  const end = to.getBoundingClientRect();
  const token = document.createElement('span');
  token.className = `hud-token ico ico--${side === 'plants' ? 'sun' : 'brain'}`;
  token.setAttribute('aria-hidden', 'true');
  token.style.left = `${from.x}px`;
  token.style.top = `${from.y}px`;
  if (typeof token.animate !== 'function') return;
  layer.appendChild(token);
  inFlight++;
  // Aim at the counter's icon, near its left end.
  const dx = end.left + end.height * 0.5 - from.x;
  const dy = end.top + end.height * 0.5 - from.y;
  const flight = token.animate(
    [
      { transform: 'translate(-50%, -50%) scale(1)' },
      { transform: `translate(calc(-50% + ${dx * 0.35}px), calc(-50% + ${dy * 0.15 - 40}px)) scale(1.25)`, offset: 0.3 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.7)` },
    ],
    { duration: TOKEN_FLIGHT_MS, easing: `steps(${FLIGHT_STEPS}, end)`, fill: 'forwards' },
  );
  const done = (): void => {
    token.remove();
    inFlight = Math.max(0, inFlight - 1);
  };
  flight.onfinish = () => {
    done();
    to.animate?.(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
      { duration: 240, easing: 'steps(3, end)' },
    );
  };
  flight.oncancel = done;
}
