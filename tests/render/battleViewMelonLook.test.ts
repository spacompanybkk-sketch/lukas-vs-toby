import { InstancedMesh, PerspectiveCamera, Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/data/balance';
import { BattleView } from '../../src/render/battle/BattleView';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import { seededRandom } from '../../src/render/world/boxes';
import { Lawn } from '../../src/render/world/Lawn';
import { Match, defaultConfig } from '../../src/sim/match';
import { spawnAtLevel } from '../../src/sim/spawn';
import type { Projectile, SimEvent, UnitKey } from '../../src/sim/types';

// Polish batch 1, task 3: the Frost Melon fight reads clearly under a crowd of zombies (A3 the hit
// flash, A4 the health bars; A9's colour is pinned in bosses/frostMelon.test.ts).

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
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      time += DT;
      view.frame(match.state, 0, DT, time);
      fx.update(DT, camera);
    }
  };
  return { scene, view, match, run };
}

/** Hits `key` on every frame for a second: how many separate flashes start, and the brightest one. */
function flashesUnderCrowd(key: UnitKey, faction: 'plants' | 'zombies'): { starts: number; peak: number } {
  const ctx = setUp();
  const events: SimEvent[] = [];
  const u = spawnAtLevel(ctx.match.state, BALANCE, key, 2, faction === 'plants' ? 1 : 6, 1, events);
  ctx.view.applyEvents(events, ctx.match.state);
  ctx.run(0.5);
  const unit = ctx.view.unit(u.id) as unknown as { model: { setFlash: (n: number, tint?: unknown) => void } };
  const seen: number[] = [];
  const real = unit.model.setFlash.bind(unit.model);
  vi.spyOn(unit.model, 'setFlash').mockImplementation((n, tint) => { seen.push(n); real(n, tint); });
  const hit: SimEvent = { type: 'unitDamaged', unitId: u.id, hp: u.hp - 1, amount: 1 } as SimEvent;
  for (let f = 0; f < 60; f++) {
    ctx.view.applyEvents([hit], ctx.match.state);
    ctx.run(DT);
  }
  let starts = 0;
  for (let i = 0; i < seen.length; i++) if ((seen[i] as number) > 0 && (i === 0 || (seen[i - 1] as number) === 0)) starts++;
  return { starts, peak: Math.max(...seen) };
}

describe('the hit flash under a crowd (A3)', () => {
  it('starts at most once per 150 ms on a unit, however often it is hit', () => {
    const { starts, peak } = flashesUnderCrowd('brainEater', 'zombies');
    expect(starts).toBeLessThanOrEqual(Math.ceil(1 / 0.15));
    expect(starts).toBeGreaterThan(1);
    expect(peak).toBe(1);
  });

  it('keeps the bitten Melon from going solid white: a part flash, and far less often', () => {
    const { starts, peak } = flashesUnderCrowd('frostMelon', 'plants');
    expect(starts).toBeLessThanOrEqual(2);
    expect(peak).toBeLessThan(0.7);
    expect(peak).toBeGreaterThan(0);
  });
});

describe('a boss\'s shield flash (A3)', () => {
  it('still shows right after a hit flash, 150 ms on', () => {
    const ctx = setUp();
    const events: SimEvent[] = [];
    const u = spawnAtLevel(ctx.match.state, BALANCE, 'frostMelon', 2, 0.6, 1, events);
    ctx.view.applyEvents(events, ctx.match.state);
    ctx.run(0.5);
    const unit = ctx.view.unit(u.id) as unknown as { hurt: () => void; flash: () => void; flashFor: number };
    unit.hurt();
    ctx.run(0.2);
    unit.flash();
    expect(unit.flashFor).toBe(0);
  });
});

describe('the Melon\'s frozen barrage comes from the projectile\'s source (A3)', () => {
  it('flies frozen melons even when the boss\'s view is not there to ask', () => {
    const ctx = setUp();
    const projectile = {
      id: 77, kind: 'acorn', faction: 'plants', flight: 'lobbed', lane: 2, x: 2, targetX: 7, ownerId: 9999,
      sourceKey: 'frostMelon', level: 1, spawnTick: 0,
    } as unknown as Projectile;
    ctx.match.state.projectiles.push(projectile);
    ctx.view.applyEvents(
      [{ type: 'projectileSpawned', projectileId: 77, kind: 'acorn', faction: 'plants', flight: 'lobbed', lane: 2, x: 2, targetX: 7, ownerId: 9999 } as SimEvent],
      ctx.match.state,
    );
    let frozen = 0;
    let acorn = 0;
    ctx.scene.traverse((o) => {
      if (o.name === 'projectile-frozen-melon') frozen++;
      if (o.name === 'projectile-acorn') acorn++;
    });
    expect(frozen).toBe(1);
    expect(acorn).toBe(0);
  });
});

describe('the health bars at the Melon (A4)', () => {
  function bars(withBoss: boolean, clumpX = 1.8): number {
    const ctx = setUp();
    const events: SimEvent[] = [];
    if (withBoss) spawnAtLevel(ctx.match.state, BALANCE, 'frostMelon', 2, 0.6, 1, events);
    for (let i = 0; i < 9; i++) {
      const z = spawnAtLevel(ctx.match.state, BALANCE, 'skeletonWarrior', 2, clumpX, 1, events);
      z.hp = Math.round(z.maxHp * 0.85);
    }
    ctx.view.applyEvents(events, ctx.match.state);
    ctx.run(1.5);
    const mesh = ctx.scene.getObjectByName('health-bars') as InstancedMesh;
    return mesh.count / 3; // the outline, track and fill of a bar with no pips
  }

  it('shows no more than three bars of a clump biting it, and none of the Melon\'s own', () => {
    expect(bars(true)).toBeLessThanOrEqual(3);
    expect(bars(true)).toBeGreaterThan(0);
  });

  it('leaves a clump away from any boss as it was: every bar', () => {
    expect(bars(false)).toBe(9);
  });

  it('leaves a clump far from the Melon alone too: every bar, the rule is for the clump biting it', () => {
    expect(bars(true, 8.5)).toBe(9);
  });
});
