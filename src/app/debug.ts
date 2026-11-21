import type { WorldKey } from '../data/worlds';
import type { Renderer } from '../render/Renderer';
import type { Lawn } from '../render/world/Lawn';
import type { Faction, LawnConfig } from '../sim/types';
import type { LockstepMatch } from '../net/lockstepMatch';
import type { VersusFlow } from './versus';

/**
 * `window.__lvt.versus` (only with the gate open): the two-device match as the browser tests see it.
 * `hash()` and `tick()` are the sim's, for comparing the two devices (-1 before any match);
 * `seat()` and `matchId()` are the match's (null before any). They keep answering for the match
 * just played while its result is up.
 */
export interface VersusDebug {
  hash(): number;
  tick(): number;
  seat(): Faction | null;
  matchId(): string | null;
  flow: VersusFlow;
}

/** Test hooks exposed on `window.__lvt`; later tasks add fields to it. */
export interface LvtDebug {
  /** Resolves once the current scene has drawn its first frame. */
  ready: Promise<void>;
  /** The renderer of the current 3D scene, if it has one. */
  renderer?: Renderer;
  /** The lawn of the current 3D scene, if it has one. */
  lawn?: Lawn;
  /**
   * Dresses the game's stage as `world` with `lawn`'s twist tiles (missing fields: none; no
   * `lawn`: the world's sample twist), until the next hand-over. Only behind the debug gate.
   */
  setWorld?: (world: WorldKey, lawn?: Partial<LawnConfig>) => void;
  /** True: a boss's entrance card stays up until it is tapped (its 1.5 s timer does nothing). */
  holdBossIntro?: boolean;
  /** Two-device Versus: see `VersusDebug`. */
  versus?: VersusDebug;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __lvt: LvtDebug;
  }
}

let resolveReady: () => void = () => {};
/** The hooks object when the gate is shut: the scenes still fill it in, but nothing outside sees it. */
let hidden: LvtDebug | null = null;

/**
 * Whether the test hooks go on `window.__lvt`: always in a dev build, and in a production build
 * only when the address asks for them with `?debug` (as every e2e test and tool does).
 */
export function debugEnabled(dev: boolean, search: string): boolean {
  return dev || new URLSearchParams(search).has('debug');
}

function create(): LvtDebug {
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  return { ready };
}

/**
 * The test hooks, made once; later calls return the same object. With the gate open (see
 * `debugEnabled`) it is `window.__lvt`; shut, it is a private object and `window.__lvt` stays
 * undefined.
 */
export function installDebug(enabled = debugEnabled(import.meta.env.DEV, location.search)): LvtDebug {
  if (!enabled) return (hidden ??= create());
  const existing = (window as Partial<Window>).__lvt;
  if (existing) return existing;
  const lvt = create();
  window.__lvt = lvt;
  return lvt;
}

/** Call after the scene's first frame has been drawn. */
export function markReady(): void {
  resolveReady();
}

/** The id the flow kept on the device for the match in play (`lvt2_vmatch`), or null. */
function keptMatchId(storage: Storage | undefined): string | null {
  try {
    const raw = storage?.getItem('lvt2_vmatch');
    const id = raw === null || raw === undefined ? null : (JSON.parse(raw) as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/**
 * Puts `versus` on the test hooks when the gate is open (`?debug` or a dev build); shut, it does
 * nothing, so `window.__lvt.versus` does not exist in a player's browser. Returns what stops it.
 * `storage` is the device storage the flow keeps its match key in.
 */
export function installVersusDebug(
  flow: VersusFlow, storage: () => Storage | undefined, enabled = debugEnabled(import.meta.env.DEV, location.search),
): () => void {
  if (!enabled) return () => {};
  const lvt = installDebug(true);
  let last: { link: LockstepMatch; id: string | null } | null = null;
  const stop = flow.phase.subscribe((phase) => {
    if (phase.name === 'battle' && phase.options.online !== undefined) {
      const link = phase.options.online.link;
      if (last?.link !== link) last = { link, id: keptMatchId(storage()) };
    }
  });
  lvt.versus = {
    hash: () => last?.link.match.hash() ?? -1,
    tick: () => last?.link.match.state.tick ?? -1,
    seat: () => last?.link.seat ?? null,
    matchId: () => last?.id ?? null,
    flow,
  };
  return () => {
    stop();
    if (lvt.versus?.flow === flow) delete lvt.versus;
  };
}
