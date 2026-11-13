import { opponentOf } from '../ai/difficulty';
import { BALANCE, seconds } from '../data/balance';
import type { Balance } from '../data/balance';
import { ALL_CARDS, factionOf } from '../data/units';
import type { Save } from '../progress/save';
import { defaultConfig } from '../sim/match';
import { ZOMBIE_SPAWN_X } from '../sim/types';
import type { CardKey, Faction, MatchConfig, PreparedUnit } from '../sim/types';
import { ADVENTURE } from './rewards';
import type { LevelDef, Spawn } from './types';

/** The cards `side` holds in Adventure: its first three, and those it has unlocked, in unlock order. */
export function unlockedCards(save: Save, side: Faction): CardKey[] {
  const unlocked = save[side].unlocked;
  return ALL_CARDS[side].filter((k, i) => i < ADVENTURE.firstCards || unlocked.includes(k));
}

/** `side`'s levels in campaign order (world, then number), whatever order the list is in. */
function chain(side: Faction, levels: readonly LevelDef[]): LevelDef[] {
  return levels.filter((l) => l.side === side).sort((a, b) => a.world - b.world || a.n - b.n);
}

const starsOf = (save: Save, def: LevelDef): number => save[def.side].stars[def.id] ?? 0;

/** A level is open when it is its side's first, or the one before it has at least one star. */
export function isOpen(save: Save, def: LevelDef, levels: readonly LevelDef[]): boolean {
  const order = chain(def.side, levels);
  const i = order.findIndex((l) => l.id === def.id);
  if (i < 0) return false;
  return i === 0 || starsOf(save, order[i - 1]!) >= 1;
}

/** The first of `side`'s levels without a star, or null when every one has one. */
export function nextLevel(save: Save, side: Faction, levels: readonly LevelDef[]): LevelDef | null {
  return chain(side, levels).find((l) => starsOf(save, l) === 0) ?? null;
}

/** Where a spawn stands: a plant in the middle of its tile, a zombie at the zombie edge. */
function spawnX(s: Spawn, faction: Faction): number {
  if (faction === 'zombies') return ZOMBIE_SPAWN_X;
  if (s.col === undefined) throw new RangeError(`a ${s.unit} spawn in lane ${s.lane} needs a column`);
  return s.col + 0.5;
}

/**
 * The match for `def` played by the owner of `save`: the level's cards that the player has
 * unlocked, the level's opponent (or none), the player's Marketplace upgrades on the player's side
 * only, and the player's Adventure difficulty on the player's income only (Easy ×1.25, Normal ×1,
 * Hard ×0.75). Heroes are always on; two spells a side only when the level deals them.
 */
export function levelConfig(
  def: LevelDef, save: Save, seed: number, b: Balance = BALANCE,
): MatchConfig {
  const player = def.side;
  const enemy = opponentOf(player);
  const base = defaultConfig(seed, b);
  const held = unlockedCards(save, player);

  const upgrades: Partial<Record<CardKey, number>> = {};
  for (const key of ALL_CARDS[player]) {
    const level = save.upgrades[key];
    if (level !== undefined) upgrades[key] = level;
  }

  const spawn = (s: Spawn): PreparedUnit => {
    const faction = factionOf(s.unit);
    return { unit: s.unit, faction, lane: s.lane, x: spawnX(s, faction), level: s.level ?? 1 };
  };
  const script = def.waves
    .map((w) => ({ tick: seconds(w.at), ...spawn(w) }))
    .sort((a, b2) => a.tick - b2.tick); // stable: arrivals on the same tick keep the level's order

  const startEnergy = { ...base.startEnergy };
  if (def.startEnergy !== null) startEnergy[player] = def.startEnergy;

  const level: Pick<MatchConfig, 'mode' | 'script' | 'prepared' | 'goalTicks' | 'belt' | 'noEnergy' | 'invulnerableBase' | 'boss'> = {
    mode: def.kind,
    script,
    prepared: def.prepared.map(spawn),
    goalTicks: def.seconds === null ? null : seconds(def.seconds),
    belt: def.belt === null
      ? null
      : { side: player, everyTicks: seconds(def.belt.everySeconds), cards: [...def.belt.cards], slots: ADVENTURE.beltSlots },
    noEnergy: def.kind === 'conveyor',
    // A plant Survive or Conveyor: the zombie base cannot be hurt, the plants hold out. On the
    // zombies' side those kinds are races: the plant base can be hurt, the clock wins for the plants.
    invulnerableBase: player === 'plants' && (def.kind === 'survive' || def.kind === 'conveyor') ? 'zombies' : null,
    // The level's boss stands on its own side (the Titan with the zombies, the Oak with the plants);
    // the simulation's `checkLevel` wants one exactly in a boss level.
    boss: def.boss === null ? null : { key: def.boss.key, faction: factionOf(def.boss.key), lane: def.boss.lane },
  };

  return {
    ...base,
    startEnergy,
    baseHp: { ...base.baseHp, ...def.baseHp },
    cards: {
      [player]: def.cards.filter((k) => held.includes(k)),
      [enemy]: def.opponent === null ? [] : [...def.opponent.cards],
    } as Record<Faction, CardKey[]>,
    incomeMultiplier: {
      [player]: ADVENTURE.income[save.difficulty[player]],
      [enemy]: def.opponent === null ? 1 : def.opponent.incomeScale,
    } as Record<Faction, number>,
    suddenDeath: def.kind === 'battle' || def.kind === 'boss',
    heroes: { plants: true, zombies: true },
    spells: def.spells ? { ...base.spells } : { plants: 0, zombies: 0 },
    upgrades: { [player]: upgrades, [enemy]: {} } as Record<Faction, Partial<Record<CardKey, number>>>,
    ...level,
  };
}
