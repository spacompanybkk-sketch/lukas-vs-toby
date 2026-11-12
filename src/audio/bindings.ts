/**
 * Simulation events to sounds, and how heated the battle is for the music.
 * The engine's repeat limits keep a burst of identical events from stacking up.
 */
import type { AudioEngine, PlayOptions, SfxName } from './AudioEngine';
import type { Faction, ProjectileKind, SimEvent, SimState, UnitKey } from '../sim/types';
import { TICKS_PER_SECOND } from '../sim/types';

/** The lawn runs from x 0 (the plant base, left) to x 10 (the zombie base, right). */
const LAWN_WIDTH = 10;
/** Pan at the lawn's edges: wide enough to place a sound, never hard in one ear. */
const EDGE_PAN = 0.6;
/** Units on the field at which the unit share of the intensity is full. */
const FULL_FIELD = 24;

/** Each projectile kind's sound as it is fired. */
const SHOT_SOUND: Record<ProjectileKind, SfxName> = {
  pea: 'pea', brain: 'brainThrow', kernel: 'kernel', butter: 'butter', mango: 'mango',
  sand: 'sand', arrow: 'arrow', bullet: 'bullet', trident: 'trident', rot: 'rot',
};
/** Blasts with a sound of their own; any other is the Walnut Bomb's `explode`. */
const BLAST_SOUND: Partial<Record<UnitKey, SfxName>> = { potatoMine: 'mineBoom', cherryBomber: 'cherryBoom' };
/** A Torchwood setting a pea alight is a soft crackle, under the burn's own. */
const IGNITE_VOLUME = 0.5;
/** The once-a-second damage tick of poison and burn is quieter than their start. */
const DOT_TICK_VOLUME = 0.6;

/**
 * Poison and burn are heard at most once a second in total, whatever their source (a status
 * starting, a Torchwood igniting a pea, the damage ticks): a lawn of burning zombies would
 * otherwise crackle without pause. One per battle; it counts in match ticks.
 */
export class SoundGate {
  private lastDot = Number.NEGATIVE_INFINITY;

  /** True (and the second starts now) when a poison or burn sound may play at `tick`. */
  dot(tick: number): boolean {
    if (tick - this.lastDot < TICKS_PER_SECOND) return false;
    this.lastDot = tick;
    return true;
  }
}

/** What `playEventSounds` may know beyond the events: the state after them, and the battle's gate. */
export interface SoundContext {
  /** Places sounds about a unit (statuses, misses, heals) at its x, and times the damage ticks. */
  state?: SimState;
  /** Without one, poison and burn sounds are not limited. */
  gate?: SoundGate;
}

/** x of unit `id` in the state, or NaN (centred) when it is not there. */
function unitX(state: SimState | undefined, id: number): number {
  if (state === undefined) return Number.NaN;
  const units = state.units;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u !== undefined && u.id === id) return u.x;
  }
  return Number.NaN;
}

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
export function playEventSounds(
  audio: AudioEngine, events: readonly SimEvent[], playerFaction: Faction, context: SoundContext = {},
): void {
  const at = (x: number): PlayOptions => ({ pan: panFor(x) });
  const { state, gate } = context;
  const tick = state?.tick ?? 0;
  const dot = (name: 'poison' | 'burn', x: number, volume?: number): void => {
    if (gate === undefined || gate.dot(tick)) audio.play(name, volume === undefined ? at(x) : { pan: panFor(x), volume });
  };
  for (const e of events) {
    switch (e.type) {
      case 'unitSpawned':
        if (e.key === 'rock') break; // heard as its Rock Wall
        audio.play(e.faction === 'plants' ? 'place' : 'spawnZombie', at(e.x));
        break;
      case 'projectileSpawned':
        audio.play(SHOT_SOUND[e.kind], at(e.x));
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
        audio.play(BLAST_SOUND[e.sourceKey] ?? 'explode', at(e.x));
        break;
      case 'baseDamaged':
        // A hit in a lane is heard at that base (the engine plays baseHit at most once per 0.25 s).
        // Sudden death's drain (lane null, every step) is silent: the suddenDeath sting marks it.
        if (e.lane !== null) audio.play('baseHit', at(e.faction === 'plants' ? 0 : LAWN_WIDTH));
        break;
      case 'baseStruck':
        audio.play('baseStrike', at(0));
        break;
      case 'energyGained':
        // A spell's income is heard as the spell itself (cast in the same step).
        if (e.faction === playerFaction && e.source !== 'spell') audio.play(e.source === 'sunflower' ? 'sun' : 'bounty', at(e.x));
        break;
      case 'heroUsed':
        audio.play(e.faction === 'plants' ? 'megaMower' : 'boneStorm'); // the whole lane: centred
        break;
      case 'heroReady':
        if (e.faction === playerFaction) audio.play('heroReady');
        break;
      case 'spellCast':
        // Each spell has a sound of its own; an aimed one is heard where it lands, an income spell centred.
        audio.play(e.spell, e.size > 0 ? at(e.col + 0.5) : undefined);
        break;
      case 'spellReady':
        if (e.faction === playerFaction) audio.play('spellReady');
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
      case 'statusApplied': {
        const x = unitX(state, e.unitId);
        if (e.status === 'stun') audio.play('stun', at(x));
        else if (e.status === 'blind') audio.play('blind', at(x));
        else if (e.status === 'poison' || e.status === 'burn') dot(e.status, x);
        // tied: the lasso throw is its sound
        break;
      }
      case 'attackMissed':
        audio.play('miss', at(unitX(state, e.unitId)));
        break;
      case 'unitHealed':
        audio.play('heal', at(unitX(state, e.unitId))); // a pulse healing several is heard once (repeat limit)
        break;
      case 'abilityUsed':
        switch (e.ability) {
          case 'arm': audio.play('mineArm', at(e.x)); break;
          case 'fuse': audio.play('fuse', at(e.x)); break;
          case 'leap': audio.play('squash', at(e.x)); break;
          case 'grow': audio.play('grow', at(e.x)); break;
          case 'lasso': audio.play('lasso', at(e.x)); break;
          case 'raise': audio.play('raise', at(e.x)); break;
          case 'ignite': dot('burn', e.x, IGNITE_VOLUME); break;
          case 'trigger': // heard as its blast
          case 'heal': // heard as the units it heals
            break;
          default: {
            const unhandled: never = e.ability;
            void unhandled;
          }
        }
        break;
      case 'unitDamaged':
      case 'matchEnded': // the app plays win or lose
      case 'statusEnded':
      case 'hazardSpawned': // the rot's landing splat is the shot's own sound
      case 'hazardEnded':
        break;
      default: {
        const unhandled: never = e;
        void unhandled;
      }
    }
  }
  // Poison and burn hurt on every whole second of the match: a soft tick while any unit suffers.
  if (state !== undefined && tick > 0 && tick % TICKS_PER_SECOND === 0) {
    const units = state.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined || u.hp <= 0 || (u.poison <= 0 && u.burn <= 0)) continue;
      dot(u.poison > 0 ? 'poison' : 'burn', u.x, DOT_TICK_VOLUME);
      break;
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
