import { describe, expect, it } from 'vitest';
import { BALANCE, seconds } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { Match, spawnUnit } from '../../src/sim/match';
import { damageUnit } from '../../src/sim/damage';
import type { Unit } from '../../src/sim/types';
import { classicBalance, classicConfig, eventsOf } from './helpers';

/**
 * A Sunflower under attack makes no Sun (owner rule, phase 2): any damage sets its `hurt` to
 * `seconds(sun.pauseSeconds)`; while hurt its Sun timer stands still and it pays nothing, and then
 * it carries on from where it stopped. On the classic numbers (Sun 25 every 10 s) with a pause.
 */
function table(pauseSeconds = 2): Balance {
  const b = classicBalance();
  b.units.sunflower!.sun = { amount: 25, interval: 10, pauseSeconds };
  return b;
}

function fresh(b: Balance = table()): Match {
  const config = classicConfig(1, b);
  config.incomeMultiplier = { plants: 0, zombies: 0 };
  config.baseHp = { plants: 1_000_000, zombies: 1_000_000 };
  config.suddenDeath = false;
  return new Match(config, b);
}

/** A Sunflower that cannot fall. */
function sunflower(m: Match): Unit {
  const u = spawnUnit(m.state, m.balance, 'sunflower', 2, 2.5);
  u.hp = u.maxHp = 1_000_000;
  return u;
}

/** The steps (numbered from 1) on which a Sunflower paid. */
function payouts(m: Match, steps: number, each?: (n: number) => void): number[] {
  const out: number[] = [];
  for (let n = 1; n <= steps; n++) {
    each?.(n);
    if (eventsOf(m.step(), 'energyGained').some((e) => e.source === 'sunflower')) out.push(n);
  }
  return out;
}

describe('a Sunflower under attack', () => {
  it('ships a pause of 2 s, and the classic helper pins 0', () => {
    expect(BALANCE.units.sunflower?.sun?.pauseSeconds).toBe(2);
    expect(classicBalance().units.sunflower?.sun?.pauseSeconds).toBe(0);
  });

  it('a healthy Sunflower pays every 10 s as before', () => {
    const m = fresh();
    sunflower(m);
    expect(payouts(m, seconds(30))).toEqual([300, 600, 900]);
  });

  it('bitten every second, it makes no Sun at all over 30 s', () => {
    const m = fresh();
    const s = sunflower(m);
    const z = spawnUnit(m.state, m.balance, 'brainEater', 2, 2.9); // classic bite every 1 s
    expect(payouts(m, seconds(30))).toEqual([]);
    expect(s.hp).toBe(1_000_000 - 30 * 40); // it was bitten each second
    expect(z.hp).toBe(400);
  });

  it('a single hit delays the next payout by exactly the pause; the timer then carries on', () => {
    const m = fresh();
    const s = sunflower(m);
    const paid = payouts(m, seconds(25), (n) => {
      if (n === 101) damageUnit(m.state, m.balance, s, 5, []); // hit before step 101
    });
    // Hit at the start of step 101: frozen on steps 101..160, so 300 → 360; then every 300 again.
    expect(paid).toEqual([360, 660]);
  });

  it('any damage counts: poison too', () => {
    const m = fresh();
    const s = sunflower(m);
    s.poison = seconds(30); s.poisonDps = 1;
    expect(payouts(m, seconds(30))).toEqual([]);
  });

  it('a stunned Sunflower still counts its hurt down', () => {
    const m = fresh();
    const s = sunflower(m);
    damageUnit(m.state, m.balance, s, 5, []);
    s.stun = 30;
    m.step();
    expect(s.hurt).toBe(seconds(2) - 1);
  });

  it('pauseSeconds 0 is the old behaviour: bitten every second, it still pays every 10 s', () => {
    const m = fresh(table(0));
    sunflower(m);
    spawnUnit(m.state, m.balance, 'brainEater', 2, 2.9);
    expect(payouts(m, seconds(30))).toEqual([300, 600, 900]);
  });

  it('only a Sun maker is ever hurt', () => {
    const m = fresh();
    const p = spawnUnit(m.state, m.balance, 'peashooter', 1, 1.5);
    damageUnit(m.state, m.balance, p, 5, []);
    expect(p.hurt).toBe(0);
  });
});
