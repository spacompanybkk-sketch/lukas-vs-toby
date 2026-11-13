import type { Faction } from '../../sim/types';
import { art } from '../screens/boardPictures';
import { outlined } from '../screens/pictures';
import type { PixelArt } from './PixelIcon';

/**
 * Pictures of a level's HUD and result, as pixel grids in the board's palette (see PixelIcon).
 * Drawn as fills; `outlined` adds the one-pixel ink edge.
 */

/** A small zombie head: green-grey skin, one droopy eye, teeth. */
export const ZOMBIE_HEAD = art(outlined([
  '..........',
  '..GGGGGG..',
  '.GggggggG.',
  '.GgwwgwwG.',
  '.GgwPgwPG.',
  '.GggggggG.',
  '.GgeoeogG.',
  '..GggggG..',
  '...GGGG...',
  '..........',
]));

/** A small plant head: a green pea-pod face on a leaf. */
export const PLANT_HEAD = art(outlined([
  '..........',
  '...gggg...',
  '..gggggg..',
  '.ggwogggGG',
  '.ggggggGgG',
  '.ggggggGGG',
  '..gggggg..',
  '...gggg...',
  '..GG.GG...',
  '..........',
]));

export const HEADS: Readonly<Record<Faction, PixelArt>> = Object.freeze({ plants: PLANT_HEAD, zombies: ZOMBIE_HEAD });

/** "New!" without a word: a golden starburst. */
export const BURST = art(outlined([
  '................',
  '.......y........',
  '.y.....y.....y..',
  '..y...yyy...y...',
  '...yy.yly.yy....',
  '....yyylyyy.....',
  '..yyyyllllyyyy..',
  'yyyyllllllllyyyy',
  '..yyyyllllyyyy..',
  '....yyylyyy.....',
  '...yy.yly.yy....',
  '..y...yyy...y...',
  '.y.....y.....y..',
  '.......y........',
  '................',
  '................',
]));

/** An exclamation block: a big wave is coming. */
export const ALERT = art(outlined([
  '..........',
  '.rrrrrrrr.',
  '.rrrwwrrr.',
  '.rrrwwrrr.',
  '.rrrwwrrr.',
  '.rrrwwrrr.',
  '.rrrrrrrr.',
  '.rrrwwrrr.',
  '.rrrrrrrr.',
  '..........',
]));
