import { describe, expect, it } from 'vitest';
import { BALANCE, cloneBalance, seconds } from '../../src/data/balance';
import type { Balance, BossPattern } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { inflictStatus } from '../../src/sim/status';
import { isWindingUp } from '../../src/sim/boss';
import { Match, defaultConfig, spawnUnit } from '../../src/sim/match';
import { LANES, ZOMBIE_SPAWN_X } from '../../src/sim/types';
import type { BossConfig, BossKey, Command, MatchConfig, SimEvent, SpellKey, Unit, UnitKey } from '../../src/sim/types';
import { eventsOf, merge, place, remove } from './helpers';

/**
 * Bosses (phase 3, Task 3): the Brain Titan and the Elder Oak. The boss numbers are pinned here (the
 * starting table of the brief), so the level tuning can move `BALANCE.bosses` without touching
 * these rules tests; every other unit's numbers come from the shipped table and are read from it.
 */
function bossBalance(): Balance {
  const b = cloneBalance(BALANCE);
  b.bosses = {
    brainTitan: {
      recharge: 0, hp: 6000, armor: 0, speed: 0.12,
      melee: { damage: 120, interval: 1.5, reach: 0.6 },
      maxStunSeconds: 1, hitCap: 0.1,
      patterns: [
        { kind: 'slam', everySeconds: 12, windupSeconds: 1.5, damage: 400, sideDamage: 200, reach: 0.6 },
        { kind: 'summon', everySeconds: 18, unit: 'veryFastWalker', count: 3, level: 1, minCol: 0, maxCol: 0 },
        { kind: 'shield', everySeconds: 0, atHealth: [0.66, 0.33], seconds: 6, damageFactor: 1, bouncesStraight: true },
      ],
    },
    elderOak: {
      recharge: 0, hp: 8000, armor: 0, speed: 0,
      maxStunSeconds: 1, hitCap: 0.1, col: 0, guardFactor: 0.5,
      patterns: [
        { kind: 'barrage', everySeconds: 10, count: 3, damage: 150, splash: 0.75, speed: 5 },
        { kind: 'summon', everySeconds: 20, unit: 'peashooter', count: 2, level: 1, minCol: 1, maxCol: 4 },
        { kind: 'shield', everySeconds: 0, atHealth: [0.5], seconds: 8, damageFactor: 0.5, bouncesStraight: false },
      ],
    },
  };
  return b;
}

const B = bossBalance();
const TITAN: BossConfig = { key: 'brainTitan', faction: 'zombies', lane: 2 };
const OAK: BossConfig = { key: 'elderOak', faction: 'plants', lane: 2 };

/** A boss level of the shipped setup with `boss`; no heroes, spells, income or sudden death unless patched. */
function bossConfig(boss: BossConfig, patch: Partial<MatchConfig> = {}, seed = 1): MatchConfig {
  const c = defaultConfig(seed, B);
  return {
    ...c, mode: 'boss', boss,
    heroes: { plants: false, zombies: false }, spells: { plants: 0, zombies: 0 },
    incomeMultiplier: { plants: 0, zombies: 0 }, startEnergy: { plants: 5000, zombies: 5000 },
    cards: { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] },
    suddenDeath: false, ...patch,
  };
}

/** A boss level after its first step: the boss is on the lawn. */
function level(boss: BossConfig, patch: Partial<MatchConfig> = {}, balance: Balance = B): { m: Match; boss: Unit; first: SimEvent[] } {
  const m = new Match(bossConfig(boss, patch), balance);
  const first = m.step();
  const u = m.state.units.find((x) => x.key === boss.key);
  if (!u) throw new Error('no boss');
  return { m, boss: u, first };
}

function steps(m: Match, n: number, commands: Command[] = []): SimEvent[] {
  const all: SimEvent[] = [...m.step(commands)];
  for (let i = 1; i < n; i++) all.push(...m.step());
  return all;
}

const spawn = (m: Match, key: UnitKey, lane: number, x: number): Unit => spawnUnit(m.state, m.balance, key, lane, x);
const patternOf = (key: BossKey, kind: BossPattern['kind']): BossPattern => B.bosses[key].patterns.find((p) => p.kind === kind)!;
const at = (m: Match, id: number): Unit | undefined => m.state.units.find((u) => u.id === id);

describe('checking the boss', () => {
  const cases: Array<[string, Partial<MatchConfig>, string]> = [
    ['a boss level with no boss', { mode: 'boss', boss: null }, 'needs a boss'],
    ['a boss in a battle', { mode: 'battle', boss: TITAN }, 'has no boss'],
    ['a boss on the wrong side', { mode: 'boss', boss: { ...TITAN, faction: 'plants' } }, 'side'],
    ['an unknown boss', { mode: 'boss', boss: { key: 'dragon' as BossKey, faction: 'zombies', lane: 2 } }, 'dragon'],
    ['the Titan off the lawn', { mode: 'boss', boss: { ...TITAN, lane: 5 } }, 'lane'],
    ['the Oak with a lane off the lawn (lane 0)', { mode: 'boss', boss: { ...OAK, lane: 0 } }, 'lane'],
    ['the Oak with a lane off the lawn (lane 4)', { mode: 'boss', boss: { ...OAK, lane: 4 } }, 'lane'],
    ['a boss in the script', { mode: 'boss', boss: TITAN, script: [{ tick: 5, unit: 'brainTitan', faction: 'zombies', lane: 1, level: 1 }] }, 'brainTitan'],
    ['a boss among the prepared units', { mode: 'boss', boss: TITAN, prepared: [{ unit: 'elderOak', faction: 'plants', lane: 2, x: 0.5, level: 1 }] }, 'elderOak'],
  ];
  it.each(cases)('refuses %s', (_name, patch, message) => {
    expect(() => new Match({ ...defaultConfig(1, B), ...patch }, B)).toThrow(message);
  });

  it('accepts the Titan in any lane and the Oak in lanes 1 to 3', () => {
    for (let lane = 0; lane < LANES; lane++) expect(() => new Match(bossConfig({ ...TITAN, lane }), B)).not.toThrow();
    for (const lane of [1, 2, 3]) expect(() => new Match(bossConfig({ ...OAK, lane }), B)).not.toThrow();
  });
});

describe('the boss comes on', () => {
  it('on the step of tick 0, after the prepared units, with full health, nothing spent and its first pattern 12 s away', () => {
    const { m, boss, first } = level(TITAN, { prepared: [{ unit: 'peashooter', faction: 'plants', lane: 0, x: 0.5, level: 1 }] });
    expect(eventsOf(first, 'unitSpawned').map((e) => e.key)).toEqual(['peashooter', 'brainTitan']);
    expect(boss).toMatchObject({ lane: 2, hp: 6000, maxHp: 6000, spent: 0, pattern: 0, shieldLeft: 0, phase: 0 });
    expect(boss.x).toBeCloseTo(ZOMBIE_SPAWN_X - 0.12 / 30, 9); // came on at the spawn edge and took its first step
    expect(boss.patternTimer).toBe(seconds(12) - 1); // its own stage already ran once on tick 0
    expect(m.state.units).toHaveLength(2);
  });

  it('the Oak stands on column 0 of its middle lane', () => {
    const { boss } = level(OAK);
    expect(boss).toMatchObject({ key: 'elderOak', faction: 'plants', lane: 2, x: 0.5, hp: 8000 });
  });
});

describe('the Brain Titan walks and bites like any zombie', () => {
  it('walks its lane at 0.12 tiles a second', () => {
    const { m, boss } = level(TITAN);
    steps(m, 30);
    expect(boss.x).toBeCloseTo(ZOMBIE_SPAWN_X - 0.12 - 0.12 / 30, 9); // the first step walked too
  });

  it('is blocked by a plant and bites it for 120 every 1.5 s', () => {
    const { m, boss } = level(TITAN);
    boss.x = 3;
    const plant = spawn(m, 'walnutBomb', 2, 2.5);
    const events = steps(m, seconds(3));
    expect(boss.x).toBe(3);
    const bites = eventsOf(events, 'unitDamaged').filter((e) => e.unitId === plant.id);
    expect(bites.map((e) => e.amount)).toEqual([120, 120]);
  });

  it('bites the plant base when it gets there', () => {
    const { m, boss } = level(TITAN);
    boss.x = 0.3;
    const events = steps(m, seconds(1.5));
    expect(eventsOf(events, 'baseDamaged').filter((e) => e.faction === 'plants').map((e) => e.amount)).toContain(120);
  });
});

describe('the slam', () => {
  /** A Titan blocked by a plant on column 2 of its lane, its slam 50 ticks away. */
  function slamScene() {
    const { m, boss } = level(TITAN);
    boss.x = 3;
    boss.patternTimer = 50;
    const front = spawn(m, 'walnutBomb', 2, 2.5);
    const up = spawn(m, 'walnutBomb', 1, 2.5);
    const down = spawn(m, 'walnutBomb', 3, 2.5);
    const behind = spawn(m, 'walnutBomb', 2, 1.5);
    const far = spawn(m, 'walnutBomb', 0, 2.5);
    return { m, boss, front, up, down, behind, far };
  }

  it('winds up 1.5 s before it strikes, saying which column it will hit', () => {
    const { m, boss } = slamScene();
    const windup = steps(m, 5);
    expect(eventsOf(windup, 'bossPattern')).toEqual([{ type: 'bossPattern', unitId: boss.id, kind: 'slam', lane: 2, col: 2, windup: true }]);
    expect(boss.patternTimer).toBe(seconds(1.5));
    expect(isWindingUp(B, boss)).toBe(true);
  });

  it('stands still and holds its bite while it winds up', () => {
    const { m, boss, front } = slamScene();
    boss.x = 3.2; // not yet at the plant: it would walk
    steps(m, 5);
    const x = boss.x;
    const events = steps(m, seconds(1.5) - 1);
    expect(boss.x).toBe(x);
    expect(eventsOf(events, 'unitAttacked').filter((e) => e.unitId === boss.id)).toEqual([]);
    expect(front.hp).toBe(front.maxHp);
  });

  it('strikes the plant in front for 400 and the plants on that column beside it for 200, and nothing else', () => {
    const { m, boss, front, up, down, behind, far } = slamScene();
    m.state.units.forEach((u) => { if (u !== boss) u.hp = u.maxHp; });
    boss.meleeTimer = 9999; // keep its bite out of the count
    const events = steps(m, 50);
    expect(eventsOf(events, 'bossPattern').at(-1)).toEqual({ type: 'bossPattern', unitId: boss.id, kind: 'slam', lane: 2, col: 2, windup: false });
    expect([front.maxHp - front.hp, up.maxHp - up.hp, down.maxHp - down.hp, behind.maxHp - behind.hp, far.maxHp - far.hp])
      .toEqual([400, 200, 200, 0, 0]);
  });

  it('in lane 0 hits only the one lane beside it', () => {
    const { m, boss } = level({ ...TITAN, lane: 0 });
    boss.x = 3;
    boss.patternTimer = 1;
    boss.meleeTimer = 9999;
    const a = spawn(m, 'walnutBomb', 0, 2.5);
    const b = spawn(m, 'walnutBomb', 1, 2.5);
    m.step();
    expect([a.maxHp - a.hp, b.maxHp - b.hp]).toEqual([400, 200]);
  });
});

describe('the patterns take turns', () => {
  it('slam 12 s after it came on, the summon 18 s after that, then the slam again 12 s later', () => {
    const { m, boss } = level(TITAN, {}, B);
    const seen: Array<[number, string]> = [];
    while (m.state.tick < seconds(12 + 18 + 12) + 5) {
      const tick = m.state.tick;
      for (const e of eventsOf(m.step(), 'bossPattern')) if (!e.windup) seen.push([tick, e.kind]);
      boss.x = Math.max(boss.x, 5); // keep it walking on an empty lawn, away from the base
    }
    expect(seen).toEqual([
      [seconds(12) - 1, 'slam'], [seconds(30) - 1, 'summon'], [seconds(42) - 1, 'slam'],
    ]);
  });

  it('the summon brings three level-1 Very Fast Walkers in three different lanes at the spawn edge', () => {
    const { m, boss } = level(TITAN);
    boss.pattern = 1;
    boss.patternTimer = 1;
    const events = m.step();
    const spawned = eventsOf(events, 'unitSpawned');
    expect(spawned.map((e) => e.key)).toEqual(['veryFastWalker', 'veryFastWalker', 'veryFastWalker']);
    expect(new Set(spawned.map((e) => e.lane)).size).toBe(3);
    expect(spawned.every((e) => e.x === ZOMBIE_SPAWN_X)).toBe(true);
    const walkers = m.state.units.filter((u) => u.key === 'veryFastWalker');
    expect(walkers.every((u) => u.level === 1)).toBe(true);
    expect(eventsOf(events, 'bossPattern')).toEqual([{ type: 'bossPattern', unitId: boss.id, kind: 'summon', lane: 2, col: null, windup: false }]);
    expect([boss.pattern, boss.patternTimer]).toEqual([0, seconds(12)]);
  });

  it('draws the summon lanes from the state rng: the same seed, the same lanes; another seed may differ', () => {
    const lanes = (seed: number): number[] => {
      const m = new Match(bossConfig(TITAN, {}, seed), B);
      m.step();
      const boss = m.state.units[0]!;
      boss.pattern = 1;
      boss.patternTimer = 1;
      return eventsOf(m.step(), 'unitSpawned').map((e) => e.lane);
    };
    expect(lanes(4)).toEqual(lanes(4));
    const all = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) all.add(lanes(seed).join());
    expect(all.size).toBeGreaterThan(1);
  });
});

describe('stuns and other statuses on a boss', () => {
  it('its pattern timer stands still while it is stunned, and only then', () => {
    const { m, boss } = level(TITAN);
    const before = boss.patternTimer;
    inflictStatus(m.state, B, boss, 'stun', 30, 0, null, []);
    steps(m, 10);
    expect(boss.patternTimer).toBe(before);
    boss.stun = 0;
    steps(m, 10);
    expect(boss.patternTimer).toBe(before - 10);
  });

  it('a stun lasts at most 1 s', () => {
    const { m, boss } = level(TITAN);
    const events: SimEvent[] = [];
    inflictStatus(m.state, B, boss, 'stun', seconds(2), 0, null, events);
    expect(boss.stun).toBe(seconds(1));
    expect(events).toEqual([{ type: 'statusApplied', unitId: boss.id, status: 'stun', ticks: seconds(1), sourceId: null }]);
  });

  it('a Kernel-pult butter stuns it for 1 s, not its usual 2', () => {
    const { m, boss } = level(TITAN);
    boss.x = 6;
    const kp = spawn(m, 'kernelPult', 2, 2.5);
    m.state.rng = 0; // whatever the roll, check every butter that lands
    let stuns: number[] = [];
    for (let i = 0; i < seconds(30) && stuns.length === 0; i++) {
      stuns = eventsOf(m.step(), 'statusApplied').filter((e) => e.unitId === boss.id && e.status === 'stun').map((e) => e.ticks);
    }
    expect(kp.id).toBeGreaterThan(0);
    expect(stuns).toEqual([seconds(1)]);
  });

  it.each(['tied', 'blind'] as const)('cannot be %s: nothing happens, nothing is reported', (kind) => {
    const { m, boss } = level(TITAN);
    const events: SimEvent[] = [];
    inflictStatus(m.state, B, boss, kind, 90, 0, null, events);
    expect(boss[kind]).toBe(0);
    expect(events).toEqual([]);
  });

  it.each([['vines', 'tied'], ['fog', 'blind']] as const)('%s leaves it alone and still works on the others', (spell, kind) => {
    const { m, boss } = level(spell === 'vines' ? TITAN : OAK, { spells: { plants: 1, zombies: 1 } });
    const side = spell === 'vines' ? 'plants' : 'zombies';
    m.state.players[side].spells = [{ key: spell as SpellKey, timer: 0 }];
    const lane = boss.lane;
    const col = Math.floor(boss.x);
    const other = spawn(m, spell === 'vines' ? 'brainEater' : 'peashooter', lane, col + 0.5);
    m.step([{ type: 'spell', faction: side, spell, lane, col }]);
    expect(boss[kind]).toBe(0);
    expect(other[kind]).toBeGreaterThan(0);
  });

  it('a Cowboy Zombie never lassoes the Oak: it ties the next plant, or nobody', () => {
    const { m, boss } = level(OAK);
    const cowboy = spawn(m, 'cowboyZombie', 2, 3);
    cowboy.abilityTimer = 0;
    let events = m.step();
    expect(eventsOf(events, 'abilityUsed').filter((e) => e.ability === 'lasso')).toEqual([]);
    expect(boss.tied).toBe(0);
    const plant = spawn(m, 'peashooter', 2, 1.5);
    events = m.step();
    expect(eventsOf(events, 'abilityUsed').filter((e) => e.ability === 'lasso').map((e) => e.targetId)).toEqual([plant.id]);
  });

  it('poison and burn tick on it as usual, uncapped', () => {
    const { m, boss } = level(TITAN);
    boss.x = 6;
    inflictStatus(m.state, B, boss, 'poison', seconds(3), 900, null, []);
    while (m.state.tick % 30 !== 0) m.step();
    const hit = eventsOf(m.step(), 'unitDamaged').filter((e) => e.unitId === boss.id);
    expect(hit.map((e) => e.amount)).toEqual([900]);
  });
});

describe('the shield', () => {
  it('goes up when the Titan falls to 66%: bossPhase 1 and 6 s of shield', () => {
    const { m, boss } = level(TITAN);
    boss.x = 6;
    boss.hp = 0.66 * 6000;
    const events = m.step();
    expect(eventsOf(events, 'bossPhase')).toEqual([{ type: 'bossPhase', unitId: boss.id, phase: 1 }]);
    expect(eventsOf(events, 'bossPattern')).toEqual([{ type: 'bossPattern', unitId: boss.id, kind: 'shield', lane: 2, col: null, windup: false }]);
    expect(boss.shieldLeft).toBe(seconds(6));
  });

  it('straight shots bounce off it while lobbed ones still hurt', () => {
    const { m, boss } = level(TITAN);
    boss.x = 5;
    boss.hp = 3000;
    m.step();
    expect(boss.shieldLeft).toBeGreaterThan(0);
    spawn(m, 'peashooter', 2, 0.5);
    spawn(m, 'mangoPult', 2, 1.5);
    const events = steps(m, seconds(5));
    const hits = eventsOf(events, 'projectileHit').filter((e) => e.targetId === boss.id);
    const peas = hits.filter((e) => e.blocked);
    expect(peas.length).toBeGreaterThan(0);
    const damage = eventsOf(events, 'unitDamaged').filter((e) => e.unitId === boss.id).map((e) => e.amount);
    const mango = B.units.mangoPult!.shot!.damage;
    expect(damage.length).toBeGreaterThan(0);
    expect(damage.every((d) => d === mango)).toBe(true);
  });

  it('runs out after 6 s even while the boss is stunned, and the straight shots hurt again', () => {
    const { m, boss } = level(TITAN);
    boss.x = 6;
    boss.hp = 3000;
    m.step();
    for (let i = 0; i < seconds(6); i++) {
      boss.stun = 10;
      m.step();
    }
    expect(boss.shieldLeft).toBe(0);
  });

  it('goes up again at 33%: bossPhase 2; a single blow past both marks passes both and raises one shield', () => {
    const { m, boss } = level(TITAN);
    boss.x = 6;
    boss.hp = 1000;
    const events = m.step();
    expect(eventsOf(events, 'bossPhase').map((e) => e.phase)).toEqual([1, 2]);
    expect(eventsOf(events, 'bossPattern').filter((e) => e.kind === 'shield')).toHaveLength(1);
    expect(boss.shieldLeft).toBe(seconds(6));
    boss.shieldLeft = 0;
    boss.hp = 10;
    expect(eventsOf(m.step(), 'bossPhase')).toEqual([]); // no third mark
  });

  it('the Oak\'s bark halves all damage for 8 s from 50%, poison included', () => {
    const { m, boss } = level(OAK);
    boss.hp = 4000;
    m.step();
    expect(boss.shieldLeft).toBe(seconds(8));
    const events: SimEvent[] = [];
    spawn(m, 'brainEater', 0, 0.3); // bites its roots
    inflictStatus(m.state, B, boss, 'poison', seconds(2), 100, null, []);
    events.push(...steps(m, seconds(2)));
    const amounts = eventsOf(events, 'unitDamaged').filter((e) => e.unitId === boss.id).map((e) => e.amount);
    expect(amounts).toContain(50); // the poison's 100
    expect(amounts).toContain(B.units.brainEater!.melee!.damage / 4); // its bite: half on the roots, halved again
  });
});

describe('caps and refusals', () => {
  it('a hero power takes at most 10% of the boss\'s max health', () => {
    const b = bossBalance();
    b.hero.plants = { ...b.hero.plants, damage: 5000 };
    const { m, boss } = level(TITAN, { heroes: { plants: true, zombies: false } }, b);
    boss.x = 6;
    m.state.players.plants.heroTimer = 0;
    const events = m.step([{ type: 'hero', faction: 'plants', lane: 2 }]);
    expect(eventsOf(events, 'unitDamaged').filter((e) => e.unitId === boss.id).map((e) => e.amount)).toEqual([600]);
  });

  it.each(['thunderbolt', 'meteor'] as const)('%s takes at most 10%%', (spell) => {
    const b = bossBalance();
    b.spells[spell] = { ...b.spells[spell], damage: 5000 };
    const boss = spell === 'thunderbolt' ? TITAN : OAK;
    const { m, boss: u } = level(boss, { spells: { plants: 1, zombies: 1 } }, b);
    if (spell === 'thunderbolt') u.x = 6.5;
    const side = spell === 'thunderbolt' ? 'plants' : 'zombies';
    m.state.players[side].spells = [{ key: spell, timer: 0 }];
    const col = spell === 'thunderbolt' ? 6 : 0;
    const events = m.step([{ type: 'spell', faction: side, spell, lane: 2, col }]);
    expect(eventsOf(events, 'unitDamaged').filter((e) => e.unitId === u.id).map((e) => e.amount)).toEqual([u.maxHp * 0.1]);
  });

  it('a Cherry Bomber\'s blast takes at most 10% (and the others in it take it all)', () => {
    const b = bossBalance();
    b.units.cherryBomber = { ...b.units.cherryBomber!, fuse: { seconds: 0, damage: 5000, radius: 1.6 } };
    const { m, boss } = level(TITAN, {}, b);
    boss.x = 3.5;
    const walker = spawn(m, 'brainEater', 2, 3.4);
    spawn(m, 'cherryBomber', 2, 2.5);
    const events = m.step();
    const dealt = eventsOf(events, 'unitDamaged');
    expect(dealt.filter((e) => e.unitId === boss.id).map((e) => e.amount)).toEqual([600]);
    expect(dealt.filter((e) => e.unitId === walker.id).map((e) => e.amount)).toEqual([5000]);
  });

  it('cannot be dug up, merged into, or healed by Healing Rain', () => {
    const { m, boss } = level(OAK, { spells: { plants: 1, zombies: 0 } });
    boss.hp = 7000;
    const events = m.step([
      remove('plants', boss.id),
      merge('plants', 'peashooter', boss.id),
    ]);
    expect(eventsOf(events, 'commandRejected').map((e) => e.reason)).toEqual(['boss', 'wrong-type']);
    m.state.players.plants.spells = [{ key: 'healingRain', timer: 0 }];
    m.step([{ type: 'spell', faction: 'plants', spell: 'healingRain', lane: 2, col: 0 }]);
    expect(boss.hp).toBe(7000);
  });

  it('a Necromancer does not heal the Titan', () => {
    const { m, boss } = level(TITAN);
    boss.hp = 5000;
    boss.x = 6;
    const necro = spawn(m, 'necromancer', 2, 6.5);
    necro.auraTimer = 0;
    const hurt = spawn(m, 'brainEater', 3, 6);
    hurt.hp = 100;
    const events = m.step();
    expect(eventsOf(events, 'unitHealed').map((e) => e.unitId)).toEqual([hurt.id]);
    expect(boss.hp).toBe(5000);
  });
});

describe('the Elder Oak stands in three lanes', () => {
  it('no plant can be put on its tiles (lanes 1-3, column 0); lane 0 and 4 are free', () => {
    const { m } = level(OAK);
    const reasons = eventsOf(m.step([
      place('plants', 'peashooter', 1, 0), place('plants', 'peashooter', 2, 0), place('plants', 'peashooter', 3, 0),
      place('plants', 'sunflower', 0, 0), place('plants', 'walnutBomb', 4, 0),
    ]), 'commandRejected').map((e) => e.reason);
    expect(reasons).toEqual(['occupied', 'occupied', 'occupied']);
  });

  it('blocks the zombies in lanes 1-3, who bite it', () => {
    const { m, boss } = level(OAK);
    const z = spawn(m, 'brainEater', 3, 2);
    z.shotTimer = 9999;
    const events = steps(m, seconds(5));
    expect(z.x).toBeGreaterThan(1);
    expect(z.blocked).toBe(true);
    expect(eventsOf(events, 'unitAttacked').filter((e) => e.unitId === z.id).map((e) => e.targetId)).toContain(boss.id);
    expect(m.state.baseHp.plants).toBe(m.state.baseMaxHp.plants);
  });

  it('in lanes 0 and 4 the zombies reach the base edge and bite its roots at half: the base takes nothing', () => {
    const { m, boss } = level(OAK);
    const z = spawn(m, 'brainEater', 4, 0.3);
    const events = steps(m, seconds(1));
    expect(eventsOf(events, 'baseDamaged')).toEqual([]);
    expect(eventsOf(events, 'unitDamaged').filter((e) => e.unitId === boss.id).map((e) => e.amount)).toEqual([B.units.brainEater!.melee!.damage / 2]);
    expect(z.blocked).toBe(true);
  });

  it('Bone Storm aimed at any of its lanes hits it once', () => {
    for (const lane of [1, 2, 3]) {
      const { m, boss } = level(OAK, { heroes: { plants: false, zombies: true } });
      m.state.players.zombies.heroTimer = 0;
      const events = m.step([{ type: 'hero', faction: 'zombies', lane }]);
      expect(eventsOf(events, 'unitDamaged').filter((e) => e.unitId === boss.id)).toHaveLength(1);
    }
    const { m, boss } = level(OAK, { heroes: { plants: false, zombies: true } });
    m.state.players.zombies.heroTimer = 0;
    expect(eventsOf(m.step([{ type: 'hero', faction: 'zombies', lane: 0 }]), 'unitDamaged').filter((e) => e.unitId === boss.id)).toEqual([]);
  });

  it('a Meteor over two of its lanes hits it once', () => {
    const { m, boss } = level(OAK, { spells: { plants: 0, zombies: 1 } });
    m.state.players.zombies.spells = [{ key: 'meteor', timer: 0 }];
    const events = m.step([{ type: 'spell', faction: 'zombies', spell: 'meteor', lane: 1, col: 0 }]);
    expect(eventsOf(events, 'unitDamaged').filter((e) => e.unitId === boss.id)).toHaveLength(1);
  });

  it('a straight zombie shot in lane 1 hits it', () => {
    const { m, boss } = level(OAK);
    spawn(m, 'skeletonArcher', 1, 4);
    const events = steps(m, seconds(3));
    expect(eventsOf(events, 'projectileHit').filter((e) => e.targetId === boss.id).length).toBeGreaterThan(0);
  });
});

describe('the barrage', () => {
  it('lobs an acorn at the foremost zombie of three random lanes that have one: 150 and a 0.75 splash', () => {
    const { m, boss } = level(OAK);
    const fronts = [0, 1, 3, 4].map((lane) => spawn(m, 'skeletonWarrior', lane, 4 + lane * 0.1));
    const behind = spawn(m, 'skeletonWarrior', 3, 4.6); // within the splash of the lane-3 front
    const farBehind = spawn(m, 'skeletonWarrior', 3, 6);
    for (const u of m.state.units) if (u.faction === 'zombies') u.stun = 9999; // they stand still
    boss.patternTimer = 1;
    const thrown = m.step();
    const acorns = eventsOf(thrown, 'projectileSpawned');
    expect(eventsOf(thrown, 'bossPattern')).toEqual([{ type: 'bossPattern', unitId: boss.id, kind: 'barrage', lane: 2, col: null, windup: false }]);
    expect(acorns).toHaveLength(3);
    expect(acorns.every((a) => a.kind === 'acorn' && a.flight === 'lobbed' && a.x === 0.5)).toBe(true);
    expect(new Set(acorns.map((a) => a.lane)).size).toBe(3);
    for (const a of acorns) expect(a.targetX).toBe(fronts[[0, 1, 3, 4].indexOf(a.lane)]!.x);
    const landed = steps(m, seconds(2));
    const dealt = eventsOf(landed, 'unitDamaged');
    for (const a of acorns) {
      const front = fronts[[0, 1, 3, 4].indexOf(a.lane)]!;
      expect(dealt.filter((e) => e.unitId === front.id).map((e) => e.amount)).toEqual([150]);
    }
    const hitLane3 = acorns.some((a) => a.lane === 3);
    expect(dealt.filter((e) => e.unitId === behind.id).map((e) => e.amount)).toEqual(hitLane3 ? [150] : []);
    expect(dealt.filter((e) => e.unitId === farBehind.id)).toEqual([]);
  });

  it('throws fewer acorns when fewer lanes have a zombie, and none (no bossPattern) when none has', () => {
    const { m, boss } = level(OAK);
    boss.patternTimer = 1;
    expect(eventsOf(m.step(), 'bossPattern')).toEqual([]);
    expect(boss.pattern).toBe(1); // the turn passed all the same
    const again = level(OAK);
    spawn(again.m, 'brainEater', 4, 8);
    again.boss.patternTimer = 1;
    expect(eventsOf(again.m.step(), 'projectileSpawned')).toHaveLength(1);
  });
});

describe('the Oak\'s summon', () => {
  it('puts two level-1 Peashooters on random free tiles of columns 1 to 4', () => {
    const { m, boss } = level(OAK);
    // Fill every tile of columns 1-4 but three.
    for (let lane = 0; lane < LANES; lane++) for (let col = 1; col <= 4; col++) {
      if (!(lane === 0 && col === 1) && !(lane === 2 && col === 3) && !(lane === 4 && col === 4)) spawn(m, 'sunflower', lane, col + 0.5);
    }
    boss.pattern = 1;
    boss.patternTimer = 1;
    const spawned = eventsOf(m.step(), 'unitSpawned');
    expect(spawned.map((e) => e.key)).toEqual(['peashooter', 'peashooter']);
    for (const e of spawned) expect(['0,1.5', '2,3.5', '4,4.5']).toContain(`${e.lane},${e.x}`);
    expect(spawned[0]!.lane).not.toBe(spawned[1]!.lane);
  });
});

describe('the end', () => {
  it('the Titan falling ends the match at once, the plants winning, though both bases stand', () => {
    const { m, boss } = level(TITAN);
    boss.x = 6;
    boss.hp = 1;
    boss.phase = 2;
    spawn(m, 'peashooter', 2, 5.5);
    let events: SimEvent[] = [];
    while (m.state.winner === null && m.state.tick < 300) events = m.step();
    expect(m.state.winner).toBe('plants');
    expect(events.slice(-2)).toEqual([
      { type: 'bossDefeated', unitId: boss.id, key: 'brainTitan', faction: 'zombies' },
      { type: 'matchEnded', winner: 'plants' },
    ]);
    expect(eventsOf(events, 'unitDied').map((e) => e.key)).toContain('brainTitan');
    expect(m.state.baseHp.plants).toBeGreaterThan(0);
    expect(m.state.baseHp.zombies).toBeGreaterThan(0);
  });

  it('the Oak falling ends it, the zombies winning', () => {
    const { m, boss } = level(OAK);
    boss.hp = 1;
    boss.phase = 1;
    spawn(m, 'brainEater', 0, 0.3);
    while (m.state.winner === null && m.state.tick < 300) m.step();
    expect(m.state.winner).toBe('zombies');
  });

  it('sudden death hurts the Oak (at half) instead of the plant base, and can finish it in the endgame', () => {
    const b = bossBalance();
    b.suddenDeath = { startSeconds: 0, baseRate: 0.5, growthPerSecond: 0 };
    const { m, boss } = level(OAK, { suddenDeath: true }, b);
    const perStep = b.baseHp * 0.5 / 30;
    expect(boss.hp).toBe(8000 - perStep * 0.5);
    expect(m.state.baseHp.plants).toBe(m.state.baseMaxHp.plants);
    boss.phase = 1;
    boss.hp = 1;
    const events = m.step();
    expect(events.slice(-3)).toEqual([
      { type: 'unitDied', unitId: boss.id, key: 'elderOak', faction: 'plants', lane: 2, x: 0.5, level: 1, cause: 'damage' },
      { type: 'bossDefeated', unitId: boss.id, key: 'elderOak', faction: 'plants' },
      { type: 'matchEnded', winner: 'zombies' },
    ]);
    expect(m.state.units.some((u) => u.key === 'elderOak')).toBe(false);
  });

  it('a base falling on the same step decides first', () => {
    const { m, boss } = level(TITAN);
    boss.hp = 0;
    m.state.baseHp.zombies = 0;
    m.step();
    expect(m.state.winner).toBe('plants');
    const t = level(TITAN);
    t.boss.hp = 0;
    t.m.state.baseHp.plants = 0;
    t.m.step();
    expect(t.m.state.winner).toBe('zombies');
  });
});

describe('a snapshot mid-pattern', () => {
  it.each([
    ['the Titan mid wind-up', TITAN, (boss: Unit) => { boss.x = 3; boss.patternTimer = 20; }],
    ['the Titan behind its shield', TITAN, (boss: Unit) => { boss.x = 5; boss.hp = 3900; }],
    ['the Oak with acorns in the air', OAK, (boss: Unit) => { boss.patternTimer = 3; }],
  ] as const)('%s restores to the unbroken checksum', (_name, which, set) => {
    const unbroken = level(which, { suddenDeath: true });
    set(unbroken.boss);
    const m = unbroken.m;
    for (let lane = 0; lane < LANES; lane++) spawn(m, which === TITAN ? 'peashooter' : 'brainEater', lane, which === TITAN ? 2.5 : 6);
    for (let i = 0; i < 8; i++) m.step();
    const snapshot = m.snapshot();
    const restored = Match.restore(snapshot, B);
    expect(restored.state.units.some((u) => u.patternTimer > 0 || u.shieldLeft > 0)).toBe(true);
    for (let i = 0; i < 1500; i++) {
      m.step();
      restored.step();
    }
    expect(restored.hash()).toBe(m.hash());
    expect(restored.snapshot()).toBe(m.snapshot());
  });
});

// ---------------------------------------------------------------------------------------------
// Review focus 1: no boss level can stall (a shield, a stun lock, a guarded base). Each boss level,
// on the shipped numbers, 50 seeds with an idle player and 50 with a strong scripted player: every
// one ends, by the sudden-death bound at the latest.

/** The ordinary enemy of the level: scripted waves of its own side, a little stronger as it goes. */
function waves(boss: BossConfig, seed: number): MatchConfig['script'] {
  const out: MatchConfig['script'] = [];
  let r = (seed * 2654435761) >>> 0;
  const next = (n: number): number => {
    r = (Math.imul(r ^ (r >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return r % n;
  };
  for (let tick = 300; tick < seconds(600); tick += 240 + next(240)) {
    const lane = next(LANES);
    if (boss.faction === 'zombies') out.push({ tick, unit: (['brainEater', 'veryFastWalker', 'skeletonWarrior'] as const)[next(3)]!, faction: 'zombies', lane, level: 1 + next(2) });
    else out.push({ tick, unit: (['peashooter', 'walnutBomb'] as const)[next(2)]!, faction: 'plants', lane, x: 2 + next(5) + 0.5, level: 1 + next(2) });
  }
  return out;
}

/**
 * A strong player, every half second the first of its moves the match would take: plants fill the
 * lawn from the base with Peashooters (a Walnut Bomb in front of each lane) and merge them, and mow
 * the Titan's lane; zombies send Skeleton Warriors and Brain Eaters down every lane and storm the Oak.
 */
function strongPlay(m: Match, player: 'plants' | 'zombies'): Command[] {
  const s = m.state;
  if (s.tick % 15 !== 0) return [];
  const moves: Command[] = [];
  const titan = s.units.find((u) => u.key === 'brainTitan');
  if (player === 'plants') {
    moves.push({ type: 'hero', faction: 'plants', lane: titan?.lane ?? 2 });
    for (let lane = 0; lane < LANES; lane++) moves.push(place('plants', 'walnutBomb', lane, 5));
    for (let col = 0; col < 5; col++) for (let lane = 0; lane < LANES; lane++) moves.push(place('plants', 'peashooter', lane, col));
    for (const u of s.units) if (u.key === 'peashooter' && u.level < 5) moves.push(merge('plants', 'peashooter', u.id));
  } else {
    moves.push({ type: 'hero', faction: 'zombies', lane: 2 });
    for (let lane = 0; lane < LANES; lane++) {
      moves.push(place('zombies', 'skeletonWarrior', (lane + s.tick / 15) % LANES, 9), place('zombies', 'brainEater', (lane + 2 + s.tick / 15) % LANES, 9));
    }
  }
  const move = moves.find((c) => m.check(c) === null);
  return move ? [move] : [];
}

describe('every boss level ends (50 seeds idle, 50 seeds strong)', () => {
  /** The last tick a battle can still run: when sudden death alone has drained a full base. */
  function suddenDeathBound(): number {
    const sd = BALANCE.suddenDeath;
    const start = seconds(sd.startSeconds);
    let drained = 0;
    let tick = start;
    while (drained < BALANCE.baseHp) {
      drained += BALANCE.baseHp * (sd.baseRate + sd.growthPerSecond * (tick - start) / 30) / 30;
      tick += 1;
    }
    return tick;
  }
  const bound = suddenDeathBound();

  it.each([
    ['the Brain Titan (p1-8)', TITAN, 'plants'],
    ['the Elder Oak (z1-8)', OAK, 'zombies'],
  ] as const)('%s', (_name, boss, player) => {
    const outcomes = { idle: new Map<string, number>(), strong: new Map<string, number>() };
    for (const style of ['idle', 'strong'] as const) {
      for (let seed = 1; seed <= 50; seed++) {
        const config: MatchConfig = {
          ...defaultConfig(seed, BALANCE as Balance), mode: 'boss',
          boss: boss.key === 'brainTitan' ? { ...boss, lane: seed % LANES } : boss,
          script: waves(boss, seed),
          cards: { plants: [...ALL_CARDS.plants], zombies: [...ALL_CARDS.zombies] },
          startEnergy: { plants: 600, zombies: 600 },
          incomeMultiplier: { plants: player === 'plants' ? 4 : 1, zombies: player === 'zombies' ? 4 : 1 },
        };
        const m = new Match(config);
        while (m.state.winner === null && m.state.tick <= bound) m.step(style === 'strong' ? strongPlay(m, player) : []);
        expect(m.state.winner, `${style} seed ${seed}`).not.toBeNull();
        expect(m.state.tick, `${style} seed ${seed}`).toBeLessThanOrEqual(bound);
        const o = outcomes[style];
        o.set(String(m.state.winner), (o.get(String(m.state.winner)) ?? 0) + 1);
      }
    }
    // The idle player always loses; the strong one beats the boss at least sometimes.
    expect(outcomes.idle.get(player) ?? 0).toBe(0);
    expect(outcomes.strong.get(player) ?? 0).toBeGreaterThan(0);
  });
});

