import { useEffect, useRef, useState } from 'preact/hooks';
import { BOYS, session } from '../../app/session';
import { factionOf } from '../../data/units';
import type { Roster, RosterEntry } from '../../app/session';
import { go } from '../../app/store';
import type { Slot } from '../../progress/save';
import { PixelIcon } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { PinPad } from './PinPad';
import type { PadAnswer } from './PinPad';
import { PlayerPicture } from './PlayerPicture';
import { CLOUD_OFF, HOURGLASS, LOCK, PLUS } from './pictures';
import './players.css';

/** Hold the small lock this long to reach the grown-up gate. */
export const GROWN_UP_HOLD_MS = 2000;
/** The biggest a picture tile gets (few players), in CSS pixels. */
const MAX_TILE = 220;
const GAP = 12;
/** A tile is this much taller than wide (the name under the picture). */
const TILE_RATIO = 1.22;

/** Columns and tile width that make `n` tiles as big as they can be in a `w` × `h` area. */
export function gridLayout(n: number, w: number, h: number): { cols: number; size: number } {
  let best = { cols: 1, size: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const size = Math.floor(Math.min((w - (cols - 1) * GAP) / cols, (h - (rows - 1) * GAP) / rows / TILE_RATIO, MAX_TILE));
    if (size > best.size) best = { cols, size };
  }
  return best;
}

function useViewport(): { w: number; h: number } {
  const read = (): { w: number; h: number } => ({ w: window.innerWidth, h: window.innerHeight });
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = (): void => setV(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

/** The roster: what this device knows at once, then the cloud's answer (again when back online). */
function useRoster(): Roster | null {
  const [roster, setRoster] = useState<Roster | null>(null);
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      void session.roster().then((r) => { if (alive) setRoster(r); }, (e: unknown) => console.error('roster failed', e));
    };
    load();
    window.addEventListener('online', load);
    return () => {
      alive = false;
      window.removeEventListener('online', load);
    };
  }, []);
  return roster;
}

/** Re-renders every second while any player is locked, so the hourglasses go away on time. */
function useLockTicks(slots: readonly Slot[]): void {
  const [, setTick] = useState(0);
  const anyLocked = slots.some((s) => session.lockedUntil(s) > 0);
  useEffect(() => {
    if (!anyLocked) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anyLocked]);
}

export interface PlayersProps {
  portraits?: Record<string, string>;
  /** The player whose number pad is open. */
  login?: Slot;
}

/**
 * Log-in: a grid of up to 30 pictures with their names (the player last used on this device
 * first, pulsing), a "+" tile while there is room, and a small lock that a grown-up holds for two
 * seconds. Tapping a picture opens the number pad; Lukas and Toby, before they have a number,
 * go to choosing one.
 */
export function Players({ portraits = {}, login }: PlayersProps) {
  const roster = useRoster();
  if (login !== undefined) {
    const known = roster?.players.find((p) => p.slot === login);
    const boy = (BOYS as Record<string, { name: string; picture: RosterEntry['picture'] } | undefined>)[login];
    const who = known ?? (boy ? { slot: login, name: boy.name, picture: boy.picture, exists: true } : null);
    if (who === null) return null; // a player not known yet: the roster is on its way
    return <LoginPad who={who} portraits={portraits} />;
  }
  return <PlayerGrid roster={roster} portraits={portraits} />;
}

function PlayerGrid({ roster, portraits }: { roster: Roster | null; portraits: Record<string, string> }) {
  const view = useViewport();
  const players = roster?.players ?? [];
  useLockTicks(players.map((p) => p.slot));
  const room = roster !== null && !roster.full;
  const n = players.length + (room ? 1 : 0);
  // The area between the top buttons and the lock: what the tiles may fill.
  const top = Math.max(56, Math.min(88, view.h * 0.09)) + 28;
  const { cols, size } = gridLayout(Math.max(1, n), view.w - 40, view.h - top - 80);
  const lastFirst = roster?.players[0];
  const pulse = lastFirst !== undefined && lastFirst.exists && session.lastUsed() === lastFirst.slot;

  const tap = (p: RosterEntry): void => {
    uiSound('click');
    go(p.exists ? { name: 'players', login: p.slot } : { name: 'create', boy: p.slot });
  };

  return (
    <div data-screen="players" class="layer layer--menu players">
      <button type="button" data-action="back" class="btn btn--square pal-wood screen-back" aria-label="Back" onClick={() => go({ name: 'title' })}>
        <span class="ico ico--back" aria-hidden="true" />
      </button>
      {roster !== null && !roster.online && (
        <span class="players__offline px pal-stone" data-offline aria-label="No connection">
          <PixelIcon art={CLOUD_OFF} class="players__offline-icon" />
        </span>
      )}
      <div class="players__grid" style={{ gridTemplateColumns: `repeat(${cols}, ${size}px)`, '--tile': `${size}px` }}>
        {players.map((p, i) => {
          const locked = session.lockedUntil(p.slot) > 0;
          return (
            <button
              key={p.slot} type="button" data-player={p.slot} aria-label={p.name}
              class={`ptile px pal-side side-${sideOf(p)}${i === 0 && pulse ? ' is-last' : ''}${p.exists ? '' : ' is-new'}${locked ? ' is-locked' : ''}`}
              onClick={() => tap(p)}
            >
              <PlayerPicture picture={p.picture} portraits={portraits} class="ptile__pic" />
              <span class="ptile__name inked">{p.name}</span>
              {locked && <span class="ptile__badge px pal-slate" data-locked><PixelIcon art={HOURGLASS} /></span>}
            </button>
          );
        })}
        {room && (
          <button type="button" data-action="new-player" aria-label="New player" class="ptile ptile--plus px pal-leaf" onClick={() => { uiSound('click'); go({ name: 'create' }); }}>
            <span class="ptile__plus"><PixelIcon art={PLUS} /></span>
          </button>
        )}
      </div>
      <GrownUpLock />
    </div>
  );
}

const sideOf = (p: RosterEntry): 'plants' | 'zombies' => factionOf(p.picture);

/** The small lock: held for two seconds it opens the grown-up gate. A short tap does nothing. */
function GrownUpLock() {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const start = (e: PointerEvent): void => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    clearTimeout(timer.current);
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      go({ name: 'grownup' });
    }, GROWN_UP_HOLD_MS);
  };
  const stop = (): void => {
    clearTimeout(timer.current);
    setHolding(false);
  };
  return (
    <button
      type="button" data-action="grownup" aria-label="Grown-ups (hold)"
      class={`players__lock px pal-stone${holding ? ' is-holding' : ''}`}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <PixelIcon art={LOCK} class="players__lock-icon" />
      <span class="players__lock-fill" aria-hidden="true" />
    </button>
  );
}

function LoginPad({ who, portraits }: { who: RosterEntry; portraits: Record<string, string> }) {
  const onCode = async (pin: string): Promise<PadAnswer> => {
    const r = await session.login(who.slot, pin);
    if (typeof r === 'object') {
      uiSound('merge');
      go({ name: 'home' });
      return 'ok';
    }
    if (r === 'locked') return 'locked';
    if (r === 'offline') return 'offline';
    return 'wrong';
  };
  return (
    <PinPad
      head={<PadHead who={who} portraits={portraits} />}
      onCode={onCode} onBack={() => go({ name: 'players' })}
      lockedUntil={() => session.lockedUntil(who.slot)} now={() => session.now()}
    />
  );
}

/** The player's picture, big, with the name under it. */
export function PadHead({ who, portraits }: { who: { name: string; picture: RosterEntry['picture'] }; portraits: Record<string, string> }) {
  return (
    <div class="pad-head">
      <PlayerPicture picture={who.picture} portraits={portraits} class="pad-head__pic px" />
      <span class="pad-head__name inked">{who.name}</span>
    </div>
  );
}
