// @vitest-environment happy-dom
import { PerspectiveCamera, Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { levelById } from '../../src/adventure/levels';
import type { LevelDef } from '../../src/adventure/types';
import { BattleSession } from '../../src/app/BattleSession';
import type { BattleOptions } from '../../src/app/BattleController';
import { levelOptions, prepareLevel } from '../../src/app/levelSession';
import { FAST, forgetSpeed, saveSpeed } from '../../src/app/speed';
import type { Director, StageLike } from '../../src/app/Stage';
import { stepsToTeach } from '../../src/app/tutorial';
import { AudioEngine } from '../../src/audio/AudioEngine';
import type { WorldKey } from '../../src/data/worlds';
import { GameLoop } from '../../src/game/GameLoop';
import { CameraRig } from '../../src/render/CameraRig';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import { seededRandom } from '../../src/render/world/boxes';
import { Lawn } from '../../src/render/world/Lawn';
import { newSave } from '../../src/progress/save';
import { hashState } from '../../src/sim/hash';
import type { LawnConfig } from '../../src/sim/types';
import { W2, w2Save } from './world2Lessons';

// The 2X button (src/app/speed.ts) as the session drives it: the stage's real fixed-step loop runs
// at twice the game time per real time; the match itself is played tick for tick as at 1x.

const FRAME_MS = 1000 / 60;

/** The stage without WebGL, driven by the real `GameLoop` (its `paused` and `timeScale` are the loop's). */
function loopStage(): StageLike & { loop: GameLoop; at: number; play(seconds: number, before?: () => void): void } {
  const camera = new PerspectiveCamera(30, 1, 2, 200);
  const rig = new CameraRig(camera);
  rig.frameLawn(window.innerWidth / window.innerHeight);
  const particles = new Particles();
  let hook: (() => void) | undefined;
  const loop = new GameLoop({
    step: () => { hook?.(); stage.director?.step(); },
    frame: (alpha, realDt, gameDt) => {
      stage.director?.frame(alpha, realDt, gameDt);
      stage.fx.update(gameDt, stage.camera);
      stage.rig.update(realDt);
    },
  }, { now: () => 0 });
  const stage = {
    scene: new Scene(), camera, rig, lawn: new Lawn(), particles, fx: new Effects(particles, seededRandom(1)),
    canvas: document.createElement('canvas'),
    get paused() { return loop.paused; },
    set paused(v: boolean) { loop.paused = v; },
    get timeScale() { return loop.timeScale; },
    set timeScale(v: number) { loop.timeScale = v; },
    director: null as Director | null,
    loop,
    at: 0,
    show(d: Director | null) {
      if (d === stage.director) return;
      const old = stage.director;
      stage.director = null;
      if (old) (old.detach(), stage.rig.reset(), (loop.timeScale = 1));
      stage.director = d;
    },
    release(d: Director) {
      if (stage.director !== d) return;
      stage.director = null;
      d.detach();
      stage.rig.reset();
      loop.timeScale = 1;
    },
    setWorld(world: WorldKey, lawn: LawnConfig) { stage.lawn.setWorld(world, lawn); },
    /** `seconds` of real time at 60 frames a second; `before` runs before every step. */
    play(seconds: number, before?: () => void) {
      hook = before;
      const end = stage.at + seconds * 1000;
      if (stage.at === 0) loop.advance(0);
      while (stage.at < end - 1e-6) loop.advance((stage.at += FRAME_MS));
      hook = undefined;
    },
  };
  stage.scene.add(stage.lawn.group, particles.object, stage.fx.group);
  document.body.appendChild(stage.canvas);
  return stage;
}

const sessions: BattleSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
  document.body.innerHTML = '';
  localStorage.clear();
  forgetSpeed();
});

function open(stage: StageLike, opts: BattleOptions): BattleSession {
  const audio = new AudioEngine(() => { throw new Error('no audio in tests'); });
  vi.spyOn(audio, 'play').mockImplementation(() => undefined);
  vi.spyOn(audio, 'startMusic').mockImplementation(() => undefined);
  vi.spyOn(audio, 'stopMusic').mockImplementation(() => undefined);
  const session = new BattleSession(stage, audio, opts, { introSeconds: 0, input: { isOverLawn: () => true } });
  sessions.push(session);
  return session;
}

/** A level with every lesson already done (or `def`'s own, for a player who has done none). */
function levelOpts(def: LevelDef, lessons = false): BattleOptions {
  const save = lessons ? w2Save(def.side) : { ...newSave(def.side === 'plants' ? 'p01' : 'p02', 'Kid', 'peashooter', 0), teached: (def.teaches ?? []).map((t) => t.id) };
  const play = { ...prepareLevel(def, save, 11), teach: stepsToTeach(def.teaches, save) };
  return levelOptions(play);
}

const quick: BattleOptions = { playerFaction: 'plants', skill: 'easy', seed: 7 };

describe('the 2X button in a battle', () => {
  it('is offered in Quick Battle and levels, never in a two-player Versus', () => {
    const stage = loopStage();
    expect(open(stage, quick).speed.offered).toBe(true);
    expect(open(stage, levelOpts(levelById('p1-3')!)).speed.offered).toBe(true);
    const versus = open(stage, { ...quick, versus: true });
    expect(versus.speed.offered).toBe(false);
    expect(versus.speed.shown.value).toBe(false);
  });

  it('runs twice the ticks per real second at 2x; the button off again brings 1x back', () => {
    const stage = loopStage();
    const s = open(stage, quick);
    s.begin();
    stage.play(5);
    const slow = s.controller.match.state.tick;
    expect(slow).toBeGreaterThanOrEqual(149);
    expect(slow).toBeLessThanOrEqual(151);
    s.speed.toggle();
    expect(s.speed.fast.value).toBe(true);
    stage.play(5);
    const fast = s.controller.match.state.tick - slow;
    expect(fast).toBeGreaterThanOrEqual(298);
    expect(fast).toBeLessThanOrEqual(301);
    s.speed.toggle();
    stage.play(5);
    expect(s.controller.match.state.tick - slow - fast).toBeLessThanOrEqual(151);
  });

  it('animations follow game time: a 2x frame hands the view twice the game seconds', () => {
    const stage = loopStage();
    const s = open(stage, quick);
    const frame = vi.spyOn(s.view, 'frame');
    s.begin();
    s.speed.toggle();
    stage.play(1);
    const gameDt = frame.mock.calls.at(-1)![2];
    expect(gameDt).toBeCloseTo((FRAME_MS / 1000) * FAST, 6);
  });

  it('pausing keeps the choice: no ticks while paused, 2x again on resume', () => {
    const stage = loopStage();
    const s = open(stage, quick);
    s.begin();
    s.speed.toggle();
    stage.play(1);
    s.controller.setPaused(true);
    const held = s.controller.match.state.tick;
    stage.play(2);
    expect(s.controller.match.state.tick).toBe(held);
    expect(s.speed.fast.value).toBe(true);
    s.controller.setPaused(false);
    stage.play(2);
    expect(s.controller.match.state.tick - held).toBeGreaterThanOrEqual(118);
  });

  it('the choice is remembered into the next battle', () => {
    const stage = loopStage();
    const a = open(stage, quick);
    a.speed.toggle();
    a.dispose();
    const b = open(stage, levelOpts(levelById('p1-3')!));
    expect(b.speed.fast.value).toBe(true);
    b.begin();
    stage.play(2);
    expect(b.controller.match.state.tick).toBeGreaterThanOrEqual(118);
  });

  it('a lesson that waits for the player (the fog pan on p2-1) hides the button and plays at 1x', () => {
    saveSpeed(FAST);
    const stage = loopStage();
    const s = open(stage, levelOpts(W2['p2-1']!, true));
    expect(s.speed.fast.value).toBe(true);
    s.begin();
    stage.play(0.5);
    expect(s.controller.tutorial?.twist.value?.holding).toBe(true);
    expect(s.speed.shown.value).toBe(false);
    expect(stage.timeScale).toBe(1);
    // The pan ends on a tap: the button is back, lit, and the match runs at 2x.
    s.controller.tapTwist();
    stage.play(0.5);
    expect(s.speed.shown.value).toBe(true);
    expect(stage.timeScale).toBe(FAST);
  });

  it("the first tutorial's glove steps play at 1x with the button hidden", () => {
    saveSpeed(FAST);
    const stage = loopStage();
    const def = levelById('p1-1')!;
    const save = newSave('p01', 'Kid', 'peashooter', 0);
    const s = open(stage, levelOptions({ ...prepareLevel(def, save, 3), teach: stepsToTeach(def.teaches, save) }));
    s.begin();
    stage.play(0.5);
    expect(s.controller.tutorial?.glove.value).not.toBeNull();
    expect(s.speed.shown.value).toBe(false);
    expect(stage.timeScale).toBe(1);
  });

  it("the boss's entrance plays at 1x and the choice comes back after it", () => {
    const stage = loopStage();
    const s = open(stage, levelOpts(levelById('p1-8')!));
    s.speed.toggle();
    s.begin();
    let saw = false;
    for (let i = 0; i < 200 && !saw; i++) {
      stage.play(0.1);
      if (s.view.bossFx.entering) {
        saw = true;
        expect(stage.timeScale).toBe(1);
      }
    }
    expect(saw).toBe(true);
    s.skipBossEntrance();
    stage.play(0.1);
    expect(stage.timeScale).toBe(FAST);
  });

  it('a level played at 2x ends on the very same state and result as at 1x, for the same taps', () => {
    const def = levelById('p1-3')!;
    const plays = [1, FAST].map((speed) => {
      localStorage.clear();
      forgetSpeed();
      const stage = loopStage();
      const s = open(stage, levelOpts(def));
      if (speed === FAST) s.speed.toggle();
      s.begin();
      const ctl = s.controller;
      // The same taps at the same ticks: a Peashooter in lane 2 at 3 s, a Sunflower behind it at 8 s.
      const taps = (): void => {
        const t = ctl.match.state.tick;
        const me = ctl.match.state.players.plants;
        if (t === 90) (me.energy = 900, ctl.select('peashooter'), ctl.click({ lane: 2, col: 1 }, null));
        if (t === 240) (me.energy = 900, ctl.select('sunflower'), ctl.click({ lane: 2, col: 0 }, null));
      };
      let real = 0;
      while (ctl.hud.result.peek() === null && real < 400) {
        stage.play(1, taps);
        real += 1;
      }
      const result = ctl.hud.result.peek();
      expect(result, `decided at ${speed}x`).not.toBeNull();
      return { real, tick: ctl.match.state.tick, hash: hashState(ctl.match.state), result };
    });
    const [slow, fast] = plays as [typeof plays[0], typeof plays[0]];
    expect(fast.tick).toBe(slow.tick);
    expect(fast.hash).toBe(slow.hash);
    expect(fast.result).toEqual(slow.result);
    // And it took about half the real time.
    expect(fast.real).toBeLessThanOrEqual(Math.ceil(slow.real / 2) + 1);
  }, 120_000);
});
