// @vitest-environment happy-dom
import { Mesh, PerspectiveCamera, Scene, type Object3D } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LevelDef } from '../../src/adventure/types';
import { BattleSession } from '../../src/app/BattleSession';
import { BattleController } from '../../src/app/BattleController';
import { levelOptions, prepareLevel } from '../../src/app/levelSession';
import type { Director, StageLike } from '../../src/app/Stage';
import { stepsToTeach } from '../../src/app/tutorial';
import { AudioEngine } from '../../src/audio/AudioEngine';
import type { WorldKey } from '../../src/data/worlds';
import { CameraRig } from '../../src/render/CameraRig';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import { seededRandom } from '../../src/render/world/boxes';
import { Lawn } from '../../src/render/world/Lawn';
import { GHOST_PUFF } from '../../src/render/world/TwistTiles';
import { hashState } from '../../src/sim/hash';
import type { LawnConfig } from '../../src/sim/types';
import { W2, w2Save } from './world2Lessons';
import { W3, w3Save } from './world3Lessons';
import { LEVELS } from '../../src/adventure/levels';
import { TEACHES } from '../../src/adventure/levels/teaches';

// Step 2, Task 3: the twist pan on the stage - ghosts in the scene and the camera panning while
// the step holds; gone (freed) when it ends, the level is left or the stage shows another world.

const DT = 1 / 60;

/** The stage without WebGL (as BattleSession.test's): its lawn really takes the world it is given. */
function fakeStage(): StageLike {
  const camera = new PerspectiveCamera(30, 1, 2, 200);
  const rig = new CameraRig(camera);
  rig.frameLawn(window.innerWidth / window.innerHeight);
  const particles = new Particles();
  const stage = {
    scene: new Scene(), camera, rig, lawn: new Lawn(), particles, fx: new Effects(particles, seededRandom(1)),
    canvas: document.createElement('canvas'),
    paused: false, timeScale: 1, director: null as Director | null,
    show(d: Director | null) {
      if (d === stage.director) return;
      const old = stage.director;
      stage.director = null;
      if (old) (old.detach(), stage.rig.reset());
      stage.director = d;
    },
    release(d: Director) {
      if (stage.director !== d) return;
      stage.director = null;
      d.detach();
      stage.rig.reset();
    },
    setWorld(world: WorldKey, lawn: LawnConfig) { stage.lawn.setWorld(world, lawn); },
  };
  stage.scene.add(stage.lawn.group, particles.object, stage.fx.group);
  document.body.appendChild(stage.canvas);
  return stage;
}

const sessions: BattleSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
  document.body.innerHTML = '';
});

/** The audio of the session `start` made last (its `play` is a spy). */
let lastAudio: AudioEngine;

function start(stage: StageLike, def: LevelDef, teached: string[] = []): BattleSession {
  const audio = new AudioEngine(() => { throw new Error('no audio in tests'); });
  lastAudio = audio;
  vi.spyOn(audio, 'play').mockImplementation(() => undefined);
  vi.spyOn(audio, 'startMusic').mockImplementation(() => undefined);
  const save = { ...(def.world === 3 ? w3Save(def.side) : w2Save(def.side)), teached };
  const play = { ...prepareLevel(def, save, 5), teach: stepsToTeach(def.teaches, save) };
  const session = new BattleSession(stage, audio, levelOptions(play), { introSeconds: 0, input: { isOverLawn: () => true } });
  sessions.push(session);
  return session;
}

/** The stage's loop by hand: `seconds` of frames, a step every other frame. */
function run(stage: StageLike, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const d = stage.director;
    if (i % 2 === 0) d?.step();
    d?.frame(0.5, DT, stage.paused ? 0 : DT);
    stage.fx.update(DT, stage.camera);
    stage.rig.update(DT);
  }
}

const inScene = (stage: StageLike, name: string): Object3D[] => {
  const found: Object3D[] = [];
  stage.scene.traverse((o) => { if (o.name === name) found.push(o); });
  return found;
};

describe('the twist pan on the stage', () => {
  it('fog: nothing before the battle begins; then ghosts and a pan while held; the puff at the level reach', () => {
    const stage = fakeStage();
    const puff = vi.spyOn(stage.fx, 'puff');
    const lawnShot = stage.camera.position.clone();
    const session = start(stage, W2['p2-1']!);
    expect(session.world).toBe('meadow');
    run(stage, 0.5);
    expect(session.twistShow).toBeNull();
    session.begin();
    run(stage, 0.2);
    expect(session.twistShow?.kind).toBe('fog');
    expect(inScene(stage, 'twist-show')).toHaveLength(1);
    run(stage, 4);
    expect(stage.rig.focusing).toBe(true);
    expect(stage.camera.position.distanceTo(lawnShot)).toBeGreaterThan(1);
    const ghostPuffs = puff.mock.calls.filter(([, c]) => c === GHOST_PUFF);
    expect(ghostPuffs.length).toBeGreaterThanOrEqual(1);
    for (const [at] of ghostPuffs) expect(at.x).toBeCloseTo(1.5 + 7, 1);
    // Held all along: the match has not moved past its first tick.
    expect(session.controller.match.state.tick).toBe(1);
    expect(session.controller.match.state.units).toHaveLength(0);
  });

  it('Review Focus 5: fog with reach 7, then a level with reach 5 on the same stage - the puff follows each level', () => {
    const stage = fakeStage();
    const puff = vi.spyOn(stage.fx, 'puff');
    const first = start(stage, W2['p2-1']!);
    first.begin();
    run(stage, 3);
    const seven = puff.mock.calls.filter(([, c]) => c === GHOST_PUFF).map(([at]) => at.x);
    first.dispose();
    puff.mockClear();
    const five = start(stage, { ...W2['p2-1']!, twist: { fog: 5 } });
    five.begin();
    run(stage, 3);
    const fives = puff.mock.calls.filter(([, c]) => c === GHOST_PUFF).map(([at]) => at.x);
    expect(seven.length).toBeGreaterThan(0);
    expect(fives.length).toBeGreaterThan(0);
    for (const x of seven) expect(x).toBeCloseTo(8.5, 1);
    for (const x of fives) expect(x).toBeCloseTo(6.5, 1);
    expect(five.controller.match.state.config.lawn.fog).toBe(5);
  });

  it('the real Meadow, one stage, p2-1 to p2-8 in turn (reach 7,7,6,6,5,5,5,5): the lawn, the mist bank, the ghost puff and the stripe follow each level', () => {
    const meadow = LEVELS.filter((d) => d.side === 'plants' && d.world === 2);
    expect(meadow.map((d) => d.twist?.fog)).toEqual([7, 7, 6, 6, 5, 5, 5, 5]);
    const stage = fakeStage();
    const puff = vi.spyOn(stage.fx, 'puff');
    for (const def of meadow) {
      const reach = def.twist!.fog as number;
      puff.mockClear();
      // Every level carries the fog pan here, so each one shows its own reach.
      const session = start(stage, { ...def, teaches: [...TEACHES['p2-1']!] });
      expect(session.controller.match.state.config.lawn.fog).toBe(reach);
      expect(stage.lawn.world).toBe('meadow');
      expect(stage.lawn.lawnConfig.fog).toBe(reach);
      session.begin();
      run(stage, 3);
      expect(session.twistShow?.kind).toBe('fog');
      const fadeX = 1.5 + reach;
      const ghostPuffs = puff.mock.calls.filter(([, c]) => c === GHOST_PUFF).map(([at]) => at.x);
      expect(ghostPuffs.length, def.id).toBeGreaterThan(0);
      for (const x of ghostPuffs) expect(x).toBeCloseTo(fadeX, 1);
      const [bank] = inScene(stage, 'fog-bank') as Mesh[];
      bank!.geometry.computeBoundingBox();
      expect(bank!.geometry.boundingBox!.min.x, def.id).toBeGreaterThanOrEqual(fadeX - 0.6);
      expect(bank!.geometry.boundingBox!.min.x, def.id).toBeLessThanOrEqual(fadeX + 0.6);
      const [strip] = inScene(stage, 'fog-reach') as Mesh[];
      strip!.geometry.computeBoundingBox();
      expect(strip!.geometry.boundingBox!.max.x - strip!.geometry.boundingBox!.min.x).toBeCloseTo(reach, 3);
      const [past] = inScene(stage, 'fog-past-reach') as Mesh[];
      past!.geometry.computeBoundingBox();
      expect(past!.position.x + past!.geometry.boundingBox!.min.x).toBeCloseTo(fadeX, 3);
      session.dispose();
      expect(inScene(stage, 'twist-show')).toHaveLength(0);
    }
  });

  it('the camera is focused once when the pan starts, then eases on its own (no focus call per frame)', () => {
    const stage = fakeStage();
    const focus = vi.spyOn(stage.rig, 'focus');
    const session = start(stage, W2['p2-1']!);
    session.begin();
    run(stage, 3);
    expect(focus.mock.calls.filter(([box]) => box !== null)).toHaveLength(1);
    expect(focus.mock.calls[0]![0]).toBe(session.twistShow!.box);
    session.controller.tapTwist();
    run(stage, 0.2);
    expect(focus.mock.calls.filter(([box]) => box === null)).toHaveLength(1);
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('ice: the icy lanes pulse and a ghost zombie slides; the camera pans', () => {
    const stage = fakeStage();
    const session = start(stage, W2['z2-1']!);
    expect(session.world).toBe('tundra');
    session.begin();
    run(stage, 1);
    expect(session.twistShow?.kind).toBe('ice');
    expect(inScene(stage, 'ice-pulse')).toHaveLength(1);
    expect(inScene(stage, 'ghost-brainEater').length).toBeGreaterThan(0);
    expect(stage.rig.focusing).toBe(true);
  });

  it('a tap ends it: the ghosts are freed and leave the scene, the camera eases back to the lawn shot exactly', () => {
    const stage = fakeStage();
    const lawnShot = stage.camera.position.clone();
    const session = start(stage, W2['p2-1']!);
    session.begin();
    run(stage, 2);
    const show = session.twistShow!;
    let freed = 0;
    show.group.traverse((o) => { if (o instanceof Mesh) o.geometry.addEventListener('dispose', () => { freed += 1; }); });
    session.controller.click({ lane: 2, col: 3 }, null);
    run(stage, 0.1);
    expect(session.twistShow).toBeNull();
    expect(show.disposed).toBe(true);
    expect(freed).toBeGreaterThan(0);
    expect(inScene(stage, 'twist-show')).toHaveLength(0);
    run(stage, 1.5);
    expect(stage.rig.focusing).toBe(false);
    expect(stage.camera.position.distanceTo(lawnShot)).toBeLessThan(1e-9);
    expect(session.controller.match.state.tick).toBeGreaterThan(20); // the level plays on
  });

  it('leaving the level mid-pan frees the ghosts', () => {
    const stage = fakeStage();
    const session = start(stage, W2['z2-1']!);
    session.begin();
    run(stage, 1);
    const show = session.twistShow!;
    session.dispose();
    expect(show.disposed).toBe(true);
    expect(inScene(stage, 'twist-show')).toHaveLength(0);
  });

  it('the stage showing another world mid-pan frees the ghosts (and the step still waits for its tap)', () => {
    const stage = fakeStage();
    const session = start(stage, W2['p2-1']!);
    session.begin();
    run(stage, 1);
    const show = session.twistShow!;
    stage.lawn.setWorld('backyard');
    run(stage, 0.1);
    expect(show.disposed).toBe(true);
    expect(session.twistShow).toBeNull();
    expect(inScene(stage, 'twist-show')).toHaveLength(0);
    expect(session.controller.tutorial!.current?.id).toBe('p2-1.fog');
  });

  it('paused, the pan waits under the menu', () => {
    const stage = fakeStage();
    const session = start(stage, W2['p2-1']!);
    session.begin();
    run(stage, 0.4);
    const pea = inScene(stage, 'ghost-pea')[0]!;
    session.controller.setPaused(true);
    run(stage, 0.05);
    const x = pea.position.x;
    run(stage, 1);
    expect(pea.position.x).toBe(x);
    session.controller.setPaused(false);
    run(stage, 0.2);
    expect(pea.position.x).not.toBe(x);
  });

  it('the ghosts never reach the match: the same state as the same taps with no stage at all', () => {
    const stage = fakeStage();
    const session = start(stage, W2['p2-1']!);
    session.begin();
    run(stage, 3); // 90 steps held, the show playing
    session.controller.tapTwist();
    run(stage, 10);
    const ticks = session.controller.match.state.tick;
    const save = w2Save('plants');
    const bare = new BattleController(levelOptions({ ...prepareLevel(W2['p2-1']!, save, 5), teach: [] }));
    for (let i = 0; i < ticks; i++) bare.step();
    expect(bare.match.state.tick).toBe(ticks);
    expect(hashState(session.controller.match.state)).toBe(hashState(bare.match.state));
  });
});

describe('the rocks pan on the stage (worlds step 3, Task 3)', () => {
  for (const id of ['p3-1', 'z3-1']) {
    it(`${id}: ghosts among the boulders, the camera pans from shot to shot, the refusal buzzes ('deny') once a loop, a tap frees it all`, () => {
      const stage = fakeStage();
      const focus = vi.spyOn(stage.rig, 'focus');
      const session = start(stage, W3[id]!);
      expect(session.world).toBe('desert');
      session.begin();
      run(stage, 0.3);
      const show = session.twistShow!;
      expect(show.kind).toBe('rocks');
      expect(show.zombieFirst).toBe(id === 'z3-1');
      expect(inScene(stage, 'twist-show')).toHaveLength(1);
      expect(inScene(stage, 'boulders')).toHaveLength(1);
      expect(inScene(stage, 'ghost-peashooter')).toHaveLength(1);
      expect(inScene(stage, 'ghost-brainEater')).toHaveLength(1);
      const played = (): number => vi.mocked(lastAudio.play).mock.calls.filter(([name]) => name === 'deny').length;
      run(stage, show.loops === 0 ? 12 : 0.1);
      // One focus for every shot of the pan, in order, ending on the boulder the ghosts act on.
      const boxes = focus.mock.calls.map(([box]) => box).filter((b) => b !== null);
      expect(boxes.length).toBeGreaterThanOrEqual(show.pan.length);
      expect(boxes.slice(0, show.pan.length)).toEqual([...show.pan]);
      expect(played()).toBeGreaterThanOrEqual(1);
      expect(played()).toBeLessThanOrEqual(show.loops + 1);
      // Held all along: the match has not moved past its first tick.
      expect(session.controller.match.state.tick).toBe(1);
      expect(session.controller.match.state.units.filter((u) => u.faction === W3[id]!.side)).toHaveLength(0);
      const freed = { n: 0 };
      show.group.traverse((o) => { if (o instanceof Mesh) o.geometry.addEventListener('dispose', () => { freed.n += 1; }); });
      session.controller.tapTwist();
      run(stage, 0.1);
      expect(session.twistShow).toBeNull();
      expect(show.disposed).toBe(true);
      expect(freed.n).toBeGreaterThan(0);
      expect(inScene(stage, 'twist-show')).toHaveLength(0);
      expect(inScene(stage, 'rock-refused')).toHaveLength(0);
      expect(inScene(stage, 'boulders')).toHaveLength(1); // the lawn's own boulders stay
    });
  }
});
