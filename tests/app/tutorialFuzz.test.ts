import { describe, expect, it } from 'vitest';
import { levelById } from '../../src/adventure/levels';
import { BattleController } from '../../src/app/BattleController';
import { levelOptions, prepareLevel } from '../../src/app/levelSession';
import { MISSING_HOLD_SECONDS, rememberTaught, stepsToTeach } from '../../src/app/tutorial';
import type { LevelDef } from '../../src/adventure/types';
import type { Save } from '../../src/progress/save';
import { W2, lessonController, w2Save } from './world2Lessons';
import { W3, w3Controller, w3Save } from './world3Lessons';
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
      const slot = c.levelHud.beltSlot.peek();
      if (slot !== null) return c.match.check({ type: 'belt', faction: side, slot, lane: a.lane, col: a.col }) === null;
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
    case 'tap':
      // The twist pan's hint: any tap ends a twist step that holds.
      return c.tutorial!.twistHolding;
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
    case 'tap':
      c.tapTwist();
      return;
  }
}

/**
 * The child who follows the glove (a tap every third of a second), his base kept standing so the
 * hero's and spells' lessons come. Each armed step must end within 3 s of taps; the whole tutorial
 * must end. Never held without a valid action for more than the limit.
 */
function follow(c: BattleController, maxSeconds: number, foeMayWait = false): void {
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
  // A foe wait whose foe never came (killed, or the match ended first) holds nothing: the lesson just never shows.
  if (foeMayWait && c.tutorial!.current?.after === 'foe' && !c.tutorial!.holding) return;
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
  for (const id of ['p1-1', 'p1-2', 'p1-3', 'z1-1', 'z1-2', 'z1-3', 'p1-4', 'z1-4', 'p1-5', 'z1-5']) {
    it(`${id}: following the glove ends every step, on 50 seeds`, () => {
      for (const seed of SEEDS) follow(taught(id, seed), 150);
    }, 120_000);
    it(`${id}: a child who never taps is held only with a valid action, on 50 seeds`, () => {
      for (const seed of SEEDS) idle(taught(id, seed), 20);
    }, 120_000);
  }

  // Step 2: the world-2 lessons (the twist pans and the new-card gloves), on stand-in levels.
  for (const id of Object.keys(W2)) {
    it(`${id}: following the glove ends every step, on 50 seeds`, () => {
      for (const seed of SEEDS) follow(lessonController(W2[id]!, seed), 150);
    }, 120_000);
    it(`${id}: a child who never taps is held only with a valid action, on 50 seeds`, () => {
      for (const seed of SEEDS) idle(lessonController(W2[id]!, seed), 20);
    }, 120_000);
  }

  // Worlds step 3: the rocks pans, the new-card gloves and the Cherry Bomber's foe wait, on stand-in levels.
  for (const id of Object.keys(W3)) {
    it(`${id}: following the glove ends every step, on 50 seeds`, () => {
      for (const seed of SEEDS) follow(w3Controller(W3[id]!, seed), 150);
    }, 120_000);
    it(`${id}: a child who never taps is held only with a valid action, on 50 seeds`, () => {
      for (const seed of SEEDS) idle(w3Controller(W3[id]!, seed), 60);
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

/** A small seeded random number generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A child doing anything at all: taps on random tiles (and off the lawn), cards, the hero, spells,
 * the shovel, Escape, drags (a card, then a tile), Pause and Resume, Restart and a reload of the page
 * mid-step (both a new battle with the steps done so far remembered, as the app does). Whatever he
 * does, the match is never held without an action that would let it go: a twist pan holds only
 * while any tap ends it (and the HUD shows it), any other step only while its glove's action is
 * valid (or for at most the limit). At the end he follows the glove, and the lessons end.
 */
function chaos(def: LevelDef, seed: number, saveOf: (side: Faction) => Save = w2Save, lesson = lessonController): void {
  const rnd = random(seed * 7919 + 13);
  const pickOf = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(rnd() * xs.length)];
  let save: Save = saveOf(def.side);
  let c = lesson(def, seed, save);
  const remember = (): void => { save = (c.tutorial?.taught.peek() ?? []).reduce(rememberTaught, save); };
  const side = def.side;
  let streak = 0;
  for (let i = 0; i < seconds(45); i++) {
    const s = c.match.state;
    s.baseHp[side] = s.baseMaxHp[side];
    if (rnd() < 0.15) {
      const r = rnd();
      const hand = s.config.cards[side];
      const tile = rnd() < 0.1 ? null : { lane: Math.floor(rnd() * LANES), col: Math.floor(rnd() * COLS) };
      if (r < 0.25) c.click(tile, null);
      else if (r < 0.4) { const card = pickOf(hand); if (card !== undefined) c.select(card); }
      else if (r < 0.5) { const card = pickOf(hand); if (card !== undefined) { c.select(card); c.click(tile, null); } } // a drag
      else if (r < 0.55) c.selectHero(true);
      else if (r < 0.6) { const sp = pickOf(s.players[side].spells); if (sp !== undefined) c.selectSpell(sp.key); }
      else if (r < 0.65) c.toggleShovel();
      else if (r < 0.7) c.hotkey('Escape');
      else if (r < 0.78) c.tapTwist();
      else if (r < 0.86) c.setPaused(!c.hud.paused.peek());
      else if (r < 0.93) { remember(); c = lesson(def, seed + i, save); } // Restart
      else { remember(); c = lesson(def, (seed * 31 + i) >>> 0, save); } // a reload mid-step
    }
    c.step();
    const t = c.tutorial;
    if (t === null || t.current === null) continue;
    if (t.twistHolding) {
      // Held by a pan: the HUD's catcher is up (any tap ends it) and Pause is no tap.
      expect(t.twist.peek()?.holding, `pan held but not shown at tick ${c.match.state.tick}`).toBe(true);
      streak = 0;
    } else if (t.holding && !gloveActionValid(c)) {
      streak += 1;
    } else {
      streak = 0;
    }
    expect(streak, `${def.id}: held with no valid action at tick ${c.match.state.tick}`).toBeLessThanOrEqual(LIMIT);
    if (c.match.state.winner !== null) { remember(); c = lesson(def, seed + i, save); }
  }
  // Then he follows the glove (unpaused): every lesson left ends, and nothing holds the match.
  c.setPaused(false);
  if (c.tutorial !== null) follow(c, 150, true);
  // (An `after: 'foe'` step whose foe is gone just waits, holding nothing.)
  const foeWait = c.tutorial?.current?.after === 'foe';
  if (!foeWait) expect(c.tutorial?.current ?? null, `${def.id}: a lesson left after following the glove`).toBeNull();
  expect(c.tutorial?.holding ?? false).toBe(false);
  expect(c.tutorial?.twist.peek() ?? null).toBeNull();
  expect(c.tutorial?.glove.peek() ?? null).toBeNull();
  if (c.match.state.winner === null) {
    const at = c.match.state.tick;
    c.step();
    expect(c.match.state.tick, `${def.id}: the match moves on`).toBe(at + 1);
  }
}

describe('a child doing anything during the world-2 lessons never leaves the match held with no way on', () => {
  for (const id of Object.keys(W2)) {
    it(`${id}: random taps, drags, pauses, restarts and reloads, on 40 seeds`, () => {
      for (const seed of SEEDS.slice(0, 40)) chaos(W2[id]!, seed);
    }, 120_000);
  }
  it('a pan with the hint glove up: any of the child\'s taps ends it, Pause and Resume do not', () => {
    const c = lessonController(W2['z2-1']!, 5);
    for (let i = 0; i < seconds(4); i++) c.step();
    expect(c.tutorial!.glove.peek()?.aim).toEqual({ kind: 'tap' });
    c.setPaused(true);
    c.setPaused(false);
    expect(c.tutorial!.twistHolding).toBe(true);
    c.hotkey('1');
    expect(c.tutorial!.current).toBeNull();
    expect(c.tutorial!.glove.peek()).toBeNull();
  });
});

describe('a child doing anything during the world-3 lessons never leaves the match held with no way on', () => {
  for (const id of Object.keys(W3)) {
    it(`${id}: random taps, drags, pauses, restarts and reloads, on 40 seeds`, () => {
      for (const seed of SEEDS.slice(0, 40)) chaos(W3[id]!, seed, w3Save, w3Controller);
    }, 120_000);
  }
  it('the rocks pan\'s hint glove: any tap ends it, Pause and Resume do not', () => {
    for (const id of ['p3-1', 'z3-1']) {
      const c = w3Controller(W3[id]!, 5);
      for (let i = 0; i < seconds(4); i++) c.step();
      expect(c.tutorial!.glove.peek()?.aim).toEqual({ kind: 'tap' });
      c.setPaused(true);
      c.setPaused(false);
      expect(c.tutorial!.twistHolding).toBe(true);
      c.hotkey('1');
      expect(c.tutorial!.current).toBeNull();
    }
  });
  it('the Cherry Bomber lesson: the clump killed before it arms, then the match ending, never hold the match', () => {
    // The clump killed early (a mine, as Review Focus 2 has it): the step waits, holds nothing.
    const c = w3Controller(W3['p3-7']!, 7);
    c.step();
    c.select('cherryBomber');
    for (let i = 0; i < seconds(39); i++) c.step();
    c.match.state.units = c.match.state.units.filter((u) => u.faction !== 'zombies');
    for (let i = 0; i < seconds(30); i++) {
      c.match.state.units = c.match.state.units.filter((u) => u.faction !== 'zombies' || u.x > 10.5);
      c.step();
      expect(c.tutorial!.holding).toBe(false);
    }
    expect(c.tutorial!.current?.id).toBe('p3-7.cherry-tile');
    expect(c.tutorial!.glove.peek()).toBeNull();
    // The match ending first: the step never shows.
    c.match.state.winner = 'plants';
    c.step();
    expect(c.tutorial!.glove.peek()).toBeNull();
    expect(c.tutorial!.holding).toBe(false);
  });
});
