import type { Timers } from './channel';

interface Due { at: number; seq: number; fn: () => void }

/** A clock for tests: time moves only on `advance`, which runs the timers that fall due, in order. */
export class VirtualClock implements Timers {
  private t = 0;
  private seq = 0;
  private readonly due = new Map<number, Due>();

  now(): number {
    return this.t;
  }

  set(fn: () => void, ms: number): unknown {
    const handle = ++this.seq;
    this.due.set(handle, { at: this.t + Math.max(0, ms), seq: handle, fn });
    return handle;
  }

  clear(handle: unknown): void {
    this.due.delete(handle as number);
  }

  /** Moves time forward by `ms`, running each timer at its own time (timers set meanwhile included). */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: Due | null = null;
      for (const d of this.due.values()) {
        if (d.at <= end && (!next || d.at < next.at || (d.at === next.at && d.seq < next.seq))) next = d;
      }
      if (!next) break;
      this.due.delete(next.seq);
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = end;
  }
}
