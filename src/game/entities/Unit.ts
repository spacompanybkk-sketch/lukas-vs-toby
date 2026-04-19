import type { Faction } from '../types';

export class UnitState {
  public readonly id: string;
  public readonly key: string;
  public readonly faction: Faction;
  public maxHp: number;
  public damage: number;
  public readonly attackSpeed: number;
  public readonly range: number;
  public readonly moveSpeed: number;
  public hp: number;
  public row: number = 0;
  public col: number = 0;
  private lastAttackTime: number = -Infinity;

  constructor(
    id: string, key: string, faction: Faction,
    hp: number, damage: number, attackSpeed: number,
    range: number, moveSpeed: number,
  ) {
    this.id = id;
    this.key = key;
    this.faction = faction;
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

  /** Apply upgrade multipliers to HP and damage */
  applyUpgrade(hpMult: number, damageMult: number): void {
    this.maxHp = Math.round(this.maxHp * hpMult);
    this.hp = this.maxHp;
    this.damage = Math.round(this.damage * damageMult);
  }
}
