import { effect, signal } from '@preact/signals';
import { createRef, render } from 'preact';
import type { Skill } from '../ai/bot';
import { AudioEngine } from '../audio/AudioEngine';
import { createPortraitPainter, renderPortraits, setPortraitPainter } from '../render/portraits';
import { defaultConfig } from '../sim/match';
import type { Faction } from '../sim/types';
import { App } from '../ui/App';
import type { BoyPortraits } from '../ui/hud/BaseBars';
import { flyToken } from '../ui/hud/tokenFlight';
import type { BattleSessionLike } from '../ui/screens/BattleScreen';
import type { BattleOptions } from './BattleController';
import { BattleSession } from './BattleSession';
import { installDebug, markReady } from './debug';
import { loadSettings } from './settings';
import type { Settings } from './settings';
import { Stage } from './Stage';
import { go, screen } from './store';
import { TitleDemo } from './TitleDemo';

/** CSS pixels a card portrait is drawn at (the card art is at most about 116 px wide). */
export const PORTRAIT_SIZE = 120;

const SIDES: readonly Faction[] = ['plants', 'zombies'];
const SKILLS: readonly Skill[] = ['easy', 'medium', 'hard'];

/** `?scene=battle&side=…&skill=…&seed=…` as battle options (defaults: plants, medium, 7). */
export function battleOptionsFrom(params: URLSearchParams): BattleOptions {
  const side = params.get('side') as Faction | null;
  const skill = params.get('skill') as Skill | null;
  const seed = Number(params.get('seed'));
  return {
    playerFaction: side !== null && SIDES.includes(side) ? side : 'plants',
    skill: skill !== null && SKILLS.includes(skill) ? skill : 'medium',
    seed: params.has('seed') && Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 7,
  };
}

/** When the browser takes the graphics away, the app shows "Graphics stopped" with a Reload button. */
export function watchContextLoss(renderer: { onContextLost?: () => void }): void {
  renderer.onContextLost = () => go({ name: 'unsupported', reason: 'context-lost' });
}

/**
 * The game itself: one stage (one WebGL context for the whole page) with the title's demo battle
 * on it, the Preact app over it, the sound, and the battles the app asks for.
 *
 * With `jumpIn`, the app opens straight on a battle that has already begun (`?scene=battle`).
 * With `fps` (`?fps`), a small corner readout shows fps, render scale and draw calls.
 */
export function mountGame(
  canvas: HTMLCanvasElement, ui: HTMLElement, jumpIn: BattleOptions | null, { fps = false }: { fps?: boolean } = {},
): () => void {
  const lvt = installDebug();
  const audio = new AudioEngine();
  let stage: Stage | null = null;
  try {
    stage = new Stage(canvas, loadSettings().quality);
  } catch (e) {
    if (!(e instanceof Error && e.message === 'webgl2-unavailable')) throw e;
  }

  const boys: BoyPortraits = {
    lukas: `${import.meta.env.BASE_URL}portraits/lukas.png`,
    toby: `${import.meta.env.BASE_URL}portraits/toby.png`,
  };
  const portraits = signal<Record<string, string>>({});
  const energyRef = createRef<HTMLDivElement>();
  let current: BattleSession | null = null;
  let firstSession = jumpIn !== null;

  const demo = stage ? new TitleDemo(stage) : null;
  if (stage) {
    const s = stage;
    document.body.classList.add('has-stage');
    watchContextLoss(s.renderer);
    s.onFirstFrames = markReady;
    const paint = createPortraitPainter(s.renderer);
    let paintMs = 0;
    setPortraitPainter((key, size) => {
      const t = performance.now();
      try {
        return paint(key, size);
      } finally {
        paintMs += performance.now() - t;
        lvt.portraitPaintMs = Math.round(paintMs); // drawing time alone, for the report
      }
    });
    const cards = defaultConfig(0).cards;
    const startedAt = performance.now();
    lvt.portraits = renderPortraits([...cards.plants, ...cards.zombies], PORTRAIT_SIZE).then((p) => {
      portraits.value = p;
      lvt.portraitMs = Math.round(performance.now() - startedAt);
    });
    lvt.renderer = s.renderer;
    lvt.lawn = s.lawn;
    lvt.stage = s;
  } else {
    lvt.portraits = Promise.resolve();
    requestAnimationFrame(() => markReady());
  }

  const createSession = (options: BattleOptions): BattleSessionLike => {
    if (stage === null) throw new Error('webgl2-unavailable');
    const session = new BattleSession(stage, audio, options, {
      onToken: (from, side) => flyToken(ui, from, energyRef.current, side),
    });
    if (firstSession) {
      firstSession = false;
      session.skipIntro = true;
      session.begin();
    } else {
      void session.start();
    }
    current = session;
    const dispose = session.dispose.bind(session);
    session.dispose = () => {
      dispose();
      if (current === session) current = null;
    };
    return session;
  };

  // Hooks for tools and end-to-end tests.
  Object.defineProperty(lvt, 'session', { configurable: true, get: () => current });
  lvt.demo = demo;
  lvt.tileToClient = (lane: number, col: number) => current?.tileToClient(lane, col) ?? null;
  lvt.fastForward = (ticks: number) => current?.fastForward(ticks);
  lvt.damageBase = (side: Faction, amount: number) => current?.damageBase(side, amount);
  lvt.audio = audio;
  // The screen the app is on (battle options included), for end-to-end tests.
  Object.defineProperty(lvt, 'screen', { configurable: true, get: () => screen.value });

  if (jumpIn) go({ name: 'battle', options: jumpIn });
  // The menus have the demo battle behind them and their own tune.
  const stopScreens = effect(() => {
    const s = screen.value;
    if (s.name === 'title' || s.name === 'sidepick') {
      demo?.show();
      audio.startMusic('menu');
    }
  });

  const onSettingsChange = (s: Settings): void => {
    audio.setVolume('music', s.music);
    audio.setVolume('sfx', s.sfx);
    audio.setMuted(s.muted);
    stage?.setQuality(s.quality);
  };
  const onGesture = (): Promise<boolean> => audio.unlock().then(() => audio.unlocked);

  const renderer = stage?.renderer;
  renderer?.countDrawCalls(fps);
  const fpsSource = fps && renderer !== undefined ? () => renderer.stats : undefined;

  const Root = () => (
    <App
      createSession={createSession} portraits={portraits.value} boys={boys}
      onSettingsChange={onSettingsChange} onGesture={onGesture} energyRef={energyRef} fpsSource={fpsSource}
    />
  );
  render(<Root />, ui);

  return () => {
    stopScreens();
    render(null, ui);
    current?.dispose();
    stage?.dispose();
    audio.stopMusic(0);
  };
}
