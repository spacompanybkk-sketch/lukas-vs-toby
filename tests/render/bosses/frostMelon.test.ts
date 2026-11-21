import { Scene } from 'three';
import type { MeshBasicMaterial, Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AudioEngine, PlayOptions, SfxName } from '../../../src/audio/AudioEngine';
import { playEventSounds } from '../../../src/audio/bindings';
import { SFX } from '../../../src/audio/sfx';
import { Voice, makeNoise } from '../../../src/audio/synth';
import { BALANCE } from '../../../src/data/balance';
import { BOSS_LOOK } from '../../../src/data/bossLooks';
import { BattleView } from '../../../src/render/battle/BattleView';
import { throwsFrozenMelons } from '../../../src/render/battle/BossFx';
import { MELON_FALL_SECONDS, MELON_FLING_SECONDS, MELON_FREEZE_SECONDS, frostMelon } from '../../../src/render/models/bosses/frostMelon';
import { FROZEN_MELON_SIZE, makeFrozenMelon } from '../../../src/render/models/props';
import { BOSS_MODELS, getModelDef } from '../../../src/render/models/registry';
import { buildParts, modelStats } from '../../../src/render/voxel/build';
import type { Clip, PartPose, Pose } from '../../../src/render/voxel/types';
import { bossDemoConfig, bossDemoMatch, demoBalance } from '../../../src/scenes/bossScript';
import { Match } from '../../../src/sim/match';
import type { SimEvent } from '../../../src/sim/types';
import { FakeAudioContext } from '../../audio/fakeAudioContext';
import { allocationsIn } from '../allocations';
import { DT, bossStage, partShown, shown } from './stage';

// Step 2 (Tundra): the Frost Melon, the zombies' world-2 boss: its model, its shows on the lawn
// (the barrage of frozen melons, the ice plates, the freeze with its lit crown, its phase-2 frost,
// its shards) and its two sounds.

const BOSS_TRIANGLES = 6000;
const PHASE_PARTS = ['frostCracks', 'frostSpikes', 'glowEyes'];
const HIDDEN_PARTS = ['iceL', 'iceR', 'crownGlow', ...PHASE_PARTS];

const REST: PartPose = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, s: 1, sx: 1, sy: 1, sz: 1 };
/** The pose a clip writes at `t`, every part of the model starting at rest. */
function sampled(clip: Clip, t: number): Pose {
  const pose: Pose = {};
  for (const part of frostMelon.parts) pose[part.name] = { ...REST };
  clip.sample(t, pose);
  return pose;
}

describe('the Frost Melon\'s model', () => {
  it('builds, is the registry\'s (no stand-in), has one look, and is drawn at 4', () => {
    expect(() => buildParts(frostMelon, 1)).not.toThrow();
    expect(getModelDef('frostMelon')).toBe(frostMelon);
    expect(BOSS_MODELS.frostMelon).toBe(frostMelon);
    expect(frostMelon.key).toBe('frostMelon');
    expect(frostMelon.singleLevel).toBe(true);
    expect(BOSS_LOOK.frostMelon.scale).toBe(4);
    // Its own row, not the Oak's: its own sounds, face and shows.
    expect(BOSS_LOOK.frostMelon).not.toEqual(BOSS_LOOK.elderOak);
    expect(BOSS_LOOK.frostMelon.face).not.toEqual(BOSS_LOOK.elderOak.face);
  });

  it(`costs at most ${BOSS_TRIANGLES} triangles, its hidden plates, crown glow and phase-2 parts counted`, () => {
    expect(modelStats(frostMelon, 1).triangles).toBeLessThanOrEqual(BOSS_TRIANGLES);
  });

  it('has the clips its shows play and the parts the view drives, built hidden', () => {
    for (const clip of ['idle', 'shoot', 'cheer', 'ability', 'die', 'hit', 'spawn'] as const) expect(frostMelon.clips[clip], clip).toBeDefined();
    expect(frostMelon.clips.shoot?.duration).toBe(MELON_FLING_SECONDS);
    expect(frostMelon.clips.cheer?.duration).toBe(MELON_FREEZE_SECONDS);
    expect(frostMelon.clips.cheer?.loop).toBe(false);
    expect(frostMelon.clips.die?.duration).toBe(MELON_FALL_SECONDS);
    for (const name of HIDDEN_PARTS) expect(frostMelon.parts.find((p) => p.name === name)?.hidden, name).toBe(true);
    expect(frostMelon.parts.some((p) => p.name === 'pupils')).toBe(true);
    // No part is called `cracks`: a unit's view shows that one below half health by itself.
    expect(frostMelon.parts.some((p) => p.name === 'cracks')).toBe(false);
    expect(BOSS_LOOK.frostMelon.fx).toMatchObject({
      roar: 'ability', summon: 'sparkles', shield: 'ice', defeat: 'shards', eyes: 'follow',
      strike: 'cheer', strikeParts: ['crownGlow'], phaseParts: PHASE_PARTS, barrage: 'frozenMelon',
    });
    expect(BOSS_LOOK.frostMelon.call).toBe('melonCrack');
    expect(BOSS_LOOK.frostMelon.defeat).toBe('melonDefeat');
  });

  it('the fling: the basket cranks back, whips over, and is empty until a new frozen melon grows back', () => {
    const clip = frostMelon.clips.shoot!;
    expect(sampled(clip, 0).arm!.rz).toBe(0);
    expect(sampled(clip, 0.05).arm!.rz).toBeGreaterThan(0); // cranked back
    expect(sampled(clip, 0.2).arm!.rz).toBeLessThan(-1); // over the top (more than 57 degrees)
    expect(sampled(clip, 0.05).ammo!.s).toBe(1);
    expect(sampled(clip, 0.2).ammo!.s).toBeLessThan(0.01); // let go
    expect(sampled(clip, 0.45).ammo!.s).toBeLessThan(0.01);
    const end = sampled(clip, MELON_FLING_SECONDS);
    expect(end.ammo!.s).toBe(1);
    expect(end.arm!.rz).toBeCloseTo(0, 6);
  });

  it('the freeze swells and lifts the crown through the wind-up and ends at rest; the fall sags it', () => {
    const freeze = frostMelon.clips.cheer!;
    const mid = sampled(freeze, MELON_FREEZE_SECONDS * 0.6);
    expect(mid.melon!.sy).toBeGreaterThan(1.05);
    expect(mid.crown!.py).toBeGreaterThan(0.8);
    const end = sampled(freeze, MELON_FREEZE_SECONDS);
    for (const part of ['root', 'melon', 'crown', 'arm']) {
      for (const field of Object.keys(REST) as (keyof PartPose)[]) expect(end[part]![field], `${part}.${field}`).toBeCloseTo(REST[field], 6);
    }
    const fallen = sampled(frostMelon.clips.die!, MELON_FALL_SECONDS);
    expect(fallen.melon!.sy).toBeLessThan(0.7);
    expect(fallen.crown!.py).toBeLessThan(-1);
  });

  it('its frozen melon is a shot of its own: bigger than an acorn\'s, every copy sharing one geometry', () => {
    const a = makeFrozenMelon() as unknown as { name: string; geometry: { boundingBox: { min: { x: number }; max: { x: number } } } };
    const b = makeFrozenMelon() as unknown as { geometry: unknown };
    expect(a.name).toBe('projectile-frozen-melon');
    expect(a.geometry).toBe(b.geometry);
    expect(a.geometry.boundingBox.max.x - a.geometry.boundingBox.min.x).toBeCloseTo(FROZEN_MELON_SIZE, 5);
    expect(throwsFrozenMelons('frostMelon')).toBe(true);
    for (const other of ['elderOak', 'brainTitan', 'moonHowler', 'peashooter'] as const) expect(throwsFrozenMelons(other), other).toBe(false);
  });
});

describe('the Frost Melon on the lawn', () => {
  it('stands at the plant base on the Tundra\'s ice (the demo), and its demo table has two phases and a freeze of two lanes', () => {
    const c = bossDemoConfig('frostMelon', 1);
    expect(c.boss).toEqual({ key: 'frostMelon', faction: 'plants', lane: 2 });
    expect(c.lawn.ice?.lanes).toEqual([0, 1, 3, 4]);
    const row = demoBalance('frostMelon').bosses.frostMelon;
    expect(row.phases).toHaveLength(2);
    expect(row.phases?.[1]?.some((p) => p.kind === 'strike' && p.target === 'lanes' && p.count === 2 && p.status?.kind === 'stun')).toBe(true);
    // A scene's own copy: the shipped row is not touched, and it freezes too.
    expect(row).not.toBe(BALANCE.bosses.frostMelon);
    expect(BALANCE.bosses.frostMelon.phases?.[1]?.some((p) => p.kind === 'strike' && p.status?.kind === 'stun')).toBe(true);
  });

  it('is drawn four times a unit\'s size, with its plates, crown glow and phase-2 parts hidden as it comes on', () => {
    const s = bossStage('frostMelon');
    s.play(1);
    const id = s.boss().id;
    expect(s.view.unit(id)?.bulk).toBe(4);
    for (const part of HIDDEN_PARTS) expect(partShown(s.view, id, part), part).toBe(false);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
  });

  it('the barrage: the basket flings (its `shoot`) and frozen melons fly, no acorns, each with a landing mark', () => {
    const s = bossStage('frostMelon');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    expect(s.view.unit(s.boss().id)?.model.clip).toBe('shoot');
    s.play(0.4);
    const flying = s.match.state.projectiles.filter((p) => p.kind === 'acorn').length;
    expect(flying).toBeGreaterThan(0);
    expect(shown(s.scene, 'projectile-frozen-melon')).toBe(flying);
    expect(shown(s.scene, 'projectile-acorn')).toBe(0);
    expect(shown(s.scene, 'boss-acorn-mark')).toBe(flying);
    s.play(4);
    expect(shown(s.scene, 'projectile-frozen-melon')).toBe(0);
    expect(shown(s.scene, 'boss-acorn-mark')).toBe(0);
  });

  it('the frozen melons are pooled: a second barrage flies the first one\'s objects again', () => {
    const s = bossStage('frostMelon');
    const melons = (): Set<Object3D> => {
      const out = new Set<Object3D>();
      s.scene.traverse((o) => { if (o.name === 'projectile-frozen-melon') out.add(o); });
      return out;
    };
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    s.play(0.4);
    const first = melons();
    expect(first.size).toBeGreaterThan(0);
    s.play(4);
    expect(melons().size).toBe(0); // landed: out of the scene, kept for the next
    // (The second barrage lands within a third of a second: the zombies are close by then.)
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    const second = melons();
    expect(second.size).toBeGreaterThan(0);
    for (const o of second) expect(first.has(o)).toBe(true);
  });

  it('the Oak\'s barrage is still acorns', () => {
    expect(BOSS_LOOK.elderOak.fx.barrage).toBeUndefined();
    const s = bossStage('elderOak', BALANCE as never);
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    s.play(0.4);
    expect(shown(s.scene, 'projectile-acorn')).toBeGreaterThan(0);
    expect(shown(s.scene, 'projectile-frozen-melon')).toBe(0);
  });

  it('its shield is the ice plates: shut while the shield is up (from the state), hits on them throw ice chips, then gone', () => {
    const s = bossStage('frostMelon');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    const id = s.boss().id;
    expect(s.view.bossFx.shielded).toBe(true);
    expect(s.view.bossFx.barkShut).toBe(true);
    expect(partShown(s.view, id, 'iceL')).toBe(true);
    expect(partShown(s.view, id, 'iceR')).toBe(true);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
    const before = s.feels.length;
    const burst = vi.spyOn(s.fx, 'burst');
    s.play(0.4);
    expect(s.feels.slice(before).some((f) => (f as { hitStop?: number }).hitStop !== undefined)).toBe(true); // the clap
    const ice = [0xe8faff, 0x7fd3f5, 0xb8ecff];
    expect(burst.mock.calls.some((c) => c[1] === undefined ? false : (c[1] as number[]).every((v, i) => v === ice[i]))).toBe(true);
    s.play(8.2);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(partShown(s.view, id, 'iceL')).toBe(false);
    expect(partShown(s.view, id, 'iceR')).toBe(false);
  });

  it('the freeze: two whole lanes blink blue while it swells (its `cheer`, drawn out over the wind-up) and its crown blinks lit, then the blow', () => {
    const s = bossStage('frostMelon');
    const said = s.until((e) => e.type === 'bossStrike' && e.windup) as Extract<SimEvent, { type: 'bossStrike' }> | null;
    expect(said?.tiles).toHaveLength(20);
    expect(new Set(said!.tiles.map((t) => t.lane)).size).toBe(2);
    s.play(0.2);
    const id = s.boss().id;
    expect(s.view.bossFx.striking).toBe(true);
    expect(s.view.bossFx.strikeTileCount).toBe(20);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(20);
    expect(s.view.unit(id)?.model.clip).toBe('cheer');
    // The crown and the fills blink together, in hard steps: both seen on and off within a second.
    const crown = new Set<boolean>();
    const fills = new Set<number>();
    for (let f = 0; f < 60; f++) {
      s.frames(1);
      crown.add(partShown(s.view, id, 'crownGlow'));
      fills.add(shown(s.scene, 'boss-strike-fill'));
      expect(shown(s.scene, 'boss-strike-fill') > 0).toBe(partShown(s.view, id, 'crownGlow'));
    }
    expect(crown).toEqual(new Set([true, false]));
    expect(fills).toEqual(new Set([20, 0]));
    const blow = s.until((e) => e.type === 'bossStrike' && !e.windup);
    expect(blow).not.toBeNull();
    s.play(0.1);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(0);
    expect(partShown(s.view, id, 'crownGlow')).toBe(false);
    // And the zombies standing in those lanes are frozen (the simulation's stun).
    expect(s.match.state.units.some((u) => u.faction === 'zombies' && u.stun > 0)).toBe(true);
  });

  it('the freeze\'s lanes are warned of in deep navy inside a frost-white outline (its own colours, for the ice and the snow), the blow in bright ice', () => {
    const s = bossStage('frostMelon');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.1);
    let frame: MeshBasicMaterial | null = null;
    let fill: MeshBasicMaterial | null = null;
    s.scene.traverse((o) => {
      if (o.name === 'boss-strike-tile') frame = (o as unknown as { material: MeshBasicMaterial }).material;
      if (o.name === 'boss-strike-fill') fill = (o as unknown as { material: MeshBasicMaterial }).material;
    });
    expect(`#${frame!.color.getHexString().toUpperCase()}`).toBe('#F4FBFF');
    expect(`#${fill!.color.getHexString().toUpperCase()}`).toBe('#0A2A70');
    expect(fill!.opacity).toBeCloseTo(0.85);
    const ring = vi.spyOn(s.fx, 'ring');
    s.until((e) => e.type === 'bossStrike' && !e.windup);
    expect(ring.mock.calls.filter((c) => c[1] === 0x39c6ff)).toHaveLength(20);
    // The others keep theirs: no blow colour of their own.
    expect(BOSS_LOOK.moonHowler.fx.strikeWarnings?.blind?.blow).toBeUndefined();
    expect(BOSS_LOOK.elderOak.fx.strikeWarnings).toBeUndefined();
  });

  it('its pupils follow the nearest zombie across the lanes', () => {
    const s = bossStage('frostMelon');
    s.play(1);
    const view = s.view.unit(s.boss().id)!;
    const shift = vi.spyOn(view, 'shiftPart');
    s.play(3);
    const pupils = shift.mock.calls.filter((c) => c[0] === 'pupils');
    expect(pupils.length).toBeGreaterThan(0);
    expect(pupils.some((c) => c[3] !== 0)).toBe(true); // somebody walks a lane beside its own
  });

  it('its phase-2 parts (the glowing cracks, the big icicles, the eyes alight) show only from phase 2, as the state says', () => {
    const s = bossStage('frostMelon');
    s.play(1);
    const id = s.boss().id;
    for (const part of PHASE_PARTS) expect(partShown(s.view, id, part), part).toBe(false);
    const early = s.match.snapshot();
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    for (const part of PHASE_PARTS) expect(partShown(s.view, id, part), part).toBe(true);
    expect(partShown(s.view, id, 'iceL')).toBe(true);
    // A snapshot from before the phase change, restored into the same view: no frost, and no plates left shut.
    const restored = Match.restore(early, s.balance);
    s.view.applyEvents([], restored.state);
    for (const part of PHASE_PARTS) expect(partShown(s.view, id, part), part).toBe(false);
    expect(partShown(s.view, id, 'iceL')).toBe(false);
    expect(partShown(s.view, id, 'iceR')).toBe(false);
    expect(s.view.bossFx.shielded).toBe(false);
  });

  it('falls with its freeze winding up: no warning stays, its crown goes dark, its fall plays, and it breaks into shards of its colours across its lanes', () => {
    const s = bossStage('frostMelon');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.3);
    expect(s.view.bossFx.striking).toBe(true);
    const boss = s.boss();
    boss.hp = 0;
    const events = s.match.step();
    s.view.applyEvents(events.filter((e) => e.type !== 'matchEnded'), s.match.state);
    s.frames(10);
    expect(s.view.bossFx.striking).toBe(false);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(0);
    expect(shown(s.scene, 'boss-strike-fill')).toBe(0);
    expect(partShown(s.view, boss.id, 'crownGlow')).toBe(false);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(s.view.unit(boss.id)?.model.clip).toBe('die');
    const lanes: number[] = [];
    const original = s.fx.debris.bind(s.fx);
    const debris = vi.spyOn(s.fx, 'debris').mockImplementation((at, colors, count) => {
      lanes.push(at.z); // the place is a shared vector: read as it is thrown
      original(at, colors, count);
    });
    s.frames(100); // the fall (1.2 s) is over: the shards
    const colors = BOSS_LOOK.frostMelon.fx.shards!.map((c) => parseInt(c.slice(1), 16));
    expect(debris).toHaveBeenCalled();
    expect(debris.mock.calls[0]?.[1]).toEqual(colors);
    // Across the three lanes it stood in.
    expect(Math.max(...lanes) - Math.min(...lanes)).toBeCloseTo(2, 5);
    s.frames(60);
    expect(s.view.unit(boss.id)).toBeUndefined();
  });

  it('a match that ends during the freeze\'s wind-up takes the warning and the lit crown away for good', () => {
    const s = bossStage('frostMelon');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.3);
    const id = s.boss().id;
    s.view.applyEvents([{ type: 'matchEnded', winner: 'zombies' }], s.match.state);
    s.frames(60);
    expect(s.view.bossFx.striking).toBe(false);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(0);
    expect(shown(s.scene, 'boss-strike-fill')).toBe(0);
    expect(partShown(s.view, id, 'crownGlow')).toBe(false);
    expect(shown(s.scene, 'boss-acorn-mark')).toBe(0);
  });

  it('restored in the middle of a freeze, a new view shows the warning, the swell, the plates and the phase-2 frost from the state', () => {
    const s = bossStage('frostMelon');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.5);
    const restored = Match.restore(s.match.snapshot(), s.balance);
    const lateScene = new Scene();
    const late = new BattleView(lateScene, s.camera, s.lawn, s.fx, 'zombies', { balance: s.balance });
    late.applyEvents([], restored.state);
    late.frame(restored.state, 0.5, DT, 0);
    const boss = restored.state.units.find((u) => u.key === 'frostMelon')!;
    expect(late.bossFx.striking).toBe(true);
    expect(late.bossFx.strikeTileCount).toBe(20);
    expect(late.unit(boss.id)?.model.clip).toBe('cheer');
    for (const part of PHASE_PARTS) expect(partShown(late, boss.id, part), part).toBe(true);
    expect(boss.shieldLeft).toBeGreaterThan(0); // the demo's freeze opens phase 2, under the plates
    expect(partShown(late, boss.id, 'iceL')).toBe(true);
    // And a snapshot from before the freeze restored into that view: the warning, the crown's light and the plates go.
    const before = bossDemoMatch('frostMelon', 1);
    for (let i = 0; i < 30 * 5; i++) before.step();
    late.applyEvents([], before.state);
    late.frame(before.state, 0.5, DT, 1);
    expect(late.bossFx.striking).toBe(false);
    expect(shown(lateScene, 'boss-strike-tile')).toBe(0);
    expect(partShown(late, boss.id, 'crownGlow')).toBe(false);
    expect(partShown(late, boss.id, 'iceL')).toBe(false);
    for (const part of PHASE_PARTS) expect(partShown(late, boss.id, part), part).toBe(false);
    late.dispose();
  });

  it('draws its freeze, shield and barrage frames without allocating', () => {
    const s = bossStage('frostMelon');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.3);
    expect(allocationsIn(() => {
      for (let i = 0; i < 20; i++) s.view.bossFx.update(DT);
    })).toEqual({});
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    s.play(0.3);
    expect(allocationsIn(() => {
      for (let i = 0; i < 20; i++) s.view.bossFx.update(DT);
    })).toEqual({});
  });

  it('dispose takes everything it added out of the scene, frozen melons in the air included', () => {
    const s = bossStage('frostMelon');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    s.play(0.4);
    expect(shown(s.scene, 'projectile-frozen-melon')).toBeGreaterThan(0);
    s.view.dispose();
    expect([...s.scene.children]).toEqual(s.before);
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

describe('the Frost Melon\'s sounds', () => {
  it.each(['melonCrack', 'melonDefeat'] as const)('%s renders, is audible, under 1.5 s, with headroom, at any pitch', (name) => {
    for (const pitch of [0.94, 1, 1.06]) {
      const r = render(name, pitch);
      expect(r.sources).toBeGreaterThanOrEqual(1);
      expect(r.length).toBeGreaterThan(0.3);
      expect(r.length).toBeLessThan(1.5);
      expect(r.peak).toBeGreaterThan(0.04);
      expect(r.peak).toBeLessThanOrEqual(0.6);
    }
  });

  it('its crack on each pattern and as its freeze winds up; its sting when beaten', () => {
    const m = bossDemoMatch('frostMelon', 1);
    const heard: SfxName[] = [];
    while (m.state.winner === null) {
      const events = m.step();
      const calls: SfxName[] = [];
      const audio = { play: (name: SfxName, _o?: PlayOptions) => calls.push(name) } as unknown as AudioEngine;
      playEventSounds(audio, events, 'zombies', { state: m.state });
      heard.push(...calls.filter((c) => c === 'melonCrack' || c === 'melonDefeat' || c === 'strikeWindup' || c === 'oakCreak' || c === 'oakDefeat'));
      if (events.some((e) => e.type === 'bossStrike' && e.windup)) {
        expect(calls).toContain('strikeWindup');
        expect(calls).toContain('melonCrack');
      }
    }
    expect(heard).toContain('strikeWindup');
    expect(heard.at(-1)).toBe('melonDefeat');
    expect(heard.filter((c) => c === 'melonCrack').length).toBeGreaterThanOrEqual(5);
    // Nothing of the Oak's is left in it.
    expect(heard).not.toContain('oakCreak');
    expect(heard).not.toContain('oakDefeat');
  });
});
