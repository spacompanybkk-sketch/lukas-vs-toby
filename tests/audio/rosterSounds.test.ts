import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import type { PlayOptions, SfxName } from '../../src/audio/AudioEngine';
import { SoundGate, actionSound, playEventSounds } from '../../src/audio/bindings';
import { BALANCE } from '../../src/data/balance';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { ProjectileKind, SimEvent, StatusKind } from '../../src/sim/types';
import { FakeAudioContext } from './fakeAudioContext';

// Wiring A: the phase-2 events to the phase-2 sounds, panned by x, rate-limited.

function recorder(): { audio: AudioEngine; calls: Array<[SfxName, PlayOptions | undefined]> } {
  const calls: Array<[SfxName, PlayOptions | undefined]> = [];
  const audio = { play: (name: SfxName, opts?: PlayOptions) => calls.push([name, opts]) };
  return { audio: audio as unknown as AudioEngine, calls };
}
const names = (calls: Array<[SfxName, unknown]>): SfxName[] => calls.map((c) => c[0]);

async function unlockedEngine(): Promise<{ engine: AudioEngine; fake: FakeAudioContext }> {
  const fake = new FakeAudioContext();
  const engine = new AudioEngine(() => fake as unknown as AudioContext);
  await engine.unlock();
  return { engine, fake };
}

function stateWith() {
  const match = new Match(defaultConfig(3));
  const pea = spawnUnit(match.state, BALANCE, 'peashooter', 1, 1.5);
  const zombie = spawnUnit(match.state, BALANCE, 'brainEater', 1, 8.5);
  return { state: match.state, pea, zombie };
}

const spawned = (kind: ProjectileKind, x: number): SimEvent => ({
  type: 'projectileSpawned', projectileId: 1, kind, faction: 'plants', lane: 0, x, ownerId: 1, flight: 'straight', targetX: null,
});

describe('playEventSounds for the full roster', () => {
  it('plays each projectile kind\'s own sound when it is fired, panned where it leaves', () => {
    const { audio, calls } = recorder();
    const kinds: ProjectileKind[] = ['pea', 'brain', 'kernel', 'butter', 'mango', 'sand', 'arrow', 'bullet', 'trident', 'rot'];
    playEventSounds(audio, kinds.map((k) => spawned(k, 10)), 'plants');
    expect(names(calls)).toEqual(['pea', 'brainThrow', 'kernel', 'butter', 'mango', 'sand', 'arrow', 'bullet', 'trident', 'rot']);
    for (const [, opts] of calls) expect(opts?.pan).toBeCloseTo(0.6);
  });

  it('plays a status as it starts, panned at the unit; a tie is heard as the lasso itself', () => {
    const { audio, calls } = recorder();
    const { state, pea, zombie } = stateWith();
    const status = (unitId: number, s: StatusKind): SimEvent => ({ type: 'statusApplied', unitId, status: s, ticks: 60, sourceId: null });
    playEventSounds(audio, [status(zombie.id, 'stun'), status(pea.id, 'blind'), status(pea.id, 'tied'), { type: 'statusEnded', unitId: pea.id, status: 'blind' }], 'plants', { state });
    expect(names(calls)).toEqual(['stun', 'blind']);
    expect(calls[0]?.[1]?.pan).toBeGreaterThan(0.3); // the zombie at x 8.5
    expect(calls[1]?.[1]?.pan).toBeLessThan(-0.3); // the Peashooter at x 1.5
  });

  it('maps the abilities, a miss, a heal and the two new booms', () => {
    const { audio, calls } = recorder();
    const { state, pea, zombie } = stateWith();
    const used = (ability: Extract<SimEvent, { type: 'abilityUsed' }>['ability']): SimEvent =>
      ({ type: 'abilityUsed', unitId: zombie.id, ability, lane: 1, x: 8.5, targetId: null });
    playEventSounds(audio, [
      used('arm'), used('trigger'), used('fuse'), used('leap'), used('grow'), used('lasso'), used('heal'), used('raise'),
      { type: 'attackMissed', unitId: pea.id },
      { type: 'unitHealed', unitId: zombie.id, amount: 40, hp: 200 },
      { type: 'explosion', lane: 1, x: 4, radius: 0.75, sourceKey: 'potatoMine' },
      { type: 'explosion', lane: 1, x: 4, radius: 1.6, sourceKey: 'cherryBomber' },
      { type: 'explosion', lane: 1, x: 4, radius: 1.5, sourceKey: 'walnutBomb' },
    ], 'plants', { state });
    // The mine's trigger is heard as its boom; a heal pulse as the healed units' sound.
    expect(names(calls)).toEqual([
      'mineArm', 'fuse', 'squash', 'grow', 'lasso', 'raise', 'miss', 'heal', 'mineBoom', 'cherryBoom', 'explode',
    ]);
    const miss = calls[6]?.[1]?.pan as number;
    expect(miss).toBeLessThan(-0.3);
  });

  it('plays a poison or burn sound at most once a second in total, from its start, its ticks and an ignite', () => {
    const { audio, calls } = recorder();
    const { state, pea, zombie } = stateWith();
    const gate = new SoundGate();
    zombie.poison = 90;
    pea.burn = 90;
    const dots = (): number => calls.filter((c) => c[0] === 'poison' || c[0] === 'burn').length;
    state.tick = 31;
    playEventSounds(audio, [
      { type: 'statusApplied', unitId: zombie.id, status: 'poison', ticks: 90, sourceId: null },
      { type: 'statusApplied', unitId: pea.id, status: 'burn', ticks: 90, sourceId: null },
      { type: 'abilityUsed', unitId: pea.id, ability: 'ignite', lane: 1, x: 1.5, targetId: null },
    ], 'plants', { state, gate });
    expect(dots()).toBe(1);
    // Every step for three seconds: the damage ticks on whole seconds are heard, once a second.
    for (let t = 32; t < 32 + 90; t++) {
      state.tick = t;
      playEventSounds(audio, [], 'plants', { state, gate });
    }
    // Heard at tick 31 (the start), not at the tick of tick 60 (under a second later), then at 90 and 120.
    expect(dots()).toBe(3);
    expect(calls.filter((c) => c[0] === 'poison' || c[0] === 'burn').every((c) => (c[1]?.volume ?? 1) <= 1)).toBe(true);
  });

  it('kernels fired faster than the ear can count never stack past the voice cap', async () => {
    const { engine, fake } = await unlockedEngine();
    const count = (): number => fake.sources().length;
    const base = count();
    playEventSounds(engine, [spawned('kernel', 2)], 'plants');
    const one = count() - base;
    expect(one).toBeGreaterThan(0);
    // Twenty in one step: heard once.
    playEventSounds(engine, Array.from({ length: 20 }, () => spawned('kernel', 2)), 'plants');
    expect(count() - base).toBe(one);
    // Twenty a second for two seconds: never more voices than the engine allows.
    let most = 0;
    for (let i = 0; i < 40; i++) {
      fake.advance(0.05);
      playEventSounds(engine, [spawned('kernel', 2), spawned('butter', 2), spawned('mango', 3)], 'plants');
      most = Math.max(most, engine.voiceCount);
    }
    expect(most).toBeLessThanOrEqual(24);
  });
});

describe('actionSound: what the Almanac plays with a unit\'s move, from the same event mapping', () => {
  /** What the battle plays for these events. */
  const heard = (events: SimEvent[]): SfxName[] => {
    const { audio, calls } = recorder();
    playEventSounds(audio, events, 'plants');
    return names(calls);
  };

  it('a shot sounds as its projectile does when fired', () => {
    for (const key of ['peashooter', 'kernelPult', 'mangoPult', 'brainEater', 'desertZombie', 'skeletonArcher', 'cowboyZombie', 'tridentZombie', 'brainRot'] as const) {
      const kind = BALANCE.units[key]?.shot?.kind as ProjectileKind;
      expect(actionSound(key, 'shoot'), key).toBe(heard([spawned(kind, 5)])[0]);
    }
  });

  it('a bite sounds as a melee attack does', () => {
    const bite: SimEvent = { type: 'unitAttacked', unitId: 1, attack: 'melee', targetId: 2, targetBase: null };
    for (const key of ['veryFastWalker', 'skeletonWarrior', 'hotTopic', 'boneMinion'] as const) {
      expect(actionSound(key, 'melee'), key).toBe(heard([bite])[0]);
    }
  });

  it('an ability sounds as its event does: the mine as its blast, the others as the ability itself', () => {
    const used = (ability: 'fuse' | 'leap' | 'lasso' | 'raise'): SimEvent => ({ type: 'abilityUsed', unitId: 1, ability, lane: 0, x: 5, targetId: null });
    expect(actionSound('potatoMine', 'ability')).toBe(heard([{ type: 'explosion', lane: 0, x: 5, radius: 1, sourceKey: 'potatoMine' }])[0]);
    expect(actionSound('cherryBomber', 'ability')).toBe(heard([used('fuse')])[0]);
    expect(actionSound('pumpkinSquash', 'ability')).toBe(heard([used('leap')])[0]);
    expect(actionSound('cowboyZombie', 'ability')).toBe(heard([used('lasso')])[0]);
    expect(actionSound('necromancer', 'ability')).toBe(heard([used('raise')])[0]);
  });

  it('no move, no sound', () => {
    expect(actionSound('sunflower', null)).toBeNull();
    expect(actionSound('peashooter', 'melee')).toBeNull(); // it has no bite
  });
});
