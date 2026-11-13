import { describe, expect, it } from 'vitest';
import { getModelDef, modelKeys } from '../../src/render/models/registry';
import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { BIPED_PARTS, HEAD_TIP, HEAD_TURN, SLOW_STEP, atLevels, bipedModel, headTurn, mirrorZ, walkFor, type BipedSpec } from '../../src/render/models/zombies/biped';
import { buildParts } from '../../src/render/voxel/build';
import {
  bowDraw,
  lassoThrow,
  pistolPop,
  shieldRaise,
  staffRaise,
  zombieBite,
  zombieCheer,
  zombieCrumble,
  zombieIdle,
  zombieRise,
  zombieThrow,
  zombieWalk,
} from '../../src/render/voxel/clips';
import type { Clip, PartPose, Pose } from '../../src/render/voxel/types';

// The zombie rig and the clips it plays. The rules every registered model keeps, zombies
// included, are in models.test.ts.

const CORE = ['root', 'torso', 'head', 'armL', 'armR', 'legL', 'legR'];
const EXTRA = ['brain', 'jaw', 'shield', 'sword', 'bow', 'staff', 'lasso'];

function sampled(clip: Clip, t: number, names: string[] = [...CORE, ...EXTRA]): Pose {
  const pose: Pose = {};
  for (const name of names) pose[name] = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, s: 1, sx: 1, sy: 1, sz: 1 };
  clip.sample(t, pose);
  return pose;
}
const get = (pose: Pose, name: string): PartPose => pose[name] as PartPose;

/** The smallest biped the rig takes: one box per part. */
function tiny(overrides: Partial<BipedSpec> = {}): BipedSpec {
  return {
    key: 'test-zombie',
    skin: 'skin',
    cloth: 'clothPurple',
    clothDark: 'clothDark',
    head: [{ at: [-4, 10, -3], size: [6, 6, 6], color: 'skin' }],
    torso: [{ at: [-2, 5.5, -2.75], size: [4, 4.5, 5.5], color: 'clothPurple' }],
    armL: [{ at: [-4, 8, 3], size: [4, 2, 2], color: 'skin' }],
    armR: [{ at: [-4, 8, -5], size: [4, 2, 2], color: 'skin' }],
    legL: [{ at: [-1, 0, 0.5], size: [2, 4.5, 2], color: 'clothDark' }],
    legR: [{ at: [-1, 0, -2.5], size: [2, 4.5, 2], color: 'clothDark' }],
    extra: [{ name: 'eyes', parent: 'head', pivot: [-4, 13, 0], boxes: [{ at: [-4.5, 12, 0], size: [0.5, 3, 2], color: 'eye' }] }],
    trim: [],
    eyes: ['eyes'],
    stepSeconds: 0.8,
    ...overrides,
  };
}

describe('bipedModel', () => {
  it('always makes the seven core parts, nested as a body is, plus the extras', () => {
    const def = bipedModel(tiny());
    expect(BIPED_PARTS).toEqual(CORE);
    const names = def.parts.map((part) => part.name);
    expect(names).toEqual(expect.arrayContaining([...CORE, 'eyes']));
    const parent = (name: string): string | undefined => def.parts.find((part) => part.name === name)?.parent;
    expect(parent('root')).toBeUndefined();
    expect(parent('torso')).toBe('root');
    expect(parent('legL')).toBe('root');
    expect(parent('legR')).toBe('root');
    expect(parent('head')).toBe('torso');
    expect(parent('armL')).toBe('torso');
    expect(parent('armR')).toBe('torso');
    const model = buildParts(def, 1);
    for (const name of CORE) expect(model.getObjectByName(name), name).toBeDefined();
  });

  it('slouches the torso 10 degrees forward and turns the head towards the camera', () => {
    const def = bipedModel(tiny());
    const torso = def.parts.find((part) => part.name === 'torso');
    // Facing −X, forward is a positive turn about Z.
    expect(torso?.rot?.[2]).toBe(10);
    const head = def.parts.find((part) => part.name === 'head');
    // Turned towards +Z, the camera's side, for a unit that faces −X.
    expect(head?.rot?.[1]).toBeGreaterThan(0);
    expect(bipedModel(tiny({ slouch: 25 })).parts.find((part) => part.name === 'torso')?.rot?.[2]).toBe(25);
  });

  it('gives every biped the clips a zombie needs, walking at its own pace', () => {
    const def = bipedModel(tiny({ stepSeconds: 0.45 }));
    for (const name of ['idle', 'walk', 'hit', 'spawn', 'die', 'cheer']) expect(def.clips[name as 'idle'], name).toBeDefined();
    expect(def.clips.walk?.duration).toBeCloseTo(0.45);
    expect(def.clips.walk?.loop).toBe(true);
    const bite = zombieBite();
    expect(bipedModel(tiny({ clips: { melee: bite } })).clips.melee).toBe(bite);
  });

  it('turns the head HEAD_TURN about the vertical and tips it back HEAD_TIP, whatever the slouch', () => {
    const rad = MathUtils.degToRad;
    const want = new Quaternion()
      .setFromEuler(new Euler(0, rad(HEAD_TURN), 0))
      .multiply(new Quaternion().setFromEuler(new Euler(0, 0, rad(-HEAD_TIP))));
    for (const slouch of [0, 5, 10, 20, 25]) {
      const head = bipedModel(tiny({ slouch })).parts.find((part) => part.name === 'head');
      expect(head?.rot).toEqual(headTurn(slouch));
      const [x, y, z] = (head?.rot ?? [0, 0, 0]).map(rad) as [number, number, number];
      // The torso's slouch, then the head's own turn: where the head ends up.
      const got = new Quaternion()
        .setFromEuler(new Euler(0, 0, rad(slouch)))
        .multiply(new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ')));
      expect(got.angleTo(want), `slouch ${slouch}`).toBeLessThan(rad(0.05));
      // The face (−X) looks towards the camera's side (+Z) and a little up.
      const face = new Vector3(-1, 0, 0).applyQuaternion(got);
      expect(face.z).toBeCloseTo(Math.sin(rad(HEAD_TURN)) * Math.cos(rad(HEAD_TIP)), 3);
      expect(face.y).toBeCloseTo(Math.sin(rad(HEAD_TIP)), 3);
    }
  });

  it('mirrorZ puts the boxes on the other side of the body, and atLevels gates a run of boxes', () => {
    const box = { at: [-2, 1, 0.5] as [number, number, number], size: [1, 2, 3] as [number, number, number], color: 'skin', emissive: 2 };
    const [mirrored] = mirrorZ([box]);
    expect(mirrored).toEqual({ ...box, at: [-2, 1, -3.5] });
    // A box across the middle stays in the same place; mirroring twice gives the box back.
    expect(mirrorZ([{ ...box, at: [0, 0, -1.5] }])[0]?.at).toEqual([0, 0, -1.5]);
    expect(mirrorZ(mirrorZ([box]))).toEqual([box]);
    expect(box.at).toEqual([-2, 1, 0.5]);
    const gated = atLevels(3, 4, [box, { ...box, minLevel: 1 }]);
    expect(gated.map((b) => [b.minLevel, b.maxLevel])).toEqual([
      [3, 4],
      [3, 4],
    ]);
    expect(gated[0]?.emissive).toBe(2);
    expect('minLevel' in box).toBe(false);
  });

  it('refuses an extra part whose parent is not a part', () => {
    const spec = tiny();
    spec.extra = [...(spec.extra ?? []), { name: 'hat', parent: 'nose', pivot: [0, 0, 0], boxes: [] }];
    expect(() => buildParts(bipedModel(spec), 1)).toThrow(/nose/);
  });
});

describe('zombie clips', () => {
  it('walk: legs swing opposite, each arm against its leg, the body bobs a voxel and rolls', () => {
    const walk = zombieWalk(0.8);
    expect(walk.duration).toBeCloseTo(0.8);
    expect(walk.loop).toBe(true);
    expect(walk.parts).toEqual(expect.arrayContaining(CORE));
    const quarter = sampled(walk, 0.2);
    // Art bible section 5: legs ±25°, arms ±15° opposite.
    expect(Math.abs(get(quarter, 'legL').rz)).toBeCloseTo((25 * Math.PI) / 180, 3);
    expect(get(quarter, 'legR').rz).toBeCloseTo(-get(quarter, 'legL').rz, 6);
    expect(Math.abs(get(quarter, 'armL').rz)).toBeCloseTo((15 * Math.PI) / 180, 3);
    expect(Math.sign(get(quarter, 'armL').rz)).toBe(-Math.sign(get(quarter, 'legL').rz));
    // Bob: one voxel between the highest and lowest point.
    const heights = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((t) => get(sampled(walk, t), 'root').py);
    expect(Math.max(...heights) - Math.min(...heights)).toBeCloseTo(1, 1);
    // Roll ±4°.
    expect(Math.abs(get(quarter, 'root').rx)).toBeCloseTo((4 * Math.PI) / 180, 3);
    // Seamless: every channel of every part, not only the swing.
    const start = sampled(walk, 0);
    const end = sampled(walk, 0.8);
    for (const name of CORE) {
      for (const field of Object.keys(get(start, name)) as (keyof PartPose)[]) {
        expect(Math.abs(get(end, name)[field] - get(start, name)[field]), `${name}.${field}`).toBeLessThan(1e-9);
      }
    }
  });

  it('walk: the arms reach forward and back and sweep round, so the swing reads from above', () => {
    const quarter = sampled(zombieWalk(0.8), 0.2);
    // One hand a voxel and a half ahead, the other as far behind.
    expect(get(quarter, 'armL').px).toBeCloseTo(1.5, 6);
    expect(get(quarter, 'armR').px).toBeCloseTo(-1.5, 6);
    expect(Math.abs(get(quarter, 'armL').ry)).toBeGreaterThan(5 * (Math.PI / 180));
  });

  it('walk: zombies at a slow pace bob a voxel and a half and roll 6 degrees, since from above the bob and roll carry the walk', () => {
    expect(walkFor(SLOW_STEP)).toEqual({ bob: 1.5, roll: 6 });
    expect(walkFor(0.6)).toEqual({ bob: 1, roll: 4 });
    const slow = bipedModel(tiny({ stepSeconds: 0.9 })).clips.walk as Clip;
    const heights = Array.from({ length: 90 }, (_, i) => get(sampled(slow, (i / 90) * 0.9), 'root').py);
    expect(Math.max(...heights) - Math.min(...heights)).toBeCloseTo(1.5, 2);
    expect(Math.abs(get(sampled(slow, 0.9 / 4), 'root').rx)).toBeCloseTo(6 * (Math.PI / 180), 4);
    for (const key of ['brainEater', 'skeletonWarrior', 'desertZombie', 'skeletonArcher', 'necromancer', 'tridentZombie', 'brainRot']) {
      const walk = getModelDef(key).clips.walk as Clip;
      const hs = Array.from({ length: 100 }, (_, i) => get(sampled(walk, (i / 100) * walk.duration), 'root').py);
      expect(Math.max(...hs) - Math.min(...hs), key).toBeGreaterThan(1.45);
    }
  });

  it('walk: a bigger stride when asked, for the runners', () => {
    const run = zombieWalk(0.45, { legs: 40, arms: 40 });
    expect(Math.abs(get(sampled(run, 0.45 / 4), 'legL').rz)).toBeCloseTo((40 * Math.PI) / 180, 3);
  });

  it('bite: 0.48 s, winds back for 150 ms, strikes forward, then recovers', () => {
    const bite = zombieBite();
    expect(bite.duration).toBeCloseTo(0.48);
    expect(bite.loop).toBe(false);
    const wound = get(sampled(bite, 0.15), 'torso');
    const struck = get(sampled(bite, 0.23), 'torso');
    // Facing −X: leaning back is a negative turn about Z, lunging a positive one.
    expect(wound.rz).toBeLessThan(0);
    expect(struck.rz).toBeGreaterThan(0);
    expect(struck.px).toBeLessThan(0);
    const end = sampled(bite, 0.48);
    expect(Math.abs(get(end, 'torso').rz)).toBeLessThan(1e-6);
    // A jaw, if named, is wide open at the wind-up and shut at the strike; and the length can be set.
    const chomp = zombieBite({ jaw: 'jaw', duration: 0.3 });
    expect(chomp.duration).toBeCloseTo(0.3);
    expect(chomp.parts).toContain('jaw');
    expect(Math.abs(get(sampled(chomp, 0.3 * (0.15 / 0.48)), 'jaw').rz)).toBeGreaterThan(0.3);
  });

  it('throw: 0.4 s, the arm winds back and is thrown forward from 0.12 s', () => {
    const toss = zombieThrow();
    expect(toss.duration).toBeCloseTo(0.4);
    const back = get(sampled(toss, 0.12), 'armR').rz;
    const thrown = get(sampled(toss, 0.2), 'armR').rz;
    // Overarm: the hand goes up and back (a negative turn about Z for an arm reaching −X), then forward and down.
    expect(back).toBeLessThan(-1);
    expect(thrown).toBeGreaterThan(back + 1);
    expect(Math.abs(get(sampled(toss, 0.4), 'armR').rz)).toBeLessThan(1e-6);
    // Underarm, and with the other hand.
    const lob = zombieThrow({ arm: 'armL', underarm: true });
    expect(lob.parts).toContain('armL');
    expect(get(sampled(lob, 0.12), 'armL').rz).toBeGreaterThan(0.5);
  });

  it('rise: 0.5 s from under the ground, clawing up, and stands at rest at the end', () => {
    const rise = zombieRise();
    expect(rise.duration).toBeCloseTo(0.5);
    expect(get(sampled(rise, 0), 'root').py).toBeLessThan(-10);
    const end = sampled(rise, 0.5);
    for (const name of CORE) {
      const pose = get(end, name);
      expect(Math.abs(pose.py) + Math.abs(pose.rz), name).toBeLessThan(1e-6);
    }
    // The arms reach up on the way.
    expect(get(sampled(rise, 0.2), 'armL').rz).toBeLessThan(-0.3);
  });

  it('crumble: 0.35 s, the head pops up and off, the body slumps, and it stays down', () => {
    const crumble = zombieCrumble();
    expect(crumble.duration).toBeCloseTo(0.35);
    expect(crumble.loop).toBe(false);
    expect(get(sampled(crumble, 0.12), 'head').py).toBeGreaterThan(3);
    const end = sampled(crumble, 0.35);
    expect(get(end, 'head').px).toBeGreaterThan(2);
    expect(get(end, 'root').py).toBeLessThan(-1);
    expect(get(end, 'legL').sy).toBeLessThan(0.7);
    expect(get(end, 'torso').rz).toBeGreaterThan(0.3);
    expect(get(sampled(crumble, 5), 'root').py).toBeCloseTo(get(end, 'root').py, 6);
  });

  it('idle and cheer loop without a seam', () => {
    for (const clip of [zombieIdle(['brain']), zombieCheer()]) {
      expect(clip.loop).toBe(true);
      const a = sampled(clip, 0);
      const b = sampled(clip, clip.duration);
      for (const name of [...CORE, 'brain']) {
        for (const field of ['rx', 'ry', 'rz', 'px', 'py', 'sy'] as const) {
          expect(Math.abs(get(a, name)[field] - get(b, name)[field]), `${name}.${field}`).toBeLessThan(1e-6);
        }
      }
    }
    // Cheering, it is off the ground with its arms up.
    const up = sampled(zombieCheer(), 0.3);
    expect(get(up, 'root').py).toBeGreaterThan(2);
    expect(get(up, 'armL').rz).toBeLessThan(-0.5);
  });

  it('the one-shots for weapons: shield up, bow drawn, pistol kick, staff raised, lasso thrown', () => {
    const shield = shieldRaise();
    expect(shield.duration).toBeCloseTo(0.3);
    expect(shield.parts).toEqual(expect.arrayContaining(['armL', 'shield']));
    expect(Math.abs(get(sampled(shield, 0.12), 'shield').ry)).toBeGreaterThan(0.3);

    const bow = bowDraw();
    expect(bow.parts).toEqual(expect.arrayContaining(['armL', 'armR']));
    // The string hand is drawn back (towards +X) before the loose.
    expect(get(sampled(bow, 0.3), 'armR').px).toBeGreaterThan(1);

    const pop = pistolPop();
    expect(get(sampled(pop, 0.04), 'armR').rz).toBeLessThan(-0.2);
    expect(Math.abs(get(sampled(pop, pop.duration), 'armR').rz)).toBeLessThan(1e-6);

    const staff = staffRaise();
    expect(get(sampled(staff, staff.duration / 2), 'armL').rz).toBeLessThan(-0.5);

    const lasso = lassoThrow();
    expect(lasso.parts).toContain('armR');
    // Nothing jumps at the release (0.42 s): every channel carries on from the whirl.
    const before = sampled(lasso, 0.42 - 1e-6);
    const after = sampled(lasso, 0.42 + 1e-6);
    for (const name of lasso.parts ?? []) {
      for (const field of Object.keys(get(before, name)) as (keyof PartPose)[]) {
        expect(Math.abs(get(after, name)[field] - get(before, name)[field]), `${name}.${field}`).toBeLessThan(1e-3);
      }
    }
    for (const clip of [shield, bow, pop, staff, lasso]) {
      expect(clip.loop).toBe(false);
      const end = sampled(clip, clip.duration);
      for (const name of clip.parts ?? []) expect(Math.abs(get(end, name).rz) + Math.abs(get(end, name).px), name).toBeLessThan(1e-6);
    }
  });
});

/** Every zombie, and the length of its walk cycle. */
const STEPS: Record<string, number> = {
  brainEater: 0.8,
  veryFastWalker: 0.45,
  skeletonWarrior: 0.9,
  desertZombie: 0.75,
  skeletonArcher: 0.85,
  hotTopic: 0.6,
  cowboyZombie: 0.65,
  necromancer: 1.0,
  tridentZombie: 0.9,
  brainRot: 1.0,
  boneMinion: 0.5,
};
/** Parts the clips and the game ask for by name. */
const PROPS: [string, string][] = [
  ['skeletonWarrior', 'shield'],
  ['brainEater', 'brain'],
  ['skeletonArcher', 'bow'],
  ['desertZombie', 'sand'],
  ['hotTopic', 'jaw'],
  ['cowboyZombie', 'lasso'],
  ['cowboyZombie', 'pistol'],
  ['necromancer', 'staff'],
  ['tridentZombie', 'trident'],
  ['brainRot', 'glob'],
];

describe('the zombies', () => {
  it('are all registered', () => {
    expect(modelKeys()).toEqual(
      expect.arrayContaining(Object.keys(STEPS)),
    );
  });

  it('carry the props their clips and the game name', () => {
    const has = (key: string, part: string): boolean =>
      getModelDef(key).parts.some((p) => p.name === part && p.boxes.length > 0);
    for (const [key, part] of PROPS) expect(has(key, part), `${key} ${part}`).toBe(true);
  });

  it('walk at the pace of their role', () => {
    for (const [key, step] of Object.entries(STEPS)) expect(getModelDef(key).clips.walk?.duration, key).toBeCloseTo(step);
  });

  it('the Bone Minion is half a zombie with one look, and says so', () => {
    const def = getModelDef('boneMinion');
    expect(def.envelope).toEqual([6, 8, 6]);
    // What one look means is checked for every flagged model in models.test.ts.
    expect(def.singleLevel).toBe(true);
    // The bosses (models/bosses) have one look too; among the zombies only the Bone Minion.
    expect(modelKeys().filter((key) => getModelDef(key).singleLevel)).toEqual(['boneMinion', 'brainTitan', 'elderOak']);
  });

  it('Hot Topic bites fast, snapping its hanging jaw shut', () => {
    const bite = getModelDef('hotTopic').clips.melee;
    expect(bite?.duration).toBeCloseTo(0.3);
    expect(bite?.parts).toContain('jaw');
  });
});
