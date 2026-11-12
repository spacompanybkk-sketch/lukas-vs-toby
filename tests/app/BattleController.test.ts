import { describe, expect, it } from 'vitest';
import { BattleController } from '../../src/app/BattleController';
import { DIFFICULTY, battleConfig } from '../../src/ai/difficulty';
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
