import { describe, expect, it } from 'vitest';
import { hashState, restoreState, snapshotState } from '../../src/sim/hash';
import type { SimState } from '../../src/sim/types';

/**
 * Checksum of `makeState()`, cross-checked against a separate implementation of the byte
 * layout documented in src/sim/hash.ts (standard FNV-1a over 2057 bytes). Re-pinned in phase 3
 * Task 3 (bosses) when units gained `pattern`, `patternTimer`, `shieldLeft` and `phase` and the setup
 * its `boss` (cross-checked by a separate Python FNV-1a written from the documented layout, fed the
 * JSON of `makeState()`); before that it was 525061730 over 1940 bytes, re-pinned in phase 3
 * (Adventure) when the setup gained its level fields (`mode` .. `invulnerableBase`) and the state
 * `scriptIndex` and `belt` (cross-checked by a separate Python FNV-1a feeding the 456 new bytes on
 * from the earlier checksum); before that it was 1403206276 over 1484 bytes, re-pinned in phase 4a
 * when the setup gained its Marketplace `upgrades` (cross-checked by feeding the 64 new bytes on
 * from the earlier checksum); before that it was 2247931455 over 1420 bytes, re-pinned in phase 2
 * for the owner's Sunflower rule, when units gained `hurt`; in Task 4b it was 1072679369 over 1404
 * bytes, when units gained `expires`, `haste` and `hasteCarry`, players their dealt spells and
 * the setup its `spells`; for the Task 3 review it was 3875909580 over 1232 bytes, when hazards
 * gained `poisonTicks`; in Task 4 it was 3625389926 over 1224
 * bytes, when players gained their hero timers (`heroTimer`) and the setup its `heroes`; in Task 3
 * it was 3963315096 over 1206 bytes, when units gained the Necromancer's heal timer (`auraTimer`); in Task 2 it was
 * 972736984 over 1190 bytes, from when projectiles gained the burn a Torchwood gives them
 * (`burnDps`, `burnTicks`); in Task 1 628692134 over 1174 bytes, from when units gained statuses,
 * stacks and an owner, projectiles their flight fields, and the state its hazards. Before that it
 * was 3642874464 over 841 bytes, and before the base defence timers were added 1810640202 over
 * 793 bytes.
 */
const GOLDEN_HASH = 2646483390;

/** A fresh hand-built state each call, so a test can mutate its copy freely. */
function makeState(): SimState {
  return {
    tick: 120,
    rng: 0xdeadbeef,
    nextId: 5,
    units: [
      {
        id: 1, key: 'peashooter', faction: 'plants', lane: 2, x: 1, level: 2,
        hp: 80, maxHp: 120, spent: 150, armor: 0, meleeTimer: 0, shotTimer: 12, abilityTimer: 0, auraTimer: 0, blocked: false,
        stun: 0, blind: 15, tied: 0, poison: 0, poisonDps: 0, burn: 40, burnDps: 10, stacks: 0, ownerId: null,
        expires: 0, haste: 0, hasteCarry: 0, hurt: 0, pattern: 0, patternTimer: 0, shieldLeft: 0, phase: 0,
      },
      {
        id: 3, key: 'brainEater', faction: 'zombies', lane: 2, x: 6.25, level: 1,
        hp: 90, maxHp: 100, spent: 100, armor: 3, meleeTimer: 4, shotTimer: 9, abilityTimer: 0, auraTimer: 33, blocked: true,
        stun: 20, blind: 0, tied: 7, poison: 60, poisonDps: 15, burn: 0, burnDps: 0, stacks: 2, ownerId: 9,
        expires: 0, haste: 45, hasteCarry: 1, hurt: 15, pattern: 1, patternTimer: 77, shieldLeft: 90, phase: 2,
      },
    ],
    projectiles: [
      {
        id: 4, kind: 'pea', faction: 'plants', lane: 2, x: 3.5, speed: 0.2, damage: 20, ownerId: 1, spawnTick: 118,
        flight: 'piercing', sourceKey: 'peashooter', level: 2, targetId: 3, targetX: 6.25,
        pierceLeft: 2, hitIds: [2], burning: true, burnDps: 20, burnTicks: 90,
      },
    ],
    hazards: [
      { id: 2, kind: 'rot', faction: 'zombies', lane: 1, x: 2.5, radius: 0.75, ticksLeft: 90, dps: 15, poisonTicks: 30 },
    ],
    players: {
      plants: {
        energy: 175, carry: 1234, recharge: { peashooter: 60, sunflower: 0 }, heroTimer: 0,
        spells: [{ key: 'thunderbolt', timer: 0 }, { key: 'rockWall', timer: 300 }],
      },
      zombies: { energy: 125, carry: 0, recharge: { brainEater: 15 }, heroTimer: 700, spells: [{ key: 'fog', timer: 12 }] },
    },
    baseHp: { plants: 500, zombies: 480 },
    baseMaxHp: { plants: 500, zombies: 500 },
    baseDefenseTimers: [0, 12, 30, 0, 5],
    suddenDeath: false,
    winner: null,
    config: {
      seed: 42,
      startEnergy: { plants: 150, zombies: 150 },
      baseHp: { plants: 500, zombies: 500 },
      cards: {
        plants: ['peashooter', 'sunflower', 'walnutBomb'],
        zombies: ['brainEater', 'veryFastWalker', 'skeletonWarrior'],
      },
      incomeMultiplier: { plants: 1, zombies: 1.25 },
      suddenDeath: true,
      heroes: { plants: true, zombies: false },
      spells: { plants: 2, zombies: 1 },
      upgrades: { plants: { peashooter: 3, sunflower: 0 }, zombies: { brainEater: 10 } },
      mode: 'conveyor',
      script: [
        { tick: 30, unit: 'brainEater', faction: 'zombies', lane: 1, x: 8.5, level: 2 },
        { tick: 60, unit: 'veryFastWalker', faction: 'zombies', lane: 3, level: 1 },
      ],
      prepared: [{ unit: 'walnutBomb', faction: 'plants', lane: 2, x: 3.5, level: 1 }],
      goalTicks: 2700,
      belt: { side: 'plants', everyTicks: 90, cards: ['peashooter', 'walnutBomb'], slots: 5 },
      noEnergy: true,
      invulnerableBase: 'zombies',
      boss: { key: 'elderOak', faction: 'plants', lane: 2 },
    },
    scriptIndex: 1,
    belt: ['peashooter'],
  };
}

function unit(s: SimState, index: number) {
  const u = s.units[index];
  if (!u) throw new Error(`no unit ${index}`);
  return u;
}

describe('hashState', () => {
  it('returns an unsigned 32-bit integer', () => {
    const h = hashState(makeState());
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('is stable across calls and between equal states', () => {
    const s = makeState();
    expect(hashState(s)).toBe(hashState(s));
    expect(hashState(makeState())).toBe(hashState(makeState()));
  });

  it('pins the byte layout (a change here invalidates every recorded checksum)', () => {
    expect(hashState(makeState())).toBe(GOLDEN_HASH);
  });

  // The six fields the spec names, then everything else the hash must cover.
  const mutations: Array<[string, (s: SimState) => void]> = [
    ['tick', (s) => { s.tick += 1; }],
    ['a unit x', (s) => { unit(s, 0).x += 0.001; }],
    ['a unit hp', (s) => { unit(s, 0).hp -= 1; }],
    ['a player energy', (s) => { s.players.plants.energy += 1; }],
    ['baseHp.plants', (s) => { s.baseHp.plants -= 1; }],
    ['a projectile x', (s) => { s.projectiles[0]!.x += 0.001; }],
    ['rng', (s) => { s.rng += 1; }],
    ['nextId', (s) => { s.nextId += 1; }],
    ['a unit key', (s) => { unit(s, 0).key = 'sunflower'; }],
    ['a unit faction', (s) => { unit(s, 0).faction = 'zombies'; }],
    ['a unit lane', (s) => { unit(s, 0).lane = 3; }],
    ['a unit level', (s) => { unit(s, 0).level = 3; }],
    ['a unit maxHp', (s) => { unit(s, 0).maxHp += 1; }],
    ['a unit spent', (s) => { unit(s, 0).spent += 1; }],
    ['a unit armor', (s) => { unit(s, 1).armor += 1; }],
    ['a unit meleeTimer', (s) => { unit(s, 0).meleeTimer += 1; }],
    ['a unit shotTimer', (s) => { unit(s, 0).shotTimer += 1; }],
    ['a unit abilityTimer', (s) => { unit(s, 0).abilityTimer += 1; }],
    ['a unit blocked flag', (s) => { unit(s, 1).blocked = false; }],
    ['a projectile damage', (s) => { s.projectiles[0]!.damage += 1; }],
    ['a projectile kind', (s) => { s.projectiles[0]!.kind = 'brain'; }],
    ['a projectile owner', (s) => { s.projectiles[0]!.ownerId = 3; }],
    ['a projectile spawnTick', (s) => { s.projectiles[0]!.spawnTick += 1; }],
    ['a player carry', (s) => { s.players.zombies.carry += 1; }],
    ['a card recharge value', (s) => { s.players.plants.recharge.peashooter = 59; }],
    ['a recharge of 0 versus absent', (s) => { delete s.players.plants.recharge.sunflower; }],
    ['a recharge on another card', (s) => { s.players.zombies.recharge.veryFastWalker = 1; }],
    ['baseHp.zombies', (s) => { s.baseHp.zombies -= 1; }],
    ['baseMaxHp', (s) => { s.baseMaxHp.zombies += 1; }],
    ['baseDefenseTimers[2]', (s) => { s.baseDefenseTimers[2] = 29; }],
    ['a base defence timer of 0 becoming 1', (s) => { s.baseDefenseTimers[0] = 1; }],
    ['base defence timers moved to another lane', (s) => { s.baseDefenseTimers = [12, 0, 30, 0, 5]; }],
    ['the number of base defence timers', (s) => { s.baseDefenseTimers.pop(); }],
    ['suddenDeath', (s) => { s.suddenDeath = true; }],
    ['winner', (s) => { s.winner = 'plants'; }],
    ['winner draw versus plants', (s) => { s.winner = 'draw'; }],
    ['unit count', (s) => { s.units.pop(); }],
    ['projectile count', (s) => { s.projectiles.pop(); }],
    ['config seed', (s) => { s.config.seed += 1; }],
    ['config startEnergy', (s) => { s.config.startEnergy.zombies += 1; }],
    ['config baseHp', (s) => { s.config.baseHp.plants += 1; }],
    ['config cards', (s) => { s.config.cards.plants = ['peashooter', 'sunflower']; }],
    ['config card order', (s) => { s.config.cards.zombies.reverse(); }],
    ['config incomeMultiplier', (s) => { s.config.incomeMultiplier.zombies = 1.5; }],
    ['config suddenDeath', (s) => { s.config.suddenDeath = false; }],
    ['unit array order', (s) => { s.units.reverse(); }],
    // The phase-1 fields the table above left out.
    ['a unit id', (s) => { unit(s, 0).id = 2; }],
    ['a projectile id', (s) => { s.projectiles[0]!.id += 1; }],
    ['a projectile faction', (s) => { s.projectiles[0]!.faction = 'zombies'; }],
    ['a projectile lane', (s) => { s.projectiles[0]!.lane = 3; }],
    ['a projectile speed', (s) => { s.projectiles[0]!.speed = 0.25; }],
    ['players.zombies.energy', (s) => { s.players.zombies.energy += 1; }],
    ['baseMaxHp.plants', (s) => { s.baseMaxHp.plants += 1; }],
    ['config.baseHp.zombies', (s) => { s.config.baseHp.zombies += 1; }],
    ['config.startEnergy.plants', (s) => { s.config.startEnergy.plants += 1; }],
    ['config.incomeMultiplier.plants', (s) => { s.config.incomeMultiplier.plants = 2; }],
    // The phase-2 unit fields.
    ['a unit stun', (s) => { unit(s, 1).stun -= 1; }],
    ['a unit blind', (s) => { unit(s, 0).blind -= 1; }],
    ['a unit tied', (s) => { unit(s, 1).tied -= 1; }],
    ['a unit poison', (s) => { unit(s, 1).poison -= 1; }],
    ['a unit poisonDps', (s) => { unit(s, 1).poisonDps += 1; }],
    ['a unit burn', (s) => { unit(s, 0).burn -= 1; }],
    ['a unit burnDps', (s) => { unit(s, 0).burnDps += 1; }],
    ['a unit stacks', (s) => { unit(s, 1).stacks += 1; }],
    ['a unit auraTimer', (s) => { unit(s, 1).auraTimer -= 1; }],
    ['a unit ownerId', (s) => { unit(s, 1).ownerId = 8; }],
    ['a unit ownerId null versus 0', (s) => { unit(s, 0).ownerId = 0; }],
    ['a unit ownerId set to null', (s) => { unit(s, 1).ownerId = null; }],
    // The phase-2 projectile fields.
    ['a projectile flight', (s) => { s.projectiles[0]!.flight = 'lobbed'; }],
    ['a projectile sourceKey', (s) => { s.projectiles[0]!.sourceKey = 'kernelPult'; }],
    ['a projectile level', (s) => { s.projectiles[0]!.level = 3; }],
    ['a projectile targetId', (s) => { s.projectiles[0]!.targetId = 1; }],
    ['a projectile targetId null', (s) => { s.projectiles[0]!.targetId = null; }],
    ['a projectile targetX', (s) => { s.projectiles[0]!.targetX = 6.5; }],
    ['a projectile targetX null', (s) => { s.projectiles[0]!.targetX = null; }],
    ['a projectile pierceLeft', (s) => { s.projectiles[0]!.pierceLeft = 1; }],
    ['a projectile hitIds entry', (s) => { s.projectiles[0]!.hitIds = [3]; }],
    ['the number of projectile hitIds', (s) => { s.projectiles[0]!.hitIds.push(3); }],
    ['a projectile burning flag', (s) => { s.projectiles[0]!.burning = false; }],
    ['a projectile burnDps', (s) => { s.projectiles[0]!.burnDps += 1; }],
    ['a projectile burnTicks', (s) => { s.projectiles[0]!.burnTicks -= 1; }],
    // Hazards.
    ['hazard count', (s) => { s.hazards.pop(); }],
    ['a hazard id', (s) => { s.hazards[0]!.id = 6; }],
    ['a hazard kind', (s) => { (s.hazards[0] as { kind: string }).kind = 'mud'; }],
    ['a hazard faction', (s) => { s.hazards[0]!.faction = 'plants'; }],
    ['a hazard lane', (s) => { s.hazards[0]!.lane = 2; }],
    ['a hazard x', (s) => { s.hazards[0]!.x += 0.001; }],
    ['a hazard radius', (s) => { s.hazards[0]!.radius = 1; }],
    ['a hazard ticksLeft', (s) => { s.hazards[0]!.ticksLeft -= 1; }],
    ['a hazard dps', (s) => { s.hazards[0]!.dps += 1; }],
    ['a hazard poisonTicks', (s) => { s.hazards[0]!.poisonTicks -= 1; }],
    // Hero powers.
    ['a player heroTimer', (s) => { s.players.zombies.heroTimer -= 1; }],
    ['a heroTimer of 0 becoming 1', (s) => { s.players.plants.heroTimer = 1; }],
    ['config heroes.plants', (s) => { s.config.heroes.plants = false; }],
    ['config heroes.zombies', (s) => { s.config.heroes.zombies = true; }],
    // Spells.
    ['a unit expires', (s) => { unit(s, 0).expires = 1; }],
    ['a unit haste', (s) => { unit(s, 1).haste -= 1; }],
    ['a unit hasteCarry', (s) => { unit(s, 1).hasteCarry = 0; }],
    ['a unit hurt', (s) => { unit(s, 1).hurt -= 1; }],
    ['a unit hurt of 0 becoming 1', (s) => { unit(s, 0).hurt = 1; }],
    ['a dealt spell key', (s) => { s.players.plants.spells[0]!.key = 'vines'; }],
    ['a dealt spell timer', (s) => { s.players.plants.spells[1]!.timer -= 1; }],
    ['the order of the dealt spells', (s) => { s.players.plants.spells.reverse(); }],
    ['the number of dealt spells', (s) => { s.players.zombies.spells.pop(); }],
    ['config spells.plants', (s) => { s.config.spells.plants = 1; }],
    ['config spells.zombies', (s) => { s.config.spells.zombies = 2; }],
    // Marketplace upgrades.
    ['config an upgrade level', (s) => { s.config.upgrades.plants.peashooter = 4; }],
    ['config an upgrade of 0 versus absent', (s) => { delete s.config.upgrades.plants.sunflower; }],
    ['config an upgrade on another card', (s) => { s.config.upgrades.plants.walnutBomb = 1; }],
    ['config upgrades moved to the other side', (s) => { s.config.upgrades = { plants: { brainEater: 10 } as never, zombies: { peashooter: 3, sunflower: 0 } as never }; }],
    ['config a zombie upgrade level', (s) => { s.config.upgrades.zombies.brainEater = 9; }],
    // Level modes.
    ['config mode', (s) => { s.config.mode = 'survive'; }],
    ['config the number of script entries', (s) => { s.config.script.pop(); }],
    ['config a script tick', (s) => { s.config.script[0]!.tick = 31; }],
    ['config a script unit', (s) => { s.config.script[0]!.unit = 'skeletonWarrior'; }],
    ['config a script faction', (s) => { s.config.script[0]!.faction = 'plants'; }],
    ['config a script lane', (s) => { s.config.script[0]!.lane = 2; }],
    ['config a script x', (s) => { s.config.script[0]!.x = 8; }],
    ['config a script x given versus absent', (s) => { delete s.config.script[0]!.x; }],
    ['config a script x absent versus given', (s) => { s.config.script[1]!.x = 9.5; }],
    ['config a script level', (s) => { s.config.script[1]!.level = 2; }],
    ['config the script order', (s) => { s.config.script.reverse(); }],
    ['config the number of prepared units', (s) => { s.config.prepared.pop(); }],
    ['config a prepared unit', (s) => { s.config.prepared[0]!.unit = 'peashooter'; }],
    ['config a prepared faction', (s) => { s.config.prepared[0]!.faction = 'zombies'; }],
    ['config a prepared lane', (s) => { s.config.prepared[0]!.lane = 0; }],
    ['config a prepared x', (s) => { s.config.prepared[0]!.x = 4.5; }],
    ['config a prepared level', (s) => { s.config.prepared[0]!.level = 3; }],
    ['config goalTicks', (s) => { s.config.goalTicks = 2699; }],
    ['config goalTicks null', (s) => { s.config.goalTicks = null; }],
    ['config belt null', (s) => { s.config.belt = null; }],
    ['config belt side', (s) => { s.config.belt!.side = 'zombies'; }],
    ['config belt everyTicks', (s) => { s.config.belt!.everyTicks = 91; }],
    ['config belt cards', (s) => { s.config.belt!.cards = ['walnutBomb', 'peashooter']; }],
    ['config the number of belt cards', (s) => { s.config.belt!.cards.pop(); }],
    ['config belt slots', (s) => { s.config.belt!.slots = 4; }],
    ['config noEnergy', (s) => { s.config.noEnergy = false; }],
    ['config invulnerableBase', (s) => { s.config.invulnerableBase = 'plants'; }],
    ['config invulnerableBase null', (s) => { s.config.invulnerableBase = null; }],
    ['scriptIndex', (s) => { s.scriptIndex = 2; }],
    ['a belt card', (s) => { s.belt[0] = 'walnutBomb'; }],
    ['the number of belt cards', (s) => { s.belt.push('peashooter'); }],
    ['an empty belt', (s) => { s.belt = []; }],
    // Bosses.
    ['a unit pattern', (s) => { unit(s, 1).pattern = 0; }],
    ['a unit pattern of 0 becoming 1', (s) => { unit(s, 0).pattern = 1; }],
    ['a unit patternTimer', (s) => { unit(s, 1).patternTimer -= 1; }],
    ['a unit shieldLeft', (s) => { unit(s, 1).shieldLeft -= 1; }],
    ['a unit phase', (s) => { unit(s, 1).phase = 1; }],
    ['config boss null', (s) => { s.config.boss = null; }],
    ['config boss key', (s) => { s.config.boss!.key = 'brainTitan'; }],
    ['config boss faction', (s) => { s.config.boss!.faction = 'zombies'; }],
    ['config boss lane', (s) => { s.config.boss!.lane = 1; }],
  ];

  it.each(mutations)('changes when %s changes', (_name, mutate) => {
    const before = hashState(makeState());
    const s = makeState();
    mutate(s);
    expect(hashState(s)).not.toBe(before);
  });

  it('does not depend on the insertion order of object keys', () => {
    const a = makeState();
    const b = makeState();
    b.players = {
      zombies: { spells: [{ timer: 12, key: 'fog' }], heroTimer: 700, recharge: { brainEater: 15 }, carry: 0, energy: 125 },
      plants: {
        spells: [{ timer: 0, key: 'thunderbolt' }, { timer: 300, key: 'rockWall' }],
        heroTimer: 0, recharge: { sunflower: 0, peashooter: 60 }, carry: 1234, energy: 175,
      },
    };
    b.baseHp = { zombies: 480, plants: 500 };
    b.config.incomeMultiplier = { zombies: 1.25, plants: 1 };
    b.config.upgrades = { zombies: { brainEater: 10 }, plants: { sunflower: 0, peashooter: 3 } };
    expect(hashState(b)).toBe(hashState(a));
  });

  it('treats -0 and 0 alike, as a JSON round trip does', () => {
    const a = makeState();
    const b = makeState();
    unit(a, 0).x = -0;
    unit(b, 0).x = 0;
    expect(hashState(a)).toBe(hashState(b));
  });
});

describe('snapshotState / restoreState', () => {
  it('round-trips to a deep-equal state with the same hash', () => {
    const s = makeState();
    const restored = restoreState(snapshotState(s));
    expect(restored).toEqual(s);
    expect(hashState(restored)).toBe(hashState(s));
  });

  it('round-trips a fractional x exactly, including 0.1 + 0.2', () => {
    const s = makeState();
    unit(s, 0).x = 0.1 + 0.2;
    s.projectiles[0]!.x = 1 / 3;
    const restored = restoreState(snapshotState(s));
    expect(unit(restored, 0).x).toBe(0.1 + 0.2);
    expect(restored.projectiles[0]!.x).toBe(1 / 3);
    expect(hashState(restored)).toBe(hashState(s));
  });

  it('round-trips the base defence timers', () => {
    const s = makeState();
    const restored = restoreState(snapshotState(s));
    expect(restored.baseDefenseTimers).toEqual([0, 12, 30, 0, 5]);
    expect(restored.baseDefenseTimers).not.toBe(s.baseDefenseTimers);
    expect(hashState(restored)).toBe(GOLDEN_HASH);
  });

  it('restores a snapshot made before the base defence existed with five timers at 0', () => {
    const old = JSON.parse(snapshotState(makeState())) as Record<string, unknown>;
    delete old.baseDefenseTimers;
    const snapshot = JSON.stringify(old);
    expect(snapshot).not.toContain('baseDefenseTimers');

    const restored = restoreState(snapshot);

    expect(restored.baseDefenseTimers).toEqual([0, 0, 0, 0, 0]);
    const expected = makeState();
    expected.baseDefenseTimers = [0, 0, 0, 0, 0];
    expect(restored).toEqual(expected);
    expect(hashState(restored)).toBe(hashState(expected));
  });

  it('round-trips every status, the flight fields of a projectile and the hazards', () => {
    const s = makeState();
    const restored = restoreState(snapshotState(s));
    expect(restored.units[0]).toMatchObject({ blind: 15, burn: 40, burnDps: 10, ownerId: null });
    expect(restored.units[1]).toMatchObject({ stun: 20, tied: 7, poison: 60, poisonDps: 15, stacks: 2, ownerId: 9, auraTimer: 33 });
    expect(restored.projectiles[0]).toMatchObject({
      flight: 'piercing', sourceKey: 'peashooter', level: 2, targetId: 3, targetX: 6.25, pierceLeft: 2, hitIds: [2], burning: true, burnDps: 20, burnTicks: 90,
    });
    expect(restored.hazards).toEqual(s.hazards);
    expect(restored.hazards).not.toBe(s.hazards);
    expect(hashState(restored)).toBe(GOLDEN_HASH);
  });

  it('restores a snapshot made before the Marketplace with no upgrades on either side', () => {
    const old = JSON.parse(snapshotState(makeState())) as { config: Record<string, unknown> };
    delete old.config.upgrades;
    const restored = restoreState(JSON.stringify(old));
    const expected = makeState();
    expected.config.upgrades = { plants: {}, zombies: {} };
    expect(restored).toEqual(expected);
    expect(hashState(restored)).toBe(hashState(expected));
  });

  it('round-trips the level fields and the belt', () => {
    const s = makeState();
    const restored = restoreState(snapshotState(s));
    expect(restored.config.script).toEqual(s.config.script);
    expect(Object.hasOwn(restored.config.script[1]!, 'x')).toBe(false);
    expect([restored.config.mode, restored.config.goalTicks, restored.config.belt, restored.config.noEnergy, restored.config.invulnerableBase])
      .toEqual(['conveyor', 2700, s.config.belt, true, 'zombies']);
    expect([restored.scriptIndex, restored.belt]).toEqual([1, ['peashooter']]);
    expect(hashState(restored)).toBe(GOLDEN_HASH);
  });

  it('round-trips the upgrades', () => {
    const restored = restoreState(snapshotState(makeState()));
    expect(restored.config.upgrades).toEqual({ plants: { peashooter: 3, sunflower: 0 }, zombies: { brainEater: 10 } });
    expect(hashState(restored)).toBe(GOLDEN_HASH);
  });

  const topLevelKeys = Object.keys(makeState()).filter((key) => key !== 'baseDefenseTimers');
  it.each(topLevelKeys)('refuses a snapshot with no %s', (key) => {
    const old = JSON.parse(snapshotState(makeState())) as Record<string, unknown>;
    delete old[key];
    expect(() => restoreState(JSON.stringify(old))).toThrow(key);
  });

  it('round-trips a finished match', () => {
    const s = makeState();
    s.winner = 'draw';
    s.suddenDeath = true;
    const restored = restoreState(snapshotState(s));
    expect(restored.winner).toBe('draw');
    expect(hashState(restored)).toBe(hashState(s));
  });

  it('returns an independent copy', () => {
    const s = makeState();
    const restored = restoreState(snapshotState(s));
    restored.units.length = 0;
    restored.players.plants.energy = 0;
    expect(s.units).toHaveLength(2);
    expect(s.players.plants.energy).toBe(175);
  });

  it('produces a JSON string', () => {
    expect(typeof snapshotState(makeState())).toBe('string');
    expect(() => JSON.parse(snapshotState(makeState()))).not.toThrow();
  });
});
