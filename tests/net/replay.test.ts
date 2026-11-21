import { describe, expect, it } from 'vitest';
import { versusConfig } from '../../src/ai/versus';
import { Lockstep } from '../../src/net/lockstep';
import { REPLAY_SLICE_TICKS, replaySlice } from '../../src/net/replay';
import { Match } from '../../src/sim/match';
import type { Faction } from '../../src/sim/types';
import { SOAK_DELAY, run, soakPair, start } from './twoSims';

/** Spec 6.7 "Coming back (page reloaded)", 12 (frame cap): a rejoin replays from tick 0 headless, a slice a frame. */
describe('headless replay for rejoin', () => {
  it.each(['plants', 'zombies'] as const)('a fresh %s device replays the 3,000-odd stored ticks in six slices of 600 to the live hash', async (seat: Faction) => {
    const s = soakPair(4);
    start(s);
    const reached = () => s.peers.plants.lm.match.state.tick > 3000 && s.peers.zombies.lm.match.state.tick > 3000;
    await run(s, reached, 20 * 60_000);
    expect(reached()).toBe(true);
    // the rejoiner goes to where its own seat's live device stands (just past 3,000), and compares there
    const live = s.peers[seat].lm.match;
    const toTick = live.state.tick;
    expect(toTick).toBeLessThanOrEqual(3000 + 30);
    expect(live.state.winner).toBeNull();
    expect(s.peers.plants.hashes.get(3000)).toBe(s.peers.zombies.hashes.get(3000));

    // the rejoining device: a new Match from the same setup, its lockstep fed every stored turn
    const match = new Match(versusConfig(s.setup));
    const lockstep = new Lockstep({ seat, delay: SOAK_DELAY });
    let fed = 0;
    for (const [key, raw] of s.link.store) {
      const m = /^turns\/(plants|zombies)\/t(\d+)$/.exec(key);
      if (!m) continue;
      const owner = m[1] as Faction;
      const k = Number(m[2]);
      if (owner === seat) expect(lockstep.adoptOwn(k, raw)).toBe(true);
      else lockstep.receive(owner, k, raw);
      fed++;
    }
    expect(fed).toBeGreaterThanOrEqual(2 * 500);

    const answers: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      answers.push(replaySlice(match, { lockstep, toTick }, REPLAY_SLICE_TICKS));
      expect(match.state.tick).toBe(Math.min(toTick, (i + 1) * REPLAY_SLICE_TICKS));
    }
    expect(REPLAY_SLICE_TICKS).toBe(600);
    expect(answers).toEqual([false, false, false, false, false, true]);
    expect(match.hash()).toBe(live.hash());
    expect(match.hash()).not.toBe(new Match(versusConfig(s.setup)).hash()); // the replay did play something
    // a slice once there does nothing more
    expect(replaySlice(match, { lockstep, toTick }, REPLAY_SLICE_TICKS)).toBe(true);
    expect(match.state.tick).toBe(toTick);
  }, 120_000);

  it('stops at a tick whose turns are not held, and answers false', () => {
    const match = new Match(versusConfig({ seed: 1, seats: { plants: 'p01', zombies: 'p02' }, head: null }));
    const lockstep = new Lockstep({ seat: 'plants', delay: 12 });
    for (let k = 0; k < 10; k++) {
      lockstep.adoptOwn(k, '{}');
      if (k < 5) lockstep.receive('zombies', k, '{}');
    }
    expect(replaySlice(match, { lockstep, toTick: 60 }, REPLAY_SLICE_TICKS)).toBe(false);
    expect(match.state.tick).toBe(30); // turns 0..4 of both seats: ticks 0..29
  });
});
