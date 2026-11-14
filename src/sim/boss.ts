/**
 * Level modes, part 3: the boss of a boss level (`MatchConfig.boss`, spec 8). A boss is a unit like
 * any other (it walks, bites, is blocked, shot and stung by the usual rules) with these extra rules:
 *
 * - It comes on in the step of tick 0, after the prepared units (`spawnBoss`): the Brain Titan at the
 *   zombie spawn edge of its lane, the Elder Oak on its column (`BossStats.col`), standing in its lane
 *   and the ones beside it (`BOSS_HALF_WIDTH`, `inLane`).
 * - Its timed patterns take turns (`tickBoss`): `pattern` is the next one, `patternTimer` the ticks
 *   until it goes off. The timer stands still only while the boss is stunned.
 * - Its shield goes up as its health falls to each mark (`phase` counts the marks passed): for
 *   `seconds` it takes `damageFactor` of all damage (`damageUnit`) and, with `bouncesStraight`,
 *   straight shots bounce off (`hitUnit`). The shield runs down whatever happens, stunned or not, so
 *   a level can never stall on it.
 * - A stun on it lasts at most `maxStunSeconds`; it cannot be tied (Vines, a lasso) or blinded
 *   (Fog, sand) (`inflictStatus`); it cannot be dug up (`'boss'`), merged into (not a card: `wrong-type`)
 *   or healed (Healing Rain, a Necromancer). A hero power or a blast takes at most `hitCap` of its
 *   max health per hit (`capHit`); poison and burn tick as usual.
 * - The Elder Oak guards the plant base: while it stands the base takes nothing and the Oak takes
 *   `guardFactor` of it instead (`damageBase`): the zombies in the lanes it does not stand in bite its roots.
 * - The match ends the moment it falls (`bossFallen`, from the endgame), its foes winning.
 */

import { seconds } from '../data/balance';
import type { Balance, BossPattern, BossStats } from '../data/balance';
import { factionOf } from '../data/units';
import { damageUnit } from './damage';
import { isRock } from './lawn';
import { inLane, isBoss, isStanding, shieldOf } from './lookup';
import { randomInt } from './rng';
import { spawnAtLevel, spawnUnit } from './spawn';
import { BOSS_HALF_WIDTH, LANES, PLANT_COLS, TICKS_PER_SECOND, ZOMBIE_SPAWN_X } from './types';
import type { Faction, MatchConfig, Projectile, SimEvent, SimState, Unit } from './types';

type Slam = Extract<BossPattern, { kind: 'slam' }>;
type Summon = Extract<BossPattern, { kind: 'summon' }>;
type Barrage = Extract<BossPattern, { kind: 'barrage' }>;

/**
 * Refuses a boss setup that makes no sense, with a `RangeError`: a boss exactly in mode `'boss'`; a
 * boss key with numbers in `Balance.bosses`, on its own side, in a lane where all of it fits on the
 * lawn (the Elder Oak's middle lane 1..3).
 */
export function checkBoss(c: MatchConfig, b: Balance): void {
  const boss = c.boss as MatchConfig['boss'] | undefined;
  if (boss === undefined) throw new RangeError('the setup has no boss field (null for none)');
  if ((c.mode === 'boss') !== (boss !== null)) {
    throw new RangeError(c.mode === 'boss' ? 'a boss level needs a boss' : `a ${c.mode} level has no boss`);
  }
  if (boss === null) return;
  if (!isBoss(boss.key) || (b.bosses as Partial<Balance['bosses']>)[boss.key] === undefined) {
    throw new RangeError(`boss "${String(boss.key)}" is no boss the balance table has numbers for`);
  }
  if (factionOf(boss.key) !== boss.faction) throw new RangeError(`boss ${boss.key} is not on the ${String(boss.faction)} side`);
  const half = BOSS_HALF_WIDTH[boss.key];
  if (!(Number.isInteger(boss.lane) && boss.lane - half >= 0 && boss.lane + half < LANES)) {
    throw new RangeError(`boss lane ${boss.lane}: ${boss.key} must stand on the lawn (lanes ${half}..${LANES - 1 - half})`);
  }
}

/**
 * Brings the level's boss on (the step of tick 0, after the prepared units): `unitSpawned`, at full
 * health from its own table, with nothing spent (no bounty); its first timed pattern is due its
 * `everySeconds` from now.
 */
export function spawnBoss(s: SimState, b: Balance, events: SimEvent[]): void {
  const boss = s.config.boss;
  if (boss === null) return;
  const stats = b.bosses[boss.key];
  const x = stats.col === undefined ? ZOMBIE_SPAWN_X : stats.col + 0.5;
  const u = spawnUnit(s, b, boss.key, boss.lane, x, events);
  if (u.id !== bossIdOf(s.config)) throw new Error(`the boss came on as unit ${u.id}, not ${bossIdOf(s.config)}`);
  u.spent = 0;
  u.pattern = nextTimed(stats, -1);
  u.patternTimer = u.pattern < 0 ? 0 : seconds(stats.patterns[u.pattern]!.everySeconds);
}

/**
 * The boss's unit id, from the setup: units are numbered from 1 in the order they come on, and on
 * the step of tick 0 the prepared units come on first, then the boss (`spawnBoss` checks it).
 */
export function bossIdOf(c: MatchConfig): number {
  return c.prepared.length + 1;
}

/** The index of the timed pattern after `from` (round the table), or -1 when it has none. */
function nextTimed(stats: BossStats, from: number): number {
  const n = stats.patterns.length;
  for (let i = 1; i <= n; i++) {
    const at = (((from + i) % n) + n) % n;
    if (stats.patterns[at]!.everySeconds > 0) return at;
  }
  return -1;
}

/**
 * Step stage, after abilities and before projectiles: every standing boss, in ascending id.
 * 1. Its shield runs down (always).
 * 2. For each shield mark its health has fallen to (health ≤ max × mark, marks in table order) it
 *    passes the mark (`bossPhase`); if it passed any, the shield goes up for its full `seconds`
 *    (`bossPattern` shield).
 * 3. Unless it is stunned, the pattern timer counts down. A slam says it winds up (`bossPattern`,
 *    `windup` true) on the tick its timer reaches `windupSeconds`; on the tick it reaches 0 the
 *    pattern goes off and the next timed one is due its `everySeconds` later.
 */
export function tickBoss(s: SimState, b: Balance, events: SimEvent[]): void {
  const count = s.units.length; // a summon appends; those are not bosses
  for (let i = 0; i < count; i++) {
    const u = s.units[i]!;
    if (!isBoss(u.key) || !isStanding(u)) continue;
    const stats = b.bosses[u.key];
    tickShield(b, u, events);
    if (u.stun > 0 || u.pattern < 0) continue;
    const p = stats.patterns[u.pattern]!;
    u.patternTimer = Math.max(0, u.patternTimer - 1);
    if (p.kind === 'slam' && u.patternTimer === seconds(p.windupSeconds)) {
      events.push({ type: 'bossPattern', unitId: u.id, kind: 'slam', lane: u.lane, col: slamCol(u, p), windup: true });
    }
    if (u.patternTimer > 0) continue;
    fire(s, b, u, p, events);
    u.pattern = nextTimed(stats, u.pattern);
    u.patternTimer = seconds(stats.patterns[u.pattern]!.everySeconds);
  }
}

function tickShield(b: Balance, u: Unit, events: SimEvent[]): void {
  if (!isBoss(u.key)) return;
  if (u.shieldLeft > 0) u.shieldLeft -= 1;
  if (u.stunFatigue > 0) u.stunFatigue -= 1; // stun resistance wears off (see BossStats)
  const shield = shieldOf(b, u.key);
  if (shield === undefined) return;
  let passed = false;
  while (u.phase < shield.atHealth.length && u.hp <= u.maxHp * shield.atHealth[u.phase]!) {
    u.phase += 1;
    passed = true;
    events.push({ type: 'bossPhase', unitId: u.id, phase: u.phase });
  }
  if (!passed) return;
  u.shieldLeft = seconds(shield.seconds);
  events.push({ type: 'bossPattern', unitId: u.id, kind: 'shield', lane: u.lane, col: null, windup: false });
}

function fire(s: SimState, b: Balance, u: Unit, p: BossPattern, events: SimEvent[]): void {
  switch (p.kind) {
    case 'slam':
      slam(s, b, u, p, events);
      break;
    case 'summon':
      summon(s, b, u, p, events);
      break;
    case 'barrage':
      barrage(s, u, p, events);
      break;
    case 'shield':
      break; // never timed (`everySeconds` 0)
    default: {
      const unhandled: never = p;
      throw new Error(`Unhandled boss pattern ${JSON.stringify(unhandled)}`);
    }
  }
}

/** The plant column a slam hits: the tile `reach` ahead of the boss, kept on the plant columns. */
export function slamCol(u: Unit, slam: Slam): number {
  const ahead = u.faction === 'zombies' ? u.x - slam.reach : u.x + slam.reach;
  return Math.min(PLANT_COLS - 1, Math.max(0, Math.floor(ahead)));
}

/**
 * Whether a boss is winding up a slam (its next pattern is a slam due within `windupSeconds`): it
 * then stands still and does not bite, so the child sees the arm go up before the blow.
 */
export function isWindingUp(b: Balance, u: Unit): boolean {
  if (!isBoss(u.key) || u.pattern < 0) return false;
  const p = b.bosses[u.key].patterns[u.pattern];
  return p !== undefined && p.kind === 'slam' && u.patternTimer <= seconds(p.windupSeconds);
}

/**
 * The slam: `bossPattern` (not a wind-up), then the standing enemy unit on the slam column in the
 * boss's lane takes `damage`, and those on that column in the lanes beside take `sideDamage`.
 */
function slam(s: SimState, b: Balance, u: Unit, p: Slam, events: SimEvent[]): void {
  const col = slamCol(u, p);
  events.push({ type: 'bossPattern', unitId: u.id, kind: 'slam', lane: u.lane, col, windup: false });
  for (let lane = u.lane - 1; lane <= u.lane + 1; lane++) {
    if (lane < 0 || lane >= LANES) continue;
    const victim = s.units.find((v) => v.faction !== u.faction && isStanding(v) && inLane(v, lane) && Math.floor(v.x) === col);
    if (victim !== undefined) damageUnit(s, b, victim, lane === u.lane ? p.damage : p.sideDamage, events);
  }
}

/**
 * The summon: `bossPattern`, then `count` of `unit` at `level` (each with its `unitSpawned`): a
 * zombie in as many different lanes, drawn with `randomInt` from those not drawn yet, at the spawn
 * edge; a plant on as many different free tiles (no standing plant there, no rock of the lawn) in columns
 * `minCol`..`maxCol`, drawn the same way from the free ones in lane-then-column order.
 */
function summon(s: SimState, b: Balance, u: Unit, p: Summon, events: SimEvent[]): void {
  events.push({ type: 'bossPattern', unitId: u.id, kind: 'summon', lane: u.lane, col: null, windup: false });
  const side: Faction = factionOf(p.unit);
  if (side === 'zombies') {
    const lanes: number[] = [];
    for (let lane = 0; lane < LANES; lane++) lanes.push(lane);
    for (let i = 0; i < p.count && lanes.length > 0; i++) {
      const lane = lanes.splice(randomInt(s, lanes.length), 1)[0]!;
      spawnAtLevel(s, b, p.unit, lane, ZOMBIE_SPAWN_X, p.level, events);
    }
    return;
  }
  const { minCol, maxCol } = p;
  if (minCol === undefined || maxCol === undefined) throw new Error(`a plant summon of ${p.unit} needs minCol and maxCol in the balance table`);
  const free: number[] = []; // lane * PLANT_COLS + col
  for (let lane = 0; lane < LANES; lane++) {
    for (let col = minCol; col <= maxCol; col++) {
      const taken = s.units.some((v) => v.faction === 'plants' && isStanding(v) && inLane(v, lane) && Math.floor(v.x) === col);
      if (!taken && !isRock(s.config, lane, col)) free.push(lane * PLANT_COLS + col);
    }
  }
  for (let i = 0; i < p.count && free.length > 0; i++) {
    const tile = free.splice(randomInt(s, free.length), 1)[0]!;
    spawnAtLevel(s, b, p.unit, Math.floor(tile / PLANT_COLS), (tile % PLANT_COLS) + 0.5, p.level, events);
  }
}

/**
 * The barrage: the lanes with a standing enemy are found (in lane order); `count` of them are drawn
 * with `randomInt` (all of them if fewer); if any, `bossPattern`, then into each lane an acorn is
 * lobbed from the boss at that lane's foremost enemy (the one nearest the boss's own base):
 * `projectileSpawned`, landing as any lobbed shot with `damage` and `splash` (see `splashOf`).
 */
function barrage(s: SimState, u: Unit, p: Barrage, events: SimEvent[]): void {
  const targets: Unit[] = [];
  for (let lane = 0; lane < LANES; lane++) {
    let front: Unit | null = null;
    for (const v of s.units) {
      if (v.faction === u.faction || !isStanding(v) || !inLane(v, lane)) continue;
      const nearer = u.faction === 'plants' ? front === null || v.x < front.x : front === null || v.x > front.x;
      if (nearer) front = v;
    }
    if (front !== null) targets.push(front);
  }
  if (targets.length === 0) return;
  events.push({ type: 'bossPattern', unitId: u.id, kind: 'barrage', lane: u.lane, col: null, windup: false });
  for (let i = 0; i < p.count && targets.length > 0; i++) {
    const target = targets.splice(randomInt(s, targets.length), 1)[0]!;
    const acorn: Projectile = {
      id: s.nextId, kind: 'acorn', faction: u.faction, lane: target.lane, x: u.x,
      speed: p.speed / TICKS_PER_SECOND, damage: p.damage, ownerId: u.id, spawnTick: s.tick,
      flight: 'lobbed', sourceKey: u.key, level: 1,
      targetId: target.id, targetX: target.x, pierceLeft: 0, hitIds: [],
      burning: false, burnDps: 0, burnTicks: 0, fadeX: null, // a boss's attack is never fogged
    };
    s.nextId += 1;
    s.projectiles.push(acorn);
    events.push({
      type: 'projectileSpawned', projectileId: acorn.id, kind: acorn.kind, faction: acorn.faction, lane: acorn.lane, x: acorn.x,
      ownerId: u.id, flight: acorn.flight, targetX: acorn.targetX,
    });
  }
}

/** The splash of a boss's barrage (for its acorns' landing), or undefined for anything a boss did not throw. */
export function bossSplash(b: Balance, p: Projectile): number | undefined {
  if (!isBoss(p.sourceKey)) return undefined;
  for (const pattern of b.bosses[p.sourceKey].patterns) if (pattern.kind === 'barrage') return pattern.splash;
  return undefined;
}

/**
 * Endgame, before the bases (a kindness: the boss's foes win even if their own base falls on the
 * same step): whether the level's boss has fallen, and if so who won (its foes). A
 * boss brought to 0 after the deaths stage (sudden death through `guardFactor`) leaves the lawn here
 * (`unitDied`, cause `'damage'`). Emits `bossDefeated`; the caller sets the winner and `matchEnded`.
 */
export function bossFallen(s: SimState, events: SimEvent[]): Faction | null {
  const boss = s.config.boss;
  if (boss === null) return null;
  const unitId = bossIdOf(s.config);
  const index = s.units.findIndex((u) => u.id === unitId);
  if (index >= 0) {
    const u = s.units[index]!;
    if (isStanding(u)) return null;
    s.units.splice(index, 1);
    events.push({ type: 'unitDied', unitId: u.id, key: u.key, faction: u.faction, lane: u.lane, x: u.x, level: u.level, cause: 'damage' });
  }
  events.push({ type: 'bossDefeated', unitId, key: boss.key, faction: boss.faction });
  return boss.faction === 'plants' ? 'zombies' : 'plants';
}
