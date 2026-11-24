import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { levelById } from '../../src/adventure/levels';
import { standInFor, standInSave } from '../../src/ai/levelChecks';
import { CHILD } from '../../src/ai/levelStandIns';
import { LANES } from '../../src/sim/types';
import { Match } from '../../src/sim/match';
import type { Command } from '../../src/sim/types';

/** Every command the child sends on `id` over `secs` seconds against an idle opponent, with its tick. */
function childSends(id: string, seed: number, secs: number): Array<{ tick: number; cmd: Command }> {
  const def = levelById(id)!;
  const m = new Match(levelConfig(def, standInSave('child', def), seed));
  const bot = standInFor(def, 'child', seed);
  const out: Array<{ tick: number; cmd: Command }> = [];
  for (let i = 0; i < secs * 30 && m.state.winner === null; i++) {
    const cmds = bot.think(m);
    for (const cmd of cmds) out.push({ tick: m.state.tick, cmd });
    m.step(cmds);
  }
  return out;
}

const cards = (sends: Array<{ tick: number; cmd: Command }>): Array<{ tick: number; lane: number }> =>
  sends.filter((s) => s.cmd.type === 'place').map((s) => ({ tick: s.tick, lane: (s.cmd as { lane: number }).lane }));

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

describe('the child stand-in (a measuring tool)', () => {
  it('is deterministic per seed, and different seeds play differently', () => {
    expect(childSends('z1-4', 7, 120)).toEqual(childSends('z1-4', 7, 120));
    expect(childSends('z1-4', 7, 120)).not.toEqual(childSends('z1-4', 8, 120));
  });

  it('sends in bursts of 2-3 cards within about a second or two, with an idle gap of at least 4 s between them', () => {
    const sizes: number[] = [];
    for (const seed of SEEDS) {
      const sends = cards(childSends('z1-4', seed, 150));
      expect(sends.length, `seed ${seed}`).toBeGreaterThan(0);
      let burst = [sends[0]!];
      const close = (last = false): void => {
        if (!last) sizes.push(burst.length); // the last burst may be cut off by the match ending
        expect(burst[burst.length - 1]!.tick - burst[0]!.tick, `seed ${seed}`).toBeLessThanOrEqual(CHILD.patience);
      };
      for (const s of sends.slice(1)) {
        const since = s.tick - burst[burst.length - 1]!.tick;
        if (since < 100) burst.push(s); // inside a burst (spacing 10 ticks, up to 45 more waiting for a recharge)
        else {
          expect(since, `seed ${seed}: gap before tick ${s.tick}`).toBeGreaterThanOrEqual(CHILD.gap.min);
          close();
          burst = [s];
        }
      }
      close(true);
    }
    expect(Math.max(...sizes)).toBeLessThanOrEqual(CHILD.burst.max);
    expect(sizes.filter((n) => n >= CHILD.burst.min).length / sizes.length).toBeGreaterThan(0.8);
  });

  it('uses its favourite lane at least 60% of the time', () => {
    // The favourite moves only every 20-40 s, so the first 19 s hold one favourite: its lane is the modal one.
    let share = 0;
    for (const seed of SEEDS) {
      const sends = cards(childSends('z1-4', seed, 19));
      const per = Array.from({ length: LANES }, (_, l) => sends.filter((s) => s.lane === l).length);
      share += Math.max(...per) / sends.length;
    }
    expect(share / SEEDS.length).toBeGreaterThanOrEqual(0.6);
  });

  it('never sends into all 5 lanes within one 10 s window', () => {
    for (const seed of SEEDS) {
      const sends = cards(childSends('z1-4', seed, 200));
      for (const a of sends) {
        const lanes = new Set(sends.filter((s) => s.tick >= a.tick && s.tick < a.tick + 300).map((s) => s.lane));
        expect(lanes.size, `seed ${seed} from tick ${a.tick}`).toBeLessThan(LANES);
      }
    }
  });

  it('on a conveyor level it plays the belt, in bursts too', () => {
    const kinds = new Set(childSends('z1-5', 3, 60).map((s) => s.cmd.type));
    expect(kinds.has('belt')).toBe(true);
    expect(kinds.has('place')).toBe(false);
  });
});
