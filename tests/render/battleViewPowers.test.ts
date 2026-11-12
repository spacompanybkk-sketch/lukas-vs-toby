import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { BattleView } from '../../src/render/battle/BattleView';
import type { Feel } from '../../src/render/battle/types';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import { seededRandom } from '../../src/render/world/boxes';
import { Lawn } from '../../src/render/world/Lawn';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { spellArea } from '../../src/sim/spells';
import type { Faction, SimEvent, SpellKey, Unit, UnitKey } from '../../src/sim/types';
import { allocationsIn } from './allocations';

// Wiring B: hero powers and spells on the lawn, from their events and from the state a late view joins.

const DT = 1 / 60;

function setUp(side: Faction = 'plants') {
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 16 / 10, 2, 200);
  camera.position.set(5, 12, 14);
  camera.lookAt(5, 0, 2.5);
  camera.updateMatrixWorld(true);
  const lawn = new Lawn();
  const particles = new Particles();
  const fx = new Effects(particles, seededRandom(7));
  scene.add(lawn.group, particles.object, fx.group);
  const before = [...scene.children];
  const view = new BattleView(scene, camera, lawn, fx, side);
  const feels: Feel[] = [];
  view.onFeel = (f) => feels.push(f);
  const config = defaultConfig(7);
  config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
  const match = new Match(config);
  let time = 0;
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      time += DT;
      view.frame(match.state, 0, DT, time);
      fx.update(DT, camera);
    }
  };
  const spawn = (key: UnitKey, lane: number, x: number): Unit => {
    const events: SimEvent[] = [];
    const u = spawnUnit(match.state, BALANCE, key, lane, x, events);
    view.applyEvents(events, match.state);
    return u;
  };
  const apply = (...events: SimEvent[]): void => view.applyEvents(events, match.state);
  return { scene, camera, view, match, run, lawn, fx, before, spawn, apply, feels };
}

/** A rock as the simulation casts it (Rock Wall): its unit and the events of that step. */
function castRock(ctx: ReturnType<typeof setUp>, lane: number, col: number): Unit {
  const events: SimEvent[] = [{ type: 'spellCast', faction: 'plants', spell: 'rockWall', lane, col, size: 1 }];
  const rock = spawnUnit(ctx.match.state, BALANCE, 'rock', lane, col + 0.5, events);
  rock.hp = rock.maxHp = 800;
  rock.expires = 360;
  ctx.view.applyEvents(events, ctx.match.state);
  return rock;
}

describe('BattleView hero powers', () => {
  it('Mega Mower: the mower runs the lane, the camera pushes in on it, the zombies it passes flash, 90 ms hit-stop at the first', () => {
    const ctx = setUp();
    const z1 = ctx.spawn('brainEater', 2, 4.5);
    const z2 = ctx.spawn('brainEater', 2, 7.5);
    const other = ctx.spawn('brainEater', 3, 5.5);
    ctx.run(0.6);
    const flashed: number[] = [];
    for (const u of [z1, z2, other]) {
      const v = ctx.view.unit(u.id);
      if (v) vi.spyOn(v, 'flash').mockImplementation(() => { flashed.push(u.id); });
    }
    const banners: Faction[] = [];
    ctx.view.onHero = (f) => banners.push(f);
    ctx.apply({ type: 'heroUsed', faction: 'plants', lane: 2 });
    expect(banners).toEqual(['plants']);
    expect(ctx.view.heroShows).toBe(1);
    expect(ctx.feels.some((f) => f.punch !== undefined && f.focusZ === 2.5)).toBe(true);
    ctx.run(0.2);
    expect(flashed).toEqual([]); // the mower is still behind them
    ctx.run(0.8);
    expect(flashed.sort()).toEqual([z1.id, z2.id].sort());
    expect(ctx.feels.filter((f) => f.hitStop === 0.09)).toHaveLength(1);
    expect(ctx.view.heroShows).toBe(0);
  });

  it('Bone Storm comes down the lane from the zombies\' end and flashes the plants in it', () => {
    const ctx = setUp('zombies');
    const p = ctx.spawn('peashooter', 1, 2.5);
    ctx.run(0.6);
    const v = ctx.view.unit(p.id);
    const flash = vi.spyOn(v as NonNullable<typeof v>, 'flash');
    ctx.apply({ type: 'heroUsed', faction: 'zombies', lane: 1 });
    ctx.run(1.5);
    expect(flash).toHaveBeenCalledTimes(1);
    expect(ctx.view.heroShows).toBe(0);
  });

  it('a hero show runs without allocating per frame', () => {
    const ctx = setUp();
    ctx.spawn('brainEater', 2, 4.5);
    ctx.run(0.3);
    ctx.apply({ type: 'heroUsed', faction: 'plants', lane: 2 });
    ctx.run(DT * 3);
    const counts = allocationsIn(() => {
      for (let i = 0; i < 20; i++) ctx.view.frame(ctx.match.state, 0.5, DT, 5 + i * DT);
    });
    expect(counts).toEqual({});
  });
});

describe('BattleView spells', () => {
  const aimed: [SpellKey, Faction][] = [
    ['thunderbolt', 'plants'], ['vines', 'plants'], ['healingRain', 'plants'],
    ['meteor', 'zombies'], ['fog', 'zombies'], ['frenzy', 'zombies'], ['graveRise', 'zombies'],
  ];
  for (const [spell, faction] of aimed) {
    it(`${spell}: spellCast starts its show over the simulation's own area`, () => {
      const ctx = setUp();
      const cast = vi.spyOn(ctx.view.spells, 'cast');
      const size = BALANCE.spells[spell].size;
      ctx.apply({ type: 'spellCast', faction, spell, lane: 4, col: 9, size });
      expect(cast).toHaveBeenCalledWith(spell, 4, 9, size);
      expect(ctx.view.spells.active).toBe(1);
      ctx.run(6);
      expect(ctx.view.spells.active).toBe(0);
    });
  }

  it('Sun Shower and Brain Feast: the show, and the income as "+N" in the side\'s colour with a token to the counter', () => {
    const ctx = setUp();
    const text = vi.spyOn(ctx.fx, 'floatText');
    const tokens: number[] = [];
    ctx.view.onEnergyToken = (_side, _from, amount) => tokens.push(amount);
    ctx.apply(
      { type: 'spellCast', faction: 'plants', spell: 'sunShower', lane: 0, col: 0, size: 0 },
      { type: 'energyGained', faction: 'plants', amount: 150, source: 'spell', unitId: null, lane: 2, x: 0 },
    );
    expect(ctx.view.spells.active).toBe(1);
    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0]?.[1]).toBe('+150');
    // Over the shower, not at the lawn's very edge.
    expect((text.mock.calls[0]?.[0] as Vector3).x).toBeGreaterThan(2);
    expect(tokens).toEqual([150]);
    ctx.apply({ type: 'energyGained', faction: 'zombies', amount: 200, source: 'spell', unitId: null, lane: 2, x: 9.5 });
    expect(tokens).toEqual([150]); // the computer's income flies to no counter of the player's
  });

  it('Frenzy\'s haste shows as the haste mark, from the event and from the state', () => {
    const ctx = setUp();
    const z = ctx.spawn('brainEater', 2, 6.5);
    z.haste = 180;
    ctx.apply({ type: 'statusApplied', unitId: z.id, status: 'haste', ticks: 180, sourceId: null });
    expect(ctx.view.marks.has(z.id, 'haste')).toBe(true);
    z.haste = 0;
    ctx.apply({ type: 'statusEnded', unitId: z.id, status: 'haste' });
    expect(ctx.view.marks.has(z.id, 'haste')).toBe(false);
    const late = setUp();
    const y = spawnUnit(late.match.state, BALANCE, 'brainEater', 1, 7.5);
    y.haste = 90;
    late.apply();
    expect(late.view.marks.has(y.id, 'haste')).toBe(true);
  });

  it('Grave Rise minions claw up like raised ones', () => {
    const ctx = setUp();
    const events: SimEvent[] = [{ type: 'spellCast', faction: 'zombies', spell: 'graveRise', lane: 3, col: 6, size: 1 }];
    for (let i = 0; i < 3; i++) spawnUnit(ctx.match.state, BALANCE, 'boneMinion', 3, 6.5, events);
    ctx.view.applyEvents(events, ctx.match.state);
    const minions = ctx.match.state.units.filter((u) => u.key === 'boneMinion');
    expect(minions).toHaveLength(3);
    for (const m of minions) expect(ctx.view.unit(m.id)?.model.clip).toBe('spawn');
  });

  it('the area of an aimed spell matches the simulation\'s at every edge', async () => {
    const { spellArea: drawn } = await import('../../src/render/battle/SpellFx');
    const key = (t: { lane: number; col: number }): string => `${t.lane},${t.col}`;
    for (const [spell, faction] of aimed) {
      const size = BALANCE.spells[spell].size;
      for (let lane = 0; lane < 5; lane++) {
        for (let col = 0; col < 10; col++) {
          expect(drawn(spell, lane, col, size).map(key).sort()).toEqual(spellArea(faction, size, lane, col).map(key).sort());
        }
      }
    }
  });
});

describe('BattleView Rock Wall', () => {
  it('draws the rock (no unit model), cracks it as it is bitten, shows its health bar, and crumbles it when bitten through', () => {
    const ctx = setUp();
    const rock = castRock(ctx, 2, 4);
    expect(ctx.view.unit(rock.id)).toBeUndefined();
    expect(ctx.view.spells.rocks).toBe(1);
    ctx.run(0.6);
    const setRock = vi.spyOn(ctx.view.spells, 'setRock');
    rock.hp = 300;
    ctx.apply({ type: 'unitDamaged', unitId: rock.id, amount: 500, hp: 300 });
    expect(setRock).toHaveBeenCalledWith(2, 4, 300 / 800);
    ctx.run(DT);
    expect(ctx.view.barsShown).toBe(1);
    const crumble = vi.spyOn(ctx.view.spells, 'crumbleRock');
    ctx.match.state.units.splice(ctx.match.state.units.indexOf(rock), 1);
    ctx.apply({ type: 'unitDied', unitId: rock.id, key: 'rock', faction: 'plants', lane: 2, x: 4.5, level: 1, cause: 'damage' });
    expect(crumble).toHaveBeenCalledWith(2, 4);
    expect(ctx.view.spells.rocks).toBe(0);
    ctx.run(DT);
    expect(ctx.view.barsShown).toBe(0);
  });

  it('crumbles when its time is up ("spent") and when shovelled', () => {
    const ctx = setUp();
    const a = castRock(ctx, 1, 2);
    const b = castRock(ctx, 3, 5);
    expect(ctx.view.spells.rocks).toBe(2);
    ctx.match.state.units.length = 0;
    ctx.apply(
      { type: 'unitDied', unitId: a.id, key: 'rock', faction: 'plants', lane: 1, x: 2.5, level: 1, cause: 'spent' },
      { type: 'unitDied', unitId: b.id, key: 'rock', faction: 'plants', lane: 3, x: 5.5, level: 1, cause: 'shovel' },
    );
    expect(ctx.view.spells.rocks).toBe(0);
  });

  it('can be picked by a tap on it (for the shovel)', () => {
    const ctx = setUp();
    const rock = castRock(ctx, 2, 4);
    ctx.run(0.6);
    const at = new Vector3(4.5, 0.35, 2.5).project(ctx.camera);
    expect(ctx.view.unitHitByRay(at.x, at.y)).toBe(rock.id);
    expect(ctx.view.unitNearRay(at.x, at.y, { width: 1600, height: 1000 })).toBe(rock.id);
  });

  it('a view that joins late shows a rock already standing, with no unit model and no error', () => {
    const ctx = setUp();
    const rock = spawnUnit(ctx.match.state, BALANCE, 'rock', 0, 1.5);
    expect(() => ctx.apply()).not.toThrow();
    expect(ctx.view.unit(rock.id)).toBeUndefined();
    expect(ctx.view.spells.rocks).toBe(1);
  });

  it('leaves the scene as it found it when disposed with a rock, a show and a hero running', () => {
    const ctx = setUp();
    castRock(ctx, 2, 4);
    ctx.apply({ type: 'spellCast', faction: 'zombies', spell: 'fog', lane: 1, col: 3, size: 2 });
    ctx.apply({ type: 'heroUsed', faction: 'plants', lane: 0 });
    ctx.run(0.2);
    ctx.view.dispose();
    expect(ctx.scene.children).toEqual(ctx.before);
  });
});

describe('BattleView aiming', () => {
  it('a spell\'s area highlights in the side\'s colour, red when not allowed; the hero\'s lane highlights; null clears', () => {
    const ctx = setUp();
    const show = vi.spyOn(ctx.view.spells, 'showArea');
    const lane = vi.spyOn(ctx.lawn, 'highlightLane');
    const tiles = spellArea('plants', 2, 1, 3);
    ctx.view.setPreview({ spell: 'thunderbolt', tiles, ok: true });
    expect(show).toHaveBeenLastCalledWith(tiles, 'plants', 'ok');
    ctx.view.setPreview({ spell: 'thunderbolt', tiles, ok: false });
    expect(show).toHaveBeenLastCalledWith(tiles, 'plants', 'bad');
    ctx.view.setPreview({ hero: true, lane: 3, ok: true });
    expect(show).toHaveBeenLastCalledWith(null);
    expect(lane).toHaveBeenLastCalledWith(3, 'ok', 'plants');
    ctx.view.setPreview(null);
    expect(lane).toHaveBeenLastCalledWith(null, 'ok');
    expect(show).toHaveBeenLastCalledWith(null);
  });
});
