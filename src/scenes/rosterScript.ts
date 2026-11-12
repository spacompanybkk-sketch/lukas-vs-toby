import { ALL_CARDS } from '../data/units';
import { Match, defaultConfig } from '../sim/match';
import { SPELLS } from '../sim/spells';
import type { CardKey, Command, Faction, SimEvent, SpellKey } from '../sim/types';
import { TICKS_PER_SECOND } from '../sim/types';

// The roster demo's script (`?scene=roster-demo`): a match with both hands of ten cards and
// plenty of energy, where each side plays a fixed list of cards at fixed times, so that every
// unit and every ability shows within a minute. No DOM and no Three.js: a test runs it too.

/** One card played: at `seconds` into the match, on `lane`, at column `col` (zombies: any). */
export interface Cue { seconds: number; faction: Faction; unit: CardKey; lane: number; col: number }

/** Energy each side starts with: enough for the whole script, so nothing waits on income. */
const PLENTY = 100_000;

/**
 * Plants hold every lane from the start; zombies come in a lane at a time against what will
 * show them off: the Desert Zombie blinds the Kernel-pult (whose butter stuns it), the Skeleton
 * Warrior's shield meets Torchwood fire, a Brain Eater walks onto the armed Potato Mine, the
 * Cowboy ties the Pumpkin, the Necromancer holds behind the line, heals and raises minions,
 * Hot Topic eats the Sunflower and grows, the Trident pierces the wall, Brain Rot leaves a
 * puddle, and late on a Cherry Bomber clears the busiest lane.
 */
export const ROSTER_SCRIPT: readonly Cue[] = [
  // Plants: every lane at once.
  { seconds: 0, faction: 'plants', unit: 'peashooter', lane: 0, col: 1 },
  { seconds: 0, faction: 'plants', unit: 'torchwood', lane: 0, col: 3 },
  { seconds: 0, faction: 'plants', unit: 'sunflower', lane: 1, col: 0 },
  { seconds: 0, faction: 'plants', unit: 'kernelPult', lane: 1, col: 2 },
  { seconds: 0, faction: 'plants', unit: 'mangoPult', lane: 2, col: 1 },
  { seconds: 0, faction: 'plants', unit: 'avocadoBunker', lane: 2, col: 4 },
  { seconds: 0, faction: 'plants', unit: 'walnutBomb', lane: 3, col: 2 },
  { seconds: 0, faction: 'plants', unit: 'potatoMine', lane: 3, col: 6 },
  { seconds: 0, faction: 'plants', unit: 'pumpkinSquash', lane: 4, col: 4 },
  // Zombies, a lane at a time.
  { seconds: 1, faction: 'zombies', unit: 'skeletonWarrior', lane: 0, col: 9 },
  { seconds: 1, faction: 'zombies', unit: 'desertZombie', lane: 1, col: 9 },
  { seconds: 2, faction: 'zombies', unit: 'cowboyZombie', lane: 4, col: 9 },
  { seconds: 3, faction: 'zombies', unit: 'necromancer', lane: 2, col: 9 },
  { seconds: 6, faction: 'zombies', unit: 'brainEater', lane: 3, col: 9 },
  { seconds: 7, faction: 'zombies', unit: 'veryFastWalker', lane: 4, col: 9 },
  { seconds: 8, faction: 'zombies', unit: 'hotTopic', lane: 1, col: 9 },
  { seconds: 10, faction: 'zombies', unit: 'skeletonArcher', lane: 0, col: 9 },
  { seconds: 11, faction: 'zombies', unit: 'tridentZombie', lane: 3, col: 9 },
  { seconds: 12, faction: 'zombies', unit: 'brainRot', lane: 2, col: 9 },
  // Late: the Cherry Bomber where the zombies are thickest.
  { seconds: 24, faction: 'plants', unit: 'cherryBomber', lane: 2, col: 6 },
];

/** One move of the powers part: a card sent, a hero power, or a spell, at `seconds`. */
export type PowerCue =
  | { seconds: number; faction: Faction; kind: 'place'; unit: CardKey; lane: number; col: number }
  | { seconds: number; faction: Faction; kind: 'hero'; lane: number }
  | { seconds: number; faction: Faction; kind: 'spell'; spell: SpellKey; lane: number; col: number };

/**
 * The powers part (wiring B), after the roster has shown itself: fresh zombies come in, then
 * both heroes go and every one of the ten spells is cast, about one a second, each where it
 * shows: the Mega Mower down the busiest lane, Bone Storm through the Pumpkin's lane, Thunderbolt
 * and Vines on the walkers, the Rock Wall in front of a zombie that bites it until it crumbles,
 * Fog and Meteor on the plants, Frenzy on a pack, three minions out of the ground.
 */
export const POWERS_SCRIPT: readonly PowerCue[] = [
  // Fresh zombies (each card waits out its own recharge: Brain Eater 5 s, Very Fast Walker 3 s).
  { seconds: 25, faction: 'zombies', kind: 'place', unit: 'brainEater', lane: 2, col: 9 },
  { seconds: 26, faction: 'zombies', kind: 'place', unit: 'veryFastWalker', lane: 2, col: 9 },
  { seconds: 30, faction: 'zombies', kind: 'place', unit: 'brainEater', lane: 3, col: 9 },
  { seconds: 30.5, faction: 'zombies', kind: 'place', unit: 'veryFastWalker', lane: 1, col: 9 },
  { seconds: 32, faction: 'plants', kind: 'hero', lane: 2 },
  { seconds: 34, faction: 'zombies', kind: 'hero', lane: 4 },
  { seconds: 35, faction: 'plants', kind: 'spell', spell: 'rockWall', lane: 0, col: 6 },
  { seconds: 35.5, faction: 'zombies', kind: 'place', unit: 'brainEater', lane: 0, col: 9 },
  { seconds: 36, faction: 'zombies', kind: 'place', unit: 'veryFastWalker', lane: 0, col: 9 },
  { seconds: 37, faction: 'zombies', kind: 'spell', spell: 'frenzy', lane: 3, col: 8 },
  { seconds: 38, faction: 'plants', kind: 'spell', spell: 'sunShower', lane: 0, col: 0 },
  { seconds: 39, faction: 'zombies', kind: 'spell', spell: 'brainFeast', lane: 0, col: 0 },
  { seconds: 40, faction: 'plants', kind: 'spell', spell: 'vines', lane: 3, col: 6 },
  { seconds: 41, faction: 'zombies', kind: 'spell', spell: 'fog', lane: 0, col: 2 },
  { seconds: 41.5, faction: 'zombies', kind: 'place', unit: 'brainEater', lane: 4, col: 9 },
  { seconds: 42, faction: 'plants', kind: 'spell', spell: 'thunderbolt', lane: 3, col: 5 },
  { seconds: 43, faction: 'zombies', kind: 'spell', spell: 'meteor', lane: 1, col: 3 },
  { seconds: 44, faction: 'plants', kind: 'spell', spell: 'healingRain', lane: 1, col: 2 },
  { seconds: 45, faction: 'zombies', kind: 'spell', spell: 'graveRise', lane: 4, col: 7 },
];

/**
 * A match ready for the script: all ten cards each, plenty of energy, the given seed, and for
 * the powers part both heroes ready and all five spells of each side in hand, ready, so that
 * every one of the ten can be shown.
 */
export function rosterMatch(seed: number): Match {
  const config = defaultConfig(seed);
  config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
  config.startEnergy = { plants: PLENTY, zombies: PLENTY };
  config.suddenDeath = false;
  const match = new Match(config);
  for (const side of ['plants', 'zombies'] as const) {
    const player = match.state.players[side];
    player.heroTimer = 0;
    player.spells = SPELLS[side].map((key) => ({ key, timer: 0 }));
  }
  return match;
}

/** The script's commands due at `tick` (the roster, then its powers part), written into `out` (cleared first). */
export function rosterCommands(
  tick: number, out: Command[], script: readonly Cue[] = ROSTER_SCRIPT, powers: readonly PowerCue[] = POWERS_SCRIPT,
): Command[] {
  out.length = 0;
  for (let i = 0; i < script.length; i++) {
    const cue = script[i] as Cue;
    if (Math.round(cue.seconds * TICKS_PER_SECOND) !== tick) continue;
    out.push({ type: 'place', faction: cue.faction, unit: cue.unit, lane: cue.lane, col: cue.col });
  }
  for (let i = 0; i < powers.length; i++) {
    const cue = powers[i] as PowerCue;
    if (Math.round(cue.seconds * TICKS_PER_SECOND) !== tick) continue;
    if (cue.kind === 'place') out.push({ type: 'place', faction: cue.faction, unit: cue.unit, lane: cue.lane, col: cue.col });
    else if (cue.kind === 'hero') out.push({ type: 'hero', faction: cue.faction, lane: cue.lane });
    else out.push({ type: 'spell', faction: cue.faction, spell: cue.spell, lane: cue.lane, col: cue.col });
  }
  return out;
}

/** Steps a roster match once with the script's commands for its tick. */
export function stepRoster(match: Match, scratch: Command[]): SimEvent[] {
  return match.step(rosterCommands(match.state.tick, scratch));
}
