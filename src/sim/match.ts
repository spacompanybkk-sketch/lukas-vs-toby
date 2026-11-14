import { BALANCE, seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { PHASE1_CARDS, UNIT_INFO } from '../data/units';
import type { UnitInfo } from '../data/units';
import { tickAbilities } from './abilities';
import { tickBoss } from './boss';
import { checkBelt, playBelt, tickBelt } from './belt';
import { resolveDeaths, tickAttacks, tickBaseDefense, tickHazards, tickProjectiles } from './combat';
import { tickEconomy } from './economy';
import { tickEndgame } from './endgame';
import { endlessClockOut, endlessStart, energyOff, startBases, tickEndless, tickEndlessGarden } from './endless';
import { checkHero, useHero } from './hero';
import { castSpell, checkSpell, dealSpells } from './spells';
import { restoreState, hashState, snapshotState } from './hash';
import { levelUp } from './levelUp';
import { cloneLawn, isRock, NO_TWIST } from './lawn';
import { inLane, isBoss, isStanding, statsFor } from './lookup';
import { tickMovement } from './movement';
import { checkLevel, tickScript } from './script';
import { spawnUnit } from './spawn';
import { tickStatuses } from './status';
import { LANES, MAX_LEVEL, MAX_UPGRADE, PLANT_COLS, ZOMBIE_SPAWN_X } from './types';
import type {
  CardKey, Command, CommandRejection, Faction, MatchConfig, SimEvent, SimState, Unit,
} from './types';

export { spawnUnit } from './spawn'; // where the tests and scenes look for it

type PlaceCommand = Extract<Command, { type: 'place' }>;
type MergeCommand = Extract<Command, { type: 'merge' }>;
type RemoveCommand = Extract<Command, { type: 'remove' }>;

/**
 * A fresh match setup: both sides alike, the Phase 1 cards, sudden death on, both hero powers on,
 * two spells a side; a plain battle (no script, nothing prepared, no clock, no belt, energy on, both
 * bases can be hurt).
 */
export function defaultConfig(seed: number, balance: Balance = BALANCE): MatchConfig {
  return {
    seed,
    startEnergy: { plants: balance.startEnergy, zombies: balance.startEnergy },
    baseHp: { plants: balance.baseHp, zombies: balance.baseHp },
    cards: { plants: [...PHASE1_CARDS.plants], zombies: [...PHASE1_CARDS.zombies] },
    incomeMultiplier: { plants: 1, zombies: 1 },
    suddenDeath: true,
    heroes: { plants: true, zombies: true },
    spells: { plants: 2, zombies: 2 },
    upgrades: { plants: {}, zombies: {} },
    mode: 'battle', script: [], prepared: [], goalTicks: null, belt: null, noEnergy: false, invulnerableBase: null,
    boss: null, endless: null, lawn: cloneLawn(NO_TWIST),
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
    heroes: { ...c.heroes },
    spells: { ...c.spells },
    upgrades: { plants: { ...c.upgrades.plants }, zombies: { ...c.upgrades.zombies } },
    mode: c.mode,
    script: c.script.map((e) => ({ ...e })),
    prepared: c.prepared.map((p) => ({ ...p })),
    goalTicks: c.goalTicks,
    belt: c.belt === null ? null : { ...c.belt, cards: [...c.belt.cards] },
    noEnergy: c.noEnergy,
    invulnerableBase: c.invulnerableBase,
    boss: c.boss === null || c.boss === undefined ? (c.boss as null) : { ...c.boss },
    endless: c.endless === null || c.endless === undefined ? (c.endless as null) : { ...c.endless, cards: [...c.endless.cards] },
    // A setup from before the twists has none: NO_TWIST. Null is kept for `checkLawn` to refuse.
    lawn: c.lawn === undefined ? cloneLawn(NO_TWIST) : c.lawn === null ? c.lawn : cloneLawn(c.lawn),
  };
}

/**
 * Refuses a setup whose Marketplace levels are not whole numbers 0..`MAX_UPGRADE`, each on a card
 * of its own side (a programming error, never a game situation).
 */
function checkUpgrades(c: MatchConfig): void {
  for (const faction of ['plants', 'zombies'] as const) {
    for (const [key, level] of Object.entries(c.upgrades[faction])) {
      const info = UNIT_INFO[key as CardKey] as UnitInfo | undefined;
      if (info === undefined || info.faction !== faction) throw new RangeError(`"${key}" is no ${faction} card to upgrade`);
      if (!Number.isInteger(level) || (level as number) < 0 || (level as number) > MAX_UPGRADE) {
        throw new RangeError(`upgrade level ${String(level)} of ${key} is not 0..${MAX_UPGRADE}`);
      }
    }
  }
}

/** One match. All game rules run in `step`; everything else only reads `state`. */
export class Match {
  readonly state: SimState;
  readonly balance: Balance;

  constructor(config: MatchConfig, balance: Balance = BALANCE) {
    const own = cloneConfig(config); // the match never shares objects with the caller's config
    checkUpgrades(own);
    checkLevel(own, balance);
    this.balance = balance;
    const heroTimer = (f: Faction): number => seconds(balance.hero[f].firstChargeSeconds);
    const energy = (f: Faction): number => (energyOff(own, f) ? 0 : own.startEnergy[f]); // no energy: none to start with either
    this.state = {
      tick: 0, rng: own.seed >>> 0, nextId: 1,
      units: [], projectiles: [], hazards: [],
      players: {
        plants: { energy: energy('plants'), carry: 0, recharge: {}, heroTimer: heroTimer('plants'), spells: [] },
        zombies: { energy: energy('zombies'), carry: 0, recharge: {}, heroTimer: heroTimer('zombies'), spells: [] },
      },
      baseHp: startBases(own, balance), baseMaxHp: startBases(own, balance), // Free Play's garden 1: its own
      baseDefenseTimers: new Array<number>(LANES).fill(0),
      suddenDeath: false, winner: null,
      config: own,
      scriptIndex: 0, belt: [], // prepared units and tick-0 waves come on in the first step (`tickScript`)
      ...endlessStart(own, balance), // Free Play's waves and gardens come in the step (`tickEndless`)
    };
    dealSpells(this.state, balance); // the deal is the first thing the state rng draws
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
   * - place: `wrong-side`, `not-in-hand`, `bad-lane`, `bad-column`, `rock` and `occupied` (plants only),
   *   `recharging`, `no-energy`.
   * - merge: `wrong-side`, `not-in-hand`, `no-target` (no living unit has that id), `not-yours`,
   *   `wrong-type`, `max-level`, `recharging`, `no-energy`.
   * - remove: `plants-only`, `no-target`, `not-yours`, `boss`.
   * - hero: `hero-off`, `bad-lane`, `hero-charging` (see `checkHero`).
   * - spell: `spells-off`, `spell-not-dealt`, `bad-lane`, `bad-column`, `rock`, `occupied`, `spell-charging`
   *   (see `checkSpell`).
   * - belt: `no-belt`, `bad-slot`, `bad-lane`, `bad-column`, `rock`, `occupied`, `max-level` (see `checkBelt`).
   * With the level's `noEnergy`, place and merge are refused `no-energy` once the card, lane and
   * tile (place) or target (merge) checks have passed.
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
      case 'hero':
        return checkHero(this.state, cmd);
      case 'spell':
        return checkSpell(this.state, this.balance, cmd);
      case 'belt':
        return checkBelt(this.state, cmd);
      default: {
        const unhandled: never = cmd;
        throw new Error(`Unhandled command ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /**
   * Advances the match by one tick and returns what happened, in this fixed order:
   * the level's script (prepared units on tick 0, then waves; `tickScript`), Free Play's waves
   * (`tickEndless`), the belt's arrival
   * (`tickBelt`), commands, economy, movement, attacks, the plant base's defence, abilities, the boss (`tickBoss`), projectiles, hazards, statuses, deaths,
   * Free Play's broken garden (`tickEndlessGarden`), endgame, Free Play's clock (`endlessClockOut`), then the tick count.
   * Once the match is over it does nothing at all: no events, no tick, commands ignored.
   */
  step(commands: readonly Command[] = []): SimEvent[] {
    const s = this.state;
    const b = this.balance;
    if (s.winner !== null) return [];
    const events: SimEvent[] = [];

    tickScript(s, b, events);
    tickEndless(s, b, events);
    tickBelt(s, events);
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
        case 'hero':
          useHero(s, b, cmd, events);
          break;
        case 'spell':
          castSpell(s, b, cmd, events);
          break;
        case 'belt':
          playBelt(s, b, cmd, events);
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
    // Zombies the base's strike felled this step: resolveDeaths gives them cause 'base', no bounty.
    // Step-local, so nothing outside the state carries over from one step (or match) to the next.
    const felled = tickBaseDefense(s, b, events);
    tickAbilities(s, b, events);
    tickBoss(s, b, events);
    tickProjectiles(s, b, events);
    tickHazards(s, b, events);
    tickStatuses(s, b, events);
    resolveDeaths(s, b, events, felled);
    tickEndlessGarden(s, b, events); // Free Play breakthrough: a fallen plant base breaks the garden instead of ending the match
    tickEndgame(s, b, events);
    if (s.winner === null) endlessClockOut(s, events);
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
      if (isRock(this.state.config, cmd.lane, cmd.col)) return 'rock';
      const taken = this.state.units.some(
        (u) => u.faction === 'plants' && inLane(u, cmd.lane) && Math.floor(u.x) === cmd.col,
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
    if (isBoss(target.key)) return 'boss';
    return null;
  }

  /** `wrong-side` and `not-in-hand`: may this side play this card at all? */
  private checkCard(faction: Faction, unit: CardKey): CommandRejection | null {
    const info = UNIT_INFO[unit] as UnitInfo | undefined; // a command from outside may name a unit that is not a card
    if (info === undefined) return 'not-in-hand';
    if (info.faction !== faction) return 'wrong-side';
    // A card with no numbers in the balance table cannot be played, so it is not really in the hand.
    const inHand = this.state.config.cards[faction].includes(unit) && this.balance.units[unit] !== undefined;
    return inHand ? null : 'not-in-hand';
  }

  /** `no-energy` (a level with none), `recharging` and `no-energy`: can this side pay for this card now? */
  private checkPayment(faction: Faction, unit: CardKey): CommandRejection | null {
    if (energyOff(this.state.config, faction)) return 'no-energy';
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
  private payFor(faction: Faction, unit: CardKey): void {
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
   * target goes up one level (see `levelUp`: max health by the level curve and Marketplace level,
   * health keeps its share, `spent` grows by the price).
   */
  private merge(cmd: MergeCommand, events: SimEvent[]): void {
    const target = this.livingUnit(cmd.targetId);
    if (target === undefined) throw new Error(`merge passed check but unit ${cmd.targetId} is gone`);
    this.payFor(cmd.faction, cmd.unit);
    levelUp(this.state, this.balance, target, events);
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
