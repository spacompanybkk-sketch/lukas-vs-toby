/**
 * A stand-in for the Web Audio API with just the node types `src/audio` uses. It makes no sound.
 * It records every node created, what it is connected to, every automation scheduled on every
 * parameter, and when each source starts, stops and ends. The clock only moves when a test calls
 * `advance`, which also fires `onended` for sources whose stop time has passed.
 *
 * It is strict where browsers are strict (a source started twice, an exponential ramp to 0, a
 * non-finite value) and stricter where a browser would only click: every parameter notes a
 * `problem` when its value would jump, i.e. a `setValueAtTime` that does not hold the value the
 * parameter already has at that moment, or a `value =` assignment once automation has begun.
 */

type Automation = { kind: 'set' | 'linear' | 'exp'; value: number; time: number };

function checkFinite(what: string, ...values: number[]): void {
  for (const v of values) {
    if (!Number.isFinite(v)) throw new TypeError(`${what}: non-finite value ${v}`);
  }
}

function checkTime(what: string, time: number): void {
  checkFinite(what, time);
  if (time < 0) throw new RangeError(`${what}: negative time ${time}`);
}

export class FakeParam {
  readonly events: Automation[] = [];
  readonly problems: string[] = [];
  private initial: number;
  private lastCancel: { time: number; value: number } | null = null;

  constructor(private readonly ctx: FakeAudioContext, readonly name: string, value: number) {
    this.initial = value;
    ctx.params.push(this);
    // Chrome and Safari have cancelAndHoldAtTime, Firefox does not: the fake can be either
    if (!ctx.cancelAndHold) Object.defineProperty(this, 'cancelAndHoldAtTime', { value: undefined });
  }

  get value(): number {
    return this.valueAt(this.ctx.currentTime);
  }

  set value(v: number) {
    checkFinite(`${this.name}.value`, v);
    if (this.events.length > 0) this.problems.push(`${this.name}: value set to ${v} while automated`);
    this.initial = v;
  }

  /** The value the scheduled automation ends on. */
  get finalValue(): number {
    const last = this.events[this.events.length - 1];
    return last ? last.value : this.initial;
  }

  /** The value at time `t`, as a browser computes it from the scheduled events. */
  valueAt(t: number): number {
    let v = this.initial;
    let t0 = 0;
    for (const e of this.events) {
      if (e.time <= t) {
        v = e.value;
        t0 = e.time;
        continue;
      }
      if (e.kind === 'set' || t <= t0) return v;
      const f = (t - t0) / (e.time - t0);
      if (e.kind === 'linear') return v + (e.value - v) * f;
      if (v === 0 || v * e.value < 0) return v;
      return v * Math.pow(e.value / v, f);
    }
    return v;
  }

  setValueAtTime(value: number, time: number): this {
    checkFinite(`${this.name}.setValueAtTime`, value);
    checkTime(`${this.name}.setValueAtTime`, time);
    if (this.events.length > 0 || this.lastCancel !== null) {
      const held = this.lastCancel !== null && this.lastCancel.time === time ? this.lastCancel.value : this.valueAt(time);
      if (Math.abs(held - value) > 1e-6 * Math.max(1, Math.abs(value))) {
        this.problems.push(`${this.name}: jumps from ${held} to ${value} at ${time}`);
      }
    }
    this.insert({ kind: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    checkFinite(`${this.name}.linearRampToValueAtTime`, value);
    checkTime(`${this.name}.linearRampToValueAtTime`, time);
    this.insert({ kind: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    checkFinite(`${this.name}.exponentialRampToValueAtTime`, value);
    checkTime(`${this.name}.exponentialRampToValueAtTime`, time);
    if (value === 0) throw new RangeError(`${this.name}: exponential ramp to 0`);
    const before = this.events.filter((e) => e.time <= time);
    const from = before.length > 0 ? before[before.length - 1]!.value : this.initial;
    if (from === 0 || from * value < 0) this.problems.push(`${this.name}: exponential ramp from ${from} to ${value}`);
    this.insert({ kind: 'exp', value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    checkTime(`${this.name}.cancelScheduledValues`, time);
    this.lastCancel = { time, value: this.valueAt(time) };
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i]!.time >= time) this.events.splice(i, 1);
    }
    return this;
  }

  /** Cancels events from `time` on and holds the value the parameter has at that moment. */
  cancelAndHoldAtTime(time: number): this {
    checkTime(`${this.name}.cancelAndHoldAtTime`, time);
    this.ctx.holdCalls += 1;
    const held = this.valueAt(time);
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i]!.time >= time) this.events.splice(i, 1);
    }
    this.insert({ kind: 'set', value: held, time });
    return this;
  }

  setTargetAtTime(): this {
    throw new Error(`${this.name}: setTargetAtTime is not modelled by the fake`);
  }

  private insert(e: Automation): void {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1]!.time > e.time) i--;
    this.events.splice(i, 0, e);
  }
}

export type FakeKind = 'gain' | 'oscillator' | 'bufferSource' | 'biquad' | 'panner' | 'compressor' | 'destination';

export class FakeNode {
  readonly connections: Array<FakeNode | FakeParam> = [];
  disconnected = false;

  constructor(readonly ctx: FakeAudioContext, readonly kind: FakeKind) {
    if (kind !== 'destination') ctx.nodes.push(this);
  }

  connect<T extends FakeNode | FakeParam>(destination: T): T {
    if (this.disconnected) this.ctx.problems.push(`${this.kind} connected after it was disconnected`);
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.connections.length = 0;
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  readonly gain: FakeParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'gain');
    this.gain = new FakeParam(ctx, 'gain', 1);
  }
}

export class FakeSource extends FakeNode {
  startTime: number | null = null;
  stopTime: number | null = null;
  offset = 0;
  ended = false;
  onended: (() => void) | null = null;

  start(when = 0, offset = 0): void {
    checkTime(`${this.kind}.start`, when);
    if (this.startTime !== null) throw new Error(`InvalidStateError: ${this.kind} started twice`);
    this.startTime = when;
    this.offset = offset;
    this.ctx.pending.add(this);
  }

  stop(when = 0): void {
    checkTime(`${this.kind}.stop`, when);
    if (this.startTime === null) throw new Error(`InvalidStateError: ${this.kind} stopped before start`);
    if (this.ended) return;
    this.stopTime = when;
  }
}

export class FakeOscillator extends FakeSource {
  type: string = 'sine';
  readonly frequency: FakeParam;
  readonly detune: FakeParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'oscillator');
    this.frequency = new FakeParam(ctx, 'frequency', 440);
    this.detune = new FakeParam(ctx, 'detune', 0);
  }
}

export class FakeBuffer {
  private readonly channels: Float32Array[];
  readonly duration: number;
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    this.duration = length / sampleRate;
  }
  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new RangeError(`no channel ${channel}`);
    return data;
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate: FakeParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'bufferSource');
    this.playbackRate = new FakeParam(ctx, 'playbackRate', 1);
  }
}

export class FakeBiquad extends FakeNode {
  type: string = 'lowpass';
  readonly frequency: FakeParam;
  readonly Q: FakeParam;
  readonly gain: FakeParam;
  readonly detune: FakeParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'biquad');
    this.frequency = new FakeParam(ctx, 'filter.frequency', 350);
    this.Q = new FakeParam(ctx, 'filter.Q', 1);
    this.gain = new FakeParam(ctx, 'filter.gain', 0);
    this.detune = new FakeParam(ctx, 'filter.detune', 0);
  }
}

export class FakePanner extends FakeNode {
  readonly pan: FakeParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'panner');
    this.pan = new FakeParam(ctx, 'pan', 0);
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold: FakeParam;
  readonly knee: FakeParam;
  readonly ratio: FakeParam;
  readonly attack: FakeParam;
  readonly release: FakeParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'compressor');
    this.threshold = new FakeParam(ctx, 'threshold', -24);
    this.knee = new FakeParam(ctx, 'knee', 30);
    this.ratio = new FakeParam(ctx, 'ratio', 12);
    this.attack = new FakeParam(ctx, 'attack', 0.003);
    this.release = new FakeParam(ctx, 'release', 0.25);
  }
}

export interface FakeOptions {
  /** The state a new context starts in; browsers start one made before a gesture 'suspended'. */
  state?: 'suspended' | 'running' | 'interrupted';
  /**
   * What `resume()` does: start running, reject (the browser refused), resolve and stay
   * suspended, or never settle at all (seen in Safari outside a gesture).
   */
  resume?: 'run' | 'reject' | 'ignore' | 'hang';
  /** Whether parameters have `cancelAndHoldAtTime` (Chrome, Safari) or not (Firefox). */
  cancelAndHold?: boolean;
}

export class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  /** 'interrupted' is Safari's state after a phone call, Siri or another app took the audio. */
  state: 'suspended' | 'running' | 'interrupted' | 'closed';
  resumeMode: 'run' | 'reject' | 'ignore' | 'hang';
  resumeCalls = 0;
  readonly cancelAndHold: boolean;
  holdCalls = 0;
  readonly nodes: FakeNode[] = [];
  readonly params: FakeParam[] = [];
  readonly problems: string[] = [];
  /** Sources that have started and not yet ended. */
  readonly pending = new Set<FakeSource>();
  readonly destination: FakeNode;

  constructor(opts: FakeOptions = {}) {
    this.state = opts.state ?? 'suspended';
    this.resumeMode = opts.resume ?? 'run';
    this.cancelAndHold = opts.cancelAndHold ?? false;
    this.destination = new FakeNode(this, 'destination');
  }

  private readonly stateListeners: Array<() => void> = [];

  addEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.stateListeners.push(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    const i = this.stateListeners.indexOf(listener);
    if (type === 'statechange' && i >= 0) this.stateListeners.splice(i, 1);
  }

  /** Changes the state as the browser would, firing `statechange` when it really changes. */
  setState(state: FakeAudioContext['state']): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of [...this.stateListeners]) listener();
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.resumeMode === 'hang') return new Promise<void>(() => undefined);
    if (this.resumeMode === 'reject') return Promise.reject(new Error('NotAllowedError: resume refused'));
    if (this.resumeMode === 'run') this.setState('running');
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.setState('closed');
    return Promise.resolve();
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }

  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }

  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }

  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this);
  }

  createStereoPanner(): FakePanner {
    return new FakePanner(this);
  }

  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  /** Moves the clock on and fires `onended` for every source whose stop time has passed. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    const due = [...this.pending]
      .filter((s) => s.stopTime !== null && s.stopTime <= this.currentTime + 1e-9)
      .sort((a, b) => (a.stopTime ?? 0) - (b.stopTime ?? 0));
    for (const s of due) {
      this.pending.delete(s);
      s.ended = true;
      s.onended?.();
    }
  }

  sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }

  /** Every problem noted on any parameter or node so far. */
  allProblems(): string[] {
    return [...this.problems, ...this.params.flatMap((p) => p.problems)];
  }

  /** The nodes whose output goes straight into `node`. */
  inputsOf(node: FakeNode): FakeNode[] {
    return this.nodes.filter((n) => n.connections.includes(node));
  }

  /**
   * The master gain: the first gain upstream of the destination, through any compressors.
   * Sources wired straight to the destination (the unlock blip) are not part of the chain.
   */
  masterGain(): FakeGain {
    let node: FakeNode = this.destination;
    for (;;) {
      const inputs = this.inputsOf(node).filter((n) => !(n instanceof FakeSource));
      if (inputs.length !== 1) throw new Error(`expected one input into ${node.kind}, found ${inputs.length}`);
      node = inputs[0]!;
      if (node instanceof FakeGain) return node;
      if (!(node instanceof FakeCompressor)) throw new Error(`unexpected ${node.kind} in the master chain`);
    }
  }
}
