import { describe, expect, it } from 'vitest';
import { BattleController } from '../../src/app/BattleController';
import { DIFFICULTY, battleConfig } from '../../src/ai/difficulty';
import { seconds } from '../../src/data/balance';
import { spawnUnit } from '../../src/sim/match';
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

  it('for plants the tapped tile wins over a plant on the neighbouring tile hit by the tap ray', () => {
    const c = make();
    c.match.state.players.plants.energy = 900;
    c.select('peashooter');
    c.click({ lane: 2, col: 3 }, null);
    c.step();
    const left = playerUnits(c).find((u) => u.key === 'peashooter');
    if (left === undefined) throw new Error('no peashooter');
    for (let i = 0; i < seconds(6); i++) c.step(); // recharge
    c.match.state.players.plants.energy = 900;
    // The ray hit the plant on column 3, but the tap was on column 4: a new plant, not a merge.
    expect(c.hover({ lane: 2, col: 4 }, left.id)).toMatchObject({ lane: 2, col: 4, ok: true, mergeTargetId: null });
    expect(c.click({ lane: 2, col: 4 }, left.id)).toBeNull();
    c.step();
    expect(left.level).toBe(1);
    const right = playerUnits(c).find((u) => u.key === 'peashooter' && Math.floor(u.x) === 4);
    if (right === undefined) throw new Error('no peashooter on column 4');
    for (let i = 0; i < seconds(6); i++) c.step();
    c.match.state.players.plants.energy = 900;
    // A tap on column 4 whose ray hit column 3 merges into the plant standing on column 4.
    expect(c.hover({ lane: 2, col: 4 }, left.id)).toMatchObject({ ok: true, mergeTargetId: right.id });
    expect(c.click({ lane: 2, col: 4 }, left.id)).toBeNull();
    c.step();
    expect([left.level, right.level]).toEqual([1, 2]);
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

describe('BattleController setup', () => {
  it.each([['plants', 'easy'], ['zombies', 'easy'], ['plants', 'medium'], ['zombies', 'hard']] as const)(
    'as %s on %s, plays the difficulty\'s match: its config and income multipliers', (side, skill) => {
      const c = new BattleController({ playerFaction: side, skill, seed: 11 });
      const config = c.match.state.config;
      expect(config).toEqual(battleConfig(11, side, skill));
      const income = DIFFICULTY[skill][side].income;
      const computer: Faction = side === 'plants' ? 'zombies' : 'plants';
      expect(config.incomeMultiplier[side]).toBe(income.human);
      expect(config.incomeMultiplier[computer]).toBe(income.computer);
    },
  );

  it('gives the human on Easy more income than on Medium, on both sides', () => {
    for (const side of ['plants', 'zombies'] as const) {
      const easy = new BattleController({ playerFaction: side, skill: 'easy', seed: 3 }).match.state.config;
      const medium = new BattleController({ playerFaction: side, skill: 'medium', seed: 3 }).match.state.config;
      expect(easy.incomeMultiplier[side], side).toBeGreaterThan(medium.incomeMultiplier[side]);
    }
  });

  it.each(['plants', 'zombies'] as const)('as %s starts with the first card it can pay for selected', (side) => {
    const c = make(side);
    const first = c.hud.cards.value.find((card) => card.affordable);
    expect(first).toBeDefined();
    expect(c.hud.selected.value).toBe(first?.unit);
    // So a first tap on the lawn does something.
    expect(c.click({ lane: 2, col: 1 }, null)).toBeNull();
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

describe('BattleController merging, as a child plays it', () => {
  /** A zombie player's controller with standing zombies placed by hand, money and cards ready. */
  function zombieScene(units: { key: 'brainEater' | 'veryFastWalker'; lane: number; x: number; level?: number }[]) {
    const c = make('zombies');
    const made = units.map((u) => {
      const z = spawnUnit(c.match.state, c.match.balance, u.key, u.lane, u.x);
      z.level = u.level ?? 1;
      return z;
    });
    c.match.state.players.zombies.energy = 900;
    c.match.state.players.zombies.recharge = {};
    return { c, made };
  }

  it('zombies: a tap in the lane near the player\'s own zombie of the selected type merges into it', () => {
    const { c, made: [z] } = zombieScene([{ key: 'brainEater', lane: 2, x: 6.7 }]);
    c.select('brainEater');
    // The tap fell on the grass under the zombie (column 6), not on its small walking model.
    expect(c.hover({ lane: 2, col: 6 }, null)).toMatchObject({ ok: true, mergeTargetId: z?.id });
    expect(c.click({ lane: 2, col: 6 }, null)).toBeNull();
    const events = c.step();
    expect(events.some((e) => e.type === 'unitMerged' && e.unitId === z?.id && e.level === 2)).toBe(true);
    expect(c.match.state.units.filter((u) => u.faction === 'zombies' && u.key === 'brainEater')).toHaveLength(1);
  });

  it('zombies: the nearest one within 0.75 tile along the lane; farther, other lanes, other types and level 5 do not count', () => {
    const { c, made } = zombieScene([
      { key: 'brainEater', lane: 2, x: 4.9 }, // 0.6 from column 4's middle
      { key: 'brainEater', lane: 2, x: 4.2 }, // 0.3: the nearest
      { key: 'veryFastWalker', lane: 2, x: 4.5 }, // another type, right on the spot
      { key: 'brainEater', lane: 3, x: 4.5 }, // another lane
    ]);
    c.select('brainEater');
    expect(c.hover({ lane: 2, col: 4 }, null)?.mergeTargetId).toBe(made[1]?.id);
    // Column 6's middle is 1.1 from the nearest Brain Eater: a new one is sent instead.
    expect(c.hover({ lane: 2, col: 6 }, null)).toMatchObject({ ok: true, mergeTargetId: null });
    // Level 5 is not offered; the next nearest below level 5 is.
    if (made[1]) made[1].level = 5;
    expect(c.hover({ lane: 2, col: 4 }, null)?.mergeTargetId).toBe(made[0]?.id);
    if (made[0]) made[0].level = 5;
    expect(c.hover({ lane: 2, col: 4 }, null)?.mergeTargetId).toBeNull();
  });

  it('zombies: an exact hit on the player\'s own zombie of the selected type wins over a nearer one', () => {
    const { c, made } = zombieScene([{ key: 'brainEater', lane: 1, x: 5.5 }, { key: 'brainEater', lane: 1, x: 6.1 }]);
    c.select('brainEater');
    expect(c.hover({ lane: 1, col: 5 }, made[1]?.id ?? null)?.mergeTargetId).toBe(made[1]?.id);
    // A hit on a zombie of another type falls back to the nearest of the selected type.
    const walker = spawnUnit(c.match.state, c.match.balance, 'veryFastWalker', 1, 5.4);
    expect(c.hover({ lane: 1, col: 5 }, walker.id)?.mergeTargetId).toBe(made[0]?.id);
  });

  it('a merge refused for recharging or energy counts as a denial (the tray shakes, the deny sound plays)', () => {
    const c = make();
    c.match.state.players.plants.energy = 900;
    c.select('peashooter');
    c.click({ lane: 2, col: 3 }, null);
    c.step();
    const denied = c.hud.denied.value;
    expect(c.click({ lane: 2, col: 3 }, null)).toBe('recharging');
    c.match.state.players.plants.recharge = {};
    c.match.state.players.plants.energy = 0;
    expect(c.click({ lane: 2, col: 3 }, null)).toBe('no-energy');
    expect(c.hud.denied.value).toBe(denied + 2);
  });

  it('mergeCue names the selected card only while a merge with it is possible right now', () => {
    const c = make();
    c.match.state.players.plants.energy = 900;
    c.select('peashooter');
    expect(c.mergeCue()).toBeNull(); // nothing to merge into
    c.click({ lane: 2, col: 3 }, null);
    c.step();
    expect(c.mergeCue()).toBeNull(); // recharging
    c.match.state.players.plants.recharge = {};
    expect(c.mergeCue()).toBe('peashooter');
    c.match.state.players.plants.energy = 0;
    expect(c.mergeCue()).toBeNull(); // cannot pay
    c.match.state.players.plants.energy = 900;
    const p = playerUnits(c)[0];
    if (p) p.level = 5;
    expect(c.mergeCue()).toBeNull(); // every one is at the top level
    if (p) p.level = 1;
    c.select('sunflower');
    expect(c.mergeCue()).toBeNull(); // no Sunflower on the lawn
    c.toggleShovel();
    expect(c.mergeCue()).toBeNull();
  });

  it('aimAt: an exact ray hit on the player\'s own unit of the selected type (or any, with the shovel) names its tile', () => {
    const c = make();
    c.match.state.players.plants.energy = 900;
    c.select('peashooter');
    c.click({ lane: 2, col: 3 }, null);
    c.step();
    const p = playerUnits(c)[0];
    if (p === undefined) throw new Error('no peashooter');
    expect(c.aimAt(p.id)).toEqual({ lane: 2, col: 3 });
    c.select('sunflower');
    expect(c.aimAt(p.id)).toBeNull(); // another card: the ground under the pointer decides
    c.toggleShovel();
    expect(c.aimAt(p.id)).toEqual({ lane: 2, col: 3 });
    expect(c.aimAt(99999)).toBeNull();
  });
});
