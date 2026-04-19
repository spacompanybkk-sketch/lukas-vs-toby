export class EnergyManager {
  private energy: number;

  constructor(startingEnergy: number) {
    this.energy = startingEnergy;
  }

  getEnergy(): number { return this.energy; }

  spend(amount: number): boolean {
    if (amount > this.energy) return false;
    this.energy -= amount;
    return true;
  }

  addPassive(amount: number): void { this.energy += amount; }
  addKillReward(amount: number): void { this.energy += amount; }
  addFromProducer(amount: number): void { this.energy += amount; }
}
