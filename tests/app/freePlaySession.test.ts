import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FREE_PLAY, freePlayConfig } from '../../src/adventure/freePlay';
import { BattleController, RING_STEPS } from '../../src/app/BattleController';
import {
  applyPending, freePlayOptions, freePlayRecord, pendingKey, prepareFreePlay, readPending, settleFreePlay,
} from '../../src/app/levelSession';
import { PlayerSession } from '../../src/app/session';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import { BALANCE, seconds } from '../../src/data/balance';
import type { Save } from '../../src/progress/save';
import type { Faction } from '../../src/sim/types';
import { MemoryStorage } from '../progress/memoryStorage';

// Task 7b: a Free Play run in the controller, and its result reaching the save exactly once.

const NOW = 1_762_900_000_000;
let storage: MemoryStorage;
let db: FakeDatabase;
let host: PlayerSession;

function page(): PlayerSession {
  const s = new PlayerSession();
  s.configure({ cloud: createFakeCloud(db), storage, now: () => NOW, window: null, document: null, mode: 'fake' });
  return s;
}

beforeEach(async () => {
  storage = new MemoryStorage();
  db = new FakeDatabase({ now: () => NOW });
  host = page();
  const made = await host.create('Mia', 'peashooter', '123');
  if (typeof made === 'string') throw new Error(made);
});
afterEach(() => host.dispose());

const me = (): Save => host.player.peek()!;
const run = (side: Faction, seed = 4): BattleController => new BattleController(freePlayOptions(prepareFreePlay(me(), side, seed)));
const steps = (c: BattleController, n: number): void => { for (let i = 0; i < n; i++) c.step(); };

describe('a survive run (plants)', () => {
  it('plays the Free Play config with nobody playing the zombies', () => {
    const c = run('plants');
    expect(c.match.state.config).toEqual(freePlayConfig(me(), 'plants', 4));
    expect(c.level).toBeNull();
    expect(c.play).toBeNull();
    expect(c.endless?.mode).toBe('survive');
    steps(c, seconds(5));
    expect(c.match.state.players.zombies.energy).toBe(0);
  });

  it('the flag counter, the countdown ring and the wave banner follow the waves', () => {
    const c = run('plants');
    const e = c.endless!;
    c.step();
    expect(e.wave.peek()).toBe(0);
    expect(e.nextWave.peek()).toBe(RING_STEPS);
    steps(c, seconds(FREE_PLAY.firstWaveSeconds / 2));
    expect(e.nextWave.peek()).toBe(RING_STEPS / 2);
    expect(e.banner.peek()).toBeNull();
    steps(c, seconds(FREE_PLAY.firstWaveSeconds / 2));
    expect(e.wave.peek()).toBe(1);
    expect(e.banner.peek()).toEqual({ wave: 1, big: false, n: 1 });
    expect(e.nextWave.peek()).toBe(RING_STEPS);
    steps(c, seconds(BALANCE.endless.gapSeconds));
    expect(e.wave.peek()).toBe(2);
    expect(e.banner.peek()).toMatchObject({ wave: 2, n: 2 });
  });

  it('the signals are written only on a change (a long run costs the HUD nothing between changes)', () => {
    const c = run('plants');
    c.step();
    let writes = 0;
    const e = c.endless!;
    const offs = [e.wave, e.nextWave, e.clock, e.banner, e.bonus].map((sig) => sig.subscribe(() => { writes += 1; }));
    writes = 0;
    steps(c, seconds(1));
    expect(writes).toBeLessThanOrEqual(2); // the ring's steps
    offs.forEach((off) => off());
  });

  it('ends when the plant base falls: the record has the wave reached and the waves before it cleared', () => {
    const c = run('plants');
    expect(c.freeResult()).toBeNull();
    steps(c, seconds(FREE_PLAY.firstWaveSeconds + BALANCE.endless.gapSeconds * 2 + 1));
    c.match.state.baseHp.plants = 0;
    c.step();
    expect(c.hud.result.peek()).toMatchObject({ playerWon: false });
    expect(c.freeResult()).toMatchObject({ kind: 'free', side: 'plants', wave: 3, cleared: 2 });
  });
});

describe('a breakthrough run (zombies)', () => {
  it('the garden on the first step, the clock, and +30 s with a broken garden', () => {
    const c = run('zombies');
    const e = c.endless!;
    expect(e.mode).toBe('breakthrough');
    c.step();
    expect(e.banner.peek()).toMatchObject({ wave: 1, n: 1 });
    expect(e.clock.peek()).toBe(BALANCE.endless.clockSeconds);
    const clock = c.match.state.clock;
    c.match.state.baseHp.plants = 0;
    c.step();
    expect(e.wave.peek()).toBe(1);
    expect(e.bonus.peek()).toBe(1);
    expect(c.match.state.clock).toBe(clock - 1 + seconds(BALANCE.endless.clockBonusSeconds));
    expect(e.banner.peek()).toMatchObject({ wave: 2, n: 2 });
    expect(c.hud.result.peek()).toBeNull();
  });

  it('ends at the clock: gardens broken are the waves cleared', () => {
    const c = run('zombies');
    c.step();
    c.match.state.baseHp.plants = 0;
    c.step();
    c.match.state.clock = 1;
    steps(c, 2);
    expect(c.freeResult()).toMatchObject({ wave: 1, cleared: 1 });
  });
});

describe('the result, exactly once', () => {
  it('settled: 5 coins a wave cleared and bestWave, through the device; twice pays once', () => {
    const coins = me().coins;
    const rec = { kind: 'free' as const, battleId: 'bfree1', side: 'plants' as const, wave: 3, cleared: 2 };
    expect(settleFreePlay(host, rec, me().slot)).toEqual({ side: 'plants', wave: 3, cleared: 2, coins: 10, best: true });
    expect(me().coins).toBe(coins + 10);
    expect(me().bestWave).toBe(3);
    expect(readPending(host, me().slot)).toBeNull();
    expect(settleFreePlay(host, rec, me().slot)).toMatchObject({ coins: 0, best: false });
    expect(me().coins).toBe(coins + 10);
  });

  it('a record left on the device is applied at the next page\'s log-in, once; a damaged one is dropped', async () => {
    const coins = me().coins;
    const slot = me().slot;
    storage.setItem(`lvt2f_${pendingKey(slot).slice(5)}`, JSON.stringify({ kind: 'free', battleId: 'bx', side: 'zombies', wave: 4, cleared: 4 }));
    expect(readPending(host, slot)).toMatchObject({ kind: 'free', wave: 4 });
    applyPending(host);
    expect(me().coins).toBe(coins + 20);
    expect(me().bestWave).toBe(4);
    expect(readPending(host, slot)).toBeNull();
    for (const bad of [{ kind: 'free', battleId: 'b', side: 'plants', wave: 2, cleared: 3 }, { kind: 'free', battleId: 'b', side: 'plants', wave: -1, cleared: 0 }, { kind: 'odd', battleId: 'b' }]) {
      storage.setItem(`lvt2f_${pendingKey(slot).slice(5)}`, JSON.stringify(bad));
      expect(readPending(host, slot)).toBeNull();
    }
  });

  it('another player\'s run stays on the device for them', () => {
    const rec = { kind: 'free' as const, battleId: 'b2', side: 'plants' as const, wave: 2, cleared: 1 };
    expect(settleFreePlay(host, rec, 'p09')).toBeNull();
    expect(readPending(host, 'p09')).toEqual(rec);
  });

  it('freePlayRecord is null for a battle that is no run', () => {
    const c = new BattleController({ playerFaction: 'plants', skill: 'easy', seed: 1 });
    expect(freePlayRecord(c)).toBeNull();
    expect(c.endless).toBeNull();
  });
});
