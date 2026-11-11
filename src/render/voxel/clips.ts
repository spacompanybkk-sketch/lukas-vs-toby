import type { Clip, PartPose } from './types';

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

/** A spring back to rest after a peak: 1 at u = 0, 0 at u = 1, swinging a little past 0 once. */
const springBack = (u: number): number => (1 - u) * (1 - u) * Math.cos(u * 1.5 * Math.PI);

/**
 * A sunflower paying out, 0.5 s: over 150 ms the `head` nods forward 12 degrees and swells
 * to 1.12 while the `petals` (if named) flare to 1.3 times their spread in the plane of the
 * face; then all spring back to rest. Frozen at 0.15 s it is at its fullest.
 */
export function sunPulse(head: string, petals?: string): Clip {
  const rise = 0.15;
  const duration = 0.5;
  return {
    duration,
    loop: false,
    parts: named(head, petals),
    sample(t, pose) {
      const time = clamp(t, 0, duration);
      const k = time <= rise ? easeOutCubic(time / rise) : springBack((time - rise) / (duration - rise));
      const top = pose[head];
      if (top) {
        top.rz = -12 * DEG * k;
        top.s = 1 + 0.12 * k;
      }
      const ring = petals === undefined ? undefined : pose[petals];
      if (ring) ring.sy = ring.sz = 1 + 0.3 * k;
    },
  };
}

/**
 * Heavy breathing, a 1.6 s loop: `body` heaves, wider and taller on the breath in (a slow
 * draw, a quicker sigh out), `head` lifts with it, and each part in `sway` flutters as in
 * `idleBob`.
 */
export function breathe(parts: { body: string; head?: string; sway?: string[] }): Clip {
  const { body, head } = parts;
  const sway = parts.sway ?? [];
  const duration = 1.6;
  return {
    duration,
    loop: true,
    parts: named(body, head, ...sway),
    sample(t, pose) {
      const beat = (t / duration) * TAU;
      // 0 breathed out, 1 breathed in; the second harmonic makes the draw slow and the sigh quick.
      const breath = 0.5 + 0.43 * Math.sin(beat) + 0.12 * Math.sin(2 * beat - 0.6);
      const trunk = pose[body];
      if (trunk) {
        trunk.sx = trunk.sz = 1 + 0.07 * breath;
        trunk.sy = 1 + 0.05 * breath;
      }
      const top = head === undefined ? undefined : pose[head];
      if (top) {
        top.py = 0.6 * breath;
        top.rz = 2 * DEG * Math.sin(beat - 0.5);
      }
      for (let i = 0; i < sway.length; i++) {
        const loose = pose[sway[i] as string];
        if (!loose) continue;
        loose.rz = 6 * DEG * Math.sin(2 * beat + i * 2.4);
        loose.rx = 4 * DEG * Math.sin(3 * beat + i * 1.7 + 0.6);
      }
    },
  };
}

/**
 * A hit on something heavy, 0.3 s: `body` is knocked two voxels towards `direction` within
 * 80 ms, as `hitRecoil`, and comes back rocking to and fro before it settles.
 */
export function hitWobble(body: string, direction: 1 | -1): Clip {
  const knock = 0.08;
  const duration = 0.3;
  return {
    duration,
    loop: false,
    parts: named(body),
    sample(t, pose) {
      const trunk = pose[body];
      if (!trunk) return;
      const time = clamp(t, 0, duration);
      if (time <= knock) {
        const k = easeOutCubic(time / knock);
        trunk.px = direction * 2 * k;
        trunk.rz = -direction * 7 * DEG * k;
        trunk.sy = 1 - 0.06 * k;
        return;
      }
      const u = (time - knock) / (duration - knock);
      const fade = (1 - u) * (1 - u);
      trunk.px = direction * 2 * (1 - easeInOutCubic(u));
      // Two and a half swings, dying away.
      trunk.rz = -direction * 7 * DEG * fade * Math.cos(u * 5 * Math.PI);
      trunk.sy = 1 - 0.06 * fade * Math.cos(u * 4 * Math.PI);
    },
  };
}

/**
 * The fuse burns down, 0.2 s: `body` swells to 1.3 times its size, slowly and then fast,
 * trembling as it goes, and holds there. The blast itself is an effect.
 */
export function swellBlast(body: string): Clip {
  const duration = 0.2;
  return {
    duration,
    loop: false,
    parts: named(body),
    sample(t, pose) {
      const trunk = pose[body];
      if (!trunk) return;
      const u = clamp(t / duration, 0, 1);
      trunk.s = 1 + 0.3 * easeInQuad(u);
      // A shiver that grows with the pressure and is still at the very end.
      const shiver = Math.sin(u * 9 * Math.PI) * u * (1 - u);
      trunk.px = 1.2 * shiver;
      trunk.sy = 1 + 0.06 * shiver;
    },
  };
}

// ---- Zombies ---------------------------------------------------------------------------------
//
// The zombie builders move a biped's parts (see models/zombies/biped.ts): `root` (the hips,
// and everything), `torso`, `head`, `armL`, `armR`, `legL`, `legR`. Zombies face −X, so a
// positive turn about Z tips a part forward. Their arms are modelled reaching forward: a
// negative turn about Z lifts the hand, a positive one drops it. `L` is the zombie's left,
// on the +Z side, which is the side the lawn camera sees.

/** The parts of a biped, by job, for a model that names its own. */
export interface BipedParts {
  root: string;
  torso: string;
  head: string;
  armL: string;
  armR: string;
  legL: string;
  legR: string;
}

const BIPED: BipedParts = { root: 'root', torso: 'torso', head: 'head', armL: 'armL', armR: 'armR', legL: 'legL', legR: 'legR' };
const bipedOf = (parts?: Partial<BipedParts>): BipedParts => ({ ...BIPED, ...parts });
const allOf = (p: BipedParts): string[] => [p.root, p.torso, p.head, p.armL, p.armR, p.legL, p.legR];

/**
 * A walk, looping every `stepSeconds` (two steps): legs swing ±25° from the hip, the arms
 * ±15° against them, the body bobs a voxel (up as the legs pass, down at the full stride)
 * and rolls ±4° onto the leg it stands on. A runner asks for a bigger stride and swing;
 * `cycles` fits that many cycles into `stepSeconds`, for jogging on the spot.
 */
export function zombieWalk(
  stepSeconds: number,
  opts: { legs?: number; arms?: number; bob?: number; roll?: number; cycles?: number; parts?: Partial<BipedParts> } = {},
): Clip {
  const p = bipedOf(opts.parts);
  /** Whole cycles to the clip's length: more than one jogs on the spot inside a longer loop. */
  const cycles = Math.max(1, Math.round(opts.cycles ?? 1));
  const legs = (opts.legs ?? 25) * DEG;
  const arms = (opts.arms ?? 15) * DEG;
  const bob = opts.bob ?? 1;
  const roll = (opts.roll ?? 4) * DEG;
  const duration = stepSeconds;
  return {
    duration,
    loop: true,
    parts: allOf(p),
    sample(t, pose) {
      const phase = (t / duration) * TAU * cycles;
      const swing = Math.sin(phase);
      // The left foot goes forward (−X) first: a negative turn of a hanging leg.
      (pose[p.legL] as PartPose).rz = -legs * swing;
      (pose[p.legR] as PartPose).rz = legs * swing;
      // Each arm against its own leg.
      (pose[p.armL] as PartPose).rz = arms * swing;
      (pose[p.armR] as PartPose).rz = -arms * swing;
      // And it reaches forward with the arm that is up.
      (pose[p.armL] as PartPose).px = 0.6 * swing;
      (pose[p.armR] as PartPose).px = -0.6 * swing;
      const hips = pose[p.root] as PartPose;
      hips.py = (bob / 2) * Math.cos(2 * phase);
      hips.rx = roll * swing;
      const chest = pose[p.torso] as PartPose;
      chest.ry = 5 * DEG * swing;
      chest.rz = 2 * DEG * Math.cos(2 * phase);
      const top = pose[p.head] as PartPose;
      top.rx = -0.6 * roll * swing;
      top.rz = -2 * DEG * Math.cos(2 * phase - 0.8);
    },
  };
}

/**
 * Standing about, a 1.6 s loop: the torso sways and bobs, the head lolls a beat behind,
 * the arms bob out of step with each other, and each part in `sway` flutters.
 */
export function zombieIdle(sway: string[] = [], parts?: Partial<BipedParts>): Clip {
  const p = bipedOf(parts);
  const duration = 1.6;
  return {
    duration,
    loop: true,
    parts: named(p.torso, p.head, p.armL, p.armR, ...sway),
    sample(t, pose) {
      const beat = (t / duration) * TAU;
      const chest = pose[p.torso] as PartPose;
      chest.py = 0.5 * Math.sin(beat);
      chest.rx = 3 * DEG * Math.sin(beat + 0.4);
      const top = pose[p.head] as PartPose;
      top.rx = 4 * DEG * Math.sin(beat - 0.9);
      top.rz = 3 * DEG * Math.sin(2 * beat - 0.5);
      (pose[p.armL] as PartPose).rz = 6 * DEG * Math.sin(beat + 1.2);
      (pose[p.armR] as PartPose).rz = 6 * DEG * Math.sin(beat + 2.8);
      for (let i = 0; i < sway.length; i++) {
        const loose = pose[sway[i] as string];
        if (!loose) continue;
        loose.rz = 6 * DEG * Math.sin(2 * beat + i * 2.4);
        loose.rx = 4 * DEG * Math.sin(3 * beat + i * 1.7 + 0.6);
      }
    },
  };
}

/**
 * A bite, 0.48 s by default (art bible section 5): 150 ms winding back, the head up and the
 * arms raised; an 80 ms lunge with the head snapping down and the arms clapping; 250 ms
 * back to rest. A `jaw`, if named, is open wide at the wind-up and shut at the strike.
 * Other lengths keep the same proportions.
 */
export function zombieBite(opts: { jaw?: string; duration?: number; parts?: Partial<BipedParts> } = {}): Clip {
  const p = bipedOf(opts.parts);
  const duration = opts.duration ?? 0.48;
  const windUp = duration * (0.15 / 0.48);
  const strike = duration * (0.08 / 0.48);
  const recover = duration - windUp - strike;
  return {
    duration,
    loop: false,
    parts: named(p.torso, p.head, p.armL, p.armR, opts.jaw),
    sample(t, pose) {
      const time = clamp(t, 0, duration);
      // 1 wound back, −1 lunged, 0 at rest.
      let k: number;
      if (time <= windUp) k = easeOutQuad(time / windUp);
      else if (time <= windUp + strike) k = 1 - 2 * easeOutCubic((time - windUp) / strike);
      else k = -springBack(clamp((time - windUp - strike) / recover, 0, 1));
      const back = k > 0 ? k : 0;
      const lunge = k < 0 ? -k : 0;
      const chest = pose[p.torso] as PartPose;
      chest.rz = DEG * (-12 * back + 16 * lunge);
      chest.px = -2 * lunge + 0.5 * back;
      const top = pose[p.head] as PartPose;
      top.rz = DEG * (-14 * back + 14 * lunge);
      top.s = 1 + 0.08 * lunge;
      (pose[p.armL] as PartPose).rz = DEG * (-35 * back + 22 * lunge);
      (pose[p.armR] as PartPose).rz = DEG * (-35 * back + 22 * lunge);
      if (opts.jaw) {
        const jaw = pose[opts.jaw] as PartPose;
        // Wide open with the wind-up, snapped shut on the strike (a jaw that hangs open at
        // rest closes then), back to rest as it recovers.
        jaw.rz = DEG * (30 * back - 18 * lunge);
      }
    },
  };
}

/**
 * A throw, 0.4 s: 120 ms winding the arm back, 80 ms throwing it forward (the projectile
 * leaves at 0.12 s), 200 ms back to rest. Overarm by default (the hand goes up over the
 * shoulder); `underarm` swings it down and back first, for a lob. The three lengths can be
 * set: with 0.15, 0.08 and 0.25 s it is the art bible's melee, a chop with a sword.
 */
export function zombieThrow(
  opts: { arm?: string; underarm?: boolean; windUp?: number; snap?: number; settle?: number; parts?: Partial<BipedParts> } = {},
): Clip {
  const p = bipedOf(opts.parts);
  const arm = opts.arm ?? p.armR;
  const under = opts.underarm === true;
  const windUp = opts.windUp ?? 0.12;
  const snap = opts.snap ?? 0.08;
  const settle = opts.settle ?? 0.2;
  const duration = windUp + snap + settle;
  return {
    duration,
    loop: false,
    parts: named(p.torso, p.head, arm),
    sample(t, pose) {
      const time = clamp(t, 0, duration);
      let k: number;
      if (time <= windUp) k = easeOutQuad(time / windUp);
      else if (time <= windUp + snap) k = 1 - 2 * easeOutCubic((time - windUp) / snap);
      else k = -springBack(clamp((time - windUp - snap) / settle, 0, 1));
      const back = k > 0 ? k : 0;
      const forward = k < 0 ? -k : 0;
      const chest = pose[p.torso] as PartPose;
      chest.rz = DEG * (-10 * back + 12 * forward);
      chest.ry = DEG * (under ? 8 : -12) * back;
      const top = pose[p.head] as PartPose;
      top.rz = DEG * (-6 * back + 4 * forward);
      const limb = pose[arm] as PartPose;
      // Overarm: up and back over the shoulder, then down in front. Underarm: down and back, then up.
      limb.rz = under ? DEG * (80 * back - 40 * forward) : DEG * (-130 * back + 30 * forward);
      limb.px = 1.2 * back - 0.8 * forward;
    },
  };
}

/**
 * Rising from the grave, 0.5 s: the body comes up out of the ground, overshooting a little
 * and settling, arms clawing up and over, swaying as it climbs. It ends at rest.
 */
export function zombieRise(parts?: Partial<BipedParts>): Clip {
  const p = bipedOf(parts);
  const duration = 0.5;
  return {
    duration,
    loop: false,
    parts: named(p.root, p.torso, p.head, p.armL, p.armR),
    sample(t, pose) {
      const u = clamp(t / duration, 0, 1);
      const v = u - 1;
      // Back-out easing from 0 to 1, peaking a little over.
      const up = 1 + (OVERSHOOT + 1) * v * v * v + OVERSHOOT * v * v;
      const hips = pose[p.root] as PartPose;
      hips.py = -16 * (1 - up);
      hips.rx = 8 * DEG * Math.sin(u * 3 * Math.PI) * (1 - u);
      const chest = pose[p.torso] as PartPose;
      chest.rz = 14 * DEG * Math.sin(Math.PI * u) * (1 - u);
      const top = pose[p.head] as PartPose;
      top.rz = -12 * DEG * Math.sin(Math.PI * u) * (1 - u);
      // Claw: both arms up, out of step, coming down as it stands.
      const claw = Math.sin(Math.PI * Math.min(1, u * 1.25));
      (pose[p.armL] as PartPose).rz = -70 * DEG * claw * (1 - u * 0.2) + 15 * DEG * Math.sin(u * 4 * Math.PI) * (1 - u);
      (pose[p.armR] as PartPose).rz = -70 * DEG * claw * (1 - u * 0.2) - 15 * DEG * Math.sin(u * 4 * Math.PI) * (1 - u);
    },
  };
}

/**
 * Falling apart, 0.35 s: the head pops up off the shoulders and tumbles away behind, the
 * arms drop, the legs fold and the body slumps forward and sinks. Nothing is squashed, so
 * the head and what the hands hold keep their shape. It stays like that; the debris and
 * the puff are effects.
 */
export function zombieCrumble(parts?: Partial<BipedParts>): Clip {
  const p = bipedOf(parts);
  const duration = 0.35;
  return {
    duration,
    loop: false,
    parts: named(p.root, p.torso, p.head, p.armL, p.armR, p.legL, p.legR),
    sample(t, pose) {
      const u = clamp(t / duration, 0, 1);
      const slump = easeInQuad(u);
      // The legs fold and the hips sink; the body itself is not squashed, so the head and
      // whatever it holds keep their shape.
      const hips = pose[p.root] as PartPose;
      hips.py = -2.5 * slump;
      const chest = pose[p.torso] as PartPose;
      chest.rz = 30 * DEG * slump;
      // The head: up fast, then arcing back and down, spinning.
      const top = pose[p.head] as PartPose;
      top.py = 14 * u - 12 * u * u;
      top.px = 6 * easeOutQuad(u);
      top.rz = -200 * DEG * u;
      top.s = 1 - 0.1 * u;
      (pose[p.armL] as PartPose).rz = 50 * DEG * slump;
      (pose[p.armR] as PartPose).rz = 60 * DEG * slump;
      const legL = pose[p.legL] as PartPose;
      const legR = pose[p.legR] as PartPose;
      legL.sy = legR.sy = 1 - 0.5 * slump;
      legL.rx = 20 * DEG * slump;
      legR.rx = -20 * DEG * slump;
    },
  };
}

/**
 * Cheering, a 0.6 s loop: a crouch, a jump of four voxels, arms flung up and waving out of
 * step, a squash on landing.
 */
export function zombieCheer(parts?: Partial<BipedParts>): Clip {
  const p = bipedOf(parts);
  const jump = cheerJump(p.root);
  const duration = jump.duration;
  return {
    duration,
    loop: true,
    parts: named(p.root, p.armL, p.armR, p.head),
    sample(t, pose) {
      jump.sample(t, pose);
      const beat = (t / duration) * TAU;
      (pose[p.armL] as PartPose).rz = -DEG * (75 + 20 * Math.sin(beat));
      (pose[p.armR] as PartPose).rz = -DEG * (75 - 20 * Math.sin(beat));
      (pose[p.head] as PartPose).rz = -DEG * (6 + 4 * Math.sin(beat));
    },
  };
}

/**
 * Blocking, 0.3 s: the `arm` swings the `shield` round to face the front within 90 ms,
 * holds it there, and lowers it again.
 */
export function shieldRaise(opts: { arm?: string; shield?: string } = {}): Clip {
  const arm = opts.arm ?? 'armL';
  const shield = opts.shield ?? 'shield';
  const duration = 0.3;
  return {
    duration,
    loop: false,
    parts: named(arm, shield),
    sample(t, pose) {
      const time = clamp(t, 0, duration);
      const k = time <= 0.09 ? easeOutCubic(time / 0.09) : time <= 0.2 ? 1 : 1 - easeInOutCubic((time - 0.2) / 0.1);
      const limb = pose[arm] as PartPose;
      // Up and in across the body.
      limb.rz = -20 * DEG * k;
      limb.ry = -25 * DEG * k;
      limb.pz = -1 * k;
      (pose[shield] as PartPose).ry = 40 * DEG * k;
    },
  };
}

/**
 * Drawing a bow and loosing, 0.55 s: the `bowArm` lifts the bow level and the `drawArm`
 * pulls the string back three voxels over 350 ms (the body standing tall), the arrow leaves
 * at 0.35 s, and both spring back.
 */
export function bowDraw(opts: { bowArm?: string; drawArm?: string; parts?: Partial<BipedParts> } = {}): Clip {
  const p = bipedOf(opts.parts);
  const bowArm = opts.bowArm ?? p.armL;
  const drawArm = opts.drawArm ?? p.armR;
  const draw = 0.35;
  const duration = 0.55;
  return {
    duration,
    loop: false,
    parts: named(p.torso, bowArm, drawArm),
    sample(t, pose) {
      const time = clamp(t, 0, duration);
      const pull = time <= draw ? easeInOutCubic(time / draw) : 0;
      const after = time <= draw ? 0 : springBack((time - draw) / (duration - draw));
      // Stand tall while drawing; a kick forward as it looses.
      const chest = pose[p.torso] as PartPose;
      chest.rz = DEG * (-8 * pull + 6 * after);
      (pose[bowArm] as PartPose).rz = DEG * (-12 * pull + 4 * after);
      const hand = pose[drawArm] as PartPose;
      hand.px = 3.2 * pull - 0.5 * after;
      hand.rz = DEG * (-10 * pull);
      hand.pz = pull * 0.5;
    },
  };
}

/**
 * A pistol shot, 0.3 s: the `arm` kicks up 30° within 40 ms as it fires (the shot leaves at
 * once), the body rocks back, and both come back to rest.
 */
export function pistolPop(opts: { arm?: string; parts?: Partial<BipedParts> } = {}): Clip {
  const p = bipedOf(opts.parts);
  const arm = opts.arm ?? p.armR;
  const kick = 0.04;
  const duration = 0.3;
  return {
    duration,
    loop: false,
    parts: named(p.torso, arm),
    sample(t, pose) {
      const time = clamp(t, 0, duration);
      const k = time <= kick ? easeOutCubic(time / kick) : springBack((time - kick) / (duration - kick));
      (pose[arm] as PartPose).rz = -30 * DEG * k;
      (pose[arm] as PartPose).px = 1 * k;
      (pose[p.torso] as PartPose).rz = -5 * DEG * k;
    },
  };
}

/**
 * Raising a staff, 0.7 s: the `arm` lifts the staff high over 250 ms, holds it there with a
 * shake while the spell pulses out (at 0.3 s), and lowers it.
 */
export function staffRaise(opts: { arm?: string; parts?: Partial<BipedParts> } = {}): Clip {
  const p = bipedOf(opts.parts);
  const arm = opts.arm ?? p.armL;
  const lift = 0.25;
  const hold = 0.45;
  const duration = 0.7;
  return {
    duration,
    loop: false,
    parts: named(p.torso, p.head, arm),
    sample(t, pose) {
      const time = clamp(t, 0, duration);
      const k = time <= lift ? easeOutCubic(time / lift) : time <= hold ? 1 : 1 - easeInOutCubic((time - hold) / (duration - hold));
      const shake = time > lift && time < hold ? Math.sin((time - lift) * 60) * 0.5 : 0;
      (pose[arm] as PartPose).rz = -DEG * (70 * k + 4 * shake);
      (pose[arm] as PartPose).py = 1.5 * k;
      (pose[p.torso] as PartPose).rz = -DEG * 10 * k;
      (pose[p.head] as PartPose).rz = -DEG * 10 * k;
    },
  };
}

/**
 * A lasso throw, 0.6 s: the `arm` goes up over the head and whirls twice round, then throws
 * forward at 0.42 s and comes back down to rest.
 */
export function lassoThrow(opts: { arm?: string; parts?: Partial<BipedParts> } = {}): Clip {
  const p = bipedOf(opts.parts);
  const arm = opts.arm ?? p.armR;
  const up = 0.1;
  const release = 0.42;
  const duration = 0.6;
  return {
    duration,
    loop: false,
    parts: named(p.torso, arm),
    sample(t, pose) {
      const time = clamp(t, 0, duration);
      const limb = pose[arm] as PartPose;
      const chest = pose[p.torso] as PartPose;
      if (time <= release) {
        const k = easeOutQuad(clamp(time / up, 0, 1));
        // Twice round between lifting and letting go.
        const spin = Math.max(0, time - up) / (release - up);
        limb.rz = -DEG * 110 * k;
        limb.rx = DEG * 25 * Math.sin(spin * 2 * TAU) * k;
        limb.ry = DEG * 25 * (Math.cos(spin * 2 * TAU) - 1) * k;
        chest.rz = -DEG * 6 * k;
        return;
      }
      const u = (time - release) / (duration - release);
      // Down and forward through the throw, then back to rest.
      const k = springBack(u);
      limb.rz = -DEG * 110 * k + DEG * 25 * Math.sin(Math.PI * u);
      limb.rx = 0;
      limb.ry = 0;
      chest.rz = DEG * 10 * Math.sin(Math.PI * u);
    },
  };
}
