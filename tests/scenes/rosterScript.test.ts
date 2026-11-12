import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '../../src/data/units';
import { ROSTER_SCRIPT, rosterMatch, stepRoster } from '../../src/scenes/rosterScript';
import type { AbilityName, Command, ProjectileKind, StatusKind } from '../../src/sim/types';

const ABILITIES: AbilityName[] = ['arm', 'trigger', 'fuse', 'leap', 'ignite', 'grow', 'lasso', 'heal', 'raise'];
const STATUSES: StatusKind[] = ['stun', 'blind', 'tied', 'poison', 'burn'];
const SHOTS: ProjectileKind[] = ['pea', 'brain', 'kernel', 'butter', 'mango', 'sand', 'arrow', 'bullet', 'trident', 'rot'];

describe('the roster demo script', () => {
  it('plays each of the twenty cards once', () => {
    const played = ROSTER_SCRIPT.map((c) => c.unit).sort();
    expect(played).toEqual([...ALL_CARDS.plants, ...ALL_CARDS.zombies].sort());
  });

  it.each([1, 2, 3, 7, 42])('with seed %i shows every unit, ability, status, shot, miss, heal and a puddle within 60 s, and nothing is refused', (seed) => {
    const match = rosterMatch(seed);
    const seen = new Set<string>();
    const scratch: Command[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      for (const e of stepRoster(match, scratch)) {
        if (e.type === 'commandRejected') throw new Error(`refused: ${JSON.stringify(e)}`);
        if (e.type === 'unitSpawned') seen.add(`unit:${e.key}`);
        if (e.type === 'abilityUsed') seen.add(`ability:${e.ability}`);
        if (e.type === 'statusApplied') seen.add(`status:${e.status}`);
        if (e.type === 'projectileSpawned') seen.add(`shot:${e.kind}`);
        if (e.type === 'attackMissed' || e.type === 'unitHealed' || e.type === 'hazardSpawned') seen.add(e.type);
      }
    }
    const want = [
      ...[...ALL_CARDS.plants, ...ALL_CARDS.zombies, 'boneMinion'].map((k) => `unit:${k}`),
      ...ABILITIES.map((a) => `ability:${a}`),
      ...STATUSES.map((s) => `status:${s}`),
      ...SHOTS.map((k) => `shot:${k}`),
      'attackMissed', 'unitHealed', 'hazardSpawned',
    ];
    expect(want.filter((w) => !seen.has(w))).toEqual([]);
  });
});
