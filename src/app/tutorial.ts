import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import type { TutorialStep } from '../adventure/types';
import { priceOf } from '../data/units';
import { MAX_TEACHED } from '../progress/save';
import type { Save } from '../progress/save';
import type { Match } from '../sim/match';
import { isStanding } from '../sim/lookup';
import { spellArea } from '../sim/spells';
import { COLS, LANES, MAX_LEVEL, PLANT_COLS, TICKS_PER_SECOND } from '../sim/types';
import type { CardKey, Command, Faction, SimEvent, SpellKey, Unit } from '../sim/types';

/**
 * The tutorial (plan Task 6): a level's `teaches` steps, played by pointing and doing. A boxy glove
 * points at one thing at a time (`glove`); while a step is armed the simulation is held (`holding`:
 * the controller does not step, the pause menu does not show), taps on anything else are ignored
 * without a buzz (`allows`), and the step ends on the player's own action, never on a timer.
 *
 * The one rule: the match is held only while the step's action is there to be taken — a target
 * on screen whose command the match would accept now (`match.check`). A step whose target is not
 * usable yet (the card still recharging or too dear, no unit to merge into, the hero or a spell
 * charging, no tile a spell may go on) is not armed: no glove, no hold, the match runs, and the
 * step arms the moment it is usable. If an armed step's action stops being possible (it cannot
 * while the match stands still, but the rule does not rely on that), the hold lasts at most
 * `MISSING_HOLD_SECONDS`, then the step lets go (putting down a power picked for it) and waits to
 * arm again.
 *
 * Time here is counted in the controller's step calls (`TICKS_PER_SECOND` a second), held or not:
 * the session calls `step()` at that rate once the battle has begun, and never while paused.
 */

/** An armed step whose action stopped being possible holds the match at most this long. */
export const MISSING_HOLD_SECONDS = 6;

/** What the glove points at. */
export type GloveAim =
  /** A card in the tray, or on the belt. */
  | { kind: 'card'; card: CardKey }
  /** A tile of the lawn (for zombies, its lane). */
  | { kind: 'tile'; lane: number; col: number }
  /** One of the player's units (the one with the level-up arrow): the glove points from its side. */
  | { kind: 'unit'; unitId: number }
  | { kind: 'hero' }
  /** A spell button, by its place in the deal. */
  | { kind: 'spell'; index: number; key: SpellKey };

/** The glove as the HUD shows it: where it points, whether the match is held (the screen dims), and which step. */
export interface GloveVM { aim: GloveAim; holding: boolean; step: string }

/** A player action the controller is about to take, for `allows`. */
export type TutorialAction =
  | { kind: 'select'; card: CardKey }
  | { kind: 'command'; cmd: Command }
  | { kind: 'hero' }
  | { kind: 'spell'; key: SpellKey }
  /** The shovel, Escape, putting a card down: never part of a step. */
  | { kind: 'other' };

/** What the tutorial reads from (and asks of) the controller. */
export interface TutorialHost {
  readonly match: Match;
  readonly playerFaction: Faction;
  /** The card picked now (tray or belt), or null. */
  selected(): CardKey | null;
  /** The hero power is picked and waits for a lane. */
  heroPicked(): boolean;
  /** The aimed spell picked, or null. */
  spellPicked(): SpellKey | null;
  /** Puts down a picked power (a step that let go must not leave one waiting for a tap). */
  putDownPower(): void;
}

/** The steps of `teaches` this player has not done yet (all of them on a replay, or for a guest). */
export function stepsToTeach(teaches: readonly TutorialStep[] | null, save: Save | null, replay = false): TutorialStep[] {
  if (teaches === null) return [];
  if (replay || save === null) return [...teaches];
  const done = new Set(save.teached);
  return teaches.filter((s) => !done.has(s.id));
}

/** `save` with step `id` remembered (once; the oldest go when there are more than `MAX_TEACHED`). */
export function rememberTaught(save: Save, id: string): Save {
  if (save.teached.includes(id)) return save;
  const teached = [...save.teached, id];
  return { ...save, teached: teached.slice(Math.max(0, teached.length - MAX_TEACHED)) };
}

const sameAim = (a: GloveAim, b: GloveAim): boolean => {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'card': return a.card === (b as typeof a).card;
    case 'tile': return a.lane === (b as typeof a).lane && a.col === (b as typeof a).col;
    case 'unit': return a.unitId === (b as typeof a).unitId;
    case 'spell': return a.index === (b as typeof a).index && a.key === (b as typeof a).key;
    case 'hero': return true;
  }
};

type Tile = { lane: number; col: number };

/** Spells aimed at the enemy, at the player's own units. The rest: Rock Wall, Grave Rise, and the un-aimed ones. */
const AT_ENEMIES: ReadonlySet<SpellKey> = new Set<SpellKey>(['thunderbolt', 'meteor', 'vines', 'fog']);
const AT_FRIENDS: ReadonlySet<SpellKey> = new Set<SpellKey>(['healingRain', 'frenzy']);

export class Tutorial {
  /** Where the glove points now; null when nothing is pointed at (between steps, waiting, all done). */
  readonly glove: ReadonlySignal<GloveVM | null>;
  /** The ids of the steps done in this battle, in order (the app remembers them in the save). */
  readonly taught: ReadonlySignal<readonly string[]>;
  /** Goes to 1 the first time a Sunflower pays after a Sunflower step (the energy counter pulses once). */
  readonly sunPulse: ReadonlySignal<number>;

  private readonly gloveSig = signal<GloveVM | null>(null);
  private readonly taughtSig = signal<readonly string[]>([]);
  private readonly sunSig = signal(0);
  private readonly steps: TutorialStep[];
  private readonly host: TutorialHost;
  private index = 0;
  /** The current step's `after` condition has been met. */
  private started = false;
  /** The step is armed: its action was possible; the glove shows and the match is held. */
  private armed = false;
  /** Step calls an armed step has had no possible action (it lets go at `MISSING_HOLD_SECONDS`). */
  private grace = 0;
  private aim: GloveAim | null = null;
  /** The step's action is possible now: a target the match would accept. */
  private ready = false;
  /** The tile a `tile` step wants now (the marked one, or the nearest free one in its lane). */
  private tile: Tile | null = null;
  /** The player's command sent for the current step, and whether it is the step's own action. */
  private sent: Command | null = null;
  private sentIsStep = false;
  /** A Sunflower step is done: the next Sunflower payout pulses the counter (once). */
  private sunWatch = false;

  constructor(steps: readonly TutorialStep[], host: TutorialHost) {
    this.host = host;
    this.glove = this.gloveSig;
    this.taught = this.taughtSig;
    this.sunPulse = this.sunSig;
    // Steps the match cannot play (a card not dealt, a spell not dealt, no hero) are left out.
    const s = host.match.state;
    const me = host.playerFaction;
    const hand = s.config.cards[me];
    const belt = s.config.belt?.side === me ? s.config.belt.cards : [];
    const has = (c: CardKey): boolean => hand.includes(c) || belt.includes(c);
    this.steps = steps.filter((st) => {
      switch (st.show) {
        case 'card': case 'tile': case 'unit': return has(st.card);
        case 'hero': return s.config.heroes[me];
        case 'spell': return st.index < s.players[me].spells.length;
      }
    });
    this.update();
  }

  /** The step waiting now, or null when the tutorial is over. */
  get current(): TutorialStep | null {
    return this.steps[this.index] ?? null;
  }

  /** True when the tutorial starts with a card to pick (the controller then picks none for the player). */
  get startsWithCard(): boolean {
    const first = this.steps[0];
    return first !== undefined && first.after === undefined && (first.show === 'card' || first.show === 'tile' || first.show === 'unit');
  }

  /**
   * The match is held: a step is armed (its action is possible, or stopped being so less than
   * `MISSING_HOLD_SECONDS` ago). Never on the match's first tick (the prepared garden comes on
   * then), nor once it is decided.
   */
  get holding(): boolean {
    const s = this.host.match.state;
    return this.current !== null && this.started && this.armed && s.tick > 0 && s.winner === null;
  }

  /** The step's action is possible now (for tests: a held step always has one, or lets go within 6 s). */
  get actionPossible(): boolean {
    return this.ready;
  }

  /** Called once per controller step call (held or not), before the match steps. */
  tick(): void {
    this.update();
    if (this.current === null || !this.started) return;
    if (this.ready) {
      this.grace = 0;
    } else if (this.armed && this.host.match.state.tick > 0) {
      this.grace += 1;
      if (this.grace >= MISSING_HOLD_SECONDS * TICKS_PER_SECOND) this.letGo();
    }
    this.publish();
  }

  /**
   * Whether the controller may take `action` now. While the match is held only the step's own
   * action (and what leads to it: picking its card or power) goes through; anything else is
   * ignored silently. When nothing is held, everything goes.
   */
  allows(action: TutorialAction): boolean {
    const step = this.current;
    if (step === null || !this.holding) return true;
    switch (step.show) {
      case 'card':
        return action.kind === 'select' && action.card === step.card;
      case 'tile': {
        if (action.kind === 'select') return action.card === step.card;
        if (action.kind !== 'command' || this.host.selected() !== step.card) return false;
        return this.isStepTile(action.cmd);
      }
      case 'unit': {
        if (action.kind === 'select') return action.card === step.card;
        return action.kind === 'command' && action.cmd.type === 'merge' && action.cmd.unit === step.card;
      }
      case 'hero':
        if (action.kind === 'hero') return true;
        return action.kind === 'command' && action.cmd.type === 'hero';
      case 'spell': {
        const key = this.spellKey(step.index);
        if (action.kind === 'spell') return action.key === key;
        return action.kind === 'command' && action.cmd.type === 'spell' && action.cmd.spell === key;
      }
    }
  }

  /** The player picked `card` (tray or belt): a `card` step for it is done (when armed or usable). */
  selected(card: CardKey): void {
    const step = this.current;
    if (step !== null && step.show === 'card' && step.card === card && this.started && this.ready) this.done();
    else this.update();
  }

  /** Something the player picked changed (a power): the glove follows at once. */
  refresh(): void {
    this.update();
  }

  /** The player's command is queued for the next step: the step's action, if it lands. */
  queued(cmd: Command): void {
    if (this.current === null) return;
    this.sent = cmd;
    const step = this.current;
    this.sentIsStep = step.show !== 'tile' || this.isStepTile(cmd);
  }

  /** The events of one match step: a step's action that landed ends it. */
  events(events: readonly SimEvent[]): void {
    const step = this.current;
    const sent = this.sent;
    const isStep = this.sentIsStep;
    this.sent = null;
    this.sentIsStep = false;
    const me = this.host.playerFaction;
    if (this.sunWatch && this.sunSig.peek() === 0) {
      for (const e of events) if (e.type === 'energyGained' && e.faction === me && e.source === 'sunflower') this.sunSig.value = 1;
    }
    if (step === null) return;
    let landed = false;
    for (const e of events) {
      if (e.type === 'commandRejected' && e.command === sent) return this.publish();
      // Placed: only the step's own tile (a plant elsewhere leaves the step, and the glove re-points).
      if (step.until === 'placed' && isStep && sent !== null && (sent.type === 'place' || sent.type === 'belt')) {
        if (e.type === 'unitSpawned' && e.faction === me && e.lane === sent.lane) landed = true;
      }
      if (step.until === 'merged' && e.type === 'unitMerged') {
        const u = this.host.match.state.units.find((x) => x.id === e.unitId);
        if (u !== undefined && u.faction === me && u.key === step.card) landed = true;
      }
      if (step.until === 'fired' && step.show === 'hero' && e.type === 'heroUsed' && e.faction === me) landed = true;
      if (step.until === 'fired' && step.show === 'spell' && e.type === 'spellCast' && e.faction === me && e.spell === this.spellKey(step.index)) landed = true;
    }
    if (landed && this.started) this.done();
    else this.update();
  }

  private done(): void {
    const step = this.current;
    if (step === null) return;
    if ((step.show === 'card' || step.show === 'tile') && step.card === 'sunflower' && step.until === 'placed') this.sunWatch = true;
    this.taughtSig.value = [...this.taughtSig.peek(), step.id];
    this.index += 1;
    this.started = false;
    this.armed = false;
    this.grace = 0;
    this.sent = null;
    this.sentIsStep = false;
    this.update();
  }

  /** An armed step whose action stopped being possible lets go: no hold, no glove, and no power left waiting. */
  private letGo(): void {
    this.armed = false;
    this.grace = 0;
    const step = this.current;
    if (step?.show === 'hero' && this.host.heroPicked()) this.host.putDownPower();
    if (step?.show === 'spell' && this.host.spellPicked() !== null) this.host.putDownPower();
  }

  /** A place (or belt) command onto the tile the `tile` step wants (zombies: its lane). */
  private isStepTile(cmd: Command): boolean {
    if (cmd.type !== 'place' && cmd.type !== 'belt') return false;
    const t = this.tile;
    if (t === null) return false;
    return cmd.lane === t.lane && (this.host.playerFaction === 'zombies' || cmd.col === t.col);
  }

  private spellKey(index: number): SpellKey | null {
    return this.host.match.state.players[this.host.playerFaction].spells[index]?.key ?? null;
  }

  private check(cmd: Command): boolean {
    return this.host.match.check(cmd) === null;
  }

  /** Works out the current step's start, its aim and whether its action is possible now; arms it; publishes. */
  private update(): void {
    const step = this.current;
    this.aim = null;
    this.ready = false;
    this.tile = null;
    if (step === null) {
      this.publish();
      return;
    }
    const s = this.host.match.state;
    const side = this.host.playerFaction;
    const me = s.players[side];
    if (!this.started) {
      if (step.after === 'hero') this.started = s.config.heroes[side] && me.heroTimer === 0;
      else if (step.after === 'spell') this.started = me.spells[step.show === 'spell' ? step.index : 0]?.timer === 0;
      else this.started = true;
      if (!this.started) {
        this.publish();
        return;
      }
    }
    switch (step.show) {
      case 'card':
        this.aim = { kind: 'card', card: step.card };
        this.ready = this.cardReady(step.card);
        break;
      case 'tile': {
        this.tile = this.placeTile(step.card, { lane: step.lane, col: step.col });
        if (this.host.selected() !== step.card) {
          this.aim = { kind: 'card', card: step.card };
          this.ready = this.tile !== null && this.cardReady(step.card);
        } else if (this.tile !== null) {
          this.aim = { kind: 'tile', lane: this.tile.lane, col: this.tile.col };
          this.ready = true; // placeTile checked the command
        }
        break;
      }
      case 'unit': {
        const target = this.firstUnit(step.card);
        if (target === null) break;
        const ok = this.check({ type: 'merge', faction: side, unit: step.card, targetId: target.id });
        this.aim = this.host.selected() !== step.card ? { kind: 'card', card: step.card } : { kind: 'unit', unitId: target.id };
        this.ready = ok;
        break;
      }
      case 'hero': {
        const lane = this.heroTile();
        if (lane === null) break;
        if (!this.host.heroPicked()) {
          this.aim = { kind: 'hero' };
        } else {
          this.aim = { kind: 'tile', lane: lane.lane, col: lane.col };
        }
        this.ready = true;
        break;
      }
      case 'spell': {
        const key = this.spellKey(step.index);
        if (key === null) break;
        const aimed = this.host.match.balance.spells[key].size > 0;
        if (!aimed) {
          // Cast at once from its button.
          this.aim = { kind: 'spell', index: step.index, key };
          this.ready = this.check({ type: 'spell', faction: side, spell: key, lane: 0, col: 0 });
          break;
        }
        const target = this.spellTarget(key);
        if (target === null) break;
        this.aim = this.host.spellPicked() !== key ? { kind: 'spell', index: step.index, key } : { kind: 'tile', lane: target.lane, col: target.col };
        this.ready = true; // spellTarget checked the command
        break;
      }
    }
    if (this.ready && !this.armed) {
      this.armed = true;
      this.grace = 0;
    }
    this.publish();
  }

  /** The card can be picked and paid for now (on the belt: it is there). */
  private cardReady(card: CardKey): boolean {
    const s = this.host.match.state;
    const side = this.host.playerFaction;
    if (s.config.belt?.side === side) return s.belt.includes(card);
    const me = s.players[side];
    return (me.recharge[card] ?? 0) === 0 && (s.config.noEnergy || me.energy >= priceOf(card));
  }

  /** The command placing `card` on `t` (from the belt when the belt is the player's). */
  private placeCommand(card: CardKey, t: Tile): Command | null {
    const side = this.host.playerFaction;
    const s = this.host.match.state;
    if (s.config.belt?.side === side) {
      const slot = s.belt.indexOf(card);
      return slot < 0 ? null : { type: 'belt', faction: side, slot, lane: t.lane, col: t.col };
    }
    return { type: 'place', faction: side, unit: card, lane: t.lane, col: t.col };
  }

  /**
   * The tile a `tile` step wants: the marked one if `card` may go there now, else the nearest tile
   * of the same lane it may go on (the marked one is taken). Null when none is possible now.
   */
  private placeTile(card: CardKey, marked: Tile): Tile | null {
    const ok = (t: Tile): boolean => {
      const cmd = this.placeCommand(card, t);
      return cmd !== null && this.check(cmd);
    };
    if (ok(marked)) return marked;
    if (this.host.playerFaction === 'zombies') return null; // any tile of the lane is the same tile
    for (let d = 1; d < PLANT_COLS; d++) {
      for (const col of [marked.col - d, marked.col + d]) {
        if (col >= 0 && col < PLANT_COLS && ok({ lane: marked.lane, col })) return { lane: marked.lane, col };
      }
    }
    return null;
  }

  /** The player's first standing unit (lowest id) of type `card` below the top level, or null. */
  private firstUnit(card: CardKey): Unit | null {
    for (const u of this.host.match.state.units) {
      if (u.faction === this.host.playerFaction && u.key === card && u.level < MAX_LEVEL && isStanding(u)) return u;
    }
    return null;
  }

  /** Standing units of `faction`, but no rock (a Rock Wall is no one to help or hit). */
  private unitsOf(faction: Faction): Unit[] {
    return this.host.match.state.units.filter((u) => u.faction === faction && isStanding(u) && u.key !== 'rock');
  }

  /** The enemy unit nearest the player's base, or null. */
  private nearestEnemy(): Unit | null {
    const side = this.host.playerFaction;
    let best: Unit | null = null;
    for (const u of this.unitsOf(side === 'plants' ? 'zombies' : 'plants')) {
      if (best === null || (side === 'plants' ? u.x < best.x : u.x > best.x)) best = u;
    }
    return best;
  }

  /** Where the hero's lane is pointed: the nearest enemy's lane, or the middle; null when the hero cannot fire. */
  private heroTile(): Tile | null {
    const side = this.host.playerFaction;
    const e = this.nearestEnemy();
    const lanes = e === null ? [2, 1, 3, 0, 4] : [e.lane, 0, 1, 2, 3, 4];
    for (const lane of lanes) {
      if (this.check({ type: 'hero', faction: side, lane })) {
        const col = e !== null && e.lane === lane ? Math.max(0, Math.min(COLS - 1, Math.floor(e.x))) : side === 'plants' ? 5 : 4;
        return { lane, col };
      }
    }
    return null;
  }

  /**
   * Where an aimed spell is pointed, a tile the match accepts the cast on now, or null:
   * - Thunderbolt, Meteor, Vines, Fog: where its area covers the most enemies (none: the middle
   *   of the enemy's half);
   * - Healing Rain, Frenzy: where it covers the most of the player's own units (none: his own half);
   * - Rock Wall: the empty tile just ahead of his front plant in the lane of the nearest enemy
   *   (then the other lanes);
   * - Grave Rise: at or past its first column, in the lane of the nearest enemy plant.
   * Any other tile the match accepts, as a last resort.
   */
  private spellTarget(key: SpellKey): Tile | null {
    const side = this.host.playerFaction;
    const stats = this.host.match.balance.spells[key];
    const minCol = stats.minCol ?? 0;
    const lastCol = key === 'rockWall' ? PLANT_COLS - 1 : COLS - 1;
    const clampCol = (c: number): number => Math.max(minCol, Math.min(lastCol, c));
    const legal = (t: Tile): boolean => this.check({ type: 'spell', faction: side, spell: key, lane: t.lane, col: t.col });
    const candidates: Tile[] = [];
    const enemy: Faction = side === 'plants' ? 'zombies' : 'plants';
    if (AT_ENEMIES.has(key) || AT_FRIENDS.has(key)) {
      const targets = this.unitsOf(AT_ENEMIES.has(key) ? enemy : side);
      let best: Tile | null = null;
      let bestScore = 0;
      for (const u of targets) {
        const t = { lane: u.lane, col: clampCol(Math.floor(u.x)) };
        const area = spellArea(side, stats.size, t.lane, t.col);
        let score = 0;
        for (const v of targets) if (area.some((a) => a.lane === v.lane && a.col === Math.floor(v.x))) score += 1;
        if (score > bestScore && legal(t)) {
          best = t;
          bestScore = score;
        }
      }
      if (best !== null) return best;
      const enemyHalf = side === 'plants' ? 6 : 3;
      candidates.push({ lane: 2, col: clampCol(AT_ENEMIES.has(key) ? enemyHalf : COLS - 1 - enemyHalf) });
    } else if (key === 'rockWall') {
      const e = this.nearestEnemy();
      const lanes = e === null ? [2, 1, 3, 0, 4] : [e.lane, 0, 1, 2, 3, 4];
      for (const lane of lanes) {
        let front = -1;
        for (const u of this.unitsOf(side)) if (u.lane === lane) front = Math.max(front, Math.floor(u.x));
        candidates.push({ lane, col: clampCol(front + 1) });
      }
    } else if (key === 'graveRise') {
      const plants = this.unitsOf(enemy);
      const near = plants.reduce<Unit | null>((b, u) => (b === null || u.x > b.x ? u : b), null);
      const lanes = near === null ? [2, 1, 3, 0, 4] : [near.lane, 0, 1, 2, 3, 4];
      for (const lane of lanes) candidates.push({ lane, col: clampCol(near !== null && near.lane === lane ? Math.floor(near.x) + 1 : minCol) });
    }
    for (const t of candidates) if (legal(t)) return t;
    for (let lane = 0; lane < LANES; lane++) for (let col = minCol; col <= lastCol; col++) if (legal({ lane, col })) return { lane, col };
    return null;
  }

  /** Writes the glove signal when what it shows changed: only while the step is armed. */
  private publish(): void {
    const step = this.current;
    const aim = step === null || !this.started || !this.armed ? null : this.aim;
    const old = this.gloveSig.peek();
    if (aim === null) {
      if (old !== null) this.gloveSig.value = null;
      return;
    }
    const holding = this.holding;
    if (old !== null && old.step === step!.id && old.holding === holding && sameAim(old.aim, aim)) return;
    this.gloveSig.value = { aim, holding, step: step!.id };
  }
}
