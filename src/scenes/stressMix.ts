import { BALANCE } from '../data/balance';
import { ALL_CARDS, factionOf } from '../data/units';
import { Match, defaultConfig, spawnUnit } from '../sim/match';
import { applyStatus } from '../sim/status';
import { SPELLS } from '../sim/spells';
import { COLS, LANES, MAX_LEVEL } from '../sim/types';
import type { Command, Faction, Flight, Hazard, Projectile, ProjectileKind, SimEvent, SpellKey, StatusKind, Unit, UnitKey } from '../sim/types';

// The mixed stress scene (`?scene=stress&mix&units=<n>`, used by tools/perf.mjs): the worst lawn a
// match could plausibly show, kept that way while it is measured. Pure: no three, no DOM, its own
// seeded random, so a test can check what it holds.
//
// Every step, after the real `Match.step`, it tops up:
//   - n fighters, half a side, of all 21 kinds (the twenty cards and the Bone Minion) taken in
//     turn, at random levels; plants in columns 0-6 (column 7 is kept for rocks);
//   - two rocks standing (the Rock Wall's, on column 7);
//   - at least MIX_PER_KIND projectiles of each of the ten kinds in the air, the lobbed ones aimed
//     at a unit, and MIX_BURNING burning peas;
//   - exactly MIX_PUDDLES Brain Rot puddles;
//   - a status on a third of the fighters, the six kinds (haste on zombies only) kept even;
// and it casts one of the ten spells every second and a hero power every two seconds, alternating
// sides, so a spell show and a hero show are always running. Both bases are kept whole.

export const MIX_PER_KIND = 4;
export const MIX_PROJECTILES = 10 * MIX_PER_KIND;
export const MIX_PUDDLES = 6;
export const MIX_BURNING = 3;
/** At least this many fighters with each of the six statuses. */
export const MIX_PER_STATUS = 3;
export const MIX_ROCKS = 2;

const PLENTY = 1_000_000;
const STATUS_TICKS = 90;
const KINDS: readonly ProjectileKind[] = ['pea', 'brain', 'kernel', 'butter', 'mango', 'sand', 'arrow', 'bullet', 'trident', 'rot'];
const STATUSES: readonly StatusKind[] = ['stun', 'blind', 'tied', 'poison', 'burn', 'haste'];
const ROCK_COL = 7;
const ROCK_LANES = [1, 3];
const ROCK_WALL_LANES = [0, 2, 4];
/** Where each aimed spell is cast: on the enemy's units (or, Healing Rain, the caster's own). */
const SPELL_AT: Record<SpellKey, { lane: number; col: number }> = {
  thunderbolt: { lane: 3, col: 5 }, vines: { lane: 1, col: 6 }, sunShower: { lane: 0, col: 0 },
  healingRain: { lane: 1, col: 2 }, rockWall: { lane: 0, col: ROCK_COL },
  meteor: { lane: 1, col: 3 }, fog: { lane: 0, col: 2 }, brainFeast: { lane: 0, col: 0 },
  frenzy: { lane: 3, col: 8 }, graveRise: { lane: 4, col: 7 },
};

/** Who fires each kind of shot, and how it flies (read from the balance table). */
const SHOOTERS = new Map<ProjectileKind, { key: UnitKey; flight: Flight; speed: number; pierce: number }>();
for (const [key, stats] of Object.entries(BALANCE.units)) {
  const shot = stats.shot;
  if (!shot) continue;
  const entry = { key: key as UnitKey, flight: shot.flight ?? 'straight', speed: shot.speed, pierce: shot.pierce ?? 1 };
  if (!SHOOTERS.has(shot.kind)) SHOOTERS.set(shot.kind, entry);
  const alt = shot.status?.altKind;
  if (alt && !SHOOTERS.has(alt)) SHOOTERS.set(alt, entry);
}

export interface Mix {
  match: Match;
  perSide: number;
  /** Fighter keys taken in turn, per side. */
  keys: Record<Faction, UnitKey[]>;
  next: Record<Faction, number>;
  seed: number;
  rockWalls: number;
}

function random(mix: Mix): number {
  // mulberry32
  let t = (mix.seed = (mix.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A match for the mix: all ten cards and all five spells each, heroes on, endless energy, no sudden death. */
export function mixMatch(total: number, seed = 7): Mix {
  const config = defaultConfig(seed);
  config.cards = { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] };
  config.startEnergy = { plants: PLENTY, zombies: PLENTY };
  config.suddenDeath = false;
  config.spells = { plants: SPELLS.plants.length, zombies: SPELLS.zombies.length };
  const match = new Match(config);
  const mix: Mix = {
    match,
    perSide: Math.floor(total / 2),
    keys: { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies, 'boneMinion'] },
    next: { plants: 0, zombies: 0 },
    seed,
    rockWalls: 0,
  };
  const events: SimEvent[] = [];
  topUp(mix, events);
  return mix;
}

function standing(u: Unit): boolean {
  return u.hp > 0;
}

function spawnFighter(mix: Mix, faction: Faction, events: SimEvent[]): void {
  const s = mix.match.state;
  const list = mix.keys[faction];
  // The kind this side has fewest of (a mine or a cherry that went off comes straight back),
  // ties taken in turn.
  const have = new Map<UnitKey, number>();
  for (const u of s.units) if (u.faction === faction) have.set(u.key, (have.get(u.key) ?? 0) + 1);
  let key = list[mix.next[faction] % list.length] as UnitKey;
  for (let i = 1; i <= list.length; i++) {
    const other = list[(mix.next[faction] + i) % list.length] as UnitKey;
    if ((have.get(other) ?? 0) < (have.get(key) ?? 0)) key = other;
  }
  mix.next[faction] += 1;
  const lane = Math.floor(random(mix) * LANES);
  const x = faction === 'plants'
    ? Math.floor(random(mix) * ROCK_COL) + 0.3 + 0.4 * (mix.next[faction] % 2)
    : 3 + random(mix) * (COLS - 3);
  const unit = spawnUnit(s, BALANCE, key, lane, x, events);
  unit.level = 1 + Math.floor(random(mix) * MAX_LEVEL);
}

function nearestEnemy(s: Mix['match']['state'], faction: Faction, lane: number, x: number): Unit | null {
  let best: Unit | null = null;
  for (const u of s.units) {
    if (u.faction === faction || u.lane !== lane || !standing(u)) continue;
    const ahead = faction === 'plants' ? u.x > x : u.x < x;
    if (ahead && (best === null || Math.abs(u.x - x) < Math.abs(best.x - x))) best = u;
  }
  return best;
}

function fire(mix: Mix, kind: ProjectileKind, events: SimEvent[], burn = false): void {
  const s = mix.match.state;
  const shooter = SHOOTERS.get(kind);
  if (!shooter) return;
  const faction = factionOf(shooter.key as Exclude<UnitKey, 'rock' | 'boneMinion'>);
  // From a standing unit that fires this kind if there is one, so it leaves its muzzle.
  const owners = s.units.filter((u) => u.key === shooter.key && standing(u));
  const owner = owners.length > 0 ? (owners[Math.floor(random(mix) * owners.length)] as Unit) : null;
  const lane = owner ? owner.lane : Math.floor(random(mix) * LANES);
  const x = owner ? owner.x : faction === 'plants' ? 0.5 + random(mix) * 3 : 6 + random(mix) * 3;
  const target = shooter.flight === 'lobbed' ? nearestEnemy(s, faction, lane, x) : null;
  const burning = burn;
  const p: Projectile = {
    id: s.nextId++, kind, faction, lane, x,
    speed: shooter.speed / 30, damage: 1, ownerId: owner ? owner.id : 0,
    spawnTick: s.tick, flight: shooter.flight, sourceKey: shooter.key, level: owner ? owner.level : 1,
    targetId: target ? target.id : null, targetX: target ? target.x : null,
    pierceLeft: shooter.flight === 'piercing' ? shooter.pierce : 0, hitIds: [],
    burning, burnDps: burning ? 1 : 0, burnTicks: burning ? 60 : 0, fadeX: null,
  };
  s.projectiles.push(p);
  events.push({
    type: 'projectileSpawned', projectileId: p.id, kind, faction, lane, x, ownerId: p.ownerId, flight: p.flight, targetX: p.targetX,
  });
}

function topUp(mix: Mix, events: SimEvent[]): void {
  const s = mix.match.state;
  s.baseHp.plants = s.baseMaxHp.plants;
  s.baseHp.zombies = s.baseMaxHp.zombies;
  s.winner = null;

  // Fighters.
  for (const faction of ['plants', 'zombies'] as const) {
    let alive = 0;
    for (const u of s.units) if (u.faction === faction && u.key !== 'rock') alive += 1;
    for (; alive < mix.perSide; alive++) spawnFighter(mix, faction, events);
  }
  // Rocks.
  let rocks = 0;
  for (const u of s.units) if (u.key === 'rock') rocks += 1;
  for (let i = 0; rocks < MIX_ROCKS && i < ROCK_LANES.length; i++) {
    const lane = ROCK_LANES[i] as number;
    if (s.units.some((u) => u.key === 'rock' && u.lane === lane)) continue;
    spawnUnit(s, BALANCE, 'rock', lane, ROCK_COL + 0.5, events);
    rocks += 1;
  }
  // Projectiles, every kind.
  const count = new Map<ProjectileKind, number>();
  for (const p of s.projectiles) count.set(p.kind, (count.get(p.kind) ?? 0) + 1);
  for (const kind of KINDS) for (let n = count.get(kind) ?? 0; n < MIX_PER_KIND; n++) fire(mix, kind, events);
  let burning = 0;
  for (const p of s.projectiles) if (p.burning) burning += 1;
  for (; burning < MIX_BURNING; burning++) fire(mix, 'pea', events, true);
  // Puddles: exactly MIX_PUDDLES (the Brain Rots' own shots leave more; the oldest go).
  while (s.hazards.length > MIX_PUDDLES) {
    const gone = s.hazards.shift() as Hazard;
    events.push({ type: 'hazardEnded', hazardId: gone.id });
  }
  for (let n = s.hazards.length; n < MIX_PUDDLES; n++) {
    const lane = Math.floor(random(mix) * LANES);
    const x = 1 + random(mix) * 5;
    const ticks = 150;
    const id = s.nextId++;
    s.hazards.push({ id, kind: 'rot', faction: 'zombies', lane, x, radius: 0.75, ticksLeft: ticks, dps: 1, poisonTicks: 30 });
    events.push({ type: 'hazardSpawned', hazardId: id, kind: 'rot', lane, x, radius: 0.75, ticks });
  }
  // Statuses on a third, the kinds kept even.
  // Plants and zombies taken in turn, so both sides get their share (haste goes on zombies only).
  const plants = s.units.filter((u) => u.key !== 'rock' && u.faction === 'plants' && standing(u));
  const zombies = s.units.filter((u) => u.faction === 'zombies' && standing(u));
  const fighters: Unit[] = [];
  for (let i = 0; i < Math.max(plants.length, zombies.length); i++) {
    if (i < zombies.length) fighters.push(zombies[i] as Unit);
    if (i < plants.length) fighters.push(plants[i] as Unit);
  }
  const per = new Map<StatusKind, number>();
  let statused = 0;
  for (const u of fighters) {
    let any = false;
    for (const k of STATUSES) if (u[k] > 0) { per.set(k, (per.get(k) ?? 0) + 1); any = true; }
    if (any) statused += 1;
  }
  const want = Math.ceil(fighters.length / 3);
  const short = (): boolean => STATUSES.some((k) => (per.get(k) ?? 0) < MIX_PER_STATUS);
  for (let i = 0; i < fighters.length && (statused < want || short()); i += 1) {
    const u = fighters[i] as Unit;
    if (STATUSES.some((k) => u[k] > 0)) continue;
    let kind: StatusKind | null = null;
    for (const k of STATUSES) {
      if (k === 'haste' && u.faction !== 'zombies') continue;
      if (kind === null || (per.get(k) ?? 0) < (per.get(kind) ?? 0)) kind = k;
    }
    if (kind === null) continue;
    applyStatus(s, u, kind, STATUS_TICKS, kind === 'poison' || kind === 'burn' ? 1 : 0, null, events);
    per.set(kind, (per.get(kind) ?? 0) + 1);
    statused += 1;
  }
}

/** The powers due this tick: a spell every second (all ten in turn), a hero every two seconds. */
function powers(mix: Mix, out: Command[]): void {
  const s = mix.match.state;
  const tick = s.tick;
  if (tick % 60 === 0) {
    const n = tick / 60;
    const faction: Faction = n % 2 === 0 ? 'plants' : 'zombies';
    s.players[faction].heroTimer = 0;
    out.push({ type: 'hero', faction, lane: n % LANES });
  }
  if (tick % 30 === 15) {
    const n = (tick - 15) / 30;
    const faction: Faction = n % 2 === 0 ? 'plants' : 'zombies';
    const list = SPELLS[faction];
    const spell = list[Math.floor(n / 2) % list.length] as SpellKey;
    const at = { ...SPELL_AT[spell] };
    if (spell === 'rockWall') at.lane = ROCK_WALL_LANES[mix.rockWalls++ % ROCK_WALL_LANES.length] as number;
    for (const slot of s.players[faction].spells) if (slot.key === spell) slot.timer = 0;
    out.push({ type: 'spell', faction, spell, lane: at.lane, col: at.col });
  }
}

const scratch: Command[] = [];

/** One step of the mix: the match's own step with the powers due, then the top-up. Events go into `events`. */
export function stepMix(mix: Mix, events: SimEvent[]): void {
  const s = mix.match.state;
  s.players.plants.energy = PLENTY;
  s.players.zombies.energy = PLENTY;
  scratch.length = 0;
  powers(mix, scratch);
  const stepped = mix.match.step(scratch);
  for (let i = 0; i < stepped.length; i++) events.push(stepped[i] as SimEvent);
  topUp(mix, events);
}
