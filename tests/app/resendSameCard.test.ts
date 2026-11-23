import { describe, expect, it } from 'vitest';
import { BattleController } from '../../src/app/BattleController';
import { seconds } from '../../src/data/balance';

/**
 * Toby sends a Very Fast Walker, waits for its card to recharge, and taps the same card again to
 * send another. The card is still the selected one, so the tray reads that tap as "put it down"
 * (CardTray: a second tap on the selected card deselects) and the lane tap that follows finds no
 * card in hand: a refusal and a buzz for a send that was a good one.
 */
describe('sending the same zombie card twice by taps', () => {
  const make = (): BattleController => {
    const c = new BattleController({ playerFaction: 'zombies', skill: 'easy', seed: 5, cards: ['brainEater', 'veryFastWalker'] });
    c.match.state.players.zombies.energy = 900;
    return c;
  };
  /** The tray's own handling of a tap on `unit` (CardTray `click`): select it, and deselect when it was already picked. */
  const tapCard = (c: BattleController, unit: 'veryFastWalker'): void => {
    const was = c.hud.selected.peek() === unit;
    c.select(unit);
    if (was) c.select(null);
  };

  /** Characterises the cause of the Desert walk's "refused" sends (see .superpowers/sdd/2026-11-22-worlds3-desert/refused-sends-report.md). */
  it('a second tap on the still-picked card puts it down: the next lane tap is refused (not-in-hand), and costs nothing', () => {
    const c = make();
    tapCard(c, 'veryFastWalker');
    expect(c.click({ lane: 1, col: 9 }, null)).toBeNull();
    c.step();
    expect(c.hud.selected.peek()).toBe('veryFastWalker'); // still picked after the send
    for (let i = 0; i < seconds(12); i++) c.step(); // the card is ready again
    expect(c.match.state.players.zombies.recharge.veryFastWalker ?? 0).toBe(0);
    const denied = c.hud.denied.peek();
    const before = c.match.state.players.zombies.energy;
    tapCard(c, 'veryFastWalker'); // a child taps the card again, then a lane
    expect(c.hud.selected.peek()).toBeNull();
    expect(c.click({ lane: 3, col: 9 }, null)).toBe('not-in-hand');
    expect(c.hud.denied.peek()).toBe(denied + 1);
    c.step();
    expect(c.match.state.players.zombies.energy).toBeGreaterThanOrEqual(before); // no zombie was sent, no energy spent
  });
});
