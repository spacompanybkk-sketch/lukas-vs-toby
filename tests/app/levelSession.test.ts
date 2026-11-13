import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { levelById } from '../../src/adventure/levels';
import { ADVENTURE } from '../../src/adventure/rewards';
import type { LevelDef } from '../../src/adventure/types';
import { BattleController } from '../../src/app/BattleController';
import {
  applyPending, bigWaveRuns, bigWaves, levelOptions, levelProblem, levelRecord, newBattleId, pendingKey, prepareLevel, readPending,
  settleLevel, watchPending,
} from '../../src/app/levelSession';
import type { LevelRecord } from '../../src/app/levelSession';
import { PlayerSession } from '../../src/app/session';
import { FakeDatabase } from '../../src/cloud/fakeCloud';
import { createFakeCloud } from '../../src/cloud/restClient';
import { seconds } from '../../src/data/balance';
import type { Save } from '../../src/progress/save';
import { MemoryStorage } from '../progress/memoryStorage';

const NOW = 1_762_900_000_000;
let storage: MemoryStorage;
let db: FakeDatabase;
let host: PlayerSession;

/** A page: a session on the one device storage and the one fake database (a reload is a new page). */
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
const p11 = (): LevelDef => levelById('p1-1')!;

/** Plays `def` to the end in the controller: the enemy base falls (and the player's loses `hurt` of its health first). */
function playToEnd(def: LevelDef, { win = true, hurt = 0 } = {}): BattleController {
  const play = prepareLevel(def, me(), 7, me().slot);
  const ctl = new BattleController(levelOptions(play));
  const s = ctl.match.state;
  s.baseHp[def.side] = Math.round(s.baseMaxHp[def.side] * (1 - hurt));
  const loser = win ? (def.side === 'plants' ? 'zombies' : 'plants') : def.side;
  s.baseHp[loser] = 0;
  ctl.step();
  expect(ctl.hud.result.peek()).not.toBeNull();
  return ctl;
}

describe('prepareLevel', () => {
  it('builds the match from levelConfig (the save\'s difficulty and unlocks) with a fresh battle id each time', () => {
    const a = prepareLevel(p11(), me(), 9, me().slot);
    const b = prepareLevel(p11(), me(), 9, me().slot);
    expect(a.config).toEqual(levelConfig(p11(), me(), 9));
    expect(a.battleId).not.toBe(b.battleId);
    expect(a.slot).toBe(me().slot);
    // The save format takes ids of 1..64 characters.
    expect(a.battleId.length).toBeGreaterThan(8);
    expect(a.battleId.length).toBeLessThanOrEqual(64);
  });

  it('newBattleId draws from the random source it is given', () => {
    let n = 0;
    const r = (): number => { n += 1; return 0.5; };
    expect(newBattleId(r)).toBe(newBattleId(() => 0.5));
    expect(n).toBeGreaterThan(0);
  });

  it('refuses a level with a computer and no energy (it could not play a card), with a clear error', () => {
    const bad: LevelDef = { ...levelById('p1-5')!, opponent: { skill: 'easy', cards: ['brainEater'], incomeScale: 1 } };
    expect(levelProblem(bad)).toMatch(/opponent.*energy/i);
    expect(() => prepareLevel(bad, me(), 1, me().slot)).toThrow(/p1-5/);
    expect(levelProblem(levelById('p1-5')!)).toBeNull();
    expect(levelProblem(p11())).toBeNull();
  });
});

describe('the controller in a level', () => {
  it('plays the level config, with the level computer at its skill, or none at all for a scripted level', () => {
    const play = prepareLevel(levelById('p1-3')!, me(), 4, me().slot);
    const ctl = new BattleController(levelOptions(play));
    expect(ctl.match.state.config).toEqual(play.config);
    // Survive: no computer; 2 minutes of steps send only the script's zombies.
    for (let i = 0; i < seconds(20); i++) ctl.step();
    const zombies = ctl.match.state.units.filter((u) => u.faction === 'zombies');
    expect(zombies.length).toBe(play.config.script.filter((e) => e.tick < seconds(20)).length);
  });

  it('a level with a computer gets one that plays its cards', () => {
    const play = prepareLevel(p11(), me(), 4, me().slot);
    const ctl = new BattleController(levelOptions(play));
    for (let i = 0; i < seconds(60); i++) ctl.step();
    const zombies = ctl.match.state.units.filter((u) => u.faction === 'zombies');
    expect(zombies.length).toBeGreaterThan(0);
    expect(zombies.every((z) => z.key === 'brainEater')).toBe(true);
  });
});

describe('levelRecord: the stars from the end of the match', () => {
  it('a win with the base whole is 3 stars; at 60% 2; at 30% 1; a loss 0', () => {
    expect(levelRecord(playToEnd(p11()))).toMatchObject({ levelId: 'p1-1', side: 'plants', won: true, stars: 3 });
    expect(levelRecord(playToEnd(p11(), { hurt: 0.4 }))?.stars).toBe(2);
    expect(levelRecord(playToEnd(p11(), { hurt: 0.7 }))?.stars).toBe(1);
    expect(levelRecord(playToEnd(p11(), { win: false }))).toMatchObject({ won: false, stars: 0 });
  });

  it('Breakthrough counts the clock left', () => {
    const def = levelById('z1-3')!;
    host.update((s) => ({ ...s, zombies: { stars: { 'z1-1': 1, 'z1-2': 1 }, unlocked: [] } }));
    const play = prepareLevel(def, me(), 7, me().slot);
    const ctl = new BattleController(levelOptions(play));
    const goal = play.config.goalTicks!;
    for (let i = 0; i < Math.round(goal * 0.6); i++) ctl.step(); // 40% of the clock left
    ctl.match.state.baseHp.plants = 0;
    ctl.step();
    expect(levelRecord(ctl)).toMatchObject({ won: true, stars: 2 });
  });

  it('is null before the end and for a Quick Battle', () => {
    const play = prepareLevel(p11(), me(), 7, me().slot);
    expect(levelRecord(new BattleController(levelOptions(play)))).toBeNull();
    expect(levelRecord(new BattleController({ playerFaction: 'plants', skill: 'easy', seed: 1 }))).toBeNull();
  });
});

describe('a result travels: start → end → pending on the device → applied once', () => {
  it('a first win of p1-1: 3 stars, 90 coins, p1-2 opens, and nothing is left pending', () => {
    const coins = me().coins;
    const rec = levelRecord(playToEnd(p11()))!;
    const out = settleLevel(host, rec, me().slot)!;
    expect(out).toMatchObject({ stars: 3, coins: 3 * ADVENTURE.perNewStar, newStars: 3, unlocked: null, won: true });
    expect(out.next?.id).toBe('p1-2');
    expect(me().coins).toBe(coins + 90);
    expect(me().plants.stars['p1-1']).toBe(3);
    expect(me().lastBattle).toBe(rec.battleId);
    expect(readPending(host, me().slot)).toBeNull();
  });

  it('the record is on the device before the save changes (a crash in between loses nothing)', () => {
    const rec = levelRecord(playToEnd(p11()))!;
    let seen: LevelRecord | null = null;
    const spy = {
      player: host.player, now: () => host.now(), deviceStorage: () => host.deviceStorage(),
      update: (fn: (s: Save) => Save) => { seen = readPending(host, me().slot); host.update(fn); },
    };
    settleLevel(spy, rec, me().slot);
    expect(seen).toEqual(rec);
    expect(storage.getItem(`lvt2f_pending_${me().slot}`)).toBeNull();
    expect(pendingKey(me().slot)).toBe(`lvt2_pending_${me().slot}`);
  });

  it('settling the same battle twice pays once', () => {
    const rec = levelRecord(playToEnd(p11()))!;
    settleLevel(host, rec, me().slot);
    const after = me().coins;
    expect(settleLevel(host, rec, me().slot)).toMatchObject({ coins: 0, newStars: 0 });
    expect(me().coins).toBe(after);
  });

  it('a reload with the record still pending (the page died before the save): applied at the next log-in, once', async () => {
    const slot = me().slot;
    const coins = me().coins;
    const rec = levelRecord(playToEnd(p11()))!;
    // The record was written, then the page went away before the save changed.
    const dead = { player: host.player, now: () => NOW, deviceStorage: () => host.deviceStorage(), update: () => { throw new Error('page gone'); } };
    expect(() => settleLevel(dead, rec, slot)).toThrow('page gone');
    expect(readPending(host, slot)).toEqual(rec);
    await host.flush();
    host.dispose();

    host = page();
    const stop = watchPending(host);
    expect(await host.login(slot, '123')).toMatchObject({ slot });
    expect(me().coins).toBe(coins + 90);
    expect(me().plants.stars['p1-1']).toBe(3);
    expect(readPending(host, slot)).toBeNull();
    // Logging in again (a second reload) changes nothing.
    await host.flush();
    host.logout();
    expect(await host.login(slot, '123')).toMatchObject({ slot });
    expect(me().coins).toBe(coins + 90);
    stop();
  });

  it('a reload on the result screen (already applied, record not yet cleared) neither loses nor doubles', async () => {
    const slot = me().slot;
    const coins = me().coins;
    const rec = levelRecord(playToEnd(p11()))!;
    settleLevel(host, rec, me().slot);
    // As if the clear had not happened: the record is back on the device.
    storage.setItem(`lvt2f_pending_${slot}`, JSON.stringify(rec));
    await host.flush();
    host.dispose();

    host = page();
    expect(await host.login(slot, '123')).toMatchObject({ slot });
    expect(applyPending(host)).toMatchObject({ coins: 0 });
    expect(me().coins).toBe(coins + 90);
    expect(me().plants.stars['p1-1']).toBe(3);
    expect(readPending(host, slot)).toBeNull();
  });

  it('a battle settled while another player is logged in stays pending for its own player', async () => {
    const mia = me().slot;
    const rec = levelRecord(playToEnd(p11()))!;
    await host.flush();
    host.logout();
    const other = await host.create('Ben', 'brainEater', '456');
    if (typeof other === 'string') throw new Error(other);
    expect(settleLevel(host, rec, mia)).toBeNull();
    expect(me().plants.stars['p1-1']).toBeUndefined();
    expect(readPending(host, mia)).toEqual(rec);
    await host.flush();
    host.logout();
    expect(settleLevel(host, rec, mia)).toBeNull(); // nobody logged in: kept too
    expect(readPending(host, mia)).toEqual(rec);
  });

  it('a pending record is only ever applied to its own player', async () => {
    const mia = me().slot;
    const rec = levelRecord(playToEnd(p11()))!;
    storage.setItem(`lvt2f_pending_${mia}`, JSON.stringify(rec));
    await host.flush();
    host.logout();
    const other = await host.create('Ben', 'brainEater', '456');
    if (typeof other === 'string') throw new Error(other);
    expect(applyPending(host)).toBeNull();
    expect(me().plants.stars['p1-1']).toBeUndefined();
    expect(readPending(host, mia)).toEqual(rec);
  });

  it('a damaged or unknown pending record is dropped, not applied', () => {
    const slot = me().slot;
    const coins = me().coins;
    storage.setItem(`lvt2f_pending_${slot}`, '{nope');
    expect(applyPending(host)).toBeNull();
    expect(readPending(host, slot)).toBeNull();
    storage.setItem(`lvt2f_pending_${slot}`, JSON.stringify({ battleId: 'b1', levelId: 'x9-9', side: 'plants', stars: 3, won: true }));
    expect(applyPending(host)).toBeNull();
    expect(readPending(host, slot)).toBeNull();
    storage.setItem(`lvt2f_pending_${slot}`, JSON.stringify({ battleId: 'b1', levelId: 'p1-1', side: 'plants', stars: 7, won: true }));
    expect(applyPending(host)).toBeNull();
    expect(me().coins).toBe(coins);
  });

  it('quit mid-level stores nothing and pays nothing', () => {
    const coins = me().coins;
    const play = prepareLevel(p11(), me(), 7, me().slot);
    const ctl = new BattleController(levelOptions(play));
    for (let i = 0; i < 100; i++) ctl.step();
    expect(levelRecord(ctl)).toBeNull();
    expect(readPending(host, me().slot)).toBeNull();
    expect(me().coins).toBe(coins);
  });

  it('a loss pays the consolation coins and no star; an unlock comes with its level\'s first win', () => {
    const coins = me().coins;
    const lost = settleLevel(host, levelRecord(playToEnd(p11(), { win: false }))!, me().slot)!;
    expect(lost).toMatchObject({ won: false, stars: 0, coins: ADVENTURE.loss, next: null });
    expect(me().coins).toBe(coins + ADVENTURE.loss);
    host.update((s) => ({ ...s, plants: { stars: { 'p1-1': 1, 'p1-2': 1 }, unlocked: [] } }));
    const won = settleLevel(host, levelRecord(playToEnd(levelById('p1-3')!))!, me().slot)!;
    expect(won.unlocked).toBe('potatoMine');
    expect(me().plants.unlocked).toEqual(['potatoMine']);
    expect(won.next?.id).toBe('p1-4');
  });
});

describe('bigWaves: the wave bar\'s flags', () => {
  const at = (...s: number[]) => s.map((t) => ({ tick: seconds(t) }));
  it('a flag where 4 or more arrive within 3 s; one flag per such crowd', () => {
    expect(bigWaves(at(1, 5, 9, 13))).toEqual([]);
    expect(bigWaves(at(1, 10, 10.5, 11, 12))).toEqual([seconds(10)]);
    expect(bigWaves(at(10, 10, 10, 10, 10, 10, 10, 30, 30.5, 31, 32.9))).toEqual([seconds(10), seconds(30)]);
    // A run where each arrival follows the one before within 3 s is one wave, however long.
    expect(bigWaves(at(10, 11, 12, 13.1))).toEqual([seconds(10)]);
    expect(bigWaves(at(10, 12, 14, 16, 18, 20, 22))).toEqual([seconds(10)]);
    expect(bigWaves(at(10, 14, 18, 22))).toEqual([]);
    expect(bigWaveRuns(at(5, 10, 12, 14, 16, 18, 30))).toEqual([{ from: seconds(10), to: seconds(18) }]);
  });
  it('p1-6 has its Skeleton Warrior flag wave', () => {
    const c = levelConfig(levelById('p1-6')!, me(), 1);
    expect(bigWaves(c.script)).toContain(seconds(120));
  });
});
