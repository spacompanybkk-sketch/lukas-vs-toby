import type { PixelArt } from '../hud/PixelIcon';
import { art } from './boardPictures';
import { outlined } from './pictures';

/** The Almanac's stat and role pictures, 12 × 12 with an ink edge (see boardPictures for the palette). */
const pic = (rows: readonly string[]): PixelArt => art(outlined(rows));

/** Health. */
export const HEART = pic([
  '............',
  '............',
  '..rrr..rrr..',
  '.rwrrrrrrRr.',
  '.rwrrrrrrRr.',
  '.rrrrrrrrRr.',
  '..rrrrrrRr..',
  '...rrrrRr...',
  '....rrRr....',
  '.....rR.....',
  '............',
  '............',
]);

/** Damage per second: a sword. */
export const SWORD = pic([
  '............',
  '.........ws.',
  '........wss.',
  '.......wss..',
  '......wss...',
  '.....wss....',
  '..y.wss.....',
  '...yss......',
  '...By.......',
  '..BB.y......',
  '.BB.........',
  '............',
]);

/** Speed: a boot with wind lines. */
export const BOOT = pic([
  '............',
  '......bbb...',
  '......bhb...',
  '......bhb...',
  '......bhb...',
  'ss...bbhb...',
  '....bbbhbb..',
  'sss.bhhhhbb.',
  '....bbbbbbb.',
  '....BBBBBBB.',
  '............',
  '............',
]);

/** Plants do not walk: roots. */
export const ROOT = pic([
  '............',
  '.....gg.....',
  '....gGgg....',
  '.....GG.....',
  '.....bb.....',
  '.....bb.....',
  '....bbbb....',
  '...bb.bbb...',
  '..bb..b.bb..',
  '..b..bb..b..',
  '.....b......',
  '............',
]);

const TARGET = pic([
  '............',
  '....rrrr....',
  '...rwwwwr...',
  '..rwrrrrwr..',
  '..rwrwwrwr..',
  '..rwrwrrwr..',
  '..rwrrrrwr..',
  '...rwwwwr...',
  '....rrrr....',
  '............',
  '............',
  '............',
]);

const SUN = pic([
  '............',
  '.y...yy...y.',
  '..y.yyyy.y..',
  '...yllyyy...',
  '..yllyyyyy..',
  '.yylyyyyyYy.',
  '.yyyyyyyyYy.',
  '..yyyyyyYy..',
  '...yyyyYY...',
  '..y.yYYy.y..',
  '.y...yy...y.',
  '............',
]);

const BRICKS = pic([
  '............',
  '............',
  '.hhhhh.hhhh.',
  '.bbbbb.bbbb.',
  '............',
  '.hh.hhhhh.h.',
  '.bb.bbbbb.b.',
  '............',
  '.hhhhh.hhhh.',
  '.BBBBB.BBBB.',
  '............',
  '............',
]);

const MINE = pic([
  '............',
  '.......y....',
  '......yr....',
  '.....b......',
  '.....b......',
  '...qqqqq....',
  '..qqQqqqq...',
  '.qqqqqqQqq..',
  '.qQqqqqqqq..',
  'GGGGGGGGGGG.',
  'BBBBBBBBBBB.',
  '............',
]);

const STUN = pic([
  '............',
  '..y.........',
  '.yyy....y...',
  '..y....yyy..',
  '........y...',
  '....kkkk....',
  '...k....k...',
  '...k.kk.k...',
  '...k.k..k...',
  '....kk.k....',
  '.......k....',
  '............',
]);

const BURST = pic([
  '............',
  '.y...y...y..',
  '..y.yyy.y...',
  '...yYrYy....',
  '.yyYrrrYyy..',
  '..yrrwrry...',
  '.yyYrrrYyy..',
  '...yYrYy....',
  '..y.yyy.y...',
  '.y...y...y..',
  '............',
  '............',
]);

const CASTLE = pic([
  '............',
  '.s.s.ss.s.s.',
  '.sssssssssss',
  '..smmmmmms..',
  '..smSmmSms..',
  '..smmmmmms..',
  '..smmBBmms..',
  '..smmBBmms..',
  '.SSSSSSSSSS.',
  '............',
  '............',
  '............',
].map((r) => r.slice(0, 12)));

const HEAL = pic([
  '............',
  '....gggg....',
  '....gwGg....',
  '....gwGg....',
  '.ggggwGgggg.',
  '.gwwwwwwwGg.',
  '.gGGGwGGGGg.',
  '.ggggwGgggg.',
  '....gwGg....',
  '....gGGg....',
  '....gggg....',
  '............',
]);

const BOMB = pic([
  '............',
  '........y...',
  '.......yr...',
  '......b.....',
  '....SSSS....',
  '...SmmmmS...',
  '..SmwmmmmS..',
  '..SmmmmmmS..',
  '..SmmmmmmS..',
  '...SmmmmS...',
  '....SSSS....',
  '............',
]);

const FIST = pic([
  '............',
  '............',
  '...qqqqqq...',
  '..qqQqQqQq..',
  '..qqQqQqQq..',
  '..qqqqqqqq..',
  '..qQqqqqqq..',
  '...qqqqqq...',
  '....qqqq....',
  '....rrrr....',
  '....RRRR....',
  '............',
]);

const BRAIN = pic([
  '............',
  '............',
  '...nnnnnn...',
  '..nnNnnNnn..',
  '.nNnnnNnnnn.',
  '.nnnNnnnNnn.',
  '.nnNnnNnnNn.',
  '..nnnnnnnn..',
  '...NnnnnN...',
  '............',
  '............',
  '............',
]);

const BOLT = pic([
  '............',
  '......yyy...',
  '.....yyy....',
  '....yyy.....',
  '...yyyyyy...',
  '.....yyy....',
  '....yyy.....',
  '...yyY......',
  '..yY........',
  '............',
  '............',
  '............',
]);

const SHIELD = pic([
  '............',
  '..ssssssss..',
  '..smmmmmms..',
  '..smmyymms..',
  '..smyyyyms..',
  '..smmyymms..',
  '..smmmmmms..',
  '...smmmms...',
  '....smms....',
  '.....ss.....',
  '............',
  '............',
]);

const ARROW = pic([
  '............',
  '............',
  '.........s..',
  '..........s.',
  '.r........s.',
  '.rrbbbbbbbss',
  '.r........s.',
  '..........s.',
  '.........s..',
  '............',
  '............',
  '............',
].map((r) => r.slice(0, 12)));

const GROW = pic([
  '............',
  '.....gg.....',
  '....gggg....',
  '...gggggg...',
  '.....gg.....',
  '....gggg....',
  '...gggggg...',
  '..gggggggg..',
  '.....gg.....',
  '.....GG.....',
  '............',
  '............',
]);

const LASSO = pic([
  '............',
  '...hhhhh....',
  '..h.....h...',
  '.h.......h..',
  '.h.......h..',
  '..h.....h...',
  '...hhhhh....',
  '.....h......',
  '......h.....',
  '.......hh...',
  '.........h..',
  '............',
]);

const TRIDENT = pic([
  '............',
  '.y...y...y..',
  '.y...y...y..',
  '.yy..y..yy..',
  '..yyyyyyy...',
  '.....y......',
  '.....b......',
  '.....b......',
  '.....b......',
  '.....b......',
  '.....B......',
  '............',
]);

const POISON = pic([
  '............',
  '.....gg.....',
  '....gggg....',
  '...gwggGg...',
  '...gwgggg...',
  '...ggggGg...',
  '....gGGg....',
  '............',
  '..ppGGGGpp..',
  '.pPPPPPPPPp.',
  '............',
  '............',
]);

const BONE = pic([
  '............',
  '.ee......ee.',
  'eeee....eeee',
  '.eeeeeeeeEe.',
  '...eeeeeE...',
  '...eeeeeE...',
  '.eeeeeeeeEe.',
  'eeEE....eeEE',
  '.EE......EE.',
  '............',
  '............',
  '............',
].map((r) => r.slice(0, 12)));

/** A picture for each role (spec 6.6 roles), and the Bone Minion's (raised, not played). */
export const ROLE_ART: Readonly<Record<string, PixelArt>> = Object.freeze({
  'Basic shooter': TARGET, Income: SUN, Wall: BRICKS, Trap: MINE, Control: STUN, 'Area damage': BURST,
  Fortress: CASTLE, Support: HEAL, Removal: BOMB, Bruiser: FIST, Basic: BRAIN, Rush: BOLT, Tank: SHIELD,
  Sniper: ARROW, Snowball: GROW, Disabler: LASSO, Siege: TRIDENT, 'Area denial': POISON, Raised: BONE,
});

export const ALMANAC_PICTURES: Readonly<Record<string, PixelArt>> = Object.freeze({ HEART, SWORD, BOOT, ROOT, ...ROLE_ART });
