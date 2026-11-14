import { PerspectiveCamera, Scene } from 'three';
import type { Mesh, MeshBasicMaterial, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { AudioEngine, PlayOptions, SfxName } from '../../src/audio/AudioEngine';
import { playEventSounds } from '../../src/audio/bindings';
import { SFX, SFX_NAMES } from '../../src/audio/sfx';
import { Voice, makeNoise } from '../../src/audio/synth';
import { BALANCE } from '../../src/data/balance';
import { BOSS_LOOK } from '../../src/data/bossLooks';
import { factionOf } from '../../src/data/units';
import { BattleView } from '../../src/render/battle/BattleView';
import { BOSS_SCALE, STRIKE_TINT } from '../../src/render/battle/BossFx';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import { BOSS_MODELS, getModelDef } from '../../src/render/models/registry';
import { seededRandom } from '../../src/render/world/boxes';
import { Lawn } from '../../src/render/world/Lawn';
import { STRIKE_DEMOS, bossDemoMatch, strikeDemoBalance } from '../../src/scenes/bossScript';
import { BOSS_HALF_WIDTH } from '../../src/sim/types';
import type { BossKey, SimEvent, StatusKind } from '../../src/sim/types';
import { FakeAudioContext } from '../audio/fakeAudioContext';
import { allocationsIn } from './allocations';

// Worlds machinery, Task 5: the bosses' looks and sounds as one table, and any boss's strike drawn
// and heard (the Titan and the Oak themselves are pinned by bosses.test.ts and bossSounds.test.ts).

const BOSS_KEYS = Object.keys(BOSS_HALF_WIDTH) as BossKey[];

describe('BOSS_LOOK', () => {
  it('has exactly one row per boss, and every boss has its model and its numbers', () => {
    expect(Object.keys(BOSS_LOOK).sort()).toEqual([...BOSS_KEYS].sort());
    expect(Object.keys(BOSS_MODELS).sort()).toEqual([...BOSS_KEYS].sort());
    for (const key of BOSS_KEYS) {
      expect(getModelDef(key), key).toBe(BOSS_MODELS[key]);
      expect(BALANCE.bosses[key], key).toBeDefined();
      expect(factionOf(key), key).toMatch(/^(plants|zombies)$/);
    }
  });

  it.each(BOSS_KEYS)('%s: a size, a 12×12 face with two eyes, bar colours, and two sounds that exist', (key) => {
    const look = BOSS_LOOK[key];
    expect(look.scale).toBeGreaterThan(1);
    expect(BOSS_SCALE[key]).toBe(look.scale);
    expect(look.face.filter((p) => p[4] === 'eye')).toHaveLength(2);
    for (const [x, y, w, h, fill] of look.face) {
      expect(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 12 && y + h <= 12, `${key} ${x},${y}`).toBe(true);
      expect(fill === 'eye' || /^#[0-9A-F]{6}$/i.test(fill), fill).toBe(true);
    }
    expect(look.bar.fill).not.toBe('');
    expect(look.bar.hi).not.toBe('');
    expect(SFX_NAMES).toContain(look.call);
    expect(SFX_NAMES).toContain(look.defeat);
    expect(look.call).not.toBe(look.defeat);
  });

  it('the shipped bosses keep their sizes', () => {
    expect(BOSS_SCALE).toEqual({ brainTitan: 2.4, elderOak: 4 });
  });

  it('the Brain Titan\'s row is pinned: face, bar, sounds and shows as shipped', () => {
    expect(BOSS_LOOK.brainTitan).toEqual({
      scale: 2.4,
      face: [
        [1, 3, 10, 7, '#9ACD8A'], [1, 2, 10, 1, '#FFC83D'],
        [1, 0, 3, 2, '#FF8FB1'], [4.5, 0, 3, 2, '#FF8FB1'], [8, 0, 3, 2, '#FF8FB1'],
        [2, 4, 3, 3, 'eye'], [7, 5, 2, 2, 'eye'],
        [0, 8, 12, 4, '#6FA364'], [2, 7, 2, 2, '#F4EBDD'], [8, 7, 2, 2, '#F4EBDD'],
      ],
      bar: { fill: 'var(--c-purple)', hi: 'var(--c-purple-hi)' },
      call: 'titanRoar',
      defeat: 'titanDefeat',
      fx: { roar: 'cheer', summon: 'ring', shield: 'dome', defeat: 'brains', eyes: 'still' },
    });
  });

  it('the Elder Oak\'s row is pinned: face, bar, sounds and shows as shipped', () => {
    expect(BOSS_LOOK.elderOak).toEqual({
      scale: 4,
      face: [
        [0, 0, 12, 4, '#3E9A2E'], [1, 0, 10, 2, '#58C13B'],
        [2, 4, 8, 8, '#A8703A'], [3, 5, 6, 6, '#C98F55'],
        [3, 4, 2, 1, '#3E9A2E'], [7, 4, 2, 1, '#3E9A2E'],
        [3, 5, 2, 2, 'eye'], [7, 5, 2, 2, 'eye'],
        [4, 8, 4, 1, '#8BE05A'], [4, 9, 4, 1, '#24140A'],
      ],
      bar: { fill: 'var(--c-wood)', hi: 'var(--c-wood-hi)' },
      call: 'oakCreak',
      defeat: 'oakDefeat',
      fx: { roar: 'ability', summon: 'sparkles', shield: 'bark', defeat: 'leaves', eyes: 'follow' },
    });
  });
});

// ---- The strike (the demo's test-only Titan) ----------------------------------------------

const DT = 1 / 60;

function strikeStage(status: StatusKind | 'none') {
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
  const balance = strikeDemoBalance(status);
  const match = bossDemoMatch('brainTitan', 1, balance);
  const view = new BattleView(scene, camera, lawn, fx, 'plants', { balance });
  const feels: unknown[] = [];
  view.onFeel = (f) => feels.push(f);
  let time = 0;
  const strikes: Extract<SimEvent, { type: 'bossStrike' }>[] = [];
  const play = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      if (match.state.winner !== null) return;
      const events = match.step();
      for (const e of events) if (e.type === 'bossStrike') strikes.push(e);
      view.applyEvents(events, match.state);
      for (let f = 0; f < 2; f++) {
        time += DT;
        view.frame(match.state, 0.5, DT, time);
      }
    }
  };
  return { scene, view, match, play, feels, strikes, before, balance, lawn, fx, camera };
}

const visible = (o: Object3D): boolean => {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};
function shownTiles(scene: Scene): Mesh[] {
  const out: Mesh[] = [];
  scene.traverse((o) => { if (o.name === 'boss-strike-tile' && visible(o)) out.push(o as Mesh); });
  return out;
}

describe('a boss\'s strike on the lawn', () => {
  it('the strike demo is a copy: the shipped table keeps the Titan as it is', () => {
    const b = strikeDemoBalance('stun');
    expect(b.bosses.brainTitan.patterns.filter((p) => p.kind === 'strike')).toHaveLength(2);
    expect(BALANCE.bosses.brainTitan.patterns.some((p) => p.kind === 'strike')).toBe(false);
    expect(STRIKE_DEMOS).toEqual(['stun', 'blind', 'burn', 'none']);
  });

  it.each(STRIKE_DEMOS)('%s: a tinted warning on each announced tile through the wind-up, then the blow there, and they go', (status) => {
    const s = strikeStage(status);
    s.play(3.1); // the first strike winds up at 3 s
    const said = s.strikes.find((e) => e.windup)!;
    expect(said).toBeDefined();
    const tiles = shownTiles(s.scene);
    expect(tiles.length).toBe(said.tiles.length);
    expect(s.view.bossFx.striking).toBe(true);
    expect(s.view.bossFx.strikeTileCount).toBe(said.tiles.length);
    const at = tiles.map((m) => `${m.position.z - 0.5},${m.position.x - 0.5}`).sort();
    expect(at).toEqual(said.tiles.map((t) => `${t.lane},${t.col}`).sort());
    const color = (tiles[0]!.material as MeshBasicMaterial).color.getHexString().toUpperCase();
    expect(`#${color}`).toBe(STRIKE_TINT[status].toUpperCase());
    // Halfway through the wind-up the warning is still there.
    s.play(1);
    expect(shownTiles(s.scene).length).toBe(said.tiles.length);
    const feelsBefore = s.feels.length;
    s.play(1);
    const blow = s.strikes.find((e) => !e.windup)!;
    expect(blow.tiles).toEqual(said.tiles);
    expect(shownTiles(s.scene)).toHaveLength(0);
    expect(s.view.bossFx.striking).toBe(false);
    expect(s.feels.length).toBeGreaterThan(feelsBefore); // the blow shakes the camera
  });

  it('a match that ends mid wind-up takes the strike warning away, and it stays away', () => {
    const s = strikeStage('stun');
    s.play(3.5);
    expect(s.view.bossFx.striking).toBe(true);
    s.view.applyEvents([{ type: 'matchEnded', winner: 'plants' }], s.match.state);
    for (let f = 0; f < 30; f++) {
      s.view.applyEvents([], s.match.state);
      s.view.frame(s.match.state, 0.5, DT, 10 + f * DT);
    }
    expect(s.view.bossFx.striking).toBe(false);
    expect(shownTiles(s.scene)).toHaveLength(0);
  });

  it('a boss that dies mid wind-up takes its strike warning with it', () => {
    const s = strikeStage('stun');
    s.play(3.5);
    expect(s.view.bossFx.striking).toBe(true);
    expect(shownTiles(s.scene).length).toBeGreaterThan(0);
    const titan = s.match.state.units.find((u) => u.key === 'brainTitan')!;
    expect(titan.strikeTiles.length).toBeGreaterThan(0);
    titan.hp = 0; // felled before the blow lands
    const events = s.match.step();
    expect(events.some((e) => e.type === 'unitDied' && e.unitId === titan.id)).toBe(true);
    // Its fall alone takes the warning away: the match's end (which clears every warning) is held back.
    s.view.applyEvents(events.filter((e) => e.type !== 'matchEnded'), s.match.state);
    for (let f = 0; f < 30; f++) s.view.frame(s.match.state, 0.5, DT, 10 + f * DT);
    expect(events.some((e) => e.type === 'bossStrike' && !e.windup)).toBe(false); // no blow from a dead boss
    expect(s.view.bossFx.striking).toBe(false);
    expect(shownTiles(s.scene)).toHaveLength(0);
  });

  it('a lane strike warns of the whole lane (ten tiles)', () => {
    const s = strikeStage('blind');
    s.play(9.1);
    const lane = s.strikes.filter((e) => e.windup)[1]!;
    expect(lane.tiles).toHaveLength(10);
    expect(shownTiles(s.scene)).toHaveLength(10);
  });

  it('the stun tint is icy blue, blind grey, burn orange, none white', () => {
    expect(STRIKE_TINT.stun).toMatch(/^#[0-9A-F]{6}$/i);
    const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const [sr, sg, sb] = rgb(STRIKE_TINT.stun);
    expect(sb! > sr! && sg! > sr!).toBe(true);
    const [gr, gg, gb] = rgb(STRIKE_TINT.blind);
    expect(Math.max(gr!, gg!, gb!) - Math.min(gr!, gg!, gb!)).toBeLessThan(24);
    const [or, og, ob] = rgb(STRIKE_TINT.burn);
    expect(or! > og! && og! > ob!).toBe(true);
    expect(STRIKE_TINT.none.toUpperCase()).toBe('#FFFFFF');
  });

  it('a view that joins during the wind-up shows the warning from the state', () => {
    const s = strikeStage('burn');
    s.play(3.5);
    const late = new BattleView(new Scene(), s.camera, s.lawn, s.fx, 'plants', { balance: s.balance });
    late.applyEvents([], s.match.state);
    const tiles = s.match.state.units.find((u) => u.key === 'brainTitan')!.strikeTiles;
    expect(tiles.length).toBeGreaterThan(0);
    expect(late.bossFx.striking).toBe(true);
    expect(late.bossFx.strikeTileCount).toBe(tiles.length);
    late.dispose();
  });

  it('draws the warning without allocating, and dispose takes it all out of the scene', () => {
    const s = strikeStage('stun');
    s.play(3.5);
    expect(s.view.bossFx.striking).toBe(true);
    const counts = allocationsIn(() => {
      for (let i = 0; i < 20; i++) s.view.bossFx.update(DT);
    });
    expect(counts).toEqual({});
    s.view.dispose();
    expect(s.scene.children).toEqual(s.before);
  });
});

// ---- Its sounds -----------------------------------------------------------------------------

function render(name: SfxName, pitch = 1): { length: number; peak: number; sources: number } {
  const ctx = new FakeAudioContext();
  const v = new Voice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, makeNoise(ctx as unknown as BaseAudioContext));
  SFX[name](v, 1, pitch);
  const envelopes = ctx.params.filter((p) => p.name === 'gain' && p.events.length >= 3 && p.finalValue === 0);
  const peak = Math.max(0, ...envelopes.flatMap((p) => p.events.map((e) => e.value)));
  expect(ctx.allProblems(), name).toEqual([]);
  return { length: v.end - 1, peak, sources: ctx.sources().length };
}

describe('a strike\'s sounds', () => {
  it.each(['strikeWindup', 'strikeImpact'] as const)('%s renders, is audible, under 1 s, with headroom, at any pitch', (name) => {
    for (const pitch of [0.94, 1, 1.06]) {
      const r = render(name, pitch);
      expect(r.sources).toBeGreaterThanOrEqual(1);
      expect(r.length).toBeGreaterThan(0.2);
      expect(r.length).toBeLessThan(1);
      expect(r.peak).toBeGreaterThan(0.04);
      expect(r.peak).toBeLessThanOrEqual(0.6);
    }
  });

  it('the wind-up is heard as its warning, the blow as its crash, panned to the tiles', () => {
    const balance = strikeDemoBalance('stun');
    const m = bossDemoMatch('brainTitan', 1, balance);
    const heard: [SfxName, number][] = [];
    const audio = { play: (name: SfxName, opts?: PlayOptions) => heard.push([name, opts?.pan ?? 0]) } as unknown as AudioEngine;
    const strikes: Extract<SimEvent, { type: 'bossStrike' }>[] = [];
    for (let i = 0; i < 12 * 30; i++) {
      const events = m.step();
      strikes.push(...events.filter((e): e is Extract<SimEvent, { type: 'bossStrike' }> => e.type === 'bossStrike'));
      playEventSounds(audio, events, 'plants', { state: m.state });
    }
    const ours = heard.filter(([n]) => n === 'strikeWindup' || n === 'strikeImpact');
    expect(ours.map(([n]) => n)).toEqual(strikes.map((e) => (e.windup ? 'strikeWindup' : 'strikeImpact')));
    expect(ours).toHaveLength(4); // two strikes in 12 s, each a wind-up and a blow
    const lane = strikes[2]!;
    expect(lane.tiles).toHaveLength(10);
    expect(ours[2]![1]).toBeCloseTo(0); // a whole lane: in the middle
  });
});
