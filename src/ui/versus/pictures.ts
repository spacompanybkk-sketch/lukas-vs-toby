import type { PixelArt } from '../hud/PixelIcon';
import { art } from '../screens/boardPictures';
import { outlined } from '../screens/pictures';

/**
 * The Versus pictures, as pixel grids (see PixelIcon), in the board pictures' palette. Drawn as
 * fills; `outlined` adds the one-pixel ink edge.
 */

const TABLET_ROWS = ['ssssss', 'skkkks', 'skkkks', 'sggggs', 'sggggs', 'sBBBBs', 'ssssss', 'ssSSss', 'ssssss'];
const SWORD_ROWS = ['s......s', 'ss....ss', '.ss..ss.', '..ssss..', '...ss...', '..ssss..', '.ss..ss.', 'bb....bb', 'b......b'];
const BLANK24 = '.'.repeat(24);

/** The Play menu's Versus tile: two tablets with crossed swords between them. */
export const TABLETS_SWORDS = art(outlined([
  BLANK24, BLANK24, BLANK24,
  ...TABLET_ROWS.map((t, i) => `.${t}.${SWORD_ROWS[i]!}.${t}.`),
  BLANK24, BLANK24, BLANK24, BLANK24,
]));

/** Nobody here: an empty wooden bench. */
export const BENCH = art(outlined([
  '................',
  '................',
  '................',
  '................',
  '................',
  '.hhhhhhhhhhhhhh.',
  '.bbbbbbbbbbbbbb.',
  '..B..........B..',
  '..B..........B..',
  '.hhhhhhhhhhhhhh.',
  '.bbbbbbbbbbbbbb.',
  '..B..........B..',
  '..B..........B..',
  '..B..........B..',
  '................',
  '................',
]));

/** Swap the sides: two arrows, one each way, their tails bent. */
export const SWAP = art(outlined([
  '................',
  '..yy.....y......',
  '..yyyyyyyyy.....',
  '..yyyyyyyyyy....',
  '..yyyyyyyyy.....',
  '.........y......',
  '................',
  '................',
  '................',
  '......g.........',
  '.....ggggggggg..',
  '....gggggggggg..',
  '.....ggggggggg..',
  '......g.....gg..',
  '................',
  '................',
]));

/** Asleep: three Zs, growing. */
export const ZZZ = art(outlined([
  '................',
  '..........www...',
  '...........w....',
  '..........www...',
  '................',
  '.....wwww.......',
  '.......w........',
  '......w.........',
  '.....wwww.......',
  '................',
  '.wwwwww.........',
  '....ww..........',
  '...ww...........',
  '..ww............',
  '.wwwwww.........',
  '................',
]));

/** Give up: a white flag on a pole. */
export const WHITE_FLAG = art(outlined([
  '................',
  '..y.............',
  '..bwwwwwwwww....',
  '..bwwwwwwwwww...',
  '..bwwwwwwwwwww..',
  '..bwwwwwwwwww...',
  '..bwwwwwwwww....',
  '..b.............',
  '..b.............',
  '..b.............',
  '..b.............',
  '..b.............',
  '..b.............',
  '..b.............',
  '..b.............',
  '................',
]));

/** Something broke: a stone block with a crack down it. */
export const CRACKED_BLOCK = art(outlined([
  '................',
  '.mmmmmmmmmmmmmm.',
  '.msssssssSssssm.',
  '.mssssssSSssssm.',
  '.msssssSSsssssm.',
  '.mssssssSSssssm.',
  '.msssssssSSsssm.',
  '.mssssssSSssssm.',
  '.msssssSSsssssm.',
  '.mssssSSssssssm.',
  '.msssssSSsssssm.',
  '.mssssssSsssssm.',
  '.mssssssssssssm.',
  '.mmmmmmmmmmmmmm.',
  '................',
  '................',
]));

/** "I don't know": a boxy figure, hands up. */
export const SHRUG = art(outlined([
  '................',
  '................',
  '.....qqqqqq.....',
  '.....qqqqqq.....',
  '.....qoqqoq.....',
  '.....qqqqqq.....',
  '.q...qooooq...q.',
  '.qq..qqqqqq..qq.',
  '..qq..kkkk..qq..',
  '...qqkkkkkkqq...',
  '.....kkkkkk.....',
  '.....kkkkkk.....',
  '.....kkkkkk.....',
  '.....K....K.....',
  '................',
  '................',
]));

/** A new game version: an arrow down into a tablet. */
export const UPDATE = art(outlined([
  '................',
  '......gggg......',
  '......gggg......',
  '......gggg......',
  '....gggggggg....',
  '.....gggggg.....',
  '......gggg......',
  '.......gg.......',
  '..ssssssssssss..',
  '..skkkkkkkkkks..',
  '..skkkkkkkkkks..',
  '..skkkkkkkkkks..',
  '..ssssssssssss..',
  '..sssssSSsssss..',
  '..ssssssssssss..',
  '................',
]));

/** Paused: a round blue sign with two white bars. */
export const PAUSE_SIGN = art(outlined([
  '................',
  '....kkkkkkkk....',
  '...kkkkkkkkkk...',
  '..kkkkkkkkkkkk..',
  '..kkkwwkkwwkkk..',
  '..kkkwwkkwwkkk..',
  '..kkkwwkkwwkkk..',
  '..kkkwwkkwwkkk..',
  '..kkkwwkkwwkkk..',
  '..kkkwwkkwwkkk..',
  '..kkkwwkkwwkkk..',
  '..kkkkkkkkkkkk..',
  '...kkkkkkkkkk...',
  '....kkkkkkkk....',
  '................',
  '................',
]));

/** Not yet answered: a yellow question mark. */
export const QUESTION = art(outlined([
  '................',
  '................',
  '.....yyyyyy.....',
  '....yyyyyyyy....',
  '....yyy..yyy....',
  '.........yyy....',
  '........yyy.....',
  '.......yyy......',
  '.......yy.......',
  '.......yy.......',
  '................',
  '.......yy.......',
  '.......yy.......',
  '................',
  '................',
  '................',
]));

/** Less head start: a white bar, the plus (pictures.ts PLUS) without its upright. */
export const MINUS = art(outlined([
  '............',
  '............',
  '............',
  '............',
  '............',
  '.wwwwwwwwww.',
  '.wwwwwwwwww.',
  '............',
  '............',
  '............',
  '............',
  '............',
]));

/** Every Versus picture, for the tests. */
export const ALL_VERSUS_PICTURES: Readonly<Record<string, PixelArt>> = Object.freeze({
  TABLETS_SWORDS, BENCH, SWAP, ZZZ, WHITE_FLAG, CRACKED_BLOCK, SHRUG, UPDATE, PAUSE_SIGN, QUESTION, MINUS,
});
