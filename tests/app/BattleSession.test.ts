// @vitest-environment happy-dom
import { Mesh, PerspectiveCamera, Scene, Vector3, type ShaderMaterial } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import type { Faction } from '../../src/sim/types';

const DT = 1 / 60;

/** The stage without WebGL: a real scene, camera, rig, lawn and effects; `show` and `release` as the real one. */
function fakeStage(): StageLike & { handOvers: number } {
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

  it('as plants: a tap on the top of the own Peashooter, with its card, merges into it (not a new plant on the lane behind)', () => {
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
    // The top of the model lies over the grass of the lane behind.
    const top = onModel(session, stage, plant.id, 0.85);
    expect(session.pick(top.x, top.y).tile?.lane).toBe(2);
    ready(session);
    tap(stage, top.x, top.y);
    run(stage, 0.1);
    expect(plant.level).toBe(2);
    expect(session.controller.match.state.units.filter((u) => u.key === 'peashooter')).toHaveLength(1);
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

  it('shows a level-up marker over each own unit a merge is possible into, and a tap on the marker merges', () => {
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
    const marker = onModel(session, stage, plant.id, 1, 0.45);
    tap(stage, marker.x, marker.y);
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
