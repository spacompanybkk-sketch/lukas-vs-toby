import { HASH_RING } from './timeouts';

/** The newest own state hashes by tick (spec 6.5): the oldest falls out once `size` are held. */
export class HashRing {
  private readonly size: number;
  private readonly byTick = new Map<number, number>(); // insertion order = age

  constructor(size: number = HASH_RING) {
    this.size = size;
  }

  put(tick: number, hash: number): void {
    this.byTick.delete(tick);
    this.byTick.set(tick, hash);
    while (this.byTick.size > this.size) this.byTick.delete(this.byTick.keys().next().value!);
  }

  get(tick: number): number | undefined {
    return this.byTick.get(tick);
  }

  /** The highest tick held and its hash, or null when empty. */
  newest(): readonly [number, number] | null {
    let best: [number, number] | null = null;
    for (const [tick, hash] of this.byTick) if (!best || tick > best[0]) best = [tick, hash];
    return best;
  }

  clear(): void {
    this.byTick.clear();
  }
}
