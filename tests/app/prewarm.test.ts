import { describe, expect, it } from 'vitest';
import { modelsFor } from '../../src/app/prewarm';
import { Match, defaultConfig } from '../../src/sim/match';

describe('modelsFor', () => {
  it("builds the Bone Minion ahead when Grave Rise is dealt even with no Necromancer (the title demo's three cards)", () => {
    const match = new Match(defaultConfig(3));
    match.state.players.zombies.spells = [{ key: 'graveRise', timer: 600 }, { key: 'fog', timer: 600 }];
    expect(match.state.config.cards.zombies).not.toContain('necromancer');
    expect(modelsFor(match.state)).toContain('boneMinion');
    match.state.players.zombies.spells = [{ key: 'meteor', timer: 600 }, { key: 'fog', timer: 600 }];
    expect(modelsFor(match.state)).not.toContain('boneMinion');
    expect(modelsFor(match.state)).toEqual([...match.state.config.cards.plants, ...match.state.config.cards.zombies]);
  });

  it("and when a Necromancer is in the zombies' hand", () => {
    const match = new Match(defaultConfig(3));
    match.state.config.cards.zombies = [...match.state.config.cards.zombies, 'necromancer'];
    match.state.players.zombies.spells = [];
    expect(modelsFor(match.state)).toContain('boneMinion');
  });
});
