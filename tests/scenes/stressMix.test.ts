import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '../../src/data/units';
import { MIX_PROJECTILES, MIX_PUDDLES, mixMatch, stepMix } from '../../src/scenes/stressMix';
import type { ProjectileKind, SimEvent, StatusKind } from '../../src/sim/types';

const SHOTS: ProjectileKind[] = ['pea', 'brain', 'kernel', 'butter', 'mango', 'sand', 'arrow', 'bullet', 'trident', 'rot'];
const STATUSES: StatusKind[] = ['stun', 'blind', 'tied', 'poison', 'burn', 'haste'];

describe('the mixed stress scene (?scene=stress&mix)', () => {
  it('keeps the whole roster, every shot kind, puddles, statuses, rocks and the powers going for a minute', () => {
    const mix = mixMatch(150);
    const s = mix.match.state;
    const events: SimEvent[] = [];
    const casts = new Set<string>();
    const heroes = new Set<string>();
    let rejected = 0;
    // After a second of settling, every step is checked.
    for (let i = 0; i < 60 * 30; i++) {
      events.length = 0;
      stepMix(mix, events);
      for (const e of events) {
        if (e.type === 'spellCast') casts.add(e.spell);
        if (e.type === 'heroUsed') heroes.add(e.faction);
        if (e.type === 'commandRejected') rejected++;
      }
      if (i < 30) continue;
      const fighters = s.units.filter((u) => u.key !== 'rock');
      expect(fighters.length, `units at step ${i}`).toBeGreaterThanOrEqual(150);
      expect(s.units.filter((u) => u.key === 'rock').length, 'rocks').toBeGreaterThanOrEqual(2);
      expect(s.projectiles.length, 'projectiles').toBeGreaterThanOrEqual(MIX_PROJECTILES);
      expect(s.hazards.length, 'puddles').toBe(MIX_PUDDLES);
      const statused = fighters.filter((u) => STATUSES.some((k) => u[k] > 0)).length;
      expect(statused, 'a third with a status').toBeGreaterThanOrEqual(Math.floor(fighters.length / 3));
      if (i % 30 === 0) {
        const kinds = new Set(fighters.map((u) => u.key));
        expect([...kinds].sort(), 'all 21 kinds').toEqual([...ALL_CARDS.plants, ...ALL_CARDS.zombies, 'boneMinion'].sort());
        expect(new Set(fighters.map((u) => u.level)).size, 'mixed levels').toBeGreaterThan(3);
        const shots = new Set(s.projectiles.map((p) => p.kind));
        expect([...shots].sort(), 'every shot kind in the air').toEqual([...SHOTS].sort());
        expect(s.projectiles.some((p) => p.flight === 'lobbed' && p.targetId !== null), 'a lobbed shot').toBe(true);
        expect(s.projectiles.some((p) => p.burning), 'a burning shot').toBe(true);
        for (const k of STATUSES) expect(fighters.some((u) => u[k] > 0), k).toBe(true);
      }
    }
    expect([...casts].sort(), 'all ten spells cast').toEqual(
      ['thunderbolt', 'vines', 'sunShower', 'healingRain', 'rockWall', 'meteor', 'fog', 'brainFeast', 'frenzy', 'graveRise'].sort(),
    );
    expect([...heroes].sort()).toEqual(['plants', 'zombies']);
    expect(rejected).toBe(0);
    expect(s.winner).toBeNull();
  });

  it('casts a spell every second and a hero power every two, so a show is always on during a measurement', () => {
    const mix = mixMatch(60);
    const events: SimEvent[] = [];
    const spellTicks: number[] = [];
    const heroTicks: number[] = [];
    for (let i = 0; i < 10 * 30; i++) {
      events.length = 0;
      stepMix(mix, events);
      for (const e of events) {
        if (e.type === 'spellCast') spellTicks.push(mix.match.state.tick);
        if (e.type === 'heroUsed') heroTicks.push(mix.match.state.tick);
      }
    }
    expect(spellTicks.length).toBeGreaterThanOrEqual(9);
    expect(heroTicks.length).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic', () => {
    const run = (): string => {
      const mix = mixMatch(90);
      for (let i = 0; i < 300; i++) stepMix(mix, []);
      const s = mix.match.state;
      return JSON.stringify([s.units.map((u) => [u.key, u.level, u.lane, u.x]), s.projectiles.length, s.hazards.length]);
    };
    expect(run()).toBe(run());
  });
});
