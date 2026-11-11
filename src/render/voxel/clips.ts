import type { Clip } from './types';

// Clip builders shared by all models (art bible section 5). A model picks the builders it
// needs and tells each which of its parts to move. Every clip writes offsets from the rest
// pose, touches only the parts it was given, lists those parts in `parts` so that a model
// can be checked against them, and makes no objects while sampling.
//
// Turns about Z are what the lawn camera sees as leaning: for a model that faces +X a
// positive turn tips its top backwards. Builders that lean take `facing` (1 for +X, the
// plants; −1 for −X, the zombies) so one builder serves both sides.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** The part names a clip was given, for `Clip.parts`: the model is checked against them when it is built. */
const named = (...names: (string | undefined)[]): string[] => names.filter((name): name is string => name !== undefined);

const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);
const easeInQuad = (u: number): number => u * u;
const easeOutQuad = (u: number): number => 1 - (1 - u) * (1 - u);
const easeOutCubic = (u: number): number => 1 - (1 - u) * (1 - u) * (1 - u);
const easeInOutCubic = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/**
 * Idle, a 1.6 s loop: `body` bobs half a voxel, `head` sways 3 degrees a beat behind it and
 * looks about a little, and each part in `sway` (leaves, tails, loose cloth) flutters on its
 * own beat.
 */
export function idleBob(parts: { body: string; head?: string; sway?: string[] }): Clip {
  const { body, head } = parts;
  const sway = parts.sway ?? [];
  const duration = 1.6;
  return {
    duration,
    loop: true,
    parts: named(body, head, ...sway),
    sample(t, pose) {
      const beat = (t / duration) * TAU;
      const trunk = pose[body];
      if (trunk) trunk.py = 0.5 * Math.sin(beat);
      const top = head === undefined ? undefined : pose[head];
      if (top) {
        top.rz = 3 * DEG * Math.sin(beat - 0.9);
        top.ry = 2.5 * DEG * Math.sin(beat + 1.4);
      }
      for (let i = 0; i < sway.length; i++) {
        const leaf = pose[sway[i] as string];
        if (!leaf) continue;
        // Twice and three times the beat, so it loops with the rest; each part out of step.
        leaf.rz = 5 * DEG * Math.sin(2 * beat + i * 2.4);
        leaf.rx = 3 * DEG * Math.sin(3 * beat + i * 1.7 + 0.6);
      }
    },
  };
}

/**
 * A shot, 0.4 s: 120 ms leaning back and squashing to 0.9, 80 ms snapping forward and
 * stretching to 1.1, 200 ms springing back to rest. The projectile leaves at 0.12 s, as
 * the snap begins. `body` leans from its pivot; `head` whips further and stretches along
 * its barrel.
 */
export function shootSnap(parts: { body: string; head: string }, facing: 1 | -1 = 1): Clip {
  const { body, head } = parts;
  const windUp = 0.12;
  const snap = 0.08;
  const settle = 0.2;
  const duration = windUp + snap + settle;
  return {
    duration,
    loop: false,
    parts: named(body, head),
    sample(t, pose) {
      const time = clamp(t, 0, duration);
      // 1 is fully wound back, −1 fully thrown forward, 0 at rest.
      let lean: number;
      if (time <= windUp) {
        lean = easeOutQuad(time / windUp);
      } else if (time <= windUp + snap) {
        lean = 1 - 2 * easeOutCubic((time - windUp) / snap);
      } else {
        const u = clamp((time - windUp - snap) / settle, 0, 1);
        lean = -(1 - u) * (1 - u) * Math.cos(u * 1.5 * Math.PI);
      }
      const back = lean > 0 ? lean : 0;
      const forward = lean < 0 ? -lean : 0;

      const trunk = pose[body];
      if (trunk) {
        trunk.rz = facing * DEG * (12 * back - 10 * forward);
        trunk.sy = 1 - 0.1 * back + 0.1 * forward;
        trunk.sx = trunk.sz = 1 + 0.05 * back - 0.04 * forward;
      }
      const top = pose[head];
      if (top) {
        top.rz = facing * DEG * (8 * back - 6 * forward);
        top.px = facing * (-1.5 * back + 2 * forward);
        top.sx = 1 - 0.06 * back + 0.12 * forward;
        top.sy = top.sz = 1 + 0.04 * back - 0.05 * forward;
      }
    },
  };
}

/**
 * A hit, 0.2 s: `body` is knocked two voxels towards `direction` along X (and rocks that
 * way) within 80 ms, then comes back over 120 ms. The white flash is the caller's, with
 * `ModelInstance.setFlash`.
 */
export function hitRecoil(body: string, direction: 1 | -1): Clip {
  const knock = 0.08;
  const back = 0.12;
  const duration = knock + back;
  return {
    duration,
    loop: false,
    parts: named(body),
    sample(t, pose) {
      const trunk = pose[body];
      if (!trunk) return;
      const time = clamp(t, 0, duration);
      const k = time <= knock ? easeOutCubic(time / knock) : 1 - easeInOutCubic(clamp((time - knock) / back, 0, 1));
      trunk.px = direction * 2 * k;
      trunk.rz = -direction * 7 * DEG * k;
    },
  };
}

/** How far back-out easing swings past its target: 2.17 peaks at 1.15. */
const OVERSHOOT = 2.17;

/**
 * A plant sprouting, 0.35 s: `body` rises out of the soil while growing from nothing to
 * 1.15 times its size and settling at 1.
 */
export function spawnRise(body: string): Clip {
  const duration = 0.35;
  return {
    duration,
    loop: false,
    parts: named(body),
    sample(t, pose) {
      const trunk = pose[body];
      if (!trunk) return;
      const u = clamp(t / duration, 0, 1);
      const v = u - 1;
      // A scale of exactly 0 cannot be drawn, so it starts a hair above.
      trunk.s = Math.max(0.001, 1 + (OVERSHOOT + 1) * v * v * v + OVERSHOOT * v * v);
      trunk.py = -5 * (1 - easeOutCubic(u));
      // Thin and tall on the way up.
      trunk.sy = 1 + 0.18 * Math.sin(Math.PI * u) * (1 - u);
    },
  };
}

/**
 * A plant dying, 0.2 s: `body` sags and spreads, `head` droops forward and shrinks. The
 * model stays wilted; the burst into debris is an effect.
 */
export function wilt(parts: { body: string; head?: string }, facing: 1 | -1 = 1): Clip {
  const { body, head } = parts;
  const duration = 0.2;
  return {
    duration,
    loop: false,
    parts: named(body, head),
    sample(t, pose) {
      const u = easeInQuad(clamp(t / duration, 0, 1));
      const trunk = pose[body];
      if (trunk) {
        trunk.sy = 1 - 0.4 * u;
        trunk.sx = trunk.sz = 1 + 0.12 * u;
        trunk.rz = -facing * 10 * DEG * u;
      }
      const top = head === undefined ? undefined : pose[head];
      if (top) {
        top.rz = -facing * 38 * DEG * u;
        top.py = -1.5 * u;
        top.s = 1 - 0.12 * u;
      }
    },
  };
}

/**
 * Cheering, a 0.6 s loop: `body` crouches, jumps four voxels stretched thin, and squashes
 * as it lands.
 */
export function cheerJump(body: string): Clip {
  const duration = 0.6;
  return {
    duration,
    loop: true,
    parts: named(body),
    sample(t, pose) {
      const trunk = pose[body];
      if (!trunk) return;
      const u = (((t % duration) + duration) % duration) / duration;
      // On the ground for the first and last fifth, in the air between.
      const air = Math.sin(Math.PI * clamp((u - 0.2) / 0.6, 0, 1));
      const ground = u < 0.2 ? Math.sin((Math.PI * u) / 0.2) : u > 0.8 ? Math.sin((Math.PI * (u - 0.8)) / 0.2) : 0;
      trunk.py = 4 * air;
      trunk.sy = 1 - 0.14 * ground + 0.1 * air;
      trunk.sx = trunk.sz = 1 + 0.08 * ground - 0.05 * air;
    },
  };
}
