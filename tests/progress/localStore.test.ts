import { describe, expect, it } from 'vitest';
import { lastSlot, loadLocal, saveLocal, setLastSlot } from '../../src/progress/localStore';
import { newSave } from '../../src/progress/save';
import { MemoryStorage } from './memoryStorage';

const T0 = 1_762_900_000_000;

describe('device copy', () => {
  it('round-trips a save under lvt2_save_<slot>', () => {
    const st = new MemoryStorage();
    const s = { ...newSave('p04', 'Ella', 'mangoPult', T0), coins: 77 };
    saveLocal(s, st);
    expect(st.getItem('lvt2_save_p04')).toBe(JSON.stringify(s));
    expect(loadLocal('p04', st)).toEqual(s);
    expect(loadLocal('p05', st)).toBeNull();
  });

  it('returns null for a corrupt or invalid copy', () => {
    const st = new MemoryStorage();
    st.setItem('lvt2_save_p04', '{oops');
    expect(loadLocal('p04', st)).toBeNull();
    st.setItem('lvt2_save_p04', JSON.stringify({ ...newSave('p04', 'Ella', 'mangoPult', T0), coins: -3 }));
    expect(loadLocal('p04', st)).toBeNull();
  });

  it('returns null when the copy under one slot belongs to another', () => {
    const st = new MemoryStorage();
    st.setItem('lvt2_save_p04', JSON.stringify(newSave('p09', 'Ella', 'mangoPult', T0)));
    expect(loadLocal('p04', st)).toBeNull();
  });

  it('remembers the last slot, and forgets it', () => {
    const st = new MemoryStorage();
    expect(lastSlot(st)).toBeNull();
    setLastSlot('p12', st);
    expect(st.getItem('lvt2_last_slot')).toBe('p12');
    expect(lastSlot(st)).toBe('p12');
    setLastSlot(null, st);
    expect(lastSlot(st)).toBeNull();
    st.setItem('lvt2_last_slot', 'p99');
    expect(lastSlot(st)).toBeNull();
  });

  it('survives a storage that throws', () => {
    const broken = MemoryStorage.throwing();
    const s = newSave('p01', 'Lukas', 'peashooter', T0);
    expect(() => saveLocal(s, broken)).not.toThrow();
    expect(loadLocal('p01', broken)).toBeNull();
    expect(() => setLastSlot('p01', broken)).not.toThrow();
    expect(() => setLastSlot(null, broken)).not.toThrow();
    expect(lastSlot(broken)).toBeNull();
  });

  it('does not throw without any storage (node has no localStorage)', () => {
    expect(loadLocal('p01')).toBeNull();
    expect(() => saveLocal(newSave('p01', 'Lukas', 'peashooter', T0))).not.toThrow();
    expect(lastSlot()).toBeNull();
  });
});
