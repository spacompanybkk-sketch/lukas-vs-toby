import type { PixelArt } from '../hud/PixelIcon';

/**
 * The pictures of the player screens, as pixel grids (see PixelIcon). Most are drawn as fills
 * only and get their ink outline from `outlined`, so every edge is one clean pixel of ink.
 */
const PALETTE: Readonly<Record<string, string>> = Object.freeze({
  o: '#2A1B0E', w: '#FFFFFF', y: '#FFD54A', Y: '#F59F0B', l: '#FFF4B0',
  b: '#A8703A', B: '#7B4A22', h: '#C98F55',
  s: '#C3CAD3', m: '#9AA4B1', S: '#6B7480',
  r: '#E2553F', R: '#A83A28', g: '#58C13B', G: '#3E9A2E', c: '#CFF3FF',
});

/** Adds a one-pixel ink outline (8 neighbours) around every filled pixel. */
export function outlined(rows: readonly string[]): string[] {
  const h = rows.length;
  const filled = (x: number, y: number): boolean => y >= 0 && y < h && x >= 0 && (rows[y] as string).charAt(x) !== '' && (rows[y] as string).charAt(x) !== '.';
  return rows.map((row, y) => [...row].map((ch, x) => {
    if (ch !== '.') return ch;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (filled(x + dx, y + dy)) return 'o';
    return '.';
  }).join(''));
}

/** `top` drawn over `base`: every pixel of `top` that is not '.' replaces the one below. */
export function overlay(base: readonly string[], top: readonly string[]): string[] {
  return base.map((row, y) => [...row].map((ch, x) => {
    const t = (top[y] ?? '').charAt(x);
    return t !== '' && t !== '.' ? t : ch;
  }).join(''));
}

const art = (rows: readonly string[]): PixelArt => Object.freeze({ rows: Object.freeze([...rows]), palette: PALETTE });

export const COIN = art([
  '....oooo....',
  '..ooyyyyoo..',
  '.oyylllyyYo.',
  '.oylyyyyyYo.',
  'oylyyYYyyyYo',
  'oyyyyYyyyyYo',
  'oyyyyYyyyyYo',
  'oyyyyYYyyyYo',
  '.oyyyyyyyYo.',
  '.oYyyyyyYYo.',
  '..ooYYYYoo..',
  '....oooo....',
]);

export const DOOR = art([
  '.oooooooooo.',
  '.oBBBBBBBBo.',
  '.oBhbbbbhBo.',
  '.oBhbbbbhBo.',
  '.oBhbbbbhBo.',
  '.oBBBBBBBBo.',
  '.oBhbbyyhBo.',
  '.oBhbbyYhBo.',
  '.oBhbbbbhBo.',
  '.oBhbbbbhBo.',
  '.oBBBBBBBBo.',
  'oooooooooooo',
]);

const CLOUD_ROWS = [
  '................',
  '................',
  '................',
  '......oooo......',
  '.....owwwwo.....',
  '..ooowwwwwwoo...',
  '.owwwwwwwwwwwwo.',
  'owwwwwwwwwwwwwwo',
  'owwwwwwwwwwwwwso',
  'owwwwwwwwwwwwsso',
  '.osssssssssssso.',
  '..oooooooooooo..',
  '................',
  '................',
  '................',
  '................',
];

export const CLOUD = art(CLOUD_ROWS);

/** The cloud crossed out in red: no connection. */
export const CLOUD_OFF = art(overlay(CLOUD_ROWS, Array.from({ length: 16 }, (_, y) => {
  const row = [...'................'];
  if (y >= 1 && y <= 14) {
    const x = y;
    if (x - 1 >= 0) row[x - 1] = 'o';
    row[x] = 'r';
    if (x + 1 < 16) row[x + 1] = 'r';
    if (x + 2 < 16) row[x + 2] = 'o';
  }
  return row.join('');
})));

export const HOURGLASS = art([
  'oooooooooooo',
  'obbbbbbbbbbo',
  'oooooooooooo',
  '.occyyyyyco.',
  '..ocyyyyco..',
  '...ocyyco...',
  '...occyco...',
  '..occcycco..',
  '.occcyyycco.',
  'oooooooooooo',
  'obbbbbbbbbbo',
  'oooooooooooo',
]);

export const LOCK = art([
  '...oooooo...',
  '..ommmmmmo..',
  '..omoooomo..',
  '..omo..omo..',
  'oooooooooooo',
  'oyylyyyyyyYo',
  'oylyyooyyyYo',
  'oyyyyooyyyYo',
  'oyyyyyoyyyYo',
  'oyyyyyoyyyYo',
  'oYYYYYYYYYYo',
  'oooooooooooo',
]);

export const PLUS = art(outlined([
  '............',
  '.....ww.....',
  '.....ww.....',
  '.....ww.....',
  '.....ww.....',
  '.wwwwwwwwww.',
  '.wwwwwwwwww.',
  '.....ww.....',
  '.....ww.....',
  '.....ww.....',
  '.....ww.....',
  '............',
]));

export const CHECK = art(outlined([
  '............',
  '............',
  '.........gg.',
  '........ggg.',
  '.......ggg..',
  '.gg...ggg...',
  '.ggg.ggg....',
  '..ggggg.....',
  '...ggg......',
  '....g.......',
  '............',
  '............',
]));

const X_ROWS = outlined([
  '............',
  '.rr......rr.',
  '.rrr....rrr.',
  '..rrr..rrr..',
  '...rrrrrr...',
  '....rrrr....',
  '....rrrr....',
  '...rrrrrr...',
  '..rrr..rrr..',
  '.rrr....rrr.',
  '.rr......rr.',
  '............',
]);
export const CROSS = art(X_ROWS);

export const BACKSPACE = art(overlay(outlined([
  '................',
  '................',
  '................',
  '.....wwwwwwwwww.',
  '....wwwwwwwwwww.',
  '...wwwwwwwwwwww.',
  '..wwwwwwwwwwwww.',
  '.wwwwwwwwwwwwww.',
  '.wwwwwwwwwwwwww.',
  '..wwwwwwwwwwwww.',
  '...wwwwwwwwwwww.',
  '....wwwwwwwwwww.',
  '.....wwwwwwwwww.',
  '................',
  '................',
  '................',
]), [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......rr..rr...',
  '........rrrr....',
  '.........rr.....',
  '.........rr.....',
  '........rrrr....',
  '.......rr..rr...',
  '................',
  '................',
  '................',
  '................',
  '................',
]));

export const TROPHY = art(outlined([
  '................',
  '...lyyyyyyyyY...',
  '.yylyyyyyyyyYyy.',
  '.y.lyyyyyyyyY.y.',
  '.y.lyyyyyyyyY.y.',
  '..ylyyyyyyyyYy..',
  '...yyyyyyyyyy...',
  '....yyyyyyyy....',
  '.....yyyyyy.....',
  '......yyyy......',
  '......yYYy......',
  '......yYYy......',
  '....bbbbbbbb....',
  '...hhhhhhhhhh...',
  '...BBBBBBBBBB...',
  '................',
]));

export const BOOK = art(outlined([
  '................',
  '..Gggggggggggg..',
  '..Gggggggggggg..',
  '..Gggwwwwwwwgg..',
  '..GggwSSSSSwgg..',
  '..Gggwwwwwwwgg..',
  '..GggwSSSSwwgg..',
  '..Gggwwwwwwwgg..',
  '..Gggggggggggg..',
  '..GgggggyGgggg..',
  '..GggggyyyGggg..',
  '..GgggggGggggg..',
  '..Gggggggggggg..',
  '..Gwwwwwwwwwww..',
  '..GGGGGGGGGGGG..',
  '................',
]));

export const MARKET = art(outlined([
  '................',
  '.rrwwrrwwrrwwrr.',
  '.rrwwrrwwrrwwrr.',
  '.rrwwrrwwrrwwrr.',
  '.RR.RR.RR.RR.RR.',
  '..b..........b..',
  '..b..yy..yy..b..',
  '..b.yyyyyyyy.b..',
  '.bbbbbbbbbbbbbb.',
  '.bhhhhhhhhhhhhb.',
  '.bhBBBBBBBBBBhb.',
  '.bhBhhhhhhhhBhb.',
  '.bhBBBBBBBBBBhb.',
  '.bbbbbbbbbbbbbb.',
  '................',
  '................',
]));

export const KEY = art(outlined([
  '................',
  '................',
  '................',
  '................',
  '................',
  '...yyyy.........',
  '..yyyyyy........',
  '.yyy..yyyyyyyyy.',
  '.yyy..yyyyyyyyy.',
  '..yyyyyy..yy.yy.',
  '...yyyy...yy.yy.',
  '................',
  '................',
  '................',
  '................',
  '................',
]));

/** The two devices of the "progress came from the other device" cue, and the arrow between them. */
export const TABLET = art(outlined([
  '............',
  '.ssssssssss.',
  '.skkkkkkkks.',
  '.skkkkkkkks.',
  '.skggggggks.',
  '.sggggggggs.',
  '.sBBBBBBBBs.',
  '.sBBBBBBBBs.',
  '.ssssssssss.',
  '.ssssSSssss.',
  '.ssssssssss.',
  '............',
].map((r) => r.replace(/k/g, 'c'))));

export const LAPTOP = art(outlined([
  '............',
  '..ssssssss..',
  '..sccccccs..',
  '..sccccccs..',
  '..sggggggs..',
  '..sBBBBBBs..',
  '..ssssssss..',
  '.mmmmmmmmmm.',
  '.mSmSmSmSmm.',
  '.mmmmmmmmmm.',
  '............',
  '............',
]));

export const ARROW = art(outlined([
  '............',
  '............',
  '............',
  '.......y....',
  '.......yy...',
  '.yyyyyyyyy..',
  '.yyyyyyyyyy.',
  '.yyyyyyyyy..',
  '.......yy...',
  '.......y....',
  '............',
  '............',
]));

/** A boxy test tube: this build plays on the fake cloud. */
export const TEST_TUBE = art(outlined([
  '............',
  '...wwwwww...',
  '....cccc....',
  '....cccc....',
  '....cccc....',
  '....cccc....',
  '....gggg....',
  '....gggg....',
  '....gGgg....',
  '....gggg....',
  '.....gg.....',
  '............',
]));

/** Every picture here, for the tests (square, one palette). */
export const ALL_PICTURES: Readonly<Record<string, PixelArt>> = Object.freeze({
  COIN, DOOR, CLOUD, CLOUD_OFF, HOURGLASS, LOCK, PLUS, CHECK, CROSS, BACKSPACE, TROPHY, BOOK, MARKET, KEY, TABLET, LAPTOP, ARROW, TEST_TUBE,
});

/** A 5×7 pixel font for the number pad and the hourglass, with an ink edge (7×9 each). */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['.www.', 'w...w', 'w..ww', 'w.w.w', 'ww..w', 'w...w', '.www.'],
  '1': ['..w..', '.ww..', '..w..', '..w..', '..w..', '..w..', '.www.'],
  '2': ['.www.', 'w...w', '....w', '...w.', '..w..', '.w...', 'wwwww'],
  '3': ['wwwww', '...w.', '..w..', '...w.', '....w', 'w...w', '.www.'],
  '4': ['...w.', '..ww.', '.w.w.', 'w..w.', 'wwwww', '...w.', '...w.'],
  '5': ['wwwww', 'w....', 'wwww.', '....w', '....w', 'w...w', '.www.'],
  '6': ['..ww.', '.w...', 'w....', 'wwww.', 'w...w', 'w...w', '.www.'],
  '7': ['wwwww', '....w', '...w.', '..w..', '.w...', '.w...', '.w...'],
  '8': ['.www.', 'w...w', 'w...w', '.www.', 'w...w', 'w...w', '.www.'],
  '9': ['.www.', 'w...w', 'w...w', '.wwww', '....w', '...w.', '.ww..'],
};

export const DIGITS: Readonly<Record<string, PixelArt>> = Object.freeze(Object.fromEntries(
  Object.entries(GLYPHS).map(([d, rows]) => [d, art(outlined(['.......', ...rows.map((r) => `.${r}.`), '.......']))]),
));
