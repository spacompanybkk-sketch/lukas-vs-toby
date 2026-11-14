/** A `Storage` held in a Map, for tests; `throwing()` gives one whose every access throws. */
export class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }

  static throwing(): MemoryStorage {
    const s = new MemoryStorage();
    s.getItem = () => { throw new Error('SecurityError'); };
    s.setItem = () => { throw new Error('QuotaExceededError'); };
    s.removeItem = () => { throw new Error('SecurityError'); };
    return s;
  }
}
