/**
 * Spells (spec 21): five a side, `config.spells[side]` of them dealt at match creation from the
 * state rng. Each is cast once, costs nothing, and is ready again `cooldown` seconds later; its
 * timer counts down in `tickEconomy` (which says `spellReady` on the step it reaches 0).
 *
 * Damage from a spell ignores armor and shields and goes through `damageUnit`, so a unit it brings
 * to 0 is removed by `resolveDeaths` like any other (cause `'damage'`, bounty paid).
 */

import { seconds } from '../data/balance';
import type { Balance, SpellStats } from '../data/balance';
import { damageUnit } from './damage';
import { isStanding } from './lookup';
import { randomInt } from './rng';
import { spawnMinion, spawnUnit } from './spawn';
import { applyStatus } from './status';
import { COLS, LANES, PLANT_COLS, ZOMBIE_SPAWN_X } from './types';
import type {
  Command, CommandRejection, Faction, PlayerState, SimEvent, SimState, SpellKey, SpellSize, StatusKind, Unit,
} from './types';

/** Each side's five spells, in the table order of spec 21. */
export const SPELLS: Record<Faction, SpellKey[]> = {
  plants: ['thunderbolt', 'vines', 'sunShower', 'healingRain', 'rockWall'],
  zombies: ['meteor', 'fog', 'brainFeast', 'frenzy', 'graveRise'],
};

export type SpellCommand = Extract<Command, { type: 'spell' }>;

/** Where an energy spell's `energyGained` is reported: the middle lane, at the side's own base edge. */
const SPELL_ENERGY_LANE = 2;

/** A tile of the lawn. */
export interface SpellTile { lane: number; col: number }

/**
 * Deals each side its spells, plants first: `config.spells[side]` distinct ones (at most five),
 * each drawn with `randomInt` from those of its five not yet drawn, in table order; each starts at
 * `seconds(firstReady)`. A side dealt none draws nothing.
 */
export function dealSpells(s: SimState, b: Balance): void {
  for (const side of ['plants', 'zombies'] as const) {
    const pool = [...SPELLS[side]];
    const dealt: PlayerState['spells'] = [];
    const n = Math.min(pool.length, Math.max(0, Math.floor(s.config.spells[side])));
    for (let i = 0; i < n; i++) {
      const key = pool.splice(randomInt(s, pool.length), 1)[0] as SpellKey;
      dealt.push({ key, timer: seconds(b.spells[key].firstReady) });
    }
    s.players[side].spells = dealt;
  }
}

/**
 * The tiles a spell of `faction` with area `size` covers when tapped at (`lane`, `col`): none for
 * 0; the tile for 1; for 2 the tile, the next column towards the enemy and the next lane down,
 * moved back onto the lawn at an edge so it is always four tiles; for 3 the 3×3 centred on the
 * tile, clipped at the edges.
 */
export function spellArea(faction: Faction, size: SpellSize, lane: number, col: number): SpellTile[] {
  if (size === 0) return [];
  if (size === 1) return [{ lane, col }];
  const out: SpellTile[] = [];
  if (size === 2) {
    const lane0 = Math.min(lane, LANES - 2);
    const col0 = faction === 'plants' ? Math.min(col, COLS - 2) : Math.max(col, 1) - 1;
    for (let l = lane0; l <= lane0 + 1; l++) for (let c = col0; c <= col0 + 1; c++) out.push({ lane: l, col: c });
    return out;
  }
  for (let l = Math.max(0, lane - 1); l <= Math.min(LANES - 1, lane + 1); l++) {
    for (let c = Math.max(0, col - 1); c <= Math.min(COLS - 1, col + 1); c++) out.push({ lane: l, col: c });
  }
  return out;
}

/**
 * Why a spell command would be refused, or null: `spells-off` (the setup deals this side none),
 * `spell-not-dealt`, then for an aimed spell (size above 0) `bad-lane`, `bad-column` (Rock Wall:
 * plant columns only; any spell with `minCol`: not below it) and, for Rock Wall, `occupied`; then
 * `spell-charging`. An un-aimed spell's
 * lane and column are not looked at.
 */
export function checkSpell(s: SimState, b: Balance, cmd: SpellCommand): CommandRejection | null {
  if (!(s.config.spells[cmd.faction] > 0)) return 'spells-off';
  const slot = s.players[cmd.faction].spells.find((x) => x.key === cmd.spell);
  if (slot === undefined) return 'spell-not-dealt';
  if (b.spells[cmd.spell].size > 0) {
    if (!isWholeBetween(cmd.lane, 0, LANES - 1)) return 'bad-lane';
    const lastCol = cmd.spell === 'rockWall' ? PLANT_COLS - 1 : COLS - 1;
    if (!isWholeBetween(cmd.col, b.spells[cmd.spell].minCol ?? 0, lastCol)) return 'bad-column';
    if (cmd.spell === 'rockWall' && plantOn(s, cmd.lane, cmd.col)) return 'occupied';
  }
  if (slot.timer > 0) return 'spell-charging';
  return null;
}

/** Carries out a spell command that `checkSpell` has passed: `spellCast`, then what the spell does. */
export function castSpell(s: SimState, b: Balance, cmd: SpellCommand, events: SimEvent[]): void {
  const stats = b.spells[cmd.spell];
  const slot = s.players[cmd.faction].spells.find((x) => x.key === cmd.spell);
  if (slot === undefined) throw new Error(`spell ${cmd.spell} passed check but is not dealt`);
  slot.timer = seconds(stats.cooldown);
  events.push({ type: 'spellCast', faction: cmd.faction, spell: cmd.spell, lane: cmd.lane, col: cmd.col, size: stats.size });
  const enemies = (): Unit[] => inArea(s, cmd, stats, (u) => u.faction !== cmd.faction);
  const friends = (): Unit[] => inArea(s, cmd, stats, (u) => u.faction === cmd.faction);
  switch (cmd.spell) {
    case 'thunderbolt':
    case 'meteor':
      for (const u of enemies()) damageUnit(s, b, u, need(stats.damage, cmd.spell), events, true);
      break;
    case 'vines':
      putOn(s, enemies(), 'tied', stats, cmd.spell, events);
      break;
    case 'fog':
      putOn(s, enemies(), 'blind', stats, cmd.spell, events);
      break;
    case 'frenzy':
      putOn(s, friends(), 'haste', stats, cmd.spell, events);
      break;
    case 'sunShower':
    case 'brainFeast': {
      const amount = need(stats.amount, cmd.spell);
      s.players[cmd.faction].energy += amount;
      events.push({
        type: 'energyGained', faction: cmd.faction, amount, source: 'spell', unitId: null,
        lane: SPELL_ENERGY_LANE, x: cmd.faction === 'plants' ? 0 : ZOMBIE_SPAWN_X,
      });
      break;
    }
    case 'healingRain':
      for (const u of friends()) {
        if (u.key === 'rock') continue; // a rock is no plant: it does not grow back
        const gain = Math.min(need(stats.amount, cmd.spell), u.maxHp - u.hp);
        if (gain <= 0) continue;
        u.hp += gain;
        events.push({ type: 'unitHealed', unitId: u.id, amount: gain, hp: u.hp });
      }
      break;
    case 'rockWall': {
      const rock = spawnUnit(s, b, 'rock', cmd.lane, cmd.col + 0.5);
      rock.hp = rock.maxHp = need(stats.hp, cmd.spell);
      rock.expires = seconds(need(stats.seconds, cmd.spell));
      events.push({ type: 'unitSpawned', unitId: rock.id, key: rock.key, faction: rock.faction, lane: rock.lane, x: rock.x });
      break;
    }
    case 'graveRise':
      for (let i = 0; i < need(stats.count, cmd.spell); i++) spawnMinion(s, b, cmd.lane, cmd.col + 0.5, 1, null, events);
      break;
    default: {
      const unhandled: never = cmd.spell;
      throw new Error(`Unhandled spell ${String(unhandled)}`);
    }
  }
}

/** The standing units `which` picks whose lane and `floor(x)` are in the spell's area, in ascending id. */
function inArea(s: SimState, cmd: SpellCommand, stats: SpellStats, which: (u: Unit) => boolean): Unit[] {
  const tiles = spellArea(cmd.faction, stats.size, cmd.lane, cmd.col);
  return s.units.filter((u) => isStanding(u) && which(u)
    && tiles.some((t) => t.lane === u.lane && t.col === Math.floor(u.x)));
}

function putOn(s: SimState, units: Unit[], kind: StatusKind, stats: SpellStats, spell: SpellKey, events: SimEvent[]): void {
  const ticks = seconds(need(stats.seconds, spell));
  for (const u of units) applyStatus(s, u, kind, ticks, 0, null, events);
}

/** Whether a standing plant (a rock included) is on the tile; one already down does not count. */
function plantOn(s: SimState, lane: number, col: number): boolean {
  return s.units.some((u) => u.faction === 'plants' && isStanding(u) && u.lane === lane && Math.floor(u.x) === col);
}

/** A number the spell's row must have; a row without it is an error in the table, never a silent zero. */
function need(v: number | undefined, spell: SpellKey): number {
  if (v === undefined) throw new Error(`The balance table's ${spell} spell is missing a number`);
  return v;
}

function isWholeBetween(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}
