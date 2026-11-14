import type { Skill } from '../ai/bot';
import type { BossKey, CardKey, Faction, UnitKey } from '../sim/types';


/**
 * One step of a level's tutorial (Task 6): what the glove points at, and the player's own action
 * that ends the step. `id` is remembered in the save (`teached`) once the step is done.
 *
 * - `card` … `selected`: the card in the tray (or on the belt) is tapped.
 * - `tile` … `placed`: `card` is put on the tile (`lane`, `col`; zombies go by lane only). While
 *   `card` is not picked, the glove points at the card first.
 * - `unit` … `merged`: `card` is merged into the player's first standing unit of its type (the one
 *   with the level-up arrow). While `card` is not picked, the glove points at the card first.
 * - `hero` … `fired`: the hero button, then a lane.
 * - `spell` … `fired`: the spell button `index` (deal order), then a tile for an aimed spell.
 * - `belt` … `selected`: a conveyor level's belt brings cards at random, so no card is named: the
 *   glove points at the card at the front of the belt, and picking any belt card ends the step.
 * - `belt-tile` … `placed`: the picked belt card is put on the tile (zombies: the lane). While no
 *   belt card is picked, the glove points at the front one first.
 * - `twist` … `tapped`: the match holds while the camera shows the level's twist (fog, ice); any
 *   tap ends the step. No glove points at anything (neither twist refuses a tap).
 *
 * `after`: the step waits (no glove, nothing held) until the hero, or the spell it points at, is
 * first ready. Steps run in order.
 */
export type TutorialStep = { id: string; after?: 'hero' | 'spell' } & (
  | { show: 'card'; card: CardKey; until: 'selected' }
  | { show: 'tile'; card: CardKey; lane: number; col: number; until: 'placed' }
  | { show: 'unit'; card: CardKey; until: 'merged' }
  | { show: 'hero'; until: 'fired' }
  | { show: 'spell'; index: number; until: 'fired' }
  | { show: 'belt'; until: 'selected' }
  | { show: 'belt-tile'; lane: number; col: number; until: 'placed' }
  | { show: 'twist'; until: 'tapped' }
);

export type LevelKind = 'battle' | 'survive' | 'breakthrough' | 'conveyor' | 'boss';

/** A unit arriving (`waves`) or standing at the start (`prepared`). `at` = seconds; `col` only for plants. */
export interface Spawn { at: number; unit: UnitKey; lane: number; level?: number; col?: number }

/**
 * Which tiles of a level's lawn carry its world's twist; the numbers come from `Balance.twists`.
 * `iceLanes` are lane indices. `fog` is on (`true`: `Balance.twists.fog.reach` tiles), a number
 * (that level's own reach, tiles) or absent. The two tile lists count differently:
 * - `rocks` index the plant tiles, `lane * PLANT_COLS + col` (8 plant columns: rock 13 = lane 1, col 5);
 * - `lavaTiles` index the whole lawn, `lane * COLS + col` (10 columns: lava 13 = lane 1, col 3).
 */
export interface LevelTwist { rocks?: number[]; fog?: true | number; iceLanes?: number[]; lavaTiles?: number[] }

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
  /** The lawn's twist for this level; left out = none. */
  twist?: LevelTwist;
  /**
   * The bases' health where the level wants other than the balance's (a short tutorial battle, a
   * small garden). Left out (or a side left out) = the balance default.
   */
  baseHp?: Partial<Record<Faction, number>>;
  /** The player's start energy; null = the balance default. */
  startEnergy: number | null;
  spells: boolean; unlocks: CardKey | null; teaches: TutorialStep[] | null;
}
