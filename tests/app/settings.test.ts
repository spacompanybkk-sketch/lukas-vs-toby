import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/app/settings';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

describe('settings', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({ music: 0.6, sfx: 0.8, muted: false, quality: 'high' });
  });

  it('returns defaults when storage is empty', () => {
    expect(loadSettings(new MemoryStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it('does not throw without any storage (node has no localStorage)', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });

  it('round-trips under the key lvt2_settings', () => {
    const s = new MemoryStorage();
    const mine = { music: 0.25, sfx: 1, muted: true, quality: 'low' as const };
    saveSettings(mine, s);
    expect(s.getItem('lvt2_settings')).not.toBeNull();
    expect(loadSettings(s)).toEqual(mine);
  });

  it('falls back to defaults on malformed JSON', () => {
    const s = new MemoryStorage();
    s.setItem('lvt2_settings', '{not json');
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    s.setItem('lvt2_settings', '42');
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    s.setItem('lvt2_settings', 'null');
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back field by field for out-of-range or wrong-typed values', () => {
    const s = new MemoryStorage();
    s.setItem('lvt2_settings', JSON.stringify({ music: 3, sfx: 0.1, muted: 'yes', quality: 'ultra' }));
    expect(loadSettings(s)).toEqual({ music: 0.6, sfx: 0.1, muted: false, quality: 'high' });
    s.setItem('lvt2_settings', JSON.stringify({ music: -0.1, sfx: Number.NaN, muted: true, quality: 'medium' }));
    expect(loadSettings(s)).toEqual({ music: 0.6, sfx: 0.8, muted: true, quality: 'medium' });
  });

  it('survives a storage that throws', () => {
    const broken = new MemoryStorage();
    broken.getItem = () => { throw new Error('SecurityError'); };
    broken.setItem = () => { throw new Error('QuotaExceeded'); };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
  });
});
