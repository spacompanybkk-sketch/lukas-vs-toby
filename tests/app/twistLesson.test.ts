import { describe, expect, it } from 'vitest';
import { LEVELS, levelById } from '../../src/adventure/levels';
import { TEACHES } from '../../src/adventure/levels/teaches';
import { BattleController } from '../../src/app/BattleController';
import { TWIST_HINT_SECONDS, stepsToTeach, twistShown } from '../../src/app/tutorial';
import { NO_TWIST } from '../../src/sim/lawn';
import { seconds } from '../../src/data/balance';
import { hashState } from '../../src/sim/hash';
import { W2, lessonController, w2Save } from './world2Lessons';
import { W3, w3Controller, w3Save } from './world3Lessons';

// Step 2, Task 3: the twist lesson (`show: 'twist'`) and the four new-card glove lessons.

const run = (c: BattleController, n: number): void => { for (let i = 0; i < n; i++) c.step(); };
const tick = (c: BattleController): number => c.match.state.tick;

describe('the world-2 lessons in TEACHES (content design §3, Ruling 2)', () => {
  it('p2-1 and z2-1 show their twist and nothing else', () => {
    expect(TEACHES['p2-1']).toEqual([{ id: 'p2-1.fog', show: 'twist', until: 'tapped' }]);
    expect(TEACHES['z2-1']).toEqual([{ id: 'z2-1.ice', show: 'twist', until: 'tapped' }]);
  });

  it('the first level dealing each new card points at the card, then its tile', () => {
    const lesson = (id: string) => TEACHES[id]!.map((s) => (s.show === 'tile' ? `${s.show} ${s.card} ${s.lane},${s.col}` : s.show === 'card' ? `card ${s.card}` : s.show));
    expect(lesson('p2-4')).toEqual(['card mangoPult', 'tile mangoPult 2,2']);
    expect(lesson('p2-7')).toEqual(['card avocadoBunker', 'tile avocadoBunker 2,4']);
    expect(lesson('z2-4')).toEqual(['card hotTopic', 'tile hotTopic 0,9']);
    expect(lesson('z2-7')).toEqual(['card cowboyZombie', 'tile cowboyZombie 2,9']);
    // The unlock levels themselves teach nothing (the result's turntable shows the new unit).
    for (const id of ['p2-3', 'p2-6', 'z2-3', 'z2-6']) expect(TEACHES[id], id).toBeUndefined();
  });

  it('a lesson for a level id not in LEVELS is harmless: LEVELS carries only real levels, each with its own lesson', () => {
    for (const id of Object.keys(TEACHES)) {
      const def = levelById(id);
      if (def === null) continue;
      expect(def.teaches?.map((s) => s.id)).toEqual(TEACHES[id]!.map((s) => s.id));
    }
    expect(LEVELS.every((d) => d.teaches === null || d.teaches.every((s) => s.id.startsWith(`${d.id}.`)))).toBe(true);
  });
});

describe('p2-1: the fog pan', () => {
  it('holds the match from its first tick with no glove; the twist shows (fog); 3 s on the glove says "tap"', () => {
    const c = lessonController(W2['p2-1']!);
    const t = c.tutorial!;
    expect(t.current?.id).toBe('p2-1.fog');
    expect(t.glove.peek()).toBeNull();
    c.step(); // tick 0 runs as in every level
    expect(tick(c)).toBe(1);
    run(c, 2);
    expect(t.holding).toBe(true);
    expect(t.twist.peek()).toEqual({ step: 'p2-1.fog', kind: 'fog', holding: true });
    expect(t.glove.peek()).toBeNull();
    run(c, seconds(TWIST_HINT_SECONDS) - 5);
    expect(t.glove.peek()).toBeNull();
    run(c, 5);
    expect(t.glove.peek()).toEqual({ aim: { kind: 'tap' }, holding: true, step: 'p2-1.fog' });
    run(c, seconds(30));
    expect(tick(c)).toBe(1);
    expect(t.holding).toBe(true);
    expect(c.hud.seconds.peek()).toBe(0);
  });

  it('any tap ends it - the tap itself does nothing else; the step is remembered; the match runs on', () => {
    const taps: ((c: BattleController) => void)[] = [
      (c) => { c.click({ lane: 2, col: 1 }, null); },
      (c) => { c.click(null, null); },
      (c) => c.select('peashooter'),
      (c) => c.toggleShovel(),
      (c) => c.selectHero(true),
      (c) => c.hotkey('Escape'),
      (c) => c.tapTwist(),
    ];
    for (const tap of taps) {
      const c = lessonController(W2['p2-1']!);
      run(c, 4);
      const selected = c.hud.selected.peek();
      tap(c);
      expect(c.tutorial!.current).toBeNull();
      expect(c.tutorial!.taught.peek()).toEqual(['p2-1.fog']);
      expect(c.tutorial!.twist.peek()).toBeNull();
      expect(c.tutorial!.glove.peek()).toBeNull();
      expect(c.hud.selected.peek()).toBe(selected);
      expect(c.hud.shovel.peek()).toBe(false);
      expect(c.hud.heroSelected.peek()).toBe(false);
      expect(c.hud.denied.peek()).toBe(0);
      run(c, 30);
      expect(c.match.state.units.filter((u) => u.faction === 'plants')).toHaveLength(0);
      expect(tick(c)).toBe(31);
    }
  });

  it('a tap before the hold (the opening tick) does not end it: the pan is seen first', () => {
    const c = lessonController(W2['p2-1']!);
    c.tapTwist();
    expect(c.tutorial!.current?.id).toBe('p2-1.fog');
  });

  it('Pause works during the pan: the menu comes, and the pan (and its hint clock) waits under it', () => {
    const c = lessonController(W2['p2-1']!);
    run(c, 10);
    c.setPaused(true);
    expect(c.hud.paused.peek()).toBe(true);
    run(c, seconds(10));
    expect(c.tutorial!.glove.peek()).toBeNull(); // the hint clock did not run while paused
    c.tapTwist(); // a tap on the menu is no tap on the pan
    expect(c.tutorial!.current?.id).toBe('p2-1.fog');
    c.setPaused(false);
    expect(c.tutorial!.holding).toBe(true);
    c.tapTwist();
    expect(c.tutorial!.current).toBeNull();
  });

  it('while it holds, no tile is lit for the picked card', () => {
    const c = lessonController(W2['p2-1']!);
    run(c, 3);
    c.placeTiles();
    expect([...c.placeable].every((v) => v === 0)).toBe(true);
    c.tapTwist();
    c.placeTiles();
    expect([...c.placeable].some((v) => v === 1)).toBe(true);
  });

  it('shows once per player: a save that has it skips it; HELP (replay) shows it again', () => {
    const save = { ...w2Save('plants'), teached: ['p2-1.fog'] };
    expect(stepsToTeach(W2['p2-1']!.teaches, save)).toEqual([]);
    expect(lessonController(W2['p2-1']!, 3, save).tutorial).toBeNull();
    const again = lessonController(W2['p2-1']!, 3, save, true);
    expect(again.tutorial?.current?.id).toBe('p2-1.fog');
    run(again, 3);
    expect(again.tutorial!.twist.peek()?.kind).toBe('fog');
  });

  it('a twist step on a lawn without that twist is left out (nothing held)', () => {
    const plain = { ...W2['p2-1']!, twist: undefined };
    const c = lessonController(plain);
    expect(c.tutorial).not.toBeNull();
    expect(c.tutorial!.current).toBeNull();
    run(c, 10);
    expect(tick(c)).toBe(10);
  });

  it('the pan changes nothing in the match: held, tapped, played on - the same state as never shown', () => {
    const shown = lessonController(W2['p2-1']!, 11);
    run(shown, 1);
    run(shown, seconds(5)); // held
    shown.tapTwist();
    const plain = lessonController(W2['p2-1']!, 11, { ...w2Save('plants'), teached: ['p2-1.fog'] });
    run(plain, 1);
    run(shown, seconds(40));
    run(plain, seconds(40));
    expect(tick(shown)).toBe(tick(plain));
    expect(hashState(shown.match.state)).toBe(hashState(plain.match.state));
  });
});

describe('z2-1: the ice pan', () => {
  it('shows the ice, holds, ends on a tap', () => {
    const c = lessonController(W2['z2-1']!);
    run(c, 3);
    expect(c.tutorial!.twist.peek()).toEqual({ step: 'z2-1.ice', kind: 'ice', holding: true });
    expect(tick(c)).toBe(1);
    c.click({ lane: 2, col: 9 }, null);
    expect(c.tutorial!.current).toBeNull();
    expect(c.match.state.units.filter((u) => u.faction === 'zombies')).toHaveLength(0);
    run(c, 3);
    expect(tick(c)).toBe(4);
  });
});

describe('the new-card glove lessons (card, then tile, as p1-2)', () => {
  for (const id of ['p2-4', 'p2-7', 'z2-4', 'z2-7']) {
    it(`${id}: the card, then its tile; the new unit stands there`, () => {
      const def = W2[id]!;
      const c = lessonController(def);
      const [cardStep, tileStep] = def.teaches!;
      if (cardStep?.show !== 'card' || tileStep?.show !== 'tile') throw new Error('card then tile');
      // Waits (nothing held) until the card is paid for, then holds on it.
      for (let i = 0; i < seconds(60) && !c.tutorial!.holding; i++) {
        expect(c.tutorial!.glove.peek()?.holding ?? false).toBe(false);
        c.step();
      }
      expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'card', card: cardStep.card }, holding: true, step: cardStep.id });
      c.select(cardStep.card);
      expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'tile', lane: tileStep.lane }, step: tileStep.id });
      const aim = c.tutorial!.glove.peek()!.aim;
      if (aim.kind !== 'tile') throw new Error('tile');
      expect(c.click({ lane: aim.lane, col: aim.col }, null)).toBeNull();
      c.step();
      expect(c.match.state.units.some((u) => u.key === cardStep.card && u.lane === tileStep.lane)).toBe(true);
      expect(c.tutorial!.current).toBeNull();
      expect(c.tutorial!.taught.peek()).toEqual([cardStep.id, tileStep.id]);
    });
  }

  it('a new-card lesson whose card the player does not hold is left out', () => {
    const c = lessonController(W2['p2-4']!, 3, { ...w2Save('plants'), plants: { ...w2Save('plants').plants, unlocked: ['potatoMine', 'kernelPult'] } });
    expect(c.tutorial).not.toBeNull();
    expect(c.tutorial!.current).toBeNull();
  });
});

// Worlds step 3, Task 3: the rocks pan (plan Rulings 7-8) and the world-3 lessons.
describe('twistShown with rocks (Ruling 7)', () => {
  const rocky = { ...NO_TWIST, rocks: [12, 21] };
  it('a lawn whose only twist is rocks shows rocks, whatever the step is called', () => {
    expect(twistShown(rocky, 'p3-1.rocks')).toBe('rocks');
    expect(twistShown(rocky, 'p3-1.twist')).toBe('rocks');
  });
  it('fog and ice keep their precedence; the id picks among several; no twist at all shows nothing', () => {
    expect(twistShown({ ...rocky, fog: 5 }, 'x.twist')).toBe('fog');
    expect(twistShown({ ...rocky, ice: { lanes: [1], speed: 1.6 } }, 'x.twist')).toBe('ice');
    expect(twistShown({ ...rocky, fog: 5 }, 'x.rocks')).toBe('rocks');
    expect(twistShown({ ...rocky, fog: 5 }, 'x.fog')).toBe('fog');
    expect(twistShown(NO_TWIST, 'x.rocks')).toBeNull();
    expect(twistShown({ ...NO_TWIST, fog: 7 }, 'p2-1.fog')).toBe('fog');
    expect(twistShown({ ...NO_TWIST, ice: { lanes: [2], speed: 1.6 } }, 'z2-1.ice')).toBe('ice');
  });
});

describe('the world-3 lessons in TEACHES (content design §3)', () => {
  it('the rocks pans, and each new card points at its card, then its tile', () => {
    expect(TEACHES['p3-1']).toEqual([{ id: 'p3-1.rocks', show: 'twist', until: 'tapped' }]);
    expect(TEACHES['z3-1']).toEqual([{ id: 'z3-1.rocks', show: 'twist', until: 'tapped' }]);
    const lesson = (id: string) => TEACHES[id]!.map((s) => (s.show === 'tile' ? `${s.show} ${s.card} ${s.lane},${s.col}${s.after ? ` after ${s.after}` : ''}` : s.show === 'card' ? `card ${s.card}` : s.show));
    expect(lesson('p3-4')).toEqual(['card torchwood', 'tile torchwood 2,2']);
    expect(lesson('p3-7')).toEqual(['card cherryBomber', 'tile cherryBomber 2,4 after foe']);
    expect(lesson('z3-4')).toEqual(['card necromancer', 'tile necromancer 2,9']);
    expect(lesson('z3-7')).toEqual(['card tridentZombie', 'tile tridentZombie 1,9']);
    expect(TEACHES['p3-4']!.map((s) => s.id)).toEqual(['p3-4.torch-card', 'p3-4.torch-tile']);
    expect(TEACHES['p3-7']!.map((s) => s.id)).toEqual(['p3-7.cherry-card', 'p3-7.cherry-tile']);
    expect(TEACHES['z3-4']!.map((s) => s.id)).toEqual(['z3-4.necro-card', 'z3-4.necro-lane']);
    expect(TEACHES['z3-7']!.map((s) => s.id)).toEqual(['z3-7.trident-card', 'z3-7.trident-lane']);
    // The unlock levels teach nothing (the result's turntable shows the new unit).
    for (const id of ['p3-3', 'p3-6', 'z3-3', 'z3-6']) expect(TEACHES[id], id).toBeUndefined();
  });

  it('no glove tile is a rock (the stand-ins\' rocks, checked with match.check)', () => {
    for (const id of ['p3-4', 'p3-7', 'z3-4', 'z3-7']) {
      const def = W3[id]!;
      const c = w3Controller(def);
      const tile = def.teaches!.find((s) => s.show === 'tile');
      if (tile?.show !== 'tile') throw new Error('a tile step');
      const side = def.side;
      expect(c.match.check({ type: 'place', faction: side, unit: tile.card, lane: tile.lane, col: tile.col }), id).toBeNull();
    }
  });
});

describe.each([['p3-1', 'plants'], ['z3-1', 'zombies']] as const)('%s: the rocks pan', (id, side) => {
  const def = W3[id]!;

  it('holds the match from its first tick with no glove; the twist shows (rocks); 3 s on the glove says "tap"; Pause waits', () => {
    const c = w3Controller(def);
    const t = c.tutorial!;
    expect(t.current?.id).toBe(`${id}.rocks`);
    c.step();
    run(c, 2);
    expect(t.holding).toBe(true);
    expect(t.twist.peek()).toEqual({ step: `${id}.rocks`, kind: 'rocks', holding: true });
    expect(t.glove.peek()).toBeNull();
    run(c, seconds(TWIST_HINT_SECONDS) - 5);
    expect(t.glove.peek()).toBeNull();
    run(c, 5);
    expect(t.glove.peek()).toEqual({ aim: { kind: 'tap' }, holding: true, step: `${id}.rocks` });
    run(c, seconds(30));
    expect(tick(c)).toBe(1);
    c.setPaused(true);
    run(c, seconds(5));
    c.tapTwist(); // a tap on the menu is no tap on the pan
    expect(t.current?.id).toBe(`${id}.rocks`);
    c.setPaused(false);
    expect(t.holding).toBe(true);
  });

  it('any tap ends it - the tap itself does nothing else; the match runs on', () => {
    const taps: ((c: BattleController) => void)[] = [
      (c) => { c.click({ lane: 0, col: 3 }, null); }, // on a rock
      (c) => { c.click({ lane: 2, col: side === 'plants' ? 1 : 9 }, null); },
      (c) => { c.click(null, null); },
      (c) => c.select(side === 'plants' ? 'peashooter' : 'brainEater'),
      (c) => c.tapTwist(),
    ];
    for (const tap of taps) {
      const c = w3Controller(def);
      run(c, 4);
      tap(c);
      expect(c.tutorial!.current).toBeNull();
      expect(c.tutorial!.taught.peek()).toEqual([`${id}.rocks`]);
      expect(c.tutorial!.twist.peek()).toBeNull();
      expect(c.hud.denied.peek()).toBe(0);
      run(c, 30);
      expect(c.match.state.units.filter((u) => u.faction === side)).toHaveLength(0);
      expect(tick(c)).toBe(31);
    }
  });

  it('afterwards a tap on a rock buzzes, shakes and places nothing', () => {
    const c = w3Controller(def);
    run(c, 4);
    c.tapTwist();
    const card = side === 'plants' ? 'peashooter' : 'brainEater';
    c.select(card);
    if (side === 'zombies') return; // zombies choose a lane, not a tile: nothing of theirs sits on a rock
    expect(c.click({ lane: 0, col: 3 }, null)).toBe('rock');
    expect(c.hud.denied.peek()).toBe(1);
    run(c, 3);
    expect(c.match.state.units.filter((u) => u.faction === 'plants')).toHaveLength(0);
  });

  it('shows once per player; HELP (replay) shows it again', () => {
    const save = { ...w3Save(side), teached: [`${id}.rocks`] };
    expect(w3Controller(def, 3, save).tutorial).toBeNull();
    const again = w3Controller(def, 3, save, true);
    run(again, 3);
    expect(again.tutorial!.twist.peek()?.kind).toBe('rocks');
  });
});

describe('the world-3 glove lessons (card, then tile, as p1-2)', () => {
  for (const id of ['p3-4', 'z3-4', 'z3-7']) {
    it(`${id}: the card, then its tile; the new unit stands there`, () => {
      const def = W3[id]!;
      const c = w3Controller(def);
      const [cardStep, tileStep] = def.teaches!;
      if (cardStep?.show !== 'card' || tileStep?.show !== 'tile') throw new Error('card then tile');
      for (let i = 0; i < seconds(60) && !c.tutorial!.holding; i++) c.step();
      expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'card', card: cardStep.card }, holding: true, step: cardStep.id });
      c.select(cardStep.card);
      const aim = c.tutorial!.glove.peek()!.aim;
      if (aim.kind !== 'tile') throw new Error('tile');
      expect(aim.lane).toBe(tileStep.lane);
      expect(c.click({ lane: aim.lane, col: aim.col }, null)).toBeNull();
      c.step();
      expect(c.match.state.units.some((u) => u.key === cardStep.card && u.lane === tileStep.lane)).toBe(true);
      expect(c.tutorial!.taught.peek()).toEqual([cardStep.id, tileStep.id]);
    });
  }
});
