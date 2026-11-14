import { Scene } from 'three';
import type { MeshStandardMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AudioEngine, PlayOptions, SfxName } from '../../../src/audio/AudioEngine';
import { playEventSounds } from '../../../src/audio/bindings';
import { SFX } from '../../../src/audio/sfx';
import { Voice, makeNoise } from '../../../src/audio/synth';
import { BALANCE } from '../../../src/data/balance';
import { BOSS_LOOK } from '../../../src/data/bossLooks';
import { BattleView } from '../../../src/render/battle/BattleView';
import { HOWL_SECONDS, HOWLER_SLAM_RISE, moonHowler } from '../../../src/render/models/bosses/moonHowler';
import { BOSS_MODELS, getModelDef } from '../../../src/render/models/registry';
import { buildParts, modelStats } from '../../../src/render/voxel/build';
import { bossDemoConfig, bossDemoMatch, demoBalance } from '../../../src/scenes/bossScript';
import { Match } from '../../../src/sim/match';
import type { SimEvent } from '../../../src/sim/types';
import { FakeAudioContext } from '../../audio/fakeAudioContext';
import { allocationsIn } from '../allocations';
import { DT, bossStage, partShown, shown } from './stage';

// Step 2 Task 2: the Moon Howler, the plants' world-2 boss: its model, its shows on the lawn (the
// claw slam, the moon dome, the blinding howl, its phase-2 glow, its shards) and its two sounds.

const BOSS_TRIANGLES = 6000;
const PHASE_PARTS = ['glow', 'glowMoon', 'glowEyes'];

describe('the Moon Howler\'s model', () => {
  it('builds, is the registry\'s, has one look, and is drawn at 2.6', () => {
    expect(() => buildParts(moonHowler, 1)).not.toThrow();
    expect(getModelDef('moonHowler')).toBe(moonHowler);
    expect(BOSS_MODELS.moonHowler).toBe(moonHowler);
    expect(moonHowler.singleLevel).toBe(true);
    expect(BOSS_LOOK.moonHowler.scale).toBe(2.6);
  });

  it(`costs at most ${BOSS_TRIANGLES} triangles, its hidden phase-2 parts counted`, () => {
    expect(modelStats(moonHowler, 1).triangles).toBeLessThanOrEqual(BOSS_TRIANGLES);
  });

  it('has the clips its shows play (slam, howl, roar, topple) and its phase-2 parts built hidden', () => {
    for (const clip of ['ability', 'shoot', 'cheer', 'die', 'walk', 'melee'] as const) expect(moonHowler.clips[clip], clip).toBeDefined();
    expect(moonHowler.clips.shoot?.duration).toBe(HOWL_SECONDS);
    for (const name of PHASE_PARTS) expect(moonHowler.parts.find((p) => p.name === name)?.hidden, name).toBe(true);
    expect(BOSS_LOOK.moonHowler.fx.phaseParts).toEqual(PHASE_PARTS);
    expect(BOSS_LOOK.moonHowler.fx.slamRise).toBe(HOWLER_SLAM_RISE);
    expect(BOSS_LOOK.moonHowler.fx).toMatchObject({ shield: 'moon', defeat: 'shards', strike: 'shoot', summon: 'ring' });
  });
});

describe('the Moon Howler on the lawn', () => {
  it('walks the middle lane of the Meadow\'s fog (the demo), and its demo table has two phases and a blinding strike', () => {
    const c = bossDemoConfig('moonHowler', 1);
    expect(c.boss).toEqual({ key: 'moonHowler', faction: 'zombies', lane: 2 });
    expect(c.lawn.fog).toBe(5);
    const row = demoBalance('moonHowler').bosses.moonHowler;
    expect(row.phases).toHaveLength(2);
    expect(row.phases?.[1]?.some((p) => p.kind === 'strike' && p.target === 'lanes' && p.status?.kind === 'blind')).toBe(true);
    // A copy: the shipped table is not touched.
    expect(BALANCE.bosses.moonHowler.phases?.[1]?.some((p) => p.kind === 'strike')).not.toBe(true);
  });

  it('the claw slam winds up with the red tiles for its own wind-up, the arm rising, and lands', () => {
    const s = bossStage('moonHowler');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'slam' && e.windup);
    s.play(0.2);
    expect(s.view.bossFx.windingUp).toBe(true);
    expect(shown(s.scene, 'boss-windup-tile')).toBe(3);
    expect(s.view.unit(s.boss().id)?.model.clip).toBe('ability');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'slam' && !e.windup);
    s.play(0.1);
    expect(shown(s.scene, 'boss-windup-tile')).toBe(0);
  });

  it('a slam with a longer wind-up of its own keeps its tiles up for all of it (no Titan constant)', () => {
    const balance = demoBalance('moonHowler');
    const row = balance.bosses.moonHowler;
    const slow = { kind: 'slam', everySeconds: 8, windupSeconds: 3, damage: 350, sideDamage: 150, reach: 0.6 } as const;
    row.patterns = [slow, ...row.patterns.slice(1)];
    row.phases = [[slow, ...(row.phases?.[0] ?? []).slice(1)], row.phases?.[1] ?? []];
    const s = bossStage('moonHowler', balance);
    s.until((e) => e.type === 'bossPattern' && e.kind === 'slam' && e.windup);
    s.play(2.5); // past the Titan's 1.5 s, inside this slam's 3 s
    expect(s.view.bossFx.windingUp).toBe(true);
    expect(shown(s.scene, 'boss-windup-tile')).toBe(3);
    s.play(0.7);
    expect(s.view.bossFx.windingUp).toBe(false);
  });

  it('the raised arm is slowed to fill a longer wind-up: its rise (1.5 s) over the slam\'s own 3 s', () => {
    const balance = demoBalance('moonHowler');
    const row = balance.bosses.moonHowler;
    const slow = { kind: 'slam', everySeconds: 8, windupSeconds: 3, damage: 350, sideDamage: 150, reach: 0.6 } as const;
    row.patterns = [slow, ...row.patterns.slice(1)];
    row.phases = [[slow, ...(row.phases?.[0] ?? []).slice(1)], row.phases?.[1] ?? []];
    const s = bossStage('moonHowler', balance);
    s.play(1 / 30);
    const model = s.view.unit(s.boss().id)!.model;
    const calls: { clip: string; speed?: number }[] = [];
    const original = model.play.bind(model);
    model.play = (clip, opts) => {
      calls.push({ clip, speed: opts?.speed });
      original(clip, opts);
    };
    s.until((e) => e.type === 'bossPattern' && e.kind === 'slam' && e.windup);
    expect(calls).toContainEqual({ clip: 'ability', speed: HOWLER_SLAM_RISE / 3 });
  });

  it('its shield is the moon dome: moonlit, glowing glass while the shield is up, from the state', () => {
    const s = bossStage('moonHowler');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    expect(s.view.bossFx.shielded).toBe(true);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(1);
    let dome: MeshStandardMaterial | null = null;
    s.scene.traverse((o) => { if (o.name === 'boss-shield-dome') dome = (o as unknown as { material: MeshStandardMaterial }).material; });
    expect(`#${dome!.color.getHexString().toUpperCase()}`).toBe('#FFF2A8');
    expect(dome!.emissiveIntensity).toBeGreaterThan(0.15);
    s.play(5.2);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
  });

  it('the howl: a whole lane blinks grey while its head is thrown back (its `shoot`, drawn out over the wind-up), then the blow', () => {
    const s = bossStage('moonHowler');
    const said = s.until((e) => e.type === 'bossStrike' && e.windup) as Extract<SimEvent, { type: 'bossStrike' }> | null;
    expect(said?.tiles).toHaveLength(10);
    s.play(0.2);
    expect(s.view.bossFx.striking).toBe(true);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(10);
    expect(s.view.unit(s.boss().id)?.model.clip).toBe('shoot');
    s.until((e) => e.type === 'bossStrike' && !e.windup);
    s.play(0.1);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(0);
  });

  it('its phase-2 parts (the lit pendant, the crescent moon, the glowing eyes) show only from phase 2, as the state says', () => {
    const s = bossStage('moonHowler');
    s.play(1);
    const id = s.boss().id;
    for (const part of PHASE_PARTS) expect(partShown(s.view, id, part), part).toBe(false);
    const early = s.match.snapshot();
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    for (const part of PHASE_PARTS) expect(partShown(s.view, id, part), part).toBe(true);
    // A snapshot from before the phase change, restored into the same view: dark again.
    const restored = Match.restore(early, s.balance);
    s.view.applyEvents([], restored.state);
    for (const part of PHASE_PARTS) expect(partShown(s.view, id, part), part).toBe(false);
  });

  it('falls with its howl winding up: no warning stays, its fall plays, and it breaks into shards of its colours', () => {
    const s = bossStage('moonHowler');
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
    expect(s.view.unit(boss.id)?.model.clip).toBe('die');
    const debris = vi.spyOn(s.fx, 'debris');
    s.frames(90); // the topple (1.1 s) is over: the shards
    const colors = BOSS_LOOK.moonHowler.fx.shards!.map((c) => parseInt(c.slice(1), 16));
    expect(debris).toHaveBeenCalled();
    expect(debris.mock.calls[0]?.[1]).toEqual(colors);
  });

  it('a match that ends during the howl\'s wind-up takes the warning away for good', () => {
    const s = bossStage('moonHowler');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.3);
    s.view.applyEvents([{ type: 'matchEnded', winner: 'zombies' }], s.match.state);
    s.frames(30);
    expect(s.view.bossFx.striking).toBe(false);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(0);
  });

  it('restored in the middle of a howl, a new view shows the warning, the howl and the phase-2 glow from the state', () => {
    const s = bossStage('moonHowler');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.5);
    const restored = Match.restore(s.match.snapshot(), s.balance);
    const late = new BattleView(new Scene(), s.camera, s.lawn, s.fx, 'plants', { balance: s.balance });
    late.applyEvents([], restored.state);
    late.frame(restored.state, 0.5, DT, 0);
    const id = restored.state.units.find((u) => u.key === 'moonHowler')!.id;
    expect(late.bossFx.striking).toBe(true);
    expect(late.bossFx.strikeTileCount).toBe(10);
    expect(late.unit(id)?.model.clip).toBe('shoot');
    for (const part of PHASE_PARTS) expect(partShown(late, id, part), part).toBe(true);
    // And a snapshot from before the howl restored into that view: the warning goes.
    const before = bossDemoMatch('moonHowler', 1);
    for (let i = 0; i < 30 * 5; i++) before.step();
    late.applyEvents([], before.state);
    expect(late.bossFx.striking).toBe(false);
    late.dispose();
  });

  it('draws its strike and phase-2 frames without allocating', () => {
    const s = bossStage('moonHowler');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.3);
    const counts = allocationsIn(() => {
      for (let i = 0; i < 20; i++) s.view.bossFx.update(DT);
    });
    expect(counts).toEqual({});
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

describe('the Moon Howler\'s sounds', () => {
  it.each(['howlerHowl', 'howlerDefeat'] as const)('%s renders, is audible, under 1.5 s, with headroom, at any pitch', (name) => {
    for (const pitch of [0.94, 1, 1.06]) {
      const r = render(name, pitch);
      expect(r.sources).toBeGreaterThanOrEqual(1);
      expect(r.length).toBeGreaterThan(0.3);
      expect(r.length).toBeLessThan(1.5);
      expect(r.peak).toBeGreaterThan(0.04);
      expect(r.peak).toBeLessThanOrEqual(0.6);
    }
  });

  it('its howl on coming on, on each pattern and as its strike winds up; its sting when beaten', () => {
    const m = bossDemoMatch('moonHowler', 1);
    const heard: SfxName[] = [];
    while (m.state.winner === null) {
      const events = m.step();
      const calls: SfxName[] = [];
      const audio = { play: (name: SfxName, _o?: PlayOptions) => calls.push(name) } as unknown as AudioEngine;
      playEventSounds(audio, events, 'plants', { state: m.state });
      heard.push(...calls.filter((c) => c === 'howlerHowl' || c === 'howlerDefeat' || c === 'strikeWindup'));
      if (events.some((e) => e.type === 'bossStrike' && e.windup)) {
        expect(calls).toContain('strikeWindup');
        expect(calls).toContain('howlerHowl');
      }
    }
    expect(heard).toContain('strikeWindup');
    expect(heard.at(-1)).toBe('howlerDefeat');
    expect(heard.filter((c) => c === 'howlerHowl').length).toBeGreaterThanOrEqual(5);
  });
});
