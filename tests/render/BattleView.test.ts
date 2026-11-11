import { Object3D, PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { createBasicBot } from '../../src/ai/basicBot';
import { BALANCE } from '../../src/data/balance';
import { BattleView } from '../../src/render/battle/BattleView';
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
  return { scene, camera, view, match, run };
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
      { type: 'projectileSpawned', projectileId: 99, kind: 'pea', faction: 'plants', lane: 2, x: 1.5, ownerId: shooter.id },
    ];
    match.state.projectiles.push({
      id: 99, kind: 'pea', faction: 'plants', lane: 2, x: 1.5, speed: 0.2, damage: 20, ownerId: shooter.id, spawnTick: 0,
    });
    view.applyEvents(spawned, match.state);
    run(0.2);
    expect(countNamed(scene, 'projectile-')).toBe(1);
    match.state.projectiles.length = 0;
    view.applyEvents(
      [{ type: 'projectileHit', projectileId: 99, lane: 2, x: 2.5, targetId: null, targetBase: 'zombies', blocked: false }],
      match.state,
    );
    run(DT);
    expect(countNamed(scene, 'projectile-')).toBe(0);
  });

  it('replays a 3,000-tick bot match without throwing and ends with the state’s units', () => {
    const { view, match, run } = setUp();
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
  });
});
