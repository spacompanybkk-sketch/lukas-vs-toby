import { describe, expect, it } from 'vitest';
import { levelConfig } from '../../src/adventure/campaign';
import { levelById } from '../../src/adventure/levels';
import { standInSave } from '../../src/ai/levelChecks';
import { CHILD, DEFAULT_PACE, createLevelStandIn } from '../../src/ai/levelStandIns';
import { LANES } from '../../src/sim/types';
import { Match } from '../../src/sim/match';
import type { Command } from '../../src/sim/types';

/** Every command the child sends on `id` over `secs` seconds against an idle opponent, with its tick. */
function childSends(id: string, seed: number, secs: number, pace: number | null = DEFAULT_PACE): Array<{ tick: number; cmd: Command }> {
  const def = levelById(id)!;
  const m = new Match(levelConfig(def, standInSave('child', def), seed));
  const bot = createLevelStandIn('child', def.side, seed, { pace });
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

  it('the fast first child (pace null) sends in bursts of 2-3 cards within about a second or two, idle at least 4 s between them', () => {
    const sizes: number[] = [];
    for (const seed of SEEDS) {
      const sends = cards(childSends('z1-4', seed, 150, null));
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
    expect(sizes.filter((n) => n >= CHILD.burst.min).length / sizes.length).toBeGreaterThan(0.6);
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

  describe('the pace knob (a person who loses track of energy)', () => {
    /** Cards sent per minute of play over many seeds, and the share of single-card bursts. */
    function measure(pace: number | null): { perMinute: number; singles: number } {
      let n = 0;
      let ticks = 0;
      let bursts = 0;
      let singles = 0;
      for (const seed of SEEDS) {
        const def = levelById('z1-4')!;
        const m = new Match(levelConfig(def, standInSave('child', def), seed));
        const bot = createLevelStandIn('child', 'zombies', seed, { pace });
        const sends: number[] = [];
        // Keep the plant base alive and the match going: only the sends are counted, for 5 minutes at most.
        for (let i = 0; i < 9000 && m.state.winner === null; i++) {
          const cmds = bot.think(m);
          for (const c of cmds) if (c.type === 'place') sends.push(m.state.tick);
          m.step(cmds);
        }
        n += sends.length;
        ticks += m.state.tick;
        let size = 0;
        sends.forEach((t, k) => {
          size += 1;
          if (k === sends.length - 1 || sends[k + 1]! - t >= 100) { bursts += 1; if (size === 1) singles += 1; size = 0; }
        });
      }
      return { perMinute: n / (ticks / 1800), singles: singles / bursts };
    }

    it('a slower pace sends fewer cards a minute, in order, and the default is the slow-but-able child', () => {
      const rates = [5, 7, 9, 12].map((p) => measure(p).perMinute);
      for (let i = 1; i < rates.length; i++) expect(rates[i]!, rates.join(',')).toBeGreaterThan(rates[i - 1]!);
      expect(measure(null).perMinute).toBeGreaterThan(rates[3]!);
      expect(DEFAULT_PACE).toBe(6);
    });

    it('plays near its pace: within 35% of the target at 6 and 9 cards a minute', () => {
      for (const p of [6, 9]) expect(Math.abs(measure(p).perMinute - p) / p, `pace ${p}`).toBeLessThan(0.35);
    });

    it('about 20% of bursts are a single card, and the pace is deterministic per seed', () => {
      const { singles } = measure(DEFAULT_PACE);
      expect(singles).toBeGreaterThan(0.1);
      expect(singles).toBeLessThan(0.35);
      expect(childSends('z1-4', 5, 90, 6)).toEqual(childSends('z1-4', 5, 90, 6));
      expect(childSends('z1-4', 5, 90, 6)).not.toEqual(childSends('z1-4', 5, 90, 12));
    });

    it('a new lane catches its eye 2-4 s late', () => {
      expect([CHILD.reaction.min, CHILD.reaction.max]).toEqual([60, 120]);
    });
  });
});
