import type { Skill } from '../ai/bot';
import type { BossKey, CardKey, Faction, UnitKey } from '../sim/types';


/**
 * One step of a level's tutorial: what the glove points at, and the player's own action that ends
 * the step. Task 6 gives it its behaviour.
 */
export type TutorialStep = {
  show: 'card' | 'tile' | 'unit' | 'hero' | 'spell';
  target: string;
  until: 'selected' | 'placed' | 'merged' | 'fired';
};

export type LevelKind = 'battle' | 'survive' | 'breakthrough' | 'conveyor' | 'boss';

/** A unit arriving (`waves`) or standing at the start (`prepared`). `at` = seconds; `col` only for plants. */
export interface Spawn { at: number; unit: UnitKey; lane: number; level?: number; col?: number }

/** One Adventure level: data only (spec 8). Its id is `<p|z><world>-<n>`. */
export interface LevelDef {
  id: string; side: Faction; world: 1 | 2 | 3 | 4 | 5; n: number; kind: LevelKind;
  /** What the player may hold in this level (before unlock filtering). */
  cards: CardKey[];
  /** A computer player, or null when the level is scripted only. */
  opponent: { skill: Skill; cards: CardKey[]; incomeScale: number } | null;
  /** Scripted enemy arrivals (survive, conveyor, boss adds; may be empty). */
  waves: Spawn[];
  /** Units standing at the start (the garden to break through; a head start). */
  prepared: Spawn[];
  /** The clock for survive / breakthrough; null otherwise. */
  seconds: number | null;
  /** Conveyor only. */
  belt: { everySeconds: number; cards: CardKey[] } | null;
  boss: { key: BossKey; lane: number } | null;
  /** The player's start energy; null = the balance default. */
  startEnergy: number | null;
  spells: boolean; unlocks: CardKey | null; teaches: TutorialStep[] | null;
}
