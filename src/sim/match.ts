import { BALANCE, seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { PHASE1_CARDS, UNIT_INFO } from '../data/units';
import { resolveDeaths, tickAttacks, tickProjectiles } from './combat';
import { tickEconomy } from './economy';
import { tickEndgame } from './endgame';
import { restoreState, hashState, snapshotState } from './hash';
import { statsFor } from './lookup';
import { tickMovement } from './movement';
import { LANES, PLANT_COLS, ZOMBIE_SPAWN_X } from './types';
import type {
  Command, CommandRejection, MatchConfig, SimEvent, SimState, Unit, UnitKey,
} from './types';

type PlaceCommand = Extract<Command, { type: 'place' }>;

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

  /** Why a command would be refused right now, or null if it would be carried out. */
  check(cmd: Command): CommandRejection | null {
    const s = this.state;
    if (s.winner !== null) return 'match-over';
    // Merge and remove are not built yet.
    if (cmd.type !== 'place') return 'no-target';

    const info = UNIT_INFO[cmd.unit];
    if (info.faction !== cmd.faction) return 'wrong-side';
    // A card with no numbers in the balance table cannot be played, so it is not really in the hand.
    const inHand = s.config.cards[cmd.faction].includes(cmd.unit) && this.balance.units[cmd.unit] !== undefined;
    if (!inHand) return 'not-in-hand';
    if (!isWholeBetween(cmd.lane, 0, LANES - 1)) return 'bad-lane';
    if (cmd.faction === 'plants') {
      if (!isWholeBetween(cmd.col, 0, PLANT_COLS - 1)) return 'bad-column';
      const taken = s.units.some(
        (u) => u.faction === 'plants' && u.lane === cmd.lane && Math.floor(u.x) === cmd.col,
      );
      if (taken) return 'occupied';
    }
    const player = s.players[cmd.faction];
    if ((player.recharge[cmd.unit] ?? 0) > 0) return 'recharging';
    if (player.energy < info.price) return 'no-energy';
    return null;
  }

  /**
   * Advances the match by one tick and returns what happened, in this fixed order:
   * commands, economy, movement, attacks, projectiles, deaths, endgame, then the tick count.
   */
  step(commands: readonly Command[] = []): SimEvent[] {
    const s = this.state;
    const b = this.balance;
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
        case 'remove':
          // `check` refuses these until they are built; a command that gets here has no branch yet.
          throw new Error('not implemented');
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

  /** Carries out a placement that `check` has passed: pays, starts the card's recharge, spawns. */
  private place(cmd: PlaceCommand, events: SimEvent[]): void {
    const stats = statsFor(this.balance, cmd.unit);
    const player = this.state.players[cmd.faction];
    player.energy -= UNIT_INFO[cmd.unit].price;
    player.recharge[cmd.unit] = seconds(stats.recharge);
    const x = cmd.faction === 'plants' ? cmd.col + 0.5 : ZOMBIE_SPAWN_X;
    spawnUnit(this.state, this.balance, cmd.unit, cmd.lane, x, events);
  }
}

function isWholeBetween(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}
