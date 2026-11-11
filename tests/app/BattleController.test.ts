import { describe, expect, it } from 'vitest';
import { BattleController } from '../../src/app/BattleController';
import { seconds } from '../../src/data/balance';
import { ZOMBIE_SPAWN_X } from '../../src/sim/types';
import type { Faction } from '../../src/sim/types';

function make(playerFaction: Faction = 'plants', seed = 7): BattleController {
  return new BattleController({ playerFaction, skill: 'easy', seed });
}
const energy = (c: BattleController, f: Faction = c.playerFaction): number => c.match.state.players[f].energy;
const playerUnits = (c: BattleController) => c.match.state.units.filter((u) => u.faction === c.playerFaction);

describe('BattleController placing', () => {
  it('queues a place that exists after step', () => {
    const c = make();
    c.select('peashooter');
    expect(c.click({ lane: 2, col: 3 }, null)).toBeNull();
    c.step();
    const u = playerUnits(c).find((x) => x.key === 'peashooter');
    expect(u).toBeDefined();
    expect(u?.lane).toBe(2);
    expect(Math.floor(u?.x ?? -1)).toBe(3);
  });

  it('refuses an occupied tile, counts the denial, keeps energy', () => {
    const c = make();
    c.select('sunflower');
    c.click({ lane: 2, col: 3 }, null);
    c.step();
    c.select('peashooter'); // a different type than the plant on the tile
    const before = energy(c);
    const denied = c.hud.denied.value;
    expect(c.click({ lane: 2, col: 3 }, null)).toBe('occupied');
    expect(c.hud.denied.value).toBe(denied + 1);
    expect(energy(c)).toBe(before);
  });

  it('tapping a tile that holds the same type merges, with no unitId', () => {
    const c = make();
    c.select('sunflower');
    c.click({ lane: 2, col: 3 }, null);
    c.step();
    const plant = playerUnits(c)[0];
    for (let i = 0; i < seconds(6); i++) c.step();
    c.match.state.players.plants.energy = 900;
    expect(c.hover({ lane: 2, col: 3 }, null)).toMatchObject({ ok: true, mergeTargetId: plant?.id });
    expect(c.click({ lane: 2, col: 3 }, null)).toBeNull();
    c.step();
    expect(plant?.level).toBe(2);
  });

  it('a merge at max level is refused and counts as denied', () => {
    const c = make();
    c.select('sunflower');
    c.click({ lane: 2, col: 3 }, null);
    c.step();
    const plant = playerUnits(c)[0];
    if (plant === undefined) throw new Error('no plant');
    plant.level = 5;
    for (let i = 0; i < seconds(6); i++) c.step();
    c.match.state.players.plants.energy = 900;
    const denied = c.hud.denied.value;
    expect(c.click({ lane: 2, col: 3 }, null)).toBe('max-level');
    expect(c.hud.denied.value).toBe(denied + 1);
  });

  it('ignores a unitId on another lane and uses the tile', () => {
    const c = make();
    c.select('sunflower');
    c.click({ lane: 2, col: 3 }, null);
    c.step();
    const plant = playerUnits(c)[0];
    c.select('peashooter');
    expect(c.hover({ lane: 0, col: 5 }, plant?.id ?? null)).toMatchObject({ lane: 0, col: 5, ok: true, mergeTargetId: null });
  });

  it('places exactly one unit for 100 clicks in one tick', () => {
    const c = make();
    c.match.state.players.plants.energy = 900;
    c.select('sunflower');
    for (let i = 0; i < 100; i++) c.click({ lane: 1, col: 1 }, null);
    c.step();
    expect(playerUnits(c).filter((u) => u.key === 'sunflower')).toHaveLength(1);
  });

  it('works by touch: click with no prior hover', () => {
    const c = make();
    c.select('sunflower');
    expect(c.click({ lane: 0, col: 0 }, null)).toBeNull();
  });

  it('returns no-energy with 0 energy', () => {
    const c = make();
    c.match.state.players.plants.energy = 0;
    c.select('peashooter');
    expect(c.click({ lane: 0, col: 0 }, null)).toBe('no-energy');
  });

  it('a null tile returns a rejection and does not throw', () => {
    const c = make();
    c.select('peashooter');
    expect(c.click(null, null)).not.toBeNull();
    const d = make();
    expect(d.click(null, null)).not.toBeNull(); // nothing selected either
  });

  it('keeps the selection after a successful place', () => {
    const c = make();
    c.select('sunflower');
    c.click({ lane: 0, col: 0 }, null);
    expect(c.hud.selected.value).toBe('sunflower');
  });

  it('as zombies any tile of lane 4 spawns at the right edge in lane 4', () => {
    const c = make('zombies');
    c.select('brainEater');
    expect(c.click({ lane: 4, col: 2 }, null)).toBeNull();
    const events = c.step();
    const spawn = events.find((e) => e.type === 'unitSpawned' && e.faction === 'zombies' && e.key === 'brainEater');
    expect(spawn).toMatchObject({ lane: 4, x: ZOMBIE_SPAWN_X });
  });
});

describe('BattleController pause and result', () => {
  it('while paused, clicks and hotkeys other than space do nothing and step advances nothing', () => {
    const c = make();
    c.select('peashooter');
    c.hotkey(' ');
    expect(c.hud.paused.value).toBe(true);
    c.hotkey('Escape');
    c.hotkey('2');
    c.select(null);
    c.toggleShovel();
    expect(c.hud.selected.value).toBe('peashooter');
    expect(c.hud.shovel.value).toBe(false);
    const denied = c.hud.denied.value;
    expect(c.click({ lane: 0, col: 0 }, null)).toBe('ignored');
    expect(c.hud.denied.value).toBe(denied);
    const tick = c.match.state.tick;
    expect(c.step()).toEqual([]);
    expect(c.match.state.tick).toBe(tick);
    expect(playerUnits(c)).toHaveLength(0);
    c.hotkey(' ');
    expect(c.hud.paused.value).toBe(false);
    c.step();
    expect(c.match.state.tick).toBe(tick + 1);
    expect(playerUnits(c)).toHaveLength(0); // the paused click did not queue
  });

  it('sets the result on the ending step and accepts nothing afterwards', () => {
    const c = make();
    c.match.state.baseHp.zombies = 0;
    c.step();
    expect(c.hud.result.value).toEqual({ winner: 'plants', playerWon: true });
    c.select('peashooter');
    const denied = c.hud.denied.value;
    expect(c.click({ lane: 0, col: 0 }, null)).toBe('match-over');
    expect(c.hud.denied.value).toBe(denied);
    expect(c.step()).toEqual([]);
    expect(playerUnits(c)).toHaveLength(0);
    expect(c.hud.result.value).toEqual({ winner: 'plants', playerWon: true });
    expect(c.hud.base.value.zombies.hp).toBe(0);
  });
});

describe('BattleController merge, shovel, hotkeys, hover', () => {
  it('merges onto the player\'s own unit of the selected key', () => {
    const c = make();
    c.match.state.players.plants.energy = 900;
    c.select('peashooter');
    c.click({ lane: 2, col: 3 }, null);
    c.step();
    const target = playerUnits(c).find((u) => u.key === 'peashooter');
    for (let i = 0; i < seconds(6); i++) c.step(); // recharge
    c.match.state.players.plants.energy = 900;
    expect(c.click({ lane: 2, col: 3 }, target?.id ?? null)).toBeNull();
    const events = c.step();
    expect(events.some((e) => e.type === 'unitMerged' && e.unitId === target?.id)).toBe(true);
    expect(target?.level).toBe(2);
  });

  it('a zombie player merges by unitId', () => {
    const c = make('zombies');
    c.select('brainEater');
    c.click({ lane: 1, col: 5 }, null);
    c.step();
    const z = playerUnits(c)[0];
    for (let i = 0; i < seconds(6); i++) c.step();
    c.match.state.players.zombies.energy = 900;
    expect(c.click({ lane: z?.lane ?? 1, col: 5 }, z?.id ?? null)).toBeNull();
    c.step();
    expect(z?.level).toBe(2);
  });

  it('an unknown hotkey does nothing', () => {
    const c = make();
    c.select('peashooter');
    c.hotkey('x');
    c.hotkey('9');
    expect(c.hud.selected.value).toBe('peashooter');
  });

  it('the shovel falls back to the plant on the tile when the picked unit is not the player\'s', () => {
    const c = make();
    c.select('sunflower');
    c.click({ lane: 0, col: 0 }, null);
    c.step();
    c.toggleShovel();
    expect(c.click({ lane: 0, col: 0 }, 99999)).toBeNull();
    c.step();
    expect(playerUnits(c)).toHaveLength(0);
  });

  it('hotkey 2 selects the second card, Escape clears', () => {
    const c = make();
    c.hotkey('2');
    expect(c.hud.selected.value).toBe(c.hud.cards.value[1]?.unit);
    c.hotkey('Escape');
    expect(c.hud.selected.value).toBeNull();
  });

  it('shovel then click on own plant removes it; selecting a card clears the shovel', () => {
    const c = make();
    c.select('sunflower');
    c.click({ lane: 0, col: 0 }, null);
    c.step();
    const target = playerUnits(c)[0];
    if (target === undefined) throw new Error('no plant');
    c.toggleShovel();
    expect(c.hud.shovel.value).toBe(true);
    expect(c.hud.selected.value).toBeNull();
    expect(c.click({ lane: 0, col: 0 }, target.id)).toBeNull();
    c.step();
    expect(playerUnits(c)).toHaveLength(0);
    c.select('sunflower');
    expect(c.hud.shovel.value).toBe(false);
  });

  it('the shovel does nothing for zombies', () => {
    const c = make('zombies');
    c.toggleShovel();
    expect(c.hud.shovel.value).toBe(false);
  });

  it('hover on an occupied tile is not ok; on a free tile it is', () => {
    const c = make();
    c.select('sunflower');
    c.click({ lane: 3, col: 2 }, null);
    c.step();
    expect(c.hover({ lane: 3, col: 2 }, null)).toMatchObject({ unit: 'sunflower', lane: 3, col: 2, ok: false });
    c.select('peashooter'); // sunflower is still recharging
    expect(c.hover({ lane: 3, col: 4 }, null)).toMatchObject({ ok: true, mergeTargetId: null });
    expect(c.hover(null, null)).toBeNull();
    c.select(null);
    expect(c.hover({ lane: 3, col: 4 }, null)).toBeNull();
  });
});

describe('BattleController hud', () => {
  it('rechargeFraction falls from 1 to 0 over the recharge time', () => {
    const c = make();
    c.select('peashooter');
    c.click({ lane: 0, col: 0 }, null);
    c.step();
    const frac = () => c.hud.cards.value.find((x) => x.unit === 'peashooter')?.rechargeFraction ?? -1;
    expect(frac()).toBeGreaterThan(0.95);
    for (let i = 0; i < seconds(2.5); i++) c.step();
    expect(frac()).toBeGreaterThan(0.3);
    expect(frac()).toBeLessThan(0.7);
    for (let i = 0; i < seconds(3); i++) c.step();
    expect(frac()).toBe(0);
  });

  it('seconds, energy and the cards array only change when something does', () => {
    const c = make();
    const cards = c.hud.cards.value;
    c.step();
    expect(c.hud.cards.value).toBe(cards);
    for (let i = 0; i < 30; i++) c.step();
    expect(c.hud.seconds.value).toBe(Math.floor(c.match.state.tick / 30));
    expect(c.hud.energy.value).toBe(energy(c));
  });
});

describe('BattleController determinism and bot', () => {
  const run = (seed: number): number => {
    const c = make('plants', seed);
    c.select('sunflower');
    for (let i = 0; i < 600; i++) {
      if (i % 90 === 0) c.click({ lane: (i / 90) % 5, col: 1 }, null);
      c.step();
    }
    return c.match.hash();
  };
  it('same seed and inputs give the same hash; another seed differs', () => {
    expect(run(7)).toBe(run(7));
    expect(run(8)).not.toBe(run(7));
  });
  it('a Medium bot acts within 300 steps', () => {
    const c = new BattleController({ playerFaction: 'plants', skill: 'medium', seed: 3 });
    let acted = false;
    for (let i = 0; i < 300 && !acted; i++) {
      acted = c.step().some((e) => e.type === 'unitSpawned' && e.faction === 'zombies');
    }
    expect(acted).toBe(true);
  });
});
