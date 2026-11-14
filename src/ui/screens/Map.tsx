import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { LEVELS, levelById } from '../../adventure/levels';
import type { LevelDef } from '../../adventure/types';
import { session } from '../../app/session';
import { go, startLevel } from '../../app/store';
import type { Theme } from '../../audio/music';
import type { WorldKey } from '../../data/worlds';
import type { Save } from '../../progress/save';
import type { Faction } from '../../sim/types';
import { frameColor } from '../frameColor';
import type { BoyPortraits } from '../hud/BaseBars';
import { PixelIcon } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { QUESTION } from './adventurePictures';
import { STAR } from './boardPictures';
import { Digits, KindPicture, LevelCard, LockedCard, UnitPic } from './LevelCard';
import { HOP_MS, mapIslands, mapStones, mapTheme, openingWorld } from './mapModel';
import type { Island, Stone, World } from './mapModel';
import { ARROW, LOCK } from './pictures';
import { PlayerPicture } from './PlayerPicture';
import './players.css';
import './adventure.css';
import { BackButton } from '../BackButton';

/** A client point (CSS pixels). */
export interface Pt { x: number; y: number }

/** What the map screen needs from the 3D map (the game passes `MapStage` on the shared stage). */
export interface MapHost {
  open(view: MapHostView): void;
  update(view: MapHostView): void;
  /** Measures where the 3D map is on the page again (the window or its zoom changed). */
  measure(): void;
  /**
   * Each stone's top middle at rest and the middle of the flag's cloth, in client pixels; the hop's
   * height in pixels; and a version that goes up whenever any of it moved. Called every frame, so
   * it must be cheap and return the same object while nothing changed. Null when not on stage.
   */
  layout(): { readonly stones: Record<string, Pt>; readonly flag: Pt | null; readonly hop: number; readonly version: number } | null;
  close(): void;
}

export interface MapHostView {
  side: Faction;
  /** The island shown: its arena (the look) and whether it is locked (grey, a padlock, no stones). */
  arena: WorldKey;
  locked: boolean;
  /** All five islands in the side's order, the shown one among them (the others hang in the sky). */
  islands: { arena: WorldKey; locked: boolean }[];
  stones: { id: string; state: Stone['state'] }[];
  frame: string;
}

/**
 * The levels the map shows: the shipped ones. A test (or the debug hook of the map e2e) may put
 * a longer list here to see later worlds before their level files exist.
 */
export const mapLevels = signal<readonly LevelDef[]>(LEVELS);

/**
 * Where the stones go without a 3D map (tests, no WebGL): the plants' path laid out in shares of
 * the screen; the zombies walk its mirror image.
 */
const FALLBACK: readonly (readonly [number, number])[] = [
  [0.12, 0.8], [0.24, 0.6], [0.36, 0.42], [0.5, 0.55], [0.56, 0.75], [0.7, 0.8], [0.8, 0.62], [0.9, 0.45],
];

/** Stars seen on each player's map, so a star won since the last look pops in with a sound. */
const seenStars = new Map<string, Record<string, number>>();

/** Forgets the stars seen (tests). */
export function resetSeenStars(): void {
  seenStars.clear();
}

/** The stones whose stars went up since `slot` last looked at `side`'s `world`; then remembers them. */
function freshStars(save: Save, side: Faction, world: World, stones: Stone[]): Set<string> {
  const key = `${save.slot}:${side}:${world}`;
  const seen = seenStars.get(key);
  const now: Record<string, number> = {};
  for (const s of stones) now[s.def.id] = s.stars;
  seenStars.set(key, now);
  if (seen === undefined) return new Set();
  return new Set(stones.filter((s) => s.stars > (seen[s.def.id] ?? 0)).map((s) => s.def.id));
}

const SIDE_TABS: { side: Faction; boy: keyof BoyPortraits; label: string }[] = [
  { side: 'plants', boy: 'lukas', label: 'Lukas’s plants' },
  { side: 'zombies', boy: 'toby', label: 'Toby’s zombies' },
];

/** One stone's picture and tap target, placed over the 3D stone. */
function StoneButton({ stone, fresh, portraits, onTap, place }: {
  stone: Stone; fresh: boolean; portraits: Record<string, string>; onTap(): void; place: (el: HTMLElement | null) => void;
}) {
  const { def, state, stars, unlock } = stone;
  return (
    <button
      ref={place} type="button" data-stone={def.id} data-state={state} data-stars={stars} data-kind={def.kind}
      aria-label={`Level ${def.n}${state === 'closed' ? ', locked' : ''}`}
      class={`stone is-${state}${fresh ? ' is-fresh' : ''}`} onClick={onTap}
    >
      <span class="stone__body">
      {unlock !== null && (
        // What winning this level brings: the unit's grey silhouette with a "?" block, in a bubble
        // whose pointer comes down to this stone.
        <span class="stone__unlock" data-unlock={unlock} aria-hidden="true">
          <span class="stone__gift px pal-cream">
            <UnitPic unit={unlock} portraits={portraits} class="stone__unlock-pic" />
            <PixelIcon art={QUESTION} class="stone__q" />
          </span>
          <span class="stone__pointer" />
        </span>
      )}
      <span class={`stone__badge px ${state === 'closed' ? 'pal-stone' : 'pal-cream'}`}>
        <KindPicture kind={def.kind} class="stone__kind" />
        <Digits n={def.n} class="stone__n" />
        {state === 'closed' && <span class="stone__lock"><PixelIcon art={LOCK} /></span>}
      </span>
      {state !== 'closed' && (
        <span class="stone__stars" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} class={`stone__star${i < stars ? ' is-on' : ''}`} data-on={i < stars ? '' : undefined}>
              <PixelIcon art={STAR} />
            </span>
          ))}
        </span>
      )}
      </span>
    </button>
  );
}

/** The big arrow picture to the island before (left) or after (right), with a padlock when that one is locked. */
function WorldArrow({ dir, to, onTap }: { dir: 'prev' | 'next'; to: Island; onTap(): void }) {
  return (
    <button
      type="button" data-action={`world-${dir}`} data-to={to.world} data-arena={to.arena} data-locked={to.locked ? '' : undefined}
      aria-label={dir === 'prev' ? 'The island before' : 'The next island'}
      class={`btn btn--square pal-wood map__arrow map__arrow--${dir}`} onClick={onTap}
    >
      <PixelIcon art={ARROW} class="map__arrow-icon" />
      {to.locked && <span class="map__arrow-lock" aria-hidden="true"><PixelIcon art={LOCK} /></span>}
    </button>
  );
}

/**
 * The Adventure map of one side: one island per world in the side's order (the zombies travel
 * the worlds in reverse), the shown one big in its world's colours with that world's eight level
 * stones over the 3D map (the host), the others small in the sky. Each stone shows its kind,
 * number and stars, a padlock while closed, the silhouette of the unit it unlocks; the next one
 * hops with the player's picture on a flag of their frame colour. Arrow pictures step to the
 * island before or after; a locked island (no levels yet, or not reached) is grey with a big
 * padlock that refuses a tap. The map opens on the world of the next level (`world` keeps the
 * island an arrow went to). Two portrait tabs switch between Lukas's plants and Toby's zombies
 * (anyone may play either; each side has its own progress). A tap on a stone opens its card
 * (`card`). Without a host the stones are laid out flat. `onMusic` is asked for the tune of the
 * island shown (`mapTheme`) when the map opens and whenever the side or the island changes.
 */
export function MapScreen({ side, card, world: asked, portraits = {}, boys = {}, host, levels = mapLevels.value, onMusic }: {
  side: Faction; card?: string; world?: World; portraits?: Record<string, string>; boys?: BoyPortraits; host?: MapHost;
  levels?: readonly LevelDef[]; onMusic?(theme: Theme): void;
}) {
  const me = session.player.value;
  const loggedOut = me === null;
  useEffect(() => {
    if (loggedOut) go({ name: 'play' });
  }, [loggedOut]);

  const shown = card === undefined ? null : levelById(card, levels);
  const world: World = asked ?? (shown !== null && shown.side === side ? shown.world : me === null ? 1 : openingWorld(me, side, levels));
  const islands = me === null ? [] : mapIslands(me, side, levels);
  const island = islands[world - 1] ?? null;
  const stones = me === null || island === null || island.locked ? [] : mapStones(me, side, world, levels);
  const view: MapHostView | null = me === null || island === null ? null : {
    side, arena: island.arena, locked: island.locked,
    islands: islands.map((i) => ({ arena: i.arena, locked: i.locked })),
    frame: frameColor(me.slot), stones: stones.map((s) => ({ id: s.def.id, state: s.state })),
  };
  // The island shown sets the tune (asking for the one already playing changes nothing).
  const theme = me === null ? null : mapTheme(island);
  useEffect(() => {
    if (theme !== null) onMusic?.(theme);
  }, [theme, onMusic]);
  const viewKey = view === null ? '' : `${view.side}|${view.arena}|${view.islands.map((i) => Number(i.locked)).join('')}|${view.frame}|${view.stones.map((s) => s.state).join(',')}`;

  // The 3D map: open once a player is there, kept in step with the stones, closed when the screen goes.
  const viewRef = useRef(view);
  viewRef.current = view;
  const ready = view !== null;
  useLayoutEffect(() => {
    const v = viewRef.current;
    if (host === undefined || v === null) return undefined;
    host.open(v);
    return () => host.close();
  }, [host, ready]);
  const firstKey = useRef(viewKey);
  useLayoutEffect(() => {
    if (firstKey.current === viewKey) return;
    firstKey.current = viewKey;
    if (host !== undefined && viewRef.current !== null) host.update(viewRef.current);
  }, [host, viewKey]);

  // The HTML over the 3D stones. Every frame asks the host for its layout, which is only projected
  // again when the camera or the size changed; while its version stands, nothing is written. A
  // move is one transform per element. The hop is a CSS animation of the height the host gives.
  const root = useRef<HTMLDivElement | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const order = useRef<string[]>([]);
  order.current = stones.map((s) => s.def.id);
  const marker = useRef<HTMLElement | null>(null);
  const written = useRef(-1);
  const place = (): void => {
    const l = host?.layout() ?? null;
    if (l === null || l.version === written.current) return;
    written.current = l.version;
    const ids = order.current;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const el = els.current.get(id);
      const p = l.stones[id];
      if (el === undefined || p === undefined) continue;
      el.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
      el.dataset.placed = '';
      // An unlock bubble leans away from the stone the path goes on to (or came from, at the end).
      const near = l.stones[ids[i + 1] ?? ids[i - 1] ?? id];
      if (near !== undefined) el.dataset.lean = near.x > p.x ? 'left' : 'right';
    }
    const m = marker.current;
    if (m !== null && l.flag !== null) {
      m.style.transform = `translate3d(${Math.round(l.flag.x)}px, ${Math.round(l.flag.y)}px, 0)`;
      m.dataset.placed = '';
    }
    root.current?.style.setProperty('--hop', `${l.hop}px`);
  };
  const placeRef = useRef(place);
  placeRef.current = place;
  useLayoutEffect(() => {
    if (host === undefined) return undefined;
    let raf = 0;
    const loop = (): void => {
      placeRef.current();
      raf = requestAnimationFrame(loop);
    };
    const resized = (): void => {
      host.measure();
      placeRef.current();
    };
    loop();
    window.addEventListener('resize', resized);
    window.addEventListener('orientationchange', resized);
    window.visualViewport?.addEventListener('resize', resized);
    window.visualViewport?.addEventListener('scroll', resized);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resized);
      window.removeEventListener('orientationchange', resized);
      window.visualViewport?.removeEventListener('resize', resized);
      window.visualViewport?.removeEventListener('scroll', resized);
    };
  }, [host]);
  // The CSS hop starts on the page clock's beat, so it keeps in step with the 3D stone's.
  const [hopDelay] = useState(() => `-${Math.round(performance.now() % HOP_MS)}ms`);

  // A star won since the last look pops in, with the merge sound.
  const fresh = useRef<Set<string>>(new Set());
  const freshFor = useRef('');
  const key = me === null ? '' : `${me.slot}:${side}:${world}:${stones.map((s) => s.stars).join('')}`;
  if (me !== null && freshFor.current !== key) {
    freshFor.current = key;
    fresh.current = freshStars(me, side, world, stones);
  }

  // A tap on a locked island's padlock: the deny sound and a shake (two names, so each tap restarts it).
  const [denied, setDenied] = useState(0);
  useEffect(() => {
    if (fresh.current.size > 0) uiSound('merge');
  }, [key]);

  if (me === null) return null;

  const tap = (s: Stone): void => {
    uiSound(s.state === 'closed' ? 'deny' : 'click');
    go({ name: 'map', side, world, card: s.def.id });
  };
  const next = stones.find((s) => s.state === 'next') ?? null;
  const open = shown !== null && shown.side === side ? stones.find((s) => s.def.id === shown.id) ?? null : null;
  const close = (): void => { uiSound('click'); go({ name: 'map', side, world }); };
  const before = islands[world - 2];
  const after = islands[world];
  const step = (to: Island): void => { uiSound('click'); go({ name: 'map', side, world: to.world }); };
  // The level to play now, on whichever island it is (for a closed stone's card).
  const playNow = mapStones(me, side, openingWorld(me, side, levels), levels).find((s) => s.state === 'next') ?? null;

  return (
    <div
      ref={root} data-screen="map" data-side={side} data-world={world} data-arena={island?.arena}
      data-locked={island?.locked === true ? '' : undefined}
      class={`layer map${host === undefined ? ' map--flat' : ''}`}
      style={{ '--hop-ms': `${HOP_MS}ms`, '--hop-delay': hopDelay }}
    >
      <BackButton data-action="back" class="screen-back" onClick={() => { uiSound('click'); go({ name: 'play' }); }} />
      <div class="map__tabs" role="tablist">
        {SIDE_TABS.map((t) => (
          <button
            key={t.side} type="button" role="tab" data-tab={t.side} aria-label={t.label} aria-selected={t.side === side}
            class={`btn map__tab px pal-side side-${t.side}${t.side === side ? ' is-on' : ''}`}
            onClick={() => { uiSound('click'); if (t.side !== side) go({ name: 'map', side: t.side }); }}
          >
            {boys[t.boy] !== undefined
              ? <img class="map__tab-boy" src={boys[t.boy]} alt="" draggable={false} />
              : <span class={`ico ico--${t.side === 'plants' ? 'sun' : 'brain'}`} aria-hidden="true" />}
            <span class={`ico ico--${t.side === 'plants' ? 'sun' : 'brain'} map__tab-mark`} aria-hidden="true" />
          </button>
        ))}
      </div>
      {before !== undefined && <WorldArrow dir="prev" to={before} onTap={() => step(before)} />}
      {after !== undefined && <WorldArrow dir="next" to={after} onTap={() => step(after)} />}
      {island?.locked === true && (
        <button
          type="button" data-action="island-locked" aria-label="Locked"
          class={`map__island-lock${denied > 0 ? ` is-deny-${denied % 2 === 0 ? 'b' : 'a'}` : ''}`}
          onClick={() => { uiSound('deny'); setDenied((n) => n + 1); }}
        >
          <PixelIcon art={LOCK} />
        </button>
      )}
      <div class="map__stones">
        {stones.map((s, i) => {
          const [fx, fy] = FALLBACK[i] ?? [0.5, 0.5];
          const x = side === 'plants' ? fx : 1 - fx;
          return (
            <StoneButton
              key={s.def.id} stone={s} fresh={fresh.current.has(s.def.id)} portraits={portraits} onTap={() => tap(s)}
              place={(el) => {
                if (el === null) { els.current.delete(s.def.id); return; }
                els.current.set(s.def.id, el);
                if (host === undefined) { el.style.left = `${x * 100}%`; el.style.top = `${fy * 100}%`; }
              }}
            />
          );
        })}
        {next !== null && (
          <span
            ref={(el) => {
              marker.current = el;
              if (el !== null && host === undefined) {
                const i = stones.indexOf(next);
                const [fx, fy] = FALLBACK[i] ?? [0.5, 0.5];
                el.style.left = `${(side === 'plants' ? fx : 1 - fx) * 100}%`;
                el.style.top = `${fy * 100 - 14}%`;
              }
            }}
            class="map__marker" data-marker={next.def.id} aria-hidden="true"
          >
            <PlayerPicture picture={me.picture} portraits={portraits} frame={frameColor(me.slot)} class="map__marker-pic" />
          </span>
        )}
      </div>
      {open !== null && open.state !== 'closed' && (
        <LevelCard
          def={open.def} save={me} portraits={portraits} onClose={close}
          onPlay={() => { uiSound('click'); startLevel(open.def, me, undefined, levels); }}
          onTutorial={() => { uiSound('click'); startLevel(open.def, me, undefined, levels, undefined, { replayTutorial: true }); }}
          onSkill={(skill) => { uiSound('click'); session.update((s) => ({ ...s, adventureDifficulty: { ...s.adventureDifficulty, [side]: skill } })); }}
        />
      )}
      {open !== null && open.state === 'closed' && (
        <LockedCard
          def={open.def} next={playNow?.def ?? null} onClose={close}
          onNext={() => { if (playNow !== null) { uiSound('click'); go({ name: 'map', side, card: playNow.def.id }); } }}
        />
      )}
    </div>
  );
}
