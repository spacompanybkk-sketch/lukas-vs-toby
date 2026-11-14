import { describe, expect, it } from 'vitest';
import { levelById } from '../../src/adventure/levels';
import { BattleController } from '../../src/app/BattleController';
import { levelOptions, prepareLevel } from '../../src/app/levelSession';
import { MISSING_HOLD_SECONDS, stepsToTeach } from '../../src/app/tutorial';
import { seconds } from '../../src/data/balance';
import { newSave } from '../../src/progress/save';
import { SPELLS } from '../../src/sim/spells';
import { COLS, LANES } from '../../src/sim/types';
import type { Faction, SpellKey } from '../../src/sim/types';

// Fix round 1 (review item 1): no tutorial state may hold the match more than
// MISSING_HOLD_SECONDS without a valid, accepted action available. A scripted child who taps
// exactly where the glove points always gets through; a child who never taps is held only while
// the glove's action is one the match would accept.

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
const LIMIT = seconds(MISSING_HOLD_SECONDS);

function taught(id: string, seed: number): BattleController {
  const def = levelById(id)!;
  const save = newSave(def.side === 'plants' ? 'p01' : 'p02', 'Kid', 'peashooter', 0);
  return new BattleController(levelOptions({ ...prepareLevel(def, save, seed), teach: stepsToTeach(def.teaches, save) }));
}

/** The glove's action, checked by the test itself against the match (not by the tutorial). */
function gloveActionValid(c: BattleController): boolean {
  const g = c.tutorial!.glove.peek();
  if (g === null) return false;
  const s = c.match.state;
  const side = c.playerFaction;
  const me = s.players[side];
  const a = g.aim;
  switch (a.kind) {
    case 'card':
      // Usable: a place of it somewhere is accepted (or it waits on the belt).
      if (s.config.belt?.side === side) return s.belt.includes(a.card);
      for (let lane = 0; lane < LANES; lane++) for (let col = 0; col < COLS; col++) {
        if (c.match.check({ type: 'place', faction: side, unit: a.card, lane, col }) === null) return true;
      }
      return false;
    case 'tile': {
      if (c.hud.heroSelected.peek()) return c.match.check({ type: 'hero', faction: side, lane: a.lane }) === null;
      const spell = c.hud.spellSelected.peek();
      if (spell !== null) return c.match.check({ type: 'spell', faction: side, spell, lane: a.lane, col: a.col }) === null;
      const card = c.hud.selected.peek();
      return card !== null && c.match.check({ type: 'place', faction: side, unit: card as never, lane: a.lane, col: a.col }) === null;
    }
    case 'unit': {
      const u = s.units.find((x) => x.id === a.unitId);
      const card = c.hud.selected.peek();
      return u !== undefined && card === u.key && c.match.check({ type: 'merge', faction: side, unit: u.key as never, targetId: u.id }) === null;
    }
    case 'hero':
      return [0, 1, 2, 3, 4].some((lane) => c.match.check({ type: 'hero', faction: side, lane }) === null);
    case 'spell': {
      const slot = me.spells[a.index];
      if (slot === undefined || slot.timer > 0) return false;
      for (let lane = 0; lane < LANES; lane++) for (let col = 0; col < COLS; col++) {
        if (c.match.check({ type: 'spell', faction: side, spell: a.key, lane, col }) === null) return true;
      }
      return false;
    }
  }
}

/** Taps where the glove points (as a child following it would). */
function tapGlove(c: BattleController): void {
  const g = c.tutorial!.glove.peek();
  if (g === null) return;
  const a = g.aim;
  switch (a.kind) {
    case 'card':
      if (c.level?.belt === true) c.selectBelt(c.match.state.belt.indexOf(a.card));
      else c.select(a.card);
      return;
    case 'tile':
      c.click({ lane: a.lane, col: a.col }, null);
      return;
    case 'unit': {
      const u = c.match.state.units.find((x) => x.id === a.unitId)!;
      c.click({ lane: u.lane, col: Math.floor(u.x) }, u.id);
      return;
    }
    case 'hero':
      c.selectHero(true);
      return;
    case 'spell':
      c.selectSpell(a.key);
      return;
  }
}

/**
 * The child who follows the glove (a tap every third of a second), his base kept standing so the
 * hero's and spells' lessons come. Each armed step must end within 3 s of taps; the whole tutorial
 * must end. Never held without a valid action for more than the limit.
 */
function follow(c: BattleController, maxSeconds: number): void {
  const side: Faction = c.playerFaction;
  let streak = 0;
  let armedFor = 0;
  for (let i = 0; i < seconds(maxSeconds) && c.tutorial!.current !== null; i++) {
    const s = c.match.state;
    s.baseHp[side] = s.baseMaxHp[side];
    if (i % 10 === 0) tapGlove(c);
    c.step();
    const t = c.tutorial!;
    if (t.holding && !gloveActionValid(c)) streak += 1;
    else streak = 0;
    expect(streak, `held with no valid action at tick ${s.tick}`).toBeLessThanOrEqual(LIMIT);
    armedFor = t.glove.peek() !== null ? armedFor + 1 : 0;
    expect(armedFor, `step ${t.current?.id} armed and not done in 3 s of taps`).toBeLessThan(seconds(3));
    if (s.winner !== null) break;
  }
  expect(c.tutorial!.current, `the tutorial ended (match over: ${c.match.state.winner})`).toBeNull();
  // Every lesson of the level was done by the child's taps (none dropped, none skipped).
  expect(c.tutorial!.taught.peek()).toEqual(c.play!.teach!.map((t) => t.id));
}

/** The child who never taps: whenever he is held, the glove's action is one the match accepts (or for at most the limit). */
function idle(c: BattleController, maxSeconds: number): void {
  let streak = 0;
  for (let i = 0; i < seconds(maxSeconds); i++) {
    c.step();
    const t = c.tutorial;
    if (t === null || t.current === null) return;
    if (t.holding && !gloveActionValid(c)) streak += 1;
    else streak = 0;
    expect(streak).toBeLessThanOrEqual(LIMIT);
    if (c.match.state.winner !== null) return;
  }
}

describe('the tutorial never freezes the match without an action to take', () => {
  for (const id of ['p1-1', 'p1-2', 'p1-3', 'z1-1', 'z1-2', 'z1-3', 'p1-4', 'z1-4']) {
    it(`${id}: following the glove ends every step, on 50 seeds`, () => {
      for (const seed of SEEDS) follow(taught(id, seed), 150);
    }, 120_000);
    it(`${id}: a child who never taps is held only with a valid action, on 50 seeds`, () => {
      for (const seed of SEEDS) idle(taught(id, seed), 20);
    }, 120_000);
  }

  for (const side of ['plants', 'zombies'] as const) {
    for (const key of SPELLS[side]) {
      it(`${side === 'plants' ? 'p1-4' : 'z1-4'} with ${key} dealt first: the spell lesson ends, on 10 seeds`, () => {
        for (const seed of SEEDS.slice(0, 10)) {
          const c = taught(side === 'plants' ? 'p1-4' : 'z1-4', seed);
          const slot = c.match.state.players[side].spells[0]!;
          slot.key = key as SpellKey;
          follow(c, 150);
        }
      }, 120_000);
    }
  }
});
