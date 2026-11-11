import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { createBasicBot } from '../ai/basicBot';
import type { Bot, Skill } from '../ai/bot';
import { BALANCE, seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { UNIT_INFO } from '../data/units';
import { Match, defaultConfig } from '../sim/match';
import { isStanding, statsFor } from '../sim/lookup';
import { TICKS_PER_SECOND } from '../sim/types';
import type { Command, CommandRejection, Faction, SimEvent, Unit, UnitKey } from '../sim/types';
import type { PlacementPreview } from '../render/battle/types';

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
}

type Tile = { lane: number; col: number };

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

  constructor(opts: BattleOptions, balance: Balance = BALANCE) {
    this.playerFaction = opts.playerFaction;
    this.opponent = opts.playerFaction === 'plants' ? 'zombies' : 'plants';
    this.match = new Match(defaultConfig(opts.seed, balance), balance);
    this.bot = createBasicBot(this.opponent, opts.skill, (Math.imul(opts.seed, 2654435761) + 1) >>> 0);
    this.hud = {
      energy: signal(0), cards: signal<CardVM[]>([]),
      base: signal({ plants: { hp: 0, max: 0 }, zombies: { hp: 0, max: 0 } }),
      seconds: signal(0), suddenDeath: signal(false), paused: signal(false),
      selected: signal<UnitKey | null>(null), shovel: signal(false),
      result: signal<BattleResult>(null), denied: signal(0),
    };
    this.refresh();
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
    this.refresh();
    const winner = this.match.state.winner;
    if (winner !== null && this.hud.result.peek() === null) {
      this.hud.result.value = { winner, playerWon: winner === this.playerFaction };
    }
    return events;
  }

  select(unit: UnitKey | null): void {
    if (this.hud.paused.peek() || this.over()) return;
    if (unit !== null && !this.match.state.config.cards[this.playerFaction].includes(unit)) return;
    this.hud.selected.value = unit;
    if (unit !== null) this.hud.shovel.value = false;
  }

  toggleShovel(): void {
    if (this.hud.paused.peek() || this.over()) return;
    if (this.playerFaction !== 'plants') return;
    const on = !this.hud.shovel.peek();
    this.hud.shovel.value = on;
    if (on) this.hud.selected.value = null;
  }

  hover(tile: Tile | null, unitId: number | null): PlacementPreview | null {
    const unit = this.hud.selected.peek();
    if (unit === null) return null;
    const target = this.resolveTile(tile, unitId);
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
    const target = this.resolveTile(tile, unitId);
    const cmd = this.buildClickCommand(target);
    if (cmd === 'no-selection') return this.deny('not-in-hand');
    if (cmd === 'no-tile') return this.deny('bad-lane');
    if (cmd === 'no-target') return this.deny('no-target');
    const reason = this.match.check(cmd);
    if (reason !== null) return this.deny(reason);
    this.queued = cmd;
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
      return;
    }
    const index = HOTKEYS.indexOf(key);
    const card = index < 0 ? undefined : this.match.state.config.cards[this.playerFaction][index];
    if (card !== undefined) this.select(card);
  }

  setPaused(paused: boolean): void {
    this.hud.paused.value = paused;
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
   * alone gives its own tile. Otherwise a plants player's own plant standing on the tile is used,
   * so a bare tap on a tile works by touch. Zombies stack, so they are found only by `unitId`.
   */
  private resolveTile(tile: Tile | null, unitId: number | null): { tile: Tile; unit: Unit | null } | null {
    const named = unitId === null ? undefined : this.match.state.units.find((u) => u.id === unitId && isStanding(u));
    const own = named !== undefined && named.faction === this.playerFaction && (tile === null || named.lane === tile.lane)
      ? named : undefined;
    if (tile === null) return own === undefined ? null : { tile: { lane: own.lane, col: Math.floor(own.x) }, unit: own };
    if (own !== undefined) return { tile, unit: own };
    return { tile, unit: this.playerFaction === 'plants' ? this.plantAt(tile) ?? null : null };
  }

  private plantAt(tile: Tile): Unit | undefined {
    return this.match.state.units.find(
      (u) => u.faction === 'plants' && u.lane === tile.lane && Math.floor(u.x) === tile.col && isStanding(u),
    );
  }

  private commandFor(unit: UnitKey, tile: Tile, under: Unit | null): Command {
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
  }
}
