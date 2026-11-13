import type { PlacementPreview } from '../../src/render/battle/types';
import { describe, expect, it } from 'vitest';
import { BattleController } from '../../src/app/BattleController';
import { DIFFICULTY, battleConfig } from '../../src/ai/difficulty';
import { BALANCE, seconds } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { spawnUnit } from '../../src/sim/match';
import { ZOMBIE_SPAWN_X } from '../../src/sim/types';
import type { Faction, SpellKey } from '../../src/sim/types';

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
      // The difficulty's match, with all ten cards of each side dealt (ruling R52).
      expect(config).toEqual({ ...battleConfig(11, side, skill), cards: ALL_CARDS });
      const income = DIFFICULTY[skill][side].income;
      const computer: Faction = side === 'plants' ? 'zombies' : 'plants';
      expect(config.incomeMultiplier[side]).toBe(income.human);
      expect(config.incomeMultiplier[computer]).toBe(income.computer);
    },
  );

  it('is kinder on Easy than on Medium, on both sides: more income for the human or more random moves by the computer', () => {
    // Phase 2 (Task 8): Toby's Easy leans on the computer's mistakes, Lukas's on his income.
    for (const side of ['plants', 'zombies'] as const) {
      const easy = new BattleController({ playerFaction: side, skill: 'easy', seed: 3 }).match.state.config;
      const medium = new BattleController({ playerFaction: side, skill: 'medium', seed: 3 }).match.state.config;
      const kinder = easy.incomeMultiplier[side] > medium.incomeMultiplier[side]
        || DIFFICULTY.easy[side].randomShare > DIFFICULTY.medium[side].randomShare;
      expect(kinder, side).toBe(true);
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
    c.hotkey('-'); // with ten cards every digit names one; these keys name none
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
    expect((c.hover({ lane: 2, col: 4 }, null) as PlacementPreview | null)?.mergeTargetId).toBe(made[1]?.id);
    // Column 6's middle is 1.1 from the nearest Brain Eater: a new one is sent instead.
    expect(c.hover({ lane: 2, col: 6 }, null)).toMatchObject({ ok: true, mergeTargetId: null });
    // Level 5 is not offered; the next nearest below level 5 is.
    if (made[1]) made[1].level = 5;
    expect((c.hover({ lane: 2, col: 4 }, null) as PlacementPreview | null)?.mergeTargetId).toBe(made[0]?.id);
    if (made[0]) made[0].level = 5;
    expect((c.hover({ lane: 2, col: 4 }, null) as PlacementPreview | null)?.mergeTargetId).toBeNull();
  });

  it('zombies: an exact hit on the player\'s own zombie of the selected type wins over a nearer one', () => {
    const { c, made } = zombieScene([{ key: 'brainEater', lane: 1, x: 5.5 }, { key: 'brainEater', lane: 1, x: 6.1 }]);
    c.select('brainEater');
    expect((c.hover({ lane: 1, col: 5 }, made[1]?.id ?? null) as PlacementPreview | null)?.mergeTargetId).toBe(made[1]?.id);
    // A hit on a zombie of another type falls back to the nearest of the selected type.
    const walker = spawnUnit(c.match.state, c.match.balance, 'veryFastWalker', 1, 5.4);
    expect((c.hover({ lane: 1, col: 5 }, walker.id) as PlacementPreview | null)?.mergeTargetId).toBe(made[0]?.id);
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

  it('aimAt: the player\'s own unit at the top level names no tile for its card (the ground decides), only for the shovel', () => {
    const c = make();
    c.match.state.players.plants.energy = 900;
    c.select('peashooter');
    c.click({ lane: 2, col: 3 }, null);
    c.step();
    const p = playerUnits(c)[0];
    if (p === undefined) throw new Error('no peashooter');
    p.level = 5;
    expect(c.aimAt(p.id)).toBeNull();
    c.toggleShovel();
    expect(c.aimAt(p.id)).toEqual({ lane: 2, col: 3 });
  });

  it('plants: a low tap on a level-5 plant\'s own tile with its card selected is refused max-level (no nearby merge for plants)', () => {
    const c = make();
    c.match.state.players.plants.energy = 900;
    c.select('peashooter');
    c.click({ lane: 2, col: 3 }, null);
    c.step();
    const p = playerUnits(c)[0];
    if (p === undefined) throw new Error('no peashooter');
    p.level = 5;
    c.match.state.players.plants.recharge = {};
    // The ray missed the model (a low tap): the ground names the plant's own tile.
    expect(c.aimAt(p.id)).toBeNull();
    expect(c.hover({ lane: 2, col: 3 }, null)).toMatchObject({ ok: false, mergeTargetId: p.id });
    const denied = c.hud.denied.value;
    expect(c.click({ lane: 2, col: 3 }, null)).toBe('max-level');
    expect(c.click({ lane: 2, col: 3 }, p.id)).toBe('max-level');
    expect(c.hud.denied.value).toBe(denied + 2);
    expect(c.step().some((e) => e.type === 'unitSpawned' || e.type === 'unitMerged')).toBe(false);
  });

  it('zombies: a direct tap on the player\'s own level-5 zombie of the selected card merges into a nearby one instead', () => {
    const { c, made } = zombieScene([{ key: 'brainEater', lane: 2, x: 4.5, level: 5 }, { key: 'brainEater', lane: 2, x: 4.9 }]);
    c.select('brainEater');
    expect(c.hover({ lane: 2, col: 4 }, made[0]?.id ?? null)).toMatchObject({ ok: true, mergeTargetId: made[1]?.id });
    const denied = c.hud.denied.value;
    expect(c.click({ lane: 2, col: 4 }, made[0]?.id ?? null)).toBeNull();
    c.step();
    expect(made[1]?.level).toBe(2);
    expect(made[0]?.level).toBe(5);
    expect(c.hud.denied.value).toBe(denied);
  });

  it('zombies: a direct tap on the player\'s own level-5 zombie with none nearby sends a new one', () => {
    const { c, made } = zombieScene([{ key: 'brainEater', lane: 2, x: 4.5, level: 5 }]);
    c.select('brainEater');
    expect(c.hover({ lane: 2, col: 4 }, made[0]?.id ?? null)).toMatchObject({ ok: true, mergeTargetId: null });
    expect(c.click({ lane: 2, col: 4 }, made[0]?.id ?? null)).toBeNull();
    const events = c.step();
    expect(events.some((e) => e.type === 'unitSpawned' && e.key === 'brainEater' && e.lane === 2)).toBe(true);
  });

  it('zombies: the merge reach is exactly 0.75 tile from the tapped tile\'s middle', () => {
    const { c, made } = zombieScene([{ key: 'brainEater', lane: 2, x: 5.25 }]);
    c.select('brainEater');
    expect((c.hover({ lane: 2, col: 4 }, null) as PlacementPreview | null)?.mergeTargetId).toBe(made[0]?.id); // 0.75: in reach
    if (made[0]) made[0].x = 5.26;
    expect((c.hover({ lane: 2, col: 4 }, null) as PlacementPreview | null)?.mergeTargetId).toBeNull(); // 0.76: out of reach
    if (made[0]) made[0].x = 3.75;
    expect((c.hover({ lane: 2, col: 4 }, null) as PlacementPreview | null)?.mergeTargetId).toBe(made[0]?.id); // 0.75 on the other side
  });

  it('zombies: a direct tap on the player\'s own zombie in another lane is ignored for the tapped lane', () => {
    const { c, made } = zombieScene([{ key: 'brainEater', lane: 1, x: 4.5 }]);
    c.select('brainEater');
    expect(c.hover({ lane: 2, col: 4 }, made[0]?.id ?? null)).toMatchObject({ ok: true, lane: 2, mergeTargetId: null });
  });
});

describe('BattleController with the full roster', () => {
  it.each(['plants', 'zombies'] as const)('as %s deals all ten cards to both sides, hotkeys 1 to 0', (side) => {
    const c = make(side);
    const opponent: Faction = side === 'plants' ? 'zombies' : 'plants';
    expect(c.match.state.config.cards[side]).toEqual(ALL_CARDS[side]);
    expect(c.match.state.config.cards[opponent]).toEqual(ALL_CARDS[opponent]);
    expect(c.hud.cards.value.map((card) => card.unit)).toEqual(ALL_CARDS[side]);
    expect(c.hud.cards.value.map((card) => card.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
    c.hotkey('0');
    expect(c.hud.selected.value).toBe(ALL_CARDS[side][9]);
  });

  it('places every card of each side by tap', () => {
    for (const side of ['plants', 'zombies'] as const) {
      const c = make(side);
      ALL_CARDS[side].forEach((key, i) => {
        c.match.state.players[side].energy = 9999;
        c.select(key);
        expect(c.hud.selected.value).toBe(key);
        expect(c.click({ lane: i % 5, col: side === 'plants' ? Math.floor(i / 5) : 9 }, null), key).toBeNull();
        c.step();
      });
      const placed = new Set(c.match.state.units.filter((u) => u.faction === side).map((u) => u.key));
      for (const key of ALL_CARDS[side]) {
        // A Cherry Bomber goes off a second after it is placed, so it may already be spent.
        if (key !== 'cherryBomber') expect(placed.has(key), key).toBe(true);
      }
    }
  });

  it.each([
    ['plants', 'easy'], ['plants', 'medium'], ['plants', 'hard'],
    ['zombies', 'easy'], ['zombies', 'medium'], ['zombies', 'hard'],
  ] as const)('as %s on %s the computer holding ten cards plays a whole match without throwing', { timeout: 60_000 }, (side, skill) => {
    for (const seed of [1, 2]) {
      const c = new BattleController({ playerFaction: side, skill, seed });
      for (let i = 0; i < 30 * 60 * 8 && c.hud.result.value === null; i++) {
        // The player taps a random-ish card now and then, so every unit and ability comes up.
        if (i % 45 === 0) {
          const cards = ALL_CARDS[side];
          c.select(cards[(i / 45) % cards.length] ?? null);
          c.click({ lane: (i / 45) % 5, col: side === 'plants' ? (i / 45) % 8 : 9 }, null);
        }
        expect(() => c.step()).not.toThrow();
      }
      expect(c.match.state.tick).toBeGreaterThan(0);
    }
  });
});

describe('BattleController hero power', () => {
  /** The player's hero ready now, with the hud caught up. */
  const charged = (side: Faction = 'plants'): BattleController => {
    const c = make(side);
    c.match.state.players[side].heroTimer = 1;
    c.step();
    return c;
  };

  it('heroLane queues the hero command like click, and it fires on the next step', () => {
    const c = charged();
    const z = c.match.state.units.find((u) => u.faction === 'zombies');
    expect(c.hud.hero.value).toEqual({ ready: true, fraction: 1 });
    expect(c.heroLane(2)).toBeNull();
    expect(c.heroLane(3)).toBe('ignored'); // one command per tick
    const events = c.step();
    expect(events).toContainEqual({ type: 'heroUsed', faction: 'plants', lane: 2 });
    expect(z === undefined || z.lane !== 2 || z.hp < 400).toBe(true);
    expect(c.hud.hero.value.ready).toBe(false);
  });

  it('a refusal is counted as a denial: charging, bad lane', () => {
    const c = make();
    const denied = c.hud.denied.value;
    expect(c.heroLane(2)).toBe('hero-charging');
    c.match.state.players.plants.heroTimer = 0;
    expect(c.heroLane(7)).toBe('bad-lane');
    expect(c.hud.denied.value).toBe(denied + 2);
  });

  it('obeys pause and the end of the match like click', () => {
    const c = charged('zombies');
    c.setPaused(true);
    const denied = c.hud.denied.value;
    expect(c.heroLane(1)).toBe('ignored');
    c.setPaused(false);
    c.match.state.baseHp.plants = 0;
    c.step();
    expect(c.heroLane(1)).toBe('match-over');
    expect(c.hud.denied.value).toBe(denied);
  });

  it('hud.hero charges from 0 to 1 over the first 45 s, then over 60 s after a use', () => {
    const c = make();
    expect(c.hud.hero.value).toEqual({ ready: false, fraction: 0 });
    for (let i = 0; i < seconds(22.5); i++) c.step();
    expect(c.hud.hero.value.fraction).toBeCloseTo(0.5, 5);
    for (let i = 0; i < seconds(22.5); i++) c.step();
    expect(c.hud.hero.value).toEqual({ ready: true, fraction: 1 });
    c.heroLane(0);
    c.step();
    expect(c.hud.hero.value.fraction).toBeCloseTo(1 / seconds(60), 9);
    for (let i = 0; i < seconds(30) - 1; i++) c.step();
    expect(c.hud.hero.value.fraction).toBeCloseTo(0.5, 9);
  });

  it('hud.hero is only written when it changes', () => {
    const c = make();
    c.match.state.players.plants.heroTimer = 0;
    c.step();
    const ready = c.hud.hero.value;
    c.step();
    c.step();
    expect(c.hud.hero.value).toBe(ready);
  });
});

describe('BattleController spells', () => {
  /** A plants player dealt Thunderbolt and Sun Shower, both ready, the hud caught up. */
  const dealt = (side: Faction = 'plants'): BattleController => {
    const c = make(side);
    c.match.state.players[side].spells = side === 'plants'
      ? [{ key: 'thunderbolt', timer: 1 }, { key: 'sunShower', timer: 1 }]
      : [{ key: 'meteor', timer: 1 }, { key: 'brainFeast', timer: 1 }];
    c.step();
    return c;
  };

  it('hud.spells shows the dealt two, charging over the first 20 s, then over the cooldown after a cast', () => {
    const c = make();
    const keys = c.match.state.players.plants.spells.map((x) => x.key);
    expect(c.hud.spells.value).toEqual(keys.map((key) => ({ key, ready: false, fraction: 0 })));
    const half = seconds(BALANCE.spells[keys[0] as SpellKey].firstReady) / 2; // every spell has the same first wait
    for (let i = 0; i < half; i++) c.step();
    expect(c.hud.spells.value[0]?.fraction).toBeCloseTo(0.5, 9);
    const before = c.hud.spells.value;
    c.setPaused(true);
    c.step();
    expect(c.hud.spells.value).toBe(before); // only written when it changes
    c.setPaused(false);
    for (let i = 0; i < half; i++) c.step();
    expect(c.hud.spells.value.every((x) => x.ready && x.fraction === 1)).toBe(true);

    const d = dealt();
    d.selectSpell('thunderbolt');
    d.click({ lane: 0, col: 5 }, null);
    d.step();
    expect(d.hud.spells.value[0]).toMatchObject({ key: 'thunderbolt', ready: false });
    expect(d.hud.spells.value[0]?.fraction).toBeCloseTo(1 / seconds(BALANCE.spells.thunderbolt.cooldown), 12);
  });

  it('picking an aimed spell clears the card, the shovel and the hero; a tap casts it and puts it down', () => {
    const c = dealt();
    c.toggleShovel();
    c.selectSpell('thunderbolt');
    expect(c.hud.spellSelected.value).toBe('thunderbolt');
    expect(c.hud.selected.value).toBeNull();
    expect(c.hud.shovel.value).toBe(false);
    expect(c.click({ lane: 2, col: 6 }, null)).toBeNull();
    expect(c.hud.spellSelected.value).toBeNull();
    const events = c.step();
    expect(events).toContainEqual({ type: 'spellCast', faction: 'plants', spell: 'thunderbolt', lane: 2, col: 6, size: 2 });
  });

  it('a card, the shovel, the hero or Escape puts the spell down, and tapping the picked spell again does too', () => {
    const c = dealt();
    c.selectSpell('thunderbolt');
    c.select('peashooter');
    expect(c.hud.spellSelected.value).toBeNull();
    c.selectSpell('thunderbolt');
    c.toggleShovel();
    expect(c.hud.spellSelected.value).toBeNull();
    c.toggleShovel();
    c.selectSpell('thunderbolt');
    c.hotkey('Escape');
    expect(c.hud.spellSelected.value).toBeNull();
    c.selectSpell('thunderbolt');
    c.selectSpell('thunderbolt');
    expect(c.hud.spellSelected.value).toBeNull();
    c.match.state.players.plants.heroTimer = 0;
    c.selectSpell('thunderbolt');
    c.selectHero(true);
    expect(c.hud.spellSelected.value).toBeNull();
    expect(c.hud.heroSelected.value).toBe(true);
    c.selectSpell('thunderbolt');
    expect(c.hud.heroSelected.value).toBe(false);
    expect(c.hud.spellSelected.value).toBe('thunderbolt');
  });

  it('the hero, once picked, clears card and shovel, and a lawn tap fires it down that lane', () => {
    const c = make();
    c.match.state.players.plants.heroTimer = 0;
    c.selectHero(true);
    expect(c.hud.heroSelected.value).toBe(true);
    expect(c.hud.selected.value).toBeNull();
    expect(c.click({ lane: 3, col: 2 }, null)).toBeNull();
    expect(c.hud.heroSelected.value).toBe(false);
    expect(c.step()).toContainEqual({ type: 'heroUsed', faction: 'plants', lane: 3 });
  });

  it('a charging hero or spell is refused when picked, counted as a denial', () => {
    const c = make();
    const key = c.match.state.players.plants.spells[0]?.key;
    if (key === undefined) throw new Error('no spell dealt');
    const denied = c.hud.denied.value;
    c.selectSpell(key);
    c.selectHero(true);
    expect(c.hud.spellSelected.value).toBeNull();
    expect(c.hud.heroSelected.value).toBe(false);
    expect(c.hud.denied.value).toBe(denied + 2);
    expect(c.hud.selected.value).not.toBeNull(); // the card stays picked
  });

  it('an un-aimed spell casts on the button tap itself', () => {
    const c = dealt('zombies');
    const brains = c.match.state.players.zombies.energy;
    c.selectSpell('brainFeast');
    expect(c.hud.spellSelected.value).toBeNull();
    const events = c.step();
    expect(events).toContainEqual(expect.objectContaining({ type: 'spellCast', spell: 'brainFeast', size: 0 }));
    expect(c.match.state.players.zombies.energy).toBeGreaterThanOrEqual(brains + (BALANCE.spells.brainFeast.amount ?? 0));
  });

  it('a spell not dealt is ignored, and paused or over nothing is picked', () => {
    const c = dealt();
    c.selectSpell('vines');
    expect(c.hud.spellSelected.value).toBeNull();
    c.setPaused(true);
    c.selectSpell('thunderbolt');
    expect(c.hud.spellSelected.value).toBeNull();
  });

  it('hover shows the area of the picked spell and whether the tap would cast', () => {
    const c = dealt();
    c.selectSpell('thunderbolt');
    expect(c.hover({ lane: 4, col: 9 }, null)).toEqual({
      spell: 'thunderbolt', lane: 4, col: 9, ok: true,
      tiles: [{ lane: 3, col: 8 }, { lane: 3, col: 9 }, { lane: 4, col: 8 }, { lane: 4, col: 9 }],
    });
    expect(c.hover(null, null)).toBeNull();
    c.match.state.players.plants.spells[0]!.timer = 5;
    expect(c.hover({ lane: 0, col: 0 }, null)).toMatchObject({ ok: false });
  });
});

describe('BattleController powers wiring (wiring B)', () => {
  /** Hero and both spells (one aimed, one not) ready; the hud caught up. */
  const ready = (side: Faction = 'plants'): BattleController => {
    const c = make(side);
    c.match.state.players[side].heroTimer = 1;
    c.match.state.players[side].spells = side === 'plants'
      ? [{ key: 'thunderbolt', timer: 1 }, { key: 'sunShower', timer: 1 }]
      : [{ key: 'meteor', timer: 1 }, { key: 'brainFeast', timer: 1 }];
    c.step();
    return c;
  };
  const picked = (c: BattleController) => ({
    card: c.hud.selected.value, shovel: c.hud.shovel.value, hero: c.hud.heroSelected.value, spell: c.hud.spellSelected.value,
  });

  it('heroLane fired with a spell picked puts the spell down too', () => {
    const c = ready();
    c.selectSpell('thunderbolt');
    expect(c.hud.spellSelected.value).toBe('thunderbolt');
    expect(c.heroLane(1)).toBeNull();
    expect(picked(c)).toMatchObject({ hero: false, spell: null });
  });

  it('an un-aimed cast puts the hero (and any aimed spell) down', () => {
    const c = ready();
    c.toggleHero();
    expect(c.hud.heroSelected.value).toBe(true);
    c.selectSpell('sunShower');
    expect(picked(c)).toMatchObject({ hero: false, spell: null });
    expect(c.step()).toContainEqual(expect.objectContaining({ type: 'spellCast', spell: 'sunShower' }));
  });

  it('card, shovel, hero and spell are picked one at a time, in every direction', () => {
    const c = ready();
    const pick: Record<string, () => void> = {
      card: () => c.select('peashooter'),
      shovel: () => { if (!c.hud.shovel.peek()) c.toggleShovel(); },
      hero: () => { if (!c.hud.heroSelected.peek()) c.toggleHero(); },
      spell: () => { if (c.hud.spellSelected.peek() === null) c.selectSpell('thunderbolt'); },
    };
    const on = (k: string): boolean => {
      const p = picked(c);
      return k === 'card' ? p.card !== null : k === 'shovel' ? p.shovel : k === 'hero' ? p.hero : p.spell !== null;
    };
    for (const a of Object.keys(pick)) {
      for (const b of Object.keys(pick)) {
        if (a === b) continue;
        pick[a]?.();
        expect(on(a)).toBe(true);
        pick[b]?.();
        expect(on(b)).toBe(true);
        expect(on(a)).toBe(false);
      }
    }
  });

  it('toggleHero: picks, and a second press puts it down; while charging it is refused with a denial', () => {
    const c = ready();
    c.toggleHero();
    expect(c.hud.heroSelected.value).toBe(true);
    c.toggleHero();
    expect(c.hud.heroSelected.value).toBe(false);
    const d = make();
    const denied = d.hud.denied.value;
    d.toggleHero();
    expect(d.hud.heroSelected.value).toBe(false);
    expect(d.hud.denied.value).toBe(denied + 1);
  });

  it('a spell still charging is refused with a denial, aimed or not', () => {
    const c = make();
    c.match.state.players.plants.spells = [{ key: 'thunderbolt', timer: 9 }, { key: 'sunShower', timer: 9 }];
    const denied = c.hud.denied.value;
    c.selectSpell('thunderbolt');
    c.selectSpell('sunShower');
    expect(c.hud.denied.value).toBe(denied + 2);
    expect(c.hud.spellSelected.value).toBeNull();
  });

  it('hover with the hero picked names the lane under the pointer', () => {
    const c = ready();
    c.toggleHero();
    expect(c.hover({ lane: 3, col: 6 }, null)).toEqual({ hero: true, lane: 3, ok: true });
    expect(c.hover(null, null)).toBeNull();
  });

  it('keys: H picks or drops the hero, Q and W the first and second spell', () => {
    const c = ready();
    c.hotkey('h');
    expect(c.hud.heroSelected.value).toBe(true);
    c.hotkey('H');
    expect(c.hud.heroSelected.value).toBe(false);
    c.hotkey('q');
    expect(c.hud.spellSelected.value).toBe('thunderbolt');
    c.hotkey('Q');
    expect(c.hud.spellSelected.value).toBeNull();
    c.hotkey('w'); // Sun Shower: cast at once
    expect(c.step()).toContainEqual(expect.objectContaining({ type: 'spellCast', spell: 'sunShower' }));
  });

  it('a tap on the lawn with the hero picked fires it down that lane; with an aimed spell, casts it there', () => {
    const c = ready();
    c.toggleHero();
    expect(c.click({ lane: 4, col: 2 }, null)).toBeNull();
    expect(c.step()).toContainEqual({ type: 'heroUsed', faction: 'plants', lane: 4 });
    c.selectSpell('thunderbolt');
    expect(c.click({ lane: 1, col: 5 }, null)).toBeNull();
    expect(c.step()).toContainEqual(expect.objectContaining({ type: 'spellCast', spell: 'thunderbolt', lane: 1, col: 5 }));
  });
});
