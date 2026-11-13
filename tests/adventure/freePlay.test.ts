import { describe, expect, it } from 'vitest';
import { FREE_PLAY, applyFreePlayResult, freePlayConfig, freePlayEnemyCards, wavesCleared } from '../../src/adventure/freePlay';
import { LEVELS } from '../../src/adventure/levels';
import { BALANCE } from '../../src/data/balance';
import { ALL_CARDS } from '../../src/data/units';
import { newSave } from '../../src/progress/save';
import type { Save } from '../../src/progress/save';
import { Match } from '../../src/sim/match';

// Task 7b: Free Play as the adventure layer sees it — the setup, the score, the reward.

const fresh = (): Save => newSave('p01', 'Kid', 'peashooter', 0);

describe('the Free Play setup', () => {
  it('survive (plants): endless zombie waves from 10 s, no clock, the zombie base safe, the zombies hold nothing', () => {
    const c = freePlayConfig(fresh(), 'plants', 7);
    expect(c).toMatchObject({
      mode: 'survive', goalTicks: null, invulnerableBase: 'zombies', suddenDeath: false, noEnergy: false,
      script: [], prepared: [], belt: null, boss: null,
      heroes: { plants: true, zombies: false }, spells: { plants: 2, zombies: 0 },
    });
    expect(c.endless).toEqual({ cards: ALL_CARDS.zombies.slice(0, 3), firstWaveTicks: FREE_PLAY.firstWaveSeconds * 30 });
    expect(c.cards).toEqual({ plants: ALL_CARDS.plants.slice(0, 3), zombies: [] });
    expect(c.upgrades.zombies).toEqual({});
    expect(() => new Match(c, BALANCE)).not.toThrow();
  });

  it('breakthrough (zombies): gardens from the first step, the plants hold nothing', () => {
    const c = freePlayConfig({ ...fresh(), slot: 'p02' }, 'zombies', 7);
    expect(c).toMatchObject({ mode: 'breakthrough', goalTicks: null, invulnerableBase: null, heroes: { plants: false, zombies: true }, spells: { plants: 0, zombies: 2 } });
    expect(c.endless).toEqual({ cards: ALL_CARDS.plants.slice(0, 3), firstWaveTicks: 0 });
    expect(c.cards.plants).toEqual([]);
    expect(() => new Match(c, BALANCE)).not.toThrow();
  });

  it('the player brings their unlocked cards, their Marketplace upgrades and their difficulty\'s income', () => {
    const save: Save = {
      ...fresh(), upgrades: { peashooter: 3, brainEater: 2 }, difficulty: { plants: 'easy', zombies: 'hard' },
      plants: { stars: {}, unlocked: ['potatoMine'] },
    };
    const c = freePlayConfig(save, 'plants', 1);
    expect(c.cards.plants).toEqual(['peashooter', 'sunflower', 'walnutBomb', 'potatoMine']);
    expect(c.upgrades).toEqual({ plants: { peashooter: 3 }, zombies: {} });
    expect(c.incomeMultiplier.plants).toBe(1.25);
  });

  it('the waves use the other side\'s cards the player has unlocked on that side or met in their own levels', () => {
    expect(freePlayEnemyCards(fresh(), 'plants')).toEqual(ALL_CARDS.zombies.slice(0, 3));
    const unlockedThere: Save = { ...fresh(), zombies: { stars: {}, unlocked: ['desertZombie'] } };
    expect(freePlayEnemyCards(unlockedThere, 'plants')).toEqual([...ALL_CARDS.zombies.slice(0, 3), 'desertZombie']);
    // p1-7 is played against the Desert Zombie: winning it means it was met.
    const stars = Object.fromEntries(LEVELS.filter((l) => l.side === 'plants').map((l) => [l.id, 1 as const]));
    const met = freePlayEnemyCards({ ...fresh(), plants: { stars, unlocked: ['potatoMine', 'kernelPult'] } }, 'plants');
    expect(met).toContain('desertZombie');
    expect(met.every((k) => ALL_CARDS.zombies.includes(k))).toBe(true);
    expect(new Set(met).size).toBe(met.length);
  });
});

describe('the score and the reward', () => {
  it('waves cleared: survive counts the waves before the one that broke through, breakthrough the gardens broken', () => {
    expect(wavesCleared('survive', 0)).toBe(0);
    expect(wavesCleared('survive', 3)).toBe(2);
    expect(wavesCleared('breakthrough', 3)).toBe(3);
  });

  it('pays 5 coins a wave cleared once per battle; bestWave only grows', () => {
    const save = { ...fresh(), bestWave: 4 };
    const a = applyFreePlayResult(save, { kind: 'free', battleId: 'b1', side: 'plants', wave: 3, cleared: 2 }, 10);
    expect(a.coins).toBe(10);
    expect(a.best).toBe(false);
    expect(a.save.bestWave).toBe(4);
    expect(a.save.coins).toBe(save.coins + 10);
    expect(a.save.lastBattle).toBe('b1');
    expect(a.save.updatedAt).toBe(10);
    const again = applyFreePlayResult(a.save, { kind: 'free', battleId: 'b1', side: 'plants', wave: 3, cleared: 2 }, 11);
    expect(again).toEqual({ save: a.save, coins: 0, best: false });
    const b = applyFreePlayResult(a.save, { kind: 'free', battleId: 'b2', side: 'plants', wave: 6, cleared: 5 }, 12);
    expect(b).toMatchObject({ coins: 25, best: true });
    expect(b.save.bestWave).toBe(6);
    expect(FREE_PLAY.coinsPerWave).toBe(5);
  });

  it('a breakthrough run counts towards bestGarden, not bestWave; the crown compares against its own best', () => {
    const save = { ...fresh(), bestWave: 9, bestGarden: 2 };
    const g = applyFreePlayResult(save, { kind: 'free', battleId: 'g1', side: 'zombies', wave: 3, cleared: 3 }, 10);
    expect(g).toMatchObject({ coins: 15, best: true });
    expect(g.save).toMatchObject({ bestGarden: 3, bestWave: 9 });
    const w = applyFreePlayResult(g.save, { kind: 'free', battleId: 'w1', side: 'plants', wave: 5, cleared: 4 }, 11);
    expect(w.best).toBe(false); // 5 waves do not beat survive's 9, whatever the gardens say
    expect(w.save).toMatchObject({ bestGarden: 3, bestWave: 9 });
  });
});
