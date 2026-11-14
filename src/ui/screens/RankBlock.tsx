import type { RankUp, Table } from '../../app/board';
import { PixelIcon } from '../hud/PixelIcon';
import type { PixelArt } from '../hud/PixelIcon';
import { ROBOT, STAR, SWORDS, UP } from './boardPictures';
import { ENDLESS } from './adventurePictures';
import './progress.css';

/** The picture of each leaderboard table. */
export const TABLE_ART: Readonly<Record<Table, PixelArt>> = Object.freeze({ stars: STAR, wave: ENDLESS, versus: SWORDS, computer: ROBOT });

/** A place as a block: gold for 1st, iron for 2nd, bronze for 3rd, wood after that. */
export function RankBlock({ rank, class: cls = '' }: { rank: number; class?: string }) {
  const metal = rank === 1 ? 'gold' : rank === 2 ? 'iron' : rank === 3 ? 'bronze' : 'wood';
  return (
    <span class={`rank px rank--${metal} ${cls}`.trim()} data-rank={rank}>
      <span class="inked">{rank}</span>
    </span>
  );
}

/** On the result: the table's picture, an up arrow and the new place. */
export function RankUpBadge({ up }: { up: RankUp }) {
  return (
    <span class="rank-up px pal-wood" data-rank-up={up.rank} data-table={up.table} aria-label={`Up to place ${up.rank}`}>
      <PixelIcon art={TABLE_ART[up.table]} class="rank-up__table" />
      <PixelIcon art={UP} class="rank-up__arrow" />
      <RankBlock rank={up.rank} class="rank-up__rank" />
    </span>
  );
}
