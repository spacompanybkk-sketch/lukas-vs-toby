import { describe, expect, it } from 'vitest';
import { PHASE1_CARDS, PLANT_KEYS, UNIT_INFO, ZOMBIE_KEYS } from '../../src/data/units';

// Spec section 6.6, written out literally: unit key -> [name, price, role], in unlock order.
const SPEC_PLANTS = [
  ['peashooter', 'Peashooter', 100, 'Basic shooter'],
  ['sunflower', 'Sunflower', 50, 'Income'],
  ['walnutBomb', 'Walnut Bomb', 75, 'Wall'],
  ['potatoMine', 'Potato Mine', 25, 'Trap'],
  ['kernelPult', 'Kernel-pult', 75, 'Control'],
  ['mangoPult', 'Mango-pult', 100, 'Area damage'],
  ['avocadoBunker', 'Avocado Bunker', 125, 'Fortress'],
  ['torchwood', 'Torchwood', 100, 'Support'],
  ['cherryBomber', 'Cherry Bomber', 150, 'Removal'],
  ['pumpkinSquash', 'Pumpkin Squash', 175, 'Bruiser'],
] as const;

const SPEC_ZOMBIES = [
  ['brainEater', 'Brain Eater', 100, 'Basic'],
  ['veryFastWalker', 'Very Fast Walker', 50, 'Rush'],
  ['skeletonWarrior', 'Skeleton Warrior', 125, 'Tank'],
  ['desertZombie', 'Desert Zombie', 100, 'Control'],
  ['skeletonArcher', 'Skeleton Archer', 100, 'Sniper'],
  ['hotTopic', 'Hot Topic', 75, 'Snowball'],
  ['cowboyZombie', 'Cowboy Zombie', 125, 'Disabler'],
  ['necromancer', 'Necromancer', 150, 'Support'],
  ['tridentZombie', 'Trident Zombie', 150, 'Siege'],
  ['brainRot', 'Brain Rot', 175, 'Area denial'],
] as const;

describe('unit roster', () => {
  it('has 10 keys per side and 20 units in all', () => {
    expect(PLANT_KEYS).toHaveLength(10);
    expect(ZOMBIE_KEYS).toHaveLength(10);
    expect(Object.keys(UNIT_INFO)).toHaveLength(20);
  });

  it('lists plants and zombies in the spec unlock order', () => {
    expect([...PLANT_KEYS]).toEqual(SPEC_PLANTS.map(([key]) => key));
    expect([...ZOMBIE_KEYS]).toEqual(SPEC_ZOMBIES.map(([key]) => key));
  });

  it.each([
    ['plants', SPEC_PLANTS],
    ['zombies', SPEC_ZOMBIES],
  ] as const)('%s: names, prices and roles equal spec 6.6 exactly', (faction, rows) => {
    for (const [key, name, price, role] of rows) {
      const info = UNIT_INFO[key];
      expect(info.key).toBe(key);
      expect(info.faction).toBe(faction);
      expect(info.name).toBe(name);
      expect(info.price).toBe(price);
      expect(info.role).toBe(role);
    }
  });

  it('numbers the unlock order 0..9 within each side, matching the key lists', () => {
    PLANT_KEYS.forEach((key, i) => expect(UNIT_INFO[key].unlockOrder).toBe(i));
    ZOMBIE_KEYS.forEach((key, i) => expect(UNIT_INFO[key].unlockOrder).toBe(i));
  });

  it('opens Phase 1 with the first three cards of each side', () => {
    expect(PHASE1_CARDS).toEqual({
      plants: ['peashooter', 'sunflower', 'walnutBomb'],
      zombies: ['brainEater', 'veryFastWalker', 'skeletonWarrior'],
    });
    expect(PHASE1_CARDS.plants).toEqual(PLANT_KEYS.slice(0, 3));
    expect(PHASE1_CARDS.zombies).toEqual(ZOMBIE_KEYS.slice(0, 3));
  });
});
