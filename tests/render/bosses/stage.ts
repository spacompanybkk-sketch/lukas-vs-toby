import { PerspectiveCamera, Scene } from 'three';
import type { InstancedMesh, Mesh, Object3D } from 'three';
import type { Balance } from '../../../src/data/balance';
import { factionOf } from '../../../src/data/units';
import { BattleView } from '../../../src/render/battle/BattleView';
import { Effects } from '../../../src/render/fx/Effects';
import { Particles } from '../../../src/render/fx/Particles';
import { seededRandom } from '../../../src/render/world/boxes';
import { Lawn } from '../../../src/render/world/Lawn';
import { bossDemoMatch, demoBalance } from '../../../src/scenes/bossScript';
import type { Match } from '../../../src/sim/match';
import type { BossKey, SimEvent, Unit } from '../../../src/sim/types';

// A boss demo (`bossScript.ts`) through a real BattleView, stepped by hand: the shared stage of the
// world-2 bosses' tests (step 2 Task 2).

export const DT = 1 / 60;

export function bossStage(key: BossKey, balance: Balance = demoBalance(key)) {
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
  const player = factionOf(key) === 'zombies' ? 'plants' : 'zombies';
  const view = new BattleView(scene, camera, lawn, fx, player, { balance });
  const match: Match = bossDemoMatch(key, 1, balance);
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
  /** Plays on to the step with the first event `pred` takes (at most `limit` seconds); that event, or null. */
  const until = (pred: (e: SimEvent) => boolean, limit = 120): SimEvent | null => {
    let found: SimEvent | null = null;
    for (let i = 0; i < limit * 30 && found === null && match.state.winner === null; i++) play(1 / 30, (es) => { found = es.find(pred) ?? null; });
    return found;
  };
  /** Draws frames with no step (the state held). */
  const frames = (n: number): void => {
    for (let f = 0; f < n; f++) {
      time += DT;
      view.applyEvents([], match.state);
      view.frame(match.state, 0.5, DT, time);
    }
  };
  const boss = (): Unit => match.state.units.find((u) => u.key === key) as Unit;
  return { scene, camera, lawn, fx, view, match, play, until, frames, feels, before, boss, balance };
}

const visible = (o: Object3D): boolean => {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};

/** How many objects of that name are drawn. */
export function shown(scene: Scene, name: string): number {
  let n = 0;
  scene.traverse((o) => { if (o.name === name && visible(o)) n++; });
  return n;
}

/** Whether the part of that name, on the view of the boss, is drawn (it and every parent visible). */
export function partShown(view: BattleView, id: number, part: string): boolean {
  const o = view.unit(id)?.model.root.getObjectByName(part);
  if (!o) throw new Error(`no part ${part}`);
  return visible(o);
}

function hashOf(parts: (string | number)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p) + '|';
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h;
}

/** Everything drawn in the scene, hashed: names, visibility, world matrices, colours, vertices. */
export function digest(scene: Scene): number {
  scene.updateMatrixWorld(true);
  const parts: (string | number)[] = [];
  const visible = (o: Object3D): boolean => { for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
  scene.traverse((o) => {
    parts.push(o.name, visible(o) ? 1 : 0);
    if (!visible(o)) return;
    for (const e of o.matrixWorld.elements) parts.push(Math.round(e * 1e4));
    const mesh = o as Mesh;
    if (mesh.geometry) {
      const pos = mesh.geometry.getAttribute('position');
      if (pos) { parts.push(pos.count); for (let i = 0; i < pos.array.length; i += 7) parts.push(Math.round((pos.array[i] as number) * 1e3)); }
    }
    const mat = mesh.material as { color?: { getHex(): number }; opacity?: number; emissive?: { getHex(): number }; emissiveIntensity?: number } | undefined;
    if (mat && !Array.isArray(mat)) parts.push(mat.color?.getHex() ?? -1, mat.opacity ?? -1, mat.emissive?.getHex() ?? -1, mat.emissiveIntensity ?? -1);
    const inst = o as InstancedMesh;
    if (inst.isInstancedMesh) { parts.push(inst.count); for (let i = 0; i < inst.count * 16; i += 5) parts.push(Math.round((inst.instanceMatrix.array[i] as number) * 1e3)); }
  });
  return hashOf(parts);
}
