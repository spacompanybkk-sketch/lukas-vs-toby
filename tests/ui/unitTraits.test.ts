import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '../../src/data/units';
import { unitTraits } from '../../src/ui/unitTraits';

const words = (k: Parameters<typeof unitTraits>[0]): string[] => unitTraits(k).map((t) => t.word);

describe('unitTraits', () => {
  const cards = [...ALL_CARDS.plants, ...ALL_CARDS.zombies];

  it('every card unit has 2-3 traits, each a 1-2 word Title Case word with a picture', () => {
    expect(cards).toHaveLength(20);
    for (const k of cards) {
      const t = unitTraits(k);
      expect(t.length, k).toBeGreaterThanOrEqual(2);
      expect(t.length, k).toBeLessThanOrEqual(3);
      expect(new Set(t.map((x) => x.word)).size, k).toBe(t.length);
      for (const x of t) {
        expect(x.word.trim(), k).not.toBe('');
        expect(x.word.split(' ').length, k).toBeLessThanOrEqual(2);
        expect(x.word.split(' ').every((w) => /^[A-Z]/.test(w)), `${k} ${x.word}`).toBe(true);
        expect(x.icon, k).toBeDefined();
      }
    }
  });

  it('the first trait is the role as a kid word', () => {
    expect(words('peashooter')[0]).toBe('Shooter');
    expect(words('skeletonWarrior')[0]).toBe('Tank');
    expect(words('veryFastWalker')[0]).toBe('Rusher');
  });

  it('a tank is Tough; a fast zombie is Fast; a frail one says Low HP', () => {
    expect(words('skeletonWarrior')).toContain('Tough');
    expect(words('walnutBomb')).toContain('Tough');
    expect(words('veryFastWalker')).toContain('Fast');
    expect(words('tridentZombie')).toContain('Slow');
    expect(words('sunflower')).toContain('Low HP');
  });

  it('is pure: the same unit gives the same traits', () => {
    expect(words('mangoPult')).toEqual(words('mangoPult'));
  });
});
