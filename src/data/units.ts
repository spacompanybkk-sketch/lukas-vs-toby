import type { CardKey, Faction, PlantKey, UnitKey, ZombieKey } from '../sim/types';

export interface UnitInfo {
  key: CardKey;
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
const ROWS: Record<CardKey, { name: string; price: number; role: string }> = {
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

function buildInfo(): Record<CardKey, UnitInfo> {
  const info = {} as Record<CardKey, UnitInfo>;
  const add = (faction: Faction, keys: CardKey[]): void => {
    keys.forEach((key, unlockOrder) => {
      info[key] = { key, faction, ...ROWS[key], unlockOrder };
    });
  };
  add('plants', PLANT_KEYS);
  add('zombies', ZOMBIE_KEYS);
  return info;
}

/** Name, price, role and unlock order of every card. The Bone Minion is not a card and has none. */
export const UNIT_INFO: Record<CardKey, UnitInfo> = buildInfo();

/** The side of each unit that is not a card. */
const NON_CARD_FACTION: Record<Exclude<UnitKey, CardKey>, Faction> = {
  boneMinion: 'zombies', rock: 'plants', brainTitan: 'zombies', elderOak: 'plants',
  moonHowler: 'zombies', frostMelon: 'plants',
};

/** Which side a unit fights for: a card's own side, the zombies' for a Bone Minion, the Brain Titan and the Moon Howler, the plants' for a rock, the Elder Oak and the Frost Melon. */
export function factionOf(key: UnitKey): Faction {
  return isCard(key) ? UNIT_INFO[key].faction : NON_CARD_FACTION[key];
}

/** What a unit costs to play: a card's price, and 0 for a unit that is not a card. */
export function priceOf(key: UnitKey): number {
  return isCard(key) ? UNIT_INFO[key].price : 0;
}

/**
 * Whether a key is a card: one of the roster's own keys in `UNIT_INFO` (so the Bone Minion, or
 * any later unit that is no card, is not).
 */
export function isCard(key: UnitKey): key is CardKey {
  return Object.hasOwn(UNIT_INFO, key);
}

/** All ten cards of each side, in unlock order. */
export const ALL_CARDS: Record<Faction, CardKey[]> = {
  plants: [...PLANT_KEYS],
  zombies: [...ZOMBIE_KEYS],
};

/** The three cards each side has in Phase 1. */
export const PHASE1_CARDS: Record<Faction, CardKey[]> = {
  plants: ['peashooter', 'sunflower', 'walnutBomb'],
  zombies: ['brainEater', 'veryFastWalker', 'skeletonWarrior'],
};
