import { signal } from '@preact/signals';
import { afterEach, describe, expect, it } from 'vitest';
import { BattleSpeed, FAST, SPEED_KEY, forgetSpeed, lessonShowing, loadSpeed, saveSpeed } from '../../src/app/speed';
import type { GloveVM, TwistVM } from '../../src/app/tutorial';

class MemoryStorage implements Storage {
  readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

/** A storage whose every touch throws (Safari private mode, blocked site data). */
const broken = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
} as unknown as Storage;

afterEach(() => forgetSpeed());

describe('speed choice storage', () => {
  it('is off (1x) by default', () => {
    expect(loadSpeed(new MemoryStorage())).toBe(1);
    expect(loadSpeed(undefined)).toBe(1);
  });

  it('round-trips 2x under its own key on the device', () => {
    const s = new MemoryStorage();
    saveSpeed(FAST, s);
    expect(s.data.get(SPEED_KEY)).toBe('2');
    forgetSpeed();
    expect(loadSpeed(s)).toBe(2);
    saveSpeed(1, s);
    forgetSpeed();
    expect(loadSpeed(s)).toBe(1);
  });

  it('ignores anything else stored there', () => {
    const s = new MemoryStorage();
    s.setItem(SPEED_KEY, 'fast please');
    expect(loadSpeed(s)).toBe(1);
  });

  it('a blocked storage never throws, and the choice still holds for this visit', () => {
    expect(() => saveSpeed(FAST, broken)).not.toThrow();
    expect(loadSpeed(broken)).toBe(2);
  });
});

describe('BattleSpeed', () => {
  it('starts from the remembered choice and a toggle flips and saves it', () => {
    const s = new MemoryStorage();
    const a = new BattleSpeed({ offered: true, storage: s });
    expect(a.fast.value).toBe(false);
    expect(a.factor()).toBe(1);
    a.toggle();
    expect(a.fast.value).toBe(true);
    expect(a.factor()).toBe(FAST);
    // The next battle on this device starts at 2x.
    const b = new BattleSpeed({ offered: true, storage: s });
    expect(b.fast.value).toBe(true);
    b.toggle();
    expect(b.factor()).toBe(1);
    expect(new BattleSpeed({ offered: true, storage: s }).fast.value).toBe(false);
  });

  it('is not offered (a two-player Versus): never shown, always 1x, a toggle does nothing', () => {
    const s = new MemoryStorage();
    saveSpeed(FAST, s);
    const v = new BattleSpeed({ offered: false, storage: s });
    expect(v.shown.value).toBe(false);
    expect(v.factor()).toBe(1);
    v.toggle();
    expect(v.factor()).toBe(1);
    expect(s.data.get(SPEED_KEY)).toBe('2');
  });

  it('a lesson on screen hides the button and forces 1x; the choice comes back after it', () => {
    const lesson = signal(false);
    const sp = new BattleSpeed({ offered: true, lesson, storage: new MemoryStorage() });
    sp.toggle();
    expect(sp.shown.value).toBe(true);
    expect(sp.factor()).toBe(2);
    lesson.value = true;
    expect(sp.shown.value).toBe(false);
    expect(sp.factor()).toBe(1);
    // A tap that slips through while hidden changes nothing.
    sp.toggle();
    expect(sp.fast.value).toBe(true);
    // The button itself stays on screen, held (greyed), and comes back lit.
    expect(sp.held.value).toBe(true);
    lesson.value = false;
    expect(sp.held.value).toBe(false);
    expect(sp.shown.value).toBe(true);
    expect(sp.factor()).toBe(2);
  });
});

describe('lessonShowing', () => {
  it('is false without a tutorial', () => {
    expect(lessonShowing(null).value).toBe(false);
  });

  it('is true while the glove points (a step waits for the player) or a twist pan holds', () => {
    const glove = signal<GloveVM | null>(null);
    const twist = signal<TwistVM | null>(null);
    const on = lessonShowing({ glove, twist });
    expect(on.value).toBe(false);
    glove.value = { aim: { kind: 'hero' }, holding: true, step: 'p1-2.hero' };
    expect(on.value).toBe(true);
    glove.value = null;
    twist.value = { step: 'p2-1.fog', kind: 'fog', holding: true };
    expect(on.value).toBe(true);
    twist.value = null;
    expect(on.value).toBe(false);
  });
});
