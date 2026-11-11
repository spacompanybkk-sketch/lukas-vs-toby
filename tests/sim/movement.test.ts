import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/data/balance';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { eventsOf } from './helpers';

/** Units are set with `spawnUnit`; the energy is only there so nothing waits for income. */
function fresh(): Match {
  const config = defaultConfig(1);
  config.startEnergy = { plants: 9999, zombies: 9999 };
  return new Match(config);
}

describe('zombie movement', () => {
  it('takes a Very Fast Walker alone to x <= 0.3 after 307 ± 1 steps, and never below 0.3', () => {
    const m = fresh();
    const z = spawnUnit(m.state, BALANCE, 'veryFastWalker', 2, 9.5);
    let arrivedOn: number | null = null;
    for (let n = 1; n <= 400; n++) {
      m.step();
      expect(z.x).toBeGreaterThanOrEqual(0.3);
      if (arrivedOn === null && z.x <= 0.3) arrivedOn = n;
    }
    expect(arrivedOn).not.toBeNull();
    expect(arrivedOn).toBeGreaterThanOrEqual(306);
    expect(arrivedOn).toBeLessThanOrEqual(308);
    expect(z.x).toBe(0.3);
    expect(z.blocked).toBe(true);
  });

  it('stops a zombie with 0 < zombie.x - plant.x <= 0.6 in front of a plant, and walks on the step after the plant dies', () => {
    const m = fresh();
    const plant = spawnUnit(m.state, BALANCE, 'sunflower', 1, 2.5); // no blast, so its death changes nothing else
    const z = spawnUnit(m.state, BALANCE, 'veryFastWalker', 1, 9.5);

    const xs: number[] = []; // zombie x after each step
    let diedOn: number | null = null;
    for (let n = 1; n <= 800 && diedOn === null; n++) {
      const events = m.step();
      xs.push(z.x);
      if (eventsOf(events, 'unitDied').some((e) => e.unitId === plant.id)) diedOn = n;
      if (diedOn === null && n === 300) {
        // Arrived long ago (about 214 steps), chewing since.
        expect(z.blocked).toBe(true);
        expect(z.x - plant.x).toBeGreaterThan(0);
        expect(z.x - plant.x).toBeLessThanOrEqual(0.6);
      }
    }
    if (diedOn === null) throw new Error('the Sunflower never died');

    const stoppedAt = xs[299];
    // Still standing through the step the plant died in.
    for (let n = 300; n <= diedOn; n++) expect(xs[n - 1]).toBe(stoppedAt);

    m.step(); // the step after the death
    expect(z.blocked).toBe(false);
    expect(z.x).toBeCloseTo((stoppedAt ?? 0) - 0.9 / 30, 12);
  });

  it('is not blocked by a plant behind it (larger x), even one within reach', () => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'walnutBomb', 1, 5.5);
    const z = spawnUnit(m.state, BALANCE, 'veryFastWalker', 1, 5.4);
    let last = z.x;
    for (let n = 0; n < 10; n++) {
      m.step();
      expect(z.blocked).toBe(false);
      expect(z.x).toBeCloseTo(last - 0.9 / 30, 12);
      last = z.x;
    }
  });

  it('leaves zombies in other lanes walking as if the plant were not there', () => {
    const m = fresh();
    spawnUnit(m.state, BALANCE, 'walnutBomb', 2, 2.5);
    const control = spawnUnit(m.state, BALANCE, 'veryFastWalker', 0, 9.5); // empty lane
    const above = spawnUnit(m.state, BALANCE, 'veryFastWalker', 1, 9.5);
    const blocked = spawnUnit(m.state, BALANCE, 'veryFastWalker', 2, 9.5);
    const below = spawnUnit(m.state, BALANCE, 'veryFastWalker', 3, 9.5);
    for (let n = 0; n < 330; n++) {
      m.step();
      expect(above.x).toBe(control.x);
      expect(below.x).toBe(control.x);
    }
    expect(above.x).toBe(0.3);
    expect(below.x).toBe(0.3);
    expect(blocked.x).toBeGreaterThan(2.5);
    expect(blocked.x).toBeLessThanOrEqual(3.1);
  });
});
