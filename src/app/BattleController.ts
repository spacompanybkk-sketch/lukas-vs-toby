import { signal } from '@preact/signals';
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
import type { Command, CommandRejection, Faction, SimEvent, SpellKey, Unit, UnitKey } from '../sim/types';
import type { PlacementPreview } from '../render/battle/types';

/** `skill` is the difficulty the player picked (see `src/ai/difficulty.ts`). */
export interface BattleOptions { playerFaction: Faction; skill: Skill; seed: number }

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
  private readonly bot: Bot;
  private readonly opponent: Faction;
  /** The one player command accepted for the coming tick, if any. */
  private queued: Command | null = null;
  /** Ticks of the player's current hero charge: the first one until the hero is first used. */
  private heroPeriod: number;
  /** The spells the player has cast at least once: their charge is then the cooldown, not the first wait. */
  private readonly castOnce = new Set<SpellKey>();

  constructor(opts: BattleOptions, balance: Balance = BALANCE) {
    this.playerFaction = opts.playerFaction;
    this.opponent = opts.playerFaction === 'plants' ? 'zombies' : 'plants';
    // The difficulty sets the computer's skill and both sides' income: the very match the balance
    // checks measure for this side and difficulty.
    // Both sides are dealt all ten of their cards (ruling R52). The computer's strategy may know
    // only some of them; its random moves (`randomLegal`) play any card in its hand.
    const config = battleConfig(opts.seed, opts.playerFaction, opts.skill, balance);
    config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
    this.match = new Match(config, balance);
    const computerSkill = DIFFICULTY[opts.skill][opts.playerFaction].skill;
    this.bot = createBasicBot(
      this.opponent, computerSkill, (Math.imul(opts.seed, 2654435761) + 1) >>> 0,
      computerTable(opts.playerFaction, opts.skill),
    );
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
    }
    this.refresh();
    const winner = this.match.state.winner;
    if (winner !== null && this.hud.result.peek() === null) {
      this.hud.result.value = { winner, playerWon: winner === this.playerFaction };
    }
    return events;
  }

  select(unit: UnitKey | null): void {
    if (this.hud.paused.peek() || this.over()) return;
    if (unit !== null && !(isCard(unit) && this.match.state.config.cards[this.playerFaction].includes(unit))) return;
    this.hud.selected.value = unit;
    if (unit !== null) {
      this.hud.shovel.value = false;
      this.clearPowers();
    }
  }

  toggleShovel(): void {
    if (this.hud.paused.peek() || this.over()) return;
    if (this.playerFaction !== 'plants') return;
    const on = !this.hud.shovel.peek();
    this.hud.shovel.value = on;
    if (on) {
      this.hud.selected.value = null;
      this.clearPowers();
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
      this.hud.heroSelected.value = false;
      return;
    }
    const reason = this.match.check({ type: 'hero', faction: this.playerFaction, lane: 0 });
    if (reason !== null) {
      this.deny(reason);
      return;
    }
    this.hud.selected.value = null;
    this.hud.shovel.value = false;
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
      this.hud.spellSelected.value = null;
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
      this.hud.selected.value = null;
      this.hud.shovel.value = false;
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
    // Cast: nothing is waiting to be aimed any more.
    this.clearPowers();
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
    if ((me.recharge[unit] ?? 0) > 0 || me.energy < priceOf(unit)) return null;
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
    this.clearPowers();
    return null;
  }

  hotkey(key: string): void {
    if (key === ' ') {
      if (!this.over()) this.setPaused(!this.hud.paused.peek());
      return;
    }
    if (this.hud.paused.peek() || this.over()) return;
    if (key === 'Escape') {
      this.hud.selected.value = null;
      this.hud.shovel.value = false;
      this.clearPowers();
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
    this.hud.spellSelected.value = null;
    return null;
  }

  private clearPowers(): void {
    this.hud.heroSelected.value = false;
    this.hud.spellSelected.value = null;
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
        rechargeFraction: full > 0 ? Math.min(1, Math.max(0, left / full)) : 0,
      };
    });
    if (!sameCards(this.hud.cards.peek(), cards)) this.hud.cards.value = cards;

    const on = s.config.heroes[this.playerFaction];
    const left = me.heroTimer;
    const hero: HeroVM = {
      ready: on && left === 0,
      fraction: on ? Math.min(1, Math.max(0, 1 - left / this.heroPeriod)) : 0,
    };
    const oldHero = this.hud.hero.peek();
    if (oldHero.ready !== hero.ready || oldHero.fraction !== hero.fraction) this.hud.hero.value = hero;

    const spells: SpellVM[] = me.spells.map(({ key, timer }) => {
      const stats = this.match.balance.spells[key];
      const period = seconds(this.castOnce.has(key) ? stats.cooldown : stats.firstReady);
      return { key, ready: timer === 0, fraction: period > 0 ? Math.min(1, Math.max(0, 1 - timer / period)) : 1 };
    });
    const oldSpells = this.hud.spells.peek();
    const same = oldSpells.length === spells.length && oldSpells.every((o, i) => {
      const n = spells[i];
      return n !== undefined && o.key === n.key && o.ready === n.ready && o.fraction === n.fraction;
    });
    if (!same) this.hud.spells.value = spells;
  }
}
