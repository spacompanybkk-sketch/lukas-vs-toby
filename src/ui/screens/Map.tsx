import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { levelById } from '../../adventure/levels';
import { session } from '../../app/session';
import { go, startLevel } from '../../app/store';
import type { Save } from '../../progress/save';
import type { Faction } from '../../sim/types';
import { frameColor } from '../frameColor';
import type { BoyPortraits } from '../hud/BaseBars';
import { PixelIcon } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { STAR } from './boardPictures';
import { Digits, KindPicture, LevelCard, LockedCard, UnitPic } from './LevelCard';
import { mapStones } from './mapModel';
import type { Stone } from './mapModel';
import { LOCK } from './pictures';
import { PlayerPicture } from './PlayerPicture';
import './players.css';
import './adventure.css';

/** A client point (CSS pixels). */
export interface Pt { x: number; y: number }

/** What the map screen needs from the 3D map (the game passes `MapStage` on the shared stage). */
export interface MapHost {
  open(view: MapHostView): void;
  update(view: MapHostView): void;
  /** Each stone's top middle and the flag's top, in client pixels; null when not on stage. */
  layout(): { stones: Record<string, Pt>; flag: Pt | null } | null;
  close(): void;
}

export interface MapHostView {
  side: Faction;
  stones: { id: string; state: Stone['state'] }[];
  frame: string;
}

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

/** The stones whose stars went up since `slot` last looked at `side`'s map; then remembers them. */
function freshStars(save: Save, side: Faction, stones: Stone[]): Set<string> {
  const key = `${save.slot}:${side}`;
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
      {unlock !== null && (
        <span class="stone__unlock" data-unlock={unlock} aria-hidden="true">
          <UnitPic unit={unlock} portraits={portraits} class="stone__unlock-pic" />
        </span>
      )}
      <span class={`stone__badge px ${state === 'closed' ? 'pal-stone' : state === 'done' ? 'pal-cream' : 'pal-cream'}`}>
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
    </button>
  );
}

/**
 * The Adventure map of one side: the Backyard's eight level stones over the 3D map (the host);
 * each shows its kind, number and stars, a padlock while closed, the silhouette of the unit it
 * unlocks; the next one hops with the player's picture on a flag of their frame colour. Two
 * portrait tabs switch between Lukas's plants and Toby's zombies (anyone may play either; each
 * side has its own progress). A tap on a stone opens its card (`card`). Without a host the stones
 * are laid out flat.
 */
export function MapScreen({ side, card, portraits = {}, boys = {}, host }: {
  side: Faction; card?: string; portraits?: Record<string, string>; boys?: BoyPortraits; host?: MapHost;
}) {
  const me = session.player.value;
  const loggedOut = me === null;
  useEffect(() => {
    if (loggedOut) go({ name: 'play' });
  }, [loggedOut]);

  const stones = me === null ? [] : mapStones(me, side);
  const view: MapHostView | null = me === null ? null : {
    side, frame: frameColor(me.slot), stones: stones.map((s) => ({ id: s.def.id, state: s.state })),
  };
  const viewKey = view === null ? '' : `${view.side}|${view.frame}|${view.stones.map((s) => s.state).join(',')}`;

  // The 3D map: open once, kept in step with the stones, closed when the screen goes.
  const viewRef = useRef(view);
  viewRef.current = view;
  useLayoutEffect(() => {
    if (host === undefined || viewRef.current === null) return undefined;
    host.open(viewRef.current);
    return () => host.close();
  }, [host, viewRef.current === null]);
  const firstKey = useRef(viewKey);
  useLayoutEffect(() => {
    if (firstKey.current === viewKey) return;
    firstKey.current = viewKey;
    if (host !== undefined && viewRef.current !== null) host.update(viewRef.current);
  }, [host, viewKey]);

  // The HTML follows the 3D stones every frame (they hop; the window may change size or zoom).
  const els = useRef(new Map<string, HTMLElement>());
  const marker = useRef<HTMLElement | null>(null);
  const place = (): void => {
    const l = host?.layout() ?? null;
    if (l === null) return;
    for (const [id, el] of els.current) {
      const p = l.stones[id];
      if (p === undefined) continue;
      el.style.left = `${Math.round(p.x)}px`;
      el.style.top = `${Math.round(p.y)}px`;
      el.dataset.placed = '';
    }
    const m = marker.current;
    if (m !== null && l.flag !== null) {
      m.style.left = `${Math.round(l.flag.x)}px`;
      m.style.top = `${Math.round(l.flag.y)}px`;
      m.dataset.placed = '';
    }
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
    const now = (): void => placeRef.current();
    loop();
    window.addEventListener('resize', now);
    window.visualViewport?.addEventListener('resize', now);
    window.visualViewport?.addEventListener('scroll', now);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', now);
      window.visualViewport?.removeEventListener('resize', now);
      window.visualViewport?.removeEventListener('scroll', now);
    };
  }, [host]);

  // A star won since the last look pops in, with the merge sound.
  const fresh = useRef<Set<string>>(new Set());
  const freshFor = useRef('');
  const key = me === null ? '' : `${me.slot}:${side}:${stones.map((s) => s.stars).join('')}`;
  if (me !== null && freshFor.current !== key) {
    freshFor.current = key;
    fresh.current = freshStars(me, side, stones);
  }
  useEffect(() => {
    if (fresh.current.size > 0) uiSound('merge');
  }, [key]);

  if (me === null) return null;

  const tap = (s: Stone): void => {
    uiSound(s.state === 'closed' ? 'deny' : 'click');
    go({ name: 'map', side, card: s.def.id });
  };
  const next = stones.find((s) => s.state === 'next') ?? null;
  const shown = card === undefined ? null : levelById(card);
  const open = shown !== null && shown.side === side ? stones.find((s) => s.def.id === shown.id) ?? null : null;
  const close = (): void => { uiSound('click'); go({ name: 'map', side }); };

  return (
    <div data-screen="map" data-side={side} class={`layer map${host === undefined ? ' map--flat' : ''}`}>
      <button
        type="button" data-action="back" class="btn btn--square pal-wood screen-back" aria-label="Back"
        onClick={() => { uiSound('click'); go({ name: 'play' }); }}
      >
        <span class="ico ico--back" aria-hidden="true" />
      </button>
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
          onPlay={() => { uiSound('click'); startLevel(open.def, me); }}
          onSkill={(skill) => { uiSound('click'); session.update((s) => ({ ...s, difficulty: { ...s.difficulty, [side]: skill } })); }}
        />
      )}
      {open !== null && open.state === 'closed' && (
        <LockedCard
          def={open.def} next={next?.def ?? null} onClose={close}
          onNext={() => { if (next !== null) { uiSound('click'); go({ name: 'map', side, card: next.def.id }); } }}
        />
      )}
    </div>
  );
}
