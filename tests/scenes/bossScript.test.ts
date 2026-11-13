import { describe, expect, it } from 'vitest';
import { bossDemoMatch } from '../../src/scenes/bossScript';

describe('the boss demo script', () => {
  it.each([
    ['brainTitan', ['slam', 'summon', 'shield'], 'plants'],
    ['elderOak', ['barrage', 'summon', 'shield'], 'zombies'],
  ] as const)('%s: every pattern shows, and the boss falls within 80 s, its foes winning', (key, kinds, winner) => {
    for (const seed of [1, 2, 3]) {
      const m = bossDemoMatch(key, seed);
      const seen = new Set<string>();
      let defeated = false;
      while (m.state.winner === null && m.state.tick < 80 * 30) {
        for (const e of m.step()) {
          if (e.type === 'bossPattern') seen.add(e.kind);
          if (e.type === 'bossDefeated') defeated = true;
          if (e.type === 'commandRejected') throw new Error('refused');
        }
      }
      expect([...kinds].filter((k) => !seen.has(k)), `seed ${seed}`).toEqual([]);
      expect(defeated, `seed ${seed}`).toBe(true);
      expect(m.state.winner).toBe(winner);
    }
  });
});
