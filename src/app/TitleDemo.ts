import { createBasicBot } from '../ai/basicBot';
import type { Bot } from '../ai/bot';
import { BattleView } from '../render/battle/BattleView';
import { Match, defaultConfig } from '../sim/match';
import type { Command } from '../sim/types';
import { FeelClock } from './Stage';
import type { Director, StageLike } from './Stage';
import { modelsFor } from './prewarm';

/** Seconds the finished demo match stays on screen before the next one starts. */
const REPLAY_AFTER = 4;

/**
 * The battle behind the title and side pick: Medium against Medium, silent, forever. A finished
 * match plays its end and then a fresh one starts with the next seed.
 */
export class TitleDemo implements Director {
  private readonly stage: StageLike;
  private seed: number;
  private match: Match | null = null;
  private view: BattleView | null = null;
  private bots: Bot[] = [];
  private readonly commands: Command[] = [];
  private readonly clock = new FeelClock();
  private endedFor = 0;
  private time = 0;

  constructor(stage: StageLike, seed = 11) {
    this.stage = stage;
    this.seed = seed;
  }

  /** Puts the demo on stage (a new match each time it comes back). */
  show(): void {
    if (this.stage.director === this) return;
    this.start();
    this.stage.show(this);
  }

  /** The demo's match, for tests and tools. */
  get current(): Match | null {
    return this.match;
  }

  /** Moves the demo match on by `ticks` steps with no drawing in between (tools, screenshots). */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  step(): void {
    const match = this.match;
    const view = this.view;
    if (!match || !view || match.state.winner !== null) return;
    this.commands.length = 0;
    for (const bot of this.bots) for (const c of bot.think(match)) this.commands.push(c);
    const events = match.step(this.commands);
    view.applyEvents(events, match.state);
    if (match.state.winner !== null) void view.celebrate(match.state.winner);
  }

  frame(alpha: number, realDt: number, gameDt: number): void {
    const match = this.match;
    const view = this.view;
    if (!match || !view) return;
    this.stage.timeScale = this.clock.tick(realDt);
    this.time += gameDt;
    view.frame(match.state, alpha, gameDt, this.time);
    if (match.state.winner !== null) {
      this.endedFor += realDt;
      if (this.endedFor > REPLAY_AFTER) {
        this.teardown();
        this.seed += 1;
        this.stage.fx.clear();
        this.stage.particles.clear();
        this.start();
      }
    }
  }

  detach(): void {
    this.teardown();
  }

  private start(): void {
    const match = new Match(defaultConfig(this.seed));
    this.match = match;
    this.bots = [createBasicBot('plants', 'medium', this.seed), createBasicBot('zombies', 'medium', this.seed + 1)];
    const view = new BattleView(this.stage.scene, this.stage.camera, this.stage.lawn, this.stage.fx, 'plants', {
      // Its cards, and the Bone Minion when Grave Rise is dealt: built now, not mid-demo.
      units: modelsFor(match.state),
    });
    // A demo shakes and slows like the real thing, but flies no tokens.
    view.onFeel = (f) => this.clock.feel(f, this.stage.rig);
    this.view = view;
    this.endedFor = 0;
    this.clock.reset();
  }

  private teardown(): void {
    this.view?.dispose();
    this.view = null;
    this.match = null;
    this.bots = [];
    this.clock.reset();
  }
}
