import { describe, expect, it } from 'vitest';
import { BALANCE, cloneBalance } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import type { UnitKey } from '../../src/sim/types';
import { classicBalance } from './helpers';

/**
 * The seven phase-2 zombies and the Bone Minion (phase 2, Task 3), with their starting numbers
 * from `BALANCE` on top of the classic table (see `classicBalance`), so the plants they meet keep
 * the numbers the rules tests were written for. Every level curve there is linear.
 */

const NEW_UNITS: readonly UnitKey[] = [
  'desertZombie', 'skeletonArcher', 'hotTopic', 'cowboyZombie', 'necromancer', 'tridentZombie', 'brainRot', 'boneMinion',
  'potatoMine', 'kernelPult', 'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber', 'pumpkinSquash',
];

function table(): Balance {
  const b = classicBalance();
  const shipped = cloneBalance(BALANCE);
  for (const key of NEW_UNITS) b.units[key] = shipped.units[key];
  return b;
}

describe('the shipped starting numbers', () => {
  it('are the table of the phase-2 plan', () => {
    const u = BALANCE.units;
    const melee = (damage: number, interval: number) => ({ damage, interval, reach: 0.6 });
    expect(u.desertZombie).toEqual({
      recharge: 6, hp: 380, armor: 0, speed: 0.35, melee: melee(30, 1),
      shot: { kind: 'sand', damage: 10, interval: 2.5, range: 4, speed: 5, status: { kind: 'blind', seconds: 3 } },
    });
    expect(u.skeletonArcher).toEqual({
      recharge: 6, hp: 220, armor: 0, speed: 0.4, melee: melee(15, 1),
      shot: { kind: 'arrow', damage: 28, interval: 1.6, range: 6, speed: 8 }, holds: true,
    });
    expect(u.hotTopic).toEqual({
      recharge: 6, hp: 300, armor: 0, speed: 0.5, melee: melee(25, 0.5),
      grow: { hpShare: 0.2, damageShare: 0.2, maxStacks: 5 },
    });
    expect(u.cowboyZombie).toEqual({
      recharge: 10, hp: 450, armor: 0, speed: 0.35, melee: melee(30, 1),
      shot: { kind: 'bullet', damage: 22, interval: 1.5, range: 4.5, speed: 10 },
      lasso: { interval: 9, range: 5, seconds: 3 },
    });
    expect(u.necromancer).toEqual({
      recharge: 15, hp: 400, armor: 0, speed: 0.3, melee: melee(15, 1.2), holds: true, holdRange: 4,
      healAura: { amount: 40, interval: 2, radius: 1.5 }, raise: { key: 'boneMinion', interval: 10 },
    });
    expect(u.tridentZombie).toEqual({
      recharge: 12, hp: 500, armor: 0, speed: 0.2, melee: melee(40, 1.2),
      shot: { kind: 'trident', damage: 70, interval: 3.5, range: 10, speed: 6, flight: 'piercing', pierce: 3 },
    });
    expect(u.brainRot).toEqual({
      recharge: 15, hp: 450, armor: 0, speed: 0.25, melee: melee(20, 1.2), holds: true,
      shot: {
        kind: 'rot', damage: 30, interval: 4, range: 6, speed: 4, flight: 'lobbed',
        puddle: { seconds: 4, radius: 0.75, dps: 15 },
      },
    });
    expect(u.boneMinion).toEqual({ recharge: 1, hp: 150, armor: 0, speed: 0.6, melee: melee(20, 0.8) });
    expect(BALANCE.minionCap).toBe(3);
  });
});
