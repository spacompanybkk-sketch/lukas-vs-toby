import { batch, signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { createBasicBot } from '../ai/basicBot';
import type { Bot, Skill } from '../ai/bot';
import { DIFFICULTY, battleConfig, computerTable } from '../ai/difficulty';
import { BALANCE, seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { ALL_CARDS, UNIT_INFO, isCard, priceOf } from '../data/units';
import { Match } from '../sim/match';
import { spellArea } from '../sim/spells';
import type { SpellTile } from '../sim/spells';
import { isStanding, statsFor } from '../sim/lookup';
import { MAX_LEVEL, TICKS_PER_SECOND } from '../sim/types';
import type { CardKey, Command, CommandRejection, Faction, SimEvent, SpellKey, Unit, UnitKey } from '../sim/types';
import type { PlacementPreview } from '../render/battle/types';
import { bigWaveRuns, levelProblem, levelRecord } from './levelSession';
import type { LevelPlay, LevelRecord } from './levelSession';

/**
 * `skill` is the difficulty the player picked (see `src/ai/difficulty.ts`). `upgrades`: the
 * logged-in player's Marketplace levels (their save holds both sides; only the cards of
 * `playerFaction` are used, the computer never has any). `versus`: a match between two people,
 * where upgrades never apply (spec 7).
 */
export interface BattleOptions {
  playerFaction: Faction; skill: Skill; seed: number;
  upgrades?: Partial<Record<CardKey, number>>;
  versus?: boolean;
  /** The player's hand instead of all ten cards (an Adventure level deals only its own; [] deals none). */
  cards?: CardKey[];
  /** The Adventure level this battle plays (its id), or none for a Quick Battle. */
  level?: string;
  /**
   * The prepared Adventure level (`prepareLevel`): the match is its config (scripted waves, the
   * clock, the belt), the computer is the level's opponent or none. `skill`, `cards` and
   * `upgrades` are then not used: the config already holds them.
   */
  play?: LevelPlay;
}

/** The player's upgrades for their own side: the cards of `side` in `upgrades`, none in Versus. */
export function sideUpgrades(opts: BattleOptions): Partial<Record<CardKey, number>> {
  const own: Partial<Record<CardKey, number>> = {};
  if (opts.versus === true || opts.upgrades === undefined) return own;
  for (const key of ALL_CARDS[opts.playerFaction]) {
    const level = opts.upgrades[key];
    if (level !== undefined) own[key] = level;
  }
  return own;
}

export interface CardVM {
  unit: UnitKey; name: string; price: number; hotkey: string;
  affordable: boolean; rechargeFraction: number;
}

export interface BaseVM { hp: number; max: number }
export type BattleResult = null | { winner: Faction | 'draw'; playerWon: boolean };

export interface HudSignals {
  energy: Signal<number>; cards: Signal<CardVM[]>;
  base: Signal<Record<Faction, BaseVM>>;
  seconds: Signal<number>; suddenDeath: Signal<boolean>; paused: Signal<boolean>;
  selected: Signal<UnitKey | null>; shovel: Signal<boolean>;
  result: Signal<BattleResult>;
  denied: Signal<number>; // increments on each refused action, for the shake
  hero: Signal<HeroVM>; // the player's hero power
  heroSelected: Signal<boolean>; // the hero power is picked and waits for a lane
  spells: Signal<SpellVM[]>; // the player's dealt spells, in deal order
  spellSelected: Signal<SpellKey | null>; // the aimed spell picked and waiting for a tile
}

/** A level's own HUD signals (all quiet in a Quick Battle). */
export interface LevelSignals {
  /** The player's conveyor belt (oldest first); empty when the level has none for the player. */
  belt: Signal<BeltCardVM[]>;
  /** The belt card picked (its slot), waiting for a tile; null when none. */
  beltSlot: Signal<number | null>;
  /** The last unit of a big wave to come on, numbered so each one cues: where it enters. */
  incoming: Signal<IncomingVM | null>;
}

/** A card waiting on the belt; `id` stays with the card while it moves along (a new card, a new id). */
export interface BeltCardVM { card: CardKey; id: number }

/** A unit of a big wave entering `lane` from `side`'s end; `n` counts them. */
export interface IncomingVM { lane: number; side: Faction; n: number }

/** What a level's HUD shows beside the usual: fixed for the whole battle. */
export interface LevelHudInfo {
  mode: LevelPlay['config']['mode'];
  /** The clock, in seconds (survive, breakthrough, conveyor), or null. */
  goalSeconds: number | null;
  /** Breakthrough: the stars are counted on the clock left, at these shares of it. */
  clockStars: boolean;
  /**
   * The scripted waves: when the last unit comes (seconds; 0 when there is no script) and the big
   * waves' flags (seconds). With a clock the waves ride on the clock bar; without one, on their own bar.
   */
  lastWave: number; flags: number[];
  /** Whose units the script brings. */
  enemy: Faction;
  /** The belt is the player's: it replaces the card tray. */
  belt: boolean;
  /** No energy in this level: the energy counter is not shown. */
  noEnergy: boolean;
}

/** One of the player's dealt spells: castable now, and how far it has recharged (0..1). */
export interface SpellVM { key: SpellKey; ready: boolean; fraction: number }

/** What a tap on `tile` would do with the selected spell: the tiles it would cover, and whether it is allowed. */
export interface SpellPreview { spell: SpellKey; lane: number; col: number; tiles: SpellTile[]; ok: boolean }

/** What a tap on a lane would do with the hero power picked: fire down `lane` (`ok`: it is ready). */
export interface HeroPreview { hero: true; lane: number; ok: boolean }

/** Anything `hover` can answer: a card's placement, a spell's area, or the hero's lane. */
export type AimPreview = PlacementPreview | SpellPreview | HeroPreview;

/** The player's hero power: usable now, and how far it has charged (0..1). */
export interface HeroVM { ready: boolean; fraction: number }

type Tile = { lane: number; col: number };

/** A zombie tap merges into the player's own zombie of that type standing this near the tapped tile's middle, along the lane. */
export const ZOMBIE_MERGE_REACH = 0.75;

const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/**
 * The HUD draws charge and recharge in eighths (`CHARGE_STEPS` in HeroButton, `RECHARGE_STEPS`
 * in CardTray): the signals carry the fraction already cut to those steps, so they change only
 * when the picture does, not on every tick.
 */
export const HUD_STEPS = 8;
/** A charge (hero, spell), rounded down: a button never looks readier than it is. */
const stepDown = (f: number): number => Math.floor(Math.min(1, Math.max(0, f)) * HUD_STEPS) / HUD_STEPS;
/** A recharge still to go (cards), rounded up, for the same reason. */
const stepUp = (f: number): number => Math.ceil(Math.min(1, Math.max(0, f)) * HUD_STEPS) / HUD_STEPS;

function sameCards(a: readonly CardVM[], b: readonly CardVM[]): boolean {
  return a.length === b.length && a.every((c, i) => {
    const d = b[i];
    return d !== undefined && c.unit === d.unit && c.affordable === d.affordable && c.rechargeFraction === d.rechargeFraction
      && c.price === d.price && c.hotkey === d.hotkey && c.name === d.name;
  });
}

/**
 * Sits between the player's input and the simulation: owns the match and the computer opponent,
 * turns card selections and taps into commands, and publishes HUD state as signals. No DOM, no
 * Three.js. Nothing here needs a hovering pointer or a keyboard: `click` stands alone.
 */
export class BattleController {
  readonly match: Match;
  readonly hud: HudSignals;
  readonly playerFaction: Faction;
  /** The Adventure level being played, or null (Quick Battle). */
  readonly play: LevelPlay | null;
  /** A level's extra HUD (clock, waves, belt), or null. */
  readonly level: LevelHudInfo | null;
  readonly levelHud: LevelSignals;
  private readonly bot: Bot;
  /** The ids of the cards on the belt, in belt order (see `BeltCardVM`). */
  private readonly beltIds: number[] = [];
  private nextBeltId = 1;
  /** The big waves (first and last arrival tick), and the units of a big wave cued so far. */
  private readonly bigRuns: { from: number; to: number }[] = [];
  private incomingN = 0;
  private readonly opponent: Faction;
  /** The one player command accepted for the coming tick, if any. */
  private queued: Command | null = null;
  /** Ticks of the player's current hero charge: the first one until the hero is first used. */
  private heroPeriod: number;
  /** The spells the player has cast at least once: their charge is then the cooldown, not the first wait. */
  private readonly castOnce = new Set<SpellKey>();
  /** The card selected when a power was picked: it comes back once the power is cast or put down. */
  private cardBeforePower: UnitKey | null = null;

  constructor(opts: BattleOptions, balance: Balance = BALANCE) {
    this.playerFaction = opts.playerFaction;
    this.opponent = opts.playerFaction === 'plants' ? 'zombies' : 'plants';
    // The difficulty sets the computer's skill and both sides' income: the very match the balance
    // checks measure for this side and difficulty.
    // Both sides are dealt all ten of their cards (ruling R52). The computer's strategy may know
    // only some of them; its random moves (`randomLegal`) play any card in its hand.
    this.play = opts.play ?? null;
    const botSeed = (Math.imul(opts.seed, 2654435761) + 1) >>> 0;
    if (this.play !== null) {
      // An Adventure level: its own match, and its own computer (none for a scripted level).
      const { def, config } = this.play;
      if (def.side !== opts.playerFaction) throw new Error(`level ${def.id} is played on the ${def.side} side`);
      this.match = new Match(config, balance);
      const problem = levelProblem(def);
      if (problem !== null) throw new Error(problem);
      this.bot = def.opponent === null
        ? { faction: this.opponent, think: () => [] }
        : createBasicBot(this.opponent, def.opponent.skill, botSeed);
      const runs = bigWaveRuns(config.script);
      this.bigRuns.push(...runs);
      const flags = runs.map((r) => r.from);
      const last = config.script[config.script.length - 1];
      this.level = {
        mode: config.mode,
        goalSeconds: config.goalTicks === null ? null : config.goalTicks / TICKS_PER_SECOND,
        clockStars: config.mode === 'breakthrough',
        lastWave: last === undefined ? 0 : last.tick / TICKS_PER_SECOND,
        flags: flags.map((t) => t / TICKS_PER_SECOND),
        enemy: this.opponent,
        belt: config.belt !== null && config.belt.side === this.playerFaction,
        noEnergy: config.noEnergy,
      };
    } else {
      const config = battleConfig(opts.seed, opts.playerFaction, opts.skill, balance);
      config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
      if (opts.cards !== undefined) config.cards[opts.playerFaction] = [...opts.cards];
      config.upgrades = { plants: {}, zombies: {}, [opts.playerFaction]: sideUpgrades(opts) };
      this.match = new Match(config, balance);
      const computerSkill = DIFFICULTY[opts.skill][opts.playerFaction].skill;
      this.bot = createBasicBot(this.opponent, computerSkill, botSeed, computerTable(opts.playerFaction, opts.skill));
      this.level = null;
    }
    this.hud = {
      energy: signal(0), cards: signal<CardVM[]>([]),
      base: signal({ plants: { hp: 0, max: 0 }, zombies: { hp: 0, max: 0 } }),
      seconds: signal(0), suddenDeath: signal(false), paused: signal(false),
      selected: signal<UnitKey | null>(null), shovel: signal(false),
      result: signal<BattleResult>(null), denied: signal(0),
      hero: signal<HeroVM>({ ready: false, fraction: 0 }),
      heroSelected: signal(false),
      spells: signal<SpellVM[]>([]), spellSelected: signal<SpellKey | null>(null),
    };
    this.levelHud = {
      belt: signal<BeltCardVM[]>([]), beltSlot: signal<number | null>(null),
      incoming: signal<IncomingVM | null>(null),
    };
    this.heroPeriod = seconds(balance.hero[this.playerFaction].firstChargeSeconds);
    this.refresh();
    // A first tap on the lawn should do something: start with the first card the player can pay for.
    const first = this.hud.cards.peek().find((c) => c.affordable);
    if (first !== undefined) this.hud.selected.value = first.unit;
  }

  /** One tick: the computer's commands and the player's queued one go to the match together. */
  step(): SimEvent[] {
    if (this.hud.paused.peek() || this.over()) return [];
    const mine: Command[] = this.queued === null ? [] : [this.queued];
    this.queued = null;
    const theirs = this.bot.think(this.match);
    const plants = this.playerFaction === 'plants' ? mine : theirs;
    const zombies = this.playerFaction === 'plants' ? theirs : mine;
    const events = this.match.step([...plants, ...zombies]);
    for (const e of events) {
      if (e.type === 'heroUsed' && e.faction === this.playerFaction) {
        this.heroPeriod = seconds(this.match.balance.hero[this.playerFaction].chargeSeconds);
      }
      if (e.type === 'spellCast' && e.faction === this.playerFaction) this.castOnce.add(e.spell);
      if (e.type === 'beltCard') this.beltIds.push(this.nextBeltId++);
      if (e.type === 'beltUsed') this.beltLeft(e.slot);
      if (e.type === 'waveSpawned') this.cueWave(e.index, e.lane);
    }
    this.refresh();
    const winner = this.match.state.winner;
    if (winner !== null && this.hud.result.peek() === null) {
      this.hud.result.value = { winner, playerWon: winner === this.playerFaction };
    }
    return events;
  }

  /** A decided level's record (`levelRecord`); null while it runs, and in a Quick Battle. */
  levelResult(): LevelRecord | null {
    return levelRecord(this);
  }

  select(unit: UnitKey | null): void {
    if (this.hud.paused.peek() || this.over()) return;
    if (unit !== null && !(isCard(unit) && this.match.state.config.cards[this.playerFaction].includes(unit))) return;
    this.levelHud.beltSlot.value = null;
    this.hud.selected.value = unit;
    if (unit !== null) {
      this.hud.shovel.value = false;
      this.clearPowers();
      this.cardBeforePower = null;
    }
  }

  /**
   * A tap on a belt card (its slot): it is picked and waits for a tile, like a card from the tray
   * (and puts down the shovel and any power). Null, or a slot with no card, puts it down.
   */
  selectBelt(slot: number | null): void {
    if (this.hud.paused.peek() || this.over() || this.level?.belt !== true) return;
    const card = slot === null ? undefined : this.match.state.belt[slot];
    if (slot === null || card === undefined) {
      if (this.levelHud.beltSlot.peek() !== null) {
        this.levelHud.beltSlot.value = null;
        this.hud.selected.value = null;
      }
      return;
    }
    batch(() => {
      this.hud.shovel.value = false;
      this.clearPowers();
      this.cardBeforePower = null;
      this.levelHud.beltSlot.value = slot;
      this.hud.selected.value = card;
    });
  }

  toggleShovel(): void {
    if (this.hud.paused.peek() || this.over()) return;
    if (this.playerFaction !== 'plants') return;
    const on = !this.hud.shovel.peek();
    this.hud.shovel.value = on;
    if (on) {
      this.levelHud.beltSlot.value = null;
      this.hud.selected.value = null;
      this.clearPowers();
      this.cardBeforePower = null;
    }
  }

  /**
   * Picks the hero power (it then waits for a lane: a tap goes to `heroLane`) or puts it down.
   * Picking it clears the card, the shovel and any spell; a hero still charging is refused
   * (counted as a denial) and not picked.
   */
  selectHero(on: boolean): void {
    if (this.hud.paused.peek() || this.over()) return;
    if (!on) {
      if (this.hud.heroSelected.peek()) this.powerDone();
      return;
    }
    const reason = this.match.check({ type: 'hero', faction: this.playerFaction, lane: 0 });
    if (reason !== null) {
      this.deny(reason);
      return;
    }
    this.pickPower();
    this.hud.spellSelected.value = null;
    this.hud.heroSelected.value = true;
  }

  /** The hero button (or key H): picks the hero power, or puts it down when it is picked. */
  toggleHero(): void {
    this.selectHero(!this.hud.heroSelected.peek());
  }

  /**
   * A tap on a spell's button. An aimed spell is picked (the next lawn tap casts it), which clears
   * the card, the shovel and the hero; tapping the picked one again puts it down. An un-aimed spell
   * (size 0: Sun Shower, Brain Feast) is cast there and then, queued like a click, which puts
   * down the hero and any aimed spell. A spell that is
   * not dealt is ignored; one still charging is refused (counted as a denial). Null puts any spell down.
   */
  selectSpell(key: SpellKey | null): void {
    if (this.hud.paused.peek() || this.over()) return;
    if (key === null || key === this.hud.spellSelected.peek()) {
      if (this.hud.spellSelected.peek() !== null) this.powerDone();
      return;
    }
    if (!this.match.state.players[this.playerFaction].spells.some((x) => x.key === key)) return;
    const aimed = this.match.balance.spells[key].size > 0;
    const slot = this.match.state.players[this.playerFaction].spells.find((x) => x.key === key);
    if (aimed) {
      if (slot !== undefined && slot.timer > 0) {
        this.deny('spell-charging');
        return;
      }
      this.pickPower();
      this.hud.heroSelected.value = false;
      this.hud.spellSelected.value = key;
      return;
    }
    if (this.queued !== null) return;
    const cmd: Command = { type: 'spell', faction: this.playerFaction, spell: key, lane: 0, col: 0 };
    const reason = this.match.check(cmd);
    if (reason !== null) {
      this.deny(reason);
      return;
    }
    this.queued = cmd;
    // Cast: nothing is waiting to be aimed any more (and a card put aside for it comes back).
    if (this.hud.heroSelected.peek() || this.hud.spellSelected.peek() !== null) this.powerDone();
  }

  /**
   * What a tap here would do: with a spell picked, the area it would cover (and whether the cast
   * would be allowed); with a card, the placement or merge preview; otherwise null.
   */
  hover(tile: Tile | null, unitId: number | null): AimPreview | null {
    if (this.hud.heroSelected.peek()) {
      if (tile === null) return null;
      return { hero: true, lane: tile.lane, ok: this.match.check({ type: 'hero', faction: this.playerFaction, lane: tile.lane }) === null };
    }
    const spell = this.hud.spellSelected.peek();
    if (spell !== null) {
      if (tile === null) return null;
      const cmd: Command = { type: 'spell', faction: this.playerFaction, spell, lane: tile.lane, col: tile.col };
      const size = this.match.balance.spells[spell].size;
      return {
        spell, lane: tile.lane, col: tile.col, tiles: spellArea(this.playerFaction, size, tile.lane, tile.col),
        ok: this.match.check(cmd) === null,
      };
    }
    const unit = this.hud.selected.peek();
    if (unit === null) return null;
    const target = this.resolveTile(tile, unitId, unit);
    if (target === null) return null;
    const cmd = this.commandFor(unit, target.tile, target.unit);
    const slot = this.levelHud.beltSlot.peek();
    if (slot !== null) {
      return {
        unit, lane: target.tile.lane, col: target.tile.col,
        ok: this.match.check(this.beltCommand(slot, target.tile)) === null,
        mergeTargetId: cmd.type === 'merge' ? cmd.targetId : null,
      };
    }
    return {
      unit, lane: target.tile.lane, col: target.tile.col,
      ok: this.match.check(cmd) === null,
      mergeTargetId: cmd.type === 'merge' ? cmd.targetId : null,
    };
  }

  /**
   * Acts on a tap or click. Null means accepted (queued for the next tick). After the match is
   * decided it answers 'match-over'. While paused, or for a second click within one tick, it
   * answers 'ignored'. Neither of those counts as a denial; real refusals do.
   */
  click(tile: Tile | null, unitId: number | null): CommandRejection | 'ignored' | null {
    if (this.over()) return 'match-over';
    if (this.hud.paused.peek() || this.queued !== null) return 'ignored';
    if (this.hud.heroSelected.peek()) return tile === null ? this.deny('bad-lane') : this.heroLane(tile.lane);
    const spell = this.hud.spellSelected.peek();
    if (spell !== null) return this.castAt(spell, tile);
    const target = this.resolveTile(tile, unitId, this.hud.shovel.peek() ? null : this.hud.selected.peek());
    const slot = this.levelHud.beltSlot.peek();
    if (slot !== null && !this.hud.shovel.peek()) {
      if (target === null) return this.deny('bad-lane');
      const play = this.beltCommand(slot, target.tile);
      const refused = this.match.check(play);
      if (refused !== null) return this.deny(refused);
      this.queued = play;
      return null;
    }
    const cmd = this.buildClickCommand(target);
    if (cmd === 'no-selection') return this.deny('not-in-hand');
    if (cmd === 'no-tile') return this.deny('bad-lane');
    if (cmd === 'no-target') return this.deny('no-target');
    const reason = this.match.check(cmd);
    if (reason !== null) return this.deny(reason);
    this.queued = cmd;
    return null;
  }

  /**
   * The card whose merge is possible right now, for the level-up markers over the player's own
   * units of that type: a card is selected (not the shovel), it is recharged and paid for, and
   * at least one of the player's standing units of that type is below the top level. Null
   * otherwise. Called once a frame, so it allocates nothing.
   */
  mergeCue(): UnitKey | null {
    const unit = this.hud.selected.peek();
    if (unit === null || !isCard(unit) || this.hud.shovel.peek() || this.hud.paused.peek() || this.over()) return null;
    const me = this.match.state.players[this.playerFaction];
    // A belt card is free and never recharges.
    if (this.levelHud.beltSlot.peek() === null && ((me.recharge[unit] ?? 0) > 0 || me.energy < priceOf(unit))) return null;
    const units = this.match.state.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i] as Unit;
      if (u.faction === this.playerFaction && u.key === unit && u.level < MAX_LEVEL && isStanding(u)) return unit;
    }
    return null;
  }

  /**
   * The tile to act on when the pointer's ray hits a unit's model itself: the unit's own tile,
   * when it is the player's own standing unit and the selected card is its type (a merge) or
   * the shovel is on. Otherwise null, and the ground under the pointer decides. A tap on the
   * upper half of a model would otherwise land on the grass behind it, a lane further back.
   */
  aimAt(unitId: number): Tile | null {
    const u = this.match.state.units.find((x) => x.id === unitId);
    if (u === undefined || u.faction !== this.playerFaction || !isStanding(u)) return null;
    const shovel = this.hud.shovel.peek();
    // A unit at the top level cannot take its card: the tap falls through to the ground under it.
    if (!shovel && (this.hud.selected.peek() !== u.key || u.level >= MAX_LEVEL)) return null;
    return { lane: u.lane, col: Math.floor(u.x) };
  }

  /**
   * Fires the player's hero power down `lane`, answering as `click` does: null means queued for
   * the next tick, 'match-over' once decided, 'ignored' while paused or with a command already
   * queued, and the match's own refusal (counted as a denial) otherwise.
   */
  heroLane(lane: number): CommandRejection | 'ignored' | null {
    if (this.over()) return 'match-over';
    if (this.hud.paused.peek() || this.queued !== null) return 'ignored';
    const cmd: Command = { type: 'hero', faction: this.playerFaction, lane };
    const reason = this.match.check(cmd);
    if (reason !== null) return this.deny(reason);
    this.queued = cmd;
    this.powerDone();
    return null;
  }

  hotkey(key: string): void {
    if (key === ' ') {
      if (!this.over()) this.setPaused(!this.hud.paused.peek());
      return;
    }
    if (this.hud.paused.peek() || this.over()) return;
    if (key === 'Escape') {
      this.levelHud.beltSlot.value = null;
      this.hud.selected.value = null;
      this.hud.shovel.value = false;
      this.clearPowers();
      this.cardBeforePower = null;
      return;
    }
    const lower = key.toLowerCase();
    if (lower === 'h') {
      this.toggleHero();
      return;
    }
    if (lower === 'q' || lower === 'w') {
      const slot = this.match.state.players[this.playerFaction].spells[lower === 'q' ? 0 : 1];
      if (slot !== undefined) this.selectSpell(slot.key);
      return;
    }
    const index = HOTKEYS.indexOf(key);
    if (this.level?.belt === true) {
      if (index >= 0) this.selectBelt(index);
      return;
    }
    const card = index < 0 ? undefined : this.match.state.config.cards[this.playerFaction][index];
    if (card !== undefined) this.select(card);
  }

  setPaused(paused: boolean): void {
    this.hud.paused.value = paused;
  }

  /** Casts the picked spell at the tapped tile, as `click` answers; on success the spell is put down. */
  private castAt(spell: SpellKey, tile: Tile | null): CommandRejection | null {
    if (tile === null) return this.deny('bad-lane');
    const cmd: Command = { type: 'spell', faction: this.playerFaction, spell, lane: tile.lane, col: tile.col };
    const reason = this.match.check(cmd);
    if (reason !== null) return this.deny(reason);
    this.queued = cmd;
    this.powerDone();
    return null;
  }

  /**
   * A power is being picked: the card selected now (if no power was already waiting) is put
   * aside, to come back when the power is cast or put down; the card and the shovel go down.
   */
  private pickPower(): void {
    if (!this.hud.heroSelected.peek() && this.hud.spellSelected.peek() === null) {
      // A belt card is not put aside: the belt moves on while the power is aimed.
      this.cardBeforePower = this.levelHud.beltSlot.peek() === null ? this.hud.selected.peek() : null;
    }
    this.levelHud.beltSlot.value = null;
    this.hud.selected.value = null;
    this.hud.shovel.value = false;
  }

  /** The power was cast or put down: nothing waits to be aimed, and the card put aside comes back if still in hand. */
  private powerDone(): void {
    this.clearPowers();
    const card = this.cardBeforePower;
    this.cardBeforePower = null;
    if (card !== null && isCard(card) && this.match.state.config.cards[this.playerFaction].includes(card)) this.hud.selected.value = card;
  }

  private clearPowers(): void {
    this.hud.heroSelected.value = false;
    this.hud.spellSelected.value = null;
  }

  /** The belt command for the card in `slot` on `tile`. */
  private beltCommand(slot: number, tile: Tile): Command {
    return { type: 'belt', faction: this.playerFaction, slot, lane: tile.lane, col: tile.col };
  }

  /** A belt card left `slot` (played): the later ones move down; a picked card follows its slot. */
  private beltLeft(slot: number): void {
    this.beltIds.splice(slot, 1);
    const picked = this.levelHud.beltSlot.peek();
    if (picked === null) return;
    if (picked === slot) {
      this.levelHud.beltSlot.value = null;
      this.hud.selected.value = null;
    } else if (picked > slot) {
      this.levelHud.beltSlot.value = picked - 1;
    }
  }

  /** A scripted unit came on: one of a big wave (its first 3 s from a flag tick) is cued at its lane. */
  private cueWave(index: number, lane: number): void {
    const play = this.play;
    const entry = play?.config.script[index];
    if (entry === undefined) return;
    if (!this.bigRuns.some((r) => entry.tick >= r.from && entry.tick <= r.to)) return;
    this.incomingN += 1;
    this.levelHud.incoming.value = { lane, side: entry.faction, n: this.incomingN };
  }

  private over(): boolean {
    return this.hud.result.peek() !== null || this.match.state.winner !== null;
  }

  private deny(reason: CommandRejection): CommandRejection {
    this.hud.denied.value += 1;
    return reason;
  }

  /**
   * The tile and the player's own unit under the pointer, if any. A `unitId` counts only when it
   * is the player's own unit on the tile's lane (a zombie walking over a plant does not); a unit
   * alone gives its own tile. For plants the tile decides: a plant hit by the tap ray but standing
   * on a neighbouring tile (a tap near a tile's edge, where a tall model leans over) is ignored,
   * and the plant standing on the tapped tile, if any, is used, so a bare tap on a tile works by
   * touch. Zombies are not tied to tiles and stack: a named zombie of the card's type (`card`)
   * wins; otherwise the player's own zombie of that type, below the top level, standing nearest
   * the tapped tile's middle within `ZOMBIE_MERGE_REACH` along the lane, so a tap on the grass
   * by a small walking zombie merges into it; otherwise the named zombie, if any.
   */
  private resolveTile(tile: Tile | null, unitId: number | null, card: UnitKey | null): { tile: Tile; unit: Unit | null } | null {
    const named = unitId === null ? undefined : this.match.state.units.find((u) => u.id === unitId && isStanding(u));
    const own = named !== undefined && named.faction === this.playerFaction && (tile === null || named.lane === tile.lane)
      ? named : undefined;
    if (tile === null) return own === undefined ? null : { tile: { lane: own.lane, col: Math.floor(own.x) }, unit: own };
    if (this.playerFaction === 'plants') return { tile, unit: this.plantAt(tile) ?? null };
    // A named zombie of the card's type at the top level cannot take the card: a nearby one may, or a new one goes.
    const full = own !== undefined && own.key === card && own.level >= MAX_LEVEL;
    if (own !== undefined && own.key === card && !full) return { tile, unit: own };
    return { tile, unit: (card === null ? undefined : this.zombieNear(tile, card)) ?? (full ? undefined : own) ?? null };
  }

  /** The player's own standing zombie of type `key` below the top level nearest the tile's middle, within reach. */
  private zombieNear(tile: Tile, key: UnitKey): Unit | undefined {
    const middle = tile.col + 0.5;
    let best: Unit | undefined;
    let bestD = ZOMBIE_MERGE_REACH;
    for (const u of this.match.state.units) {
      if (u.faction !== 'zombies' || u.key !== key || u.lane !== tile.lane || u.level >= MAX_LEVEL || !isStanding(u)) continue;
      const d = Math.abs(u.x - middle);
      if (d <= bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private plantAt(tile: Tile): Unit | undefined {
    return this.match.state.units.find(
      (u) => u.faction === 'plants' && u.lane === tile.lane && Math.floor(u.x) === tile.col && isStanding(u),
    );
  }

  private commandFor(unit: UnitKey, tile: Tile, under: Unit | null): Command {
    if (!isCard(unit)) throw new Error(`"${unit}" is not a card`); // select() only ever keeps a card
    const faction = this.playerFaction;
    if (under !== null && under.faction === faction && under.key === unit) {
      return { type: 'merge', faction, unit, targetId: under.id };
    }
    return { type: 'place', faction, unit, lane: tile.lane, col: tile.col };
  }

  private buildClickCommand(
    target: { tile: Tile; unit: Unit | null } | null,
  ): Command | 'no-selection' | 'no-tile' | 'no-target' {
    const faction = this.playerFaction;
    if (this.hud.shovel.peek()) {
      const u = target?.unit;
      if (u === null || u === undefined) return 'no-target';
      return { type: 'remove', faction, targetId: u.id };
    }
    const unit = this.hud.selected.peek();
    if (unit === null) return 'no-selection';
    if (target === null) return 'no-tile';
    return this.commandFor(unit, target.tile, target.unit);
  }

  /** Copies match state into the signals, writing each only when its value changed. */
  private refresh(): void {
    const s = this.match.state;
    const me = s.players[this.playerFaction];
    const set = <T>(sig: Signal<T>, v: T): void => { if (sig.peek() !== v) sig.value = v; };
    set(this.hud.energy, me.energy);
    set(this.hud.seconds, Math.floor(s.tick / TICKS_PER_SECOND));
    set(this.hud.suddenDeath, s.suddenDeath);

    const hp = (f: Faction): BaseVM => ({ hp: Math.max(0, s.baseHp[f]), max: s.baseMaxHp[f] });
    const base = { plants: hp('plants'), zombies: hp('zombies') };
    const old = this.hud.base.peek();
    const changed = (f: Faction): boolean => old[f].hp !== base[f].hp || old[f].max !== base[f].max;
    if (changed('plants') || changed('zombies')) this.hud.base.value = base;

    const cards: CardVM[] = s.config.cards[this.playerFaction].map((unit, i) => {
      const full = seconds(statsFor(this.match.balance, unit).recharge);
      const left = me.recharge[unit] ?? 0;
      return {
        unit, name: UNIT_INFO[unit].name, price: UNIT_INFO[unit].price, hotkey: HOTKEYS[i] ?? '',
        affordable: me.energy >= UNIT_INFO[unit].price,
        rechargeFraction: full > 0 ? stepUp(left / full) : 0,
      };
    });
    if (!sameCards(this.hud.cards.peek(), cards)) this.hud.cards.value = cards;

    const on = s.config.heroes[this.playerFaction];
    const left = me.heroTimer;
    const hero: HeroVM = {
      ready: on && left === 0,
      fraction: on ? stepDown(1 - left / this.heroPeriod) : 0,
    };
    const oldHero = this.hud.hero.peek();
    if (oldHero.ready !== hero.ready || oldHero.fraction !== hero.fraction) this.hud.hero.value = hero;

    const spells: SpellVM[] = me.spells.map(({ key, timer }) => {
      const stats = this.match.balance.spells[key];
      const period = seconds(this.castOnce.has(key) ? stats.cooldown : stats.firstReady);
      return { key, ready: timer === 0, fraction: period > 0 ? stepDown(1 - timer / period) : 1 };
    });
    const oldSpells = this.hud.spells.peek();
    const same = oldSpells.length === spells.length && oldSpells.every((o, i) => {
      const n = spells[i];
      return n !== undefined && o.key === n.key && o.ready === n.ready && o.fraction === n.fraction;
    });
    if (!same) this.hud.spells.value = spells;

    if (this.level?.belt === true) {
      const old = this.levelHud.belt.peek();
      const now = s.belt;
      let sameBelt = old.length === now.length;
      for (let i = 0; sameBelt && i < now.length; i++) sameBelt = old[i]!.card === now[i] && old[i]!.id === this.beltIds[i];
      if (!sameBelt) this.levelHud.belt.value = now.map((card, i) => ({ card, id: this.beltIds[i] ?? 0 }));
    }
  }
}
