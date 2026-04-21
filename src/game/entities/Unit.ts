import type { Faction } from '../types';

export const MAX_UNIT_LEVEL = 5;

export class UnitState {
  public readonly id: string;
  public readonly key: string;
  public readonly faction: Faction;
  public maxHp: number;
  public damage: number;
  public attackSpeed: number;
  public readonly range: number;
  public readonly moveSpeed: number;
  public hp: number;
  public row: number = 0;
  public col: number = 0;
  public level: number = 1;
  private lastAttackTime: number = -Infinity;

  // Base stats preserved for level-up recalculation
  public readonly baseHp: number;
  public readonly baseDamage: number;
  public readonly baseAttackSpeed: number;

  constructor(
    id: string, key: string, faction: Faction,
    hp: number, damage: number, attackSpeed: number,
    range: number, moveSpeed: number,
  ) {
    this.id = id;
    this.key = key;
    this.faction = faction;
    this.baseHp = hp;
    this.baseDamage = damage;
    this.baseAttackSpeed = attackSpeed;
    this.maxHp = hp;
    this.hp = hp;
    this.damage = damage;
    this.attackSpeed = attackSpeed;
    this.range = range;
    this.moveSpeed = moveSpeed;
  }

  takeDamage(amount: number): void { this.hp = Math.max(0, this.hp - amount); }
  isAlive(): boolean { return this.hp > 0; }
  setPosition(row: number, col: number): void { this.row = row; this.col = col; }
  canAttack(currentTime: number): boolean {
    if (this.attackSpeed === 0) return false;
    return currentTime - this.lastAttackTime >= this.attackSpeed;
  }
  recordAttack(currentTime: number): void { this.lastAttackTime = currentTime; }
  isStationary(): boolean { return this.moveSpeed === 0; }

  /** Apply marketplace upgrade multipliers to HP and damage */
  applyUpgrade(hpMult: number, damageMult: number): void {
    this.maxHp = Math.round(this.maxHp * hpMult);
    this.hp = this.maxHp;
    this.damage = Math.round(this.damage * damageMult);
  }

  /** Level up: preserve HP percentage, scale all combat stats by new level */
  levelUp(): void {
    if (this.level >= MAX_UNIT_LEVEL) return;
    const hpPercent = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.level += 1;
    this.maxHp = this.baseHp * this.level;
    this.hp = Math.round(this.maxHp * hpPercent);
    this.damage = this.baseDamage * this.level;
    this.attackSpeed = this.baseAttackSpeed > 0
      ? Math.round(this.baseAttackSpeed / this.level)
      : 0;
  }

  /** Get the texture key for this unit's current level */
  getTextureKey(): string {
    return this.level > 1 ? `${this.key}-L${this.level}` : this.key;
  }
}
