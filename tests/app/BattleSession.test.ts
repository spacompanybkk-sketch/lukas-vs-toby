// @vitest-environment happy-dom
import { Mesh, PerspectiveCamera, Scene, Vector3, type ShaderMaterial } from 'three';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { BattleSession, CHEER_SECONDS } from '../../src/app/BattleSession';
import type { BattleSessionOptions } from '../../src/app/BattleSession';
import type { Director, StageLike } from '../../src/app/Stage';
import { TitleDemo } from '../../src/app/TitleDemo';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { CameraRig } from '../../src/render/CameraRig';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import { seededRandom } from '../../src/render/world/boxes';
import { Lawn } from '../../src/render/world/Lawn';
import { MARKS_LOUD, MARKS_QUIET } from '../../src/render/world/PlaceMarks';
import { spawnUnit } from '../../src/sim/match';
import type { Faction, LawnConfig, UnitKey } from '../../src/sim/types';
import { WORLDS, arenaOf, type WorldKey } from '../../src/data/worlds';
import { levelById } from '../../src/adventure/levels';
import { levelOptions, prepareLevel, type LevelPlay } from '../../src/app/levelSession';
import { newSave } from '../../src/progress/save';
import { NO_TWIST } from '../../src/sim/lawn';
import { SAMPLE_LAWNS } from '../../src/render/world/TwistTiles';
import { versusConfig, type VersusSetup } from '../../src/ai/versus';
import type { MatchChannel } from '../../src/net/channel';
import { LockstepMatch } from '../../src/net/lockstepMatch';
import { memoryPair } from '../../src/net/memoryChannel';
import { VS_TIMEOUTS, type VersusTimeouts } from '../../src/net/timeouts';
import { VirtualClock } from '../../src/net/virtualClock';
import { Match } from '../../src/sim/match';

const DT = 1 / 60;

/** The stage without WebGL: a real scene, camera, rig, lawn and effects; `show` and `release` as the real one. */
function fakeStage(): StageLike & { handOvers: number; worlds: string[]; lawns: LawnConfig[] } {
  const camera = new PerspectiveCamera(30, 1, 2, 200);
  const rig = new CameraRig(camera);
  rig.frameLawn(window.innerWidth / window.innerHeight);
  const particles = new Particles();
  const stage = {
    scene: new Scene(), camera, rig, lawn: new Lawn(), particles, fx: new Effects(particles, seededRandom(1)),
    canvas: document.createElement('canvas'),
    paused: false, timeScale: 1, director: null as Director | null, handOvers: 0,
    show(d: Director | null) {
      if (d === stage.director) return;
      const old = stage.director;
      stage.director = null;
      if (old) (old.detach(), stage.rig.reset(), stage.handOvers++);
      stage.director = d;
    },
    release(d: Director) {
      if (stage.director !== d) return;
      stage.director = null;
      d.detach();
      stage.rig.reset(); // as the real stage does on every hand-over
      stage.handOvers++;
    },
    worlds: [] as string[],
    lawns: [] as LawnConfig[],
    setWorld(world: WorldKey, lawn: LawnConfig) {
      stage.worlds.push(world);
      stage.lawns.push(lawn);
    },
  };
  stage.scene.add(stage.lawn.group, particles.object, stage.fx.group);
  document.body.appendChild(stage.canvas); // the input listens on the document
  return stage;
}

const sessions: BattleSession[] = [];

function make(stage: StageLike, side: Faction = 'plants', extra: BattleSessionOptions = {}) {
  const audio = new AudioEngine(() => { throw new Error('no audio in tests'); });
  const play = vi.spyOn(audio, 'play');
  const session = new BattleSession(stage, audio, { playerFaction: side, skill: 'easy', seed: 7 }, {
    introSeconds: 0, input: { isOverLawn: () => true }, ...extra,
  });
  sessions.push(session);
  return { session, audio, play };
}

/** The stage's loop, by hand: `seconds` of frames with a step every other frame. */
function run(stage: StageLike, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const d = stage.director;
    if (i % 2 === 0) d?.step();
    d?.frame(0.5, DT, stage.paused ? 0 : DT * stage.timeScale);
    stage.fx.update(DT, stage.camera);
    stage.rig.update(DT);
  }
}

function tap(stage: StageLike, x: number, y: number, kind = 'mouse'): void {
  const init = { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: kind, button: 0, isPrimary: true };
  stage.canvas.dispatchEvent(new PointerEvent('pointerdown', init));
  stage.canvas.dispatchEvent(new PointerEvent('pointerup', init));
}

/** Client position of a point `frac` of the way up a unit's drawn model (0 feet, 1 top), or `above` tiles over its top. */
function onModel(session: BattleSession, stage: StageLike, id: number, frac: number, above = 0): { x: number; y: number } {
  const view = session.view.unit(id);
  if (view === undefined) throw new Error(`no view for unit ${id}`);
  view.wrapper.updateMatrixWorld(true);
  const p = new Vector3().setFromMatrixPosition(view.wrapper.matrixWorld);
  p.y += view.height * frac + above;
  p.project(stage.camera);
  return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (0.5 - p.y * 0.5) * window.innerHeight };
}

/** Money in hand and every card recharged, for the player. */
function ready(session: BattleSession): void {
  const me = session.controller.match.state.players[session.playerFaction];
  me.energy = 900;
  me.recharge = {};
}

function unitsInScene(stage: StageLike): number {
  let n = 0;
  stage.scene.traverse((o) => { if (o.name.startsWith('unit-') && o.parent) n++; });
  return n;
}

afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
  document.body.replaceChildren();
});

describe('BattleSession', () => {
  it('takes the stage from the title demo when made', () => {
    const stage = fakeStage();
    const demo = new TitleDemo(stage);
    demo.show();
    expect(stage.director).toBe(demo);
    const { session } = make(stage);
    expect(stage.director).toBe(session);
    expect(demo.current).toBeNull(); // the demo's view and match are gone
  });

  it('does not step the match before begin(); after it, steps and draws the units', () => {
    const stage = fakeStage();
    const { session } = make(stage, 'zombies');
    run(stage, 1);
    expect(session.controller.match.state.tick).toBe(0);
    session.begin();
    run(stage, 2);
    expect(session.controller.match.state.tick).toBe(60);
  });

  it('round-trips a tile through tileToClient and pick', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    for (const [lane, col] of [[0, 0], [2, 3], [4, 9]] as const) {
      const at = session.tileToClient(lane, col);
      expect(session.pick(at.x, at.y).tile).toEqual({ lane, col });
    }
  });

  it('as plants: select a card, tap a tile, and the plant stands there after the step', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    session.begin();
    session.controller.select('peashooter');
    const at = session.tileToClient(2, 3);
    tap(stage, at.x, at.y);
    run(stage, 0.1);
    const plants = session.controller.match.state.units.filter((u) => u.faction === 'plants');
    expect(plants).toHaveLength(1);
    expect(plants[0]).toMatchObject({ key: 'peashooter', lane: 2 });
    expect(Math.floor(plants[0]!.x)).toBe(3);
    expect(unitsInScene(stage)).toBeGreaterThanOrEqual(1);
  });

  it('a refused tap plays the deny sound and shakes the tray (denied goes up)', () => {
    const stage = fakeStage();
    const { session, play } = make(stage);
    session.begin();
    session.controller.select('peashooter');
    const at = session.tileToClient(2, 3);
    tap(stage, at.x, at.y);
    run(stage, 0.1);
    tap(stage, at.x, at.y, 'touch'); // the same tile again: occupied
    expect(session.controller.hud.denied.value).toBe(1);
    expect(play).toHaveBeenCalledWith('deny');
  });

  it('as zombies: a tap anywhere in a lane sends the zombie down that lane', () => {
    const stage = fakeStage();
    const { session } = make(stage, 'zombies');
    session.begin();
    session.controller.select('brainEater');
    const at = session.tileToClient(4, 2);
    tap(stage, at.x, at.y, 'touch');
    run(stage, 0.1);
    const zombies = session.controller.match.state.units.filter((u) => u.faction === 'zombies');
    expect(zombies).toHaveLength(1);
    expect(zombies[0]!.lane).toBe(4);
  });

  it('as zombies: a tap just past the lawn\'s right end still names the lane', () => {
    const stage = fakeStage();
    const { session } = make(stage, 'zombies');
    const at = session.tileToClient(1, 9);
    const right = session.tileToClient(1, 10);
    expect(session.pick((at.x + right.x) / 2 + (right.x - at.x) / 2, at.y).tile).toEqual({ lane: 1, col: 9 });
  });

  it('as plants: with its card, a tap on the Peashooter\'s tile merges into it; a tap on the top of its model goes to the grass behind', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    session.begin();
    ready(session);
    session.controller.select('peashooter');
    const at = session.tileToClient(2, 3);
    tap(stage, at.x, at.y);
    run(stage, 0.6);
    const plant = session.controller.match.state.units.find((u) => u.key === 'peashooter');
    if (plant === undefined) throw new Error('no peashooter');
    // The feet: its own tile, a merge.
    ready(session);
    tap(stage, at.x, at.y, 'touch');
    run(stage, 0.1);
    expect(plant.level).toBe(2);
    // The top of the model lies over the grass of the lane behind: the ground decides, a new plant goes there.
    const top = onModel(session, stage, plant.id, 0.85);
    const ground = session.pick(top.x, top.y).tile;
    expect(ground?.lane).toBeLessThan(2);
    ready(session);
    tap(stage, top.x, top.y, 'touch');
    run(stage, 0.1);
    expect(plant.level).toBe(2);
    expect(session.controller.match.state.units.filter((u) => u.key === 'peashooter')).toHaveLength(2);
  });

  it('as zombies: a tap on the top of the own zombie, or on the grass under it, merges into it', () => {
    const stage = fakeStage();
    const { session } = make(stage, 'zombies');
    session.begin();
    const z = spawnUnit(session.controller.match.state, session.controller.match.balance, 'brainEater', 2, 6.6);
    run(stage, 0.2);
    session.controller.select('brainEater');
    ready(session);
    const top = onModel(session, stage, z.id, 0.85);
    tap(stage, top.x, top.y, 'touch');
    run(stage, 0.1);
    expect(z.level).toBe(2);
    ready(session);
    const ground = session.tileToClient(z.lane, Math.floor(z.x));
    tap(stage, ground.x, ground.y, 'touch');
    run(stage, 0.1);
    expect(z.level).toBe(3);
    expect(session.controller.match.state.units.filter((u) => u.faction === 'zombies' && u.key === 'brainEater')).toHaveLength(1);
  });

  it('shows a level-up marker over each own unit a merge is possible into, and a tap on the unit\'s tile merges', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    session.begin();
    ready(session);
    session.controller.select('peashooter');
    const at = session.tileToClient(2, 3);
    tap(stage, at.x, at.y);
    run(stage, 0.6);
    expect(session.view.mergeMarkers).toBe(0); // the card is recharging
    const plant = session.controller.match.state.units.find((u) => u.key === 'peashooter');
    if (plant === undefined) throw new Error('no peashooter');
    ready(session);
    run(stage, 0.05);
    expect(session.view.mergeMarkers).toBe(1);
    session.controller.select('sunflower');
    run(stage, 0.05);
    expect(session.view.mergeMarkers).toBe(0); // no Sunflower to merge into
    session.controller.select('peashooter');
    run(stage, 0.05);
    expect(session.view.mergeMarkers).toBe(1);
    tap(stage, at.x, at.y);
    run(stage, 0.1);
    expect(plant.level).toBe(2);
  });

  it('the place marks are quiet; loud for a second after a card is picked, and while a card is dragged', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    session.begin();
    ready(session);
    const marks = stage.lawn.group.getObjectByName('place-marks') as Mesh;
    const strength = (): number => ((marks.material as ShaderMaterial).uniforms.uStrength as { value: number }).value;
    run(stage, 0.5);
    expect(marks.visible).toBe(true); // the first card is picked from the start
    expect(strength()).toBe(MARKS_QUIET);
    session.controller.select('sunflower');
    run(stage, 0.2);
    expect(strength()).toBe(MARKS_LOUD);
    run(stage, 1.2);
    expect(strength()).toBe(MARKS_QUIET);
    // A drag from a card: loud while the finger is down.
    const card = document.createElement('button');
    card.dataset.card = 'sunflower';
    document.body.appendChild(card);
    const init = { bubbles: true, clientX: 10, clientY: 10, pointerId: 3, pointerType: 'touch', button: 0, isPrimary: true };
    card.dispatchEvent(new PointerEvent('pointerdown', init));
    run(stage, 2);
    expect(strength()).toBe(MARKS_LOUD);
    document.dispatchEvent(new PointerEvent('pointerup', init));
    run(stage, 0.1);
    expect(strength()).toBe(MARKS_QUIET);
  });

  it('ignores the lawn before begin()', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    session.controller.select('peashooter');
    const at = session.tileToClient(2, 3);
    tap(stage, at.x, at.y);
    session.begin();
    run(stage, 0.1);
    expect(session.controller.match.state.units.filter((u) => u.faction === 'plants')).toHaveLength(0);
  });

  it('fastForward steps the match without drawing, the view keeping up', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    session.fastForward(900);
    expect(session.controller.match.state.tick).toBe(900);
    // Every unit on the field has a live view; units that fell meanwhile may still be playing
    // their death (no frames were drawn), so the view can hold more than the field.
    const alive = session.controller.match.state.units;
    expect(alive.length).toBeGreaterThan(0);
    for (const u of alive) expect(session.view.unit(u.id)?.dying, `unit ${u.id}`).toBe(false);
    expect(session.view.unitCount).toBeGreaterThanOrEqual(alive.length);
  });

  it('a hit-stop from the view stops game time for a moment', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    session.view.onFeel({ hitStop: 0.08, shake: 0.5 });
    session.frame(0, DT, DT);
    expect(stage.timeScale).toBe(0);
    run(stage, 0.2);
    expect(stage.timeScale).toBe(1);
  });

  it('pausing pauses the stage loop', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    session.begin();
    session.controller.setPaused(true);
    session.frame(0, DT, DT);
    expect(stage.paused).toBe(true);
    const tick = session.controller.match.state.tick;
    run(stage, 0.5);
    expect(session.controller.match.state.tick).toBe(tick);
  });

  /** Frames (with steps) until the result may show, letting the celebrate promise settle. */
  async function untilResult(stage: StageLike, session: BattleSession, seconds = 10): Promise<number> {
    let t = 0;
    while (t < seconds && !session.resultReady.value) {
      run(stage, 0.25);
      t += 0.25;
      await Promise.resolve();
      await Promise.resolve();
    }
    return t;
  }

  it('at the end (live): collapse sound, the base falls, the winners cheer 2 s, then the result with the win sting', async () => {
    const stage = fakeStage();
    const { session, play, audio } = make(stage);
    const stop = vi.spyOn(audio, 'stopMusic');
    session.begin();
    session.fastForward(60);
    session.damageBase('zombies', 1e9);
    run(stage, 0.05); // the step that decides it is a live one
    expect(session.controller.hud.result.value).toMatchObject({ winner: 'plants', playerWon: true });
    expect(session.resultReady.value).toBe(false);
    expect(session.live).toBe(false);
    expect(play).toHaveBeenCalledWith('collapse');
    expect(stop).toHaveBeenCalledTimes(1);
    const confetti = vi.spyOn(session.view, 'cheer');
    const took = await untilResult(stage, session);
    expect(session.resultReady.value).toBe(true);
    expect(took).toBeGreaterThanOrEqual(CHEER_SECONDS); // the fall itself plus the cheering
    expect(play).toHaveBeenCalledWith('win');
    // Confetti over the winners from the fall until after the panel shows.
    expect(confetti).toHaveBeenCalledTimes(1);
    expect(confetti.mock.calls[0]?.[0]).toBe('plants');
    expect(confetti.mock.calls[0]?.[1]).toBeGreaterThan(CHEER_SECONDS);
  });

  it('a loss plays the lose sting', async () => {
    const stage = fakeStage();
    const { session, play } = make(stage);
    session.begin();
    session.damageBase('plants', 1e9);
    run(stage, 0.05);
    await untilResult(stage, session);
    expect(session.controller.hud.result.value).toMatchObject({ winner: 'zombies', playerWon: false });
    expect(play).toHaveBeenCalledWith('lose');
  });

  it('a match decided inside fastForward makes no end sounds and leaves the music alone', async () => {
    const stage = fakeStage();
    const { session, play, audio } = make(stage);
    const stop = vi.spyOn(audio, 'stopMusic');
    session.begin();
    session.damageBase('zombies', 1e9);
    session.fastForward(1);
    await untilResult(stage, session);
    expect(session.resultReady.value).toBe(true);
    expect(play).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('disposing never stops the music, so the menu tune started on Quit keeps playing', () => {
    const stage = fakeStage();
    const { session, audio } = make(stage);
    const calls: string[] = [];
    vi.spyOn(audio, 'startMusic').mockImplementation((t) => { calls.push(`start ${t}`); });
    vi.spyOn(audio, 'stopMusic').mockImplementation(() => { calls.push('stop'); });
    session.begin();
    // Quit: the app goes to the title (menu music) and only then unmounts the battle.
    audio.startMusic('menu');
    session.dispose();
    expect(calls).toEqual(['start backyard', 'start menu']);
  });

  it("dresses the stage in a level's arena with the level's own lawn, and plays the arena's theme", () => {
    const level = (id: string): LevelPlay => {
      const def = levelById(id)!;
      return prepareLevel(def, newSave(def.side === 'plants' ? 'p01' : 'p02', 'Kid', 'peashooter', 0), 3);
    };
    const p1 = level('p1-3');
    const z1 = level('z1-3');
    // A plant world-4 level with icy lanes (no such level exists yet): the Tundra, its ice, its theme.
    const tundra: LevelPlay = { ...p1, def: { ...p1.def, world: 4 }, config: { ...p1.config, lawn: SAMPLE_LAWNS.tundra } };
    for (const [play, world] of [[p1, 'backyard'], [z1, 'citadel'], [tundra, 'tundra']] as const) {
      const stage = fakeStage();
      const audio = new AudioEngine(() => { throw new Error('no audio in tests'); });
      const music = vi.spyOn(audio, 'startMusic').mockImplementation(() => {});
      const session = new BattleSession(stage, audio, levelOptions(play), { introSeconds: 0, input: { isOverLawn: () => true } });
      sessions.push(session);
      expect(arenaOf(play.def.side, play.def.world)).toBe(world);
      expect(stage.worlds).toEqual([world]);
      expect(stage.lawns).toEqual([play.config.lawn]);
      expect(stage.lawns[0]).toBe(play.config.lawn);
      session.begin();
      expect(music).toHaveBeenCalledWith(WORLDS[world].theme);
    }
    expect(z1.config.lawn.lava).toBeNull(); // zombie world 1: the Citadel with its lava off
  });

  it('puts Quick Battle in the Backyard with no twist and the Backyard theme', () => {
    const stage = fakeStage();
    const { session, audio } = make(stage);
    const music = vi.spyOn(audio, 'startMusic').mockImplementation(() => {});
    expect(stage.worlds).toEqual(['backyard']);
    expect(stage.lawns).toEqual([NO_TWIST]);
    session.begin();
    expect(music).toHaveBeenCalledWith('backyard');
  });

  it('can be disposed during the opening camera move', async () => {
    const stage = fakeStage();
    const { session } = make(stage, 'plants', { introSeconds: 1.8 });
    const intro = session.start();
    run(stage, 0.3);
    session.dispose();
    expect(stage.director).toBeNull();
    expect(unitsInScene(stage)).toBe(0);
    await expect(intro).resolves.toBeUndefined(); // the stage's reset lands the camera move
    session.begin(); // the banners' timer firing late does nothing
    expect(session.live).toBe(false);
  });

  it('can be disposed while the base is falling; the result never shows', async () => {
    const stage = fakeStage();
    const { session, play } = make(stage);
    session.begin();
    session.damageBase('zombies', 1e9);
    run(stage, 0.3);
    session.dispose();
    await Promise.resolve();
    await Promise.resolve();
    run(stage, 3);
    expect(session.resultReady.value).toBe(false);
    expect(play).not.toHaveBeenCalledWith('win');
    expect(stage.director).toBeNull();
  });

  it('flies a token from where the player earned energy', () => {
    const stage = fakeStage();
    const onToken = vi.fn();
    const { session } = make(stage, 'plants', { onToken });
    session.begin();
    session.controller.select('sunflower');
    const at = session.tileToClient(1, 1);
    tap(stage, at.x, at.y);
    session.fastForward(30 * 30);
    expect(onToken).toHaveBeenCalled();
    const [from, side] = onToken.mock.calls[0]!;
    expect(side).toBe('plants');
    expect(Number.isFinite(from.x) && Number.isFinite(from.y)).toBe(true);
  });

  it('dispose gives the stage back clean, and a second battle works on the same stage', () => {
    const stage = fakeStage();
    const first = make(stage).session;
    first.fastForward(600);
    expect(unitsInScene(stage)).toBeGreaterThan(0);
    first.dispose();
    expect(stage.director).toBeNull();
    expect(unitsInScene(stage)).toBe(0);
    expect(stage.scene.getObjectByName('ghost-peashooter')).toBeUndefined();

    const second = make(stage).session;
    second.begin();
    second.controller.select('peashooter');
    const at = second.tileToClient(3, 2);
    tap(stage, at.x, at.y);
    run(stage, 0.1);
    expect(second.controller.match.state.units.some((u) => u.key === 'peashooter' && u.lane === 3)).toBe(true);
    // The first battle's input is gone: one tap queued one command in the second battle only.
    expect(first.controller.match.state.units.some((u) => u.lane === 3 && u.faction === 'plants')).toBe(false);
  });

  it('dispose is safe twice and after the stage has handed over', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    new TitleDemo(stage).show();
    expect(() => { session.dispose(); session.dispose(); }).not.toThrow();
    expect(stage.director).not.toBe(session);
  });
});

describe('BattleSession hero powers and spells (wiring B)', () => {
  /** Hero and both spells ready (Thunderbolt aimed, Sun Shower not) for a plants player. */
  function armed(stage: StageLike) {
    const made = make(stage);
    const s = made.session.controller.match.state.players.plants;
    s.heroTimer = 1;
    s.spells = [{ key: 'thunderbolt', timer: 1 }, { key: 'sunShower', timer: 1 }];
    made.session.begin();
    made.session.fastForward(1);
    return made;
  }
  function move(stage: StageLike, x: number, y: number): void {
    stage.canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  }

  it('the hero picked, the lane under the pointer lights up, and a tap there fires it with its banner and sound', () => {
    const stage = fakeStage();
    const { session, play } = armed(stage);
    const lane = vi.spyOn(stage.lawn, 'highlightLane');
    session.controller.toggleHero();
    const at = session.tileToClient(1, 6);
    move(stage, at.x, at.y);
    expect(lane).toHaveBeenLastCalledWith(1, 'ok', 'plants');
    tap(stage, at.x, at.y);
    expect(session.heroBanner.value).toBeNull();
    run(stage, 0.1);
    expect(session.heroBanner.value).toMatchObject({ side: 'plants' });
    expect(play).toHaveBeenCalledWith('megaMower');
    expect(session.controller.hud.heroSelected.value).toBe(false);
  });

  it('an aimed spell shows the simulation\'s area under the pointer and casts where tapped', () => {
    const stage = fakeStage();
    const { session, play } = armed(stage);
    const area = vi.spyOn(session.view.spells, 'showArea');
    session.controller.selectSpell('thunderbolt');
    const at = session.tileToClient(4, 9);
    move(stage, at.x, at.y);
    expect(area).toHaveBeenLastCalledWith(
      [{ lane: 3, col: 8 }, { lane: 3, col: 9 }, { lane: 4, col: 8 }, { lane: 4, col: 9 }], 'plants', 'ok',
    );
    tap(stage, at.x, at.y);
    run(stage, 0.1);
    expect(play).toHaveBeenCalledWith('thunderbolt', expect.anything());
    expect(session.controller.hud.spellSelected.value).toBeNull();
  });

  it('a power still charging plays the deny sound when pressed', () => {
    const stage = fakeStage();
    const { session, play } = make(stage);
    session.begin();
    session.controller.toggleHero();
    expect(play).toHaveBeenCalledWith('deny');
  });

  it('a drag from a still-charging hero button onto the lawn places no card', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    session.begin();
    session.controller.select('peashooter');
    const button = document.createElement('button');
    button.dataset.hero = 'plants';
    document.body.appendChild(button);
    const at = session.tileToClient(2, 3);
    const init = { bubbles: true, pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true };
    button.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: 10, clientY: 10 }));
    session.controller.toggleHero(); // what the button does on that down: refused, still charging
    button.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: at.x, clientY: at.y }));
    button.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: at.x, clientY: at.y }));
    run(stage, 0.1);
    expect(session.controller.match.state.units.some((u) => u.faction === 'plants')).toBe(false);
    button.remove();
  });

  it('the other side\'s hero shows its banner too', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    session.begin();
    session.view.onHero('zombies', 2);
    expect(session.heroBanner.value).toMatchObject({ side: 'zombies' });
  });
});

// The iPad report: a level-3+ plant is so tall that, seen from the raised camera, its body covers
// the tile behind it (a lane further back, higher on the screen), and a tap or a drop meant for
// that tile was taken by the plant. Placing goes by the ground tile under the finger alone.
describe('tall plants never cover the tiles behind them', () => {
  const LANE = 3;
  const COL = 3;

  /** A plant of the player's at `level`, standing on (lane, col), drawn at that level's size. */
  function tallPlant(session: BattleSession, stage: StageLike, key: UnitKey, lane: number, col: number, level: number) {
    const { match } = session.controller;
    const u = spawnUnit(match.state, match.balance, key, lane, col + 0.5);
    u.level = level;
    u.hp = u.maxHp = 1e6; // nothing knocks it down during the test
    run(stage, 0.05); // the view joins it at its level's size
    expect(session.view.unit(u.id)?.level).toBe(level);
    return u;
  }

  /** The unit whose model the pointer at a client point hits (the canvas fills the window in jsdom). */
  function bodyAt(session: BattleSession, at: { x: number; y: number }): number | null {
    return session.view.unitHitByRay((at.x / window.innerWidth) * 2 - 1, 1 - (at.y / window.innerHeight) * 2);
  }

  function plantsAt(session: BattleSession, lane: number, col: number) {
    return session.controller.match.state.units.filter((u) => u.faction === 'plants' && u.lane === lane && Math.floor(u.x) === col);
  }

  function battle(): { stage: ReturnType<typeof fakeStage>; session: BattleSession } {
    const stage = fakeStage();
    const { session } = make(stage);
    session.begin();
    ready(session);
    return { stage, session };
  }

  for (const level of [1, 2, 3, 4, 5]) {
    for (const card of ['peashooter', 'sunflower'] as const) {
      it(`a level-${level} Peashooter in front: a tap with the ${card} card on each tile behind it places there`, () => {
        const { stage, session } = battle();
        const tall = tallPlant(session, stage, 'peashooter', LANE, COL, level);
        session.controller.select(card);
        // The tile right behind is covered by the body from level 3 on (the report's case).
        if (level >= 3) expect(bodyAt(session, session.tileToClient(LANE - 1, COL))).toBe(tall.id);
        for (let lane = LANE - 1; lane >= 0; lane--) {
          ready(session);
          const at = session.tileToClient(lane, COL);
          expect(session.pick(at.x, at.y).tile, `lane ${lane}`).toEqual({ lane, col: COL });
          expect(session.hover(session.pick(at.x, at.y).tile, session.pick(at.x, at.y).unitId)).toMatchObject({ lane, col: COL, ok: true });
          tap(stage, at.x, at.y, 'touch');
          run(stage, 0.1);
          expect(plantsAt(session, lane, COL).map((u) => u.key), `lane ${lane}`).toEqual([card]);
        }
        expect(tall.level).toBe(level); // never merged into by a tap meant for another tile
        expect(session.controller.hud.denied.value).toBe(0);
      });
    }
  }

  /** One finger from a tray card (not picked before) to a client point, then up there. */
  function dragCard(stage: StageLike, key: string, to: { x: number; y: number }): void {
    const card = document.createElement('button');
    card.dataset.card = key;
    document.body.appendChild(card);
    const init = { bubbles: true, pointerId: 4, pointerType: 'touch', button: 0, isPrimary: true };
    card.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: 10, clientY: 10 }));
    card.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: to.x, clientY: to.y }));
    card.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: to.x, clientY: to.y }));
    card.remove();
  }

  function move(stage: StageLike, at: { x: number; y: number }): void {
    stage.canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: at.x, clientY: at.y, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  }

  for (const level of [1, 2, 3, 4, 5]) {
    it(`a level-${level} Peashooter in front: a drag of its card onto the tile behind places there; the ghost and the preview follow that tile`, () => {
      const { stage, session } = battle();
      const tall = tallPlant(session, stage, 'peashooter', LANE, COL, level);
      session.controller.select('peashooter'); // the tray's own select, as the card's press does
      const at = session.tileToClient(LANE - 1, COL);
      const preview = vi.spyOn(session.view, 'setPreview');
      move(stage, at);
      expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ unit: 'peashooter', lane: LANE - 1, col: COL, ok: true, mergeTargetId: null }));
      dragCard(stage, 'peashooter', at);
      run(stage, 0.1);
      expect(plantsAt(session, LANE - 1, COL).map((u) => u.key)).toEqual(['peashooter']);
      expect(tall.level).toBe(level);
    });

    it(`a level-${level} plant in front: a belt card of its type tapped onto the tile behind places there`, () => {
      const stage = fakeStage();
      const audio = new AudioEngine(() => { throw new Error('no audio in tests'); });
      const def = levelById('p1-5')!;
      const play = prepareLevel(def, newSave('p01', 'Kid', 'peashooter', 0), 3);
      const session = new BattleSession(stage, audio, levelOptions(play), { introSeconds: 0, input: { isOverLawn: () => true } });
      sessions.push(session);
      session.begin();
      run(stage, 0.1);
      const belt = session.controller.match.state.belt;
      if (belt.length === 0) throw new Error('no belt card');
      belt[0] = 'peashooter'; // a tall one, whatever the level's belt brought first
      const card = 'peashooter';
      run(stage, 0.05);
      const tall = tallPlant(session, stage, card, LANE, COL, level);
      session.controller.selectBelt(0);
      const at = session.tileToClient(LANE - 1, COL);
      if (level >= 3) expect(bodyAt(session, at)).toBe(tall.id);
      expect(session.pick(at.x, at.y).tile).toEqual({ lane: LANE - 1, col: COL });
      tap(stage, at.x, at.y, 'touch');
      run(stage, 0.1);
      expect(plantsAt(session, LANE - 1, COL).map((u) => u.key)).toEqual([card]);
      expect(tall.level).toBe(level);
    });

    it(`a level-${level} Peashooter: its card dropped on its own tile (its feet) still merges`, () => {
      const { stage, session } = battle();
      const tall = tallPlant(session, stage, 'peashooter', LANE, COL, level);
      session.controller.select('peashooter');
      const at = session.tileToClient(LANE, COL);
      tap(stage, at.x, at.y, 'touch');
      run(stage, 0.1);
      expect(tall.level).toBe(Math.min(5, level + 1));
      if (level === 5) expect(session.controller.hud.denied.value).toBe(1); // at the top already: refused, as before
      expect(plantsAt(session, LANE, COL)).toHaveLength(1);
    });

    it(`the shovel: a tap on the body of a level-${level} plant over bare grass digs it; over another plant's tile digs that one`, () => {
      const { stage, session } = battle();
      const tall = tallPlant(session, stage, 'peashooter', LANE, COL, level);
      session.controller.toggleShovel();
      const top = onModel(session, stage, tall.id, 0.8);
      const under = session.pick(top.x, top.y);
      expect(under.tile).toEqual({ lane: LANE, col: COL }); // the body's own tile: nothing stands where the finger is
      // A plant on the tile behind: a tap there digs it, not the tall one whose body covers it.
      const back = tallPlant(session, stage, 'sunflower', LANE - 1, COL, 1);
      const behind = session.tileToClient(LANE - 1, COL);
      tap(stage, behind.x, behind.y, 'touch');
      run(stage, 0.1);
      expect(session.controller.match.state.units.some((u) => u.id === back.id)).toBe(false);
      expect(session.controller.match.state.units.some((u) => u.id === tall.id)).toBe(true);
      if (!session.controller.hud.shovel.value) session.controller.toggleShovel();
      tap(stage, top.x, top.y, 'touch');
      run(stage, 0.1);
      expect(session.controller.match.state.units.some((u) => u.id === tall.id)).toBe(false);
    });
  }

  for (const level of [1, 2, 3, 4, 5]) {
    it(`a level-${level} Peashooter with Sunflowers on every tile behind it: a tap on its head or a drag onto its body merges (level 5: refused)`, () => {
      const { stage, session } = battle();
      const tall = tallPlant(session, stage, 'peashooter', LANE, COL, level);
      for (let lane = 0; lane < LANE; lane++) tallPlant(session, stage, 'sunflower', lane, COL, 1);
      session.controller.select('peashooter');
      const head = onModel(session, stage, tall.id, 0.85);
      expect(bodyAt(session, head)).toBe(tall.id);
      const picked = session.pick(head.x, head.y);
      const preview = vi.spyOn(session.view, 'setPreview');
      const tile = vi.spyOn(stage.lawn, 'highlightTile');
      move(stage, head);
      if (level < 5) {
        expect(picked.tile).toEqual({ lane: LANE, col: COL });
        // The mark shows the tile really used: the plant's own, drawn on top.
        expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ mergeTargetId: tall.id, ok: true }));
        expect(tile).toHaveBeenLastCalledWith(LANE, COL, 'ok', 'plants', true);
        tap(stage, head.x, head.y, 'touch');
        run(stage, 0.1);
        expect(tall.level).toBe(level + 1);
        if (level + 1 < 5) {
          ready(session);
          dragCard(stage, 'peashooter', onModel(session, stage, tall.id, 0.6));
          run(stage, 0.1);
          expect(tall.level).toBe(level + 2);
        }
      } else {
        expect(picked.tile?.lane).toBeLessThan(LANE); // nothing to merge into: the ground decides (and refuses)
        tap(stage, head.x, head.y, 'touch');
        run(stage, 0.1);
        expect(tall.level).toBe(5);
        expect(session.controller.hud.denied.value).toBe(1);
      }
      for (let lane = 0; lane < LANE; lane++) expect(plantsAt(session, lane, COL).map((u) => u.key)).toEqual(['sunflower']);
    });

    it(`a level-${level} belt-card plant with the tile behind taken: a tap on its head merges the belt card (level 5: refused)`, () => {
      const stage = fakeStage();
      const audio = new AudioEngine(() => { throw new Error('no audio in tests'); });
      const play = prepareLevel(levelById('p1-5')!, newSave('p01', 'Kid', 'peashooter', 0), 3);
      const session = new BattleSession(stage, audio, levelOptions(play), { introSeconds: 0, input: { isOverLawn: () => true } });
      sessions.push(session);
      session.begin();
      run(stage, 0.1);
      session.controller.match.state.belt[0] = 'peashooter';
      run(stage, 0.05);
      const tall = tallPlant(session, stage, 'peashooter', LANE, COL, level);
      for (let lane = 0; lane < LANE; lane++) tallPlant(session, stage, 'sunflower', lane, COL, 1);
      session.controller.selectBelt(0);
      const head = onModel(session, stage, tall.id, 0.85);
      tap(stage, head.x, head.y, 'touch');
      run(stage, 0.1);
      expect(tall.level).toBe(Math.min(5, level + 1));
    });
  }

  it('a tap on the level-up marker merges when the tile behind is taken, and places when it is free', () => {
    const { stage, session } = battle();
    const tall = tallPlant(session, stage, 'peashooter', LANE, COL, 2);
    session.controller.select('peashooter');
    run(stage, 0.05);
    expect(session.view.mergeMarkers).toBe(1);
    const marker = onModel(session, stage, tall.id, 1, 0.45);
    const under = session.pick(marker.x, marker.y).tile;
    if (under === null || under.lane >= LANE) throw new Error('the marker should stand over the grass behind');
    tap(stage, marker.x, marker.y, 'touch'); // free: a new Peashooter there
    run(stage, 0.1);
    expect(plantsAt(session, under.lane, COL).map((u) => u.key)).toEqual(['peashooter']);
    expect(tall.level).toBe(2);
    // That tile taken by a Sunflower instead: the marker means the plant it hangs over.
    session.controller.match.state.units.splice(session.controller.match.state.units.findIndex((u) => u.lane === under.lane && u.key === 'peashooter'), 1);
    run(stage, 0.05);
    tallPlant(session, stage, 'sunflower', under.lane, COL, 1);
    ready(session);
    session.controller.select('peashooter');
    run(stage, 0.05);
    tap(stage, marker.x, marker.y, 'touch');
    run(stage, 0.1);
    expect(tall.level).toBe(3);
  });

  it('the hero and an aimed spell aim at the ground behind a level-5 plant, not at the plant', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    const me = session.controller.match.state.players.plants;
    me.heroTimer = 1;
    me.spells = [{ key: 'thunderbolt', timer: 1 }, { key: 'sunShower', timer: 1 }];
    session.begin();
    session.fastForward(1);
    const tall = tallPlant(session, stage, 'peashooter', LANE, COL, 5);
    const at = session.tileToClient(LANE - 1, COL);
    expect(bodyAt(session, at)).toBe(tall.id);
    const lane = vi.spyOn(stage.lawn, 'highlightLane');
    session.controller.toggleHero();
    move(stage, at);
    expect(lane).toHaveBeenLastCalledWith(LANE - 1, 'ok', 'plants');
    session.controller.toggleHero();
    const area = vi.spyOn(session.view.spells, 'showArea');
    session.controller.selectSpell('thunderbolt');
    move(stage, at);
    expect(area).toHaveBeenLastCalledWith(expect.arrayContaining([{ lane: LANE - 1, col: COL }]), 'plants', 'ok');
    expect(session.hover(session.pick(at.x, at.y).tile, null)).toMatchObject({ spell: 'thunderbolt', lane: LANE - 1, col: COL });
  });

  it('every tile of the lawn can be reached with level-5 plants on every other tile of the front lanes', () => {
    const { stage, session } = battle();
    for (let col = 0; col < 8; col++) tallPlant(session, stage, 'peashooter', 4, col, 5);
    for (let col = 0; col < 8; col += 2) tallPlant(session, stage, 'peashooter', 3, col, 4);
    session.controller.select('peashooter');
    for (let lane = 0; lane < 5; lane++) {
      for (let col = 0; col < 8; col++) {
        const at = session.tileToClient(lane, col);
        expect(session.pick(at.x, at.y).tile, `${lane},${col}`).toEqual({ lane, col });
      }
    }
  });
});

// ---- Two-device Versus: the online seat in the session and on the lawn ------------------------

const VS_SETUP: VersusSetup = { seed: 1, seats: { plants: 'p01', zombies: 'p02' }, head: null };
const VS_FRAME = 1000 / 30;

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

interface Seat {
  stage: ReturnType<typeof fakeStage>; link: LockstepMatch; session: BattleSession;
  play: MockInstance<AudioEngine['play']>; channel: MatchChannel;
}

/**
 * Two online sessions on one in-memory database, each on its own stage: p01 plays plants and
 * hosts, p02 zombies. Each frame is the game loop's: a step unless the stage is paused, then a
 * frame. `frame(only)` runs just those seats (a hidden tab runs no frames at all).
 */
function onlineDuo(timeouts?: VersusTimeouts) {
  const clock = new VirtualClock();
  const db = memoryPair({ clock, latencyMs: 50 });
  const make = (seat: Faction): Seat => {
    const stage = fakeStage();
    const me = VS_SETUP.seats[seat];
    const other = VS_SETUP.seats[seat === 'plants' ? 'zombies' : 'plants'];
    const link = new LockstepMatch({
      match: new Match(versusConfig(VS_SETUP)), seat, delay: 12, host: seat === 'plants', me, other,
      channel: db[seat], now: () => clock.now(), timers: clock, timeouts,
    });
    const audio = new AudioEngine(() => { throw new Error('no audio in tests'); });
    const play = vi.spyOn(audio, 'play');
    const session = new BattleSession(stage, audio, {
      playerFaction: seat, skill: 'easy', seed: VS_SETUP.seed, versus: true, online: { link, me, other, timeouts },
    }, { introSeconds: 0, input: { isOverLawn: () => true } });
    sessions.push(session);
    links.push(link);
    return { stage, link, session, play, channel: db[seat] };
  };
  const a = make('plants');
  const b = make('zombies');
  for (const s of [a, b]) {
    s.link.start();
    s.session.begin();
  }
  const frame = async (only: Seat[] = [a, b]) => {
    clock.advance(VS_FRAME);
    await settle();
    for (const s of only) {
      if (!s.stage.paused) s.session.step();
      s.session.frame(0, VS_FRAME / 1000, s.stage.paused ? 0 : VS_FRAME / 1000);
    }
    await settle();
  };
  const frames = async (n: number, only?: Seat[]) => { for (let i = 0; i < n; i++) await frame(only); };
  const until = async (done: () => boolean, max = 900, only?: Seat[]) => {
    for (let i = 0; i < max && !done(); i++) await frame(only);
    expect(done()).toBe(true);
  };
  return { clock, db, a, b, frame, frames, until };
}

const links: LockstepMatch[] = [];
afterEach(() => {
  for (const l of links.splice(0)) l.dispose();
});

describe('BattleSession online', () => {
  it('shows the own pending taps on the lawn (online.pending → view.setPending) and plays place at once', async () => {
    const { a, b, until } = onlineDuo();
    const setPending = vi.spyOn(a.session.view, 'setPending');
    a.session.controller.select('peashooter');
    expect(a.session.click({ lane: 2, col: 1 }, null)).toBeNull();
    const marks = a.session.controller.online!.pending.value;
    expect(marks).toHaveLength(1);
    expect(setPending).toHaveBeenLastCalledWith(marks);
    expect(a.play).toHaveBeenCalledWith('place');
    expect(b.play).not.toHaveBeenCalledWith('place');
    await until(() => a.session.controller.online!.pending.value.length === 0);
    expect(setPending).toHaveBeenLastCalledWith([]);
    expect(a.session.view.pendingShown).toBe(0);
  });

  it('a tap refused when it runs buzzes once (no second deny from its event)', async () => {
    const { a, until } = onlineDuo();
    const me = a.session.controller.match.state.players.plants;
    me.energy = 2000;
    a.session.controller.select('potatoMine');
    expect(a.session.click({ lane: 0, col: 0 }, null)).toBeNull();
    expect(a.session.click({ lane: 3, col: 0 }, null)).toBeNull(); // the card recharges before this one runs
    expect(a.play.mock.calls.filter(([n]) => n === 'place')).toHaveLength(2);
    await until(() => a.session.controller.online!.pending.value.some((m) => m.refused));
    await until(() => a.session.controller.online!.pending.value.length === 0);
    expect(a.session.controller.hud.denied.value).toBe(1);
    expect(a.play.mock.calls.filter(([n]) => n === 'deny')).toHaveLength(1);
  });

  it('a repair redraws the lawn once from the restored state, on the same stage and canvas', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { a, b, frame, until } = onlineDuo();
    const rebuildA = vi.spyOn(a.session, 'rebuildView');
    const rebuildB = vi.spyOn(b.session, 'rebuildView');
    const canvases = document.querySelectorAll('canvas').length;
    const oldView = b.session.view;
    const oldDispose = vi.spyOn(oldView, 'dispose');
    await until(() => b.session.controller.match.state.tick >= 20);
    b.session.controller.match.state.players.plants.energy += 1; // the guest drifts
    await until(() => b.session.controller.online!.repairs.value === 1 && a.session.controller.online!.repairs.value === 1);
    await frame();
    expect(rebuildB).toHaveBeenCalledTimes(1);
    expect(rebuildA).toHaveBeenCalledTimes(1);
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(b.session.view).not.toBe(oldView);
    // one stage: still this session's, never handed over; one canvas, so one WebGL context
    expect(b.stage.director).toBe(b.session);
    expect(b.stage.handOvers).toBe(0);
    expect(document.querySelectorAll('canvas').length).toBe(canvases);
    // one lawn's worth: two bases, and the restored units drawn once each
    const bases: string[] = [];
    b.stage.scene.traverse((o) => { if (o.name === 'base-plants' || o.name === 'base-zombies') bases.push(o.name); });
    expect(bases.sort()).toEqual(['base-plants', 'base-zombies']);
    expect(b.session.view.unitCount).toBe(b.session.controller.match.state.units.length);
  });

  describe('Review Focus 5: a hidden tab pauses both screens', () => {
    it('visibility(true) writes the pause with keepalive; the other screen is paused by this boy and its stall stays none; no 2X', async () => {
      const { a, b, frames, until } = onlineDuo();
      expect(a.session.speed.offered).toBe(false);
      expect(b.session.speed.offered).toBe(false);
      await frames(20);
      const write = vi.spyOn(a.channel, 'write');
      a.session.visibility(true);
      expect(write).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pause', by: 'p01' }), { keepalive: true });
      expect(a.session.controller.online!.pausedBy.value).toBe('p01');
      expect(a.session.controller.hud.paused.value).toBe(true);
      // the hidden page draws nothing: only the other screen runs frames
      await until(() => b.session.controller.online!.pausedBy.value === 'p01', 60, [b]);
      expect(b.session.controller.hud.paused.value).toBe(true);
      const tick = b.session.controller.match.state.tick;
      await frames(90, [b]);
      expect(b.session.controller.match.state.tick).toBe(tick);
      expect(b.session.controller.online!.stall.value).toBe('none');
      // back: still paused (coming back never resumes by itself), no heartbeat silence either
      a.session.visibility(false);
      await frames(30);
      expect(a.session.controller.online!.pausedBy.value).toBe('p01');
      expect(b.session.controller.online!.pausedBy.value).toBe('p01');
    });

    it('a stale pause record in the store does not pause a screen whose streams reopen on coming back', async () => {
      const { a, b, frames, until } = onlineDuo();
      await frames(20);
      const write = vi.spyOn(a.channel, 'write');
      a.session.visibility(true);
      const pause = write.mock.calls[0]![0];
      await until(() => b.session.controller.online!.pausedBy.value === 'p01', 60, [b]);
      b.session.controller.setPaused(false);
      await until(() => a.session.controller.online!.pausedBy.value === null && b.session.controller.online!.pausedBy.value === null, 60);
      void a.channel.write(pause); // a retried pause landing after the resume: stored again
      await frames(10, [b]);
      a.session.visibility(false); // reopens the streams: the store's pause comes again
      await frames(30);
      expect(a.session.controller.online!.pausedBy.value).toBeNull();
      expect(b.session.controller.online!.pausedBy.value).toBeNull();
    });
  });

  it('keeps asking the link while paused: the stall stages move and the paused silence ends the match', async () => {
    const t: VersusTimeouts = { ...VS_TIMEOUTS, hereMs: 2000, stall: { hourglassMs: 1000, faceMs: 3000, flagMs: 5000, unfinishedMs: 8000 } };
    const { a, b, frames, until } = onlineDuo(t);
    await frames(20);
    a.session.visibility(true); // and stays hidden: only b runs frames
    await until(() => b.session.controller.online!.pausedBy.value === 'p01', 60, [b]);
    expect(b.stage.paused).toBe(true);
    const step = vi.spyOn(b.session.controller, 'step');
    await until(() => b.session.controller.online!.stall.value === 'hourglass', 200, [b]);
    expect(step).toHaveBeenCalled();
    await until(() => b.session.controller.online!.stall.value === 'face', 200, [b]);
    await until(() => b.session.controller.online!.outcome.value !== null, 400, [b]);
    expect(b.session.controller.online!.outcome.value).toEqual({ kind: 'unfinished', why: 'silence' });
  });

  it('keeps asking the link after the game is decided', async () => {
    const { a, b, frames, until } = onlineDuo();
    await frames(5);
    for (const s of [a, b]) s.session.damageBase('zombies', 1e9);
    await until(() => a.session.controller.hud.result.value !== null && b.session.controller.hud.result.value !== null);
    expect(a.session.controller.online!.outcome.value).toEqual({ kind: 'won', winner: 'plants' });
    const step = vi.spyOn(a.session.controller, 'step');
    await frames(3);
    expect(step).toHaveBeenCalled();
  });

  it('a single-player session still takes no step while paused', () => {
    const stage = fakeStage();
    const { session } = make(stage);
    session.begin();
    session.controller.setPaused(true);
    const step = vi.spyOn(session.controller, 'step');
    run(stage, 1);
    session.step(); // even asked directly
    expect(step).not.toHaveBeenCalled();
    expect(session.controller.match.state.tick).toBe(0);
  });

  it('dispose lets go of the link: a later pause from the other screen reaches no signal of the disposed one', async () => {
    const { a, b, frames } = onlineDuo();
    await frames(10);
    const online = a.session.controller.online!;
    a.session.dispose();
    b.session.controller.setPaused(true);
    await frames(20, [b]);
    expect(a.link.pausedBy).toBe('p02'); // the link itself still hears it (its owner disposes it)
    expect(online.pausedBy.value).toBeNull();
    expect(a.session.controller.hud.paused.value).toBe(false);
  });
});
