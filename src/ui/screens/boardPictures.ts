import type { PixelArt } from '../hud/PixelIcon';
import { outlined } from './pictures';

/**
 * Pictures of the leaderboard and the Almanac, as pixel grids (see PixelIcon). Drawn as fills;
 * `outlined` adds the one-pixel ink edge. The palette is the player screens' plus a few colours.
 */
export const PALETTE: Readonly<Record<string, string>> = Object.freeze({
  o: '#2A1B0E', w: '#FFFFFF', y: '#FFD54A', Y: '#F59F0B', l: '#FFF4B0',
  b: '#A8703A', B: '#7B4A22', h: '#C98F55',
  s: '#C3CAD3', m: '#9AA4B1', S: '#6B7480',
  r: '#E2553F', R: '#A83A28', g: '#58C13B', G: '#3E9A2E', c: '#CFF3FF',
  k: '#5EC8FF', K: '#2E86C1', p: '#9B74EA', P: '#4B2A8F', e: '#EDE6D3', E: '#C9BFA5',
  n: '#FF8FB1', N: '#D9577F', q: '#E0B080', Q: '#B57E45',
});

export const art = (rows: readonly string[]): PixelArt => Object.freeze({ rows: Object.freeze([...rows]), palette: PALETTE });

/** Adventure stars. */
export const STAR = art(outlined([
  '................',
  '.......y........',
  '.......yy.......',
  '......lyyY......',
  '......lyyY......',
  '.lllllyyyyyyyY..',
  '..lyyyyyyyyyY...',
  '...lyyyyyyyY....',
  '....yyyyyyYY....',
  '....yyyyyyyY....',
  '...lyyyYYyyyY...',
  '...yyyY..YyyY...',
  '..yyY......YyY..',
  '..yY........YY..',
  '................',
  '................',
]));

/** The best Free Play wave: a breaking wave. */
export const WAVE = art(outlined([
  '................',
  '................',
  '......kkkk......',
  '....kkkkkkkk....',
  '...kkkcccckkk...',
  '..kkkc....ckk...',
  '..kkc.....ck....',
  '.kkkc...........',
  '.kkkkc..........',
  '.kkkkkc....k....',
  '.KkkkkkkkkkkkK..',
  '.KKkkkkkkkkkkKK.',
  '.KKKKkkkkkkKKKK.',
  '..KKKKKKKKKKKK..',
  '................',
  '................',
]));

/** Versus wins: two crossed swords. */
export const SWORDS = art(outlined([
  '................',
  '.s............s.',
  '.ss..........ss.',
  '..ss........ss..',
  '...ss......ss...',
  '....ss....ss....',
  '.....ss..ss.....',
  '......ssss......',
  '......ssss......',
  '.....ss..ss.....',
  '..b.ss....ss.b..',
  '...bb......bb...',
  '...bbb....bbb...',
  '..yb.bb..bb.by..',
  '.yy...b..b...yy.',
  '................',
]));

/** Wins against the computer: a robot head. */
export const ROBOT = art(outlined([
  '.......r........',
  '.......s........',
  '.......s........',
  '..ssssssssssss..',
  '..smmmmmmmmmms..',
  '.ssmkkmmmmkkmss.',
  '.ssmkkmmmmkkmss.',
  '..smmmmmmmmmms..',
  '..smmmmmmmmmms..',
  '..smSySySySySms.',
  '..smmmmmmmmmms..',
  '..ssssssssssss..',
  '.....SSSSSS.....',
  '................',
  '................',
  '................',
]));

/** An empty table: a podium with nobody on it. */
export const PODIUM = art(outlined([
  '................',
  '................',
  '................',
  '................',
  '......yyyy......',
  '......yYYy......',
  '......yyyy......',
  '..ssssyyyy......',
  '..smmsyyyy......',
  '..ssssyyyyqqqq..',
  '..ssssyyyyqQQq..',
  '..ssssyyyyqqqq..',
  '..ssssyyyyqqqq..',
  '..SSSSYYYYQQQQ..',
  '................',
  '................',
]));

/** Moved up a place. */
export const UP = art(outlined([
  '............',
  '.....gg.....',
  '....gggg....',
  '...gggggg...',
  '..gggggggg..',
  '.gggggggggg.',
  '....gggg....',
  '....gggg....',
  '....gggg....',
  '....GGGG....',
  '............',
  '............',
]));

export const BOARD_PICTURES: Readonly<Record<string, PixelArt>> = Object.freeze({ STAR, WAVE, SWORDS, ROBOT, PODIUM, UP });
