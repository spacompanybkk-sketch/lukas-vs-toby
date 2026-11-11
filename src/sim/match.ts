import { BALANCE, seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { PHASE1_CARDS, UNIT_INFO } from '../data/units';
import { resolveDeaths, tickAttacks, tickProjectiles } from './combat';
import { tickEconomy } from './economy';
import { tickEndgame } from './endgame';
import { restoreState, hashState, snapshotState } from './hash';
import { isStanding, levelScale, statsFor } from './lookup';
import { tickMovement } from './movement';
import { LANES, MAX_LEVEL, PLANT_COLS, ZOMBIE_SPAWN_X } from './types';
import type {
  Command, CommandRejection, Faction, MatchConfig, SimEvent, SimState, Unit, UnitKey,
} from './types';

type PlaceCommand = Extract<Command, { type: 'place' }>;
type MergeCommand = Extract<Command, { type: 'merge' }>;
type RemoveCommand = Extract<Command, { type: 'remove' }>;

/** A fresh match setup: both sides alike, the Phase 1 cards, sudden death on. */
export function defaultConfig(seed: number, balance: Balance = BALANCE): MatchConfig {
  return {
    seed,
    startEnergy: { plants: balance.startEnergy, zombies: balance.startEnergy },
    baseHp: { plants: balance.baseHp, zombies: balance.baseHp },
    cards: { plants: [...PHASE1_CARDS.plants], zombies: [...PHASE1_CARDS.zombies] },
    incomeMultiplier: { plants: 1, zombies: 1 },
    suddenDeath: true,
  };
}

function cloneConfig(c: MatchConfig): MatchConfig {
  return {
    seed: c.seed,
    startEnergy: { ...c.startEnergy },
    baseHp: { ...c.baseHp },
    cards: { plants: [...c.cards.plants], zombies: [...c.cards.zombies] },
    incomeMultiplier: { ...c.incomeMultiplier },
    suddenDeath: c.suddenDeath,
  };
}

/**
 * Creates a level-1 unit and adds it to the state. It checks no placement rule and charges
 * nobody: `Match.place` does both of those first, and tests use this to set a scene.
 */
export function spawnUnit(
  s: SimState, b: Balance, key: UnitKey, lane: number, x: number, events?: SimEvent[],
): Unit {
  const stats = statsFor(b, key);
  const info = UNIT_INFO[key];
  const unit: Unit = {
    id: s.nextId, key, faction: info.faction, lane, x, level: 1,
    hp: stats.hp, maxHp: stats.hp, spent: info.price, armor: stats.armor,
    meleeTimer: stats.melee ? seconds(stats.melee.interval) : 0,
    shotTimer: stats.shot ? seconds(stats.shot.interval) : 0,
    abilityTimer: stats.sun ? seconds(stats.sun.interval) : 0, // a shield is ready from the start
    blocked: false,
  };
  s.nextId += 1;
  s.units.push(unit);
  events?.push({ type: 'unitSpawned', unitId: unit.id, key, faction: info.faction, lane, x });
  return unit;
}

/** One match. All game rules run in `step`; everything else only reads `state`. */
export class Match {
  readonly state: SimState;
  readonly balance: Balance;

  constructor(config: MatchConfig, balance: Balance = BALANCE) {
    const own = cloneConfig(config); // the match never shares objects with the caller's config
    this.balance = balance;
    this.state = {
      tick: 0, rng: own.seed >>> 0, nextId: 1,
      units: [], projectiles: [],
      players: {
        plants: { energy: own.startEnergy.plants, carry: 0, recharge: {} },
        zombies: { energy: own.startEnergy.zombies, carry: 0, recharge: {} },
      },
      baseHp: { ...own.baseHp }, baseMaxHp: { ...own.baseHp },
      suddenDeath: false, winner: null,
      config: own,
    };
  }

  /** Rebuilds a match from `snapshot()` output; it shares nothing with the match it came from. */
  static restore(snapshot: string, balance?: Balance): Match {
    const state = restoreState(snapshot);
    const match = new Match(state.config, balance);
    Object.assign(match.state, state);
    return match;
  }

  /**
   * Why a command would be refused right now, or null if it would be carried out. `step` asks
   * this same method before carrying out any command, so the two can never disagree.
   *
   * Every command: `match-over` once a winner is set.
   * - place: `wrong-side`, `not-in-hand`, `bad-lane`, `bad-column` and `occupied` (plants only),
   *   `recharging`, `no-energy`.
   * - merge: `wrong-side`, `not-in-hand`, `no-target` (no living unit has that id), `not-yours`,
   *   `wrong-type`, `max-level`, `recharging`, `no-energy`.
   * - remove: `plants-only`, `no-target`, `not-yours`.
   */
  check(cmd: Command): CommandRejection | null {
    if (this.state.winner !== null) return 'match-over';
    switch (cmd.type) {
      case 'place':
        return this.checkPlace(cmd);
      case 'merge':
        return this.checkMerge(cmd);
      case 'remove':
        return this.checkRemove(cmd);
      default: {
        const unhandled: never = cmd;
        throw new Error(`Unhandled command ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /**
   * Advances the match by one tick and returns what happened, in this fixed order:
   * commands, economy, movement, attacks, projectiles, deaths, endgame, then the tick count.
   * Once the match is over it does nothing at all: no events, no tick, commands ignored.
   */
  step(commands: readonly Command[] = []): SimEvent[] {
    const s = this.state;
    const b = this.balance;
    if (s.winner !== null) return [];
    const events: SimEvent[] = [];

    for (const cmd of commands) {
      const reason = this.check(cmd);
      if (reason !== null) {
        events.push({ type: 'commandRejected', command: cmd, reason });
        continue;
      }
      switch (cmd.type) {
        case 'place':
          this.place(cmd, events);
          break;
        case 'merge':
          this.merge(cmd, events);
          break;
        case 'remove':
          this.remove(cmd, events);
          break;
        default: {
          const unhandled: never = cmd;
          throw new Error(`Unhandled command ${JSON.stringify(unhandled)}`);
        }
      }
    }
    tickEconomy(s, b, events);
    tickMovement(s, b);
    tickAttacks(s, b, events);
    tickProjectiles(s, b, events);
    resolveDeaths(s, b, events);
    tickEndgame(s, b, events);
    s.tick += 1;
    return events;
  }

  hash(): number {
    return hashState(this.state);
  }

  snapshot(): string {
    return snapshotState(this.state);
  }

  private checkPlace(cmd: PlaceCommand): CommandRejection | null {
    const card = this.checkCard(cmd.faction, cmd.unit);
    if (card !== null) return card;
    if (!isWholeBetween(cmd.lane, 0, LANES - 1)) return 'bad-lane';
    if (cmd.faction === 'plants') {
      if (!isWholeBetween(cmd.col, 0, PLANT_COLS - 1)) return 'bad-column';
      const taken = this.state.units.some(
        (u) => u.faction === 'plants' && u.lane === cmd.lane && Math.floor(u.x) === cmd.col,
      );
      if (taken) return 'occupied';
    }
    return this.checkPayment(cmd.faction, cmd.unit);
  }

  private checkMerge(cmd: MergeCommand): CommandRejection | null {
    const card = this.checkCard(cmd.faction, cmd.unit);
    if (card !== null) return card;
    const target = this.livingUnit(cmd.targetId);
    if (target === undefined) return 'no-target';
    if (target.faction !== cmd.faction) return 'not-yours';
    if (target.key !== cmd.unit) return 'wrong-type';
    if (target.level >= MAX_LEVEL) return 'max-level';
    return this.checkPayment(cmd.faction, cmd.unit);
  }

  private checkRemove(cmd: RemoveCommand): CommandRejection | null {
    if (cmd.faction !== 'plants') return 'plants-only';
    const target = this.livingUnit(cmd.targetId);
    if (target === undefined) return 'no-target';
    if (target.faction !== cmd.faction) return 'not-yours';
    return null;
  }

  /** `wrong-side` and `not-in-hand`: may this side play this card at all? */
  private checkCard(faction: Faction, unit: UnitKey): CommandRejection | null {
    if (UNIT_INFO[unit].faction !== faction) return 'wrong-side';
    // A card with no numbers in the balance table cannot be played, so it is not really in the hand.
    const inHand = this.state.config.cards[faction].includes(unit) && this.balance.units[unit] !== undefined;
    return inHand ? null : 'not-in-hand';
  }

  /** `recharging` and `no-energy`: can this side pay for this card now? */
  private checkPayment(faction: Faction, unit: UnitKey): CommandRejection | null {
    const player = this.state.players[faction];
    if ((player.recharge[unit] ?? 0) > 0) return 'recharging';
    if (player.energy < UNIT_INFO[unit].price) return 'no-energy';
    return null;
  }

  /** The unit with this id if it is on the field and standing (see `isStanding`). */
  private livingUnit(id: number): Unit | undefined {
    return this.state.units.find((u) => u.id === id && isStanding(u));
  }

  /** Pays a card's price and starts its recharge. */
  private payFor(faction: Faction, unit: UnitKey): void {
    const player = this.state.players[faction];
    player.energy -= UNIT_INFO[unit].price;
    player.recharge[unit] = seconds(statsFor(this.balance, unit).recharge);
  }

  /** Carries out a placement that `check` has passed: pays, starts the card's recharge, spawns. */
  private place(cmd: PlaceCommand, events: SimEvent[]): void {
    this.payFor(cmd.faction, cmd.unit);
    const x = cmd.faction === 'plants' ? cmd.col + 0.5 : ZOMBIE_SPAWN_X;
    spawnUnit(this.state, this.balance, cmd.unit, cmd.lane, x, events);
  }

  /**
   * Carries out a merge that `check` has passed: pays and starts the card's recharge, then the
   * target goes up one level. Its max health becomes `hp × levelScale[level]` from the balance
   * table, rounded, and its health keeps its share of the max, rounded, at least 1 and never above
   * the max: both stay whole even when a tuned table has fractional level multipliers. `spent`
   * grows by the price (bounties pay a share of it). Position, timers and everything else stay.
   */
  private merge(cmd: MergeCommand, events: SimEvent[]): void {
    const target = this.livingUnit(cmd.targetId);
    if (target === undefined) throw new Error(`merge passed check but unit ${cmd.targetId} is gone`);
    this.payFor(cmd.faction, cmd.unit);
    const oldHp = target.hp;
    const oldMaxHp = target.maxHp;
    target.level += 1;
    const maxHp = Math.round(statsFor(this.balance, target.key).hp * levelScale(this.balance, target.level));
    target.maxHp = maxHp;
    target.hp = Math.min(maxHp, Math.max(1, Math.round(maxHp * oldHp / oldMaxHp)));
    target.spent += UNIT_INFO[cmd.unit].price;
    events.push({ type: 'unitMerged', unitId: target.id, level: target.level });
  }

  /**
   * Carries out a removal that `check` has passed: the plant leaves the field at once with
   * `unitDied` (cause `'shovel'`). It does not go through `resolveDeaths`, so nobody gets a
   * bounty, no death blast goes off, and nothing is refunded.
   */
  private remove(cmd: RemoveCommand, events: SimEvent[]): void {
    const s = this.state;
    const u = this.livingUnit(cmd.targetId);
    if (u === undefined) throw new Error(`remove passed check but unit ${cmd.targetId} is gone`);
    s.units.splice(s.units.indexOf(u), 1); // the rest keep their ascending id order
    events.push({
      type: 'unitDied', unitId: u.id, key: u.key, faction: u.faction, lane: u.lane, x: u.x, level: u.level, cause: 'shovel',
    });
  }
}

function isWholeBetween(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}
