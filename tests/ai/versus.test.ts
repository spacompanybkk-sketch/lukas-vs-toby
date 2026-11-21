import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEAD_STEP, HEAD_START_PER_STEP, PLACEHOLDER_HEAD_STEP, defaultHeadStart, rematchSetup, seatOf, versusConfig,
} from '../../src/ai/versus';
import type { VersusSetup } from '../../src/ai/versus';
import { BALANCE } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { NO_TWIST } from '../../src/sim/lawn';
import { Match } from '../../src/sim/match';

const SETUP: VersusSetup = { seed: 7, seats: { plants: 'p01', zombies: 'p02' }, head: { slot: 'p02', step: 3 } };

describe('versusConfig', () => {
  it('plays the Versus rules with the head start on the head slot\'s side', () => {
    const c = versusConfig(SETUP);
    expect(c.seed).toBe(7);
    expect(c.startEnergy).toEqual({ plants: 190, zombies: 340 });
    expect(c.incomeMultiplier.plants).toBe(1);
    expect(c.incomeMultiplier.zombies).toBe(1.3);
    expect(c.cards).toEqual({ plants: ALL_CARDS.plants, zombies: ALL_CARDS.zombies });
    expect(c.upgrades).toEqual({ plants: {}, zombies: {} });
    expect(c.lawn).toEqual(NO_TWIST);
    expect(c.mode).toBe('battle');
    expect(c.suddenDeath).toBe(true);
    expect(c.heroes).toEqual({ plants: true, zombies: true });
    expect(c.spells).toEqual({ plants: 2, zombies: 2 });
    expect(c.baseHp).toEqual({ plants: BALANCE.baseHp, zombies: BALANCE.baseHp });
  });

  it('gives the head start to the side its boy sits on', () => {
    const c = versusConfig({ ...SETUP, seats: { plants: 'p02', zombies: 'p01' } });
    expect(c.startEnergy).toEqual({ plants: 340, zombies: 190 });
    expect(c.incomeMultiplier).toEqual({ plants: 1.3, zombies: 1 });
  });

  it('scales by step: 50 energy and a tenth more trickle each', () => {
    expect(HEAD_START_PER_STEP).toEqual({ energy: 50, income: 0.1 });
    const c = versusConfig({ ...SETUP, head: { slot: 'p02', step: 5 } });
    expect(c.startEnergy.zombies).toBe(190 + 250);
    expect(c.incomeMultiplier.zombies).toBe(1.5);
  });

  it('step 0 is the same as no head start', () => {
    expect(versusConfig({ ...SETUP, head: { slot: 'p02', step: 0 } })).toEqual(versusConfig({ ...SETUP, head: null }));
  });

  it('testBaseHp sets both bases, whole 1..500 only', () => {
    expect(versusConfig({ ...SETUP, testBaseHp: 40 }).baseHp).toEqual({ plants: 40, zombies: 40 });
    expect(versusConfig({ ...SETUP, testBaseHp: 1 }).baseHp).toEqual({ plants: 1, zombies: 1 });
    expect(versusConfig({ ...SETUP, testBaseHp: 500 }).baseHp).toEqual({ plants: 500, zombies: 500 });
    expect(() => versusConfig({ ...SETUP, testBaseHp: 0 })).toThrow(RangeError);
    expect(() => versusConfig({ ...SETUP, testBaseHp: 501 })).toThrow(RangeError);
    expect(() => versusConfig({ ...SETUP, testBaseHp: 40.5 })).toThrow(RangeError);
  });

  it('refuses a head slot not seated and two equal seats', () => {
    expect(() => versusConfig({ ...SETUP, head: { slot: 'p05', step: 3 } })).toThrow(RangeError);
    expect(() => versusConfig({ ...SETUP, seats: { plants: 'p02', zombies: 'p02' } })).toThrow(RangeError);
  });

  it('refuses a seed that is not a uint32 and a step outside 0..5', () => {
    expect(() => versusConfig({ ...SETUP, seed: -1 })).toThrow(RangeError);
    expect(() => versusConfig({ ...SETUP, seed: 2 ** 32 })).toThrow(RangeError);
    expect(() => versusConfig({ ...SETUP, head: { slot: 'p02', step: 6 as 5 } })).toThrow(RangeError);
  });

  it('is deterministic: two matches from one setup agree after 300 idle ticks', () => {
    const a = new Match(versusConfig(SETUP));
    const b = new Match(versusConfig(SETUP));
    for (let t = 0; t < 300; t++) { a.step(); b.step(); }
    expect(a.hash()).toBe(b.hash());
  });

  it('does not share arrays with ALL_CARDS', () => {
    const c = versusConfig(SETUP);
    expect(c.cards.plants).not.toBe(ALL_CARDS.plants);
    expect(c.cards.zombies).not.toBe(ALL_CARDS.zombies);
  });
});

describe('seats and head start', () => {
  it('seatOf finds the side of a seated slot and throws for anyone else', () => {
    expect(seatOf(SETUP, 'p01')).toBe('plants');
    expect(seatOf(SETUP, 'p02')).toBe('zombies');
    expect(() => seatOf(SETUP, 'p05')).toThrow();
  });

  it('defaultHeadStart goes to p02 when he is seated, nobody otherwise', () => {
    expect(PLACEHOLDER_HEAD_STEP).toBe(3);
    expect(defaultHeadStart({ plants: 'p01', zombies: 'p02' })).toEqual({ slot: 'p02', step: DEFAULT_HEAD_STEP.zombies });
    expect(defaultHeadStart({ plants: 'p02', zombies: 'p05' })).toEqual({ slot: 'p02', step: DEFAULT_HEAD_STEP.plants });
    expect(defaultHeadStart({ plants: 'p01', zombies: 'p05' })).toBeNull();
  });

  it('rematchSetup swaps seats, takes the new seed and keeps the head start with its boy', () => {
    const s: VersusSetup = { ...SETUP, testBaseHp: 40 };
    const r = rematchSetup(s, 99);
    expect(r).toEqual({ seed: 99, seats: { plants: 'p02', zombies: 'p01' }, head: { slot: 'p02', step: 3 }, testBaseHp: 40 });
    expect(versusConfig(r).startEnergy).toEqual({ plants: 340, zombies: 190 });
    expect(rematchSetup({ ...SETUP, head: null }, 5).head).toBeNull();
  });
});
