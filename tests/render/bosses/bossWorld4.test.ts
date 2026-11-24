import { Scene } from 'three';
import type { Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AudioEngine, PlayOptions, SfxName } from '../../../src/audio/AudioEngine';
import { PRIORITY } from '../../../src/audio/AudioEngine';
import { playEventSounds } from '../../../src/audio/bindings';
import { SFX, SFX_NAMES } from '../../../src/audio/sfx';
import { Voice, makeNoise } from '../../../src/audio/synth';
import { BALANCE } from '../../../src/data/balance';
import { BOSS_LOOK } from '../../../src/data/bossLooks';
import { BattleView } from '../../../src/render/battle/BattleView';
import { throwsFrozenMelons, throwsNeedles, throwsSporeBombs } from '../../../src/render/battle/BossFx';
import { glowcap } from '../../../src/render/models/bosses/glowcap';
import { yeti } from '../../../src/render/models/bosses/yeti';
import { makeFrozenMelon, makeNeedle, makeSporeBomb } from '../../../src/render/models/props';
import { BOSS_MODELS, getModelDef } from '../../../src/render/models/registry';
import { buildParts, modelStats } from '../../../src/render/voxel/build';
import { bossDemoConfig, bossDemoMatch, demoBalance } from '../../../src/scenes/bossScript';
import { Match } from '../../../src/sim/match';
import type { BossKey, SimEvent } from '../../../src/sim/types';
import { FakeAudioContext } from '../../audio/fakeAudioContext';
import { allocationsIn } from '../allocations';
import { DT, bossStage, digest, partShown, shown } from './stage';

// Step 4 (Frozen Tundra and Moonlit Meadow) Task 2: the Yeti and the Glowcap, their models, their shows on the
// lawn (the snow fort and the cap shells, the avalanche and the spore cloud, the breath, the spore bombs, the
// lit spots), their four sounds and their first-use warm-up. Only what is new: the every-boss look and
// sound loops of bossWorld3.test.ts and bossLooks.test.ts already run over both keys. Driven by events,
// pinning no hp (the level tasks tune it).

const BOSS_TRIANGLES = 6000;
const hex = (m: MeshBasicMaterial | MeshStandardMaterial): string => `#${m.color.getHexString().toUpperCase()}`;

// ---- The six shipped bosses are untouched -----------------------------------------------------------

const SIX: BossKey[] = ['brainTitan', 'elderOak', 'moonHowler', 'frostMelon', 'sandPharaoh', 'cactusKing'];
const TIMES = [0.5, 8, 12, 31, 33.5, 40];
/** The digests of each boss's demo, drawn through a real BattleView, taken on b36810e before any BossFx edit of step 4. */
const BEFORE: Record<string, number[]> = {
  brainTitan: [2125167906, 3340314198, 1030107703, 1486708051, 1693661940, 2782069281],
  elderOak: [2642507999, 3638748648, 2896188870, 1942210966, 976115270, 1591669113],
  moonHowler: [154721315, 9382666, 1990587817, 2739803951, 3154212110, 2175298726],
  frostMelon: [3254480392, 4086559018, 3861059545, 2589734075, 1843271986, 3271341202],
  sandPharaoh: [4093168117, 3828598482, 4226584066, 2373790840, 2125825253, 3801422739],
  cactusKing: [130176423, 978739006, 2069386363, 2624237810, 1291337797, 3460588989],
};

describe('the six shipped bosses\' demo frames', () => {
  it.each(SIX)('%s: every frame (the scene\'s objects, matrices, colours and vertices) is as it was before the world-4 shows', (key) => {
    const s = bossStage(key);
    let at = 0;
    const got = TIMES.map((t) => {
      s.play(t - at);
      at = t;
      s.frames(2);
      return digest(s.scene);
    });
    expect(got).toEqual(BEFORE[key]);
  });
});

// ---- Their rows and sounds -----------------------------------------------------------------------------

describe('the world-4 rows are their own', () => {
  it('the Yeti is not the Titan, the Glowcap is not the Melon: their own look, face, bar, scale and sounds', () => {
    expect(BOSS_LOOK.yeti).not.toEqual(BOSS_LOOK.brainTitan);
    expect(BOSS_LOOK.glowcap).not.toEqual(BOSS_LOOK.frostMelon);
    expect(BOSS_LOOK.yeti.face).not.toEqual(BOSS_LOOK.brainTitan.face);
    expect(BOSS_LOOK.glowcap.face).not.toEqual(BOSS_LOOK.frostMelon.face);
    expect(BOSS_LOOK.yeti.bar).not.toEqual(BOSS_LOOK.brainTitan.bar);
    expect(BOSS_LOOK.glowcap.bar).not.toEqual(BOSS_LOOK.frostMelon.bar);
    expect(BOSS_LOOK.yeti).toMatchObject({ scale: 3, call: 'yetiRoar', defeat: 'yetiDefeat' });
    expect(BOSS_LOOK.glowcap).toMatchObject({ scale: 4, call: 'glowcapPuff', defeat: 'glowcapDefeat' });
  });

  it('the Yeti\'s shield is the snow fort, the Glowcap\'s the cap, its barrage the spore bomb; only it throws one', () => {
    expect(BOSS_LOOK.yeti.fx.shield).toBe('snow');
    expect(BOSS_LOOK.glowcap.fx.shield).toBe('cap');
    expect(BOSS_LOOK.glowcap.fx.barrage).toBe('sporeBomb');
    expect(throwsSporeBombs('glowcap')).toBe(true);
    for (const other of ['yeti', 'frostMelon', 'cactusKing', 'elderOak', 'brainTitan', 'peashooter'] as const) {
      expect(throwsSporeBombs(other), other).toBe(false);
    }
    expect(throwsFrozenMelons('glowcap')).toBe(false);
    expect(throwsNeedles('glowcap')).toBe(false);
    expect(BOSS_LOOK.yeti.fx.barrage).toBeUndefined();
  });
});

describe('the four sounds', () => {
  const NAMES: SfxName[] = ['yetiRoar', 'yetiDefeat', 'glowcapPuff', 'glowcapDefeat'];

  function render(name: SfxName, pitch = 1): { length: number; peak: number; sources: number } {
    const ctx = new FakeAudioContext();
    const v = new Voice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, makeNoise(ctx as unknown as BaseAudioContext));
    SFX[name](v, 1, pitch);
    const envelopes = ctx.params.filter((p) => p.name === 'gain' && p.events.length >= 3 && p.finalValue === 0);
    const peak = Math.max(0, ...envelopes.flatMap((p) => p.events.map((e) => e.value)));
    expect(ctx.allProblems(), name).toEqual([]);
    return { length: v.end - 1, peak, sources: ctx.sources().length };
  }

  it('exist, differ from each other and from every other sound, and take priority 3', () => {
    for (const name of NAMES) {
      expect(SFX_NAMES, name).toContain(name);
      expect(PRIORITY[name], name).toBe(3);
    }
    expect(new Set(NAMES).size).toBe(4);
    expect(new Set(NAMES.map((n) => SFX[n])).size).toBe(4);
    const others = SFX_NAMES.filter((n) => !NAMES.includes(n));
    for (const name of NAMES) for (const other of others) expect(SFX[name], `${name} / ${other}`).not.toBe(SFX[other]);
  });

  it.each(NAMES)('%s renders, is audible, under 1.5 s, with headroom, at any pitch', (name) => {
    for (const pitch of [0.94, 1, 1.06]) {
      const r = render(name, pitch);
      expect(r.sources).toBeGreaterThanOrEqual(1);
      expect(r.length).toBeGreaterThan(0.3);
      expect(r.length).toBeLessThan(1.5);
      expect(r.peak).toBeGreaterThan(0.04);
      expect(r.peak).toBeLessThanOrEqual(0.6);
    }
  });

  it.each([['yeti', 'yetiRoar', 'yetiDefeat', 'plants'], ['glowcap', 'glowcapPuff', 'glowcapDefeat', 'zombies']] as const)(
    '%s: its call on its patterns and as its strike winds up, its sting when beaten, none of the other bosses\'',
    (key, call, defeat, player) => {
      const m = bossDemoMatch(key, 1);
      const heard: SfxName[] = [];
      const others = ['titanRoar', 'titanDefeat', 'oakCreak', 'oakDefeat', 'howlerHowl', 'melonCrack', 'pharaohCall', 'cactusCreak'];
      while (m.state.winner === null) {
        const events = m.step();
        const calls: SfxName[] = [];
        const audio = { play: (name: SfxName, _o?: PlayOptions) => calls.push(name) } as unknown as AudioEngine;
        playEventSounds(audio, events, player, { state: m.state });
        heard.push(...calls.filter((c) => c === call || c === defeat || c === 'strikeWindup' || others.includes(c)));
        if (events.some((e) => e.type === 'bossStrike' && e.windup)) {
          expect(calls).toContain('strikeWindup');
          expect(calls).toContain(call);
        }
      }
      expect(heard).toContain('strikeWindup');
      expect(heard.at(-1)).toBe(defeat);
      expect(heard.filter((c) => c === call).length).toBeGreaterThanOrEqual(5);
      for (const other of others) expect(heard, other).not.toContain(other);
    },
  );
});

// ---- The models ------------------------------------------------------------------------------------

describe('the Yeti\'s model', () => {
  it(`builds, is the registry's, has one look and costs at most ${BOSS_TRIANGLES} triangles, its hidden parts counted`, () => {
    expect(() => buildParts(yeti, 1)).not.toThrow();
    expect(BOSS_MODELS.yeti).toBe(yeti);
    expect(getModelDef('yeti')).toBe(yeti);
    expect(yeti.key).toBe('yeti');
    expect(yeti.singleLevel).toBe(true);
    expect(modelStats(yeti, 1).triangles).toBeLessThanOrEqual(BOSS_TRIANGLES);
  });

  it('has the clips its shows play, an icy-breath part built hidden and a club riding on the near arm', () => {
    for (const clip of ['idle', 'walk', 'melee', 'ability', 'shoot', 'cheer', 'die', 'hit', 'spawn'] as const) expect(yeti.clips[clip], clip).toBeDefined();
    expect(yeti.parts.find((p) => p.name === 'frostBreath')?.hidden).toBe(true);
    expect(yeti.parts.find((p) => p.name === 'club')?.parent).toBe('armL');
    // The strike's clip is the one the look names, a one-shot the view slows to fit the wind-up.
    expect(BOSS_LOOK.yeti.fx.strike).toBe('shoot');
    expect(yeti.clips.shoot?.loop).toBe(false);
  });
});

describe('the Glowcap\'s model', () => {
  it(`builds, is the registry's, has one look and costs at most ${BOSS_TRIANGLES} triangles, its hidden parts counted`, () => {
    expect(() => buildParts(glowcap, 1)).not.toThrow();
    expect(BOSS_MODELS.glowcap).toBe(glowcap);
    expect(getModelDef('glowcap')).toBe(glowcap);
    expect(glowcap.key).toBe('glowcap');
    expect(glowcap.singleLevel).toBe(true);
    expect(modelStats(glowcap, 1).triangles).toBeLessThanOrEqual(BOSS_TRIANGLES);
  });

  it('has the parts the view drives (pupils that follow, two hidden shells, hidden lit spots) and the clips its shows play', () => {
    for (const clip of ['idle', 'shoot', 'cheer', 'ability', 'die', 'hit', 'spawn'] as const) expect(glowcap.clips[clip], clip).toBeDefined();
    expect(glowcap.clips.cheer?.loop).toBe(true); // held through the spore cloud's wind-up
    for (const name of ['capL', 'capR', 'spotsLit']) expect(glowcap.parts.find((p) => p.name === name)?.hidden, name).toBe(true);
    expect(glowcap.parts.some((p) => p.name === 'pupils')).toBe(true);
  });
});

// ---- The Yeti on the lawn --------------------------------------------------------------------------

describe('the Yeti on the lawn', () => {
  it('stands at the zombies\' edge on the Tundra\'s ice lanes 0, 2 and 4 (the demo), its hp pinned, its patterns the shipped ones', () => {
    const c = bossDemoConfig('yeti', 1);
    expect(c.boss).toEqual({ key: 'yeti', faction: 'zombies', lane: 2 });
    expect(c.lawn.ice).toEqual({ lanes: [0, 2, 4], speed: 1.6 });
    const row = demoBalance('yeti').bosses.yeti;
    expect(row.phases).toEqual(BALANCE.bosses.yeti.phases);
    expect(row.patterns).toEqual(BALANCE.bosses.yeti.patterns);
    expect(row.hp).toBe(demoBalance('yeti').bosses.yeti.hp);
  });

  it('is drawn three times a unit\'s size, its breath hidden as it comes on, no dome yet', () => {
    const s = bossStage('yeti');
    s.play(1);
    const id = s.boss().id;
    expect(s.view.unit(id)?.bulk).toBe(3);
    expect(partShown(s.view, id, 'frostBreath')).toBe(false);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
  });

  it('its first shield mark puts up the snow fort: the glass dome in snow white and ice blue, thicker than the shipped glass, gone with the shield', () => {
    const s = bossStage('yeti');
    const fort = (): { fill: string; edge: string; opacity: number } => {
      let dome: Mesh | null = null;
      let edges: Mesh | null = null;
      s.scene.traverse((o) => {
        if (o.name === 'boss-shield-dome') dome = o as Mesh;
        if (o.name === 'boss-shield-edges') edges = o as Mesh;
      });
      const glass = (dome as unknown as Mesh).material as MeshStandardMaterial;
      return { fill: hex(glass), edge: hex((edges as unknown as Mesh).material as MeshBasicMaterial), opacity: glass.opacity };
    };
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    expect(s.view.bossFx.shielded).toBe(true);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(1);
    expect(s.view.bossFx.barkShut).toBe(false); // a dome, not plates
    expect(fort()).toEqual({ fill: '#E6F6FF', edge: '#4DAEE6', opacity: 0.26 });
    const sparkles = vi.spyOn(s.fx, 'sparkles');
    s.view.bossFx.ping(s.view.unit(s.boss().id)!.wrapper.position);
    expect(sparkles).toHaveBeenCalledWith(expect.anything(), 0xe6f6ff);
    s.play(6.2);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
  });

  it('the shipped bosses\' dome is still blue glass at its own opacity', () => {
    const s = bossStage('brainTitan');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    let glass: MeshStandardMaterial | null = null;
    s.scene.traverse((o) => { if (o.name === 'boss-shield-dome') glass = (o as Mesh).material as MeshStandardMaterial; });
    expect(hex(glass!)).toBe('#9FE7FF');
    expect(glass!.opacity).toBe(0.14);
  });

  it('a second fort rises after the first (a mark at 66% and one at 33%)', () => {
    const s = bossStage('yeti');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(1);
    s.play(6.5);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
    const second = s.until((e) => e.type === 'bossPhase');
    expect(second).not.toBeNull();
    s.play(0.1);
    expect(s.view.bossFx.shielded).toBe(true);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(1);
    expect(s.boss().phase).toBe(2);
  });

  it('the snow fort goes when it dies mid fort, and after a snapshot from before the fort is restored into the view', () => {
    const s = bossStage('yeti');
    s.play(1);
    const early = s.match.snapshot();
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(1);
    const restored = Match.restore(early, s.balance);
    s.view.applyEvents([], restored.state);
    s.view.frame(restored.state, 0.5, DT, 99);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
    // Back in the fort, then beaten under it.
    s.view.applyEvents([], s.match.state);
    s.frames(2);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(1);
    const boss = s.boss();
    boss.hp = 0;
    const events = s.match.step();
    s.view.applyEvents(events.filter((e) => e.type !== 'matchEnded'), s.match.state);
    s.frames(10);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(s.view.unit(boss.id)?.model.clip).toBe('die');
  });

  it('a new view that joins mid fort shows the dome from the state', () => {
    const s = bossStage('yeti');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.5);
    const restored = Match.restore(s.match.snapshot(), s.balance);
    const lateScene = new Scene();
    const late = new BattleView(lateScene, s.camera, s.lawn, s.fx, 'plants', { balance: s.balance });
    late.applyEvents([], restored.state);
    late.frame(restored.state, 0.5, DT, 0);
    expect(shown(lateScene, 'boss-shield-dome')).toBe(1);
    late.dispose();
  });

  it('its icy breath shows from its first mark, as the state says (a snapshot from before puts it out)', () => {
    const s = bossStage('yeti');
    s.play(1);
    const id = s.boss().id;
    const early = s.match.snapshot();
    expect(partShown(s.view, id, 'frostBreath')).toBe(false);
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    expect(partShown(s.view, id, 'frostBreath')).toBe(true);
    const restored = Match.restore(early, s.balance);
    s.view.applyEvents([], restored.state);
    expect(partShown(s.view, id, 'frostBreath')).toBe(false);
  });

  it('the club slam: the club rises through the wind-up with its arm (`ability`), the tiles show, and it ends in the blow', () => {
    const s = bossStage('yeti');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'slam' && e.windup);
    s.play(0.2);
    expect(s.view.bossFx.windingUp).toBe(true);
    expect(s.view.unit(s.boss().id)?.model.clip).toBe('ability');
    expect(shown(s.scene, 'boss-windup-tile')).toBe(3);
    s.until((e) => e.type === 'bossPattern' && e.kind === 'slam' && !e.windup);
    s.play(0.1);
    expect(shown(s.scene, 'boss-windup-tile')).toBe(0);
  });

  it('the avalanche: the lane is warned of in navy blinking inside a dark outline while its arms and club go up (`shoot`), then lands in white snow and stuns', () => {
    const s = bossStage('yeti');
    s.until((e) => e.type === 'bossPhase');
    const said = s.until((e) => e.type === 'bossStrike' && e.windup) as Extract<SimEvent, { type: 'bossStrike' }> | null;
    expect(said?.tiles.length).toBeGreaterThanOrEqual(5); // a whole lane
    expect(new Set(said!.tiles.map((t) => t.lane)).size).toBe(1);
    s.play(0.2);
    expect(s.view.bossFx.striking).toBe(true);
    expect(s.view.bossFx.strikeTileCount).toBe(said!.tiles.length);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(said!.tiles.length);
    expect(shown(s.scene, 'boss-boulder')).toBe(0); // snow, not rock
    expect(s.view.unit(s.boss().id)?.model.clip).toBe('shoot');
    let frame: MeshBasicMaterial | null = null;
    let fill: MeshBasicMaterial | null = null;
    s.scene.traverse((o) => {
      if (o.name === 'boss-strike-tile') frame = (o as unknown as { material: MeshBasicMaterial }).material;
      if (o.name === 'boss-strike-fill') fill = (o as unknown as { material: MeshBasicMaterial }).material;
    });
    expect(hex(frame!)).toBe('#06163F');
    expect(hex(fill!)).toBe('#0A2A70');
    // Solid blinking tiles, not the spore cloud's dither.
    const fx = s.view.bossFx as unknown as { ditherA: unknown };
    expect(fx.ditherA).toBeNull();
    const ring = vi.spyOn(s.fx, 'ring');
    s.until((e) => e.type === 'bossStrike' && !e.windup);
    expect(ring.mock.calls.filter((c) => c[1] === 0xffffff)).toHaveLength(said!.tiles.length);
    s.play(0.1);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(0);
    expect(s.match.state.units.some((u) => u.faction === 'plants' && u.stun > 0)).toBe(true);
  });

  it('the units it calls in are plain: no wolf ears, no wraps', () => {
    const s = bossStage('yeti');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'summon');
    s.play(0.2);
    expect(s.match.state.units.some((u) => u.key === 'veryFastWalker')).toBe(true);
    expect(shown(s.scene, 'boss-pup-ears')).toBe(0);
    expect(shown(s.scene, 'boss-mummy-wrap')).toBe(0);
  });

  it('falls in its avalanche\'s wind-up: no warning stays, its fall plays, and it breaks into snow and ice chips along its length', () => {
    const s = bossStage('yeti');
    s.until((e) => e.type === 'bossPhase');
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
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
    expect(s.view.unit(boss.id)?.model.clip).toBe('die');
    const debris = vi.spyOn(s.fx, 'debris');
    s.frames(100);
    const colors = BOSS_LOOK.yeti.fx.shards!.map((c) => parseInt(c.slice(1), 16));
    expect(debris).toHaveBeenCalled();
    expect(debris.mock.calls[0]?.[1]).toEqual(colors);
    s.frames(60);
    expect(s.view.unit(boss.id)).toBeUndefined();
  });

  it('draws its fort and avalanche frames without allocating', () => {
    const s = bossStage('yeti');
    s.until((e) => e.type === 'bossPhase');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.3);
    expect(allocationsIn(() => {
      for (let i = 0; i < 20; i++) s.view.bossFx.update(DT);
    })).toEqual({});
  });
});

// ---- The Glowcap on the lawn ----------------------------------------------------------------------

describe('the Glowcap on the lawn', () => {
  it('stands at the plant base in the Meadow\'s fog 5 (the demo), its hp pinned, its patterns the shipped ones', () => {
    const c = bossDemoConfig('glowcap', 1);
    expect(c.boss).toEqual({ key: 'glowcap', faction: 'plants', lane: 2 });
    expect(c.lawn.fog).toBe(5);
    const row = demoBalance('glowcap').bosses.glowcap;
    expect(row.phases).toEqual(BALANCE.bosses.glowcap.phases);
    expect(row.patterns).toEqual(BALANCE.bosses.glowcap.patterns);
  });

  it('is drawn four times a unit\'s size with its shells and lit spots hidden as it comes on', () => {
    const s = bossStage('glowcap');
    s.play(1);
    const id = s.boss().id;
    expect(s.view.unit(id)?.bulk).toBe(4);
    for (const name of ['capL', 'capR', 'spotsLit']) expect(partShown(s.view, id, name), name).toBe(false);
  });

  it('its shield is the cap shells (its own violet chips, no dome, no sand): shut from the state, hits throw chips, then gone', () => {
    const s = bossStage('glowcap');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    const id = s.boss().id;
    expect(s.view.bossFx.shielded).toBe(true);
    expect(s.view.bossFx.barkShut).toBe(true);
    expect(partShown(s.view, id, 'capL')).toBe(true);
    expect(partShown(s.view, id, 'capR')).toBe(true);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
    expect(shown(s.scene, 'boss-sand-ring')).toBe(0);
    const burst = vi.spyOn(s.fx, 'burst');
    s.play(0.4); // the clap
    const chips = BOSS_LOOK.glowcap.fx.plateChips!.map((c) => parseInt(c.slice(1), 16));
    expect(burst.mock.calls.some((c) => c[1] !== undefined && (c[1] as number[]).every((v, i) => v === chips[i]))).toBe(true);
    s.play(8.2);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(partShown(s.view, id, 'capL')).toBe(false);
    expect(partShown(s.view, id, 'capR')).toBe(false);
  });

  it('the cap goes when it dies mid shell, and after a snapshot from before the shield is restored into the view', () => {
    const s = bossStage('glowcap');
    s.play(1);
    const early = s.match.snapshot();
    s.until((e) => e.type === 'bossPhase');
    s.play(0.5);
    const id = s.boss().id;
    expect(partShown(s.view, id, 'capL')).toBe(true);
    const restored = Match.restore(early, s.balance);
    s.view.applyEvents([], restored.state);
    s.view.frame(restored.state, 0.5, DT, 99);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(partShown(s.view, id, 'capL')).toBe(false);
    s.view.applyEvents([], s.match.state);
    s.frames(2);
    expect(partShown(s.view, id, 'capL')).toBe(true);
    const boss = s.boss();
    boss.hp = 0;
    const events = s.match.step();
    s.view.applyEvents(events.filter((e) => e.type !== 'matchEnded'), s.match.state);
    s.frames(10);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(s.view.bossFx.barkShut).toBe(false);
    expect(partShown(s.view, id, 'capL')).toBe(false);
    expect(partShown(s.view, id, 'capR')).toBe(false);
    expect(s.view.unit(boss.id)?.model.clip).toBe('die');
  });

  it('a new view that joins mid shell shows the cap shut from the state', () => {
    const s = bossStage('glowcap');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.5);
    const restored = Match.restore(s.match.snapshot(), s.balance);
    const lateScene = new Scene();
    const late = new BattleView(lateScene, s.camera, s.lawn, s.fx, 'zombies', { balance: s.balance });
    late.applyEvents([], restored.state);
    late.frame(restored.state, 0.5, DT, 0);
    expect(late.bossFx.shielded).toBe(true);
    late.dispose();
  });

  it('its barrage flies glowing spore bombs, no acorns, each with a landing mark; they are pooled', () => {
    const s = bossStage('glowcap');
    const bombs = (): Set<Object3D> => {
      const out = new Set<Object3D>();
      s.scene.traverse((o) => { if (o.name === 'projectile-spore-bomb') out.add(o); });
      return out;
    };
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    s.play(0.4);
    const flying = s.match.state.projectiles.filter((p) => p.kind === 'acorn').length;
    expect(flying).toBeGreaterThan(0);
    expect(shown(s.scene, 'projectile-spore-bomb')).toBe(flying);
    expect(shown(s.scene, 'projectile-acorn')).toBe(0);
    expect(shown(s.scene, 'projectile-needle')).toBe(0);
    expect(shown(s.scene, 'projectile-frozen-melon')).toBe(0);
    expect(shown(s.scene, 'boss-acorn-mark')).toBe(flying);
    const trail = vi.spyOn(s.fx, 'trail');
    s.frames(2);
    expect(trail.mock.calls.some((c) => c[1] === 0xb07cf0)).toBe(true);
    const first = bombs();
    s.play(6);
    expect(shown(s.scene, 'projectile-spore-bomb')).toBe(0);
    s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
    s.play(0.4);
    for (const o of bombs()) expect(first.has(o)).toBe(true);
  });

  it('the Melon still throws melons and the Cactus King needles (no spore bombs)', () => {
    for (const [key, name] of [['frostMelon', 'projectile-frozen-melon'], ['cactusKing', 'projectile-needle']] as const) {
      const s = bossStage(key);
      s.until((e) => e.type === 'bossPattern' && e.kind === 'barrage');
      s.play(0.4);
      expect(shown(s.scene, name), key).toBeGreaterThan(0);
      expect(shown(s.scene, 'projectile-spore-bomb'), key).toBe(0);
    }
  });

  it('the spore cloud: four zombie tiles are warned of in purple smoke (a crawling dither, no boulder) while its spots blink lit and the cap swells (`cheer`)', () => {
    const s = bossStage('glowcap');
    s.until((e) => e.type === 'bossPhase');
    const said = s.until((e) => e.type === 'bossStrike' && e.windup) as Extract<SimEvent, { type: 'bossStrike' }> | null;
    expect(said?.tiles).toHaveLength(4);
    s.play(0.3);
    const id = s.boss().id;
    expect(s.view.bossFx.striking).toBe(true);
    expect(s.view.bossFx.strikeTileCount).toBe(4);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(4);
    expect(shown(s.scene, 'boss-boulder')).toBe(0);
    expect(s.view.unit(id)?.model.clip).toBe('cheer');
    let frame: MeshBasicMaterial | null = null;
    let fill: Mesh | null = null;
    s.scene.traverse((o) => {
      if (o.name === 'boss-strike-tile') frame = (o as unknown as { material: MeshBasicMaterial }).material;
      if (o.name === 'boss-strike-fill' && (o as Mesh).visible) fill = o as Mesh;
    });
    expect(hex(frame!)).toBe('#E4D2FF');
    expect(hex((fill as unknown as Mesh).material as MeshBasicMaterial)).toBe('#5A1FA8');
    const fx = s.view.bossFx as unknown as { ditherA: Mesh['geometry']; ditherB: Mesh['geometry'] };
    // The two checkers swap at the blink's beat.
    const seen = new Set<unknown>();
    const lit = new Set<boolean>();
    for (let i = 0; i < 40; i++) {
      s.frames(3);
      seen.add((fill as unknown as Mesh).geometry);
      lit.add(partShown(s.view, id, 'spotsLit'));
    }
    expect([...seen].every((g) => g === fx.ditherA || g === fx.ditherB)).toBe(true);
    expect(seen.size).toBe(2);
    // The lit spots blink with the tiles.
    expect(lit.has(true)).toBe(true);
    const ring = vi.spyOn(s.fx, 'ring');
    s.until((e) => e.type === 'bossStrike' && !e.windup);
    expect(ring.mock.calls.filter((c) => c[1] === 0xb07cf0)).toHaveLength(4);
    s.play(0.1);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(0);
    expect(partShown(s.view, id, 'spotsLit')).toBe(false);
    expect(s.match.state.units.some((u) => u.faction === 'zombies' && u.poison > 0)).toBe(true);
  });

  it('its pupils follow the nearest zombie across the lanes', () => {
    const s = bossStage('glowcap');
    s.play(1);
    const view = s.view.unit(s.boss().id)!;
    const shift = vi.spyOn(view, 'shiftPart');
    s.play(3);
    const pupils = shift.mock.calls.filter((c) => c[0] === 'pupils');
    expect(pupils.length).toBeGreaterThan(0);
    expect(pupils.some((c) => c[3] !== 0)).toBe(true);
  });

  it('falls deflating: its sag plays and it breaks into violet and glowing chips across its three lanes', () => {
    const s = bossStage('glowcap');
    s.play(2);
    const boss = s.boss();
    boss.hp = 0;
    const events = s.match.step();
    s.view.applyEvents(events.filter((e) => e.type !== 'matchEnded'), s.match.state);
    s.frames(10);
    expect(s.view.unit(boss.id)?.model.clip).toBe('die');
    const lanes: number[] = [];
    const original = s.fx.debris.bind(s.fx);
    const debris = vi.spyOn(s.fx, 'debris').mockImplementation((at, colors, count) => {
      lanes.push(at.z);
      original(at, colors, count);
    });
    s.frames(100);
    const colors = BOSS_LOOK.glowcap.fx.shards!.map((c) => parseInt(c.slice(1), 16));
    expect(debris.mock.calls[0]?.[1]).toEqual(colors);
    expect(Math.max(...lanes) - Math.min(...lanes)).toBeCloseTo(2, 5);
  });

  it('draws its spore cloud frames without allocating', () => {
    const s = bossStage('glowcap');
    s.until((e) => e.type === 'bossPhase');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.3);
    expect(allocationsIn(() => {
      for (let i = 0; i < 20; i++) s.view.bossFx.update(DT);
    })).toEqual({});
  });
});

// ---- First use: everything is warmed as the fight comes on ------------------------------------------

describe('nothing is drawn for the first time after the entrance', () => {
  function warmMeshes(scene: Scene): Mesh[] {
    const warm: Mesh[] = [];
    scene.traverse((o) => { if (o.name === 'boss-warm') warm.push(o as Mesh); });
    return warm;
  }

  it('the Yeti\'s warm-up draws the snow fort\'s glass and edges, its breath and its slam tiles at no size', () => {
    const s = bossStage('yeti');
    s.play(1 / 30); // one step, two frames: it has come on, one warm frame is left
    const warm = warmMeshes(s.scene);
    const fx = s.view.bossFx as unknown as { domeGeometry: unknown; domeMaterial: unknown; edgeGeometry: unknown; edgeMaterial: unknown; tileMaterial: unknown; frameGeometry: unknown };
    const has = (geometry: unknown, material: unknown): boolean => warm.some((m) => m.geometry === geometry && m.material === material);
    expect(has(fx.domeGeometry, fx.domeMaterial)).toBe(true);
    expect(has(fx.edgeGeometry, fx.edgeMaterial)).toBe(true);
    expect(has(fx.frameGeometry, fx.tileMaterial)).toBe(true);
    const breath = s.view.unit(s.boss().id)!.model.root.getObjectByName('frostBreath')!;
    let piece: Mesh | null = null;
    breath.traverse((o) => { if ((o as Mesh).isMesh) piece = o as Mesh; });
    expect(has(piece!.geometry, piece!.material)).toBe(true);
    for (const m of warm) expect(m.scale.x).toBe(0);
  });

  it('the Glowcap\'s warm-up draws the dither pair, the landing marks, the cap shells and the lit spots at no size', () => {
    const s = bossStage('glowcap');
    s.play(1 / 30);
    const warm = warmMeshes(s.scene);
    const fx = s.view.bossFx as unknown as { ditherA: unknown; ditherB: unknown; strikeFillMaterial: unknown; markGeometry: unknown; markMaterial: unknown };
    const has = (geometry: unknown, material: unknown): boolean => warm.some((m) => m.geometry === geometry && m.material === material);
    expect(fx.ditherA).not.toBeNull();
    expect(has(fx.ditherA, fx.strikeFillMaterial)).toBe(true);
    expect(has(fx.ditherB, fx.strikeFillMaterial)).toBe(true);
    expect(has(fx.markGeometry, fx.markMaterial)).toBe(true);
    const root = s.view.unit(s.boss().id)!.model.root;
    for (const name of ['capL', 'capR', 'spotsLit']) {
      let piece: Mesh | null = null;
      root.getObjectByName(name)!.traverse((o) => { if ((o as Mesh).isMesh) piece = o as Mesh; });
      expect(has(piece!.geometry, piece!.material), name).toBe(true);
    }
    for (const m of warm) expect(m.scale.x).toBe(0);
  });

  it('BattleView.warmShots also draws the frozen melon, the needle and the spore bomb, at no size, then they go', () => {
    const s = bossStage('glowcap');
    // The view has just been made: the warm group is still in the scene.
    const warm: Mesh[] = [];
    s.scene.traverse((o) => { if (o.name === 'projectile-warm') warm.push(o as Mesh); });
    const geometries = new Set(warm.map((m) => m.geometry));
    for (const make of [makeFrozenMelon, makeNeedle, makeSporeBomb]) expect(geometries.has((make() as Mesh).geometry), make.name).toBe(true);
    for (const m of warm) {
      expect(m.scale.x).toBe(0);
      expect(m.frustumCulled).toBe(false);
    }
    s.play(0.2);
    let left = 0;
    s.scene.traverse((o) => { if (o.name === 'projectile-warm') left++; });
    expect(left).toBe(0);
  });

  it('the statuses\' and the puddles\' instanced shapes are drawn once at no size as the view comes on (a stun or a poison builds nothing mid-fight), then they go', () => {
    const s = bossStage('yeti');
    s.play(1 / 30); // one step, two frames: one warm frame is left
    const batches = (): Mesh[] => {
      const out: Mesh[] = [];
      s.scene.traverse((o) => { if (o.name === 'mark-batch' || o.name === 'hazard-bubbles') out.push(o as Mesh); });
      return out;
    };
    const warm = batches().filter((m) => m.visible);
    // Every shape of the marks (ten) and the puddle's bubbles, each one copy scaled to nothing.
    expect(warm.length).toBe(batches().length);
    expect(warm.length).toBeGreaterThanOrEqual(11);
    for (const m of warm) {
      const batch = m as unknown as { count: number; instanceMatrix: { array: Float32Array } };
      expect(batch.count).toBe(1);
      expect(batch.instanceMatrix.array[0]).toBe(0); // scaled to nothing
    }
    s.play(0.2);
    expect(batches().filter((m) => m.visible)).toHaveLength(0);
  });

  /**
   * What is drawn now (every parent of the mesh visible, at any size) among the boss's own meshes (anything under its wrapper:
   * needing its geometry alone to be known, since a hit flash swaps a unit's material for a moment), its fight pieces (`boss-*`)
   * and the shots (`projectile-*`), each needing its geometry and material pair to be known. Each gives both.
   */
  function drawn(scene: Scene, bossId: number): { need: string; gives: string[]; name: string }[] {
    const out: { need: string; gives: string[]; name: string }[] = [];
    scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      for (let p: Object3D | null = m; p; p = p.parent) if (!p.visible) return;
      let onBoss = false;
      for (let p: Object3D | null = m; p && !onBoss; p = p.parent) if (p.name === `unit-${bossId}`) onBoss = true;
      const piece = o.name.startsWith('boss-') || o.name.startsWith('projectile-');
      if (!onBoss && !piece) return;
      const geometry = `g:${m.geometry.uuid}`;
      const pair = `p:${m.geometry.uuid}/${(m.material as { uuid: string }).uuid}`;
      out.push({ need: onBoss && !piece ? geometry : pair, gives: [geometry, pair], name: o.name || m.parent?.name || '?' });
    });
    return out;
  }

  it.each(['yeti', 'glowcap'] as const)('%s: from the end of its entrance to its fall, every geometry and material its fight draws was already drawn', (key) => {
    const s = bossStage(key);
    s.play(1 / 30);
    const bossId = s.boss().id;
    const known = new Set<string>();
    const learn = (): void => { for (const d of drawn(s.scene, bossId)) for (const k of d.gives) known.add(k); };
    // The entrance (1.5 s) and the warm frames go by: whatever is drawn here counts as drawn.
    learn();
    for (let i = 0; i < 5; i++) {
      s.play(1 / 30);
      learn();
    }
    s.play(1.7);
    learn();
    const late: string[] = [];
    for (let i = 0; i < 100 * 30 && s.match.state.winner === null; i++) {
      s.play(1 / 30);
      for (const d of drawn(s.scene, bossId)) {
        if (!known.has(d.need)) late.push(`${d.name} at ${(s.match.state.tick / 30).toFixed(2)} s`);
        for (const k of d.gives) known.add(k);
      }
    }
    expect(s.match.state.winner).not.toBeNull();
    expect(late).toEqual([]);
  });
});

// ---- The two parked step-3 leaks ---------------------------------------------------------------------

describe('the warm-up\'s meshes are not left behind', () => {
  it('a second `enter` adds no duplicate boss-warm meshes', () => {
    const s = bossStage('glowcap');
    s.play(1 / 30);
    const count = (): number => {
      let n = 0;
      s.scene.traverse((o) => { if (o.name === 'boss-warm') n++; });
      return n;
    };
    const once = count();
    expect(once).toBeGreaterThan(5);
    s.view.bossFx.enter(s.view.unit(s.boss().id)!, true);
    expect(count()).toBe(once);
    s.view.bossFx.enter(s.view.unit(s.boss().id)!, false);
    expect(count()).toBe(once);
    // And they still go after their frames.
    s.view.bossFx.update(DT);
    s.view.bossFx.update(DT);
    s.view.bossFx.update(DT);
    expect(count()).toBe(0);
  });

  it('dispose takes the boss-warm meshes out of the scene, one by one, with the rest of what the boss fx added', () => {
    for (const key of ['yeti', 'glowcap'] as const) {
      const s = bossStage(key);
      s.play(1 / 30);
      const warm: Mesh[] = [];
      s.scene.traverse((o) => { if (o.name === 'boss-warm') warm.push(o as Mesh); });
      expect(warm.length, key).toBeGreaterThan(5);
      s.view.bossFx.dispose();
      for (const m of warm) expect(m.parent, key).toBeNull();
      s.view.dispose();
      expect([...s.scene.children], key).toEqual(s.before);
    }
  });

  it('dispose takes everything it added out of the scene, mid fort and mid cloud', () => {
    const s = bossStage('yeti');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.3);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(1);
    s.view.dispose();
    expect([...s.scene.children]).toEqual(s.before);
    const g = bossStage('glowcap');
    g.until((e) => e.type === 'bossPhase');
    g.until((e) => e.type === 'bossStrike' && e.windup);
    g.play(0.3);
    g.view.dispose();
    expect([...g.scene.children]).toEqual(g.before);
  });
});
