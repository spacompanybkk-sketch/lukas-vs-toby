import { Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createBasicBot } from '../../src/ai/basicBot';
import { BALANCE } from '../../src/data/balance';
import { BattleView, GHOST_RENDER_ORDER, PICK_TOLERANCE_PX } from '../../src/render/battle/BattleView';
import { HealthBars, QUADS_PER_UNIT } from '../../src/render/battle/HealthBars';
import { worldToClient } from '../../src/render/coords';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import { seededRandom } from '../../src/render/world/boxes';
import { Lawn } from '../../src/render/world/Lawn';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { Command, SimEvent } from '../../src/sim/types';

const DT = 1 / 60;

function setUp() {
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
  const view = new BattleView(scene, camera, lawn, fx, 'plants');
  const match = new Match(defaultConfig(7));
  let time = 0;
  /** `seconds` of frames at 60 a second, the effects moved as the scene owner would. */
  const run = (seconds: number, alpha = 0): void => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      time += DT;
      view.frame(match.state, alpha, DT, time);
      fx.update(DT, camera);
    }
  };
  return { scene, camera, view, match, run, lawn, fx, before };
}

function unitObject(scene: Scene, id: number): Object3D | undefined {
  return scene.getObjectByName(`unit-${id}`);
}

function countNamed(scene: Scene, prefix: string): number {
  let n = 0;
  scene.traverse((o) => {
    if (o.name.startsWith(prefix) && o.parent !== null) n++;
  });
  return n;
}

/** Like `countNamed`, but only objects drawn now (they and every parent visible): the spells' pools keep theirs hidden in the scene. */
function countShown(scene: Scene, prefix: string): number {
  let n = 0;
  scene.traverse((o) => {
    if (!o.name.startsWith(prefix) || o.parent === null) return;
    for (let p: typeof o | null = o; p; p = p.parent) if (!p.visible) return;
    n++;
  });
  return n;
}

describe('BattleView', () => {
  it('adds a unit-<id> object when a unit spawns', () => {
    const { scene, view, match } = setUp();
    const events: SimEvent[] = [];
    const unit = spawnUnit(match.state, BALANCE, 'peashooter', 2, 3.5, events);
    view.applyEvents(events, match.state);
    expect(view.unitCount).toBe(1);
    const object = unitObject(scene, unit.id);
    expect(object).toBeDefined();
    expect(object?.scale.x).toBe(1);
  });

  it('removes a dead unit once 0.6 s of frames have passed', () => {
    const { scene, view, match, run } = setUp();
    const events: SimEvent[] = [];
    const unit = spawnUnit(match.state, BALANCE, 'brainEater', 1, 6, events);
    view.applyEvents(events, match.state);
    run(0.6);
    match.state.units.splice(match.state.units.indexOf(unit), 1);
    view.applyEvents(
      [{ type: 'unitDied', unitId: unit.id, key: unit.key, faction: unit.faction, lane: 1, x: 6, level: 1, cause: 'damage' }],
      match.state,
    );
    run(0.3);
    expect(unitObject(scene, unit.id)).toBeDefined();
    run(0.3);
    expect(unitObject(scene, unit.id)).toBeUndefined();
    expect(view.unitCount).toBe(0);
  });

  it('swaps to the merged level, scale 1.16 at level 3, after the 0.6 s merge motion', () => {
    const { scene, view, match, run } = setUp();
    const events: SimEvent[] = [];
    const unit = spawnUnit(match.state, BALANCE, 'peashooter', 0, 1.5, events);
    view.applyEvents(events, match.state);
    run(0.5);
    unit.level = 3;
    view.applyEvents([{ type: 'unitMerged', unitId: unit.id, level: 3 }], match.state);
    run(0.65);
    const wrapper = unitObject(scene, unit.id) as Object3D;
    expect(wrapper.scale.x).toBe(1);
    // The model inside the wrapper carries the level's size.
    const model = wrapper.getObjectByName('peashooter') as Object3D;
    expect(model).toBeDefined();
    expect(model.scale.x).toBeCloseTo(1.16, 2);
    // And the merge motion has come back to rest round it.
    const root = wrapper.children[0] as Object3D;
    expect(root.scale.x).toBeCloseTo(1, 5);
  });

  it('draws a unit at the interpolation of its last two simulation positions', () => {
    const { scene, view, match, run } = setUp();
    const events: SimEvent[] = [];
    const unit = spawnUnit(match.state, BALANCE, 'veryFastWalker', 3, 8, events);
    view.applyEvents(events, match.state);
    unit.x = 7.9;
    view.applyEvents([], match.state);
    unit.x = 7.8;
    view.applyEvents([], match.state);
    run(DT, 0.5);
    expect(unitObject(scene, unit.id)?.position.x).toBeCloseTo(7.85, 6);
    expect(unitObject(scene, unit.id)?.position.z).toBeCloseTo(3.5, 6);
  });

  it('leaves no projectile object after a projectile has spawned and hit', () => {
    const { scene, view, match, run } = setUp();
    const events: SimEvent[] = [];
    const shooter = spawnUnit(match.state, BALANCE, 'peashooter', 2, 1.5, events);
    view.applyEvents(events, match.state);
    run(0.4);
    const spawned: SimEvent[] = [
      { type: 'unitAttacked', unitId: shooter.id, attack: 'shot', targetId: null, targetBase: 'zombies' },
      { type: 'projectileSpawned', projectileId: 99, kind: 'pea', faction: 'plants', lane: 2, x: 1.5, ownerId: shooter.id, flight: 'straight', targetX: null },
    ];
    match.state.projectiles.push({
      id: 99, kind: 'pea', faction: 'plants', lane: 2, x: 1.5, speed: 0.2, damage: 20, ownerId: shooter.id, spawnTick: 0, flight: 'straight', sourceKey: 'peashooter', level: 1, targetId: null, targetX: null, pierceLeft: 0, hitIds: [], burning: false, burnDps: 0, burnTicks: 0, fadeX: null
    });
    view.applyEvents(spawned, match.state);
    run(0.2);
    expect(countNamed(scene, 'projectile-')).toBe(1);
    match.state.projectiles.length = 0;
    view.applyEvents(
      [{ type: 'projectileHit', projectileId: 99, lane: 2, x: 2.5, targetId: null, targetBase: 'zombies', blocked: false, burning: false }],
      match.state,
    );
    run(DT);
    expect(countNamed(scene, 'projectile-')).toBe(0);
  });

  it('melts a shot that fades in the fog into a puff of mist where it is, and leaves no projectile object', () => {
    const { scene, view, match, run, fx } = setUp();
    const events: SimEvent[] = [];
    const shooter = spawnUnit(match.state, BALANCE, 'peashooter', 2, 1.5, events);
    view.applyEvents(events, match.state);
    run(0.4);
    match.state.projectiles.push({
      id: 98, kind: 'pea', faction: 'plants', lane: 2, x: 1.5, speed: 0.2, damage: 20, ownerId: shooter.id, spawnTick: 0, flight: 'straight', sourceKey: 'peashooter', level: 1, targetId: null, targetX: null, pierceLeft: 0, hitIds: [], burning: false, burnDps: 0, burnTicks: 0, fadeX: 6.5
    });
    view.applyEvents([
      { type: 'unitAttacked', unitId: shooter.id, attack: 'shot', targetId: null, targetBase: 'zombies' },
      { type: 'projectileSpawned', projectileId: 98, kind: 'pea', faction: 'plants', lane: 2, x: 1.5, ownerId: shooter.id, flight: 'straight', targetX: null },
    ], match.state);
    run(0.3);
    expect(countNamed(scene, 'projectile-')).toBe(1);
    const puff = vi.spyOn(fx, 'puff');
    match.state.projectiles.length = 0;
    view.applyEvents([{ type: 'projectileFaded', id: 98, x: 6.5, lane: 2 }], match.state);
    run(DT);
    expect(countNamed(scene, 'projectile-')).toBe(0);
    expect(puff).toHaveBeenCalledTimes(1);
    expect(puff.mock.calls[0]?.[0].z).toBeCloseTo(2.5, 1);
  });

  it('replays a 3,000-tick bot match without throwing and ends with the state’s units', { timeout: 20_000 }, () => {
    const { scene, view, match, run } = setUp();
    const bots = [createBasicBot('plants', 'medium', 7), createBasicBot('zombies', 'medium', 7)];
    let time = 0;
    expect(() => {
      for (let tick = 0; tick < 3000 && match.state.winner === null; tick++) {
        const commands: Command[] = [];
        for (const bot of bots) commands.push(...bot.think(match));
        view.applyEvents(match.step(commands), match.state);
        time += 1 / 30;
        // Two frames per step, at two points between steps.
        view.frame(match.state, 0.25, 1 / 60, time);
        view.frame(match.state, 0.75, 1 / 60, time + 1 / 60);
      }
      run(1);
    }).not.toThrow();
    expect(match.state.units.length).toBeGreaterThan(0);
    expect(view.unitCount).toBe(match.state.units.length);
    // Only what is still flying in the simulation is on screen; every token and gravestone is gone
    // (the spell shows keep a hidden pool of each in the scene: none of those may be showing).
    expect(countNamed(scene, 'projectile-')).toBe(match.state.projectiles.length);
    expect(countShown(scene, 'token-')).toBe(0);
    expect(countShown(scene, 'gravestone')).toBe(0);
  });
});

/** Spawns units through events, as the simulation would, and hands them to the view. */
function spawn(ctx: ReturnType<typeof setUp>, ...units: [Parameters<typeof spawnUnit>[2], number, number][]) {
  const events: SimEvent[] = [];
  const made = units.map(([key, lane, x]) => spawnUnit(ctx.match.state, BALANCE, key, lane, x, events));
  ctx.view.applyEvents(events, ctx.match.state);
  return made;
}

const VIEWPORT = { width: 1600, height: 1000 };

/** NDC of a world point, and its client pixel position, for the test camera. */
function aim(ctx: ReturnType<typeof setUp>, x: number, y: number, z: number, dxPx = 0): [number, number] {
  const at = worldToClient(new Vector3(x, y, z), ctx.camera, VIEWPORT);
  return [((at.x + dxPx) / VIEWPORT.width) * 2 - 1, 1 - (at.y / VIEWPORT.height) * 2];
}

describe('BattleView picking', () => {
  it('picks the unit under the pointer and nothing on empty ground', () => {
    const ctx = setUp();
    const [wall] = spawn(ctx, ['walnutBomb', 2, 3.5]);
    ctx.run(0.5);
    expect(ctx.view.unitAtRay(...aim(ctx, 3.5, 0.3, 2.5))).toBe(wall?.id);
    expect(ctx.view.unitAtRay(...aim(ctx, 7.5, 0, 0.5))).toBeNull();
  });

  it('skips a dying unit and a hidden model', () => {
    const ctx = setUp();
    const [a, b] = spawn(ctx, ['walnutBomb', 2, 3.5], ['walnutBomb', 4, 6.5]);
    ctx.run(0.5);
    (ctx.view.unit(b?.id as number) as { model: { root: Object3D } }).model.root.visible = false;
    expect(ctx.view.unitAtRay(...aim(ctx, 6.5, 0.3, 4.5))).toBeNull();
    ctx.match.state.units.splice(ctx.match.state.units.indexOf(a as never), 1);
    ctx.view.applyEvents([{ type: 'unitDied', unitId: a?.id as number, key: 'walnutBomb', faction: 'plants', lane: 2, x: 3.5, level: 1, cause: 'damage' }], ctx.match.state);
    expect(ctx.view.unitAtRay(...aim(ctx, 3.5, 0.3, 2.5), VIEWPORT)).toBeNull();
  });

  it('forgives a finger that misses by less than the tolerance, and picks the nearer of two', () => {
    const ctx = setUp();
    // From far away, so a unit is only a few pixels wide and a finger can easily miss it.
    ctx.camera.position.set(5, 70, 80);
    ctx.camera.lookAt(5, 0, 2.5);
    ctx.camera.updateMatrixWorld(true);
    const [a, b] = spawn(ctx, ['peashooter', 2, 2.5], ['peashooter', 2, 3.5]);
    ctx.run(0.5);
    const h = (ctx.view.unit(a?.id as number) as { height: number }).height;
    const pa = worldToClient(new Vector3(2.5, h / 2, 2.5), ctx.camera, VIEWPORT);
    const pb = worldToClient(new Vector3(3.5, h / 2, 2.5), ctx.camera, VIEWPORT);
    const ndcAt = (x: number, y: number): [number, number] => [(x / VIEWPORT.width) * 2 - 1, 1 - (y / VIEWPORT.height) * 2];
    // Above the first unit's middle by most of the tolerance: off the model, so only the tolerance picks it.
    const above = ndcAt(pa.x, pa.y - (PICK_TOLERANCE_PX - 4));
    expect(ctx.view.unitAtRay(...above)).toBeNull();
    expect(ctx.view.unitAtRay(...above, VIEWPORT)).toBe(a?.id);
    // Past the tolerance: nothing.
    expect(ctx.view.unitAtRay(...ndcAt(pa.x, pa.y - (PICK_TOLERANCE_PX + 6)), VIEWPORT)).toBeNull();
    // Between the two, above them, nearer the second: the second.
    const mid = ndcAt(pa.x + (pb.x - pa.x) * 0.7, pa.y - 16);
    expect(ctx.view.unitAtRay(...mid, VIEWPORT)).toBe(b?.id);
  });
});

describe('BattleView placement preview', () => {
  it('marks a plant tile and places its ghost; null clears it', () => {
    const ctx = setUp();
    const tile = vi.spyOn(ctx.lawn, 'highlightTile');
    ctx.view.setPreview({ unit: 'peashooter', lane: 1, col: 4, ok: true, mergeTargetId: null });
    expect(tile).toHaveBeenLastCalledWith(1, 4, 'ok', 'plants');
    const ghost = ctx.scene.getObjectByName('ghost-peashooter') as Object3D;
    expect(ghost.visible).toBe(true);
    expect(ghost.position.toArray()).toEqual([4.5, 0, 1.5]);
    ctx.view.setPreview({ unit: 'peashooter', lane: 3, col: 2, ok: false, mergeTargetId: null });
    expect(tile).toHaveBeenLastCalledWith(3, 2, 'bad', 'plants');
    expect(ctx.scene.getObjectByName('ghost-peashooter')).toBe(ghost); // made once
    ctx.view.setPreview(null);
    expect(ghost.visible).toBe(false);
    expect(tile).toHaveBeenLastCalledWith(0, 0, null);
  });

  it('draws the ghost after the see-through tile mark, so the mark does not wash it out', () => {
    const ctx = setUp();
    ctx.view.setPreview({ unit: 'peashooter', lane: 1, col: 4, ok: true, mergeTargetId: null });
    const ghost = ctx.scene.getObjectByName('ghost-peashooter') as Object3D;
    let meshes = 0;
    ghost.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) {
        meshes++;
        expect(o.renderOrder).toBe(GHOST_RENDER_ORDER);
      }
    });
    expect(meshes).toBeGreaterThan(0);
    expect(GHOST_RENDER_ORDER).toBeGreaterThan(2); // the tile mark's
  });

  it('outlines the ghost in white on a free spot and red on a refused one', () => {
    const ctx = setUp();
    ctx.view.setPreview({ unit: 'peashooter', lane: 1, col: 4, ok: true, mergeTargetId: null });
    const outline = ctx.scene.getObjectByName('ghost-outline-peashooter') as Object3D;
    expect(outline.visible).toBe(true);
    expect(outline.position.toArray()).toEqual([4.5, 0, 1.5]);
    let material: { color: { getHex(): number }; side: number } | null = null;
    outline.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) {
        material = (o as unknown as { material: typeof material }).material;
        expect(o.renderOrder).toBe(GHOST_RENDER_ORDER + 1);
      }
    });
    expect(material!.color.getHex()).toBe(0xffffff);
    ctx.view.setPreview({ unit: 'peashooter', lane: 1, col: 4, ok: false, mergeTargetId: null });
    expect(material!.color.getHex()).toBe(0xff3b3b);
    ctx.view.setPreview(null);
    expect(outline.visible).toBe(false);
    ctx.view.dispose();
    expect(ctx.scene.getObjectByName('ghost-outline-peashooter')).toBeUndefined();
  });

  it('marks a zombie lane with its ghost at the spawn point', () => {
    const ctx = setUp();
    const lane = vi.spyOn(ctx.lawn, 'highlightLane');
    ctx.view.setPreview({ unit: 'brainEater', lane: 2, col: 0, ok: true, mergeTargetId: null });
    expect(lane).toHaveBeenLastCalledWith(2, 'ok', 'zombies');
    expect((ctx.scene.getObjectByName('ghost-brainEater') as Object3D).position.toArray()).toEqual([9.5, 0, 2.5]);
  });

  it('pulses a merge target instead of showing a ghost, and stops when cleared', () => {
    const ctx = setUp();
    const [p] = spawn(ctx, ['peashooter', 0, 1.5]);
    ctx.view.setPreview({ unit: 'peashooter', lane: 0, col: 1, ok: true, mergeTargetId: p?.id as number });
    const view = ctx.view.unit(p?.id as number) as { pulsing: boolean };
    expect(view.pulsing).toBe(true);
    expect(ctx.scene.getObjectByName('ghost-peashooter')).toBeUndefined();
    ctx.view.setPreview(null);
    expect(view.pulsing).toBe(false);
  });
});

describe('HealthBars', () => {
  it('draws 3 quads at level 1 and 11 at level 5, and never more than it has room for', () => {
    const camera = new PerspectiveCamera();
    const bars = new HealthBars(2);
    bars.begin(camera);
    bars.add(new Vector3(), 0.5, 1);
    expect(bars.quads).toBe(3);
    bars.add(new Vector3(), 0.5, 5);
    expect(bars.quads).toBe(3 + 11);
    bars.add(new Vector3(), 0.5, 5); // a third unit does not fit
    expect(bars.quads).toBe(14);
    bars.end();
    expect(bars.mesh.count).toBe(14);
    expect(QUADS_PER_UNIT).toBe(11);
  });
});

describe('BattleView details', () => {
  it('stands a stack of zombies apart in depth, height and along the lane', () => {
    const ctx = setUp();
    const zs = spawn(ctx, ['brainEater', 3, 7], ['brainEater', 3, 7], ['brainEater', 3, 7]);
    ctx.run(1.5);
    const at = zs.map((z) => (ctx.scene.getObjectByName(`unit-${z.id}`) as Object3D).position);
    expect(at.map((p) => p.z - 3.5).map((z) => Math.round(z * 100) / 100)).toEqual([0, 0.12, -0.12]);
    expect(at[1]?.y).toBeGreaterThan(0.03);
    expect(at[2]?.y).toBeGreaterThan(at[1]?.y as number);
    expect(at[1]?.x).toBeGreaterThan(at[0]?.x as number);
  });

  it('lets the Brain Eater’s brain go 0.12 s into the throw and gives it a new one 0.4 s later', () => {
    const ctx = setUp();
    const [z] = spawn(ctx, ['brainEater', 1, 7]);
    ctx.run(0.6);
    const brain = (ctx.scene.getObjectByName(`unit-${z?.id}`) as Object3D).getObjectByName('brain') as Object3D;
    ctx.view.applyEvents([{ type: 'unitAttacked', unitId: z?.id as number, attack: 'shot', targetId: null, targetBase: 'plants' }], ctx.match.state);
    ctx.run(0.1);
    expect(brain.visible).toBe(true);
    ctx.run(0.05);
    expect(brain.visible).toBe(false);
    ctx.run(0.33);
    expect(brain.visible).toBe(false);
    ctx.run(0.1);
    expect(brain.visible).toBe(true);
  });

  it('shows the Walnut Bomb’s cracks below half health', () => {
    const ctx = setUp();
    const [w] = spawn(ctx, ['walnutBomb', 2, 2.5]);
    const cracks = (ctx.scene.getObjectByName(`unit-${w?.id}`) as Object3D).getObjectByName('cracks') as Object3D;
    expect(cracks.visible).toBe(false);
    (w as { hp: number }).hp = Math.floor((w?.maxHp as number) * 0.49);
    ctx.view.applyEvents([], ctx.match.state);
    expect(cracks.visible).toBe(true);
    (w as { hp: number }).hp = Math.ceil((w?.maxHp as number) * 0.51);
    ctx.view.applyEvents([], ctx.match.state);
    expect(cracks.visible).toBe(false);
  });

  it('holds a Walnut Bomb’s blast until its swell is over, then asks for shake, hit-stop and punch', () => {
    const ctx = setUp();
    const feel = vi.fn();
    ctx.view.onFeel = feel;
    const blast = vi.spyOn(ctx.fx, 'explosion');
    const [w] = spawn(ctx, ['walnutBomb', 2, 2.5]);
    ctx.run(0.5);
    ctx.match.state.units.length = 0;
    ctx.view.applyEvents([
      { type: 'unitDied', unitId: w?.id as number, key: 'walnutBomb', faction: 'plants', lane: 2, x: 2.5, level: 1, cause: 'damage' },
      { type: 'explosion', lane: 2, x: 2.5, radius: 1.5, sourceKey: 'walnutBomb' },
    ], ctx.match.state);
    expect(blast).not.toHaveBeenCalled();
    ctx.run(0.1);
    expect(blast).not.toHaveBeenCalled();
    ctx.run(0.15);
    expect(blast).toHaveBeenCalledTimes(1);
    expect(feel).toHaveBeenCalledWith({ shake: 0.5, hitStop: 0.08, punch: 0.04 });
  });

  it('reports the player’s energy to the HUD and asks for slow motion at the end', () => {
    const ctx = setUp();
    const token = vi.fn();
    const feel = vi.fn();
    ctx.view.onEnergyToken = token;
    ctx.view.onFeel = feel;
    ctx.view.applyEvents([
      { type: 'energyGained', faction: 'plants', amount: 25, source: 'sunflower', unitId: null, lane: 1, x: 2.5 },
      { type: 'energyGained', faction: 'zombies', amount: 50, source: 'bounty', unitId: null, lane: 1, x: 2.5 },
      { type: 'matchEnded', winner: 'plants' },
    ], ctx.match.state);
    expect(token).toHaveBeenCalledTimes(1);
    expect(token.mock.calls[0]?.[0]).toBe('plants');
    expect((token.mock.calls[0]?.[1] as Vector3).x).toBe(2.5);
    expect(token.mock.calls[0]?.[2]).toBe(25);
    expect(feel).toHaveBeenCalledWith({ slowMo: 1.5 });
  });

  it('joins a match under way: units it never saw spawn, and both bases at their health', () => {
    const ctx = setUp();
    expect(() => ctx.run(0.1)).not.toThrow(); // a frame before any step is harmless
    spawnUnit(ctx.match.state, BALANCE, 'peashooter', 0, 0.5);
    spawnUnit(ctx.match.state, BALANCE, 'brainEater', 0, 6);
    ctx.match.state.baseHp.plants = ctx.match.state.baseMaxHp.plants * 0.1;
    ctx.match.state.baseHp.zombies = ctx.match.state.baseMaxHp.zombies * 0.6;
    ctx.view.applyEvents([], ctx.match.state);
    expect(ctx.view.unitCount).toBe(2);
    const shown = (side: string, state: number): boolean =>
      (ctx.scene.getObjectByName(`base-${side}`) as Object3D).getObjectByName(`state-${state}`)?.visible ?? false;
    expect(shown('plants', 3)).toBe(true);
    expect(shown('zombies', 1)).toBe(true);
    expect(shown('zombies', 0)).toBe(false);
  });

  it('ignores events about units it does not know, and a second death of one unit', () => {
    const ctx = setUp();
    const [z] = spawn(ctx, ['brainEater', 2, 7]);
    expect(() =>
      ctx.view.applyEvents([
        { type: 'unitDamaged', unitId: 999, amount: 5, hp: 1 },
        { type: 'unitAttacked', unitId: 999, attack: 'melee', targetId: null, targetBase: 'plants' },
        { type: 'unitMerged', unitId: 999, level: 2 },
        { type: 'projectileHit', projectileId: 999, lane: 2, x: 4, targetId: 999, targetBase: null, blocked: true, burning: false },
        { type: 'baseStruck', lane: 2, targetId: 999 },
        { type: 'energyGained', faction: 'plants', amount: 25, source: 'sunflower', unitId: 999, lane: 2, x: 3 },
      ], ctx.match.state),
    ).not.toThrow();
    ctx.match.state.units.length = 0;
    const died: SimEvent = { type: 'unitDied', unitId: z?.id as number, key: 'brainEater', faction: 'zombies', lane: 2, x: 7, level: 1, cause: 'damage' };
    ctx.view.applyEvents([died], ctx.match.state);
    ctx.run(0.3);
    expect(() => ctx.view.applyEvents([died], ctx.match.state)).not.toThrow();
    ctx.run(0.3);
    expect(ctx.view.unitCount).toBe(0);
  });

  it('still shows a pea whose hit came before it left the mouth, landing after its flight', () => {
    const ctx = setUp();
    const spark = vi.spyOn(ctx.fx, 'spark');
    const [p] = spawn(ctx, ['peashooter', 2, 1.5]);
    ctx.run(0.4);
    ctx.match.state.projectiles.push({ id: 50, kind: 'pea', faction: 'plants', lane: 2, x: 1.5, speed: 0.2, damage: 20, ownerId: p?.id as number, spawnTick: 0, flight: 'straight', sourceKey: 'peashooter', level: 1, targetId: null, targetX: null, pierceLeft: 0, hitIds: [], burning: false, burnDps: 0, burnTicks: 0, fadeX: null });
    ctx.view.applyEvents([
      { type: 'unitAttacked', unitId: p?.id as number, attack: 'shot', targetId: null, targetBase: null },
      { type: 'projectileSpawned', projectileId: 50, kind: 'pea', faction: 'plants', lane: 2, x: 1.5, ownerId: p?.id as number, flight: 'straight', targetX: null },
    ], ctx.match.state);
    ctx.match.state.projectiles.length = 0;
    ctx.view.applyEvents([{ type: 'projectileHit', projectileId: 50, lane: 2, x: 2.1, targetId: null, targetBase: null, blocked: false, burning: false }], ctx.match.state);
    ctx.run(0.05);
    expect(spark).not.toHaveBeenCalled();
    ctx.run(0.1); // released at the snap and in flight
    const pea = ctx.scene.getObjectByName('projectile-pea') as Object3D;
    expect(pea?.visible).toBe(true);
    expect(spark).not.toHaveBeenCalled();
    ctx.run(0.1);
    expect(spark).toHaveBeenCalledTimes(1);
    expect(countNamed(ctx.scene, 'projectile-')).toBe(0);
  });

  it('leaves the scene as it found it when disposed, and ends a celebration', async () => {
    const ctx = setUp();
    const [p] = spawn(ctx, ['peashooter', 2, 1.5], ['brainEater', 1, 9.5]);
    ctx.match.state.projectiles.push({ id: 77, kind: 'pea', faction: 'plants', lane: 2, x: 1.5, speed: 0.2, damage: 20, ownerId: p?.id as number, spawnTick: 0, flight: 'straight', sourceKey: 'peashooter', level: 1, targetId: null, targetX: null, pierceLeft: 0, hitIds: [], burning: false, burnDps: 0, burnTicks: 0, fadeX: null });
    ctx.view.applyEvents([
      { type: 'projectileSpawned', projectileId: 77, kind: 'pea', faction: 'plants', lane: 2, x: 1.5, ownerId: p?.id as number, flight: 'straight', targetX: null },
      { type: 'energyGained', faction: 'plants', amount: 25, source: 'sunflower', unitId: null, lane: 1, x: 2.5 },
      { type: 'explosion', lane: 2, x: 4, radius: 1, sourceKey: 'walnutBomb' },
    ], ctx.match.state);
    ctx.view.setPreview({ unit: 'sunflower', lane: 0, col: 0, ok: true, mergeTargetId: null });
    ctx.run(0.2);
    const done = ctx.view.celebrate('plants');
    ctx.view.dispose();
    await expect(done).resolves.toBeUndefined();
    expect(ctx.scene.children).toEqual(ctx.before);
  });
});

describe('BattleView cheer', () => {
  it('throws confetti over the winners for the given seconds, then stops; nothing for a draw', () => {
    const ctx = setUp();
    spawn(ctx, ['peashooter', 2, 1.5], ['sunflower', 1, 0.5]);
    const confetti = vi.spyOn(ctx.fx, 'confetti');
    ctx.view.cheer('draw', 2);
    ctx.run(0.5);
    expect(confetti).not.toHaveBeenCalled();
    expect(ctx.view.cheering).toBe(false);

    ctx.view.cheer('plants', 1);
    expect(ctx.view.cheering).toBe(true);
    ctx.run(1.1);
    expect(ctx.view.cheering).toBe(false);
    const pops = confetti.mock.calls.length;
    expect(pops).toBeGreaterThanOrEqual(5); // about one every 0.14 s
    for (const [at] of confetti.mock.calls) {
      expect(at.y).toBeGreaterThan(0.5); // above the winners' heads or over their base
      expect(at.x).toBeLessThan(3); // the plants' end of the lawn
    }
    ctx.run(1);
    expect(confetti.mock.calls.length).toBe(pops);
  });
});
