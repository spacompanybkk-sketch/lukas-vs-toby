import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import type { TutorialStep } from '../adventure/types';
import { priceOf } from '../data/units';
import { MAX_TEACHED } from '../progress/save';
import type { Save } from '../progress/save';
import type { Match } from '../sim/match';
import { isStanding } from '../sim/lookup';
import { MAX_LEVEL, TICKS_PER_SECOND } from '../sim/types';
import type { CardKey, Command, Faction, SimEvent, SpellKey, Unit } from '../sim/types';

/**
 * The tutorial (plan Task 6): a level's `teaches` steps, played by pointing and doing. A boxy glove
 * points at one thing at a time (`glove`); while a step waits the simulation is held (`holding`:
 * the controller does not step, the pause menu does not show), taps on anything else are ignored
 * without a buzz (`allows`), and the step ends on the player's own action, never on a timer.
 *
 * When a step's target is not there or not usable (the card still recharging or too dear, the
 * tile taken, no unit to merge into), the hold lasts at most `MISSING_HOLD_SECONDS` and is then let
 * go, so the match can bring the target back; it holds again when the target is there.
 *
 * Time here is counted in the controller's step calls (`TICKS_PER_SECOND` a second), held or not:
 * the session calls `step()` at that rate once the battle has begun, and never while paused.
 */

/** A step waiting on a missing target holds the match at most this long, then lets it run. */
export const MISSING_HOLD_SECONDS = 6;

/** What the glove points at. */
export type GloveAim =
  /** A card in the tray, or on the belt. */
  | { kind: 'card'; card: CardKey }
  /** A tile of the lawn (for zombies, its lane). */
  | { kind: 'tile'; lane: number; col: number }
  /** One of the player's units (the one with the level-up arrow). */
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

/** What the tutorial reads from the controller. */
export interface TutorialHost {
  readonly match: Match;
  readonly playerFaction: Faction;
  /** The card picked now (tray or belt), or null. */
  selected(): CardKey | null;
  /** The hero power is picked and waits for a lane. */
  heroPicked(): boolean;
  /** The aimed spell picked, or null. */
  spellPicked(): SpellKey | null;
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

export class Tutorial {
  /** Where the glove points now; null when nothing is pointed at (between steps, waiting, all done). */
  readonly glove: ReadonlySignal<GloveVM | null>;
  /** The ids of the steps done in this battle, in order (the app remembers them in the save). */
  readonly taught: ReadonlySignal<readonly string[]>;

  private readonly gloveSig = signal<GloveVM | null>(null);
  private readonly taughtSig = signal<readonly string[]>([]);
  private readonly steps: TutorialStep[];
  private readonly host: TutorialHost;
  private index = 0;
  /** The current step's `after` condition has been met. */
  private started = false;
  /** Step calls the current target has been missing while held. */
  private missing = 0;
  /** The hold was let go for a missing target; it comes back when the target does. */
  private released = false;
  private aim: GloveAim | null = null;
  private ready = false;
  /** The player's command sent for the current step: done when it lands (or tried again when refused). */
  private sent: Command | null = null;

  constructor(steps: readonly TutorialStep[], host: TutorialHost) {
    this.host = host;
    this.glove = this.gloveSig;
    this.taught = this.taughtSig;
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
   * The match is held: a step waits with its target there (or missing for less than
   * `MISSING_HOLD_SECONDS`). Never on the match's first tick (the prepared garden comes on then),
   * nor once it is decided.
   */
  get holding(): boolean {
    const s = this.host.match.state;
    return this.current !== null && this.started && !this.released && s.tick > 0 && s.winner === null;
  }

  /** Called once per controller step call (held or not), before the match steps. */
  tick(): void {
    this.update();
    if (this.current === null || !this.started) return;
    if (this.ready) {
      this.missing = 0;
      this.released = false;
    } else if (!this.released && this.host.match.state.tick > 0) {
      this.missing += 1;
      if (this.missing >= MISSING_HOLD_SECONDS * TICKS_PER_SECOND) this.released = true;
    }
    this.publish();
  }

  /**
   * Whether the controller may take `action` now. While the match is held only the step's own
   * action (and what leads to it: picking its card) goes through; anything else is ignored
   * silently. When nothing is held, everything goes.
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
        const c = action.cmd;
        if (c.type !== 'place' && c.type !== 'belt') return false;
        return c.lane === step.lane && (this.host.playerFaction === 'zombies' || c.col === step.col);
      }
      case 'unit': {
        if (action.kind === 'select') return action.card === step.card;
        if (action.kind !== 'command') return false;
        const c = action.cmd;
        if (c.type === 'merge') return c.unit === step.card;
        return false;
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

  /** The player picked `card` (tray or belt): a `card` step for it is done. */
  selected(card: CardKey): void {
    const step = this.current;
    if (step !== null && step.show === 'card' && step.card === card && this.started) this.done();
    else this.update();
  }

  /** Something the player picked changed (a power): the glove follows at once. */
  refresh(): void {
    this.update();
  }

  /** The player's command is queued for the next step: the step's action, if it lands. */
  queued(cmd: Command): void {
    if (this.current !== null) this.sent = cmd;
  }

  /** The events of one match step: a step's action that landed ends it. */
  events(events: readonly SimEvent[]): void {
    const step = this.current;
    const sent = this.sent;
    this.sent = null;
    if (step === null) return;
    const me = this.host.playerFaction;
    let landed = false;
    for (const e of events) {
      if (e.type === 'commandRejected' && e.command === sent) return this.publish();
      if (step.until === 'placed' && sent !== null && (sent.type === 'place' || sent.type === 'belt')) {
        if (e.type === 'unitSpawned' && e.faction === me && e.lane === step.lane) landed = true;
      }
      if (step.until === 'merged' && e.type === 'unitMerged') {
        const u = this.host.match.state.units.find((x) => x.id === e.unitId);
        if (u !== undefined && u.faction === me && u.key === step.card) landed = true;
      }
      if (step.until === 'fired' && step.show === 'hero' && e.type === 'heroUsed' && e.faction === me) landed = true;
      if (step.until === 'fired' && step.show === 'spell' && e.type === 'spellCast' && e.faction === me && e.spell === this.spellKey(step.index)) landed = true;
    }
    if (landed && this.started) this.done();
    else this.publish();
  }

  private done(): void {
    const step = this.current;
    if (step === null) return;
    this.taughtSig.value = [...this.taughtSig.peek(), step.id];
    this.index += 1;
    this.started = false;
    this.missing = 0;
    this.released = false;
    this.sent = null;
    this.update();
  }

  private spellKey(index: number): SpellKey | null {
    return this.host.match.state.players[this.host.playerFaction].spells[index]?.key ?? null;
  }

  /** Works out the current step's start, its aim and whether its action can be taken now; then publishes. */
  private update(): void {
    const step = this.current;
    this.aim = null;
    this.ready = false;
    if (step === null) {
      this.publish();
      return;
    }
    const s = this.host.match.state;
    const me = s.players[this.host.playerFaction];
    if (!this.started) {
      if (step.after === 'hero') this.started = s.config.heroes[this.host.playerFaction] && me.heroTimer === 0;
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
      case 'tile':
        if (this.host.selected() !== step.card) {
          this.aim = { kind: 'card', card: step.card };
          this.ready = this.cardReady(step.card);
        } else {
          this.aim = { kind: 'tile', lane: step.lane, col: step.col };
          this.ready = this.placeReady(step.card, step.lane, step.col);
        }
        break;
      case 'unit': {
        const target = this.firstUnit(step.card);
        if (this.host.selected() !== step.card) {
          this.aim = { kind: 'card', card: step.card };
          this.ready = target !== null && this.cardReady(step.card);
        } else if (target !== null) {
          this.aim = { kind: 'unit', unitId: target.id };
          this.ready = this.host.match.check({ type: 'merge', faction: this.host.playerFaction, unit: step.card, targetId: target.id }) === null;
        }
        break;
      }
      case 'hero':
        if (!this.host.heroPicked()) {
          this.aim = { kind: 'hero' };
          this.ready = me.heroTimer === 0;
        } else {
          const t = this.enemyTile();
          this.aim = { kind: 'tile', lane: t.lane, col: t.col };
          this.ready = true;
        }
        break;
      case 'spell': {
        const key = this.spellKey(step.index);
        if (key === null) break;
        if (this.host.spellPicked() !== key) {
          this.aim = { kind: 'spell', index: step.index, key };
          this.ready = me.spells[step.index]?.timer === 0;
        } else {
          const t = this.enemyTile();
          this.aim = { kind: 'tile', lane: t.lane, col: t.col };
          this.ready = true;
        }
        break;
      }
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

  private placeReady(card: CardKey, lane: number, col: number): boolean {
    const side = this.host.playerFaction;
    const s = this.host.match.state;
    if (s.config.belt?.side === side) {
      const slot = s.belt.indexOf(card);
      return slot >= 0 && this.host.match.check({ type: 'belt', faction: side, slot, lane, col }) === null;
    }
    return this.host.match.check({ type: 'place', faction: side, unit: card, lane, col }) === null;
  }

  /** The player's first standing unit (lowest id) of type `card` below the top level, or null. */
  private firstUnit(card: CardKey): Unit | null {
    for (const u of this.host.match.state.units) {
      if (u.faction === this.host.playerFaction && u.key === card && u.level < MAX_LEVEL && isStanding(u)) return u;
    }
    return null;
  }

  /** Where to aim a power: the enemy unit nearest the player's base (its tile), or the middle lane. */
  private enemyTile(): { lane: number; col: number } {
    const side = this.host.playerFaction;
    let best: Unit | null = null;
    for (const u of this.host.match.state.units) {
      if (u.faction === side || !isStanding(u)) continue;
      if (best === null || (side === 'plants' ? u.x < best.x : u.x > best.x)) best = u;
    }
    if (best === null) return { lane: 2, col: side === 'plants' ? 5 : 3 };
    return { lane: best.lane, col: Math.max(0, Math.min(9, Math.floor(best.x))) };
  }

  /** Writes the glove signal when what it shows changed. */
  private publish(): void {
    const step = this.current;
    const aim = step === null || !this.started ? null : this.aim;
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
