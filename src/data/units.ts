import type { Faction, PlantKey, UnitKey, ZombieKey } from '../sim/types';

export interface UnitInfo {
  key: UnitKey;
  faction: Faction;
  name: string;
  price: number;
  role: string;
  /** Position in the faction's unlock order, 0 = unlocked first. */
  unlockOrder: number;
}

/** Plants in unlock order (spec 6.6). */
export const PLANT_KEYS: PlantKey[] = [
  'peashooter', 'sunflower', 'walnutBomb', 'potatoMine', 'kernelPult',
  'mangoPult', 'avocadoBunker', 'torchwood', 'cherryBomber', 'pumpkinSquash',
];

/** Zombies in unlock order (spec 6.6). */
export const ZOMBIE_KEYS: ZombieKey[] = [
  'brainEater', 'veryFastWalker', 'skeletonWarrior', 'desertZombie', 'skeletonArcher',
  'hotTopic', 'cowboyZombie', 'necromancer', 'tridentZombie', 'brainRot',
];

/** Names, prices and roles are spec section 6.6 verbatim. */
const ROWS: Record<UnitKey, { name: string; price: number; role: string }> = {
  peashooter: { name: 'Peashooter', price: 100, role: 'Basic shooter' },
  sunflower: { name: 'Sunflower', price: 50, role: 'Income' },
  walnutBomb: { name: 'Walnut Bomb', price: 75, role: 'Wall' },
  potatoMine: { name: 'Potato Mine', price: 25, role: 'Trap' },
  kernelPult: { name: 'Kernel-pult', price: 75, role: 'Control' },
  mangoPult: { name: 'Mango-pult', price: 100, role: 'Area damage' },
  avocadoBunker: { name: 'Avocado Bunker', price: 125, role: 'Fortress' },
  torchwood: { name: 'Torchwood', price: 100, role: 'Support' },
  cherryBomber: { name: 'Cherry Bomber', price: 150, role: 'Removal' },
  pumpkinSquash: { name: 'Pumpkin Squash', price: 175, role: 'Bruiser' },
  brainEater: { name: 'Brain Eater', price: 100, role: 'Basic' },
  veryFastWalker: { name: 'Very Fast Walker', price: 50, role: 'Rush' },
  skeletonWarrior: { name: 'Skeleton Warrior', price: 125, role: 'Tank' },
  desertZombie: { name: 'Desert Zombie', price: 100, role: 'Control' },
  skeletonArcher: { name: 'Skeleton Archer', price: 100, role: 'Sniper' },
  hotTopic: { name: 'Hot Topic', price: 75, role: 'Snowball' },
  cowboyZombie: { name: 'Cowboy Zombie', price: 125, role: 'Disabler' },
  necromancer: { name: 'Necromancer', price: 150, role: 'Support' },
  tridentZombie: { name: 'Trident Zombie', price: 150, role: 'Siege' },
  brainRot: { name: 'Brain Rot', price: 175, role: 'Area denial' },
};

function buildInfo(): Record<UnitKey, UnitInfo> {
  const info = {} as Record<UnitKey, UnitInfo>;
  const add = (faction: Faction, keys: UnitKey[]): void => {
    keys.forEach((key, unlockOrder) => {
      info[key] = { key, faction, ...ROWS[key], unlockOrder };
    });
  };
  add('plants', PLANT_KEYS);
  add('zombies', ZOMBIE_KEYS);
  return info;
}

export const UNIT_INFO: Record<UnitKey, UnitInfo> = buildInfo();

/** The three cards each side has in Phase 1. */
export const PHASE1_CARDS: Record<Faction, UnitKey[]> = {
  plants: ['peashooter', 'sunflower', 'walnutBomb'],
  zombies: ['brainEater', 'veryFastWalker', 'skeletonWarrior'],
};
