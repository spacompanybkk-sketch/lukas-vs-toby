import { InstancedMesh, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Effects } from '../../src/render/fx/Effects';
import { Particles, type ParticleSpec } from '../../src/render/fx/Particles';
import { seededRandom } from '../../src/render/world/boxes';

function spec(overrides: Partial<ParticleSpec> = {}): ParticleSpec {
  return {
    position: new Vector3(5, 1, 2.5),
    velocity: new Vector3(0, 0, 0),
    color: 0xffffff,
    size: 0.08,
    life: 1,
    ...overrides,
  };
}

/** Runs `seconds` of updates at 60 frames a second. */
function run(particles: Particles, seconds: number, effects?: Effects): void {
  const camera = new PerspectiveCamera();
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    // Effects move the pool they were given; on its own the pool is moved directly.
    if (effects) effects.update(1 / 60, camera);
    else particles.update(1 / 60);
  }
}

describe('Particles', () => {
  it('is one instanced mesh of cubes with room for 2,000', () => {
    const particles = new Particles();
    expect(particles.capacity).toBe(2000);
    expect(particles.object).toBeInstanceOf(InstancedMesh);
    expect(particles.alive).toBe(0);
  });

  it('replaces the oldest particle once it is full', () => {
    const particles = new Particles();
    for (let i = 0; i < 2500; i++) particles.emit(spec({ position: new Vector3(i, 1, 0) }));
    expect(particles.alive).toBe(2000);
    // The first 500 went; the newest is still there.
    const xs = particles.alivePositions().filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBe(500);
    expect(Math.max(...xs)).toBe(2499);
  });

  it('lets a particle go when its life is over', () => {
    const particles = new Particles();
    particles.emit(spec({ life: 0.5 }));
    run(particles, 0.3);
    expect(particles.alive).toBe(1);
    run(particles, 0.3);
    expect(particles.alive).toBe(0);
  });

  it('bounces a falling particle off the ground instead of letting it through', () => {
    const particles = new Particles();
    particles.emit(spec({ position: new Vector3(5, 1, 2.5), gravity: 9, bounce: 0.4, life: 3 }));
    let lowest = Infinity;
    let bounced = false;
    let last = 1;
    for (let i = 0; i < 180; i++) {
      particles.update(1 / 60);
      const y = particles.alivePositions()[1] as number;
      lowest = Math.min(lowest, y);
      if (y > last + 1e-6) bounced = true;
      last = y;
    }
    expect(lowest).toBeGreaterThanOrEqual(0);
    expect(bounced).toBe(true);
  });

  it('never allocates per frame: the same buffers before and after a busy second', () => {
    const particles = new Particles();
    const mesh = particles.object as InstancedMesh;
    const matrices = mesh.instanceMatrix.array;
    for (let i = 0; i < 300; i++) particles.emit(spec({ velocity: new Vector3(1, 3, 0), gravity: 9, bounce: 0.3 }));
    run(particles, 1);
    expect(mesh.instanceMatrix.array).toBe(matrices);
  });
});

describe('Effects', () => {
  it('an explosion throws at least 20 particles', () => {
    const particles = new Particles();
    const effects = new Effects(particles, seededRandom(1));
    effects.explosion(new Vector3(5, 0, 2.5), 1.2);
    expect(particles.alive).toBeGreaterThanOrEqual(20);
  });

  it('every effect emits something or shows something, and none of them throws', () => {
    const particles = new Particles();
    const effects = new Effects(particles, seededRandom(2));
    const at = new Vector3(4, 0.4, 2.5);
    const target = new Object3D();
    target.position.set(3, 0, 1.5);
    effects.burst(at, [0x58c13b, 0x3e9a2e], 12, 2);
    effects.debris(at, [0x9acd8a, 0x7b4bd6], 3);
    effects.dirt(at);
    effects.puff(at);
    effects.spark(at);
    effects.blockFlash(at);
    effects.ring(at, 0xffc83d, 1);
    effects.sparkles(at, 0xffc83d);
    effects.smoke(at);
    for (let i = 0; i < 30; i++) {
      effects.aura(target, 0xffc83d);
      effects.trail(target, 0x7ed957);
      run(particles, 1 / 60, effects);
    }
    // No 2D canvas in node: floating text quietly does nothing.
    expect(() => effects.floatText(at, '+25', '#FFD54A')).not.toThrow();
    expect(particles.alive).toBeGreaterThan(60);
    run(particles, 3, effects);
    expect(particles.alive).toBe(0);
  });

  it('moves the particle pool it was given, and a second, direct update in the same frame does nothing', () => {
    const particles = new Particles();
    const effects = new Effects(particles, seededRandom(3));
    particles.emit(spec({ velocity: new Vector3(1, 0, 0), life: 2 }));
    const camera = new PerspectiveCamera();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    effects.update(0.5, camera);
    particles.update(0.5);
    warn.mockRestore();
    expect(particles.alivePositions()[0]).toBeCloseTo(5.5, 6);
  });

  it('is repeatable: the same random gives the same particles in the same places', () => {
    const once = (): number[] => {
      const particles = new Particles();
      const effects = new Effects(particles, seededRandom(77));
      effects.explosion(new Vector3(5, 0, 2.5), 1.2);
      effects.debris(new Vector3(3, 0.3, 1.5), [0x58c13b, 0x2f7d32], 2);
      run(particles, 0.4, effects);
      return particles.alivePositions();
    };
    const a = once();
    const b = once();
    expect(a.length).toBeGreaterThan(60);
    expect(b).toEqual(a);
  });
});
