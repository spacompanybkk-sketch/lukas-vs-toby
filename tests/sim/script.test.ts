import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/data/balance';
import type { Balance } from '../../src/data/balance';
import { Match } from '../../src/sim/match';
import { ZOMBIE_SPAWN_X } from '../../src/sim/types';
import type { MatchConfig, PreparedUnit, ScriptEntry, SimEvent } from '../../src/sim/types';
import { classicBalance, classicConfig, eventsOf, place } from './helpers';

/** The numbers these rules tests were written for (see `classicBalance`), with the shipped Bone Minion (Grave Rise raises it): linear level curves. */
function withMinion(b: Balance): Balance {
  b.units.boneMinion = BALANCE.units.boneMinion;
  return b;
}
const B = withMinion(classicBalance());

/** A survive level of the classic setup with these prepared units and this script. */
function level(prepared: PreparedUnit[], script: ScriptEntry[], patch: Partial<MatchConfig> = {}): Match {
  const config: MatchConfig = {
    ...classicConfig(5, B), mode: 'survive', goalTicks: 9000, prepared, script, ...patch,
  };
  return new Match(config, B);
}

function types(events: readonly SimEvent[]): string[] {
  return events.map((e) => e.type);
}

describe('prepared units', () => {
  it('are on the lawn after the first step, in list order, at their level, before any command', () => {
    const m = level([
      { unit: 'peashooter', faction: 'plants', lane: 1, x: 2.5, level: 2 },
      { unit: 'brainEater', faction: 'zombies', lane: 3, x: 6, level: 3 },
    ], []);
    expect(m.state.units).toEqual([]); // nothing until the step of tick 0

    const events = m.step([place('plants', 'peashooter', 1, 2)]); // the tile is already taken

    expect(m.state.units.map((u) => [u.id, u.key, u.lane, u.x, u.level, u.hp, u.maxHp, u.spent])).toEqual([
      [1, 'peashooter', 1, 2.5, 2, 600, 600, 200],
      [2, 'brainEater', 3, 6 - 0.35 / 30, 3, 1200, 1200, 300], // it walked this step
    ]);
    expect(eventsOf(events, 'unitSpawned').map((e) => [e.unitId, e.key, e.lane, e.x])).toEqual([
      [1, 'peashooter', 1, 2.5], [2, 'brainEater', 3, 6],
    ]);
    expect(eventsOf(events, 'commandRejected').map((e) => e.reason)).toEqual(['occupied']);
    expect(eventsOf(events, 'waveSpawned')).toEqual([]); // prepared units are no wave
  });

  it('are spawned only once', () => {
    const m = level([{ unit: 'walnutBomb', faction: 'plants', lane: 0, x: 0.5, level: 1 }], []);
    for (let i = 0; i < 5; i++) m.step();
    expect(m.state.units).toHaveLength(1);
  });

  it('take their side\'s Marketplace level, as a placed card does', () => {
    const m = level([{ unit: 'peashooter', faction: 'plants', lane: 0, x: 0.5, level: 2 }], [], {
      upgrades: { plants: { peashooter: 4 }, zombies: {} },
    });
    m.step();
    expect(m.state.units[0]).toMatchObject({ level: 2, hp: 612, maxHp: 612 }); // 300 × 2 × (1 + 0.005 × 4)
  });

  it('spend nothing when they are no card (a rock, a Bone Minion)', () => {
    const m = level([
      { unit: 'rock', faction: 'plants', lane: 4, x: 7.5, level: 1 },
      { unit: 'boneMinion', faction: 'zombies', lane: 4, x: 9, level: 2 },
    ], []);
    m.step();
    expect(m.state.units.map((u) => [u.key, u.level, u.spent, u.expires])).toEqual([
      ['rock', 1, 0, 0], ['boneMinion', 2, 0, 0],
    ]);
  });

  it('pay a bounty like any unit: the share of price × level', () => {
    const m = level([{ unit: 'brainEater', faction: 'zombies', lane: 2, x: 8, level: 2 }], []);
    m.step();
    const plantsBefore = m.state.players.plants.energy;
    m.state.units[0]!.hp = 0;
    const events = m.step();
    expect(eventsOf(events, 'energyGained').filter((e) => e.source === 'bounty').map((e) => e.amount)).toEqual([40]); // ⌊0.2 × 200⌋
    expect(m.state.players.plants.energy).toBe(plantsBefore + 40 + 0); // trickle 1.8/s pays nothing in 2 ticks
  });
});

describe('the script', () => {
  const waves: ScriptEntry[] = [
    { tick: 0, unit: 'brainEater', faction: 'zombies', lane: 0, level: 1 },
    { tick: 3, unit: 'veryFastWalker', faction: 'zombies', lane: 1, x: 7, level: 2 },
    { tick: 3, unit: 'skeletonWarrior', faction: 'zombies', lane: 2, level: 1 },
    { tick: 5, unit: 'peashooter', faction: 'plants', lane: 4, x: 3.5, level: 1 },
  ];

  it('brings each entry on at its tick, in order, as the first thing of that step', () => {
    const m = level([], waves);
    const byTick: SimEvent[][] = [];
    for (let i = 0; i < 6; i++) byTick.push(m.step());

    expect(types(byTick[0]!).slice(0, 2)).toEqual(['waveSpawned', 'unitSpawned']);
    expect(eventsOf(byTick[0]!, 'waveSpawned')).toEqual([{ type: 'waveSpawned', index: 0, unit: 'brainEater', lane: 0 }]);
    expect(eventsOf(byTick[1]!, 'waveSpawned')).toEqual([]);
    expect(eventsOf(byTick[3]!, 'waveSpawned').map((e) => e.index)).toEqual([1, 2]);
    expect(eventsOf(byTick[3]!, 'unitSpawned').map((e) => [e.key, e.x])).toEqual([
      ['veryFastWalker', 7], ['skeletonWarrior', ZOMBIE_SPAWN_X],
    ]);
    expect(eventsOf(byTick[5]!, 'unitSpawned').map((e) => [e.key, e.lane, e.x])).toEqual([['peashooter', 4, 3.5]]);
    expect(m.state.scriptIndex).toBe(4);
  });

  it('gives a scripted unit its level and spent = price × level', () => {
    const m = level([], waves);
    for (let i = 0; i < 4; i++) m.step();
    const walker = m.state.units.find((u) => u.key === 'veryFastWalker');
    expect(walker).toMatchObject({ level: 2, hp: 360, maxHp: 360, spent: 100 });
  });

  it('counts scriptIndex up one entry at a time', () => {
    const m = level([], waves);
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) {
      m.step();
      seen.push(m.state.scriptIndex);
    }
    expect(seen).toEqual([1, 1, 1, 3, 3, 4, 4]);
  });

  it('skips a scripted plant whose tile is taken, says so, and goes on', () => {
    const m = level([{ unit: 'walnutBomb', faction: 'plants', lane: 4, x: 3.5, level: 1 }], [
      { tick: 1, unit: 'peashooter', faction: 'plants', lane: 4, x: 3.5, level: 1 },
      { tick: 1, unit: 'brainEater', faction: 'zombies', lane: 4, level: 1 },
    ]);
    m.step();
    const events = m.step();
    expect(eventsOf(events, 'waveSkipped')).toEqual([
      { type: 'waveSkipped', index: 0, unit: 'peashooter', lane: 4, reason: 'occupied' },
    ]);
    expect(eventsOf(events, 'waveSpawned').map((e) => e.index)).toEqual([1]);
    expect(m.state.units.map((u) => u.key)).toEqual(['walnutBomb', 'brainEater']);
    expect(m.state.scriptIndex).toBe(2);
  });

  it('runs in battle mode too (a scripted battle)', () => {
    const m = new Match({ ...classicConfig(5, B), script: [waves[0]!] }, B);
    expect(eventsOf(m.step(), 'waveSpawned')).toHaveLength(1);
  });

  it('stops when the match is over', () => {
    const m = level([], [{ tick: 2, unit: 'brainEater', faction: 'zombies', lane: 0, level: 1 }], { goalTicks: 2 });
    m.step();
    m.step();
    expect(m.state.winner).toBe('plants');
    expect(m.step()).toEqual([]);
    expect(m.state.scriptIndex).toBe(0);
  });
});

describe('checking prepared units and the script', () => {
  const ok: PreparedUnit = { unit: 'peashooter', faction: 'plants', lane: 0, x: 0.5, level: 1 };
  const wave: ScriptEntry = { tick: 0, unit: 'brainEater', faction: 'zombies', lane: 0, level: 1 };
  const cases: Array<[string, Partial<MatchConfig>, string]> = [
    ['an unsorted script', { script: [{ ...wave, tick: 5 }, { ...wave, tick: 4 }] }, 'sorted'],
    ['a script tick that is not whole', { script: [{ ...wave, tick: 1.5 }] }, 'tick'],
    ['a negative script tick', { script: [{ ...wave, tick: -1 }] }, 'tick'],
    ['an unknown unit', { prepared: [{ ...ok, unit: 'dragon' as never }] }, 'dragon'],
    ['a unit the balance table has no numbers for', { script: [{ ...wave, unit: 'necromancer', faction: 'zombies' }] }, 'necromancer'],
    ['a unit on the wrong side', { prepared: [{ ...ok, faction: 'zombies' }] }, 'side'],
    ['lane 5', { prepared: [{ ...ok, lane: 5 }] }, 'lane'],
    ['lane -1', { script: [{ ...wave, lane: -1 }] }, 'lane'],
    ['level 0', { prepared: [{ ...ok, level: 0 }] }, 'level'],
    ['level 6', { script: [{ ...wave, level: 6 }] }, 'level'],
    ['a plant off a tile middle', { prepared: [{ ...ok, x: 1 }] }, 'tile'],
    ['a plant beyond the plant columns', { prepared: [{ ...ok, x: 8.5 }] }, 'tile'],
    ['a scripted plant with no x', { script: [{ ...wave, unit: 'peashooter', faction: 'plants' }] }, 'tile'],
    ['two prepared plants on one tile', { prepared: [ok, { ...ok, unit: 'walnutBomb' }] }, 'tile'],
    ['a zombie off the lawn', { prepared: [{ ...ok, unit: 'brainEater', faction: 'zombies', x: 10 }] }, 'x'],
    ['a zombie x that is no number', { script: [{ ...wave, x: Number.NaN }] }, 'x'],
  ];
  it.each(cases)('refuses %s', (_name, patch, message) => {
    expect(() => new Match({ ...classicConfig(1, B), mode: 'survive', goalTicks: 100, ...patch }, B)).toThrow(message);
  });

  it('accepts a plant and a zombie on the same tile, and two zombies at one x', () => {
    expect(() => level([
      ok, { unit: 'brainEater', faction: 'zombies', lane: 0, x: 0.5, level: 1 },
      { unit: 'brainEater', faction: 'zombies', lane: 0, x: 0.5, level: 1 },
    ], [])).not.toThrow();
  });
});
