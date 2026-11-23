import { describe, expect, it } from 'vitest';
import { BattleController } from '../../src/app/BattleController';
import { seconds } from '../../src/data/balance';
import type { Faction } from '../../src/sim/types';

/**
 * Toby sends a Very Fast Walker, waits for its card to recharge, and taps the same card again to
 * send another. The card is still the selected one. On the zombie side the tray keeps it in hand
 * (CardTray: a tap on the selected card is a no-op), so the lane tap that follows sends. On the plant
 * side a second tap still puts the card down.
 */
describe('sending the same card twice by taps', () => {
  const make = (side: Faction): BattleController => {
    const c = new BattleController({
      playerFaction: side, skill: 'easy', seed: 5,
      cards: side === 'zombies' ? ['brainEater', 'veryFastWalker'] : ['peashooter', 'sunflower'],
    });
    c.match.state.players[side].energy = 900;
    return c;
  };
  /** The tray's own handling of a tap on `unit` (CardTray `click`): select it; a tap on the picked card deselects on the plant side only. */
  const tapCard = (c: BattleController, side: Faction, unit: 'veryFastWalker' | 'peashooter'): void => {
    const was = c.hud.selected.peek() === unit;
    if (was && side === 'zombies') return;
    c.select(unit);
    if (was) c.select(null);
  };

  it('zombies: card tap, lane tap, same card tap, lane tap sends twice; nothing is denied and energy is spent twice', () => {
    const c = make('zombies');
    const me = c.match.state.players.zombies;
    const denied = c.hud.denied.peek();
    tapCard(c, 'zombies', 'veryFastWalker');
    const e0 = me.energy;
    expect(c.click({ lane: 1, col: 9 }, null)).toBeNull();
    c.step();
    const e1 = me.energy;
    expect(e1).toBeLessThan(e0);
    expect(c.hud.selected.peek()).toBe('veryFastWalker'); // still picked after the send
    for (let i = 0; i < seconds(12); i++) c.step(); // the card is ready again
    expect(me.recharge.veryFastWalker ?? 0).toBe(0);
    const e2 = me.energy;
    tapCard(c, 'zombies', 'veryFastWalker'); // a child taps the card again, then a lane
    expect(c.hud.selected.peek()).toBe('veryFastWalker');
    expect(c.click({ lane: 3, col: 9 }, null)).toBeNull();
    c.step();
    expect(me.energy).toBeLessThan(e2); // second send spent energy
    expect(me.recharge.veryFastWalker ?? 0).toBeGreaterThan(0);
    expect(c.hud.denied.peek()).toBe(denied);
  });

  it('plants: a second tap on the picked card still puts it down, and the next tile tap is refused (old behaviour)', () => {
    const c = make('plants');
    c.select('peashooter');
    expect(c.hud.selected.peek()).toBe('peashooter');
    tapCard(c, 'plants', 'peashooter');
    expect(c.hud.selected.peek()).toBeNull();
    const denied = c.hud.denied.peek();
    expect(c.click({ lane: 2, col: 3 }, null)).toBe('not-in-hand');
    expect(c.hud.denied.peek()).toBe(denied + 1);
  });
});
