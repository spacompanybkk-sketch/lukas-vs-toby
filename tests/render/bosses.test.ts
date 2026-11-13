import { describe, expect, it, vi } from 'vitest';
import { brainTitan } from '../../src/render/models/bosses/brainTitan';
import { elderOak } from '../../src/render/models/bosses/elderOak';
import { getModelDef } from '../../src/render/models/registry';
import { buildParts, modelStats } from '../../src/render/voxel/build';

/** A boss may cost at most this many triangles (it is one on the lawn, at 2 to 2.4 times a unit's size). */
const BOSS_TRIANGLES = 6000;

describe.each([brainTitan, elderOak])('boss model $key', (def) => {
  it('builds, is registered, and has one look', () => {
    expect(() => buildParts(def, 1)).not.toThrow();
    expect(getModelDef(def.key)).toBe(def);
    expect(def.singleLevel).toBe(true);
  });

  it(`costs at most ${BOSS_TRIANGLES} triangles`, () => {
    expect(modelStats(def, 1).triangles).toBeLessThanOrEqual(BOSS_TRIANGLES);
  });
});

// ---- The bosses on the lawn: BattleView and BossFx, from events and from the state ----------

import { PerspectiveCamera, Scene } from 'three';
import type { Object3D } from 'three';
import { BattleView } from '../../src/render/battle/BattleView';
import { BOSS_SCALE } from '../../src/render/battle/BossFx';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import { seededRandom } from '../../src/render/world/boxes';
import { Lawn } from '../../src/render/world/Lawn';
import { bossDemoMatch } from '../../src/scenes/bossScript';
import type { Match } from '../../src/sim/match';
import type { BossKey, SimEvent } from '../../src/sim/types';
import { allocationsIn } from './allocations';

const DT = 1 / 60;

function stage(key: BossKey) {
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
  const view = new BattleView(scene, camera, lawn, fx, key === 'brainTitan' ? 'plants' : 'zombies');
  const match: Match = bossDemoMatch(key, 1);
  const feels: unknown[] = [];
  view.onFeel = (f) => feels.push(f);
  let time = 0;
  /** Steps the match `seconds` long, every step's events to the view, two frames a step. */
  const play = (seconds: number, onEvents?: (e: readonly SimEvent[]) => void): void => {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      if (match.state.winner !== null) return;
      const events = match.step();
      onEvents?.(events);
      view.applyEvents(events, match.state);
      for (let f = 0; f < 2; f++) {
        time += DT;
        view.frame(match.state, 0.5, DT, time);
      }
    }
  };
  const until = (pred: (e: SimEvent) => boolean, limit = 120): SimEvent | null => {
    let found: SimEvent | null = null;
    for (let i = 0; i < limit * 30 && found === null && match.state.winner === null; i++) play(1 / 30, (es) => { found = es.find(pred) ?? null; });
    return found;
  };
  return { scene, view, match, play, until, feels, before };
}

const visible = (o: Object3D): boolean => {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};
function shown(scene: Scene, name: string): number {
  let n = 0;
  scene.traverse((o) => { if (o.name === name && visible(o)) n++; });
  return n;
}

describe('a boss on the lawn', () => {
  it.each(['brainTitan', 'elderOak'] as const)('%s comes on at its size with an entrance, and has no health bar', (key) => {
    const s = stage(key);
    s.play(1 / 30);
    const boss = s.match.state.units.find((u) => u.key === key)!;
    const view = s.view.unit(boss.id)!;
    expect(view.bulk).toBe(BOSS_SCALE[key]);
    expect(s.view.bossFx.entering).toBe(true);
    expect(s.feels.length).toBeGreaterThan(0);
    boss.hp = boss.maxHp / 2;
    s.play(1 / 30);
    expect(s.view.barsShown).toBe(0 + s.match.state.units.filter((u) => u.key !== key && u.hp < u.maxHp).length);
    s.play(1.6);
    expect(s.view.bossFx.entering).toBe(false);
  });

  it('a tap skips the entrance', () => {
    const s = stage('brainTitan');
    s.play(0.2);
    s.view.bossFx.skipEntrance();
    expect(s.view.bossFx.entering).toBe(false);
  });

  it('the slam winds up with red tiles and arrows over the three target tiles, then lands with a shake', () => {
    const s = stage('brainTitan');
    const windup = s.until((e) => e.type === 'bossPattern' && e.kind === 'slam' && e.windup);
    expect(windup).not.toBeNull();
    s.play(0.2);
    expect(s.view.bossFx.windingUp).toBe(true);
    expect(shown(s.scene, 'boss-windup-tile')).toBe(3);
    expect(shown(s.scene, 'boss-windup-arrow')).toBe(3);
    const before = s.feels.length;
    s.until((e) => e.type === 'bossPattern' && e.kind === 'slam' && !e.windup);
    s.play(0.1);
    expect(s.view.bossFx.windingUp).toBe(false);
    expect(shown(s.scene, 'boss-windup-tile')).toBe(0);
    expect(s.feels.slice(before).some((f) => (f as { shake?: number }).shake === 1)).toBe(true);
  });

  it('a stun in the middle of a wind-up keeps the tiles steady, however long it lasts in frames', () => {
    const s = stage('brainTitan');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'slam' && e.windup);
    const boss = s.match.state.units.find((u) => u.key === 'brainTitan')!;
    boss.stun = 9999; // the simulation holds its wind-up timer
    s.play(3); // twice the wind-up
    expect(s.view.bossFx.windingUp).toBe(true);
    expect(shown(s.scene, 'boss-windup-tile')).toBe(3);
  });

  it('a view that joins during a wind-up shows the tiles and plays the raised arm', () => {
    const s = stage('brainTitan');
    const m = bossDemoMatch('brainTitan', 1);
    let joinedAt = false;
    while (!joinedAt) for (const e of m.step()) if (e.type === 'bossPattern' && e.windup) joinedAt = true;
    for (let i = 0; i < 10; i++) m.step();
    s.view.applyEvents([], m.state);
    s.view.frame(m.state, 0.5, DT, 0);
    const boss = m.state.units.find((u) => u.key === 'brainTitan')!;
    expect(s.view.bossFx.windingUp).toBe(true);
    expect(shown(s.scene, 'boss-windup-tile')).toBe(3);
    expect(s.view.unit(boss.id)?.model.clip).toBe('ability');
  });

  it('each acorn in the air has a landing mark on its target\'s tile, gone when it lands', () => {
    const s = stage('elderOak');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    s.play(0.2);
    const acorns = s.match.state.projectiles.filter((p) => p.kind === 'acorn');
    expect(acorns.length).toBeGreaterThan(0);
    expect(shown(s.scene, 'boss-acorn-mark')).toBe(acorns.length);
    s.play(3);
    expect(s.match.state.projectiles.filter((p) => p.kind === 'acorn')).toHaveLength(0);
    expect(shown(s.scene, 'boss-acorn-mark')).toBe(0);
  });

  it('the Oak\'s bark claps shut (the halves slide together), and hits on it throw bark sparks', () => {
    const s = stage('elderOak');
    s.until((e) => e.type === 'bossPhase');
    expect(s.view.bossFx.barkShut).toBe(true);
    const before = s.feels.length;
    s.play(0.4);
    expect(s.feels.slice(before).some((f) => (f as { hitStop?: number }).hitStop !== undefined)).toBe(true); // the clap
    const spy = vi.spyOn(s.view.bossFx, 'barkHit');
    s.play(1);
    expect(spy).toHaveBeenCalled();
  });

  it('the Titan\'s shield dome shows while its shield is up, from the state', () => {
    const s = stage('brainTitan');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(1);
    s.play(6.2);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
  });

  it('the Oak claps its bark shut while its shield is up', () => {
    const s = stage('elderOak');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.5);
    expect(s.view.bossFx.shielded).toBe(true);
    s.play(8.2);
    expect(s.view.bossFx.shielded).toBe(false);
  });

  it.each(['brainTitan', 'elderOak'] as const)('%s plays its whole fall before it bursts, and is gone after', (key) => {
    const s = stage(key);
    s.play(1 / 30);
    s.match.state.units.find((u) => u.key === key)!.hp = 1;
    const fell = s.until((e) => e.type === 'bossDefeated', 40) as Extract<SimEvent, { type: 'bossDefeated' }> | null;
    expect(fell).not.toBeNull();
    const id = fell!.unitId;
    for (let i = 0; i < 30; i++) s.view.frame(s.match.state, 0.5, DT, 50 + i * DT);
    expect(s.view.unit(id)?.model.root.visible).toBe(true); // still falling half a second on
    for (let i = 0; i < 120; i++) s.view.frame(s.match.state, 0.5, DT, 60 + i * DT);
    expect(s.view.unit(id)).toBeUndefined();
  });

  it.each(['brainTitan', 'elderOak'] as const)('%s: a view that joins late shows it at its size, its shield and no entrance', (key) => {
    const s = stage(key);
    const m = bossDemoMatch(key, 1);
    const shielded = (): boolean => m.state.units.some((u) => u.key === key && u.shieldLeft > 30);
    while (!shielded() && m.state.winner === null) m.step();
    const boss = m.state.units.find((u) => u.key === key)!;
    expect(boss.shieldLeft).toBeGreaterThan(0);
    s.view.applyEvents([], m.state);
    s.view.frame(m.state, 0.5, DT, 0);
    expect(s.view.unit(boss.id)?.bulk).toBe(BOSS_SCALE[key]);
    expect(s.view.bossFx.entering).toBe(false);
    expect(s.view.bossFx.shielded).toBe(true);
  });

  it('draws boss frames (wind-up, shield, rolling acorns) without allocating', () => {
    for (const key of ['brainTitan', 'elderOak'] as const) {
      const s = stage(key);
      s.play(key === 'brainTitan' ? 11 : 34.5);
      // The boss shows' own frame work (the rest of the view's frame is covered by its own tests).
      const counts = allocationsIn(() => {
        for (let i = 0; i < 20; i++) s.view.bossFx.update(DT);
      });
      expect(counts, key).toEqual({});
    }
  });

  it('dispose takes everything it added out of the scene', () => {
    const s = stage('elderOak');
    s.play(12);
    s.view.dispose();
    expect(s.scene.children).toEqual(s.before);
  });
});
