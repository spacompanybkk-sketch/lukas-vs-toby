export interface PlayerSave {
  tobyDollars: number;
  currentLevel: number;
  upgrades: Record<string, number>; // unitKey -> upgrade level (0-10)
}

const SAVE_KEY_PREFIX = 'lpvtz_save_';

export function loadSave(player: 'lukas' | 'toby'): PlayerSave {
  const key = `${SAVE_KEY_PREFIX}${player}`;
  const data = localStorage.getItem(key);
  if (data) return JSON.parse(data);
  return { tobyDollars: 0, currentLevel: 1, upgrades: {} };
}

export function saveSave(player: 'lukas' | 'toby', save: PlayerSave): void {
  localStorage.setItem(`${SAVE_KEY_PREFIX}${player}`, JSON.stringify(save));
}

/** Get effective stats for a unit based on upgrade level */
export function getUpgradeMultipliers(upgradeLevel: number): { hpMult: number; damageMult: number } {
  return {
    hpMult: 1 + upgradeLevel * 0.10,      // +10% per level
    damageMult: 1 + upgradeLevel * 0.08,   // +8% per level
  };
}

/** Cost to upgrade from current level to next */
export function getUpgradeCost(currentLevel: number): number {
  return (currentLevel + 1) * 100;
}
