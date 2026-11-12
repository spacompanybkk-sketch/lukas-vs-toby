import { signal } from '@preact/signals';
import { render } from 'preact';
import { Vector3 } from 'three';
import type { CardVM, HudSignals } from '../app/BattleController';
import { installDebug } from '../app/debug';
import { DEFAULT_SETTINGS } from '../app/settings';
import { PLANT_KEYS, UNIT_INFO, ZOMBIE_KEYS } from '../data/units';
import { worldToClient } from '../render/coords';
import { createPortraitPainter, renderPortraits, setPortraitPainter } from '../render/portraits';
import type { CardKey, Faction } from '../sim/types';
import type { BoyPortraits } from '../ui/hud/BaseBars';
import { CardTray } from '../ui/hud/CardTray';
import { HeroButton } from '../ui/hud/HeroButton';
import { SpellButtons } from '../ui/hud/SpellButtons';
import type { SpellButtonVM } from '../ui/hud/SpellButtons';
import { BattleScreen } from '../ui/screens/BattleScreen';
import type { BattlePowers, BattleSessionLike } from '../ui/screens/BattleScreen';
import * as lawnScene from './lawn';
import './hudGallery.css';

// `?scene=hud-gallery` — the battle HUD pieces on their own, for screenshots and layout checks.
//
//   view=battle (default): the lawn with the full battle HUD over it, fed by fake signals that
//     respond to taps (cards select, the hero and spells toggle). `side=plants|zombies`,
//     `cards=1..10` (default 10), `hero=charging|ready|selected|off`, `spells=0..2` (default 2).
//   view=states: every state of the hero and spell buttons for both sides, and a three-card tray
//     for each side, on a plain backdrop.
//
// `window.__lvt.hudReady` resolves once the HUD is drawn with its portraits.
// `window.__lvt.lawnCorners()` gives the client corners of the lawn's lanes 0–4 (back-left,
// back-right, front-right, front-left), for checking that the HUD never covers them.

const PORTRAIT_SIZE = 128;
const SPELLS: Record<Faction, string[]> = {
  plants: ['thunderbolt', 'vines', 'sunShower', 'healingRain', 'rockWall'],
  zombies: ['meteor', 'fog', 'brainFeast', 'frenzy', 'graveRise'],
};
const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

function hand(side: Faction, count: number): CardVM[] {
  const keys: CardKey[] = side === 'plants' ? PLANT_KEYS : ZOMBIE_KEYS;
  return keys.slice(0, count).map((unit, i) => ({
    unit, name: UNIT_INFO[unit].name, price: UNIT_INFO[unit].price, hotkey: HOTKEYS[i] ?? '',
    affordable: UNIT_INFO[unit].price <= 125, rechargeFraction: i === 1 ? 0.55 : i === 4 ? 0.2 : 0,
  }));
}

function fakeSession(side: Faction, cards: CardVM[]): BattleSessionLike {
  const hud: HudSignals = {
    energy: signal(125), cards: signal(cards),
    base: signal({ plants: { hp: 820, max: 1000 }, zombies: { hp: 640, max: 1000 } }),
    seconds: signal(74), suddenDeath: signal(false), paused: signal(false),
    selected: signal<UnitKey | null>(cards[0]?.unit ?? null), shovel: signal(false),
    result: signal(null), denied: signal(0),
  };
  return {
    controller: {
      hud, playerFaction: side,
      select: (u) => { hud.selected.value = u; hud.shovel.value = false; },
      toggleShovel: () => { hud.shovel.value = !hud.shovel.value; },
      setPaused: (p) => { hud.paused.value = p; },
    },
    begin() {}, dispose() {}, skipIntro: true,
  };
}

function fakePowers(side: Faction, hero: string, spellCount: number): BattlePowers {
  const heroSig = signal({ ready: hero !== 'charging', fraction: hero === 'charging' ? 0.45 : 1 });
  const heroSelected = signal(hero === 'selected');
  const dealt = SPELLS[side].slice(0, Math.max(0, Math.min(2, spellCount)));
  const spells = signal<SpellButtonVM[]>(dealt.map((key, i) => ({ key, ready: i === 0, fraction: i === 0 ? 1 : 0.6 })));
  const spellSelected = signal<string | null>(null);
  return {
    hero: hero === 'off' ? undefined : heroSig,
    heroSelected,
    onHero: () => { heroSelected.value = !heroSelected.value; spellSelected.value = null; },
    spells,
    spellSelected,
    onSpell: (key) => { spellSelected.value = spellSelected.peek() === key ? null : key; heroSelected.value = false; },
  };
}

const BOYS: BoyPortraits = {
  lukas: `${import.meta.env.BASE_URL}portraits/lukas.png`,
  toby: `${import.meta.env.BASE_URL}portraits/toby.png`,
};

const noop = (): void => {};

function States({ portraits }: { portraits: Record<string, string> }) {
  const heroStates = [
    { label: '0', ready: false, fraction: 0, selected: false },
    { label: '45%', ready: false, fraction: 0.45, selected: false },
    { label: '90%', ready: false, fraction: 0.9, selected: false },
    { label: 'ready', ready: true, fraction: 1, selected: false },
    { label: 'selected', ready: true, fraction: 1, selected: true },
  ];
  return (
    <div class="hudg hudg--states">
      {(['plants', 'zombies'] as const).map((side) => (
        <section key={side} class={`hudg__side side-${side}`}>
          <div class="hudg__row" data-row={`hero-${side}`}>
            {heroStates.map((s) => (
              <HeroButton
                key={s.label} faction={side} ready={s.ready} fraction={s.fraction} selected={s.selected}
                portrait={side === 'plants' ? BOYS.lukas : BOYS.toby} onPress={noop}
              />
            ))}
            <HeroButton faction={side} ready fraction={1} selected={false} onPress={noop} />
          </div>
          <div class="hudg__row hudg__row--spells" data-row={`spells-${side}`}>
            <SpellButtons spells={SPELLS[side].map((key) => ({ key, ready: true, fraction: 1 }))} selected={null} onPress={noop} />
            <SpellButtons
              spells={[
                { key: SPELLS[side][0] as string, ready: false, fraction: 0.15 },
                { key: SPELLS[side][1] as string, ready: false, fraction: 0.6 },
                { key: SPELLS[side][2] as string, ready: true, fraction: 1 },
              ]}
              selected={SPELLS[side][2] as string} onPress={noop}
            />
          </div>
          <div class="hudg__row" data-row={`tray-${side}`}>
            <CardTray
              cards={hand(side, 3)} selected={side === 'plants' ? 'peashooter' : 'brainEater'} portraits={portraits}
              side={side} denied={0} onSelect={noop} onShovel={side === 'plants' ? noop : undefined}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

export function mount(canvas: HTMLCanvasElement, params: URLSearchParams): () => void {
  const lvt = installDebug();
  const ui = document.getElementById('ui') as HTMLElement;
  const view = params.get('view') === 'states' ? 'states' : 'battle';
  const side: Faction = params.get('side') === 'zombies' ? 'zombies' : 'plants';
  const count = Math.max(1, Math.min(10, Math.trunc(Number(params.get('cards') ?? 10)) || 10));
  const hero = params.get('hero') ?? 'ready';
  const spellCount = params.has('spells') ? Number(params.get('spells')) : 2;

  let teardownLawn: (() => void) | null = null;
  let done: () => void = noop;
  lvt.hudReady = new Promise<void>((resolve) => { done = resolve; });

  const paint = async (): Promise<Record<string, string>> => {
    const renderer = lvt.renderer;
    if (renderer === undefined) return {};
    setPortraitPainter(createPortraitPainter(renderer));
    return renderPortraits([...PLANT_KEYS, ...ZOMBIE_KEYS], PORTRAIT_SIZE).catch(() => ({}));
  };

  const show = (portraits: Record<string, string>): void => {
    if (view === 'states') {
      render(<States portraits={portraits} />, ui);
    } else {
      render(
        <BattleScreen
          session={fakeSession(side, hand(side, count))} portraits={portraits} boys={BOYS}
          settings={DEFAULT_SETTINGS} onSettingsChange={noop} onRestart={noop} onQuit={noop}
          powers={fakePowers(side, hero, spellCount)}
        />,
        ui,
      );
    }
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  };

  // The lawn behind the battle view (and, hidden, the renderer the card portraits are drawn with).
  const lawnParams = new URLSearchParams({ t: '3' });
  teardownLawn = lawnScene.mount(canvas, lawnParams);
  if (view === 'states') document.body.classList.add('hudg-plain');
  void lvt.ready.then(paint).then(show);

  lvt.lawnCorners = () => {
    const renderer = lvt.renderer;
    if (renderer === undefined) return null;
    const rect = canvas.getBoundingClientRect();
    return [[0, 0], [10, 0], [10, 5], [0, 5]].map(([x, z]) => {
      const at = worldToClient(new Vector3(x, 0, z), renderer.camera, rect);
      return { x: rect.left + at.x, y: rect.top + at.y };
    });
  };

  return () => {
    render(null, ui);
    setPortraitPainter(null);
    teardownLawn?.();
    document.body.classList.remove('hudg-plain');
    delete lvt.lawnCorners;
    delete lvt.hudReady;
  };
}
