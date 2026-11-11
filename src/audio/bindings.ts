/**
 * Simulation events to sounds, and how heated the battle is for the music.
 * The engine's repeat limits keep a burst of identical events from stacking up.
 */
import type { AudioEngine, PlayOptions } from './AudioEngine';
import type { Faction, SimEvent, SimState } from '../sim/types';

/** The lawn runs from x 0 (the plant base, left) to x 10 (the zombie base, right). */
const LAWN_WIDTH = 10;
/** Pan at the lawn's edges: wide enough to place a sound, never hard in one ear. */
const EDGE_PAN = 0.6;
/** Units on the field at which the unit share of the intensity is full. */
const FULL_FIELD = 24;

/** x 0..10 → pan −0.6..+0.6 (clamped); anything that is not a number is centred. */
export function panFor(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const t = Math.min(1, Math.max(0, x / LAWN_WIDTH));
  return (t * 2 - 1) * EDGE_PAN;
}

/** A merge into level 2 plays at its written pitch, each level above a whole tone higher. */
function mergePitch(level: number): number {
  const steps = Math.min(5, Math.max(2, Number.isFinite(level) ? level : 2)) - 2;
  return Math.pow(2, (2 * steps) / 12);
}

/**
 * Plays the sounds for one step's (or one frame's) events. Income and refusals are only heard for
 * `playerFaction`; everything on the lawn is heard for both sides.
 */
export function playEventSounds(audio: AudioEngine, events: readonly SimEvent[], playerFaction: Faction): void {
  const at = (x: number): PlayOptions => ({ pan: panFor(x) });
  for (const e of events) {
    switch (e.type) {
      case 'unitSpawned':
        audio.play(e.faction === 'plants' ? 'place' : 'spawnZombie', at(e.x));
        break;
      case 'projectileSpawned':
        audio.play(e.kind === 'pea' ? 'pea' : 'brainThrow', at(e.x));
        break;
      case 'projectileHit':
        audio.play(e.blocked ? 'block' : 'hit', at(e.x));
        break;
      case 'unitAttacked':
        if (e.attack === 'melee') audio.play('chomp'); // the event says who, not where: centred
        break;
      case 'unitDied':
        if (e.cause === 'shovel') audio.play('click', at(e.x)); // other deaths are carried by the picture
        break;
      case 'explosion':
        audio.play('explode', at(e.x));
        break;
      case 'baseDamaged':
        // a hit in a lane is heard at that base. Sudden death drains both bases every step: centred
        // and at half volume, since it repeats for as long as sudden death lasts. The engine plays
        // baseHit at most once per 0.25 s.
        audio.play('baseHit', e.lane === null ? { volume: 0.5 } : at(e.faction === 'plants' ? 0 : LAWN_WIDTH));
        break;
      case 'baseStruck':
        audio.play('baseStrike', at(0));
        break;
      case 'energyGained':
        if (e.faction === playerFaction) audio.play(e.source === 'sunflower' ? 'sun' : 'bounty', at(e.x));
        break;
      case 'unitMerged':
        audio.play('merge', { pitch: mergePitch(e.level) });
        break;
      case 'suddenDeath':
        audio.play('suddenDeath', { pitch: 1 }); // in tune with the music underneath
        break;
      case 'commandRejected':
        if (e.command.faction === playerFaction) audio.play('deny');
        break;
      case 'unitDamaged':
      case 'matchEnded': // the app plays win or lose
        break;
      default: {
        const unhandled: never = e;
        void unhandled;
      }
    }
  }
}

function share(hp: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(hp)) return 0; // a broken number counts as fallen, as in the sim
  return Math.min(1, Math.max(0, hp / max));
}

/** 0..1: `min(1, units / 24) × 0.6 + (1 − lowerBaseFraction) × 0.4`. */
export function battleIntensity(state: SimState): number {
  const units = Math.min(1, state.units.length / FULL_FIELD);
  const lower = Math.min(share(state.baseHp.plants, state.baseMaxHp.plants), share(state.baseHp.zombies, state.baseMaxHp.zombies));
  const v = units * 0.6 + (1 - lower) * 0.4;
  return Math.min(1, Math.max(0, v));
}
