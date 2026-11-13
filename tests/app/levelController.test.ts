import { describe, expect, it } from 'vitest';
import { levelById } from '../../src/adventure/levels';
import { BattleController } from '../../src/app/BattleController';
import { levelOptions, prepareLevel } from '../../src/app/levelSession';
import { seconds } from '../../src/data/balance';
import { newSave } from '../../src/progress/save';
import type { Faction } from '../../src/sim/types';

// Task 5: the controller playing an Adventure level (the belt, the level HUD info, the wave cue).

function level(id: string, seed = 3): BattleController {
  const def = levelById(id)!;
  const save = newSave(def.side === 'plants' ? 'p01' : 'p02', 'Kid', 'peashooter', 0);
  return new BattleController(levelOptions(prepareLevel(def, save, seed)));
}

const units = (c: BattleController, side: Faction) => c.match.state.units.filter((u) => u.faction === side);

describe('a level\'s HUD info', () => {
  it('a battle has no clock, no waves, no belt', () => {
    // p1-4: a battle against a computer and nothing scripted (p1-1's and p1-2's Brain Eaters are scripted).
    expect(level('p1-4').level).toEqual({ mode: 'battle', goalSeconds: null, clockStars: false, lastWave: 0, flags: [], enemy: 'zombies', belt: false, noEnergy: false });
  });
  it('survive: the clock and the waves with the big wave flagged', () => {
    const info = level('p1-6').level!;
    expect(info).toMatchObject({ mode: 'survive', goalSeconds: 150, clockStars: false, belt: false, flags: [120] });
    expect(info.lastWave).toBe(150); // the bar spans the clock
  });
  it('breakthrough: the stars are on the clock', () => {
    expect(level('z1-3').level).toMatchObject({ mode: 'breakthrough', goalSeconds: 120, clockStars: true, enemy: 'plants' });
  });
  it('conveyor: the belt is the player\'s', () => {
    expect(level('p1-5').level).toMatchObject({ mode: 'conveyor', belt: true, noEnergy: true });
    expect(level('z1-5').level).toMatchObject({ mode: 'conveyor', belt: true });
  });
  it('a Quick Battle has none', () => {
    const c = new BattleController({ playerFaction: 'plants', skill: 'easy', seed: 1 });
    expect(c.level).toBeNull();
    expect(c.play).toBeNull();
  });
});

describe('the belt', () => {
  it('cards arrive on the belt with ids that stay with them; nothing is picked at the start', () => {
    const c = level('p1-5');
    expect(c.hud.selected.peek()).toBeNull();
    c.step();
    const first = c.levelHud.belt.peek();
    expect(first).toHaveLength(1);
    for (let i = 0; i < seconds(5); i++) c.step();
    const two = c.levelHud.belt.peek();
    expect(two).toHaveLength(2);
    expect(two[0]).toEqual(first[0]);
    expect(two[1]!.id).not.toBe(first[0]!.id);
    expect(two.map((b) => b.card)).toEqual(c.match.state.belt);
  });

  it('tap a belt card, then a tile: the plant grows there for nothing, the card leaves, nothing stays picked', () => {
    const c = level('p1-5');
    c.step();
    const card = c.match.state.belt[0]!;
    c.selectBelt(0);
    expect(c.hud.selected.peek()).toBe(card);
    expect(c.levelHud.beltSlot.peek()).toBe(0);
    expect(c.hover({ lane: 2, col: 1 }, null)).toMatchObject({ unit: card, lane: 2, col: 1, ok: true });
    expect(c.click({ lane: 2, col: 1 }, null)).toBeNull();
    c.step();
    expect(units(c, 'plants').find((u) => u.lane === 2 && Math.floor(u.x) === 1)?.key).toBe(card);
    expect(c.levelHud.belt.peek()).toEqual([]);
    expect(c.levelHud.beltSlot.peek()).toBeNull();
    expect(c.hud.selected.peek()).toBeNull();
    expect(c.match.state.players.plants.energy).toBe(0);
  });

  it('a picked card keeps its place when one before it is played; keys 1–0 pick belt cards', () => {
    const c = level('p1-5');
    for (let i = 0; i <= seconds(5); i++) c.step();
    expect(c.match.state.belt).toHaveLength(2);
    const second = c.levelHud.belt.peek()[1]!;
    c.selectBelt(0);
    c.click({ lane: 0, col: 0 }, null);
    c.hotkey('2');
    expect(c.levelHud.beltSlot.peek()).toBe(1);
    c.step(); // slot 0 is played: the picked card moves down to slot 0
    expect(c.levelHud.beltSlot.peek()).toBe(0);
    expect(c.levelHud.belt.peek()[0]).toEqual(second);
    expect(c.hud.selected.peek()).toBe(second.card);
  });

  it('a refused belt tap is a denial and the card stays; the tray\'s cards are refused for no energy', () => {
    const c = level('p1-5');
    c.step();
    c.selectBelt(0);
    c.click({ lane: 1, col: 1 }, null);
    c.step();
    for (let i = 0; i < seconds(5); i++) c.step();
    c.selectBelt(0);
    const denied = c.hud.denied.peek();
    expect(c.click({ lane: 1, col: 9 }, null)).toBe('bad-column');
    expect(c.hud.denied.peek()).toBe(denied + 1);
    expect(c.match.state.belt).toHaveLength(1);
    c.select('peashooter');
    expect(c.levelHud.beltSlot.peek()).toBeNull();
    expect(c.click({ lane: 3, col: 3 }, null)).toBe('no-energy');
  });

  it('the shovel and the hero put the belt card down; Escape too', () => {
    const c = level('p1-5');
    c.step();
    c.selectBelt(0);
    c.toggleShovel();
    expect(c.levelHud.beltSlot.peek()).toBeNull();
    c.selectBelt(0);
    c.hotkey('Escape');
    expect(c.levelHud.beltSlot.peek()).toBeNull();
    expect(c.hud.selected.peek()).toBeNull();
    c.selectBelt(5); // no card there
    expect(c.levelHud.beltSlot.peek()).toBeNull();
  });

  it('the merge cue shows for a belt card whose plant stands on the lawn (no energy needed)', () => {
    const c = level('p1-5', 15);
    c.step();
    const card = c.match.state.belt[0]!;
    c.selectBelt(0);
    c.click({ lane: 2, col: 2 }, null);
    // Wait for another of the same card; the others go on spare tiles, so the belt never fills.
    let slot = -1;
    let spare = 0;
    for (let i = 0; i < seconds(240) && slot < 0; i++) {
      c.step();
      slot = c.match.state.belt.indexOf(card);
      if (slot < 0 && c.match.state.belt.length > 0) {
        c.selectBelt(0);
        c.click({ lane: spare % 2 === 0 ? 0 : 4, col: Math.floor(spare / 2) % 8 }, null);
        spare += 1;
      }
    }
    expect(slot).toBeGreaterThanOrEqual(0);
    c.selectBelt(slot);
    expect(c.mergeCue()).toBe(card);
    expect(c.click({ lane: 2, col: 2 }, null)).toBeNull();
    c.step();
    expect(units(c, 'plants').find((u) => u.lane === 2 && Math.floor(u.x) === 2)?.level).toBe(2);
  });

  it('zombies: a belt card sent down a lane walks on at the zombie edge', () => {
    const c = level('z1-5');
    c.step();
    const card = c.match.state.belt[0]!;
    c.selectBelt(0);
    expect(c.click({ lane: 4, col: 9 }, null)).toBeNull();
    c.step();
    expect(units(c, 'zombies').map((u) => [u.key, u.lane])).toEqual([[card, 4]]);
  });
});

describe('the big wave cue', () => {
  it('each unit of a flagged wave cues its lane as it comes on; the trickle before does not', () => {
    const c = level('p1-6');
    c.match.state.baseHp.plants = 1e6; // nobody defends here: the base must outlast the trickle to see the flag
    const cues: { lane: number; n: number }[] = [];
    c.levelHud.incoming.subscribe((v) => { if (v !== null) cues.push({ lane: v.lane, n: v.n }); });
    for (let i = 0; i < seconds(115); i++) c.step();
    expect(cues).toEqual([]);
    for (let i = 0; i < seconds(10); i++) c.step();
    expect(cues.map((q) => q.lane)).toEqual([0, 1, 2, 3, 4]);
    expect(c.levelHud.incoming.peek()).toMatchObject({ side: 'zombies', n: 5 });
  });
});
