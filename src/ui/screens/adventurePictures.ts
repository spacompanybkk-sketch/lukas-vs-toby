import type { LevelKind } from '../../adventure/types';
import type { PixelArt } from '../hud/PixelIcon';
import { SWORDS, art } from './boardPictures';
import { outlined } from './pictures';

/**
 * Pictures of the Play menu, the map and the level card, as pixel grids (see PixelIcon), in the
 * board's palette. Drawn as fills; `outlined` adds the one-pixel ink edge.
 */

/** Adventure: a winding path of stepping stones up to a red flag. */
export const PATH_FLAG = art(outlined([
  '................',
  '..........Brrr..',
  '..........Brrrr.',
  '..........Brrr..',
  '..........B.....',
  '........eeBe....',
  '.......eEEEEe...',
  '................',
  '...ee...........',
  '..eEEe..........',
  '.......ee.......',
  '......eEEe......',
  '..........ee....',
  '.........eEEe...',
  '..ee............',
  '.eEEe...........',
]));

/** Survive: a wooden shield. */
export const SHIELD = art(outlined([
  '................',
  '..bbbbbbbbbbbb..',
  '..bhhhhyyhhhhb..',
  '..bhhhhyyhhhhb..',
  '..bhhhhyyhhhhb..',
  '..byyyyyyyyyyb..',
  '..byyyyyyyyyyb..',
  '..bhhhhyyhhhhb..',
  '..bhhhhyyhhhhb..',
  '...bhhhyyhhhb...',
  '...bhhhyyhhhb...',
  '....bhhyyhhb....',
  '.....bhyyhb.....',
  '......byyb......',
  '.......bb.......',
  '................',
]));

/** Breakthrough: a stone hammer on a wooden handle. */
export const HAMMER = art(outlined([
  '................',
  '..sssssssss.....',
  '..smmmmmmms.....',
  '..smmmmmmmsS....',
  '..sssssssssS....',
  '...SSSbSSSS.....',
  '......bb........',
  '.......bb.......',
  '........bb......',
  '.........bb.....',
  '..........bb....',
  '...........bb...',
  '............bb..',
  '.............B..',
  '................',
  '................',
]));

/** The clock that comes with Survive and Breakthrough (and the clock stars of Breakthrough). */
export const CLOCK = art(outlined([
  '................',
  '.....wwwwww.....',
  '...wwwwwowwww...',
  '..wwwwwwowwwww..',
  '..wwwwwwowwwww..',
  '.wwwwwwwowwwwww.',
  '.wwwwwwwowwwwww.',
  '.wwwwwwwoooooww.',
  '.wwwwwwwwwwwwww.',
  '.wwwwwwwwwwwwww.',
  '..wwwwwwwwwwww..',
  '..wwwwwwwwwwww..',
  '...wwwwwwwwww...',
  '.....wwwwww.....',
  '................',
  '................',
]));

/** Conveyor: a belt on two wheels with three boxes riding on it. */
export const BELT = art(outlined([
  '................',
  '................',
  '................',
  '..gg..yy..nn....',
  '..gG..yY..nN....',
  '..GG..YY..NN....',
  '.SSSSSSSSSSSSSS.',
  'SmmmmmmmmmmmmmmS',
  'SmsmmmsmmmsmmmmS',
  'SmmmmmmmmmmmmmmS',
  '.SSSSSSSSSSSSSS.',
  '..SS..SS..SS....',
  '..SS..SS..SS....',
  '................',
  '................',
  '................',
]));

/** Boss: a skull with a golden crown. */
export const SKULL_CROWN = art(outlined([
  '..y....y....y...',
  '..yy..yyy..yy...',
  '..yyyyyryyyyy...',
  '..YYYYYYYYYYY...',
  '...eeeeeeeee....',
  '..eeeeeeeeeee...',
  '..eooeeeeeooe...',
  '..eooeeeeeooe...',
  '..eeeeeoeeeee...',
  '...eeeoooeee....',
  '...eeeeeeeee....',
  '....eoeoeoe.....',
  '....eeeeeee.....',
  '................',
  '................',
  '................',
]));

/** A base: a small boxy tower (the level card's "keep your base" stars). */
export const TOWER = art(outlined([
  '................',
  '..s.s.s..s.s.s..',
  '..sssss..sssss..',
  '..smmms..smmms..',
  '..smmmssssmmms..',
  '..smmmmmmmmmms..',
  '..smmmmmmmmmms..',
  '..smmmmBBmmmms..',
  '..smmmBBBBmmms..',
  '..smmmBBBBmmms..',
  '..smmmBBBBmmms..',
  '..ssssssssssss..',
  '................',
  '................',
  '................',
  '................',
]));

/** The first star: just win. A small red flag on a pole. */
export const FLAG = art(outlined([
  '................',
  '....Brrrrrr.....',
  '....Brrrrrrr....',
  '....Brrrrrrrr...',
  '....Brrrrrrr....',
  '....Brrrrrr.....',
  '....B...........',
  '....B...........',
  '....B...........',
  '....B...........',
  '....B...........',
  '...BBB..........',
  '..BBBBB.........',
  '................',
  '................',
  '................',
]));

const FACE_ROWS = (fill: string, mouth: readonly string[], brows: readonly string[] = []): string[] => {
  const head = [
    '................',
    '....xxxxxxxx....',
    '...xxxxxxxxxx...',
    '..xxxxxxxxxxxx..',
    '..xxxxxxxxxxxx..',
    '..xxxooxxooxxx..',
    '..xxxooxxooxxx..',
    '..xxxxxxxxxxxx..',
    '..xxxxxxxxxxxx..',
    '..xxxxxxxxxxxx..',
    '..xxxxxxxxxxxx..',
    '...xxxxxxxxxx...',
    '....xxxxxxxx....',
    '................',
    '................',
    '................',
  ].map((r) => r.replace(/x/g, fill));
  const draw = (rows: string[], top: readonly string[], at: number): string[] => rows.map((r, y) => {
    const t = top[y - at];
    if (t === undefined) return r;
    return [...r].map((ch, x) => (t.charAt(x) !== '.' && t.charAt(x) !== '' ? t.charAt(x) : ch)).join('');
  });
  return outlined(draw(draw(head, mouth, 8), brows, 3));
};

/** The three Adventure difficulties as faces: a happy green one, a calm yellow one, a cross red one. */
export const FACE_EASY = art(FACE_ROWS('g', [
  '....o......o....',
  '.....oooooo.....',
]));
export const FACE_MEDIUM = art(FACE_ROWS('y', [
  '................',
  '.....oooooo.....',
]));
export const FACE_HARD = art(FACE_ROWS('r', [
  '.....oooooo.....',
  '....o......o....',
], [
  '....oo....oo....',
  '.....oo..oo.....',
]));

/** A level kind's picture: one, or a main one with a smaller one on its corner. */
export const KIND_ART: Readonly<Record<LevelKind, readonly PixelArt[]>> = Object.freeze({
  battle: [SWORDS],
  survive: [SHIELD, CLOCK],
  breakthrough: [HAMMER, CLOCK],
  conveyor: [BELT],
  boss: [SKULL_CROWN],
});

/** Every picture here, for the tests. */
export const ADVENTURE_PICTURES: Readonly<Record<string, PixelArt>> = Object.freeze({
  PATH_FLAG, SHIELD, HAMMER, CLOCK, BELT, SKULL_CROWN, TOWER, FLAG, FACE_EASY, FACE_MEDIUM, FACE_HARD,
});
