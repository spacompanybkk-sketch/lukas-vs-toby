import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { TABLES, board, rankTable, scoreOf } from '../../app/board';
import type { BoardView, Ranked, Table } from '../../app/board';
import type { Slot } from '../../progress/save';
import { session } from '../../app/session';
import { go } from '../../app/store';
import { factionOf } from '../../data/units';
import { frameColor } from '../frameColor';
import { PixelIcon } from '../hud/PixelIcon';
import { uiSound } from '../uiSound';
import { PODIUM } from './boardPictures';
import { CLOUD_OFF } from './pictures';
import { PlayerPicture } from './PlayerPicture';
import { RankBlock, TABLE_ART } from './RankBlock';
import './players.css';
import './progress.css';

const TABLE_LABEL: Readonly<Record<Table, string>> = Object.freeze({
  stars: 'Adventure stars', wave: 'Best wave', versus: 'Versus wins', computer: 'Wins against the computer',
});

/**
 * The board: the copy kept on this device at once, then the cloud's answer. `online` stays true
 * until the cloud has really not answered, so the "no connection" picture never flashes.
 */
function useBoard(): BoardView | null {
  const [view, setView] = useState<BoardView | null>(() => {
    const kept = board.cached();
    return kept === null ? null : { rows: kept, online: true };
  });
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      void board.fetch().then((v) => { if (alive) setView(v); }, (e: unknown) => console.error('board failed', e));
    };
    load();
    window.addEventListener('online', load);
    return () => {
      alive = false;
      window.removeEventListener('online', load);
    };
  }, []);
  return view;
}

/**
 * The table to open on: the first one the player is on (they look for themselves first), else the
 * first anyone is on (an empty podium is a poor first sight), else stars.
 */
export function firstTable(view: BoardView | null, me: Slot | null): Table {
  const on = (t: Table): Ranked[] => (view === null ? [] : rankTable(view.rows, t));
  return TABLES.find((t) => me !== null && on(t).some((r) => r.row.slot === me))
    ?? TABLES.find((t) => on(t).length > 0) ?? 'stars';
}

/**
 * Four tables behind picture tabs (star, wave, crossed swords, robot head). Each row: the place
 * as a gold, iron or bronze block, the picture, the name and the number. The logged-in player's
 * row is ringed and scrolled into view. An empty table is an empty podium; offline, the copy last
 * fetched here with the crossed-out cloud.
 */
export function Leaderboard({ portraits = {} }: { portraits?: Record<string, string> }) {
  const view = useBoard();
  const [chosen, setChosen] = useState<Table | null>(null);
  const me = session.player.value?.slot ?? null;
  const table = chosen ?? firstTable(view, me);
  const ranked = view === null ? [] : rankTable(view.rows, table);
  const list = useRef<HTMLOListElement>(null);

  useLayoutEffect(() => {
    const mine = list.current?.querySelector<HTMLElement>('[data-me]');
    if (mine && typeof mine.scrollIntoView === 'function') mine.scrollIntoView({ block: 'nearest' });
  }, [table, view]);

  const pick = (t: Table): void => {
    uiSound('click');
    setChosen(t);
  };

  return (
    <div data-screen="leaderboard" class="layer layer--menu board" data-table={table}>
      <button
        type="button" data-action="back" class="btn btn--square pal-wood screen-back" aria-label="Back"
        onClick={() => go({ name: session.player.peek() !== null ? 'home' : 'title' })}
      >
        <span class="ico ico--back" aria-hidden="true" />
      </button>
      {view !== null && !view.online && (
        <span class="board__offline px pal-stone" data-offline aria-label="No connection">
          <PixelIcon art={CLOUD_OFF} />
        </span>
      )}
      <div class="board__tabs" role="tablist">
        {TABLES.map((t) => (
          <button
            key={t} type="button" role="tab" data-tab={t} aria-label={TABLE_LABEL[t]} aria-selected={t === table}
            class={`btn board__tab ${t === table ? 'pal-cream is-on' : 'pal-wood'}`} onClick={() => pick(t)}
          >
            <PixelIcon art={TABLE_ART[t]} class="board__tab-icon" />
          </button>
        ))}
      </div>
      <div class="board__panel px pal-wood">
        {view !== null && ranked.length === 0 ? (
          <div class="board__empty" data-empty aria-label="Nobody yet">
            <PixelIcon art={PODIUM} />
          </div>
        ) : (
          <ol class="board__list" ref={list}>
            {ranked.map(({ row, rank }) => (
              <li
                key={row.slot} data-row={row.slot} data-place={rank} data-me={row.slot === me ? '' : undefined}
                class={`board__row px pal-side side-${factionOf(row.picture)}${row.slot === me ? ' is-me' : ''}`}
              >
                <RankBlock rank={rank} class="board__rank" />
                <PlayerPicture picture={row.picture} portraits={portraits} class="board__pic" frame={frameColor(row.slot)} />
                <span class="board__name inked">{row.name}</span>
                <span class="board__score" data-score={scoreOf(row, table)}>
                  <PixelIcon art={TABLE_ART[table]} class="board__score-icon" />
                  <span class="inked">{scoreOf(row, table)}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
