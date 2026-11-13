import { describe, expect, it } from 'vitest';
import { levelById } from '../../src/adventure/levels';
import { TEACHES } from '../../src/adventure/levels/teaches';
import { BattleController } from '../../src/app/BattleController';
import { levelOptions, prepareLevel } from '../../src/app/levelSession';
import { MISSING_HOLD_SECONDS, rememberTaught, stepsToTeach } from '../../src/app/tutorial';
import { seconds } from '../../src/data/balance';
import { MAX_TEACHED, newSave } from '../../src/progress/save';
import { spawnUnit } from '../../src/sim/spawn';
import type { Save } from '../../src/progress/save';
import type { Faction } from '../../src/sim/types';

// Task 6: the tutorial — the glove's steps, the hold, the ignored taps, remembering.

function saveFor(side: Faction): Save {
  return newSave(side === 'plants' ? 'p01' : 'p02', 'Kid', 'peashooter', 0);
}

/** A level with its whole tutorial (a fresh save). */
function taught(id: string, seed = 3, save?: Save): BattleController {
  const def = levelById(id)!;
  const me = save ?? saveFor(def.side);
  return new BattleController(levelOptions({ ...prepareLevel(def, me, seed), teach: stepsToTeach(def.teaches, me) }));
}

const run = (c: BattleController, n: number): void => { for (let i = 0; i < n; i++) c.step(); };
const tick = (c: BattleController): number => c.match.state.tick;
const plantAt = (c: BattleController, lane: number, col: number) =>
  c.match.state.units.find((u) => u.faction === 'plants' && u.lane === lane && Math.floor(u.x) === col);

describe('the lessons', () => {
  it('levels 1–3 of each side teach from the start; level 2 the hero, level 4 the spells', () => {
    for (const id of ['p1-1', 'p1-2', 'p1-3', 'z1-1', 'z1-2', 'z1-3']) {
      expect(levelById(id)!.teaches?.[0]).toMatchObject({ show: 'card' });
      expect(levelById(id)!.teaches?.[0]?.after).toBeUndefined();
    }
    expect(levelById('p1-2')!.teaches?.at(-1)).toMatchObject({ show: 'hero', after: 'hero' });
    expect(levelById('z1-2')!.teaches?.at(-1)).toMatchObject({ show: 'hero', after: 'hero' });
    expect(levelById('p1-4')!.teaches).toEqual([expect.objectContaining({ show: 'spell', index: 0, after: 'spell' })]);
    expect(levelById('z1-4')!.teaches).toEqual([expect.objectContaining({ show: 'spell', index: 0, after: 'spell' })]);
    expect(levelById('p1-3')!.teaches?.at(-1)).toMatchObject({ show: 'unit', until: 'merged' });
    expect(levelById('z1-3')!.teaches?.at(-1)).toMatchObject({ show: 'unit', until: 'merged' });
  });

  it('every step names a card its level deals, a tile on the lawn, an id unique across levels', () => {
    const ids = new Set<string>();
    for (const [id, steps] of Object.entries(TEACHES)) {
      const def = levelById(id)!;
      expect(def, id).not.toBeNull();
      for (const s of steps) {
        expect(ids.has(s.id), s.id).toBe(false);
        ids.add(s.id);
        expect(s.id.length).toBeLessThanOrEqual(64);
        if (s.show === 'card' || s.show === 'tile' || s.show === 'unit') expect(def.cards).toContain(s.card);
        if (s.show === 'tile') {
          expect(s.lane).toBeGreaterThanOrEqual(0);
          expect(s.lane).toBeLessThan(5);
          expect(s.col).toBeLessThan(def.side === 'plants' ? 8 : 10);
        }
      }
    }
    expect(ids.size).toBeLessThan(MAX_TEACHED);
  });

  it('a step done once is not shown again; a replay or a guest sees them all', () => {
    const def = levelById('p1-1')!;
    const save = { ...saveFor('plants'), teached: ['p1-1.card'] };
    expect(stepsToTeach(def.teaches, save).map((s) => s.id)).toEqual(['p1-1.tile']);
    expect(stepsToTeach(def.teaches, save, true).map((s) => s.id)).toEqual(['p1-1.card', 'p1-1.tile']);
    expect(stepsToTeach(def.teaches, null).map((s) => s.id)).toEqual(['p1-1.card', 'p1-1.tile']);
    expect(stepsToTeach(null, save)).toEqual([]);
  });

  it('rememberTaught adds a step once and keeps the newest MAX_TEACHED', () => {
    const save = saveFor('plants');
    const once = rememberTaught(save, 'a');
    expect(once.teached).toEqual(['a']);
    expect(rememberTaught(once, 'a')).toBe(once);
    const full = { ...save, teached: Array.from({ length: MAX_TEACHED }, (_, i) => `s${i}`) };
    const more = rememberTaught(full, 'new');
    expect(more.teached).toHaveLength(MAX_TEACHED);
    expect(more.teached[0]).toBe('s1');
    expect(more.teached.at(-1)).toBe('new');
  });

  it('a level with every step done has no tutorial: it plays as before', () => {
    const save = { ...saveFor('plants'), teached: ['p1-1.card', 'p1-1.tile'] };
    const c = taught('p1-1', 3, save);
    expect(c.tutorial).toBeNull();
    expect(c.hud.selected.peek()).toBe('peashooter');
    run(c, 10);
    expect(tick(c)).toBe(10);
  });
});

describe('p1-1 by the glove', () => {
  it('the glove points at the card; nothing is picked; the match holds after its first tick', () => {
    const c = taught('p1-1');
    expect(c.hud.selected.peek()).toBeNull();
    expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'card', card: 'peashooter' }, step: 'p1-1.card' });
    c.step(); // tick 0: the level's opening step runs (a prepared garden would come on)
    expect(tick(c)).toBe(1);
    run(c, seconds(30));
    expect(tick(c)).toBe(1);
    expect(c.hud.seconds.peek()).toBe(0);
    expect(c.tutorial!.glove.peek()?.holding).toBe(true);
  });

  it('wrong taps do nothing and make no buzz', () => {
    const c = taught('p1-1');
    run(c, 5);
    expect(c.click({ lane: 2, col: 1 }, null)).toBe('ignored');
    c.toggleShovel();
    expect(c.hud.shovel.peek()).toBe(false);
    c.selectHero(true);
    c.hotkey('Escape');
    c.hotkey('h');
    run(c, 5);
    expect(c.hud.denied.peek()).toBe(0);
    expect(c.match.state.units).toHaveLength(0);
    expect(tick(c)).toBe(1);
    expect(c.tutorial!.current?.id).toBe('p1-1.card');
  });

  it('the card, then the tile: the plant grows, the steps are done, the match goes on', () => {
    const c = taught('p1-1');
    run(c, 3);
    c.select('peashooter');
    expect(c.tutorial!.taught.peek()).toEqual(['p1-1.card']);
    expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'tile', lane: 2, col: 1 }, holding: true });
    expect(c.click({ lane: 2, col: 4 }, null)).toBe('ignored'); // not the marked tile
    expect(c.click({ lane: 0, col: 1 }, null)).toBe('ignored');
    expect(c.hud.denied.peek()).toBe(0);
    run(c, 10);
    expect(tick(c)).toBe(1);
    expect(c.click({ lane: 2, col: 1 }, null)).toBeNull();
    c.step(); // the tick that carries the tap
    expect(plantAt(c, 2, 1)?.key).toBe('peashooter');
    expect(c.tutorial!.taught.peek()).toEqual(['p1-1.card', 'p1-1.tile']);
    expect(c.tutorial!.glove.peek()).toBeNull();
    run(c, 30);
    expect(tick(c)).toBe(32);
  });

  it('a card not usable yet (recharging, too dear): no glove, no hold - the match runs; armed the moment it is usable', () => {
    const c = taught('p1-3');
    run(c, 2);
    c.select('peashooter');
    c.click({ lane: 2, col: 1 }, null);
    c.step();
    // 90 energy left and the card recharging: the merge card is not usable.
    expect(c.tutorial!.current?.id).toBe('p1-3.merge-card');
    expect(c.tutorial!.glove.peek()).toBeNull();
    expect(c.tutorial!.holding).toBe(false);
    const at = tick(c);
    run(c, 3);
    expect(tick(c)).toBe(at + 3);
    while (!c.tutorial!.holding) {
      expect(c.tutorial!.glove.peek()).toBeNull();
      c.step();
      expect(tick(c)).toBeLessThan(at + seconds(30));
    }
    expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'card', card: 'peashooter' }, holding: true });
    const held = tick(c);
    run(c, 20);
    expect(tick(c)).toBe(held);
  });

  it('an armed step whose action stops being possible lets go after MISSING_HOLD_SECONDS, then arms again', () => {
    const c = taught('p1-1');
    c.step();
    expect(c.tutorial!.holding).toBe(true);
    const energy = c.match.state.players.plants.energy;
    c.match.state.players.plants.energy = 0; // the card is too dear now (a test's hand: nothing in play does this while held)
    const at = tick(c);
    run(c, seconds(MISSING_HOLD_SECONDS) - 1);
    expect(tick(c)).toBe(at);
    run(c, 2);
    expect(c.tutorial!.holding).toBe(false);
    expect(c.tutorial!.glove.peek()).toBeNull();
    run(c, 3);
    expect(tick(c)).toBeGreaterThan(at);
    c.match.state.players.plants.energy = energy;
    c.step();
    expect(c.tutorial!.holding).toBe(true);
  });

  it('the tile step wants the marked tile: a plant elsewhere does not end it; a taken marked tile re-points in its lane', () => {
    const c = taught('p1-1');
    c.step();
    c.select('peashooter');
    // Not held for a moment (a test's hand): the child plants elsewhere.
    c.match.state.players.plants.energy = 0;
    run(c, seconds(MISSING_HOLD_SECONDS) + 1);
    c.match.state.players.plants.energy = 500;
    expect(c.tutorial!.holding).toBe(false);
    expect(c.click({ lane: 4, col: 3 }, null)).toBeNull();
    c.step();
    expect(plantAt(c, 4, 3)?.key).toBe('peashooter');
    expect(c.tutorial!.current?.id).toBe('p1-1.tile');
    // The marked tile (2, 1) taken: the glove points at the nearest free tile of lane 2.
    while ((c.match.state.players.plants.recharge.peashooter ?? 0) > 0) c.step();
    c.match.state.players.plants.energy = 500;
    spawnUnit(c.match.state, c.match.balance, 'walnutBomb', 2, 1.5);
    c.step();
    expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'tile', lane: 2, col: 0 }, holding: true });
    expect(c.click({ lane: 2, col: 1 }, null)).toBe('ignored');
    expect(c.click({ lane: 2, col: 0 }, null)).toBeNull();
    c.step();
    expect(c.tutorial!.current).toBeNull();
  });

  it('merging: the card, then the unit with the level-up arrow; done on the merge', () => {
    const c = taught('p1-3');
    run(c, 2);
    c.select('peashooter');
    c.click({ lane: 2, col: 1 }, null);
    c.step();
    run(c, seconds(25));
    expect(c.tutorial!.current?.id).toBe('p1-3.merge-card');
    c.select('peashooter');
    const pea = plantAt(c, 2, 1)!;
    expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'unit', unitId: pea.id }, holding: true });
    expect(c.mergeCue()).toBe('peashooter');
    expect(c.click({ lane: 2, col: 3 }, null)).toBe('ignored'); // a new plant elsewhere is not the step
    expect(c.click({ lane: 2, col: 1 }, pea.id)).toBeNull();
    c.step();
    expect(pea.level).toBe(2);
    expect(c.tutorial!.current).toBeNull();
    expect(c.tutorial!.taught.peek()).toEqual(['p1-3.card', 'p1-3.tile', 'p1-3.merge-card', 'p1-3.merge']);
  });
});

describe('p1-2: the Sunflower pays', () => {
  it('the first Sunflower payout after its step pulses the energy counter once (sunPulse 0 -> 1)', () => {
    const c = taught('p1-2');
    c.step();
    c.select('sunflower');
    c.click({ lane: 1, col: 0 }, null);
    c.step();
    expect(c.tutorial!.sunPulse.peek()).toBe(0);
    c.select('peashooter');
    c.click({ lane: 1, col: 1 }, null);
    c.step();
    let paidAt = -1;
    for (let i = 0; i < seconds(40) && paidAt < 0; i++) {
      const ev = c.step();
      if (ev.some((e) => e.type === 'energyGained' && e.source === 'sunflower' && e.faction === 'plants')) paidAt = i;
    }
    expect(paidAt).toBeGreaterThanOrEqual(0);
    expect(c.tutorial!.sunPulse.peek()).toBe(1);
  });
});

describe('z1-1 by the glove', () => {
  it('the Brain Eater down the marked lane (any tile of it)', () => {
    const c = taught('z1-1');
    c.step();
    expect(c.match.state.units.filter((u) => u.faction === 'plants')).toHaveLength(2); // the garden came on at tick 0
    c.select('brainEater');
    expect(c.tutorial!.glove.peek()?.aim).toEqual({ kind: 'tile', lane: 2, col: 9 });
    expect(c.click({ lane: 1, col: 9 }, null)).toBe('ignored');
    expect(c.click({ lane: 2, col: 6 }, null)).toBeNull();
    c.step();
    expect(c.match.state.units.find((u) => u.faction === 'zombies')).toMatchObject({ key: 'brainEater', lane: 2 });
    expect(c.tutorial!.current).toBeNull();
    expect(c.hud.denied.peek()).toBe(0);
  });
});

describe('powers', () => {
  it('p1-2: the hero step waits (nothing held) until the hero is ready, then the button, then a lane', () => {
    const c = taught('p1-2');
    c.step();
    c.select('sunflower');
    c.click({ lane: 1, col: 0 }, null);
    c.step();
    run(c, seconds(1));
    c.select('peashooter');
    c.click({ lane: 1, col: 1 }, null);
    c.step();
    expect(c.tutorial!.current?.id).toBe('p1-2.hero');
    expect(c.tutorial!.glove.peek()).toBeNull();
    const at = tick(c);
    run(c, seconds(20));
    expect(tick(c)).toBe(at + seconds(20)); // not held while the hero charges
    while (!c.hud.hero.peek().ready) c.step();
    c.step();
    expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'hero' }, holding: true });
    const held = tick(c);
    run(c, 10);
    expect(tick(c)).toBe(held);
    c.selectHero(true);
    const aim = c.tutorial!.glove.peek()!.aim;
    expect(aim.kind).toBe('tile');
    if (aim.kind !== 'tile') return;
    expect(c.click({ lane: aim.lane, col: aim.col }, null)).toBeNull();
    const events = c.step();
    expect(events.some((e) => e.type === 'heroUsed')).toBe(true);
    expect(c.tutorial!.current).toBeNull();
  });

  it('p1-4: the first spell, once it is ready', () => {
    const c = taught('p1-4');
    expect(c.tutorial!.current?.id).toBe('p1-4.spell');
    while (c.hud.spells.peek()[0]?.ready !== true) c.step();
    c.step();
    const key = c.hud.spells.peek()[0]!.key;
    expect(c.tutorial!.glove.peek()).toMatchObject({ aim: { kind: 'spell', index: 0, key }, holding: true });
    const other = c.hud.spells.peek()[1]?.key;
    if (other !== undefined) {
      c.selectSpell(other);
      expect(c.hud.spellSelected.peek()).toBeNull();
    }
    c.selectSpell(key);
    const aim = c.tutorial!.glove.peek()?.aim;
    if (aim?.kind === 'tile') expect(c.click({ lane: aim.lane, col: aim.col }, null)).toBeNull();
    const events = c.step();
    expect(events.some((e) => e.type === 'spellCast')).toBe(true);
    expect(c.tutorial!.current).toBeNull();
    expect(c.hud.denied.peek()).toBe(0);
  });
});
