import { describe, expect, it } from 'vitest';
import { levelById } from '../../src/adventure/levels';
import { BattleController } from '../../src/app/BattleController';
import { levelOptions, prepareLevel } from '../../src/app/levelSession';
import { stepsToTeach } from '../../src/app/tutorial';
import { newSave } from '../../src/progress/save';
import { spawnUnit } from '../../src/sim/spawn';
import { COLS, LANES, PLANT_COLS } from '../../src/sim/types';
import type { Faction } from '../../src/sim/types';
import { allocationsIn } from '../render/allocations';
import { SAMPLE_LAWNS } from '../../src/render/world/TwistTiles';
import { cloneLawn } from '../../src/sim/lawn';

// UX fix A: while a card is picked, the tiles (zombies: the lanes' spawn end) a tap would be
// accepted on light up, worked out by the match's own `check`, again only when the pick or the
// board changed.

function quick(side: Faction): BattleController {
  const c = new BattleController({ playerFaction: side, skill: 'easy', seed: 4 });
  c.match.state.players[side].energy = 1000;
  return c;
}

function level(id: string, teach = false): BattleController {
  const def = levelById(id)!;
  const save = newSave(def.side === 'plants' ? 'p01' : 'p02', 'Kid', 'peashooter', 0);
  return new BattleController(levelOptions({ ...prepareLevel(def, save, 3), teach: teach ? stepsToTeach(def.teaches, save) : [] }));
}

/** The lit tiles, as "lane,col". */
function lit(c: BattleController): string[] {
  c.placeTiles();
  const out: string[] = [];
  for (let lane = 0; lane < LANES; lane++) for (let col = 0; col < COLS; col++) if (c.placeable[lane * COLS + col] === 1) out.push(`${lane},${col}`);
  return out;
}

const every = (cols: number[]): string[] => Array.from({ length: LANES }, (_, lane) => cols.map((col) => `${lane},${col}`)).flat();
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('where the picked card may go', () => {
  it('plants: every plant column of every lane, but not a tile another plant stands on; its own kind (a merge) stays lit', () => {
    const c = quick('plants');
    c.select('peashooter');
    expect(lit(c)).toEqual(every(range(PLANT_COLS)));
    spawnUnit(c.match.state, c.match.balance, 'walnutBomb', 2, 3.5);
    spawnUnit(c.match.state, c.match.balance, 'peashooter', 1, 0.5);
    const now = lit(c);
    expect(now).not.toContain('2,3');
    expect(now).toContain('1,0');
    expect(now).toHaveLength(LANES * PLANT_COLS - 1);
  });

  it('never lights a rock tile of a Desert lawn (the match refuses rocks)', () => {
    const c = quick('plants');
    (c.match.state.config as { lawn: unknown }).lawn = cloneLawn(SAMPLE_LAWNS.desert);
    c.select('peashooter');
    const rocks = SAMPLE_LAWNS.desert.rocks.map((t) => `${Math.floor(t / PLANT_COLS)},${t % PLANT_COLS}`);
    const now = lit(c);
    for (const r of rocks) expect(now).not.toContain(r);
    expect(now).toHaveLength(LANES * PLANT_COLS - rocks.length);
  });

  it('agrees with the match: each lit tile is a tap the controller accepts, each dark one a tap it refuses', () => {
    const c = quick('plants');
    c.select('sunflower');
    spawnUnit(c.match.state, c.match.balance, 'peashooter', 4, 6.5);
    const on = new Set(lit(c));
    for (let lane = 0; lane < LANES; lane++) {
      for (let col = 0; col < COLS; col++) {
        const probe = quick('plants');
        probe.select('sunflower');
        spawnUnit(probe.match.state, probe.match.balance, 'peashooter', 4, 6.5);
        expect(probe.click({ lane, col }, null) === null, `${lane},${col}`).toBe(on.has(`${lane},${col}`));
      }
    }
  });

  it('zombies: the spawn end of each lane', () => {
    const c = quick('zombies');
    c.select('brainEater');
    expect(lit(c)).toEqual(every([COLS - 1]));
  });

  it('nothing picked, the shovel, a power picked, a card too dear, a paused or decided match: nothing lit', () => {
    const c = quick('plants');
    c.select(null);
    expect(lit(c)).toEqual([]);
    c.select('peashooter');
    c.toggleShovel();
    expect(lit(c)).toEqual([]);
    c.select('peashooter');
    c.match.state.players.plants.heroTimer = 0;
    c.selectHero(true);
    expect(lit(c)).toEqual([]);
    c.selectHero(false);
    c.select('peashooter');
    expect(lit(c)).toHaveLength(LANES * PLANT_COLS);
    c.match.state.players.plants.energy = 0;
    expect(lit(c)).toEqual([]);
    c.match.state.players.plants.energy = 1000;
    c.setPaused(true);
    expect(lit(c)).toEqual([]);
    c.setPaused(false);
    c.match.state.baseHp.zombies = 0;
    c.step();
    expect(lit(c)).toEqual([]);
  });

  it('a belt card: free, on any plant tile (no energy needed)', () => {
    const c = level('p1-5');
    c.step();
    expect(lit(c)).toEqual([]);
    c.selectBelt(0);
    expect(lit(c)).toEqual(every(range(PLANT_COLS)));
  });

  it('under the glove only the step\'s own tile lights (taps elsewhere wait)', () => {
    const c = level('p1-1', true);
    c.step();
    c.select('peashooter');
    expect(c.tutorial!.holding).toBe(true);
    expect(lit(c)).toEqual(['2,1']);
  });

  it('cheap on the iPad: nothing worked out again (and nothing allocated) while nothing changes; a pick or a new unit works it out once', () => {
    const c = quick('plants');
    c.select('peashooter');
    const v = c.placeTiles();
    const n = c.placeWorkouts;
    const allocs = allocationsIn(() => { for (let i = 0; i < 300; i++) c.placeTiles(); });
    expect(allocs).toEqual({});
    expect(c.placeWorkouts).toBe(n);
    expect(c.placeTiles()).toBe(v);
    c.select('sunflower');
    c.placeTiles();
    expect(c.placeWorkouts).toBe(n + 1);
    // Same tiles: the version (what the view redraws on) stays.
    expect(c.placeTiles()).toBe(v);
    spawnUnit(c.match.state, c.match.balance, 'walnutBomb', 0, 0.5);
    expect(c.placeTiles()).not.toBe(v);
    expect(c.placeWorkouts).toBe(n + 2);
  });
});
