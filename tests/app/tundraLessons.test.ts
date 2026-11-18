import { describe, expect, it } from 'vitest';
import { levelById, levelsFor } from '../../src/adventure/levels';
import { TEACHES } from '../../src/adventure/levels/teaches';
import { lawnOf } from '../../src/adventure/campaign';
import type { LevelDef } from '../../src/adventure/types';
import { modelsFor } from '../../src/app/prewarm';
import { twistShown } from '../../src/app/tutorial';
import { BALANCE, seconds } from '../../src/data/balance';
import { BOSS_LOOK } from '../../src/data/bossLooks';
import { factionOf } from '../../src/data/units';
import { BOSS_MODELS } from '../../src/render/models/registry';
import { TwistShow } from '../../src/render/world/TwistTiles';
import { twistKinds } from '../../src/ui/screens/mapModel';
import { W2, lessonController } from './world2Lessons';

// The Frozen Tundra's lessons against its levels. A lesson is triggered by its level's id in
// `TEACHES` and by the lawn the level asks for (the ice pan plays only on a lawn with icy lanes, as
// the fog pan does on a lawn with fog); nothing else decides it. The real levels (`z2-*`, the
// content plan's Task 7) come from the level files: while there are none, each check below runs on
// the stand-in of the content design (`world2Lessons.ts`) and says so; once `LEVELS` holds the level
// it runs on the real one. So this file turns from a description into a guard the day they land.

/** The real level of that id if `LEVELS` has it, else its stand-in; and which of the two it is. */
function level(id: string): { def: LevelDef; real: boolean } {
  const real = levelById(id);
  if (real !== null) return { def: real, real: true };
  const standIn = W2[id];
  if (standIn === undefined) throw new Error(`no stand-in for ${id}`);
  return { def: standIn, real: false };
}

const TUNDRA = levelsFor('zombies', 2);

describe('the Tundra\'s levels and their lessons', () => {
  it('either the Tundra has no levels yet (its lessons wait, unused) or it has all eight, each on ice, the Frost Melon last', () => {
    if (TUNDRA.length === 0) {
      for (const id of ['z2-1', 'z2-4', 'z2-7']) expect(levelById(id), id).toBeNull();
      return;
    }
    expect(TUNDRA.map((d) => d.id)).toEqual(['z2-1', 'z2-2', 'z2-3', 'z2-4', 'z2-5', 'z2-6', 'z2-7', 'z2-8']);
    for (const def of TUNDRA) {
      // Every one of them ices a lane (the world's twist), so its card shows the ice picture.
      expect(lawnOf(def.twist).ice?.lanes.length ?? 0, def.id).toBeGreaterThan(0);
      expect(twistKinds(def), def.id).toContain('ice');
      // And each carries exactly the lesson written for its id (none for the others).
      expect(def.teaches?.map((s) => s.id) ?? null, def.id).toEqual(TEACHES[def.id]?.map((s) => s.id) ?? null);
    }
    const last = TUNDRA[7]!;
    expect(last.kind).toBe('boss');
    expect(last.boss?.key).toBe('frostMelon');
  });

  it('z2-1: its lawn has ice, so its one step shows the ice pan, held from the first tick until any tap', () => {
    const { def } = level('z2-1');
    expect(def.teaches).toEqual([{ id: 'z2-1.ice', show: 'twist', until: 'tapped' }]);
    const lawn = lawnOf(def.twist);
    expect(lawn.ice?.lanes.length ?? 0).toBeGreaterThan(0);
    expect(twistShown(lawn, 'z2-1.ice')).toBe('ice');
    const c = lessonController(def);
    for (let i = 0; i < 3; i++) c.step();
    expect(c.tutorial!.twist.peek()).toEqual({ step: 'z2-1.ice', kind: 'ice', holding: true });
    expect(c.match.state.tick).toBe(1);
    expect(c.match.state.config.lawn.ice?.lanes).toEqual(lawn.ice?.lanes);
    // Nobody taps for a minute: still held, nothing lost, the hint glove up.
    for (let i = 0; i < seconds(60); i++) c.step();
    expect(c.match.state.tick).toBe(1);
    expect(c.tutorial!.glove.peek()?.aim).toEqual({ kind: 'tap' });
    c.tapTwist();
    expect(c.tutorial!.current).toBeNull();
    expect(c.tutorial!.taught.peek()).toEqual(['z2-1.ice']);
    for (let i = 0; i < 10; i++) c.step();
    expect(c.match.state.tick).toBe(11);
  });

  it('z2-1\'s pan can be drawn for its lawn: a ghost slides one of its icy lanes, and one walks a plain lane if it has one', () => {
    const { def } = level('z2-1');
    const lawn = lawnOf(def.twist);
    const show = new TwistShow('ice', lawn, { puff() {} });
    expect(lawn.ice!.lanes).toContain(show.slider.lane);
    if (lawn.ice!.lanes.length < 5) expect(lawn.ice!.lanes).not.toContain(show.walker!.lane);
    show.dispose();
  });

  it('the ice pan belongs to z2-1 alone: a lawn without ice leaves the step out, and no other Tundra level holds for a pan', () => {
    const { def } = level('z2-1');
    const plain = lessonController({ ...def, twist: undefined });
    for (let i = 0; i < 5; i++) plain.step();
    expect(plain.tutorial?.twist.peek() ?? null).toBeNull();
    expect(plain.match.state.tick).toBe(5);
    for (const other of TUNDRA) if (other.id !== 'z2-1') expect(other.teaches?.some((s) => s.show === 'twist') ?? false, other.id).toBe(false);
  });

  for (const [id, card, lane] of [['z2-4', 'hotTopic', 0], ['z2-7', 'cowboyZombie', 2]] as const) {
    it(`${id}: it deals the ${card}, and the glove's lane (${lane}) takes it: the card, then the lane, and the new zombie walks there`, () => {
      const { def } = level(id);
      expect(def.cards).toContain(card);
      expect(def.teaches?.map((s) => s.show)).toEqual(['card', 'tile']);
      const c = lessonController(def);
      // A level with energy waits (nothing held) until the card is paid for; then it holds on the card.
      c.match.state.players.zombies.energy = Math.max(c.match.state.players.zombies.energy, 500);
      for (let i = 0; i < seconds(60) && !c.tutorial!.holding; i++) c.step();
      expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'card', card }, holding: true });
      c.select(card);
      expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'tile', lane } });
      const aim = c.tutorial!.glove.peek()!.aim;
      if (aim.kind !== 'tile') throw new Error('tile');
      expect(c.click({ lane: aim.lane, col: aim.col }, null)).toBeNull(); // not refused
      c.step();
      expect(c.match.state.units.some((u) => u.key === card && u.lane === lane)).toBe(true);
      expect(c.tutorial!.current).toBeNull();
    });
  }

  it('the unlock levels (z2-3 the Hot Topic, z2-6 the Cowboy Zombie) teach nothing: the result shows the new card', () => {
    for (const id of ['z2-3', 'z2-6']) expect(TEACHES[id], id).toBeUndefined();
    if (TUNDRA.length === 0) return;
    expect(levelById('z2-3')?.unlocks).toBe('hotTopic');
    expect(levelById('z2-6')?.unlocks).toBe('cowboyZombie');
  });

  it('the Tundra\'s boss is drawn: the Frost Melon fights for the plants with a model and a row of its own, built for its level only', () => {
    expect(factionOf('frostMelon')).toBe('plants');
    expect(BOSS_MODELS.frostMelon.key).toBe('frostMelon');
    expect(BOSS_LOOK.frostMelon.call).toBe('melonCrack');
    expect(BALANCE.bosses.frostMelon.phases).toHaveLength(2);
    const boss = levelById('z2-8');
    if (boss === null) return;
    const c = lessonController(boss);
    expect(c.match.state.config.boss).toMatchObject({ key: 'frostMelon', faction: 'plants' });
    // It stands on a plain lane (the ice is for the lanes the zombies choose between).
    expect(c.match.state.config.lawn.ice?.lanes ?? []).not.toContain(c.match.state.config.boss!.lane);
    const models = modelsFor(c.match.state);
    expect(models).toContain('frostMelon');
    for (const other of ['brainTitan', 'elderOak', 'moonHowler']) expect(models).not.toContain(other);
  });
});
