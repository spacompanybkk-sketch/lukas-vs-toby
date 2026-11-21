import { describe, expect, it } from 'vitest';
import { BattleController, REFUSED_MARK_STEPS } from '../../src/app/BattleController';
import { versusConfig, type VersusSetup } from '../../src/ai/versus';
import { priceOf } from '../../src/data/units';
import { LockstepMatch } from '../../src/net/lockstepMatch';
import { memoryPair } from '../../src/net/memoryChannel';
import { VirtualClock } from '../../src/net/virtualClock';
import { Match } from '../../src/sim/match';
import { LANES, PLANT_COLS, type Faction } from '../../src/sim/types';

const SETUP: VersusSetup = { seed: 1, seats: { plants: 'p01', zombies: 'p02' }, head: null };
const FRAME = 1000 / 30;
const DELAY = 12;
const other = (f: Faction): Faction => (f === 'plants' ? 'zombies' : 'plants');

interface Peer {
  link: LockstepMatch;
  c: BattleController;
  /** `match.hash()` whenever a step ended on a multiple of 30, by tick. */
  hashes: Map<number, number>;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/**
 * Two online controllers on one in-memory database: p01 plays plants and hosts, p02 zombies.
 * `energy` replaces both sides' start energy; `started` says which devices start their link.
 */
function duo({ energy, latency = 50, started = ['plants', 'zombies'] }: { energy?: number; latency?: number; started?: Faction[] } = {}) {
  const clock = new VirtualClock();
  const db = memoryPair({ clock, latencyMs: latency });
  const make = (seat: Faction): Peer => {
    const config = versusConfig(SETUP);
    if (energy !== undefined) config.startEnergy = { plants: energy, zombies: energy };
    const me = SETUP.seats[seat];
    const them = SETUP.seats[other(seat)];
    const link = new LockstepMatch({
      match: new Match(config), seat, delay: DELAY, host: seat === 'plants', me, other: them,
      channel: db[seat], now: () => clock.now(), timers: clock,
    });
    const c = new BattleController({ playerFaction: seat, skill: 'easy', seed: SETUP.seed, versus: true, online: { link, me, other: them } });
    return { link, c, hashes: new Map() };
  };
  const a = make('plants');
  const b = make('zombies');
  for (const p of [a, b]) if (started.includes(p.link.seat)) p.link.start();
  const frame = async (peers: Peer[] = [a, b]) => {
    clock.advance(FRAME);
    await flush();
    for (const p of peers) {
      p.c.step();
      const { tick } = p.c.match.state;
      if (tick % 30 === 0) p.hashes.set(tick, p.c.match.hash());
    }
    await flush();
  };
  const frames = async (n: number, peers?: Peer[]) => { for (let i = 0; i < n; i++) await frame(peers); };
  const until = async (done: () => boolean, max = 600) => {
    for (let i = 0; i < max && !done(); i++) await frame();
    expect(done()).toBe(true);
  };
  return { clock, db, a, b, frame, frames, until };
}

const plantsOf = (c: BattleController) => c.match.state.units.filter((u) => u.faction === 'plants');
const tiles = (): { lane: number; col: number }[] => {
  const out: { lane: number; col: number }[] = [];
  for (let col = 0; col < PLANT_COLS; col++) for (let lane = 0; lane < LANES; lane++) out.push({ lane, col });
  return out;
};

/** Both have run past `tick`, and every hash both hold agrees. */
function sameHashes(a: Peer, b: Peer): number {
  let compared = 0;
  for (const [tick, hash] of a.hashes) {
    const theirs = b.hashes.get(tick);
    if (theirs === undefined) continue;
    expect(theirs, `hash at tick ${tick}`).toBe(hash);
    compared++;
  }
  return compared;
}

describe('BattleController online seat', () => {
  it('makes no bot: with the other seat silent the match stays at tick 0, and the stall reaches the face after 3 s', async () => {
    const { a, frames } = duo({ started: ['plants'] });
    expect(a.c.online).not.toBeNull();
    for (let i = 0; i < 40; i++) {
      await frames(1, [a]);
      expect(a.c.step()).toEqual([]);
    }
    expect(a.c.match.state.tick).toBe(0);
    expect(a.c.match.state.units).toHaveLength(0); // no computer played the zombies
    expect(a.c.online!.stall.value).toBe('hourglass');
    await frames(70, [a]);
    expect(a.c.match.state.tick).toBe(0);
    expect(a.c.online!.stall.value).toBe('face');
  });

  it('a tap answers null, waits in pending, runs at tick + delay on both screens', async () => {
    const { a, b, frame, until } = duo();
    a.c.select('peashooter');
    const tick = a.c.match.state.tick;
    expect(a.c.click({ lane: 2, col: 1 }, null)).toBeNull();
    const pending = a.c.online!.pending.value;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ faction: 'plants', lane: 2, col: 1, unit: 'peashooter', spell: null, refused: false });
    expect(b.c.online!.pending.value).toHaveLength(0); // the other screen shows only its own
    await frame();
    expect(plantsOf(a.c)).toHaveLength(0); // not on the next step
    await until(() => a.c.match.state.tick > tick + DELAY);
    const placed = plantsOf(a.c);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ key: 'peashooter', lane: 2 });
    expect(a.c.online!.pending.value).toHaveLength(0);
    await until(() => b.c.match.state.tick > tick + DELAY);
    expect(plantsOf(b.c)).toHaveLength(1);
    expect(plantsOf(b.c)[0]).toMatchObject({ key: 'peashooter', lane: 2 });
  });

  it('the energy shown is the state energy minus the pending spend while the tap waits', async () => {
    const { a, until } = duo();
    const start = a.c.match.state.players.plants.energy;
    a.c.select('peashooter');
    expect(a.c.click({ lane: 0, col: 0 }, null)).toBeNull();
    expect(a.link.pendingSpend()).toBe(priceOf('peashooter'));
    expect(a.c.hud.energy.value).toBe(start - priceOf('peashooter'));
    expect(a.c.hud.cards.value.find((c) => c.unit === 'peashooter')?.affordable).toBe(start - priceOf('peashooter') >= priceOf('peashooter'));
    await until(() => a.c.online!.pending.value.length === 0);
    expect(a.link.pendingSpend()).toBe(0);
    expect(a.c.hud.energy.value).toBe(a.c.match.state.players.plants.energy);
  });

  describe('Review Focus 1: the tap guards of one turn', () => {
    it('nine taps in one turn: eight answer null, the ninth is ignored with a denial; both screens agree afterwards', async () => {
      const { a, b, until } = duo({ energy: 2000 });
      a.c.select('potatoMine');
      const free = tiles();
      const answers = free.slice(0, 9).map((t) => a.c.click(t, null));
      expect(answers.slice(0, 8)).toEqual(Array(8).fill(null));
      expect(answers[8]).toBe('ignored');
      expect(a.c.hud.denied.value).toBe(1);
      expect(a.c.online!.pending.value).toHaveLength(8);
      await until(() => a.c.match.state.tick >= 120 && b.c.match.state.tick >= 120);
      expect(sameHashes(a, b)).toBeGreaterThanOrEqual(4);
    });

    it('taps whose price with the pending spend passes the energy answer no-energy; the energy shown never goes below 0', async () => {
      const { a, b, until } = duo();
      const start = a.c.match.state.players.plants.energy; // 190
      const price = priceOf('peashooter');
      a.c.select('peashooter');
      const free = tiles();
      let accepted = 0;
      for (let i = 0; i < 4; i++) {
        const answer = a.c.click(free[i]!, null);
        if (start - accepted * price >= price) {
          expect(answer).toBeNull();
          accepted++;
        } else {
          expect(answer).toBe('no-energy');
        }
        expect(a.c.hud.energy.value).toBeGreaterThanOrEqual(0);
      }
      expect(accepted).toBe(Math.floor(start / price));
      expect(a.c.hud.denied.value).toBe(4 - accepted);
      await until(() => a.c.match.state.tick >= 90 && b.c.match.state.tick >= 90);
      expect(a.c.hud.energy.value).toBeGreaterThanOrEqual(0);
      expect(sameHashes(a, b)).toBeGreaterThanOrEqual(3);
    });

    it('a second plant tapped onto a tile holding a pending plant answers occupied', async () => {
      const { a, b, until } = duo({ energy: 2000 });
      a.c.select('potatoMine');
      expect(a.c.click({ lane: 1, col: 2 }, null)).toBeNull();
      a.c.select('sunflower');
      expect(a.c.click({ lane: 1, col: 2 }, null)).toBe('occupied');
      expect(a.c.hud.denied.value).toBe(1);
      expect(a.c.online!.pending.value).toHaveLength(1);
      await until(() => a.c.match.state.tick >= 60 && b.c.match.state.tick >= 60);
      expect(plantsOf(a.c)).toHaveLength(1);
      expect(sameHashes(a, b)).toBeGreaterThanOrEqual(2);
    });
  });

  it('a tap refused when it runs flips its mark to refused, counts a denial, and the mark goes after 600 ms', async () => {
    const { a, b, frame, until } = duo({ energy: 2000 });
    a.c.select('potatoMine');
    // the same card twice before either runs: the second finds the card recharging when it runs
    expect(a.c.click({ lane: 0, col: 0 }, null)).toBeNull();
    expect(a.c.click({ lane: 3, col: 0 }, null)).toBeNull();
    expect(a.c.hud.denied.value).toBe(0);
    const [, second] = a.c.online!.pending.value;
    await until(() => a.c.online!.pending.value.some((m) => m.refused));
    expect(a.c.hud.denied.value).toBe(1);
    expect(a.c.online!.pending.value).toEqual([{ ...second!, refused: true }]);
    expect(plantsOf(a.c)).toHaveLength(1);
    for (let i = 1; i < REFUSED_MARK_STEPS; i++) await frame();
    expect(a.c.online!.pending.value).toHaveLength(1);
    await frame();
    expect(a.c.online!.pending.value).toHaveLength(0);
    expect(a.c.hud.denied.value).toBe(1);
    await until(() => b.c.match.state.tick >= a.c.match.state.tick);
    expect(plantsOf(b.c)).toHaveLength(1);
  });

  it('pause is shared: one pauses, the other sees who; the other resumes both', async () => {
    const { a, b, frames, until } = duo();
    await frames(10);
    a.c.setPaused(true);
    expect(a.c.hud.paused.value).toBe(true);
    expect(a.c.online!.pausedBy.value).toBe('p01');
    await until(() => b.c.online!.pausedBy.value === 'p01');
    expect(b.c.hud.paused.value).toBe(true);
    const ticks = [a.c.match.state.tick, b.c.match.state.tick];
    await frames(30);
    expect([a.c.match.state.tick, b.c.match.state.tick]).toEqual(ticks);
    b.c.setPaused(false);
    expect(b.c.hud.paused.value).toBe(false);
    await until(() => !a.c.hud.paused.value);
    expect(a.c.online!.pausedBy.value).toBeNull();
    await frames(30);
    expect(a.c.match.state.tick).toBeGreaterThan(ticks[0]!);
    expect(b.c.match.state.tick).toBeGreaterThan(ticks[1]!);
  });

  it('the space key pauses and resumes through the same path', async () => {
    const { a, b, frames, until } = duo();
    await frames(5);
    a.c.hotkey(' ');
    expect(a.c.online!.pausedBy.value).toBe('p01');
    await until(() => b.c.hud.paused.value);
    b.c.hotkey(' ');
    await until(() => !a.c.hud.paused.value);
    expect(b.c.online!.pausedBy.value).toBeNull();
  });

  it('a won outcome sets the result on both screens', async () => {
    const { a, b, until } = duo();
    for (const p of [a, b]) p.c.match.state.baseHp.zombies = 0; // both states end at the first tick
    await until(() => a.c.online!.outcome.value !== null && b.c.online!.outcome.value !== null);
    expect(a.c.online!.outcome.value).toEqual({ kind: 'won', winner: 'plants' });
    expect(a.c.hud.result.value).toEqual({ winner: 'plants', playerWon: true });
    expect(b.c.hud.result.value).toEqual({ winner: 'plants', playerWon: false });
  });

  it('forfeit settles through the end slots, not at once: the other seat wins on both screens', async () => {
    const { a, b, frames, until } = duo();
    await frames(10);
    b.c.forfeit();
    expect(b.c.hud.result.value).toBeNull();
    await until(() => a.c.hud.result.value !== null && b.c.hud.result.value !== null);
    expect(b.c.online!.outcome.value).toEqual({ kind: 'forfeit', winner: 'plants', by: 'p02' });
    expect(a.c.hud.result.value).toEqual({ winner: 'plants', playerWon: true });
    expect(b.c.hud.result.value).toEqual({ winner: 'plants', playerWon: false });
  });

  it('giving up ends the match unfinished: no result, the outcome set, no more input', async () => {
    const { a, b, frames, until } = duo();
    await frames(10);
    a.c.giveUp();
    await until(() => a.c.online!.outcome.value !== null && b.c.online!.outcome.value !== null);
    expect(a.c.online!.outcome.value).toEqual({ kind: 'unfinished', why: 'flag' });
    expect(b.c.online!.outcome.value).toMatchObject({ kind: 'unfinished' });
    expect(a.c.hud.result.value).toBeNull();
    expect(b.c.hud.result.value).toBeNull();
    a.c.select('peashooter');
    expect(a.c.click({ lane: 0, col: 0 }, null)).toBe('match-over');
  });

  it('an end record that credits nobody (broken) leaves the result null', async () => {
    const { a, b, db, until } = duo();
    // the other device's match broke: its slot says so, and nobody wins
    void db.zombies.write({ kind: 'end', seat: 'zombies', raw: JSON.stringify({ w: 'broken', t: 0, h: 0 }) });
    await until(() => a.c.online!.outcome.value !== null && b.c.online!.outcome.value !== null);
    expect(a.c.online!.outcome.value).toMatchObject({ kind: 'unfinished' });
    expect(a.c.hud.result.value).toBeNull();
    expect(b.c.hud.result.value).toBeNull();
  });

  it('refuses an online seat with a level, Free Play, outside Versus, or on the other side', () => {
    const clock = new VirtualClock();
    const db = memoryPair({ clock, latencyMs: 10 });
    const link = new LockstepMatch({
      match: new Match(versusConfig(SETUP)), seat: 'plants', delay: DELAY, host: true, me: 'p01', other: 'p02',
      channel: db.plants, now: () => clock.now(), timers: clock,
    });
    const online = { link, me: 'p01', other: 'p02' } as const;
    const base = { playerFaction: 'plants', skill: 'easy', seed: 1, versus: true, online } as const;
    expect(() => new BattleController({ ...base, playerFaction: 'zombies' })).toThrow();
    expect(() => new BattleController({ ...base, versus: false })).toThrow();
    expect(() => new BattleController({ ...base, play: {} as never })).toThrow();
    expect(() => new BattleController({ ...base, free: {} as never })).toThrow();
    expect(() => new BattleController(base)).not.toThrow();
  });

  it('outside two-device Versus there are no online signals, and forfeit and giveUp do nothing', () => {
    const c = new BattleController({ playerFaction: 'plants', skill: 'easy', seed: 7 });
    expect(c.online).toBeNull();
    c.forfeit();
    c.giveUp();
    expect(c.hud.result.value).toBeNull();
  });
});
