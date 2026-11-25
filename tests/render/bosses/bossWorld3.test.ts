import { Scene } from 'three';
import type { MeshBasicMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AudioEngine, PlayOptions, SfxName } from '../../../src/audio/AudioEngine';
import { playEventSounds } from '../../../src/audio/bindings';
import { SFX, SFX_NAMES } from '../../../src/audio/sfx';
import { Voice, makeNoise } from '../../../src/audio/synth';
import { BALANCE } from '../../../src/data/balance';
import { BOSS_LOOK } from '../../../src/data/bossLooks';
import { BattleView } from '../../../src/render/battle/BattleView';
import { BOSS_SCALE } from '../../../src/render/battle/BossFx';
import { cactusKing } from '../../../src/render/models/bosses/cactusKing';
import { sandPharaoh } from '../../../src/render/models/bosses/sandPharaoh';
import { BOSS_MODELS, getModelDef } from '../../../src/render/models/registry';
import { buildParts, modelStats } from '../../../src/render/voxel/build';
import { bossDemoConfig, bossDemoMatch, demoBalance } from '../../../src/scenes/bossScript';
import { Match } from '../../../src/sim/match';
import { BOSS_HALF_WIDTH } from '../../../src/sim/types';
import type { BossKey, SimEvent } from '../../../src/sim/types';
import { FakeAudioContext } from '../../audio/fakeAudioContext';
import { allocationsIn } from '../allocations';
import { DT, bossStage, digest, partShown, shown } from './stage';

// Step 3 (Desert Canyon) Task 2: the Sand Pharaoh and the Cactus King, their models, their shows on
// the lawn (the sand swirl, the boulders, the mummies' wraps, the spine plates, the phase-2 glow,
// the shards) and their four sounds; and the four shipped bosses' demo frames, pinned from before.

const BOSS_TRIANGLES = 6000;
const BOSS_KEYS = Object.keys(BOSS_HALF_WIDTH) as BossKey[];

// ---- The shipped bosses are untouched ---------------------------------------------------------------

const SHIPPED: BossKey[] = ['brainTitan', 'elderOak', 'moonHowler', 'frostMelon'];
const TIMES = [0.5, 8, 12, 31, 33.5, 40];
/** The digests of each shipped boss's demo, drawn through a real BattleView, taken on the base commit before any world-3 change. */
const BEFORE: Record<string, number[]> = {"brainTitan": [2125167906, 3340314198, 1030107703, 1486708051, 1693661940, 2782069281], "elderOak": [2642507999, 3638748648, 2896188870, 1942210966, 976115270, 1591669113], "moonHowler": [154721315, 9382666, 1990587817, 2739803951, 3154212110, 2175298726], "frostMelon": [3254480392, 4086559018, 3861059545, 2589734075, 1843271986, 3271341202]};

describe('the shipped bosses\' demo frames', () => {
  it.each(SHIPPED)('%s: every frame (the scene\'s objects, matrices, colours and vertices) is as it was before the world-3 shows', (key) => {
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

// ---- Every boss has a look and two sounds -------------------------------------------------------------

describe('BOSS_LOOK and the sounds', () => {
  it.each(BOSS_KEYS)('%s: a complete row, a model of its own key, and its two sounds exist, differ and are bound to its events', (key) => {
    const look = BOSS_LOOK[key];
    expect(look.scale).toBeGreaterThan(1);
    expect(BOSS_SCALE[key]).toBe(look.scale);
    expect(look.face.filter((p) => p[4] === 'eye')).toHaveLength(2);
    expect(look.bar.fill).not.toBe('');
    expect(look.bar.hi).not.toBe('');
    expect(SFX_NAMES).toContain(look.call);
    expect(SFX_NAMES).toContain(look.defeat);
    expect(look.call).not.toBe(look.defeat);
    expect(BOSS_MODELS[key].key).toBe(key);
    expect(getModelDef(key)).toBe(BOSS_MODELS[key]);
    // Heard: its call on its patterns, its defeat sting when it falls.
    const m = bossDemoMatch(key, 1);
    m.step();
    const boss = m.state.units.find((u) => u.key === key)!;
    const heard: SfxName[] = [];
    const audio = { play: (name: SfxName, _o?: PlayOptions) => heard.push(name) } as unknown as AudioEngine;
    playEventSounds(audio, [{ type: 'bossPattern', unitId: boss.id, kind: 'shield', lane: boss.lane, col: null, windup: false }], 'plants', { state: m.state });
    expect(heard).toEqual([look.call]);
    playEventSounds(audio, [{ type: 'bossDefeated', unitId: boss.id, key, faction: boss.faction }], 'plants', { state: m.state });
    expect(heard).toEqual([look.call, look.defeat]);
  });

  it('the world-3 rows are their own: not the Titan\'s or the Oak\'s', () => {
    expect(BOSS_LOOK.sandPharaoh).not.toEqual(BOSS_LOOK.brainTitan);
    expect(BOSS_LOOK.cactusKing).not.toEqual(BOSS_LOOK.elderOak);
    expect(BOSS_LOOK.sandPharaoh.face).not.toEqual(BOSS_LOOK.brainTitan.face);
    expect(BOSS_LOOK.cactusKing.face).not.toEqual(BOSS_LOOK.elderOak.face);
    expect(BOSS_LOOK.sandPharaoh).toMatchObject({ scale: 2.8, call: 'pharaohCall', defeat: 'pharaohDefeat' });
    expect(BOSS_LOOK.sandPharaoh.fx).toMatchObject({ shield: 'sand', summonLook: 'mummies', strike: 'shoot', phaseParts: ['glowEyes'], defeat: 'shards' });
    expect(BOSS_LOOK.cactusKing).toMatchObject({ scale: 4, call: 'cactusCreak', defeat: 'cactusDefeat' });
    expect(BOSS_LOOK.cactusKing.fx).toMatchObject({ shield: 'bark', strikeBlow: 'boulder', strike: 'cheer', eyes: 'follow', defeat: 'shards' });
    // The Howler is the pups' only owner, and the shipped bosses have no boulder.
    expect(BOSS_LOOK.moonHowler.fx.summonLook).toBe('pups');
    for (const key of SHIPPED) expect(BOSS_LOOK[key].fx.strikeBlow, key).toBeUndefined();
  });
});

// ---- The models ------------------------------------------------------------------------------------

describe('the Sand Pharaoh\'s model', () => {
  it(`builds, is the registry's, has one look and costs at most ${BOSS_TRIANGLES} triangles, its hidden parts counted`, () => {
    expect(() => buildParts(sandPharaoh, 1)).not.toThrow();
    expect(BOSS_MODELS.sandPharaoh).toBe(sandPharaoh);
    expect(sandPharaoh.key).toBe('sandPharaoh');
    expect(sandPharaoh.singleLevel).toBe(true);
    expect(modelStats(sandPharaoh, 1).triangles).toBeLessThanOrEqual(BOSS_TRIANGLES);
  });

  it('has the clips its shows play and a glowing-eyes part built hidden', () => {
    for (const clip of ['idle', 'walk', 'melee', 'ability', 'shoot', 'cheer', 'die', 'hit', 'spawn'] as const) expect(sandPharaoh.clips[clip], clip).toBeDefined();
    expect(sandPharaoh.parts.find((p) => p.name === 'glowEyes')?.hidden).toBe(true);
    expect(sandPharaoh.parts.some((p) => p.name === 'staff')).toBe(true);
    // A part the view shows from phase 2 is not one a unit's own view drives.
    expect(sandPharaoh.parts.some((p) => p.name === 'glow')).toBe(false);
  });
});

describe('the Cactus King\'s model', () => {
  it(`builds, is the registry's, has one look and costs at most ${BOSS_TRIANGLES} triangles, its hidden plates counted`, () => {
    expect(() => buildParts(cactusKing, 1)).not.toThrow();
    expect(BOSS_MODELS.cactusKing).toBe(cactusKing);
    expect(cactusKing.key).toBe('cactusKing');
    expect(cactusKing.singleLevel).toBe(true);
    expect(modelStats(cactusKing, 1).triangles).toBeLessThanOrEqual(BOSS_TRIANGLES);
  });

  it('has the parts the view drives (pupils that follow, two hidden plates) and the clips its shows play', () => {
    for (const clip of ['idle', 'shoot', 'cheer', 'ability', 'die', 'hit', 'spawn'] as const) expect(cactusKing.clips[clip], clip).toBeDefined();
    expect(cactusKing.clips.cheer?.loop).toBe(true); // held through the rockfall's wind-up
    for (const name of ['barkL', 'barkR']) expect(cactusKing.parts.find((p) => p.name === name)?.hidden, name).toBe(true);
    expect(cactusKing.parts.some((p) => p.name === 'pupils')).toBe(true);
  });
});

// ---- The Sand Pharaoh on the lawn ------------------------------------------------------------------

describe('the Sand Pharaoh on the lawn', () => {
  it('stands in the Desert\'s rocks (the demo), and fights the shipped numbers', () => {
    const c = bossDemoConfig('sandPharaoh', 1);
    expect(c.boss).toEqual({ key: 'sandPharaoh', faction: 'zombies', lane: 2 });
    expect(c.lawn.rocks).toHaveLength(6);
    expect(demoBalance('sandPharaoh').bosses.sandPharaoh).toEqual(BALANCE.bosses.sandPharaoh);
  });

  it('is drawn 2.8 times a unit\'s size, its glowing eyes hidden as it comes on, no sand yet', () => {
    const s = bossStage('sandPharaoh');
    s.play(1);
    const id = s.boss().id;
    expect(s.view.unit(id)?.bulk).toBe(2.8);
    expect(partShown(s.view, id, 'glowEyes')).toBe(false);
    expect(shown(s.scene, 'boss-sand-ring')).toBe(0);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
  });

  it('its shield is a swirl of sand (no glass dome) while the shield is up, turning in steps, then gone; shots ping off in sand', () => {
    const s = bossStage('sandPharaoh');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    expect(s.view.bossFx.shielded).toBe(true);
    expect(shown(s.scene, 'boss-sand-ring')).toBe(1);
    expect(shown(s.scene, 'boss-sand-layer')).toBe(3);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
    const turns = new Set<number>();
    for (let f = 0; f < 60; f++) {
      s.frames(1);
      s.scene.traverse((o) => { if (o.name === 'boss-sand-layer') turns.add(o.rotation.y); });
    }
    expect(turns.size).toBeGreaterThan(3);
    const sparkles = vi.spyOn(s.fx, 'sparkles');
    s.view.bossFx.ping(s.view.unit(s.boss().id)!.wrapper.position);
    expect(sparkles).toHaveBeenCalledWith(expect.anything(), 0xe2c68a);
    s.play(7.5);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(shown(s.scene, 'boss-sand-ring')).toBe(0);
  });

  it('the sand swirl goes when it dies mid shield, and after a snapshot from before the shield is restored into the view', () => {
    const s = bossStage('sandPharaoh');
    s.play(1);
    const early = s.match.snapshot();
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    expect(shown(s.scene, 'boss-sand-ring')).toBe(1);
    // A snapshot from before the shield, restored into the same view: no swirl left.
    const restored = Match.restore(early, s.balance);
    s.view.applyEvents([], restored.state);
    s.view.frame(restored.state, 0.5, DT, 99);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(shown(s.scene, 'boss-sand-ring')).toBe(0);
    // Back in the shield, then beaten under it.
    s.view.applyEvents([], s.match.state);
    s.frames(2);
    expect(shown(s.scene, 'boss-sand-ring')).toBe(1);
    const boss = s.boss();
    boss.hp = 0;
    const events = s.match.step();
    s.view.applyEvents(events.filter((e) => e.type !== 'matchEnded'), s.match.state);
    s.frames(10);
    expect(shown(s.scene, 'boss-sand-ring')).toBe(0);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(s.view.unit(boss.id)?.model.clip).toBe('die');
  });

  it('a new view that joins mid shield shows the swirl from the state', () => {
    const s = bossStage('sandPharaoh');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.5);
    const restored = Match.restore(s.match.snapshot(), s.balance);
    const lateScene = new Scene();
    const late = new BattleView(lateScene, s.camera, s.lawn, s.fx, 'plants', { balance: s.balance });
    late.applyEvents([], restored.state);
    late.frame(restored.state, 0.5, DT, 0);
    expect(shown(lateScene, 'boss-sand-ring')).toBe(1);
    late.dispose();
  });

  it('the staff slam: the staff rises through the wind-up with its arm (`ability`), the tiles show, and it ends in the blow', () => {
    const s = bossStage('sandPharaoh');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'slam' && e.windup);
    s.play(0.2);
    expect(s.view.bossFx.windingUp).toBe(true);
    expect(s.view.unit(s.boss().id)?.model.clip).toBe('ability');
    expect(shown(s.scene, 'boss-windup-tile')).toBe(3);
    s.until((e) => e.type === 'bossPattern' && e.kind === 'slam' && !e.windup);
    s.play(0.1);
    expect(shown(s.scene, 'boss-windup-tile')).toBe(0);
  });

  it('the sandstorm: three plants are warned of in a whirl of dark dust (its `shoot`, drawn out over the wind-up), then blinded; the blow lands in sand', () => {
    const s = bossStage('sandPharaoh');
    const said = s.until((e) => e.type === 'bossStrike' && e.windup) as Extract<SimEvent, { type: 'bossStrike' }> | null;
    expect(said?.tiles).toHaveLength(3);
    s.play(0.2);
    expect(s.view.bossFx.striking).toBe(true);
    expect(s.view.bossFx.strikeTileCount).toBe(3);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(3);
    expect(shown(s.scene, 'boss-boulder')).toBe(0); // dust, not rock
    expect(s.view.unit(s.boss().id)?.model.clip).toBe('shoot');
    let frame: MeshBasicMaterial | null = null;
    s.scene.traverse((o) => { if (o.name === 'boss-strike-tile') frame = (o as unknown as { material: MeshBasicMaterial }).material; });
    expect(`#${frame!.color.getHexString().toUpperCase()}`).toBe('#FFF1C9');
    const ring = vi.spyOn(s.fx, 'ring');
    s.until((e) => e.type === 'bossStrike' && !e.windup);
    expect(ring.mock.calls.filter((c) => c[1] === 0xe2c68a)).toHaveLength(3);
    s.play(0.1);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(0);
    expect(s.match.state.units.some((u) => u.faction === 'plants' && u.blind > 0)).toBe(true);
  });

  it('its glowing eyes show only from phase 2, as the state says (a snapshot from before puts them out)', () => {
    const s = bossStage('sandPharaoh');
    s.play(1);
    const id = s.boss().id;
    const early = s.match.snapshot();
    expect(partShown(s.view, id, 'glowEyes')).toBe(false);
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    expect(partShown(s.view, id, 'glowEyes')).toBe(true);
    const restored = Match.restore(early, s.balance);
    s.view.applyEvents([], restored.state);
    expect(partShown(s.view, id, 'glowEyes')).toBe(false);
  });

  it('the units it calls in phase 2 (Skeleton Warriors) are wrapped as mummies, head and torso, the Desert Zombies of phase 1 are not', () => {
    const s = bossStage('sandPharaoh');
    const wraps = (): number => shown(s.scene, 'boss-mummy-wrap');
    // Phase 1: Desert Zombies, already bandaged.
    s.until((e) => e.type === 'bossPattern' && e.kind === 'summon');
    s.play(0.1);
    expect(s.match.state.units.filter((u) => u.key === 'desertZombie').length).toBeGreaterThanOrEqual(2);
    expect(wraps()).toBe(0);
    // Phase 2: two Skeleton Warriors at level 2, two wraps each.
    s.until((e) => e.type === 'bossPhase');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'summon');
    s.play(0.1);
    const warriors = s.match.state.units.filter((u) => u.key === 'skeletonWarrior' && u.level === 2);
    expect(warriors.length).toBeGreaterThanOrEqual(2);
    expect(wraps()).toBe(4);
    for (const w of warriors.slice(0, 2)) {
      const view = s.view.unit(w.id)!;
      for (const part of ['head', 'torso']) {
        const holder = view.model.root.getObjectByName(part)!;
        expect(holder.children.some((c) => c.name === 'boss-mummy-wrap'), part).toBe(true);
      }
    }
    // No wolf ears on them.
    expect(shown(s.scene, 'boss-pup-ears')).toBe(0);
  });

  it('falls in its sandstorm\'s wind-up: no warning stays, no swirl, its fall plays, and it crumbles into sand and gold along its length', () => {
    const s = bossStage('sandPharaoh');
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
    expect(shown(s.scene, 'boss-sand-ring')).toBe(0);
    expect(s.view.unit(boss.id)?.model.clip).toBe('die');
    const debris = vi.spyOn(s.fx, 'debris');
    s.frames(100);
    const colors = BOSS_LOOK.sandPharaoh.fx.shards!.map((c) => parseInt(c.slice(1), 16));
    expect(debris).toHaveBeenCalled();
    expect(debris.mock.calls[0]?.[1]).toEqual(colors);
    s.frames(60);
    expect(s.view.unit(boss.id)).toBeUndefined();
  });

  it('draws its sand shield and mummy frames without allocating', () => {
    const s = bossStage('sandPharaoh');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.3);
    expect(allocationsIn(() => {
      for (let i = 0; i < 20; i++) s.view.bossFx.update(DT);
    })).toEqual({});
  });
});

// ---- The Cactus King on the lawn -------------------------------------------------------------------

describe('the Cactus King on the lawn', () => {
  it('stands at the plant base with the rocks on its flanks (the demo); its demo table is the shipped one with its phase-2 summon brought forward', () => {
    const c = bossDemoConfig('cactusKing', 1);
    expect(c.boss).toEqual({ key: 'cactusKing', faction: 'plants', lane: 2 });
    expect(c.lawn.rocks).toHaveLength(4);
    const row = demoBalance('cactusKing').bosses.cactusKing;
    expect(row.hp).toBe(BALANCE.bosses.cactusKing.hp);
    expect(row.phases?.[0]).toEqual(BALANCE.bosses.cactusKing.phases?.[0]);
    expect(row).not.toBe(BALANCE.bosses.cactusKing);
    expect(BALANCE.bosses.cactusKing.phases?.[1]?.some((p) => p.kind === 'summon' && p.everySeconds === 12)).toBe(true);
    expect(row.phases?.[1]?.map((p) => p.kind)).toEqual(['strike', 'summon', 'barrage']);
  });

  it('is drawn four times a unit\'s size with its plates hidden as it comes on', () => {
    const s = bossStage('cactusKing');
    s.play(1);
    const id = s.boss().id;
    expect(s.view.unit(id)?.bulk).toBe(4);
    expect(partShown(s.view, id, 'barkL')).toBe(false);
    expect(partShown(s.view, id, 'barkR')).toBe(false);
    expect(shown(s.scene, 'boss-boulder')).toBe(0);
  });

  it('its shield is the spine plates (its own green, not walnut bark): shut from the state, hits throw green and cream chips, then gone', () => {
    const s = bossStage('cactusKing');
    s.until((e) => e.type === 'bossPhase');
    s.play(0.1);
    const id = s.boss().id;
    expect(s.view.bossFx.shielded).toBe(true);
    expect(s.view.bossFx.barkShut).toBe(true);
    expect(partShown(s.view, id, 'barkL')).toBe(true);
    expect(partShown(s.view, id, 'barkR')).toBe(true);
    expect(shown(s.scene, 'boss-shield-dome')).toBe(0);
    expect(shown(s.scene, 'boss-sand-ring')).toBe(0);
    const burst = vi.spyOn(s.fx, 'burst');
    s.play(0.4); // the clap
    const chips = BOSS_LOOK.cactusKing.fx.plateChips!.map((c) => parseInt(c.slice(1), 16));
    expect(burst.mock.calls.some((c) => c[1] !== undefined && (c[1] as number[]).every((v, i) => v === chips[i]))).toBe(true);
    s.play(8.2);
    expect(s.view.bossFx.shielded).toBe(false);
    expect(partShown(s.view, id, 'barkL')).toBe(false);
  });

  it('the Oak\'s plates still throw walnut bark', () => {
    expect(BOSS_LOOK.elderOak.fx.plateChips).toBeUndefined();
  });

  it('the rockfall: three zombie tiles are warned of in shadow and a boulder hangs over each, coming lower, while its arms go up (`cheer`)', () => {
    const s = bossStage('cactusKing');
    const said = s.until((e) => e.type === 'bossStrike' && e.windup) as Extract<SimEvent, { type: 'bossStrike' }> | null;
    expect(said?.tiles).toHaveLength(3);
    s.play(0.3); // (a root bitten on the way in plays its one-shot hit first)
    expect(s.view.bossFx.striking).toBe(true);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(3);
    expect(shown(s.scene, 'boss-boulder')).toBe(3);
    expect(s.view.unit(s.boss().id)?.model.clip).toBe('cheer');
    const heights = (): number[] => {
      const out: number[] = [];
      s.scene.traverse((o) => { if (o.name === 'boss-boulder' && o.visible) out.push(o.position.y); });
      return out;
    };
    const high = Math.max(...heights());
    expect(high).toBeGreaterThan(2);
    s.play(1.5);
    const mid = Math.max(...heights());
    expect(mid).toBeLessThan(high);
    expect(mid).toBeGreaterThan(0.5);
    // Over the tiles it announced.
    const tiles = said!.tiles.map((t) => `${t.col + 0.5},${t.lane + 0.5}`).sort();
    const over: string[] = [];
    s.scene.traverse((o) => { if (o.name === 'boss-boulder' && o.visible) over.push(`${o.position.x},${o.position.z}`); });
    expect(over.sort()).toEqual(tiles);
  });

  it('the rockfall\'s warning is a dark shadow in a red outline, and the blow drops each boulder: rock chips and dust, then no boulder', () => {
    const s = bossStage('cactusKing');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.1);
    let fill: MeshBasicMaterial | null = null;
    let frame: MeshBasicMaterial | null = null;
    s.scene.traverse((o) => {
      if (o.name === 'boss-strike-fill') fill = (o as unknown as { material: MeshBasicMaterial }).material;
      if (o.name === 'boss-strike-tile') frame = (o as unknown as { material: MeshBasicMaterial }).material;
    });
    expect(`#${fill!.color.getHexString().toUpperCase()}`).toBe('#2B1A10');
    expect(`#${frame!.color.getHexString().toUpperCase()}`).toBe('#FF3B3B');
    const debris = vi.spyOn(s.fx, 'debris');
    const ring = vi.spyOn(s.fx, 'ring');
    s.until((e) => e.type === 'bossStrike' && !e.windup);
    expect(debris.mock.calls.filter((c) => (c[1] as number[]).includes(0xb5482a))).toHaveLength(3);
    expect(ring.mock.calls.filter((c) => c[1] === 0xf2a04a)).toHaveLength(3);
    s.play(0.1);
    expect(shown(s.scene, 'boss-boulder')).toBe(0);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(0);
    // The simulation's blow: the zombies there lose health (no status).
  });

  it('the boulders go when it dies mid wind-up, when the match ends in it, and after a snapshot from before is restored; a new view mid wind-up shows them lowered', () => {
    const s = bossStage('cactusKing');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(1.2);
    const mid = s.match.snapshot();
    expect(shown(s.scene, 'boss-boulder')).toBe(3);
    // Restored from before the strike into the same view: no boulders, no warning.
    const before = bossDemoMatch('cactusKing', 1);
    for (let i = 0; i < 30 * 5; i++) before.step();
    s.view.applyEvents([], before.state);
    s.view.frame(before.state, 0.5, DT, 99);
    expect(shown(s.scene, 'boss-boulder')).toBe(0);
    expect(shown(s.scene, 'boss-strike-tile')).toBe(0);
    // A new view joined mid wind-up: warning and boulders from the state, at the height the time left asks for.
    const restored = Match.restore(mid, s.balance);
    const lateScene = new Scene();
    const late = new BattleView(lateScene, s.camera, s.lawn, s.fx, 'zombies', { balance: s.balance });
    late.applyEvents([], restored.state);
    late.frame(restored.state, 0.5, DT, 0);
    late.frame(restored.state, 0.5, DT, 0);
    expect(shown(lateScene, 'boss-boulder')).toBe(3);
    lateScene.traverse((o) => { if (o.name === 'boss-boulder') expect(o.position.y, 'lower than the top').toBeLessThan(3.2); });
    late.dispose();
    // Dies mid wind-up.
    const t = bossStage('cactusKing');
    t.until((e) => e.type === 'bossStrike' && e.windup);
    t.play(0.5);
    expect(shown(t.scene, 'boss-boulder')).toBe(3);
    const boss = t.boss();
    boss.hp = 0;
    const events = t.match.step();
    t.view.applyEvents(events.filter((e) => e.type !== 'matchEnded'), t.match.state);
    t.frames(10);
    expect(shown(t.scene, 'boss-boulder')).toBe(0);
    expect(shown(t.scene, 'boss-strike-tile')).toBe(0);
    expect(t.view.unit(boss.id)?.model.clip).toBe('die');
    // The match ends in the wind-up.
    const u = bossStage('cactusKing');
    u.until((e) => e.type === 'bossStrike' && e.windup);
    u.play(0.5);
    u.view.applyEvents([{ type: 'matchEnded', winner: 'plants' }], u.match.state);
    u.frames(60);
    expect(shown(u.scene, 'boss-boulder')).toBe(0);
    expect(shown(u.scene, 'boss-strike-fill')).toBe(0);
  });

  it('its pupils follow the nearest zombie across the lanes', () => {
    const s = bossStage('cactusKing');
    s.play(1);
    const view = s.view.unit(s.boss().id)!;
    const shift = vi.spyOn(view, 'shiftPart');
    s.play(3);
    const pupils = shift.mock.calls.filter((c) => c[0] === 'pupils');
    expect(pupils.length).toBeGreaterThan(0);
    expect(pupils.some((c) => c[3] !== 0)).toBe(true);
  });

  it('the units it calls in are plain: no wolf ears, no wraps', () => {
    const s = bossStage('cactusKing');
    s.until((e) => e.type === 'bossPattern' && e.kind === 'summon');
    s.play(0.2);
    expect(s.match.state.units.some((u) => u.key === 'kernelPult')).toBe(true);
    expect(shown(s.scene, 'boss-pup-ears')).toBe(0);
    expect(shown(s.scene, 'boss-mummy-wrap')).toBe(0);
  });

  it('falls with its crown of flowers dropping: its wilt plays and it breaks into green and pink shards across its three lanes', () => {
    const s = bossStage('cactusKing');
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
    const colors = BOSS_LOOK.cactusKing.fx.shards!.map((c) => parseInt(c.slice(1), 16));
    expect(debris.mock.calls[0]?.[1]).toEqual(colors);
    expect(Math.max(...lanes) - Math.min(...lanes)).toBeCloseTo(2, 5);
  });

  it('draws its rockfall frames without allocating', () => {
    const s = bossStage('cactusKing');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.3);
    expect(allocationsIn(() => {
      for (let i = 0; i < 20; i++) s.view.bossFx.update(DT);
    })).toEqual({});
  });

  it('dispose takes everything it added out of the scene, boulders and sand included', () => {
    const s = bossStage('cactusKing');
    s.until((e) => e.type === 'bossStrike' && e.windup);
    s.play(0.3);
    expect(shown(s.scene, 'boss-boulder')).toBe(3);
    s.view.dispose();
    expect([...s.scene.children]).toEqual(s.before);
    const p = bossStage('sandPharaoh');
    p.until((e) => e.type === 'bossPhase');
    p.play(0.2);
    p.view.dispose();
    expect([...p.scene.children]).toEqual(p.before);
  });
});

// ---- Their sounds ----------------------------------------------------------------------------------

function render(name: SfxName, pitch = 1): { length: number; peak: number; sources: number } {
  const ctx = new FakeAudioContext();
  const v = new Voice(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, makeNoise(ctx as unknown as BaseAudioContext));
  SFX[name](v, 1, pitch);
  const envelopes = ctx.params.filter((p) => p.name === 'gain' && p.events.length >= 3 && p.finalValue === 0);
  const peak = Math.max(0, ...envelopes.flatMap((p) => p.events.map((e) => e.value)));
  expect(ctx.allProblems(), name).toEqual([]);
  return { length: v.end - 1, peak, sources: ctx.sources().length };
}

describe('the Desert Canyon bosses\' sounds', () => {
  it.each(['pharaohCall', 'pharaohDefeat', 'cactusCreak', 'cactusDefeat'] as const)('%s renders, is audible, under 1.5 s, with headroom, at any pitch', (name) => {
    for (const pitch of [0.94, 1, 1.06]) {
      const r = render(name, pitch);
      expect(r.sources).toBeGreaterThanOrEqual(1);
      expect(r.length).toBeGreaterThan(0.3);
      expect(r.length).toBeLessThan(1.5);
      expect(r.peak).toBeGreaterThan(0.04);
      expect(r.peak).toBeLessThanOrEqual(0.6);
    }
  });

  it.each([['sandPharaoh', 'pharaohCall', 'pharaohDefeat', 'plants'], ['cactusKing', 'cactusCreak', 'cactusDefeat', 'zombies']] as const)(
    '%s: its call on each pattern and as its strike winds up, its sting when beaten, none of the other bosses\'',
    (key, call, defeat, player) => {
      const m = bossDemoMatch(key, 1);
      const heard: SfxName[] = [];
      const others = ['titanRoar', 'titanDefeat', 'oakCreak', 'oakDefeat', 'howlerHowl', 'melonCrack'];
      while (m.state.winner === null) {
        const events = m.step();
        const calls: SfxName[] = [];
        const audio = { play: (name: SfxName, _o?: PlayOptions) => calls.push(name) } as unknown as AudioEngine;
        playEventSounds(audio, events, player === 'plants' ? 'plants' : 'zombies', { state: m.state });
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
