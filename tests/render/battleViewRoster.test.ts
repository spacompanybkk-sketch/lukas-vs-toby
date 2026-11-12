import { Object3D, PerspectiveCamera, Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { BattleView } from '../../src/render/battle/BattleView';
import { Effects } from '../../src/render/fx/Effects';
import { Particles } from '../../src/render/fx/Particles';
import { seededRandom } from '../../src/render/world/boxes';
import { Lawn } from '../../src/render/world/Lawn';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import type { Projectile, ProjectileKind, SimEvent, StatusKind, Unit, UnitKey } from '../../src/sim/types';
import { MAX_LEVEL } from '../../src/sim/types';
import { allocationsIn } from './allocations';

// The phase-2 events on screen (wiring A): projectiles of all ten kinds and their flights,
// statuses, puddles, misses, heals and every unit's ability, each from its event and from the
// state a view joins late.

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
  const config = defaultConfig(7);
  config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
  const match = new Match(config);
  let time = 0;
  const run = (seconds: number, alpha = 0): void => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      time += DT;
      view.frame(match.state, alpha, DT, time);
      fx.update(DT, camera);
    }
  };
  const spawn = (key: UnitKey, lane: number, x: number): Unit => {
    const events: SimEvent[] = [];
    const u = spawnUnit(match.state, BALANCE, key, lane, x, events);
    view.applyEvents(events, match.state);
    return u;
  };
  const apply = (...events: SimEvent[]): void => view.applyEvents(events, match.state);
  return { scene, camera, view, match, run, lawn, fx, before, spawn, apply };
}

type Ctx = ReturnType<typeof setUp>;

function shot(ctx: Ctx, id: number, kind: ProjectileKind, owner: Unit, extra: Partial<Projectile> = {}): Projectile {
  const p: Projectile = {
    id, kind, faction: owner.faction, lane: owner.lane, x: owner.x, speed: 0.2, damage: 10, ownerId: owner.id,
    spawnTick: 0, flight: 'straight', sourceKey: owner.key, level: 1, targetId: null, targetX: null,
    pierceLeft: 0, hitIds: [], burning: false, burnDps: 0, burnTicks: 0, ...extra,
  };
  ctx.match.state.projectiles.push(p);
  ctx.apply({
    type: 'projectileSpawned', projectileId: id, kind, faction: p.faction, lane: p.lane, x: p.x, ownerId: owner.id,
    flight: p.flight, targetX: p.targetX,
  });
  return p;
}

function named(scene: Scene, name: string): Object3D[] {
  const found: Object3D[] = [];
  scene.traverse((o) => {
    if (o.name === name && o.parent !== null) found.push(o);
  });
  return found;
}

function visibleNamed(scene: Scene, name: string): number {
  return named(scene, name).filter((o) => {
    for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }).length;
}

const died = (u: Unit, cause: 'damage' | 'spent' = 'damage'): SimEvent => ({
  type: 'unitDied', unitId: u.id, key: u.key, faction: u.faction, lane: u.lane, x: u.x, level: u.level, cause,
});

describe('BattleView projectiles of every kind', () => {
  const owners: Record<ProjectileKind, UnitKey> = {
    pea: 'peashooter', kernel: 'kernelPult', butter: 'kernelPult', mango: 'mangoPult', brain: 'brainEater',
    sand: 'desertZombie', arrow: 'skeletonArcher', bullet: 'cowboyZombie', trident: 'tridentZombie', rot: 'brainRot',
  };
  for (const [kind, key] of Object.entries(owners) as [ProjectileKind, UnitKey][]) {
    it(`a ${kind} shows its own shape while it flies and is gone after its hit`, () => {
      const ctx = setUp();
      const owner = ctx.spawn(key, 2, owners.pea === key || key.endsWith('Pult') ? 2.5 : 6.5);
      ctx.run(0.6);
      shot(ctx, 500, kind, owner);
      ctx.run(0.3);
      expect(visibleNamed(ctx.scene, `projectile-${kind}`)).toBe(1);
      ctx.match.state.projectiles.length = 0;
      ctx.apply({ type: 'projectileHit', projectileId: 500, lane: 2, x: 4, targetId: null, targetBase: null, blocked: false, burning: false });
      ctx.run(DT);
      expect(named(ctx.scene, `projectile-${kind}`)).toHaveLength(0);
    });
  }

  it('flies a lobbed shot in a stepped arc from the muzzle to its target x, which follows the target', () => {
    const ctx = setUp();
    const pult = ctx.spawn('kernelPult', 1, 1.5);
    const zombie = ctx.spawn('brainEater', 1, 7.5);
    ctx.run(0.6);
    const p = shot(ctx, 600, 'kernel', pult, { flight: 'lobbed', targetId: zombie.id, targetX: 7.5 });
    ctx.run(0.3);
    const kernel = named(ctx.scene, 'projectile-kernel')[0] as Object3D;
    const heights: number[] = [];
    for (let x = 2.5; x <= 6.5; x += 1) {
      p.x = x;
      ctx.apply();
      ctx.apply();
      ctx.run(DT, 1);
      heights.push(kernel.position.y);
    }
    // Up over the middle and down towards the target, well above a straight shot's line.
    expect(Math.max(...heights)).toBeGreaterThan(1);
    expect(heights[2]).toBeGreaterThan(heights[0] as number);
    expect(heights[2]).toBeGreaterThan(heights[4] as number);
    // In whole voxel steps above its line, like everything else.
    // The zombie walks on: the arc now comes down further left.
    p.targetX = 6.6;
    p.x = 6.55;
    ctx.apply();
    ctx.apply();
    ctx.run(DT, 1);
    expect(kernel.position.y).toBeLessThan(0.75);
  });

  it('keeps a piercing trident flying through the units it hits until it is spent', () => {
    const ctx = setUp();
    const trident = ctx.spawn('tridentZombie', 3, 8.5);
    const plant = ctx.spawn('walnutBomb', 3, 5.5);
    ctx.run(0.6);
    const spark = vi.spyOn(ctx.fx, 'spark');
    const p = shot(ctx, 700, 'trident', trident, { flight: 'piercing', pierceLeft: 3 });
    ctx.run(0.4);
    p.x = 5.5;
    p.pierceLeft = 2;
    p.hitIds.push(plant.id);
    ctx.apply({ type: 'projectileHit', projectileId: 700, lane: 3, x: 5.5, targetId: plant.id, targetBase: null, blocked: false, burning: false });
    ctx.run(DT);
    expect(spark).toHaveBeenCalled();
    expect(visibleNamed(ctx.scene, 'projectile-trident')).toBe(1); // it carries on
    ctx.match.state.projectiles.length = 0;
    ctx.apply({ type: 'projectileHit', projectileId: 700, lane: 3, x: 0, targetId: null, targetBase: 'plants', blocked: false, burning: false });
    ctx.run(DT);
    expect(named(ctx.scene, 'projectile-trident')).toHaveLength(0);
  });

  it('swaps a pea to the burning look once the state says it burns, and back to a plain pea from the pool', () => {
    const ctx = setUp();
    const pea = ctx.spawn('peashooter', 0, 1.5);
    ctx.spawn('torchwood', 0, 3.5);
    ctx.run(0.6);
    const p = shot(ctx, 800, 'pea', pea);
    ctx.run(0.3);
    expect(visibleNamed(ctx.scene, 'projectile-pea')).toBe(1);
    p.x = 3.7;
    p.burning = true;
    ctx.apply();
    ctx.run(DT);
    expect(visibleNamed(ctx.scene, 'projectile-pea-burning')).toBe(1);
    expect(named(ctx.scene, 'projectile-pea')).toHaveLength(0);
    ctx.match.state.projectiles.length = 0;
    ctx.apply({ type: 'projectileHit', projectileId: 800, lane: 0, x: 9, targetId: null, targetBase: 'zombies', blocked: false, burning: true });
    ctx.run(DT);
    expect(named(ctx.scene, 'projectile-pea-burning')).toHaveLength(0);
  });

  it('takes away a projectile that left the state without a hit', () => {
    const ctx = setUp();
    const pea = ctx.spawn('peashooter', 0, 1.5);
    ctx.run(0.6);
    shot(ctx, 900, 'pea', pea);
    ctx.run(0.3);
    ctx.match.state.projectiles.length = 0;
    ctx.apply();
    ctx.run(DT);
    expect(named(ctx.scene, 'projectile-pea')).toHaveLength(0);
  });
});

describe('BattleView statuses and puddles', () => {
  const STATUSES: StatusKind[] = ['stun', 'blind', 'tied', 'poison', 'burn'];

  it('shows each status from statusApplied and takes it off on statusEnded', () => {
    const ctx = setUp();
    const z = ctx.spawn('brainEater', 2, 6.5);
    for (const status of STATUSES) {
      z[status] = 60;
      ctx.apply({ type: 'statusApplied', unitId: z.id, status, ticks: 60, sourceId: null });
      ctx.run(DT);
      expect(ctx.view.marks.has(z.id, status), status).toBe(true);
    }
    expect(ctx.view.marks.active).toBe(STATUSES.length);
    for (const status of STATUSES) {
      z[status] = 0;
      ctx.apply({ type: 'statusEnded', unitId: z.id, status });
      expect(ctx.view.marks.has(z.id, status), status).toBe(false);
    }
    expect(ctx.view.marks.active).toBe(0);
  });

  it('a view that joins late shows the statuses and puddles already in the state', () => {
    const ctx = setUp();
    const u = spawnUnit(ctx.match.state, BALANCE, 'peashooter', 1, 2.5);
    u.stun = 40;
    u.poison = 30;
    ctx.match.state.hazards.push({ id: 77, kind: 'rot', faction: 'zombies', lane: 1, x: 2.5, radius: 0.75, ticksLeft: 90, dps: 15, poisonTicks: 30 });
    ctx.apply();
    expect(ctx.view.marks.has(u.id, 'stun')).toBe(true);
    expect(ctx.view.marks.has(u.id, 'poison')).toBe(true);
    expect(ctx.view.marks.has(u.id, 'blind')).toBe(false);
    expect(ctx.view.puddles.has(77)).toBe(true);
  });

  it('takes the marks off a unit that dies and gives every mark back to its pool', () => {
    const ctx = setUp();
    const z = ctx.spawn('brainEater', 2, 6.5);
    const free = ctx.view.marks.free;
    z.burn = 60;
    z.blind = 60;
    ctx.apply({ type: 'statusApplied', unitId: z.id, status: 'burn', ticks: 60, sourceId: null });
    expect(ctx.view.marks.free).toBe(free - 2);
    ctx.match.state.units.length = 0;
    ctx.apply(died(z));
    expect(ctx.view.marks.active).toBe(0);
    expect(ctx.view.marks.free).toBe(free);
  });

  it('lays a puddle on hazardSpawned and takes it away on hazardEnded', () => {
    const ctx = setUp();
    const h = { id: 42, kind: 'rot' as const, faction: 'zombies' as const, lane: 3, x: 4.2, radius: 0.75, ticksLeft: 120, dps: 15, poisonTicks: 30 };
    ctx.match.state.hazards.push(h);
    ctx.apply({ type: 'hazardSpawned', hazardId: 42, kind: 'rot', lane: 3, x: 4.2, radius: 0.75, ticks: 120 });
    expect(ctx.view.puddles.has(42)).toBe(true);
    ctx.run(1);
    expect(ctx.view.puddles.opacity(42)).toBe(1);
    ctx.match.state.hazards.length = 0;
    ctx.apply({ type: 'hazardEnded', hazardId: 42 });
    expect(ctx.view.puddles.has(42)).toBe(false);
    expect(ctx.view.puddles.active).toBe(0);
  });

  it('pops a grey cross over a unit whose attack missed and green plusses over one healed', () => {
    const ctx = setUp();
    const pea = ctx.spawn('peashooter', 0, 1.5);
    const z = ctx.spawn('brainEater', 2, 6.5);
    // The view reuses one vector for every effect: keep a copy of each point as it is given.
    const misses: number[][] = [];
    const heals: number[][] = [];
    vi.spyOn(ctx.fx, 'miss').mockImplementation((at) => void misses.push(at.toArray()));
    vi.spyOn(ctx.fx, 'healPlus').mockImplementation((at) => void heals.push(at.toArray()));
    ctx.apply({ type: 'attackMissed', unitId: pea.id }, { type: 'unitHealed', unitId: z.id, amount: 40, hp: 300 });
    expect(misses).toHaveLength(1);
    expect(misses[0]?.[0]).toBeCloseTo(1.5, 5);
    expect(misses[0]?.[1]).toBeGreaterThan(0.6);
    expect(heals).toHaveLength(1);
    expect(heals[0]?.[0]).toBeCloseTo(6.5, 5);
    expect(heals[0]?.[2]).toBeCloseTo(2.5, 5);
  });
});

describe('BattleView abilities', () => {
  it('arm: the Potato Mine pops up (its ability clip) and shows its armed light; a late view shows it armed', () => {
    const ctx = setUp();
    const mine = ctx.spawn('potatoMine', 2, 4.5);
    ctx.run(0.6);
    const armed = () => (ctx.view.unit(mine.id)?.wrapper.getObjectByName('armed') as Object3D).visible;
    expect(armed()).toBe(false);
    const dirt = vi.spyOn(ctx.fx, 'dirt');
    mine.stacks = 1;
    ctx.apply({ type: 'abilityUsed', unitId: mine.id, ability: 'arm', lane: 2, x: 4.5, targetId: null });
    expect(ctx.view.unit(mine.id)?.model.clip).toBe('ability');
    expect(armed()).toBe(true);
    expect(dirt).toHaveBeenCalled();

    const late = setUp();
    const m2 = spawnUnit(late.match.state, BALANCE, 'potatoMine', 1, 3.5);
    m2.stacks = 1;
    late.apply();
    expect((late.view.unit(m2.id)?.wrapper.getObjectByName('armed') as Object3D).visible).toBe(true);
  });

  it('a mine or cherry that went off ("spent") does not crumble: the blast is the show', () => {
    const ctx = setUp();
    const mine = ctx.spawn('potatoMine', 2, 4.5);
    ctx.run(0.6);
    const debris = vi.spyOn(ctx.fx, 'debris');
    const blast = vi.spyOn(ctx.fx, 'explosion');
    ctx.match.state.units.length = 0;
    ctx.apply(
      { type: 'abilityUsed', unitId: mine.id, ability: 'trigger', lane: 2, x: 4.5, targetId: null },
      { type: 'explosion', lane: 2, x: 4.5, radius: 0.75, sourceKey: 'potatoMine' },
      died(mine, 'spent'),
    );
    expect(blast).toHaveBeenCalledTimes(1);
    expect(ctx.view.unit(mine.id)?.model.root.visible).toBe(false);
    ctx.run(0.6);
    expect(debris).not.toHaveBeenCalled();
    expect(ctx.view.unitCount).toBe(0);
  });

  it('fuse: the Cherry Bomber swells; its blast shakes harder with an 80 ms hit-stop', () => {
    const ctx = setUp();
    const feel = vi.fn();
    ctx.view.onFeel = feel;
    const cherry = ctx.spawn('cherryBomber', 1, 3.5);
    ctx.apply({ type: 'abilityUsed', unitId: cherry.id, ability: 'fuse', lane: 1, x: 3.5, targetId: null });
    expect(ctx.view.unit(cherry.id)?.model.clip).toBe('ability');
    ctx.run(1);
    ctx.match.state.units.length = 0;
    ctx.apply({ type: 'explosion', lane: 1, x: 3.5, radius: 1.6, sourceKey: 'cherryBomber' }, died(cherry, 'spent'));
    const cherryFeel = feel.mock.calls.map((c) => c[0]).find((f) => f.hitStop !== undefined);
    expect(cherryFeel?.hitStop).toBe(0.08);
    expect(cherryFeel?.shake).toBeGreaterThan(0.5);
  });

  it('leap: the Pumpkin visibly jumps to its target\'s tile and back, though the simulation never moves it', () => {
    const ctx = setUp();
    const pumpkin = ctx.spawn('pumpkinSquash', 4, 2.5);
    const z = ctx.spawn('brainEater', 4, 4.2);
    ctx.run(0.6);
    const ring = vi.spyOn(ctx.fx, 'ring');
    ctx.apply({ type: 'abilityUsed', unitId: pumpkin.id, ability: 'leap', lane: 4, x: 2.5, targetId: z.id });
    expect(ctx.view.unit(pumpkin.id)?.model.clip).toBe('ability');
    let furthest = 0;
    let highest = 0;
    for (let i = 0; i < 40; i++) {
      ctx.apply();
      ctx.run(DT);
      const at = (ctx.view.unit(pumpkin.id) as { wrapper: Object3D }).wrapper.position;
      furthest = Math.max(furthest, at.x);
      highest = Math.max(highest, at.y);
    }
    expect(furthest).toBeGreaterThan(3.9); // on the target's tile
    expect(ring).toHaveBeenCalled(); // the slam
    ctx.run(1.2);
    expect((ctx.view.unit(pumpkin.id) as { wrapper: Object3D }).wrapper.position.x).toBeCloseTo(2.5, 5);
  });

  it('lasso: a rope runs from the Cowboy to the plant for as long as the plant is tied', () => {
    const ctx = setUp();
    const cowboy = ctx.spawn('cowboyZombie', 2, 7.5);
    const plant = ctx.spawn('peashooter', 2, 3.5);
    ctx.run(0.6);
    plant.tied = 90;
    ctx.apply(
      { type: 'abilityUsed', unitId: cowboy.id, ability: 'lasso', lane: 2, x: 7.5, targetId: plant.id },
      { type: 'statusApplied', unitId: plant.id, status: 'tied', ticks: 90, sourceId: cowboy.id },
    );
    expect(ctx.view.unit(cowboy.id)?.model.clip).toBe('ability');
    ctx.run(0.5);
    expect(ctx.view.ropesShown).toBe(1);
    const rope = named(ctx.scene, 'lasso-rope').find((o) => o.visible) as Object3D;
    let lo = Infinity;
    let hi = -Infinity;
    rope.traverse((o) => {
      if (o === rope || !o.visible) return;
      lo = Math.min(lo, o.position.x);
      hi = Math.max(hi, o.position.x);
    });
    expect(lo).toBeLessThan(4.2);
    expect(hi).toBeGreaterThan(6.8);
    plant.tied = 0;
    ctx.apply({ type: 'statusEnded', unitId: plant.id, status: 'tied' });
    ctx.run(DT);
    expect(ctx.view.ropesShown).toBe(0);
  });

  it('heal shows a ring at the Necromancer; raise bursts a gravestone where the minion claws up in its own model', () => {
    const ctx = setUp();
    const necro = ctx.spawn('necromancer', 3, 8);
    ctx.run(0.6);
    const ring = vi.spyOn(ctx.fx, 'ring');
    ctx.apply({ type: 'abilityUsed', unitId: necro.id, ability: 'heal', lane: 3, x: 8, targetId: null });
    expect(ring).toHaveBeenCalledTimes(1);
    expect(ctx.view.unit(necro.id)?.model.clip).toBe('ability');
    const events: SimEvent[] = [];
    const minion = spawnUnit(ctx.match.state, BALANCE, 'boneMinion', 3, 8, events);
    ctx.apply({ type: 'abilityUsed', unitId: necro.id, ability: 'raise', lane: 3, x: 8, targetId: minion.id }, ...events);
    const minionView = ctx.view.unit(minion.id);
    expect(minionView?.wrapper.getObjectByName('boneMinion')).toBeDefined();
    expect(minionView?.model.clip).toBe('spawn');
    expect(named(ctx.scene, 'gravestone').length).toBeGreaterThan(0);
  });

  it('ignite flashes the Torchwood; grow makes Hot Topic 6% bigger per stack, from the state', () => {
    const ctx = setUp();
    const torch = ctx.spawn('torchwood', 0, 3.5);
    const hot = ctx.spawn('hotTopic', 1, 6.5);
    ctx.run(0.6);
    const sparkles = vi.spyOn(ctx.fx, 'sparkles');
    ctx.apply({ type: 'abilityUsed', unitId: torch.id, ability: 'ignite', lane: 0, x: 3.5, targetId: null });
    expect(sparkles).toHaveBeenCalled();
    ctx.run(DT);
    const root = () => (ctx.view.unit(hot.id) as { model: { root: Object3D } }).model.root;
    expect(root().scale.x).toBeCloseTo(1, 5);
    hot.stacks = 3;
    ctx.apply({ type: 'abilityUsed', unitId: hot.id, ability: 'grow', lane: 1, x: 6.5, targetId: null });
    ctx.run(0.2);
    expect(root().scale.x).toBeCloseTo(1.18, 5);
    // A merge keeps the growth when it settles.
    hot.level = 2;
    ctx.apply({ type: 'unitMerged', unitId: hot.id, level: 2 });
    ctx.run(0.7);
    expect(root().scale.x).toBeCloseTo(1.18, 5);
  });
});

describe('BattleView phase-1 fixes and pools', () => {
  it('shows the level-up marker below MAX_LEVEL only and detaches every marker on dispose', () => {
    const ctx = setUp();
    const a = ctx.spawn('peashooter', 0, 1.5);
    const b = ctx.spawn('peashooter', 1, 1.5);
    b.level = MAX_LEVEL;
    ctx.apply({ type: 'unitMerged', unitId: b.id, level: MAX_LEVEL });
    ctx.run(0.7);
    ctx.view.setMergeCue('peashooter');
    ctx.run(DT);
    expect(ctx.view.mergeMarkers).toBe(1);
    const marker = ctx.view.unit(a.id)?.wrapper.children.find((o) => o.name.startsWith('merge-marker')) ?? null;
    expect(marker).not.toBeNull();
    ctx.view.dispose();
    expect(marker?.parent ?? null).toBeNull();
  });

  it('leaves the scene as it found it when disposed, with marks, puddles, ropes and lobs out', () => {
    const ctx = setUp();
    const cowboy = ctx.spawn('cowboyZombie', 2, 7.5);
    const plant = ctx.spawn('kernelPult', 2, 3.5);
    ctx.run(0.6);
    plant.tied = 90;
    plant.stun = 60;
    ctx.match.state.hazards.push({ id: 5, kind: 'rot', faction: 'zombies', lane: 2, x: 3.5, radius: 0.75, ticksLeft: 90, dps: 15, poisonTicks: 30 });
    ctx.apply({ type: 'abilityUsed', unitId: cowboy.id, ability: 'lasso', lane: 2, x: 7.5, targetId: plant.id });
    shot(ctx, 50, 'kernel', plant, { flight: 'lobbed', targetId: cowboy.id, targetX: 7.5 });
    ctx.run(0.3);
    ctx.view.dispose();
    expect(ctx.scene.children).toEqual(ctx.before);
  });

  it('draws a busy frame of statuses, ropes and lobbed shots without allocating', () => {
    const ctx = setUp();
    const cowboy = ctx.spawn('cowboyZombie', 2, 7.5);
    const plant = ctx.spawn('kernelPult', 2, 3.5);
    const mango = ctx.spawn('mangoPult', 1, 1.5);
    const z = ctx.spawn('brainEater', 1, 7);
    ctx.run(0.6);
    plant.tied = 90;
    z.poison = 60;
    z.burn = 60;
    ctx.apply({ type: 'abilityUsed', unitId: cowboy.id, ability: 'lasso', lane: 2, x: 7.5, targetId: plant.id });
    shot(ctx, 51, 'mango', mango, { flight: 'lobbed', targetId: z.id, targetX: 7 });
    ctx.match.state.hazards.push({ id: 6, kind: 'rot', faction: 'zombies', lane: 1, x: 2.5, radius: 0.75, ticksLeft: 90, dps: 15, poisonTicks: 30 });
    ctx.apply();
    ctx.run(0.3);
    const counts = allocationsIn(() => {
      for (let i = 0; i < 30; i++) ctx.view.frame(ctx.match.state, 0.5, DT, 10 + i * DT);
    });
    expect(counts).toEqual({});
  });
});

describe('BattleView review fixes (wiring A)', () => {
  it('a view that joins late shows every projectile already flying: straight, lobbed, piercing and burning', () => {
    const first = setUp();
    const pea = first.spawn('peashooter', 0, 1.5);
    const pult = first.spawn('kernelPult', 1, 1.5);
    const z = first.spawn('brainEater', 1, 7.5);
    const trident = first.spawn('tridentZombie', 3, 8.5);
    const fire = first.spawn('peashooter', 4, 1.5);
    const s = first.match.state;
    const base = { speed: 0.2, damage: 10, spawnTick: 0, level: 1, targetId: null, targetX: null, pierceLeft: 0, hitIds: [], burning: false, burnDps: 0, burnTicks: 0 };
    s.projectiles.push(
      { ...base, id: 1, kind: 'pea', faction: 'plants', lane: 0, x: 4, ownerId: pea.id, flight: 'straight', sourceKey: 'peashooter' },
      { ...base, id: 2, kind: 'kernel', faction: 'plants', lane: 1, x: 4.5, ownerId: pult.id, flight: 'lobbed', sourceKey: 'kernelPult', targetId: z.id, targetX: 7.5 },
      { ...base, id: 3, kind: 'trident', faction: 'zombies', lane: 3, x: 6, ownerId: trident.id, flight: 'piercing', sourceKey: 'tridentZombie', pierceLeft: 2 },
      { ...base, id: 4, kind: 'pea', faction: 'plants', lane: 4, x: 5, ownerId: fire.id, flight: 'straight', sourceKey: 'peashooter', burning: true },
    );
    // A second view on the same match, made now: it has seen none of the shots fired.
    const late = new BattleView(first.scene, first.camera, first.lawn, first.fx, 'plants');
    late.applyEvents([], s);
    late.frame(s, 0, DT, 1);
    const shown = (name: string): Object3D[] => {
      const out: Object3D[] = [];
      first.scene.traverse((o) => { if (o.name === name && o.visible && o.parent === first.scene) out.push(o); });
      return out;
    };
    // The first view never ran a frame, so its objects are still hidden: only the late view's show.
    expect(shown('projectile-pea')).toHaveLength(1);
    expect(shown('projectile-pea-burning')).toHaveLength(1);
    expect(shown('projectile-trident')).toHaveLength(1);
    const kernel = shown('projectile-kernel');
    expect(kernel).toHaveLength(1);
    // Where it is now, not back at a muzzle.
    expect((kernel[0] as Object3D).position.x).toBeCloseTo(4.5, 1);
    // The lob arcs on from there: higher in the middle of the rest of its way.
    (s.projectiles[1] as Projectile).x = 6;
    late.applyEvents([], s);
    late.applyEvents([], s);
    late.frame(s, 1, DT, 1 + DT);
    expect((kernel[0] as Object3D).position.y).toBeGreaterThan(0.7);
    late.dispose();
  });

  it('a second Cowboy roping the same plant takes the rope over and the first gets its coil back', () => {
    const ctx = setUp();
    const a = ctx.spawn('cowboyZombie', 2, 7.5);
    const b = ctx.spawn('cowboyZombie', 2, 8.5);
    const plant = ctx.spawn('peashooter', 2, 3.5);
    ctx.run(0.6);
    plant.tied = 90;
    const coil = (id: number): boolean => (ctx.view.unit(id)?.wrapper.getObjectByName('lasso') as Object3D).visible;
    ctx.apply({ type: 'abilityUsed', unitId: a.id, ability: 'lasso', lane: 2, x: 7.5, targetId: plant.id });
    expect(coil(a.id)).toBe(false);
    ctx.apply({ type: 'abilityUsed', unitId: b.id, ability: 'lasso', lane: 2, x: 8.5, targetId: plant.id });
    expect(coil(a.id)).toBe(true);
    expect(coil(b.id)).toBe(false);
    expect(ctx.view.ropesShown).toBe(1);
    plant.tied = 0;
    ctx.apply({ type: 'statusEnded', unitId: plant.id, status: 'tied' });
    ctx.run(DT);
    expect(coil(b.id)).toBe(true);
  });

  it('a tied plant is not flashed white or sparked by hits while the rope holds; once free, hits flash as ever', () => {
    const ctx = setUp();
    const cowboy = ctx.spawn('cowboyZombie', 2, 7.5);
    const plant = ctx.spawn('peashooter', 2, 3.5);
    ctx.run(0.6);
    const view = ctx.view.unit(plant.id) as NonNullable<ReturnType<typeof ctx.view.unit>>;
    const hurt = vi.spyOn(view, 'hurt');
    const spark = vi.spyOn(ctx.fx, 'spark');
    plant.tied = 90;
    ctx.apply(
      { type: 'abilityUsed', unitId: cowboy.id, ability: 'lasso', lane: 2, x: 7.5, targetId: plant.id },
      { type: 'statusApplied', unitId: plant.id, status: 'tied', ticks: 90, sourceId: cowboy.id },
      { type: 'unitDamaged', unitId: plant.id, amount: 10, hp: 290 },
      { type: 'projectileHit', projectileId: 1, lane: 2, x: 3.6, targetId: plant.id, targetBase: null, blocked: false, burning: false },
    );
    expect(hurt).not.toHaveBeenCalled();
    expect(spark).not.toHaveBeenCalled();
    // Still tied a while later: hits stay quiet as long as the rope holds.
    ctx.run(0.5);
    ctx.apply({ type: 'unitDamaged', unitId: plant.id, amount: 10, hp: 280 });
    expect(hurt).not.toHaveBeenCalled();
    // Untied: hits flash as ever.
    plant.tied = 0;
    ctx.apply({ type: 'statusEnded', unitId: plant.id, status: 'tied' });
    ctx.run(0.5);
    ctx.apply({ type: 'unitDamaged', unitId: plant.id, amount: 10, hp: 270 });
    expect(hurt).toHaveBeenCalledTimes(1);
  });

  it('draws stun stars and burn flames bigger on a zombie than on a plant', () => {
    const ctx = setUp();
    const plant = ctx.spawn('peashooter', 1, 2.5);
    const zombie = ctx.spawn('skeletonWarrior', 3, 7.5);
    plant.stun = 60;
    zombie.stun = 60;
    plant.burn = 60;
    zombie.burn = 60;
    ctx.apply();
    ctx.run(0.2);
    const sizes = (status: string): number[] => named(ctx.scene, `status-${status}`).filter((o) => o.visible)
      .map((o) => (o.children[0] as Object3D).scale.x).sort((x, y) => x - y);
    for (const status of ['stun', 'burn']) {
      const [small, big] = sizes(status);
      expect(big as number).toBeGreaterThan((small as number) * 1.3);
    }
  });

  it('hides the Pumpkin\'s health bar while it is in the air, and leaves its soil pad on its own tile', () => {
    const ctx = setUp();
    const pumpkin = ctx.spawn('pumpkinSquash', 4, 2.5);
    const z = ctx.spawn('brainEater', 4, 4.2);
    pumpkin.hp = pumpkin.maxHp / 2;
    ctx.apply();
    ctx.run(0.6);
    expect(ctx.view.barsShown).toBe(1);
    ctx.apply({ type: 'abilityUsed', unitId: pumpkin.id, ability: 'leap', lane: 4, x: 2.5, targetId: z.id });
    ctx.run(0.3);
    expect(ctx.view.barsShown).toBe(0);
    const view = ctx.view.unit(pumpkin.id) as NonNullable<ReturnType<typeof ctx.view.unit>>;
    const pad = view.wrapper.getObjectByName('root') as Object3D;
    const body = view.wrapper.getObjectByName('body') as Object3D;
    pad.updateMatrixWorld(true);
    const at = new Object3D().position;
    pad.getWorldPosition(at);
    expect(at.x).toBeCloseTo(2.5, 1); // the pad stays home
    body.getWorldPosition(at);
    expect(at.x).toBeGreaterThan(3); // the pumpkin is off over its target
    ctx.run(1.2);
    expect(ctx.view.barsShown).toBe(1);
  });
});

describe('BattleView parked look items (wiring B)', () => {
  it('the Necromancer\'s heal ring is smaller than its aura and shows on every second heal only', () => {
    const ctx = setUp();
    const necro = ctx.spawn('necromancer', 3, 8);
    ctx.run(0.6);
    const ring = vi.spyOn(ctx.fx, 'ring');
    const heal = (): void => ctx.apply({ type: 'abilityUsed', unitId: necro.id, ability: 'heal', lane: 3, x: 8, targetId: null });
    heal();
    heal();
    heal();
    expect(ring).toHaveBeenCalledTimes(2);
    expect(ring.mock.calls[0]?.[2]).toBeLessThan(1);
  });

  it('a poisoned unit pulses green through its flash, and stops when the poison ends', () => {
    const ctx = setUp();
    const z = ctx.spawn('brainEater', 2, 6.5);
    ctx.run(0.3);
    z.poison = 60;
    ctx.apply({ type: 'statusApplied', unitId: z.id, status: 'poison', ticks: 60, sourceId: null });
    const view = ctx.view.unit(z.id) as NonNullable<ReturnType<typeof ctx.view.unit>>;
    const greenest = (): number => {
      let g = 0;
      view.model.root.traverse((o) => {
        const m = (o as { material?: { emissive?: { r: number; g: number; b: number } } }).material;
        if (m?.emissive && m.emissive.g > m.emissive.r && m.emissive.g > m.emissive.b) g = Math.max(g, m.emissive.g);
      });
      return g;
    };
    let seen = 0;
    for (let i = 0; i < 70; i++) {
      ctx.run(DT);
      seen = Math.max(seen, greenest());
    }
    expect(seen).toBeGreaterThan(0.25);
    z.poison = 0;
    ctx.apply({ type: 'statusEnded', unitId: z.id, status: 'poison' });
    ctx.run(DT * 2);
    expect(greenest()).toBe(0);
  });
});
